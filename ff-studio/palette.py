# -*- coding: utf-8 -*-
"""
ff-studio/palette.py — MUGEN 调色板（.act）与 SFF 调色板工具

IKEMEN GO 引擎读 .act 的规则（image.go readActPalette，实测 Lin*.act 验证）：
- act 文件按 **倒序** 映射：文件第 i 个三元组 → 调色板索引 255-i
- 即 palette[i] = act[(255-i)*3 : (255-i)*3+3]（RGB 顺序）
- palette[0] = 透明（引擎对 index 0 着 alpha=0）

用法：
  python palette.py dump <act文件>            # 查看已用色（标注紫系）
  python palette.py remap <in.act> <out.act>  # 按 build_linyu_remap 规则改色
"""
import sys

# act = 768B RGB 三元组；palette[i] 对应 act 偏移 (255-i)*3


def load_act(path):
    """读 act → 256 色列表 [(r,g,b), ...]（已转为正序 palette 索引）"""
    data = open(path, "rb").read()
    if len(data) < 768:
        raise ValueError("act 文件不足 768B: %s" % path)
    pal = []
    for i in range(256):
        off = (255 - i) * 3
        pal.append((data[off], data[off + 1], data[off + 2]))
    return pal


def save_act(path, pal):
    """256 色正序 palette → act（倒序写出）"""
    if len(pal) != 256:
        raise ValueError("palette 必须是 256 色")
    out = bytearray(768)
    for i, (r, g, b) in enumerate(pal):
        off = (255 - i) * 3
        out[off], out[off + 1], out[off + 2] = r, g, b
    with open(path, "wb") as f:
        f.write(bytes(out))


def is_purple(r, g, b):
    """紫/蓝紫系判定（衣服主色）：蓝最强、红次之、绿最弱"""
    return b > g and r > g and (b - g) >= 12 and (r - g) >= 8


def build_linyu_remap(pal):
    """林羽配色重映射：仅改衣服色阶（低区紫系），特效区（16+）不动。
    衣服紫 → 深灰黑卫衣（保持明度层次）；最亮紫 idx13 → 金色数据流点缀。
    目标索引基于 Lin*.act 实测：6/7/8/13/14 = 衣服主体与阴影。"""
    out = [(r, g, b) for r, g, b in pal]
    if len(out) > 14:
        out[6] = (88, 92, 100)     # 灰紫 → 亮灰（衣服高光）
        out[7] = (62, 66, 74)      # 紫灰 → 中灰
        out[8] = (34, 36, 42)      # 深紫 → 深灰黑
        out[13] = (214, 164, 62)   # 亮紫 → 金色（数据流点缀）
        out[14] = (44, 48, 55)     # 紫 → 暗灰
    return out


def stats(pal):
    used = [(i, c) for i, c in enumerate(pal) if c != (0, 0, 0)]
    return used


def main():
    import argparse
    ap = argparse.ArgumentParser(description="MUGEN act 调色板工具（IKEMEN 倒序规则）")
    ap.add_argument("cmd", choices=["dump", "remap"])
    ap.add_argument("act")
    ap.add_argument("out", nargs="?", default=None)
    args = ap.parse_args()
    pal = load_act(args.act)
    if args.cmd == "dump":
        used = stats(pal)
        print("非零色 %d 个（前 32）：" % len(used))
        for i, (r, g, b) in used[:32]:
            print("  idx=%3d rgb=(%3d,%3d,%3d)%s" % (i, r, g, b, "  ←紫" if is_purple(r, g, b) else ""))
    else:
        new = build_linyu_remap(pal)
        save_act(args.out, new)
        print("remapped → %s（紫系 %d 色已重映射）" % (
            args.out, len([1 for i, c in enumerate(pal) if is_purple(*c) and i != 0])))


if __name__ == "__main__":
    main()
