# -*- coding: utf-8 -*-
"""
white-mold-conversion 模板 —— 把 MUGEN 完整角色包转成灰白素体（白模）

使用前按 {{...}} 占位符填三处：FILE_MAP / PAL_FILES / DEF_TEMPLATE。
格式规则与引擎 image.go 逐行对齐；四个致命坑见技能 SKILL.md 的 Notes。

CLI:
  python whitemold.py probe <src.sff>            # ps 直方图 + 0x0C 命中统计（Step 2 必跑）
  python whitemold.py pack <srcPackDir> <outDir> # 整包转换
  python whitemold.py grayscale-act <in.act> <out.act>
  python whitemold.py grayscale-sff <in.sff> <out.sff>

依赖：Python 3.13 + Pillow（验证阶段另需项目的 server/lib/sff.cjs + Node 22）。
"""
import os
import shutil
import struct
import sys

# ============================================================
# {{FILE_MAP}}：源包文件 → 目标包文件名。按源包实际文件名填。
# 注意：
#   - cns 是 CRLF + Shift-JIS 混合，只能字节级改名拷贝，绝不重新编码；
#   - 若源包 cns 同时含 [Data]/[Size]/[Velocity]/[Movement] 常量段和状态段，
#     同一份文件可以同时给 def 的 cns= 和 st= （引擎两处分别只取所需，
#     char.go loadConstants 只读常量段，compiler.go Compile 只编译状态段）。
# ============================================================
FILE_MAP = [
    # (源文件名, 目标文件名, 用途注释)
    ("{{SRC_MAIN_CNS}}", "{{CHAR}}-N.st",        "常量段 + 常规状态"),
    ("{{SRC_ATTACKS_CNS}}", "{{CHAR}}-S.st",     "攻击状态"),
    ("{{SRC_SPECIALS_CNS}}", "{{CHAR}}-H.st",    "必杀状态"),
    ("{{SRC_DMS_CNS}}", "{{CHAR}}-Helper.st",    "DM/投技状态"),
    ("{{SRC_OTHERS_CNS}}", "{{CHAR}}-Override.st", "其余状态"),
    ("{{SRC_AIR}}", "{{CHAR}}.air",              "动画（原样，Clsn 判定保留）"),
    ("{{SRC_CMD}}", "{{CHAR}}.cmd",              "指令（原样）"),
    ("{{SRC_SND}}", "{{CHAR}}.snd",              "音效（原样）"),
]

# {{PAL_FILES}}：源 act 列表（按 pal.defaults 顺序）。目标一律平铺命名 <id>N.act，
# 不要放 Pal/ 子目录 —— VFS 大小写敏感（vfs.js norm() 不做 lower-case）。
PAL_SRC_DIR = "{{SRC_PAL_DIR}}"          # 如 "{{SRC}}/Pal"
PAL_SRC_FILES = ["{{SRC_01_ACT}}", "{{SRC_02_ACT}}"]  # 按源包实际数量

SFF_SRC = "{{SRC_SFF}}"                  # 源 sff 文件名（SFF v1）
CHAR_ID = "{{CHAR_ID}}"                  # ASCII 角色 id，如 LinYu
DISPLAYNAME = "{{DISPLAYNAME}}"          # 显示名，如 林羽
AUTHOR_CREDIT = "{{ORIGINAL_AUTHOR}}"    # 原作者署名，README/def 都要写

# ============================================================
# {{DEF_TEMPLATE}}：目标 def 内容。pal.defaults 指向最稳的一套配色。
# ============================================================
DEF_TEMPLATE = """; Definition file for {{CHAR_ID}} ({{DISPLAYNAME}})
; 白模（素体）包 —— 底座来自 {{SRC_PACK_NAME}}（作者 {{ORIGINAL_AUTHOR}}）
; 本文件由 white-mold-conversion 技能生成；只改了调色板，像素/动画/判定均未改动。

[Info]
name = "{{CHAR_ID}}"
displayname = "{{DISPLAYNAME}}"
versiondate = 04,14,2002
mugenversion = 04,14,2002
author = "{{ORIGINAL_AUTHOR}} (底座原作者), 白模改造"
pal.defaults = 1
localcoord = 320,240

[Files]
cmd      = {{CHAR}}.cmd
cns      = {{CHAR}}-N.st
st       = {{CHAR}}-N.st
st1      = {{CHAR}}-S.st
st2      = {{CHAR}}-H.st
st3      = {{CHAR}}-Helper.st
st4      = {{CHAR}}-Override.st
stcommon = common1.cns
sprite   = {{CHAR}}.sff
anim     = {{CHAR}}.air
sound    = {{CHAR}}.snd
{{PAL_LINES}}
"""

# ============================================================
# 灰阶参数
# ============================================================
GRAY_SCALE = 0.92    # 最亮不到纯白（避免黑底发光）
GRAY_MIN = 12        # 暗部不糊成黑、保住轮廓
GRAY_MAX = 240


def to_gray(r, g, b):
    v = 0.299 * r + 0.587 * g + 0.114 * b   # Rec.601 亮度，保留原作者明暗关系
    n = int(round(v * GRAY_SCALE))
    return max(GRAY_MIN, min(GRAY_MAX, n))


def grayscale_palette(pal):
    """pal: [(r,g,b)]×256（正序）→ 灰阶版。索引 0 不动（引擎当透明 alpha=0）。"""
    out = []
    for i, (r, g, b) in enumerate(pal):
        if i == 0:
            out.append((r, g, b))
            continue
        n = to_gray(r, g, b)
        out.append((n, n, n))
    return out


# ================= .act（倒序存储！）=================
def load_act(path):
    """act 文件第 i 个三元组 → palette[255-i]（引擎 readActPalette 实测口径）。"""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 768:
        raise ValueError("act 文件不足 768B: %s" % path)
    return [(data[(255 - i) * 3], data[(255 - i) * 3 + 1], data[(255 - i) * 3 + 2])
            for i in range(256)]


def save_act(path, pal):
    if len(pal) != 256:
        raise ValueError("palette 必须是 256 色")
    out = bytearray(768)
    for i, (r, g, b) in enumerate(pal):
        off = (255 - i) * 3
        out[off], out[off + 1], out[off + 2] = r, g, b
    with open(path, "wb") as f:
        f.write(bytes(out))


# ================= SFF v1 探查与改色 =================
SIGNATURE = b"ElecbyteSpr\x00"


def _read_sprite_chain(data):
    """遍历 sprite 链。子头 <IIHHHHH>(18B)+14B 尾巴；**第 18 字节是 ps**：
    ps==0 → 本精灵自带调色板；ps!=0 → 沿用上游（其块尾是 RLE 数据，不能碰）。"""
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
            out.append({"block_off": block_off, "block_end": block_off, "size": 0,
                        "group": group, "number": number, "ps": ps})
        else:
            block_end = nxt if (nxt > block_off and nxt <= len(data)) else block_off + size
            out.append({"block_off": block_off, "block_end": block_end, "size": size,
                        "group": group, "number": number, "ps": ps})
        shofs = nxt
    return out


def probe_pack(data):
    """Step 2 必跑：ps 直方图 + 调色板标记命中统计。用于确认规则而不是猜。"""
    chain = _read_sprite_chain(data)
    hist = {}
    ok0 = bad0 = fp = clean = 0
    for i, sp in enumerate(chain):
        hist[sp["ps"]] = hist.get(sp["ps"], 0) + 1
        if sp["size"] == 0:
            continue
        blk = data[sp["block_off"]:sp["block_end"]]
        if not blk or blk[0] != 0x0A or len(blk) < 769:
            continue
        marker = blk[len(blk) - 769]
        if sp["ps"] == 0:
            if marker == 0x0C:
                ok0 += 1
            else:
                bad0 += 1
        else:
            if marker == 0x0C:
                fp += 1     # 假阳性：块尾恰是 0x0C 的 RLE 数据，绝不能按块尾盲改
            else:
                clean += 1
    print("sprites:", len(chain), " ps 直方图:", hist)
    print("ps==0 且块尾-769=0x0C:", ok0, " ps==0 但无标记:", bad0,
          " ps!=0 假阳性(勿改!):", fp, " ps!=0 干净:", clean)
    return chain


def _own_palette_span(sp, blk):
    """自带调色板的 (start,end)，没有则 None。规则与引擎 image.go 一致：
    - 首帧 (0,0)：legacy 路径，块末 768B（无 0x0C 标记）；
    - ps==0：从块尾往前扫 0x0C，命中处 +1 起的 768B；扫不到退化 blockEnd-769；
    - ps!=0：沿用上游，无自带调色板。"""
    if sp["size"] == 0:
        return None
    if sp["group"] == 0 and sp["number"] == 0:
        return (len(blk) - 768, len(blk))
    if sp["ps"] != 0:
        return None
    n = len(blk)
    for pos in range(n - 769, 127, -1):
        if blk[pos] == 0x0C:
            return (pos + 1, pos + 1 + 768)
    return (n - 769, n - 1) if n >= 769 else None


def grayscale_sff_bytes(data):
    """只改自带调色板，像素原样保留。返回 (新 bytes, 改动处数)。"""
    buf = bytearray(data)
    changed = 0
    for sp in _read_sprite_chain(data):
        if sp["size"] == 0:
            continue
        blk = bytes(buf[sp["block_off"]:sp["block_end"]])
        if not blk or blk[0] != 0x0A:
            continue
        span = _own_palette_span(sp, blk)
        if not span or span[1] - span[0] != 768:
            continue
        start, end = span
        pal = blk[start:end]
        newpal = bytearray()
        for k in range(256):
            r, g, b = pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2]
            newpal += bytes((r, g, b)) if k == 0 else bytes((to_gray(r, g, b),) * 3)
        if bytes(newpal) != pal:
            buf[sp["block_off"] + start:sp["block_off"] + end] = newpal
            changed += 1
    return bytes(buf), changed


# ================= 整包转换 =================
def convert_pack(src, out):
    os.makedirs(out, exist_ok=True)
    copied = []
    for src_name, dst_name, _note in FILE_MAP:
        s = os.path.join(src, src_name)
        if os.path.exists(s):
            shutil.copyfile(s, os.path.join(out, dst_name))   # 字节级拷贝，不重编码
            copied.append(dst_name)
    with open(os.path.join(src, SFF_SRC), "rb") as f:
        data = f.read()
    new_sff, n = grayscale_sff_bytes(data)
    with open(os.path.join(out, CHAR_ID + ".sff"), "wb") as f:
        f.write(new_sff)
    copied.append("%s.sff（调色板改 %d 处）" % (CHAR_ID, n))
    pal_lines = []
    for i, act in enumerate(PAL_SRC_FILES, start=1):
        save_act(os.path.join(out, "%s%d.act" % (CHAR_ID, i)),
                 grayscale_palette(load_act(os.path.join(src, PAL_SRC_DIR, act))))
        pal_lines.append("pal%d     = %s%d.act" % (i, CHAR_ID, i))
        copied.append("%s%d.act（← %s）" % (CHAR_ID, i, act))
    def_text = (DEF_TEMPLATE
                .replace("{{PAL_LINES}}", "\n".join(pal_lines))
                .replace("{{CHAR}}", CHAR_ID)
                .replace("{{CHAR_ID}}", CHAR_ID)
                .replace("{{DISPLAYNAME}}", DISPLAYNAME)
                .replace("{{ORIGINAL_AUTHOR}}", AUTHOR_CREDIT)
                .replace("{{SRC_PACK_NAME}}", os.path.basename(src.rstrip("/\\"))))
    with open(os.path.join(out, CHAR_ID + ".def"), "w", encoding="utf-8", newline="\r\n") as f:
        f.write(def_text)
    copied.append(CHAR_ID + ".def")
    return copied


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "probe":
        with open(sys.argv[2], "rb") as f:
            probe_pack(f.read())
    elif cmd == "pack":
        for c in convert_pack(sys.argv[2], sys.argv[3]):
            print("  ", c)
    elif cmd == "grayscale-act":
        save_act(sys.argv[3], grayscale_palette(load_act(sys.argv[2])))
        print("→", sys.argv[3])
    elif cmd == "grayscale-sff":
        with open(sys.argv[2], "rb") as f:
            data = f.read()
        new, n = grayscale_sff_bytes(data)
        with open(sys.argv[3], "wb") as f:
            f.write(new)
        print("→ %s（改 %d 处）" % (sys.argv[3], n))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
