# 示例：LinYuKFA —— LinYu（98Ryo 白模底座）的「全替关键帧」变体包

> 2026-11-25 实际执行记录。底座 = `chars/LinYu`（98Ryo 白模素体），
> 关键帧图 = `chars/LinYu/keyframes/keyframes/`（10 张），
> 变体 id = `LinYuKFA`。

## 起因

用户在同一轮要求里说「all 模式也一起做了吧」。
之前项目里有个 `.cache/scripts/build-ai-char.mjs`（全替版），但它有两个问题。

## 旧版 build-ai-char.mjs 的两个问题

### 问题 1：丢弃全部白模身体精灵

旧版的 sff 只保留 **AI 精灵（10 张）+ helper/特效精灵**，
把 636 个白模身体精灵全丢了。

后果：任何引用白模精灵的帧行都会变成「缺精灵」。

### 问题 2：AI 精灵放 group 0

```js
const sprites = [
  ...aiFrames.map((f) => ({ group: 0, index: f.sprite, ... })),
  ...helperFrames.map((f) => ({ group: f.group, ... })),
];
```

白模的 **group 0 的 index 0..3 就是站立循环**（action 0 引用 `0,0`~`0,3`）。
AI 精灵占 group 0 的 0..9 → **站立动作的帧被覆盖**。

## 本技能的解法

| | 旧版 | 本技能 |
|---|---|---|
| sff 内容 | AI 精灵 + helper（**丢弃白模身体精灵**） | **白模 777 个精灵一个不少** + 追加 10 个 AI 精灵 |
| AI 精灵 group | group 0（**覆盖白模 0..3**） | **6000..6009**（原包空着的自定义区） |
| 特效帧 | helper 行原样 ✓ | 特效帧行原样 ✓ |
| air 改写 | 全部身体帧 → `0, <类别>` | 全部身体帧 → `6000+<类别>, 0` |

「保留全部原精灵 + 追加 AI 精灵」靠 `.cache/scripts/lib/sff-append.cjs`
（原字节一个不改，AI 精灵追加在文件尾）。

## Step 1 — 组装

```powershell
node .cache/scripts/build-all-char.mjs `
  "ikemen-fs/file/chars/LinYu" `
  "ikemen-fs/file/chars/LinYu/keyframes/keyframes" `
  ".cache/all-build/LinYuKFA" LinYuKFA
```

输出：

```
AI 图：10 张
AI 精灵 group：6000,6001,...,6009
写 sff：3815040 bytes · 精灵数 787（原 3727540）
写 air：86312 bytes
  身体帧行改写 1599 · 特效帧行保持原样 91
```

## Step 2 — AI 图的几何

每张 AI 图按 manifest 里的 `refSprite`（白模代表帧）缩放：

| 类别 | sprite | 参照 | 尺寸 | 锚点 |
|---|---|---|---|---|
| stand | 0 | 0,0 | 30×109 | 19,107 |
| walk | 1 | 20,0 | 43×102 | 25,101 |
| turn | 2 | 5,0 | 34×100 | 15,98 |
| light | 3 | 220,0 | 79×102 | 46,100 |
| heavy | 4 | 410,0 | 50×66 | 21,64 |
| special | 5 | 1000,1 | 50×96 | 20,93 |
| hurt | 6 | 5000,0 | 63×99 | 40,99 |
| down | 7 | 5300,0 | 376×96 | 194,95 |
| air | 8 | 10,0 | 44×86 | 22,84 |
| guard | 9 | 120,2 | 51×88 | 23,86 |

规则：

- 目标高 = 参照帧的**内容高度**（不是 localcoord×0.92 —— 那是旧版的错误口径，
  会让角色比原型大一倍）
- `ax` = 图宽/2 + 参照帧的内容中心偏移（内容中心对齐）
- `ay` = 目标高 − 参照帧的「内容底边到锚点距离」（脚底齐平），
  **必须夹在 [1, h] 内** —— 参照帧的 `ay` 可能等于 `h+1`（像素边界），
  不夹会让角色陷地或浮空

## Step 3 — 接入运行时

1. `mapping.json` 的 `charPool` 加 `LinYuKFA`（两个目录各一份）
2. 资产集侧 `chars/LinYuKFA/`
3. `char.json`：`keyframeMode: "all"` + `variantOf: "LinYu"`
4. `index.html` 的 `MUGEN` 表加一条（选人屏显示中文名）

## Step 4 — 验证

### 逐帧颜色数

| 变体 | action 220（轻拳）各帧颜色数 |
|---|---|
| LinYu（白模） | 157 162 161 154 135 134 135 136 143 153 156 |
| LinYuKF（抽） | 149 **996** 164 147 134 128 133 139 144 149 160 |
| LinYuKFM（融） | 1140 1165 1138 1123 1062 1035 1035 1022 1149 1139 1050 |
| **LinYuKFA（全）** | **979 979 979 979 979 979 979 979 979 979 984** |

**全的特征：每帧颜色数几乎相同**（同一动作里都指向同一张 AI 图）。
末帧 984 略高 —— 那帧落到了别的类别（分类是按 action 号判的，
最后一帧可能属于另一个类别），属正常。

### 引擎实测

`?mode=practice&auto=1&ai=0&p1=LinYuKFA&p2=LinYuKFA`
→ 无 `Animation missing sprite`，日志 20 条 `LinYuKFA` 确认加载。

## 产出清单

```
ikemen-fs/file/chars/LinYuKFA/            （sff 3.8MB / air 84KB / def / cns / cmd / snd / act / char.json）
workshops/.../chars/LinYuKFA/             （同上，资产集侧）
.cache/scripts/build-all-char.mjs          （组装脚本）
```

## 关键设计点

1. **保留白模精灵是关键**：全替模式下白模身体精灵虽然不显示了，
   但特效帧或其它 action 可能引用它们 —— 丢了就会缺精灵。
2. **AI 精灵不能放 group 0**：白模的站立循环在那儿。
3. **同一动作内 AI 图尺寸必须稳定**：统一用参照帧的高度，
   否则人物在动作里忽大忽小。
4. **特效帧保持原样**：group ≥ 7000 的 helper 段本来就没有人像。
5. **数据层解决，引擎零改动**。