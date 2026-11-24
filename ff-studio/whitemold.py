# -*- coding: utf-8 -*-
"""
ff-studio/whitemold.py —— 把 MUGEN 角色包转成「白模（素体）」

白模 = 身体是灰白人台，看不出原角色配色，但保留原有的明暗层次与体积感。
做法**只改调色板，不碰一个像素**：
  1) 外挂 .act 调色板（6 套）→ 逐槽位按亮度映射到灰阶；
  2) SFF v1 内嵌的基础调色板（sprite 0,0 块尾 768B）→ 同样灰阶化。

为什么必须两处都改（引擎侧依据）：
  - char.go loadPalettes() 的 SFFv1 分支是「**追加** ACT 调色板」而非覆盖，
    并把物理索引 0 重定向到第一个 ACT（Remap(0, targetIdx)）；
  - image.go 的 SFFv1 调色板状态机里，palState.state%2==0 的帧
    **强制从文件重读调色板**——这些帧若仍是彩色，就会「部分帧彩色、部分帧灰白」。

灰阶规则（对每个槽位）：
  v    = 0.299r + 0.587g + 0.114b        # Rec.601 亮度，保留原作者的明暗关系
  gray = clamp(round(v * 0.92), 12, 240)  # 0.92：最亮不到纯白；12：暗部不糊成黑
索引 0 保持 (0,0,0)：引擎把 index 0 当透明（alpha=0），动它整张图会花。

CLI:
  python ff-studio/whitemold.py grayscale-act <in.act> <out.act>
  python ff-studio/whitemold.py grayscale-sff <in.sff> <out.sff>
  python ff-studio/whitemold.py pack <srcPackDir> <outDir> [--keep-effects]
      —— 整包转换：拷 cns/air/cmd/snd，灰阶化 act 与 sff，生成 <outDir>/<charId>.def

注意：act 文件是**倒序**存储的 —— 文件第 i 个三元组 → palette[255-i]
（引擎 image.go readActPalette 实测验证，palette.py 同源实现）。
"""
import os
import shutil
import struct
import sys

SIGNATURE = b"ElecbyteSpr\x00"

# 灰阶映射参数
GRAY_SCALE = 0.92
GRAY_MIN = 12
GRAY_MAX = 240


def to_gray(r, g, b):
    """RGB → 灰阶（保留亮度层次）。"""
    v = 0.299 * r + 0.587 * g + 0.114 * b
    n = int(round(v * GRAY_SCALE))
    if n < GRAY_MIN:
        n = GRAY_MIN
    elif n > GRAY_MAX:
        n = GRAY_MAX
    return n


def grayscale_palette(pal):
    """pal: list[(r,g,b)] × 256（正序）→ 灰阶版。索引 0 保持不变（透明）。"""
    out = []
    for i, (r, g, b) in enumerate(pal):
        if i == 0:
            out.append((r, g, b))
            continue
        n = to_gray(r, g, b)
        out.append((n, n, n))
    return out


# ================= .act =================
def load_act(path):
    """读 act → 256 色列表（已转正序 palette 索引）。"""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 768:
        raise ValueError("act 文件不足 768B: %s" % path)
    pal = []
    for i in range(256):
        off = (255 - i) * 3
        pal.append((data[off], data[off + 1], data[off + 2]))
    return pal


def save_act(path, pal):
    """256 色正序 palette → act（倒序写出）。"""
    if len(pal) != 256:
        raise ValueError("palette 必须是 256 色")
    out = bytearray(768)
    for i, (r, g, b) in enumerate(pal):
        off = (255 - i) * 3
        out[off], out[off + 1], out[off + 2] = r, g, b
    with open(path, "wb") as f:
        f.write(bytes(out))


# ================= SFF v1 =================
def _read_sprite_chain(data):
    """遍历 SFF v1 的 sprite 链，返回每个精灵的子头信息。

    子头是 <IIHHHHH>（18B）：next(u32 绝对偏移)、size(u32)、x、y、group、number、link，
    之后 14 字节引擎不解析。**第 18 字节（子头偏移 +18）是 `ps`**：
    ps != 0 表示「沿用上游调色板」，ps == 0 表示「本帧自带调色板」。
    引擎在 image.go 的 SFFv1 分支里：
      - 读子头后 f.Seek(shofs+32) 读 1 字节 ps，再 f.Seek(-1,1) 退回
      - 故 ps 的绝对位置 = 子头偏移 + 18
    """
    if data[:12] != SIGNATURE:
        raise ValueError("不是 SFF 文件")
    if data[15] != 1:
        raise ValueError("仅支持 SFF v1（verhi=%d）" % data[15])
    num = struct.unpack_from("<I", data, 20)[0]
    shofs = struct.unpack_from("<I", data, 24)[0]
    out = []
    for i in range(num):
        nxt, size, _x, _y, group, number, link = struct.unpack_from("<IIHHHHH", data, shofs)
        ps = data[shofs + 18] if i > 0 else None
        block_off = shofs + 32
        if size == 0:
            out.append({"shofs": shofs, "block_off": block_off, "block_end": block_off,
                        "size": 0, "group": group, "number": number, "ps": ps})
            shofs = nxt
            continue
        block_end = nxt if (nxt > block_off and nxt <= len(data)) else block_off + size
        out.append({"shofs": shofs, "block_off": block_off, "block_end": block_end,
                    "size": size, "group": group, "number": number, "ps": ps})
        shofs = nxt
    return out


def _own_palette_span(sp, blk):
    """返回本精灵**自带**调色板的 (start, end)（相对块首），没有则 None。

    引擎规则（image.go read + sffv1PalState）：
      - ps != 0 → paletteSame=true → 调色板沿用上游，本帧没有自己的调色板；
      - ps == 0 → 引擎从块尾往前扫 0x0C 标记，命中处即调色板起点（标记后 1 字节）；
        扫不到就退化到 blockEnd-769。
    首帧 (0,0) 走 legacy 路径：paletteOffset = offset + datasize - 768（直接指向末尾 768B）。
    """
    size = sp["size"]
    if size == 0:
        return None
    if sp["group"] == 0 and sp["number"] == 0:
        # legacy：块末 768 字节（无 0x0C 标记）
        return (len(blk) - 768, len(blk))
    if sp["ps"] != 0:
        return None  # 沿用上游，没有自带调色板
    # ps == 0：从块尾往前扫 0x0C
    n = len(blk)
    lo = 128
    for pos in range(n - 769, lo - 1, -1):
        if blk[pos] == 0x0C:
            return (pos + 1, pos + 1 + 768)
    # 扫不到 → 退化到 blockEnd-769（引擎行为）
    return (n - 769, n - 1) if n >= 769 else None


def grayscale_sff_bytes(data):
    """返回 (新 bytes, 改了多少处)。**只改自带调色板的精灵**，像素原样保留。

    ⚠️ 绝不能对 ps!=0 的精灵动「块尾 768 字节」——那些位置是 RLE 数据，
    改了会破坏解码（实测：全量按块尾改会让 sff.py 解析报 IndexError）。
    """
    buf = bytearray(data)
    chain = _read_sprite_chain(data)
    changed = 0
    for sp in chain:
        if sp["size"] == 0:
            continue
        blk = bytes(buf[sp["block_off"]:sp["block_end"]])
        if not blk or blk[0] != 0x0A:
            continue  # 不是 PCX 块
        span = _own_palette_span(sp, blk)
        if not span:
            continue
        start, end = span
        if end - start != 768:
            continue
        pal = blk[start:end]
        newpal = bytearray()
        for k in range(256):
            r, g, b = pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2]
            if k == 0:
                newpal += bytes((r, g, b))   # index 0 = 透明，不能动
            else:
                n = to_gray(r, g, b)
                newpal += bytes((n, n, n))
        if bytes(newpal) != pal:
            buf[sp["block_off"] + start:sp["block_off"] + end] = newpal
            changed += 1
    return bytes(buf), changed


# ================= 整包转换 =================
def convert_pack(src, out, char_id="LinYu", displayname="LinYu", keep_effects=False):
    """把 src 目录的角色包转成白模包，落到 out。

    keep_effects=True 时**不动特效调色板**（灰阶化按 sprite group 分档做不了，
    因为 SFF v1 的调色板是整个文件共享的——所以这个开关只影响 .act 的处理策略说明）。
    """
    if not os.path.isdir(src):
        raise ValueError("源目录不存在: %s" % src)
    os.makedirs(out, exist_ok=True)

    # 源文件 → 目标文件名的映射（98Ryo 的原始文件名 → 项目内 Lin* 命名）
    #
    # 98Ryo 的 01_Main.cns **同时**含 [Data]/[Size]/[Velocity]/[Movement] 常量段
    # 和状态 40/50/52/105/106/180~195/5201/-2/-3。引擎侧是两份独立的读取：
    #   - `cns` 文件只被读常量段（char.go loadConstants 的 data/size/velocity/movement）
    #   - `st`/`stN` 文件才被编译成状态（compiler.go Compile 的 st 列表）
    # 所以同一个文件可以同时给 cns 和 st —— 原包 98Ryo.def 就是这么写的
    # （cns = 01_Main.cns 且 st = 01_Main.cns）。这里保持同样结构，不做拆分。
    CNS_MAP = [
        ("01_Main.cns", "Lin-N.st"),      # 常量段 + 常规状态（40/50/52/105/106/180~195/-2/-3）
        ("02_Attacks.cns", "Lin-S.st"),   # 攻击状态 200~430
        ("03_Specials.cns", "Lin-H.st"),  # 必杀 1000~1855
        ("04_DMs.cns", "Lin-Helper.st"),  # DM/投技 3000~4120
        ("05_Others.cns", "Lin-Override.st"),
    ]
    copied = []
    for src_name, dst_name in CNS_MAP:
        s = os.path.join(src, src_name)
        if not os.path.exists(s):
            continue
        d = os.path.join(out, dst_name)
        shutil.copyfile(s, d)
        copied.append(dst_name)

    for src_name, dst_name in (("98Ryo.air", "Lin.air"), ("98Ryo.cmd", "Lin.cmd"),
                                ("98Ryo.snd", "Lin.snd")):
        s = os.path.join(src, src_name)
        if os.path.exists(s):
            shutil.copyfile(s, os.path.join(out, dst_name))
            copied.append(dst_name)

    # SFF：灰阶化内嵌基础调色板
    sff_src = os.path.join(src, "98Ryo.sff")
    with open(sff_src, "rb") as f:
        sff_data = f.read()
    new_sff, nchanged = grayscale_sff_bytes(sff_data)
    with open(os.path.join(out, "Lin.sff"), "wb") as f:
        f.write(new_sff)
    copied.append("Lin.sff (调色板改 %d 处)" % nchanged)

    # .act：6 套灰阶
    pal_dir = os.path.join(src, "Pal")
    acts = []
    if os.path.isdir(pal_dir):
        acts = sorted(x for x in os.listdir(pal_dir) if x.lower().endswith(".act"))
    for i, act_name in enumerate(acts, start=1):
        pal = load_act(os.path.join(pal_dir, act_name))
        gray = grayscale_palette(pal)
        dst = os.path.join(out, "LinYu%d.act" % i)
        save_act(dst, gray)
        copied.append("LinYu%d.act (← %s)" % (i, act_name))

    # def：按目标包重新写
    def_text = """; Definition file for %s (%s)
; 白模（素体）包 —— 底座来自 98Ryo（坂崎亮 KOF98 风格，作者 Ehnyd）
; 本文件由 ff-studio/whitemold.py 生成；只改了调色板，像素/动画/判定均未改动。

[Info]
name = "%s"
displayname = "%s"
versiondate = 04,14,2002
mugenversion = 04,14,2002
author = "Ehnyd (98Ryo 原作者), 白模改造"
pal.defaults = 1
localcoord = 320,240

[Files]
cmd      = Lin.cmd
cns      = Lin-N.st
st       = Lin-N.st
st1      = Lin-S.st
st2      = Lin-H.st
st3      = Lin-Helper.st
st4      = Lin-Override.st
stcommon = common1.cns
sprite   = Lin.sff
anim     = Lin.air
sound    = Lin.snd
pal1     = LinYu1.act
pal2     = LinYu2.act
pal3     = LinYu3.act
pal4     = LinYu4.act
pal5     = LinYu5.act
pal6     = LinYu6.act
""" % (char_id, displayname, char_id, displayname)
    with open(os.path.join(out, "%s.def" % char_id), "w", encoding="utf-8", newline="\r\n") as f:
        f.write(def_text)
    copied.append("%s.def" % char_id)
    return copied


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "grayscale-act":
        pal = load_act(sys.argv[2])
        save_act(sys.argv[3], grayscale_palette(pal))
        print("灰阶化 act → %s" % sys.argv[3])
    elif cmd == "grayscale-sff":
        with open(sys.argv[2], "rb") as f:
            data = f.read()
        new, n = grayscale_sff_bytes(data)
        with open(sys.argv[3], "wb") as f:
            f.write(new)
        print("灰阶化 sff → %s（改 %d 处内嵌调色板）" % (sys.argv[3], n))
    elif cmd == "pack":
        copied = convert_pack(sys.argv[2], sys.argv[3])
        for c in copied:
            print("  ", c)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
