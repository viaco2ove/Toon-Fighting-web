# ff-studio — 角色资产制作工具链

纯 Python + Pillow，无构建步骤，直接跑。所有格式实现以引擎源码
`../Toon-WebMUGEN-2.0/ikemen-go-web/src/image.go` 为权威。

## 工具

### sff.py — SFF v1 贴图包读写

```powershell
python ff-studio\sff.py <file.sff> info                  # 精灵目录统计（group×帧数）
python ff-studio\sff.py <file.sff> export -o frames -g 0,20   # 导出 PNG + sprites.json
python ff-studio\sff.py <file.sff> sheet -o sheet.png -g 0,20 # contact sheet 拼图检查
```

Python API（见 `角色包制作流程.md` §5.2 的完整流程）：

- `SffV1.load(path)` — 解析（含 FF Studio 变体：numSprites@20、size==0 共享块、
  双调色板块尾布局、全块 RLE 缓冲）
- `export_frames / contact_sheet` — 导出检查
- `replace_pixels_from_rgba(i, im)` — 同尺寸 RGBA → 近邻映射回 256 色索引
- `replace_sprite_rgba(i, im, slot_start=None)` — 自动缩放的 portrait 替换
- `remap_base_palette({idx:(r,g,b)})` — 全局换装（改 (0,0) 调色板 = 全文件生效）
- `save(path, edited)` — 回写（编辑帧 raw 重编码，其余原样拷贝，链重算）

### palette.py — .act 调色板

```powershell
python ff-studio\palette.py dump Lin4.act               # 查看色板
python ff-studio\palette.py remap Lin4.act LinYu4.act   # 林羽配色重映射
```

IKEMEN 读 act 是**倒序**的：文件第 i 个三元组 → palette[255-i]（image.go
readActPalette，实测验证）。

## 已踩过的格式坑（改动前必读）

1. 子头是 `<IIHHHHH>`（18B）——少写一个 I，group/number 全体错位 2 字节
2. RLE 解码行边界只重置 k、不补写像素——补写 1 像素 = 整图斜移伪影
3. raw 重编码 PCX 头 128B 里 reserved@64 不能漏——漏 1 字节 planes/bpl 全错位
4. size==0 的 sprite 是共享块，像素自 link 上游拷贝（引擎 shareCopy）
5. (0,0) 的块尾调色板是引擎 legacy 路径读取的全文件真源；其余块尾被 paletteSame 忽略

## 踩坑后的产物位置约定

- 永久工具：`ff-studio/`（本目录）
- 临时脚本/实验产物：`.cache/ff-studio/`
- v0.1 原包备份：`.cache/ff-studio/LinYu-v01-backup/`

## 专门的角色资产查看和制作工具？
有，MUGEN 生态里有几款专门的查看/制作工具，按用途推荐：

**查看为主（轻量）**
- **VSelect**（tunglashor 出品）——纯 sprite 浏览器，双击打开 sff 就能按 group/number 浏览所有帧、看调色板，不能编辑。想快速翻一个角色包有什么素材，它最快
- **Ikemen GO debug 模式**——引擎自带 `Ctrl+C`（调色板切换）/`Ctrl+D`（debug 信息），对局内直接看

**制作/编辑（全能）**
- **Fighter Factory Studio 3.7**（VirtuallTek 官网免费下载，Patreon 赞助制）——目前最主流的角色制作 IDE：精灵编辑器（内置图像编辑）、AIR 动画编辑、CNS 语法高亮/校验、音效查看、甚至支持 M.U.G.E.N in-engine 调试。你包里 Lin.sff 的注释 "Made in VirtuallTek" 就是它写出来的。想交互式逐帧改图、调整画框（Clsn）、编排动画，用它
- **Fighter Factory 3.0.1**——老版免费款，MUGEN ARCHIVE 有存档，功能够用但界面老
- **MCM 2.0b**（Mugen Character Maker）——更老的免费制作器，Lin 包的 air 就是它写的，现在基本只用于怀旧

**本项目自有工具（程序化批处理）**
- `ff-studio\sff.py sheet -g 0,20,41` / `export` —— 命令行版查看器，批量导出和拼图检查比 GUI 快
- 贴头像、换配色、批量回写这类「程序化改造」，GUI 工具反而做不了（要一帧帧手点），这正是 ff-studio 存在的意义

建议组合：**日常查看用 VSelect 或 ff-studio sheet，交互式修图/编动画用 Fighter Factory Studio，批量改造（贴头/换色/量产 NPC 包）用 ff-studio 脚本**。

要我把 Fighter Factory Studio 3.7 下载装到本机吗？装好后可以直接用它打开 LinYu 包核对每一帧。