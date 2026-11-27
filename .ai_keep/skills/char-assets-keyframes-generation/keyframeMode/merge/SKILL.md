---
name: keyframe-mode-merge
description: 把 char-assets-keyframes-generation 产出的 10 张 AI 整帧关键帧，组装成「融合关键帧」变体角色包（AI 图与原精灵逐像素合成，一起显示；特效帧等本来就没有人像的不融合），并在 ff-studio 查看器里提供 merge 模式预览。当用户要求「融 / 融合关键帧 / AI 图和原精灵融合 / merge 模式」时使用。核心是构建期烘焙合成精灵 —— MUGEN 帧行一次只能画一个精灵。
---

# keyframe-mode-merge（融合关键帧变体包组装）

## Purpose

「融」的定义（用户原话）：

> **AI 图和原精灵融合一起显示，特效帧等本来就没有人像的就不要融合。**

即：AI 整帧以半透明叠在原精灵上 —— 两者的**姿势、明暗、配色**都能看出来，
既有原动画的动作连贯性，又有 AI 的角色形象。

与另外两种模式的区别：

| | all（全替） | some（抽） | **merge（融，本技能）** |
|---|---|---|---|
| 每帧显示什么 | 只有 AI 图 | 代表帧=AI 图，其余=原精灵 | **原精灵 + AI 图（叠加）** |
| 原动画的姿势 | 丢失 | 保留（除代表帧） | **完全保留** |
| 原动画的明暗 | 丢失 | 保留（除代表帧） | **完全保留** |
| 精灵数量 | 10 张 | 10 张 + 白模全留 | **799 张合成精灵** |
| 包体大小 | +0.3MB | +0.3MB | **+5.9MB**（9.75MB 总计） |

## 关键技术前提：为什么必须「烘焙」

MUGEN 的 air 帧行格式是 `<group>, <index>, <x>, <y>, <time>` ——
**一次只能画一个精灵**，没有「两个精灵叠加」的表达力。

所以「AI 图 + 原精灵一起显示」**只能在构建期合成为一张图**，
运行时就跟普通精灵一样（视觉等价，代价是包体变大、构建变慢）。

合成公式（对应查看器的 merge 预览）：

```
out.rgb = ai.rgb × (aiAlpha × MERGE_ALPHA) + body.rgb × (1 − aiAlpha × MERGE_ALPHA)
out.a   = max(bodyAlpha, aiAlpha)
```

`MERGE_ALPHA = 0.55`（查看器的 `state.aiMergeAlpha` 同值，可调）。

## 特效帧判定（用户明确要求）

「特效帧等本来就没有人像的不要融合」 —— 判定规则：

1. **精灵 group ≥ 7000** → 特效/Helper 段（爆炸、飞行道具、火焰）。
   MUGEN 惯例里 7000 以上是 helper 段，cns 里用 `helper` / `id = 7500` 直接引用。
   → **不融合**，保持原精灵。
2. **整个 action 全是特效帧**（纯特效 action）→ **不融合**。
   LinYu 底座里这样的 action 有 8 个：9400 / 9410 / 9500~9504 / 8090。
3. 其余（身体精灵帧）→ 融合。

实测 LinYu 底座里**没有任何 action 同时含身体帧和特效帧**，
所以规则 2 其实是规则 1 的冗余保险（换底座时可能有混合 action）。

### 几何对齐

AI 图按**原精灵的内容高度**缩放（这样每帧的融合图大小跟原帧一致），
内容中心与原精灵内容中心对齐、内容底边与原精灵内容底边对齐。

融合画布 = 原精灵内容包围盒 ∪ AI 图矩形；**锚点沿用原精灵的锚点**（加上画布偏移），
所以 air 的帧偏移（x/y）不用改。

## Process

### Step 1 — 组装

```powershell
$T = ".zcode/skills/char-assets-keyframes-generation/keyframeMode/merge/templates"
node "$T/build-merge-char.mjs" `
  "ikemen-fs/file/chars/LinYu" `
  "ikemen-fs/file/chars/LinYu/keyframes/keyframes" `
  ".cache/mg-build/LinYuKFM" `
  LinYuKFM
```

可选第 6 个参数：融合不透明度（默认 0.55），第 7 个参数：原精灵权重（默认 1）。

⚠️ **底座目录里有多个 def/sff 时必须用环境变量显式指定**，否则脚本会按字母序选错
（踩过：`LaoLeiKFM` 底座里有 `LaoLeiKFM.def` / `RalfAct.def` / `ikari.def` 三个）：

```powershell
$env:BASE_SFF = "Athena-98.sff"
$env:BASE_AIR = "Athena-98.air"
$env:BASE_DEF = "98Athena.def"
node "$T/build-merge-char.mjs" `
  "ff-studio/white-mold/04_异能者/98Athena" `
  ".cache/ai-frames/苏晚晴" `
  ".cache/mg-build/SuWanqingKFM" `
  SuWanqingKFM 0.95 0.2
```

**批量重建**（一次改十几个包时用这个，自带硬判据，不过就不安装）：

```powershell
node ".zcode/skills/char-assets-keyframes-generation/templates/rebuild-merge-batch.mjs" plan.json --dry
```

脚本做三件事：
1. **逐 (精灵, 类别) 组合**生成合成精灵 —— 同一精灵可能出现在不同类别的
   action 里，各类别合成结果不同（AI 图不一样），所以要分开生成
   （LinYu 是 636 个身体精灵 → 804 个「精灵×类别」组合，成功 799 张）；
2. **sff**：原字节全保留，末尾追加合成精灵（group 6100..6898，
   每张自带 256 色调色板 → 彩色不会被白模的灰度 `.act` 染掉）；
3. **air**：身体帧行改指向合成精灵；**特效帧行原样不动**（原位替换，
   CRLF / Clsn / 注释一字不改）。

### Step 2 — 解码原精灵：必须按引擎口径（2026-11-25 二次修复，最重要的一步）

「融」的质量完全取决于**原精灵解出来是什么样**。这里踩过两个坑，
症状是游戏里/查看器里出现「大面积纯色方块 + 彩色杂斑」：

**坑 A：调色板拿错（ps!=0 的精灵被扫假 0x0C）**

SFF v1 的 `ps` 字节（子头 +18）语义，引擎两条路径不一样：

| 路径 | 规则 |
|---|---|
| 对局渲染 `Sprite.read` | `ps!=0` → **沿用上一精灵的调色板**（`s.palidx = prev.palidx`）；`ps==0` → 自己块尾的调色板 |
| 选人屏预载循环 `sffv1PalState` | `state%2==0` 就重读文件调色板（appending ACT 用） |

`Lin.sff` 的 `0,1/0,2/0,3` 是 `ps=1`（沿用 0,0 的调色板），**块尾还带 157 字节尾部数据**，
RLE 流的像素字节里也含有 `0x0C`。如果对这类精灵也执行「从块尾往前扫 0x0C」，
就会撞到假标记，读出一整块垃圾调色板 → 解成 `#c3000b(红) / #0bc700(绿) / #c208c3(品红)`
→ 融合图里那块**大红方块**就是这么来的。

正确做法：**只有 `ps==0` 的精灵才扫 0x0C；`ps!=0` 一律沿用上一精灵**。

**坑 B：RLE 流被截断（下半身多出幻影不透明像素）**

引擎对 `ps!=0` 的精灵把像素流读到**块尾**（`rleSize = blockEnd - pcxDataStart`），
只有 `ps==0` 才停在 `0x0C` 标记处。解码器若一律停在 `0x0C`，
少读 128+ 字节 RLE，解出来的下半身会多出上千个「不存在的不透明像素」
（`0,1` 实测 4623 px，引擎真值 2965 px）。这些幻影被烘进合成精灵 →
游戏里角色身下出现一个**黑色方块**（原包是没有的，因为原包这些像素是透明的）。

**坑 C：白模精灵要吃 `.act`，不是内嵌调色板**

引擎对局里普通精灵显示的是 def 的 `pal1`（白模的灰度 `.act`）。
合成图必须按「玩家实际看到的颜色」烘焙，所以解码 body 时传 `pal1`：

```js
const ACT_PAL = readPaletteFile(fs.readFileSync(path.join(baseCharDir, def.pal1)));
// 自带调色板的精灵（ps==0，如 AI 精灵）用自己那块；其余用 ACT
const ownPal = !!(baseSff.sprites.get(tgtG + ',' + tgtN) || {}).ownPal;
body = spriteRgba(baseSffBuf, baseSff, tgtG, tgtN, ownPal ? null : ACT_PAL);
```

**坑 D：解码器有两份**

`ff-studio/src/viewer.html` 里有一份**独立**的 SFF 解码器（浏览器端解码 sprite 用），
它跟 `server/lib/sff.cjs` 是两份代码。修了服务端不改 viewer → 查看器的「融」预览照样错色。
两边必须同时改，改完用下面这条验证「两边解码结果逐像素一致」：

```powershell
node .cache/scripts/probe-viewer-decode.mjs 9391
# 在 viewer 页面里跑它自己的 spriteRgba，与服务器结果对拍（不透明像素数/颜色数/前几个颜色）
```

**坑 E：写出的 SFF 精灵「宽度为奇数就隐形」（2026-11-26，苏晚晴 KFM 实测）**

症状：**游戏里角色开局就消失**，但 ff-studio 查看器里完全正常，看不出任何问题。

根因（引擎 `src/image.go`）：

```go
// readPcxHeader：只有 encoding==1（RLE）才把 bpl 存进 s.rle；raw(encoding=0) 时 s.rle = 0
if encoding == 1 { s.rle = int(bpl) } else { s.rle = 0 }
// RlePcxDecode：s.rle<=0 时原样返回字节流 → px 长度 = rleSize = bpl*h
// SetPxl：if len(px) != Size[0]*Size[1] { return }   ← 纹理不生成 → 精灵隐形，且不报错
```

`Size = w*h`，而 raw 模式下 `px` 长度 = `bpl*h`。
**所以 `bpl` 必须严格等于 `w`，绝不能补偶数。**

本项目原来的写出器是 `bpl = w + (w & 1)`（PCX 惯例补偶），
→ **所有奇数宽的合成精灵被引擎静默丢弃**。
苏晚晴 KFM 的站立 action 0 的 8 张合成精灵宽全是奇数（71/69/71…）→ 开局进站立循环人就消失。

**为什么查看器看不出来**：查看器（`server/lib/sff.cjs` 和 viewer 自己那份）按 `bpl`
跨距读行（`px[y*bpl+x]`），多出来的补齐字节被忽略 → 画面正常。
**查看器正常 ≠ 引擎正常**，这类「引擎静默丢弃」的缺陷只有实机才能发现。

修法（写出器，`sff-append.cjs` 的 `buildOwnPalBlock` 和 `sprite-pack.cjs` 的 `buildSffV1`）：

```js
const bpl = w;   // 不能是 w + (w & 1)
```

**验收判据（必做，不能只看日志）** —— 引擎对丢弃的精灵**不打任何日志**，
所以必须静态复检 + 实机同帧对比：

```powershell
# 1) 静态复检：按引擎口径算出「会被丢弃的精灵数」，必须为 0
node ../../templates/diag-engine-drop.cjs <包>/<id>.sff
#    输出「保留 N 引擎丢弃 M」—— M 必须是 0

# 2) 实机同帧对比：抓同一引擎帧号的图，坏包角色区是空白、好包有人形
node ../../templates/capture-exact-frame.mjs <out.png> 9399 8100 <id> <id> 120
node ../../templates/ascii-region.cjs <out.png> 0.22 0.42 0.32 0.90
```

已有的坏包可以用外科工具修（只重排 SFF 精灵链，AIR / def 一字不动）：

```powershell
node ../../templates/fix-sff-bpl.cjs <包>/<id>.sff
```

### Step 2.5 — 处理三类失败

| 情况 | 数量（LinYu） | 处理 |
|---|---|---|
| 精灵**完全透明**（没有可融合的东西） | 0（修好坑 B 后为 0） | 跳过，保持原样 |
| **共享块**（size=0，靠 link 指向别的精灵） | 7 | 解引用到目标精灵解码，但**锚点用共享块自己的** |
| 精灵在 sff 里**根本不存在** | 5 | 跳过（引擎本来也会报缺精灵） |

共享块的坑：项目解码器 `server/lib/sff.cjs` 的 `spriteRgba()` 只解 v2 的共享块，
v1 的共享块（Lin.sff 里有 45 个）要自己解引用：

```js
let sp = byKey.get(g + ',' + n);
while (sp && sp.size === 0 && hops < 64) sp = byIdx[sp.link];
// 解 sp 指向的精灵，但 ax/ay 用原来的 sp
```

### Step 3 — 装进引擎目录 + 资产集目录

```powershell
Copy-Item -Recurse ".cache/mg-build/LinYuKFM" "ikemen-fs/file/chars/LinYuKFM"
Copy-Item -Recurse ".cache/mg-build/LinYuKFM" "workshops/.../map_design/<故事>/chars/LinYuKFM"
node .cache/scripts/rebuild-manifest.mjs
```

⚠️ **资产集侧必须有 `chars/<id>/`** —— 服务端 `packCharMetas()` 只遍历资产集目录
下的角色（`server/lib/packs.cjs` 的 `packCharDirs`），引擎目录里的收不到。

### Step 4 — 写变体的 char.json

```json
{
  "charId": "LinYuKFM",
  "displayName": "林羽",
  "roleType": "player",
  "profession": "武道家",
  "keyframeMode": "merge",
  "keyframeLabel": "融合关键帧",
  "variantOf": "LinYu",
  "mergeAlpha": 0.55
}
```

`variantOf` 是**存档迁移的依据**（Step 6）。

### Step 5 — 接进运行时

1. `mapping.json` 的 `charPool` 加入变体 id（不加的话 `packCharPool()` 不含它，
   `defCharacterAssets` 校验失败 → 退回随机分配）；
2. `index.html` 的 `MUGEN` 表加一条，让选人屏显示中文名而不是 charId：

```js
LinYuKFM: { glyph: '羽', cn: '林羽', tag: '武道家', style: '融合关键帧 · AI 帧与原精灵叠加' },
```

3. **两个目录都要改**：`workshops/.../map_design/<故事>/` 和 `assets/assetpacks/<id>/`

### Step 6 — 存档迁移

`index.html` 的 `migrateSavedCharId()` 已在抽关键帧那轮加好：
存档绑的包 + `defCharacterAssets` 指向的包是同一角色的不同版本
（后者 `char.json` 的 `variantOf` === 前者）→ 自动迁移。

### Step 7 — 查看器的 merge 模式（已实现，可直接用）

`ff-studio/src/viewer.html`：
- 顶栏「关键帧模式」下拉加了 `<option value="merge">融（AI 帧与原精灵叠加显示）</option>`
- 「资产标记」下拉加了 `<option value="merge">融合关键帧</option>`
- 渲染逻辑：先画原精灵，再把 AI 图以 `globalAlpha = state.aiMergeAlpha` 叠上去
- 特效帧不融：新增 `isEffectFrame()` / `isPureEffectAction()` / `shouldMergeFrame()`
- 状态栏标注「· AI关键帧(stand)+原精灵 · 已融合」/「· 特效帧不融合」/「· 纯特效不融合」

服务端配套：`server/lib/packs.cjs` 的 `writeCharMeta()` 校验加上 `'merge'`，
`index.html` 的 `keyframeModeOf()` 与绑定视图的标签也要认 `'merge'`。

## Verification

### 逐帧颜色数（最直观的判据）

`node .cache/scripts/diag-anim-colors.mjs 220` —— 抓 `/api/anim/<id>/<action>`
的每帧 PNG 统计颜色数：

| 变体 | action 220（轻拳）各帧颜色数 |
|---|---|
| LinYu（白模） | 14 14 14 14 13 13 13 13 14 14 14 |
| LinYuKF（抽） | 14 **255** 14 14 13 13 13 13 14 14 14 |
| **LinYuKFM（融）** | **255 255 255 255 255 255 255 255 255 255 255** |
| LinYuKFA（全） | 255 255 255 255 255 255 255 255 255 255 255 |

判读：白模每张精灵只有 ≤16 色；AI 图/合成图自带 255 色调色板，所以「融/全」都是 255。
**不能只看颜色数上限**，还要看调色板头部是不是灰度开场（错的包会是 `(195,0,11)(11,199,0)`
这种饱和色打头），以及目检 PNG：

```powershell
# 合成精灵直接导 PNG 目检（灰底填充透明区）
node .cache/scripts/diag-merge-input.cjs      # 合成前 body/ai/merged/quant 四张对照
```

### 饱和度直方图（证明是「混合」而非「替换」）

融合帧的像素饱和度分布：**彩色约 45% + 灰度约 55%** ——
AI 图的彩色被半透明稀释，原精灵的灰度结构还在。

### 两种透明度语义（已抽离成独立脚本）

融合有两种**互斥**的透明度语义，几何完全一样，差别只在像素怎么算。
2026-11-26 抽离成独立脚本（几何与混合公式抽到 `merge-core.cjs` 共用）：

| 模式 | 脚本 | 原帧 | AI 帧 | 效果 |
|---|---|---|---|---|
| **虚化** | `merge-alpha.cjs` | 100%（不做任何透明处理） | 55% | 只把 AI 权重混进 RGB，**mask 不动** → 无挖空、无碎片、边缘干净 |
| **二值碎片** | `merge-binary.cjs` | 20%（可调） | 95% | 重叠区按相对权重烘进 RGB；body-only 像素用 **4×4 Bayer 抖动**模拟淡显 → **方块小碎片** |

构建脚本第 8 个参数选模式：

```powershell
node "$T/build-merge-char.mjs" <base> <frames> <out> <id> <mergeAlpha> <bodyAlpha> <mode>
# mode: alpha（虚化，默认）| binary（二值碎片）
# 不传时按 bodyAlpha 自动选（<1 → binary，否则 alpha），与历史行为一致
```

#### 为什么 v1 的「虚化」不是真半透明

SFF v1 的调色板只有**二值**透明（alpha<128 → 索引 0 透明）。
真的写 55% alpha → 那部分像素索引变 0 → **整片挖空**，不是虚化。
所以 v1 下能落地的最接近形态是「颜色层面的淡化」：AI 帧按权重混进原帧 RGB，
输出仍是不透明的索引色。

引擎的 SFF **v2** 支持 format 11/12 = RGBA PNG（`image.go:1430` → `SetRaw(...,32)`），
能真逐像素 alpha。但项目里**没有 v2 写出器**，且底座包是 v1 ——
v1 底座 + v2 合成精灵的混编规则要另定，所以本轮不做。

#### 关于「碎片」

「碎片」**不是刻意设计的美术效果**，而是二值透明下模拟淡显的必然手段
（SFF v1 没有逐像素 alpha，想让 body-only 像素半透明只能抖动）。
`bodyAlpha=1` 时不抖动 → 无碎片。

实测对比（`templates/diag-two-modes.cjs`，孤立像素 = 碎片特征）：

```
虚化 AI55/原100        不透明 2551 | 孤立像素    0 = 0.0%   ← 无碎片
二值 AI95/原20(抖动)   不透明 1547 | 孤立像素  308 = 20.2% ← 碎片
二值 AI95/原20(不抖动) 不透明 2551 | 孤立像素    0 = 0.0%   ← 无碎片
二值 AI95/原100        不透明 2551 | 孤立像素    0 = 0.0%
```

⚠️ 换底座时如果发现「原帧成了方块小碎片」，那是 `bodyAlpha<1` 走抖动分支的结果，
不是 bug。要「不碎片的淡显」→ 用虚化模式（`mode=alpha`）。

### 特效帧没被融合

```powershell
node "$T/build-merge-char.mjs" ...
# 融合判定：
#   身体帧行 → 合成 1599
#   特效帧行 → 保持原样 91
# 写 air … 改写帧行 1591（另有 8 行指向不存在的精灵，跳过）
```

### 引擎实测

```powershell
bsk navigate "http://localhost:8100/?mode=practice&auto=1&ai=0&p1=LinYuKFM&p2=LinYuKFM&t=<ts>"
bsk console --session <id> --tab-id <tab> --limit 200 | grep -iE "missing sprite|not found"
```

无 `Animation missing sprite` 报错，日志里有 `LinYuKFM's state ...` 确认加载的是变体包。

### 截图目检（必须做，日志查不出颜色错）

```powershell
node .cache/scripts/probe-shot.mjs .cache/shots-mergefix shot.png "http://localhost:8100/?auto=1&p1=LinYuKFM&p2=LinYu&ai=0" 9391 26000
# 再用 sharp 把角色区域裁出来放大看
```

**验收标准**：角色身上**没有大面积纯色方块**（红/黑都算）、没有彩色杂斑；
能同时看出「灰色白模的姿势」+「AI 图的黑发/深色卫衣」。
两边对照着看更省力：`p2=LinYu`（白模）应该干净得没有任何方块。

## Output

| 产物 | 位置 |
|---|---|
| 融合变体包（sff 9.75MB / air 84KB / def / cns / cmd / snd / act） | `ikemen-fs/file/chars/<id>KFM/` + `map_design/<故事>/chars/<id>KFM/` |
| 变体 `char.json`（`keyframeMode: "merge"` + `variantOf`） | 同上 |
| 资产集元信息 | `mapping.json`（charPool）+ `roster.json`（defCharacterAssets），两个目录各一份 |
| 引擎 manifest | `ikemen-fs/manifest.json`（stamp 递增） |
| 查看器 merge 模式 | `ff-studio/src/viewer.html` |
| 组装脚本 | `keyframeMode/merge/templates/build-merge-char.mjs`（skill 目录内可直接跑） |
| 合成核心库 | `.cache/scripts/lib/merge-sprite.cjs` |

## Reference Templates

`templates/` 下的脚本**可直接运行**（路径自包含，从任意目录调用都行）：

| 文件 | 用途                                                                            |
|---|---------------------------------------------------------------------------------|
| `templates/build-merge-char.mjs` | 组装脚本（第 8 参数选 `alpha` / `binary` 模式）                                 |
| `templates/merge-core.cjs` | **共用核心**：几何对齐（包围盒/缩放/AI 图定位）+ 相对权重混合公式               |
| `templates/merge-alpha.cjs` | **虚化模式**（`mergeAlpha`）：原帧 100%，只混 RGB，mask 不动                    |
| `templates/merge-binary.cjs` | **二值碎片模式**（`mergeBinary`）：原帧可调不透明度，bodyAlpha<1 → Bayer 抖动   |
| `templates/merge-binary.cjs` | **二值虚化模式**（`mergeBinary`）：原帧可调不透明度，bodyAlpha<1 → Bayer 不抖动 |
| `templates/merge-sprite.cjs` | 兼容 shim（`mergeSprites`）：按 bodyAlpha 自动选模式。新代码别用它              |
| `templates/air-some.cjs` | air 解析 + 类别映射（**`ACTION_CATEGORY` 表必须按包核对**）                     |
| `templates/sff-append.cjs` | SFF v1 追加器                                                                   |a
| `templates/sprite-pack.cjs` | PNG 编解码 + 量化（依赖）                                                       |

另有 `templates/diag-two-modes.cjs`（在技能根目录的 `templates/`）——
对比两种模式的像素统计与碎片特征。

## Notes

1. **变体包而不是改原包**：白模底座要留着（对照、其它模式复用），
   `char.json` 的 `variantOf` 建立关系，存档自动迁移。
2. **`ACTION_CATEGORY` 表是包相关的**：换底座必须重查（查 cns 的 `anim = N`）。
   号段惯例在 LinYu 上是错的（5000 系是受击不是倒地，1200/1250 是走位不是空中）。
3. **合成精灵数量 = 唯一身体精灵 × 出现的类别数**：LinYu 是 636 × → 804 个组合，
   成功 799 张（5 个精灵不存在）。包体 +5.9MB。
4. **`MERGE_ALPHA` 决定融合观感**：0.55 是折中（AI 形象清晰 + 原姿势仍可辨）。
   调大会更像「全替」，调小会更像「抽」。查看器和构建脚本要同步改。
5. **特效帧判定靠 group ≥ 7000**：换底座要重新核对哪些 group 是 helper 段
   （本项目用 `air-some.cjs` 的 `HELPER_GROUP_MIN`）。
6. **`.gitignore` 排除了 `ikemen-fs/file/chars/` 和 `workshops/`** ——
   角色包二进制不在版本控制内。换机器要重跑构建脚本。
7. **引擎零改动**：全在数据层（SFF/AIR）。
8. **「融」不能只做运行时**：MUGEN 没有双精灵叠加的表达力，
   任何"运行时叠加"的实现都要改引擎 —— 烘焙是唯一稳妥的路。
9. **先修解码器再做融合包**：融合包会把解码器的错误**永久烘进 pol 里**
   （错调色板 → 纯色方块；截断的 RLE → 幻影不透明像素）。
   验收顺序固定为：① 解码原精灵与引擎逐像素对拍（不透明像素数一致）
   → ② 合成图目检 → ③ 构建包 → ④ 引擎截图目检。
10. **白模包的「废区」其实是透明的**：`Lin.sff` 的下半带看着像近黑填充，
   但按引擎口径 RLE 解出来是 index 0（透明）。解码器截断 RLE 才会把它当成不透明色块
   —— 别按「废区要裁剪」的思路去改，先对齐引擎的 `rleSize`。
11. **引擎会「静默丢弃」非法精灵**：精灵尺寸与像素流长度对不上时，
   `SetPxl` 直接 return，纹理不生成 → **精灵隐形，且全程零日志**。
   症状是「角色开局就消失」，而 ff-studio 查看器完全正常。
   所以「精灵不见了」的第一件事是跑 `diag-engine-drop.cjs` 静态复检数据合法性，
   而不是查渲染 / 查解码器。详见坑 E。
12. **PCX 惯例在 MUGEN 引擎里不适用**：`bpl`（bytes per line）在 raw 模式下
   **必须 = w**，不能补偶数。引擎拿 `bpl*h` 当字节数跟 `w*h` 比。
13. **黑盒判据必须同帧对比**：舞台有背景动画时逐帧 diff 全是噪声
   （实测同组内两帧自比就有 33%）。要抓**同一个引擎帧号**对齐相位再比。

## 相关示例

- [examples.md](examples.md)：
  - 「2026-11-25 二次修复：纯色方块 + 彩色杂斑」= 解码器的调色板与 RLE 截断问题
  - 「2026-11-26 三次修复：角色『开局就消失』」= 写出器 `bpl` 缺陷导致引擎静默丢弃