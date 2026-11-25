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
| 精灵数量 | 10 张 | 10 张 + 白模全留 | **777 张合成精灵** |
| 包体大小 | +0.3MB | +0.3MB | **+5.7MB**（9.6MB 总计） |

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

可选第 6 个参数：融合不透明度（默认 0.55）。

脚本做三件事：
1. **逐 (精灵, 类别) 组合**生成合成精灵 —— 同一精灵可能出现在不同类别的
   action 里，各类别合成结果不同（AI 图不一样），所以要分开生成
   （LinYu 是 636 个身体精灵 → 804 个「精灵×类别」组合）；
2. **sff**：原字节全保留，末尾追加 777 张合成精灵（group 6100..6876，
   每张自带 256 色调色板 → 彩色不会被白模的灰度 `.act` 染掉）；
3. **air**：身体帧行改指向合成精灵；**特效帧行原样不动**（原位替换，
   CRLF / Clsn / 注释一字不改）。

### Step 2 — 处理两类失败

| 情况 | 数量（LinYu） | 处理 |
|---|---|---|
| 精灵**完全透明**（白模包的废区精灵，如 `192,20` 21×13） | 22 | 跳过，保持原样（没有可融合的东西） |
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

`/api/anim/<id>/<action>` 返回每帧 PNG，统计每帧颜色数：

| 变体 | action 220（轻拳）各帧颜色数 |
|---|---|
| LinYu（白模） | 157 162 161 154 135 134 135 136 143 153 156 |
| LinYuKF（抽） | 149 **996** 164 147 134 128 133 139 144 149 160 |
| **LinYuKFM（融）** | **1140 1165 1138 1123 1062 1035 1035 1022 1149 1139 1050** |
| LinYuKFA（全） | 979 979 979 979 979 979 979 979 979 979 984 |

**融的特征：每帧都是 ~1100 色**（AI 配色 + 原灰度混合），
既不是白模的 ~150，也不是全替的单一 979。

### 饱和度直方图（证明是「混合」而非「替换」）

融合帧的像素饱和度分布：**彩色 45.4% + 灰度 54.6%** ——
AI 图的彩色被半透明稀释，原精灵的灰度结构还在。

### 特效帧没被融合

```powershell
node -e "…parseAir…"
# 身体帧行 → 合成 1599
# 特效帧行 → 保持原样 91
```

### 引擎实测

```powershell
bsk navigate "http://localhost:8100/?mode=practice&auto=1&ai=0&p1=LinYuKFM&p2=LinYuKFM&t=<ts>"
bsk console --session <id> --tab-id <tab> --limit 200 | grep -iE "missing sprite|not found"
```

无 `Animation missing sprite` 报错，日志里有 `LinYuKFM's state ...` 确认加载的是变体包。

## Output

| 产物 | 位置 |
|---|---|
| 融合变体包（sff 9.6MB / air 84KB / def / cns / cmd / snd / act） | `ikemen-fs/file/chars/<id>KFM/` + `map_design/<故事>/chars/<id>KFM/` |
| 变体 `char.json`（`keyframeMode: "merge"` + `variantOf`） | 同上 |
| 资产集元信息 | `mapping.json`（charPool）+ `roster.json`（defCharacterAssets），两个目录各一份 |
| 引擎 manifest | `ikemen-fs/manifest.json`（stamp 递增） |
| 查看器 merge 模式 | `ff-studio/src/viewer.html` |
| 组装脚本 | `.cache/scripts/build-merge-char.mjs` |
| 合成核心库 | `.cache/scripts/lib/merge-sprite.cjs` |

## Reference Templates

`templates/` 下的脚本**可直接运行**（路径自包含，从任意目录调用都行）：

| 文件 | 用途 |
|---|---|
| `templates/build-merge-char.mjs` | 组装脚本 |
| `templates/merge-sprite.cjs` | 逐像素合成核心（`mergeSprites`） |
| `templates/air-some.cjs` | air 解析 + 类别映射（**`ACTION_CATEGORY` 表必须按包核对**） |
| `templates/sff-append.cjs` | SFF v1 追加器 |
| `templates/sprite-pack.cjs` | PNG 编解码 + 量化（依赖） |

## Notes

1. **变体包而不是改原包**：白模底座要留着（对照、其它模式复用），
   `char.json` 的 `variantOf` 建立关系，存档自动迁移。
2. **`ACTION_CATEGORY` 表是包相关的**：换底座必须重查（查 cns 的 `anim = N`）。
   号段惯例在 LinYu 上是错的（5000 系是受击不是倒地，1200/1250 是走位不是空中）。
3. **合成精灵数量 = 唯一身体精灵 × 出现的类别数**：LinYu 是 636 × → 804 个组合，
   去掉 22 个全透明废区后剩 777 张。包体 +5.7MB。
4. **`MERGE_ALPHA` 决定融合观感**：0.55 是折中（AI 形象清晰 + 原姿势仍可辨）。
   调大会更像「全替」，调小会更像「抽」。查看器和构建脚本要同步改。
5. **特效帧判定靠 group ≥ 7000**：换底座要重新核对哪些 group 是 helper 段
   （本项目用 `air-some.cjs` 的 `HELPER_GROUP_MIN`）。
6. **`.gitignore` 排除了 `ikemen-fs/file/chars/` 和 `workshops/`** ——
   角色包二进制不在版本控制内。换机器要重跑构建脚本。
7. **引擎零改动**：全在数据层（SFF/AIR）。
8. **「融」不能只做运行时**：MUGEN 没有双精灵叠加的表达力，
   任何"运行时叠加"的实现都要改引擎 —— 烘焙是唯一稳妥的路。