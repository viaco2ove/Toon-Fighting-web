# -*- coding: utf-8 -*-
"""
ff-studio/sff.py — SFF v1 角色贴图包读写工具（纯 Python + Pillow）

格式实现逐行对齐 IKEMEN GO 引擎源码 image.go（loadSff / Sprite.read /
readPcxHeader / RlePcxDecode），并经 Fighter Factory Studio 写出的实际文件
（Lin.sff，1453 sprites）与已知正常的 Hinako.sff 交叉验证：

- 文件头（512B）：签名"ElecbyteSpr\\0"@0，版本字节@12-15（verhi@15=1 → v1），
  **NumberOfSprites@20，FirstSpriteHeaderOffset@24**（FF 文件里 @16 是旧字段，引擎忽略）
- 子头（32B）：**<IIHHHHH>** = next(u32 绝对偏移)、size(u32=数据块长)、
  x(u16)、y(u16)、group(u16)、number(u16)、link(u16)，其余 14 字节引擎不解析。
  注意：size 必须按 u32 读（用 '<IHHHHHH' 少一个 I 会全体错位 2 字节——踩过的坑）
- 数据块（shofs+32 起，长 size）：块[0]=0x0A（PCX magic，引擎兼作 paletteSame
  标志 → FF 文件全部沿用 sprite(0,0) 的内嵌调色板；6 套配色由外部 .act 经
  remap 提供）；PCX 头 128B：encoding@2（1=RLE/0=raw）、bpp@3、rect@4-11、
  planes@65、bpl@66-67；之后 RLE 数据；块尾 [0x0C + 768B RGB 调色板] 或
  [768B 调色板 + 0x0C] 两种布局都识别
- RLE 解码：RLE 缓冲取到块尾（含尾部调色板字节）——与引擎 paletteSame
  路径一致，解码到 w*h 即停，尾部多余字节不消费；行边界 k==bpl 时只重置
  k 不补写像素（引擎 n=1 后 post 的 n-- 直接退出；**补写 1 像素会让每行
  多 1 像素导致整图斜移伪影——踩过的坑**）；index 0 = 透明
- size==0 的 sprite 为共享块（引擎 shareCopy）：像素自 link 指向的上游拷贝
- 回写：被编辑的 sprite 以 raw(encoding=0) 重编码（PCX 头 128B 含 reserved@64、
  planes@65、bpl@66——**少写 reserved 会全部错位 1 字节——踩过的坑**）；
  未编辑 sprite 原样字节拷贝，子头链 next/size 全部重算
- 调色板：sprite(0,0) 的块尾调色板是引擎 legacy 路径读取的全文件真源；
  其余块的块尾调色板被 paletteSame 忽略。portrait 大图通过占用空闲索引槽
  保证色彩质量

CLI:
  python sff.py <file.sff> info                 # 精灵目录统计
  python sff.py <file.sff> export -o frames -g 0,20   # 导出 PNG 帧
  python sff.py <file.sff> sheet -o sheet.png -g 0,20  # contact sheet 拼图

依赖：Pillow
"""
import json
import os
import struct

from PIL import Image, ImageDraw

SIGNATURE = b"ElecbyteSpr\x00"


class Sprite:
    def __init__(self):
        self.group = 0
        self.number = 0
        self.axis = (0, 0)
        self.link = 0
        self.encoding = 1       # PCX encoding：1=RLE / 0=raw
        self.bpl = 0
        self.size = (0, 0)      # w, h
        self.pixels = None      # bytearray 8-bit 索引，行宽=w
        self.palette = None     # 768 字节 RGB（块尾内嵌；无则沿用链上游）
        self.raw_block = None   # 原始数据块字节（未编辑时原样写回）
        self.block_len = 0

    def decode_rgba(self, palette):
        w, h = self.size
        im = Image.new("RGBA", (w, h))
        buf = bytearray(w * h * 4)
        px = self.pixels
        for i in range(w * h):
            idx = px[i]
            if idx == 0:
                continue
            buf[i * 4] = palette[idx * 3]
            buf[i * 4 + 1] = palette[idx * 3 + 1]
            buf[i * 4 + 2] = palette[idx * 3 + 2]
            buf[i * 4 + 3] = 255
        im.frombytes(bytes(buf), "raw", "RGBA")
        return im


class SffV1:
    def __init__(self):
        self.sprites = []
        self.header_bytes = None
        self.base_palette = None
        self._used_cache = None

    # ================= 读取 =================
    @classmethod
    def load(cls, path):
        with open(path, "rb") as f:
            data = f.read()
        if data[:12] != SIGNATURE:
            raise ValueError("不是 SFF 文件: %s" % path)
        ver_hi = data[15]  # 引擎：verhi 最后读
        if ver_hi != 1:
            raise ValueError("仅支持 SFF v1（此文件 verhi=%d）" % ver_hi)
        sff = cls()
        sff.header_bytes = data[:512]
        num_sprites = struct.unpack_from("<I", data, 20)[0]
        shofs = struct.unpack_from("<I", data, 24)[0]

        base_palette = None
        for i in range(num_sprites):
            sp = Sprite()
            nxt, size, x, y, group, number, link = struct.unpack_from("<IIHHHHH", data, shofs)
            sp.group, sp.number, sp.axis, sp.link = group, number, (x, y), link
            block_off = shofs + 32

            if size == 0:
                # 共享 sprite：无数据块，像素自 link 指向的上游拷贝（引擎 shareCopy）
                if link >= i:
                    raise ValueError("sprite %d(@%d) size=0 但 link=%d 无上游" % (i, shofs, link))
                src = sff.sprites[link]
                sp.pixels = src.pixels
                sp.size = src.size
                sp.encoding, sp.bpl = 0, 0
                sp.block_len = 0
                sp.raw_block = b""
                sp.palette = None
                sff.sprites.append(sp)
                if nxt == 0 and i + 1 < num_sprites:
                    raise ValueError("sprite %d 后链提前结束" % i)
                shofs = nxt
                continue

            block_end = nxt if (nxt > block_off and nxt <= len(data)) else block_off + size
            blk = data[block_off:block_end]
            sp.block_len = len(blk)
            sp.raw_block = blk

            if blk[0] != 0x0A:
                raise ValueError("sprite %d(@%d) 块首非 PCX magic: %02x" % (i, block_off, blk[0]))
            encoding, bpp = blk[2], blk[3]
            if bpp != 8:
                raise ValueError("sprite %d 非 8bpp" % i)
            x1, y1, x2, y2 = struct.unpack_from("<HHHH", blk, 4)
            w, h = x2 - x1 + 1, y2 - y1 + 1
            bpl = struct.unpack_from("<H", blk, 66)[0]
            sp.encoding, sp.bpl, sp.size = encoding, bpl, (w, h)
            data_start = 128

            # RLE 缓冲取到块尾（含尾部调色板字节）——与引擎 paletteSame 路径一致，
            # 解码到 w*h 即停，尾部多余字节不消费
            rle = blk[data_start:]
            if encoding == 1:
                sp.pixels = bytearray(SffV1._pcx_rle_decode(rle, w, h, bpl))
            else:
                px = bytearray(w * h)
                for r_ in range(h):
                    px[r_ * w:(r_ + 1) * w] = rle[r_ * bpl:r_ * bpl + w]
                sp.pixels = px

            # 内嵌调色板：识别块尾两种布局 [RLE][0x0C][768] / [RLE][768][0x0C]；
            # 引擎 paletteSame 语义下非首帧沿用上游调色板，此处同样继承
            sp.palette = None
            if len(blk) >= 769:
                if blk[len(blk) - 769] == 0x0C:
                    sp.palette = blk[len(blk) - 768:]
                elif blk[-1] == 0x0C:
                    sp.palette = blk[len(blk) - 769:-1]

            if i == 0:
                base_palette = sp.palette
            sff.sprites.append(sp)
            if nxt == 0 and i + 1 < num_sprites:
                raise ValueError("sprite %d 后链提前结束" % i)
            shofs = nxt
        sff.base_palette = bytearray(base_palette) if base_palette else None
        return sff

    @staticmethod
    def _pcx_rle_decode(buf, w, h, bpl):
        """逐行 PCX RLE 解码，行为对齐引擎 RlePcxDecode：行边界只重置列计数，
        不补写像素（补写会造成整图逐行右移的斜移伪影）"""
        out = bytearray(w * h)
        i, j, k = 0, 0, 0
        total = w * h
        while j < total:
            d = buf[i]
            i += 1
            n = 1
            if d >= 0xC0:
                n = d & 0x3F
                d = buf[i]
                i += 1
            while n > 0:
                if k < w and j < total:
                    out[j] = d
                    j += 1
                k += 1
                if k == bpl:
                    k = 0
                    break
                n -= 1
        return out

    # ================= 调色板 =================
    def palette_of(self, i):
        sp = self.sprites[i]
        return sp.palette if sp.palette is not None else self.base_palette

    def base_rgb_list(self):
        pal = self.base_palette
        return [(pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2]) for k in range(1, 256)]

    def remap_base_palette(self, mapping):
        """按 {idx: (r,g,b)} 重映射基础调色板。返回需要重编码的 sprite 序号集合
        （仅 (0,0) 的块尾调色板被引擎 legacy 路径读取，其余块尾被 paletteSame 忽略）"""
        pal = bytearray(self.base_palette)
        for idx, rgb in mapping.items():
            pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2] = rgb
        self.base_palette = pal
        edited = set()
        for i, sp in enumerate(self.sprites):
            if sp.group == 0 and sp.number == 0:
                sp.palette = bytes(pal)
                edited.add(i)
        return edited

    def used_indices(self):
        """全文件已使用的调色板索引集合（惰性缓存；为 portrait 分配空闲色槽用）"""
        if self._used_cache is not None:
            return self._used_cache
        used = set()
        for sp in self.sprites:
            for v in sp.pixels:
                if v:
                    used.add(v)
        self._used_cache = used
        return used

    # ================= 导出 =================
    def export_frames(self, outdir, only=None, scale=1, use_base_pal=True):
        """导出 PNG。use_base_pal=True 时统一用 sprite(0,0) 的调色板（= 引擎内实际表现）"""
        os.makedirs(outdir, exist_ok=True)
        index = []
        for i, sp in enumerate(self.sprites):
            if only and (sp.group, sp.number) not in only:
                continue
            pal = self.base_palette if use_base_pal else self.palette_of(i)
            im = sp.decode_rgba(pal)
            if scale != 1:
                im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
            fp = os.path.join(outdir, "g%03d_i%03d.png" % (sp.group, sp.number))
            im.save(fp)
            index.append({
                "file": os.path.basename(fp),
                "group": sp.group, "number": sp.number,
                "axis": list(sp.axis), "size": list(sp.size),
                "embedded_pal": sp.palette is not None,
            })
        with open(os.path.join(outdir, "sprites.json"), "w", encoding="utf-8") as f:
            json.dump({"count": len(self.sprites), "frames": index}, f,
                      ensure_ascii=False, indent=1)
        return index

    def contact_sheet(self, out_path, groups=None, per_group=12, cell=150, cols=8,
                      pick=None):
        """抽样拼图。pick: [(group,number), ...] 精确选帧；否则每 group 前 per_group 帧"""
        if pick:
            want = {tuple(p): None for p in pick}
            entries = [sp for sp in self.sprites if (sp.group, sp.number) in want]
        else:
            by_group = {}
            for sp in self.sprites:
                if groups and sp.group not in groups:
                    continue
                by_group.setdefault(sp.group, []).append(sp)
            entries = []
            for g in sorted(by_group):
                entries += by_group[g][:per_group]
        if not entries:
            raise ValueError("没有可展示的 sprite")
        rows = (len(entries) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cell, rows * (cell + 13)), (32, 36, 44, 255))
        dr = ImageDraw.Draw(sheet)
        for k, sp in enumerate(entries):
            im = sp.decode_rgba(self.base_palette)
            im.thumbnail((cell - 4, cell - 4), Image.NEAREST)
            cx, cy = (k % cols) * cell, (k // cols) * (cell + 13)
            sheet.alpha_composite(im, (cx + (cell - im.width) // 2, cy + (cell - im.height) // 2))
            dr.text((cx + 2, cy + cell), "%d,%d %dx%d" % (sp.group, sp.number, *sp.size),
                    fill=(220, 225, 235, 255))
        sheet.save(out_path)
        return out_path

    # ================= 编辑 =================
    def replace_pixels_from_rgba(self, i, im_rgba):
        """RGBA → 索引（近邻映射到基础调色板），写回 sprite i 像素。尺寸须一致。"""
        sp = self.sprites[i]
        if im_rgba.size != sp.size:
            raise ValueError("sprite %d 尺寸 %s ≠ 输入 %s" % (i, sp.size, im_rgba.size))
        pal_list = self.base_rgb_list()
        px = sp.pixels
        w, h = sp.size
        src = im_rgba.convert("RGBA").load()
        cache = {}
        for y in range(h):
            for x in range(w):
                r, g, b, a = src[x, y]
                if a < 8:
                    px[y * w + x] = 0
                    continue
                key = (r >> 3, g >> 3, b >> 3)
                best = cache.get(key)
                if best is None:
                    bd = 1 << 30
                    best = 1
                    for idx, (pr, pg, pb) in enumerate(pal_list, start=1):
                        d = (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb)
                        if d < bd:
                            best, bd = idx, d
                            if d == 0:
                                break
                    cache[key] = best
                px[y * w + x] = best

    def replace_sprite_rgba(self, i, im_rgba, slot_start=32, edited=None):
        """替换 sprite i 的像素为 RGBA 图（缩放到该 sprite 尺寸）。
        颜色近邻映射到基础调色板；若指定 slot_start，则把图的主色
        （PIL 自适应量化）填入空闲索引槽，保证 portrait 色彩质量。
        返回 edited 集合（含调色板所在的 (0,0)）。"""
        edited = edited if edited is not None else set()
        sp = self.sprites[i]
        w, h = sp.size
        im = im_rgba.convert("RGBA").resize((w, h), Image.LANCZOS)
        if slot_start:
            # 已用索引 → 空闲槽位
            used = self.used_indices()
            avail = sorted(idx for idx in range(1, 256) if idx not in used)
            if len(avail) < 16:
                raise ValueError("空闲调色板槽位不足（%d 个）" % len(avail))
            slots = avail[:192]
            ncol = len(slots)
            # 按空闲槽位数自适应量化
            q = im.convert("RGB").quantize(colors=ncol, method=Image.MEDIANCUT)
            qpal = q.getpalette()[:ncol * 3]
            # 更新基础调色板（(0,0) 的块尾调色板是全文件真源）
            pal = bytearray(self.base_palette)
            for c, idx in enumerate(slots):
                pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2] = qpal[c * 3:c * 3 + 3]
            for j, s0 in enumerate(self.sprites):
                if s0.group == 0 and s0.number == 0:
                    s0.palette = bytes(pal)
                    edited.add(j)
            # 像素映射：透明→0，色→其槽位
            rgba = im.load()
            px = bytearray(w * h)
            qidx = q.load()
            for y in range(h):
                for x in range(w):
                    if rgba[x, y][3] < 128:
                        continue
                    px[y * w + x] = slots[qidx[x, y]]
            sp.pixels = px
            self._used_cache = getattr(self, "_used_cache", used)
            self._used_cache.update(slots)
        else:
            self.replace_pixels_from_rgba(i, im)
        edited.add(i)
        return edited

    # ================= 写回 =================
    def save(self, path, edited=None):
        """
        重建 SFF v1。edited: sprite 序号集合——其像素被改过，以 raw PCX 重编码；
        其余原样拷贝 raw_block。块尾内嵌调色板一律保留原字节。
        """
        edited = edited or set()
        blocks = []
        for i, sp in enumerate(self.sprites):
            if i not in edited:
                blocks.append(sp.raw_block if sp.raw_block is not None else b"")
                continue
            # raw 重编码：PCX 头(encoding=0) + 逐行像素（按 bpl 填充）+ [0x0C+调色板]
            w, h = sp.size
            bpl = w + (w & 1)
            out = bytearray()
            out.append(0x0A)          # PCX magic（引擎兼作 paletteSame 标志，保持 0x0A）
            out.append(5)             # PCX version
            out.append(0)             # encoding = raw
            out.append(8)             # bpp
            out += struct.pack("<HHHH", 0, 0, w - 1, h - 1)
            out += struct.pack("<HH", 72, 72)   # hres/vres
            out += b"\x00" * 48       # palette16（引擎不解析）
            out += b"\x00"            # reserved @64
            out += struct.pack("<B", 1)         # planes @65
            out += struct.pack("<H", bpl)       # bpl @66-67
            out += b"\x00" * (128 - len(out))
            px = sp.pixels
            for r_ in range(h):
                out += px[r_ * w:(r_ + 1) * w]
                if bpl > w:
                    out += b"\x00" * (bpl - w)
            if sp.palette is not None:
                out.append(0x0C)
                out += sp.palette
            blocks.append(bytes(out))

        starts = []
        pos = struct.unpack_from("<I", self.header_bytes, 24)[0]
        for blk in blocks:
            starts.append(pos)
            pos += 32 + len(blk)

        out = bytearray(self.header_bytes)
        for i, blk in enumerate(blocks):
            sp = self.sprites[i]
            nxt = starts[i + 1] if i + 1 < len(blocks) else 0
            out += struct.pack("<IIHHHHH", nxt, len(blk),
                               sp.axis[0], sp.axis[1], sp.group, sp.number, sp.link)
            out += b"\x00" * 14   # 子头共 32B（18B 已写字段 + 14B 引擎不解析）
            out += blk

        with open(path, "wb") as f:
            f.write(bytes(out))
        return len(out)

    # ================= 工具 =================
    def find(self, group, number):
        for i, sp in enumerate(self.sprites):
            if sp.group == group and sp.number == number:
                return i
        return -1

    def stats(self):
        groups = {}
        for sp in self.sprites:
            groups[sp.group] = groups.get(sp.group, 0) + 1
        return groups


def main():
    import argparse
    ap = argparse.ArgumentParser(description="SFF v1 工具（对齐 IKEMEN GO image.go）")
    ap.add_argument("sff")
    ap.add_argument("cmd", choices=["info", "export", "sheet"])
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("-g", "--groups", default=None, help="逗号分隔 group")
    ap.add_argument("-s", "--scale", type=int, default=1)
    args = ap.parse_args()
    sff = SffV1.load(args.sff)
    if args.cmd == "info":
        g = sff.stats()
        print("sprites=%d groups=%d 基础调色板=%s" % (
            len(sff.sprites), len(g),
            "有" if sff.base_palette else "无"))
        for k in sorted(g):
            print("  group %3d: %d 帧" % (k, g[k]))
    elif args.cmd == "export":
        only = None
        if args.groups:
            gs = {int(x) for x in args.groups.split(",")}
            only = {(sp.group, sp.number) for sp in sff.sprites if sp.group in gs}
        idx = sff.export_frames(args.out or "frames", only=only, scale=args.scale)
        print("exported %d frames → %s" % (len(idx), args.out or "frames"))
    elif args.cmd == "sheet":
        groups = [int(x) for x in args.groups.split(",")] if args.groups else None
        print(sff.contact_sheet(args.out or "sheet.png", groups=groups))


if __name__ == "__main__":
    main()
