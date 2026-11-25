# 示例：LinYuKFM —— LinYu（98Ryo 白模底座）的「融合关键帧」变体包

> 2026-11-25 实际执行记录。底座 = `chars/LinYu`（98Ryo 白模素体），
> 关键帧图 = `chars/LinYu/keyframes/keyframes/`（10 张），
> 变体 id = `LinYuKFM`。

## 起因

用户要求：「增加『融』模式 —— AI 图和原精灵融合一起显示，
特效帧等本来就没有人像的就不要融合」，并制作 `chars/LinYuKFM` 融合版。

前置工作（上一轮已完成的抽关键帧）：
- `LinYuKF` = 抽（每个 action 只换代表帧）—— 已接入运行时，是当前默认绑定。

## 关键调研：特效帧在哪

要实现「特效帧不融合」，先得搞清楚这个包里哪些是特效帧。查法：

```powershell
node -e "
const {parseAir,scanFrames}=require('./.cache/scripts/lib/air-some.cjs');
const air=fs.readFileSync('ikemen-fs/file/chars/LinYu/Lin.air','latin1');
const acts=parseAir(air);
const eff=new Set(), body=new Set();
for(const a of acts) for(const f of scanFrames(a.body)) (f.g>=7000?eff:body).add(f.g);
console.log('特效 group(>=7000):',[...eff].sort((a,b)=>a-b).join(','));
console.log('身体 group 个数:',body.size);
"
```

结果：

- 特效 group = **8090, 9001, 9002, 9003**（全部 ≥ 7000）
- 身体 group = 114 个（全部 < 7000）
- **没有任何 action 同时含身体帧和特效帧** —— 纯特效 action 只有 8 个：
  9400 / 9410 / 9500~9504 / 8090

所以判定规则很干净：**group ≥ 7000 → 不融合**。
「纯特效 action」是冗余保险（换底座时可能有混合 action）。

## Step 1 — 关键技术障碍：MUGEN 画不了两个精灵

air 帧行格式 `<group>, <index>, <x>, <y>, <time>` —— 一次只能画一个精灵。
没有「两个精灵叠加」的表达力。

→ 「AI 图 + 原精灵一起显示」**只能构建期烘焙**（合成成一张图）。

这与 ff-studio 查看器的 merge 预览不同 —— 那边是 canvas 上叠两次绘制，
运行时做不到。

## Step 2 — 合成核心

`.cache/scripts/lib/merge-sprite.cjs` 的 `mergeSprites(body, ai, alpha)`：

```
out.rgb = ai.rgb × (aiAlpha × 0.55) + body.rgb × (1 − aiAlpha × 0.55)
out.a   = max(bodyAlpha, aiAlpha)
```

几何：

- AI 图按**原精灵的内容高度**缩放（每帧融合图大小跟原帧一致）
- 内容中心对齐原精灵内容中心、内容底边对齐原精灵内容底边
- 融合画布 = 原精灵内容包围盒 ∪ AI 图矩形
- **锚点沿用原精灵的**（加画布偏移）→ air 的帧偏移不用改

## Step 3 — 精灵数量：为什么是 804 → 777

同一精灵可能出现在**不同类别的 action** 里（`220,1` 在轻拳动作里是
AI 图「轻拳」，在另一个动作里可能是「站立」）。AI 图不一样 → 合成结果不一样
→ 每个「精灵 × 类别」组合各生成一张。

```
唯一身体精灵        636
(精灵,类别) 组合    804   ← 合成精灵数
  ├─ 全透明废区      -22   （跳过，保持原样）
  ├─ 共享块解引用失败  -0
  └─ 精灵不存在       -5   （跳过）
最终合成精灵         777
```

### 踩坑：共享块（size=0）

`5011,10` / `5012,20` / `5032,10` / `5040,0` / `5012,0` 这些是**共享块** ——
子头的 size=0，靠 link 指向别的精灵复用像素。

项目解码器 `server/lib/sff.cjs` 的 `spriteRgba()` **只解 v2 的共享块**，
v1 的（Lin.sff 里有 45 个）会抛 `PCX 只支持 8 位色深（实际 0 位）`。

修：自己解引用。

```js
let sp = byKey.get(g + ',' + n);
while (sp && sp.size === 0 && hops < 64) sp = byIdx[sp.link];
// 解 sp 指向的精灵，但 ax/ay 用原来的 sp（轴点可能与被链接者不同）
```

### 踩坑：全透明废区

21 个精灵的不透明像素数 = 0（白模包作者的填充废区，如 `192,20` 是 21×13）。
没有可融合的东西 → 跳过，保持原样。

## Step 4 — 产物

```
写 sff：10040989 bytes（9.58 MB）· 精灵数 787 + 777 = 1564
写 air：86219 bytes · 改写帧行 1564
  身体帧行 → 合成 1599（其中 35 行是空废区，保持原样）
  特效帧行 → 保持原样 91
```

## Step 5 — 接入运行时

1. `mapping.json` 的 `charPool` 加 `LinYuKFM`（两个目录各一份）
2. 资产集侧 `chars/LinYuKFM/`（服务端 `packCharMetas()` 只遍历资产集目录）
3. `char.json`：`keyframeMode: "merge"` + `variantOf: "LinYu"`
4. `index.html` 的 `MUGEN` 表加一条（选人屏显示中文名）

## Step 6 — 查看器的 merge 模式

`ff-studio/src/viewer.html` 的改动：

| 位置 | 改动 |
|---|---|
| 顶栏 `aiMode` 下拉 | 加 `<option value="merge">融（AI 帧与原精灵叠加显示）</option>` |
| 顶栏 `assetMode` 下拉 | 加 `<option value="merge">融合关键帧</option>` |
| `state` | 加 `aiMergeAlpha: 0.55` |
| `aiGeometryFor()` | merge 模式用该帧自己作参照（融合是逐帧对齐的） |
| 新增 `isEffectFrame()` / `isPureEffectAction()` / `shouldMergeFrame()` | 特效帧判定 |
| `aiFrameFor()` | merge 模式不受「只有代表帧」限制 |
| `drawFrame()` | merge 分支：先 `drawSprite()` 画原精灵，再 `globalAlpha` 叠 AI 图 |
| `stageInfo` | 标注「· 已融合」/「· 特效帧不融合」/「· 纯特效不融合」 |
| `saveAiMode` / `loadAiMode` | 认 `'merge'` |
| 新增 `aiModeLabel()` | 模式中文标签统一 |

服务端配套：`server/lib/packs.cjs` 的 `writeCharMeta()` 校验加 `'merge'`，
`index.html` 的 `keyframeModeOf()` 与绑定视图标签也要认 `'merge'`。

## Step 7 — 验证

### 逐帧颜色数（决定性判据）

| 变体 | action 220（轻拳）各帧颜色数 |
|---|---|
| LinYu（白模） | 157 162 161 154 135 134 135 136 143 153 156 |
| LinYuKF（抽） | 149 **996** 164 147 134 128 133 139 144 149 160 |
| **LinYuKFM（融）** | **1140 1165 1138 1123 1062 1035 1035 1022 1149 1139 1050** |
| LinYuKFA（全） | 979 979 979 979 979 979 979 979 979 979 984 |

四种模式特征完全区分开：

- 白模：~150 色（纯灰度）
- 抽：恰好一帧跳到 996，其余灰度
- **融：每帧都 ~1100 色**（AI 彩色 + 原灰度混合）
- 全：每帧都是 979（同一张 AI 图）

### 饱和度直方图（证明是「混合」不是「替换」）

融合帧：**彩色 45.4% + 灰度 54.6%** —— AI 图的彩色被半透明稀释，
原精灵的灰度结构还在。这正是「融合」与「替换」的区别。

### 特效帧没被融合

```
身体帧行 改了 1564 未改 35
特效帧行 改了 0    未改 91
```

### 引擎实测

`?mode=practice&auto=1&ai=0&p1=LinYuKFM&p2=LinYuKFM`
→ 无 `Animation missing sprite`，日志有 `LinYuKFM's state 52 ...`（加载确认）。

### 查看器实测

```
状态栏：动作 0 · 帧 1/7 · sprite 0,0 · AI关键帧(stand)+原精灵 · 已融合
a0    纯特效=false 帧0应融=true
a9400 纯特效=true  帧0应融=false
a9500 纯特效=true  帧0应融=false
a8090 纯特效=true  帧0应融=false
a220  纯特效=false 帧0应融=true
a5000 纯特效=false 帧0应融=true
```

## 产出清单

```
ikemen-fs/file/chars/LinYuKFM/            （sff 9.6MB / air 84KB / def / cns / cmd / snd / act / char.json）
workshops/.../chars/LinYuKFM/             （同上，资产集侧）
.cache/scripts/build-merge-char.mjs        （组装脚本）
.cache/scripts/lib/merge-sprite.cjs        （逐像素合成核心）
```

## 关键设计点

1. **烘焙是唯一稳妥的路**：MUGEN 帧行一次只能画一个精灵，
   任何「运行时叠加」都要改引擎 —— 数据层做不到。
2. **特效判定靠 group ≥ 7000**：MUGEN 惯例里 7000 以上是 helper 段，
   本来就没有人像，融了只是把爆炸涂花。
3. **合成精灵按（精灵 × 类别）拆**：同一精灵在不同类别动作里
   对应不同的 AI 图，合成结果也不同。
4. **锚点沿用原精灵**：融合画布变了但锚点语义不变 → air 的帧偏移不用改，
   Clsn 判定也完全不用动。
5. **viewer 用 canvas 叠绘、运行时用烘焙**：两者视觉等价，
   但 viewer 能实时切换模式、运行时只能各出一个包 —— 这也是要做变体包的原因。