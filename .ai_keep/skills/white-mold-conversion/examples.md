# 示例：LinYu ← 98Ryo（坂崎亮 KOF98 风格）白模转换

> 2026-11-25 实际执行记录。源包 `ff-studio/white-mold/01_武道家/98Ryo`
> （作者 Ehnyd，SFF v1），目标 `chars/LinYu`（末世选择主角林羽，武道家）。

## Input

| 项 | 值 |
|---|---|
| 源包 | `ff-studio/white-mold/01_武道家/98Ryo/`（98Ryo.def / .sff 3.7MB / .air 80KB / .cmd / .snd / Pal/Ryo01-06.act） |
| 角色 id / 显示名 | `LinYu` / `林羽` |
| 资产集落盘 | `workshops/toon-fighting-web/map_design/末世选择，从解析神明开始成神/chars/LinYu/` |
| 引擎落盘 | `ikemen-fs/file/chars/LinYu/`（旧 v0.1 包先备份到 `.cache/linyu-v01-backup/`） |
| 灰阶参数 | scale=0.92, min=12, max=240（默认） |

## Step 1 核实源包

`sff.py info`：**777 精灵 / 131 组**、SFF v1、基础调色板有。98Ryo.def 的
`stcommon = common1.cns`（包内无此文件 → 引擎 fallback 到 `data/common1.cns.zss`）。
Statedef 分布：01_Main=常量段+40/50/52/105/106/180~195/5201/-2/-3，
02_Attacks=200~640，03_Specials=1000~1820，04_DMs=3000~3450，05_Others=350~913。
无跨文件状态号冲突。

## Step 2 ps 字节探查（关键转折）

探查脚本输出：

```
num sprites 777
ps histogram (byte@shofs+18): {None:1, 1:559, 0:217}
ps==0 sprites with 0x0C at end-769: 217  without: 0
ps!=0 sprites with 0x0C at end-769 (false positives): 8  without: 507
```

→ 规则确凿：**217 个 `ps==0` 精灵自带调色板（块尾-769 必有 0x0C 标记）**，
另有 8 个 `ps!=0` 精灵「碰巧」块尾-769 是 0x0C（RLE 数据的巧合），按块尾盲改必坏。

**踩坑实录**：第一版转换脚本按「块尾 768B」盲改了 705 处，把 RLE 数据当调色板改了，
产物用 `sff.py` 解析直接 `IndexError: index out of range`。改为按 ps 规则后
正好改 **218 处**（217 个 ps==0 + 首帧 0,0 的 legacy 调色板），解析通过。

## Step 3-4 转换与结构验证

```powershell
python ff-studio/whitemold.py pack "ff-studio/white-mold/01_武道家/98Ryo" ".cache/whitemold-out"
# → Lin.sff (调色板改 218 处) + LinYu1-6.act + 5 个 st + air/cmd/snd + LinYu.def
```

逐精灵对比（`tmp-verify.py`）：

```
sprites 777 -> 777
像素有差异的精灵数: 0
组数 131 -> 131 组键一致: True
组帧数一致: True
```

## Step 5 渲染核对

- PIL 渲染：`orig-0_0.png`（橙色道服坂崎亮）vs `gray-0_0.png`（灰白人台，明暗层次保留）；
- 项目解码器饱和度统计（`tmp-proof.cjs`，决定性证据）：

```
LinYu1.act 前 8 槽: (128,128,0) (228,228,228) (191,191,191) (160,160,160) …
LinYu（白模）: 0,0 / 0,1 / 20,0 / 21,0 / 300,0 / 410,0 灰占比全部 = 1.000
Lin（彩色对照）: 0,0 灰占比=0.248，20,0 灰占比=0.098
```

## Step 6 入库

- 产物拷入资产集 `chars/LinYu/`（保留原 `avatar/full.png` + `avatar/head.png`），
  再同步到 `ikemen-fs/file/chars/LinYu/`（旧 v0.1 Lin 骨架包整体替换，先备份）；
- `select.def` 两侧均有 `LinYu/LinYu.def` 行，无需新增，但资产集侧缺
  `LinYuAI/LinYuAI.def`（那是刻意不动的 AI 测试包）→ 以引擎侧为准；
- `rebuild-manifest.mjs`：401 文件、12 处变化、stamp local46 → **local47**；
- 资产集 manifest 用「引擎清单 ∩ 资产集实有文件」重写（376 条，LinYuAI 的 25 条
  不在资产集属预期），`select.def` 与 `headavatar.lua` 两处以引擎侧拷回后
  **字节数不符条目 = 0**；
- README.md 写明底座作者（Ehnyd）、授权口径、踩坑、下一轮 AI 整帧路线；
  原作者 Leeme.TXT 保留为 `README-upstream.txt`。

## Step 7 引擎实测

`node .cache/scripts/verify-linyu.mjs .cache/shots-linyu 9411`
（URL `?auto=1&p1=LinYu&p2=Lin&ai=4`，对照角色选彩色 Lin）：

```
PASS engine-running   {"frames":306}
PASS no-missing-sprite ""
PASS no-cns-error      （唯一命中是引擎无害的 "Executable not implemented for js"）
PASS facebar-on        {"faceText":"LLLinYuVS林林麟速度型"}
PASS linyu-in-match    HUD: "LinYu VS Lin"
PASS no-js-exception   []
```

对局截图 `v1-battle.png`：P1 = 灰白人台（道服剪影可辨、无彩色残留），
P2 = 彩色 Lin，头顶悬浮头像、facebar、血条全部正常。
TF_HEAD 坐标包照常输出（悬浮头像功能未受影响）。

## 产出清单

```
workshops/.../chars/LinYu/{LinYu.def, Lin-N.st, Lin-S.st, Lin-H.st, Lin-Helper.st,
  Lin-Override.st, Lin.air, Lin.cmd, Lin.sff, Lin.snd, LinYu1-6.act,
  README.md, README-upstream.txt, avatar/}
ikemen-fs/file/chars/LinYu/            （同上，运行副本）
ikemen-fs/manifest.json                （local47）
.ff-studio/whitemold.py                （永久工具，含 CLI：grayscale-act / grayscale-sff / pack）
.cache/linyu-v01-backup/               （旧包备份）
.cache/gray/                           （PIL 渲染对照图）
.cache/shots-linyu/                    （引擎实测截图）
```

## 关键设计点

1. **零像素改动**是整个方案的安全边界：轴点/AIR/Clsn/引擎兼容性与原包完全一致，
   后续 AI 整帧换身只换图不动画。
2. **灰阶按亮度映射**（而非一刀切灰色）保留了原作者的明暗关系，人台有体积感。
3. `ps` 字节规则必须**实测**（直方图 + 0x0C 命中统计）而不是照文档猜——
   本例 8 个假阳性就是证明。
4. `stcommon` 不造轮子：直接吃引擎 `data/common1.cns.zss` 的公共状态，
   角色 Statedef 与引擎公共状态号冲突时正状态号「后者覆盖」天然解决。
5. 98Ryo 无 `var(59)=1` AI 段 → 不跑 patch-char-ai.mjs（README 里写明）。
