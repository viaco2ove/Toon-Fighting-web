# 示例：LinYuKF —— LinYu（98Ryo 白模底座）的「抽关键帧」变体包

> 2026-11-25 实际执行记录。底座 = `chars/LinYu`（98Ryo 白模素体），
> 关键帧图 = `chars/LinYu/keyframes/keyframes/`（char-assets-keyframes-generation 产出，10 张全齐），
> 变体 id = `LinYuKF`。

## 起因

用户反馈「选人界面和战斗界面都没看出有抽帧替换关键帧」。

排查结论：**抽帧功能从未接进运行时**。`char.json` 里的 `keyframeMode: "some"`
只被当成标签渲染（绑定视图的「抽关键帧」角标、选人屏的 `kf` 字段），
全项目**没有任何一处读它去改变实际渲染**。

那 10 张 AI 关键帧图躺在 `chars/LinYu/keyframes/` 里 —— 引擎根本读不到，
它只认 sff 里的精灵和 air 里的帧行。

引擎实际跑的是 `LinYu`（98Ryo 白模底座，777 个精灵全是灰度素体）。
旁边的 `LinYuAI/` 目录里有个「全替」版本（group 0 正好 10 个 AI 精灵），
但它**不在 `mapping.json` 的 charPool 里**，默认绑定走的是白模包。

## Input

| 项 | 值 |
|---|---|
| 白模包 | `ikemen-fs/file/chars/LinYu/`（Lin.sff 777 精灵 / Lin.air 232 action / LinYu1-6.act 灰白） |
| 关键帧资产 | `ikemen-fs/file/chars/LinYu/keyframes/keyframes/`（10 张 `NN-<key>.png` + manifest.json） |
| 变体 id | `LinYuKF` |
| 落盘位置 | `.cache/kf-build/LinYuKF` → 复制到引擎目录 + 资产集目录 |

## Step 1 — 关键技术前提的查证

动手前先查了三件事，都不是猜的：

### 1.1 SFF v1 能不能让一个包里有两种调色板？

查引擎源码 `../Toon-WebMUGEN-2.0/ikemen-go-web/src/image.go`：

```go
// Sprite.read()
paletteSame := ps != 0 && prev != nil
```

`ps` 在精灵子头 **+18**（+17 是 `link`）。`ps == 0` → 该精灵自带调色板
（数据块尾 `0x0C` 标记后跟 768 字节 RGB）。

**结论：可以。** 白模精灵沿用 def 的 `pal1`（`.act` 灰度），AI 精灵自带彩色调色板，
两者在同一个 sff 里共存，引擎分别渲染。

### 1.2 AI 精灵放哪个 group？

```powershell
# Lin.sff 的 group 0 已被占用
node -e "..."
# → group0 已用 index: 0,1,2,3   （站立循环）
# → 6000-6999 空闲: 6000,6001,...,6009
```

**不能放 group 0** —— 覆盖会让站立动作缺帧。定在 **6000..6009**
（每个类别一个 group，index 都是 0，air 里写 `6000,0` / `6001,0` …）。

还要排除 air 里引用过的 group（`6040` 被引用了，脚本自动跳过）。

### 1.3 类别映射

原 `air-remap.cjs` 用 MUGEN 号段惯例分类。在这个包上**实测是错的**：

```powershell
grep -a -o "anim *= *[0-9]*" "ikemen-fs/file/chars/LinYu/Lin-N.st" | grep -o "[0-9]*$" | sort -n | uniq
# → 0 40 47 105 106 181 182 183 184 191 192 193 194 195 4101 4106
#   5000 5010 5020 5200 9400 9410 9500 19201 19202
```

- `Lin-N.st`（站立/受击/倒地）：5000/5010/5020 是**受击**，不是倒地；
  5200 是起身，9400/9410/9500 是地面特殊。
- `Lin-H.st`（跳跃/必杀）：1200/1250 是**走位**，不是空中；1400/1450 是起手。
- `Lin-S.st`（蹲/普通技）：200-250 轻拳，300-310 / 400-430 重拳。

按「文件归属 + 号段」重建 `ACTION_CATEGORY` 表，每个 action 标 `exact`
（cns 直接引用）/ 低置信（fallback 推断）。

## Step 2 — 三个踩坑

### 坑 1：AI 精灵放 group 0 覆盖了白模

第一版直接用 `group: 0, index: fr.sprite`（0..9），**把白模的 0..3 覆盖了**。
站立动作（action 0 引用 `0,0`~`0,3`）会缺帧。

修：找原包空着的连续 10 个 group。

### 坑 2：`split(/\r?\n/)` 把 CRLF 变成 LF

第一版 air 改写用 `lines = body.split(/\r?\n/)` 切分，改完 `join('\n')` 拼回去。
结果 **每个 action 的行数都变了**（`split` 吃掉了 `\r`，`join` 又不补）。

更隐蔽的是：帧行正则里的 `\s*` 会匹配 `\r\n`，把换行符一起吃掉。

修：改成**原位替换** ——
1. 正则定位帧行在原文里的字节偏移（`scanFrames`）；
2. 只替换那一行的内容；
3. 从后往前替换避免偏移失效。

帧行正则的空白必须用 `[ \t]` 不能用 `\s`：

```js
// 错
/^(\s*)(\d+)\s*,\s*(\d+)\s*,/
// 对
/^([ \t]*)(\d+)[ \t]*,[ \t]*(\d+)[ \t]*,/
```

### 坑 3：服务端把所有精灵套上灰度 .act

`server/lib/anim.cjs` 原来这样解帧：

```js
img = spriteRgba(buf, sff, f.grp, f.idx, pal);   // pal = def 的 pal1（灰度 .act）
```

**所有**精灵都套灰度调色板 → AI 精灵的自带彩色调色板被覆盖 → 选人屏中间那个
canvas 渲染出来也是灰的。

修：

```js
const ownPal = !!(sp0 && sp0.ownPal);
img = spriteRgba(buf, sff, f.grp, f.idx, ownPal ? null : pal);
```

配套 `server/lib/sff.cjs` 的 `loadSff()` 解析出 `ownPal`：

```js
sp.ownPal = sp.ps === 0;
```

## Step 3 — 组装与校验

```powershell
node .cache/scripts/build-kf-char.mjs `
  "ikemen-fs/file/chars/LinYu" `
  "ikemen-fs/file/chars/LinYu/keyframes/keyframes" `
  ".cache/kf-build/LinYuKF" LinYuKF
```

输出：

```
代表帧（共 213 个 action）：
  stand   79 个  a0(0,0 h109) a5(5,0 h100) ...
  light   10 个  a200(200,0 h102) ...
  hurt    46 个  a5000(5000,10 h102) ...
  down     5 个  a19201(192,20 h13) ...
  guard    0 个                                   ← 这个底座没有防御动作，正常
AI 精灵 group：6000,6001,...,6009
写 sff：3815040 bytes · 精灵数 787（原 3727540）
写 air：action 232 · 替换代表帧 213 · 跳过 19
```

`verify-kf-char.cjs` 11 组断言全绿：

```
[1] SFF 结构
  ✓ 精灵数 777 → 787（+10）
  ✓ 原有 777 个精灵全部保留（缺 0 个）
  ✓ 原 sff 的字节全部保留（只改了精灵数字段和最后一个精灵的 next 指针；意外改动 0 字节）
  ✓ 白模 group 0 的 0..3 仍在（未被 AI 精灵覆盖）
[2] AI 精灵颜色（与源图比对）
  ✓ group 6000 颜色 100% 来自源图（1963 像素，源图 16705 色）
  ... （10 个全 100%）
[3] air 改写（每 action 只换一行）
  ✓ 每个 action 最多改 1 行（违例 0 个）
  ✓ 改动的行都指向 AI 精灵 group（违例 0 行）
[4] Clsn 碰撞盒（判定必须不变）
  ✓ Clsn 行数 1757 → 1757
  ✓ 逐 action 比对 Clsn 内容一致（不一致 0 个）
[5] 未改动的帧行是否与原文件逐字节一致
  ✓ Clsn / 注释 / 空行等非帧行全部原样（差异 0 行）
```

## Step 4 — 运行时接入（三处，缺一不可）

1. **`mapping.json` 的 `charPool`** 加 `LinYuKF`
   —— 不加的话 `packCharPool().includes('LinYuKF')` 为假，
   `defaultCharIdFor()` 的校验直接失败 → 退回随机分配。

2. **`roster.json` 的 `defCharacterAssets`** 改成 `LinYuKF`

3. **两个目录都要改**：`workshops/.../map_design/<故事>/` 和 `assets/assetpacks/moshi-v1/`
   （`packMeta` 读前者，但登记目录也可能被用到）

4. **资产集侧要有 `chars/LinYuKF/` 目录**（含 char.json）
   —— 服务端 `packCharMetas()` 只遍历资产集目录下的角色
   （`server/lib/packs.cjs` 的 `packCharDirs`），引擎目录里的收不到。

## Step 5 — 存档迁移（漏了就白做）

用户之前存过 roster，绑的是 `LinYu`。改了 `defCharacterAssets` 之后存档不会自动跟着变
→ 表现为「改了但还是旧包」。

`index.html` 加了 `migrateSavedCharId()`：

```
存档绑的包 + defCharacterAssets 指向的包 是同一角色的不同版本
（后者 char.json 的 variantOf === 前者）→ 迁移到后者
其它情况（用户手动换过角色）→ 保留存档
```

配套 `LinYuKF/char.json` 里要有 `"variantOf": "LinYu"`。

## Step 6 — 验证

### 逐帧颜色数（最直观的判据）

`/api/anim/<id>/<action>` 返回该 action 的每帧 PNG，统计颜色数：

| action | LinYu（白模） | LinYuKF（抽帧） |
|---|---|---|
| 0 站立 | 165 | **949** |
| 220 轻拳 | 162 | **996** |
| 410 重踢 | 145 | **683** |
| 5000 受击 | 149 | **958** |

**每个 action 恰好一帧跳到 ~700-1000，其余帧保持 ~150（灰度）** —— 这就是「抽」。

⚠️ 别用「彩色像素占比」当判据：林羽穿黑卫衣，本来就以灰度为主；
舞台背景又是彩色的，会淹没信号。

### 引擎实测

```
?mode=practice&auto=1&ai=0&p1=LinYuKF&p2=LinYuKF
```

引擎日志无 `Animation missing sprite`（`LinYuKF's state 52 ...` 只是原包就有的
`veladd` / `ignoresuperpause` 警告）。

连拍多帧统计角色区（x 500-700, y 350-550）颜色数：

| 截图 | 角色区颜色数 | 彩色占比 |
|---|---|---|
| 白模版 | 74 | 98.3% |
| 白模版 | 155 | 29.1% |
| KF 版 | **370** | 48.2% |
| KF 版 | **533** | 58.1% |

白模角色本身是灰度（所以白模版的「彩色占比」是舞台背景贡献的）；
KF 版出现 370-533 种颜色 = AI 彩色帧出现了。

⚠️ 抽帧是「每一帧动作里换一瞬间」，静态截图可能正好抓到白模帧 → 必须连拍。

### 选人屏

中间面板显示 `角色林羽×实体LinYuKFLinYuKF武道家` —— 实体已是变体。

## 产出清单

```
ikemen-fs/file/chars/LinYuKF/           （sff 3.8MB / air 81KB / def / cns / cmd / snd / act / char.json）
workshops/.../chars/LinYuKF/            （同上，资产集侧）
ikemen-fs/manifest.json                 （local55 → local56，469 文件）
.cache/scripts/build-kf-char.mjs         （组装脚本）
.cache/scripts/lib/air-some.cjs          （air 改写器）
.cache/scripts/lib/sff-append.cjs        （SFF 追加器）
.cache/scripts/verify-kf-char.cjs        （11 组断言）
```

## 关键设计点

1. **变体包而不是改原包**：白模底座要留着（对照、其它角色复用），
   `char.json` 的 `variantOf` 建立关系，存档自动迁移。
2. **数据层解决，引擎零改动**：全部在 SFF/AIR 层面，引擎不需要任何修改。
3. **原字节保留是硬约束**：白模的 777 个精灵一个不动，
   AI 精灵追加在文件尾（改的只有精灵数字段和最后一个精灵的 next 指针）。
4. **判定不变是硬约束**：Clsn 行逐 action 逐字节比对一致 —— 攻击范围完全没动。
5. **类别映射按包核对，不猜**：MUGEN 号段惯例在这个包上是错的，
   查 cns 的 `anim = N` 才是可靠来源。
6. **代表帧用「内容高度最大」**：动作幅度最大的瞬间最能体现该类别，
   与 ff-studio 查看器的「抽」模式口径一致。
