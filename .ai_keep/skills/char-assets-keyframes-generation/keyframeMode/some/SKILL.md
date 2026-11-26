---
name: keyframe-mode-some
description: 把 char-assets-keyframes-generation 产出的 10 张 AI 整帧关键帧，组装成「抽关键帧」变体角色包（每个 action 只替换代表帧，其余帧保持白模原精灵），并接入运行时让选人屏与战斗界面真的看到抽帧效果。当用户要求「抽关键帧 / 抽帧替换 / some 模式 / 只换关键帧那一帧 / 白模包接 AI 帧」时使用。核心是 SFF v1 追加自带调色板的 AI 精灵 + air 原位替换代表帧。
---

# keyframe-mode-some（抽关键帧变体包组装）

## Purpose

`char-assets-keyframes-generation` 只做到「资产落盘」（10 张 AI 整帧 PNG 进 `chars/<id>/keyframes/`）。
**落盘的图引擎根本读不到** —— 引擎只认 sff 里的精灵和 air 里的帧行。
本技能把那些图真正装进引擎能跑的包里，并且是「抽」语义：

> **每个 action 只替换代表帧那一帧，其余帧保持白模原精灵。**

动作仍是原来的连贯动画，只有那一瞬间换成 AI 形象 —— 这才是「取代关键帧」的本来效果。

产物是一个**变体包** `chars/<id>KF/`（与白模包并存），运行时通过 `char.json` 的
`variantOf` 关系识别，存档里的旧绑定会自动迁移。

## 与「全替」（all）的区别

| | all（全替） | some（抽，本技能） |
|---|---|---|
| air 改写 | 每个 action 的**所有**帧行换成 AI 精灵 | 每个 action **只有 1 行**（代表帧）换成 AI 精灵 |
| sff 内容 | 只保留 AI 精灵 + helper（丢弃白模身体精灵） | **保留全部白模精灵** + 追加 AI 精灵 |
| 动画连贯性 | 断裂（所有帧都是同一张 AI 图的姿势） | 连贯（只有代表帧跳一下） |
| 判定 | Clsn 原样保留 | Clsn 原样保留 |
| 观感 | 「贴纸人物」 | 「本来的动作 + 一瞬间换了人」 |

## Input

**必填**

| 项 | 说明 |
|---|---|
| 白模角色包目录 | `ikemen-fs/file/chars/<id>/`（要有 .sff/.air/.act/.def） |
| 关键帧资产目录 | `map_design/<故事>/chars/<id>/keyframes/`（10 张 `NN-<key>.png` + manifest.json） |
| 变体 id | 如 `LinYuKF`（与白模 id 区分，避免覆盖底座） |

**可选**

| 项 | 默认 |
|---|---|
| AI 精灵 group | 自动找原包空着的连续 10 个 group（6000–6999 优先） |
| 代表帧选取 | 该 action 中**身体精灵内容高度最大**的那一帧（= 动作幅度最大的瞬间） |
| 类别映射 | 从目标包 cns 里实际引用的 anim 建表（见 Process Step 2） |

## 三个关键技术前提（搞错就做不出来）

### 1. SFF v1 每个精灵可以自带调色板

SFF v1 的调色板机制：**每个精灵可以带自己的调色板**。

- 精灵子头 +18 的 `ps` 字节 = **0** → 该精灵**自带调色板**（数据块尾 `0x0C` 标记后跟 768 字节 RGB）
- `ps` ≠ 0 → 沿用上一精灵的调色板

**为什么必须用它**：白模底座是灰度索引色，靠 def 的 `pal1`（`.act`）着色；
AI 帧是彩色，必须自带调色板。v1 一个文件只有一份「共享」调色板，
如果把 AI 图量化进白模的调色板，彩色会被染成灰色 —— 全替方案只能把
所有精灵共用一张全局调色板，代价就是画质掉。

引擎侧依据：`../Toon-WebMUGEN-2.0/ikemen-go-web/src/image.go`
（`paletteSame := ps != 0 && prev != nil`；`readSffv1Palette`）。

### 2. AI 精灵不能放 group 0

白模包几乎都占着 **group 0 的 index 0..3**（站立循环）。覆盖会让站立动作缺帧。
必须找原包**完全没用到**的 group。查法：

```powershell
node -e "const{readSffV1Dir}=require('./.cache/scripts/lib/sff-append.cjs');
const d=readSffV1Dir(require('fs').readFileSync('ikemen-fs/file/chars/LinYu/Lin.sff'));
const used=new Set(d.sprites.map(s=>s.group));
console.log('group0 已用:',d.sprites.filter(s=>s.group===0).map(s=>s.index).join(','));
console.log('6000-6999 空闲:',[...Array(7000).keys()].slice(6000,7000).filter(g=>!used.has(g)).slice(0,12).join(','));"
```

还要排除 **air 里引用过的** group（万一以后 air 指向它）。

### 3. air 改写必须「原位替换」

air 是 CRLF 换行的文本。用 `split(/\r?\n/)` 再 `join('\n')` 会把 **CRLF 变成 LF**，
文件结构就变了。必须：

1. 用正则定位帧行在**原文里的字节偏移**；
2. 只替换那一行的内容，其余字节（CRLF、注释、Clsn 行）一个不动。

⚠️ **帧行正则里的空白不能用 `\s`** —— `\s` 会匹配 `\r\n`，把换行符一起吃掉：

```js
// 错：^(\s*)(\d+)\s*,...
// 对：^([ \t]*)(\d+)[ \t]*,[ \t]*(\d+)...
```

## Process

### Step 1 — 复制白模包做变体

```powershell
node .cache/scripts/build-kf-char.mjs `
  "ikemen-fs/file/chars/LinYu" `
  "ikemen-fs/file/chars/LinYu/keyframes/keyframes" `
  ".cache/kf-build/LinYuKF" `
  LinYuKF
```

脚本做三件事：
1. **sff**：原字节全保留，末尾追加 10 个带自有调色板的 AI 精灵（`.cache/scripts/lib/sff-append.cjs`）
2. **air**：逐 action 只替换代表帧（`.cache/scripts/lib/air-some.cjs`）
3. **def / cns / cmd / snd / act**：复制并把 def 的 `name`/`displayname`/`sprite`/`anim` 指向新文件

### Step 2 — 类别映射必须按目标包 cns 核对

⚠️ **不要用猜的 MUGEN 号段惯例**。在 LinYu（98Ryo 底座）上实测，号段惯例是错的：

| action | 号段惯例认为 | cns 实际引用证明是 |
|---|---|---|
| 5000 / 5010 / 5020 | down（倒地） | **hurt**（受击，stateno 5000 触发音效） |
| 1200 / 1250 | air（空中） | **walk**（走位） |
| 1400 / 1450 | special | **起手/轻技** |

查法（`anim = N` 是 cns 里引用 action 的语法）：

```powershell
grep -a -o "anim *= *[0-9]*" "ikemen-fs/file/chars/LinYu/Lin-N.st" | grep -o "[0-9]*$" | sort -n | uniq
```

`-N.st` 是站立/受击/倒地、`-S.st` 是蹲/普通技、`-H.st` 是跳跃/必杀 ——
按文件归类就能得出「这个 action 属于哪类动作」。

`air-some.cjs` 里的 `ACTION_CATEGORY` 表就是照这个查出来的，
**换底座必须重查这张表**（表里的 action 号是包相关的）。

### Step 3 — 装进引擎目录 + 重建 manifest

```powershell
Copy-Item -Recurse ".cache/kf-build/LinYuKF" "ikemen-fs/file/chars/LinYuKF"
Copy-Item -Recurse ".cache/kf-build/LinYuKF" "workshops/.../map_design/<故事>/chars/LinYuKF"
node .cache/scripts/rebuild-manifest.mjs     # 引擎侧 manifest（stamp 递增）
```

⚠️ 资产集侧要有 `chars/<id>/` 目录，否则 `packCharMetas()` 收不到它的 `char.json`
（服务端只遍历资产集目录下的角色，见 `server/lib/packs.cjs` 的 `packCharDirs`）。

### Step 4 — 写变体的 char.json

```json
{
  "charId": "LinYuKF",
  "displayName": "林羽",
  "roleType": "player",
  "profession": "武道家",
  "keyframeMode": "some",
  "keyframeLabel": "抽关键帧",
  "variantOf": "LinYu",
  "variantNote": "「抽关键帧」变体包：sff = 原 Lin.sff 全部精灵 + 追加 10 个带自有彩色调色板的 AI 精灵；air = 逐 action 只替换代表帧。"
}
```

`variantOf` 是**存档迁移的依据**（Step 6）。

### Step 5 — 接进运行时

1. `mapping.json` 的 `charPool` 加入变体 id（否则 `packCharPool()` 不含它，
   `defCharacterAssets` 校验直接失败 → 退回随机分配）；
2. `roster.json` 把该角色的 `defCharacterAssets` 改成变体 id；
3. 两份都要改：`workshops/.../map_design/<故事>/` 和 `assets/assetpacks/<id>/`
   （`packMeta` 会读前者，但登记目录也可能被用到）。

### Step 6 — 存档迁移（不改这一步，用户看到的还是旧包）

用户之前存过 roster，绑的是旧包（`LinYu`）。改了 `defCharacterAssets` 之后，
存档不会自动跟着变 → 表现为「标记了抽关键帧但看不出效果」。

`index.html` 的 `migrateSavedCharId()` 处理这个：

```
存档绑的包 + defCharacterAssets 指向的包 是同一角色的不同版本
（后者 char.json 的 variantOf === 前者）→ 迁移到后者
其它情况（用户手动换过角色）→ 保留存档
```

### Step 7 — 修服务端调色板覆盖（否则选人屏中间看不到颜色）

`server/lib/anim.cjs` 原来给**所有**精灵套 def 的 `.act`：

```js
// 错：AI 精灵自带彩色调色板，被灰度 act 覆盖 → 变灰
img = spriteRgba(buf, sff, f.grp, f.idx, pal);

// 对：只有不带自有调色板的精灵才套 act
const ownPal = !!(sp0 && sp0.ownPal);
img = spriteRgba(buf, sff, f.grp, f.idx, ownPal ? null : pal);
```

配套：`server/lib/sff.cjs` 的 `loadSff()` 要解析出 `ownPal` 字段：

```js
sp.ownPal = sp.ps === 0;   // SFF v1：ps=0 表示自带调色板
```

## Verification

```powershell
node .cache/scripts/verify-kf-char.cjs "ikemen-fs/file/chars/LinYu" "ikemen-fs/file/chars/LinYuKF" 6000
```

11 项断言全绿才算过：

| 组 | 断言 |
|---|---|
| SFF 结构 | 精灵数 +10；原精灵一个不少；**原字节全保留**（只许改精灵数字段和最后一个精灵的 next 指针）；白模 group 0 的 0..3 仍在；10 个 AI 精灵各带 768 字节调色板 |
| 颜色 | 每个 AI 精灵解出来的颜色 **≥90% 落在源图颜色集合内**（证明调色板来自 AI 图而非 .act） |
| air 改写 | action 数不变；每个 action **最多改 1 行**；改动的行都指向 AI 精灵 group |
| 判定 | Clsn 行数不变；**逐 action 比对 Clsn 内容一致** |
| 非帧行 | Clsn / 注释 / 空行逐字节原样 |

### ⚠️ 必须追加：静态复检「引擎会不会丢弃这些精灵」

上面 11 项断言**发现不了**引擎静默丢弃精灵的缺陷（引擎对丢弃的精灵不打任何日志，
查看器也照常显示）。所以还要跑：

```powershell
node ../../templates/diag-engine-drop.cjs <包>/<id>.sff
```

输出「保留 N 引擎丢弃 M」—— **M 必须是 0**。

原理：写出器的 PCX 行宽 `bpl` **必须严格等于 `w`**（不能像 PCX 惯例那样补偶数）。
引擎 raw 路径（`encoding=0`）不做行距换算，`px` 长度 = `bpl*h`，
而 `SetPxl`（`src/image.go`）要求 `len(px) == w*h` → 不等就**静默丢弃整张精灵**。
2026-11-26 实测：`LinYuKF` 的 10 张 AI 精灵里有 4 张是奇数宽 → 4 张隐形。

详见 [merge/SKILL.md 的坑 E](../merge/SKILL.md)。已有坏包的修法：

```powershell
node ../../templates/fix-sff-bpl.cjs <包>/<id>.sff
```


### 逐帧颜色数（最直观的判据）

`/api/anim/<id>/<action>` 返回该 action 的每一帧 PNG。统计每帧的颜色数：

| action | 白模 | 抽帧版 |
|---|---|---|
| 0 站立 | 165 色 | **949** 色 |
| 220 轻拳 | 162 色 | **996** 色 |
| 410 重踢 | 145 色 | **683** 色 |
| 5000 受击 | 149 色 | **958** 色 |

**每个 action 恰好一帧颜色数跳到 ~700-1000，其余帧保持 ~150（灰度）** ——
这就是「抽」的准确形态。

⚠️ 别用「彩色像素占比」当判据：林羽穿黑卫衣，本来就以灰度为主；
舞台背景又是彩色的，会淹没信号。用**颜色数**（去重后的颜色个数）。

### 引擎实测

```powershell
# 起对局
bsk navigate "http://localhost:8100/?mode=practice&auto=1&ai=0&p1=LinYuKF&p2=LinYuKF&t=<ts>"
# 查引擎有没有报缺精灵
bsk console --session <id> --tab-id <tab> --limit 100 | grep -iE "missing sprite|not found"
```

引擎实测判据：角色区颜色数从 ~74-155（白模灰度）跳到 **370-533**（AI 彩色帧出现），
彩色占比从 98% 降到 29-58%。

⚠️ 抽帧是「每一帧动作里换一瞬间」，静态截图可能正好抓到白模帧 →
**必须连拍多帧**（间隔 ~0.35s）看有没有彩色帧出现。

## Output

| 产物 | 位置 |
|---|---|
| 变体角色包（sff/air/def/cns/cmd/snd/act） | `ikemen-fs/file/chars/<id>KF/` + `map_design/<故事>/chars/<id>KF/` |
| 变体 `char.json`（含 `variantOf`） | 同上 |
| 资产集元信息更新 | `mapping.json`（charPool）+ `roster.json`（defCharacterAssets），两个目录各一份 |
| 引擎 manifest | `ikemen-fs/manifest.json`（stamp 递增） |
| 组装脚本 | `.cache/scripts/build-kf-char.mjs` |
| 核心库 | `.cache/scripts/lib/sff-append.cjs`（SFF 追加）、`.cache/scripts/lib/air-some.cjs`（air 改写） |
| 校验脚本 | `.cache/scripts/verify-kf-char.cjs` |

## Reference Templates

`templates/` 下的脚本**可直接运行**（路径已处理成自包含，从任意目录调用都行）：

| 文件 | 用途 |
|---|---|
| `templates/build-kf-char.mjs` | 组装脚本（按 `{{...}}` 定制 CHAR / FRAMES / OUT / ID 四处） |
| `templates/verify-kf-char.cjs` | 11 组断言校验脚本 |
| `templates/air-some.cjs` | air 改写器（**必须改 `ACTION_CATEGORY` 表** —— 那是包相关的） |
| `templates/sff-append.cjs` | SFF v1 追加器（保留原字节 + 追加自带调色板的精灵） |
| `templates/sprite-pack.cjs` | PNG 编解码 + 量化（依赖） |

跑法（模板在技能目录下，脚本里的 require 是相对自身目录的）：

```powershell
$T = ".zcode/skills/char-assets-keyframes-generation/keyframeMode/some/templates"
node "$T/build-kf-char.mjs" "ikemen-fs/file/chars/{{CHAR_ID}}" "ikemen-fs/file/chars/{{CHAR_ID}}/keyframes/keyframes" ".cache/kf-build/{{VARIANT_ID}}" "{{VARIANT_ID}}"
node "$T/verify-kf-char.cjs" "ikemen-fs/file/chars/{{CHAR_ID}}" ".cache/kf-build/{{VARIANT_ID}}" 6000
```

⚠️ 正式施工时建议把 `build-kf-char.mjs` / `verify-kf-char.cjs` /
`air-some.cjs` / `sff-append.cjs` 拷到 `.cache/scripts/`（和
`lib/sprite-pack.cjs` 一起）—— `.cache` 是临时区，重开会丢。

## Notes

1. **变体包而不是改原包**：白模底座要留着（对照、换姿势、其它角色复用），
   变体包并存，`char.json` 的 `variantOf` 建立关系。
2. **`ps` 字节在子头 +18**，不是 +17。+17 是 `link`。
3. **AI 精灵的锚点要对齐白模参照帧**：用 manifest 里的 `refSprite`（白模代表帧）
   取它的**内容高度**和**内容底边到锚点的距离**，`ay` 必须夹在 `[1, h]` 内 ——
   参照帧的 `ay` 可能等于 `h+1`（像素边界），不夹会让角色陷地或浮空。
4. **AI 图要各自量化**：每张图独立 255 色（`quantize()`），不与白模共用 ——
   自带调色板的精灵互不干扰。
5. **`guard` 类别在这个底座里没有对应 action**（表是空的）→ 那一类不会被替换，
   属正常。构建脚本会打印每个类别的 action 数，看得到。
6. **`.gitignore` 排除了 `ikemen-fs/file/chars/` 和 `workshops/`** ——
   角色包二进制（~16MB）不在版本控制内。换机器要重跑 Step 1 的构建脚本。
7. **引擎零改动**：这套方案全在数据层（SFF/AIR），引擎不需要任何修改。
