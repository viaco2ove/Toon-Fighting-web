---
name: keyframe-mode-all
description: 把 char-assets-keyframes-generation 产出的 10 张 AI 整帧关键帧，组装成「全替关键帧」变体角色包（每个 action 的所有身体帧都用该类别的 AI 整帧，特效帧保持原样）。当用户要求「全替 / 全替换关键帧 / all 模式 / 整个动作都用 AI 帧」时使用。核心是 air 全局重映射 + sff 追加带自有调色板的 AI 精灵。
---

# keyframe-mode-all（全替关键帧变体包组装）

## Purpose

「全」的定义：**每个 action 的每一帧都用该类别的 AI 整帧**。

效果是「贴纸人物」—— 动作的连贯性靠 AI 图本身的姿势承担，不是原动画。
观感上人物在每个动作里都保持同一个姿势（只有上下移动），
但角色形象最统一、最容易辨认。

## 与旧版 `build-ai-char.mjs` 的区别（重要）

项目里已有一个 `.cache/scripts/build-ai-char.mjs`（配合 `air-remap.cjs`），
但它有两个会出问题的地方：

| | 旧版 build-ai-char.mjs | 本技能 |
|---|---|---|
| sff 内容 | 只保留 AI 精灵 + helper，**丢弃全部白模身体精灵** | **白模精灵一个不少**（AI 追加在文件尾） |
| AI 精灵 group | group 0（**会覆盖白模的 0..3 站立循环**） | 空闲 group 6000..6009 |
| 特效帧 | helper 行原样保留 ✓ | 特效帧行原样保留 ✓ |

丢弃白模精灵的后果：如果特效帧（或某个 action）引用了白模精灵，
就会「Animation missing sprite」→ 引擎报错。
本版保留全部原精灵，air 只改写身体帧行 → 不会缺精灵。

## 关键技术前提

同 [keyframeMode/some](../some/SKILL.md)：SFF v1 每个精灵可自带调色板
（子头 **+18** 的 `ps` 字节 = 0 表示自带，块尾 `0x0C` 后跟 768 字节 RGB），
白模沿用 def 的 `.act` 灰度调色板、AI 精灵自带彩色调色板 → 两者共存。

AI 精灵**不能放 group 0**（白模占了 0..3 站立循环）。

## Process

### Step 1 — 组装

```powershell
$T = ".zcode/skills/char-assets-keyframes-generation/keyframeMode/all/templates"
node "$T/build-all-char.mjs" `
  "ikemen-fs/file/chars/LinYu" `
  "ikemen-fs/file/chars/LinYu/keyframes/keyframes" `
  ".cache/all-build/LinYuKFA" `
  LinYuKFA
```

脚本做三件事：
1. **10 张 AI 图**按参照帧（manifest 的 `refSprite`）的几何缩放、量化，
   各自带 255 色调色板；
2. **sff**：原字节全保留，末尾追加 10 个 AI 精灵（group 6000..6009）；
3. **air**：所有**身体帧行**改指向 AI 精灵；**特效帧行原样不动**
   （原位替换，CRLF / Clsn / 注释一字不改）。

### Step 2 — 装进引擎目录 + 资产集目录

```powershell
Copy-Item -Recurse ".cache/all-build/LinYuKFA" "ikemen-fs/file/chars/LinYuKFA"
Copy-Item -Recurse ".cache/all-build/LinYuKFA" "workshops/.../map_design/<故事>/chars/LinYuKFA"
node .cache/scripts/rebuild-manifest.mjs
```

⚠️ 资产集侧必须有 `chars/<id>/` —— 服务端 `packCharMetas()` 只遍历资产集目录。

### Step 3 — 写变体的 char.json

```json
{
  "charId": "LinYuKFA",
  "displayName": "林羽",
  "roleType": "player",
  "profession": "武道家",
  "keyframeMode": "all",
  "keyframeLabel": "全替关键帧",
  "variantOf": "LinYu"
}
```

### Step 4 — 接进运行时

1. `mapping.json` 的 `charPool` 加入变体 id；
2. `index.html` 的 `MUGEN` 表加一条：

```js
LinYuKFA: { glyph: '羽', cn: '林羽', tag: '武道家', style: '全替关键帧 · 整个动作都用 AI 帧' },
```

3. 两个目录都要改：`workshops/.../map_design/<故事>/` 和 `assets/assetpacks/<id>/`

### Step 5 — 存档迁移

`index.html` 的 `migrateSavedCharId()` 已实现（见 some 技能），
`variantOf` 建立关系后，存档会自动跟到变体。

## Verification

### 逐帧颜色数

`/api/anim/<id>/<action>` 每帧的颜色数：

| 变体 | action 220（轻拳）各帧颜色数 |
|---|---|
| LinYu（白模） | 157 162 161 154 135 134 135 136 143 153 156 |
| LinYuKF（抽） | 149 **996** 164 147 134 128 133 139 144 149 160 |
| LinYuKFM（融） | 1140 1165 1138 1123 1062 1035 1035 1022 1149 1139 1050 |
| **LinYuKFA（全）** | **979 979 979 979 979 979 979 979 979 979 984** |

**全的特征：每帧颜色数几乎相同**（同一动作里都指向同一张 AI 图）。

⚠️ 984 那个略高的是最后一帧 —— 它可能落在别的类别（比如 action 220 的
某一帧被分类到别的类别），属正常。

### 引擎实测

```powershell
bsk navigate "http://localhost:8100/?mode=practice&auto=1&ai=0&p1=LinYuKFA&p2=LinYuKFA&t=<ts>"
bsk console --session <id> --tab-id <tab> --limit 200 | grep -iE "missing sprite|not found"
```

无 `Animation missing sprite` 报错。

## Output

| 产物 | 位置 |
|---|---|
| 全替变体包（sff 3.8MB / air 84KB / def / cns / cmd / snd / act） | `ikemen-fs/file/chars/<id>KFA/` + `map_design/<故事>/chars/<id>KFA/` |
| 变体 `char.json`（`keyframeMode: "all"` + `variantOf`） | 同上 |
| 资产集元信息 | `mapping.json`（charPool），两个目录各一份 |
| 引擎 manifest | `ikemen-fs/manifest.json`（stamp 递增） |
| 组装脚本 | `.cache/scripts/build-all-char.mjs` |

## Reference Templates

| 文件 | 用途 |
|---|---|
| `templates/build-all-char.mjs` | 组装脚本 |
| `templates/air-some.cjs` | air 解析 + 类别映射（**`ACTION_CATEGORY` 表必须按包核对**） |
| `templates/sff-append.cjs` | SFF v1 追加器 |
| `templates/sprite-pack.cjs` | PNG 编解码 + 量化（依赖） |

## Notes

1. **AI 图的几何基准**：用 manifest 里的 `refSprite`（白模代表帧）取它的
   内容高度与锚点关系 —— AI 图缩放到与白模代表帧同高、内容中心对齐、
   脚底齐平。`ay` 必须夹在 `[1, h]` 内（参照帧的 `ay` 可能等于 `h+1`）。
2. **同一动作内 AI 图尺寸必须稳定**：否则人物忽大忽小。所以统一用
   参照帧的高度，而不是每帧各自的高度。
3. **特效帧保持原样**：group ≥ 7000 的 helper/特效段（爆炸、飞行道具）
   本来就没有人像，全替也没意义 —— 保留原精灵。
4. **`ACTION_CATEGORY` 表是包相关的**：换底座必须重查（查 cns 的 `anim = N`）。
5. **`.gitignore` 排除了 `ikemen-fs/file/chars/` 和 `workshops/`** ——
   角色包二进制不在版本控制内。换机器要重跑构建脚本。
6. **引擎零改动**：全在数据层（SFF/AIR）。