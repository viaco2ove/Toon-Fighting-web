---
name: char-assets-keyframes-generation
description: 为白模角色资产生成/落盘「AI 整帧关键帧」资产（≤10 张、一帧一动作类别）。当用户要求「制作关键帧 / 生成 AI 关键帧 / 给角色包换 AI 身体 / 关键帧换身」时使用。产出 10 张按动作类别的 AI 整帧 PNG + 白模代表帧参照图 + 对照预览 + manifest，落进资产集 chars/<id>/keyframes/，并以引擎实测裁决渲染差异。
---

# char-assets-keyframes-generation

## Purpose

把「白模角色包」升级为「AI 换身资产」：按用户拍板的 **≤10 张 AI 整帧**方案（一帧一动作
类别、不做贴头），生成/落盘 10 张关键帧图到资产集 `chars/<id>/keyframes/`，
并为每类配一张**白模代表帧**（该类动作在白模底座里的对应精灵），写清
「AI 图 ↔ 替换哪类动作 ↔ 白模来源」的映射。

价值链：白模底座（white-mold-conversion 技能）→ **关键帧资产（本技能）** → 组装引擎包（AIR
重映射 + SFF 换图，后续轮次）。本技能只到「资产落盘」，不做引擎包组装。

## Input

**必填**

| 项 | 说明 |
|---|---|
| 白模角色包目录 | 引擎侧 `ikemen-fs/file/chars/<id>/`（要有 .sff/.air/.act，见 white-mold-conversion） |
| 资产集角色目录 | `workshops/toon-fighting-web/map_design/<故事>/chars/<id>/`（落盘目标） |
| 角色形象描述 | 一句话人设外观（如「19岁中国男大学生，黑色高马尾，白色连帽衫，黑色长裤」） |
| AI 关键帧图来源 | 二选一：① 已有图目录（复用，推荐先查）② 现场生成（见 Process Step 1） |

**可选**

| 项 | 默认 |
|---|---|
| 类别→白模代表帧映射表 | 按动作类别惯例（见 templates/mk-keyframes-template.mjs 的 `REF`），需按目标包 air 实际核对 |
| 生图通道 | 直连后端 `{game_app_service_url}/plugin/agentRun`（agentName=field-survival-sprite-gener）；脚本自动读 .env 登录 |
| 画幅/风格 | 1K、2:3、厚描边扁平色格斗 sprite、透明底 |

## Process

### Step 1 — 先查有没有现成图（省 10 次生图）

```powershell
ls .cache\ai-frames\<角色>\          # 历次生成的 10 类图 + manifest.json（含 baseDesc/style/systemPrompt）
```

抽样目检 2–3 张（stand/light/down）：形象一致性（发色/服装/鞋）、姿态典型性、
风格统一性（厚描边扁平色）。质量过关 → **复用**，跳到 Step 3；不过关 → 现场生成。

⚠️ **「形象一致」必须对照角色立绘核验**（`chars/<id>/avatar/full.png` + `head.png`）：
只看「10 张之间一致」不够——若生成时的 baseDesc 与角色立绘不符（例如立绘是黑短碎发黑卫衣，
图却是黑马尾白帽衫），10 张内部一致但**整体不是这个角色**，等于没生成对。

```powershell
node ff-studio\gen-ai-frames.mjs .cache\ai-frames\<角色>
```

生成要点（每类一张，已有文件自动跳过）：
- **必须带参考图**：`refImages=[avatar/full.png, avatar/head.png]`（后端 sprite agent 支持 ≤3 张，
  `refImageToPng` 统一转 png）——不带参考图模型会按泛化描述自由发挥，形象必然跑偏；
- **必须直连后端**：BFF 的 `bf()` 默认 15s 超时扛不住参考图生图（实测 17s+），
  走 `POST {BACKEND}/plugin/agentRun`（agentName=`field-survival-sprite-gener`），登录一次复用 token；
- **模型不给 alpha**（白底）：生成后必须**四角 BFS 泛洪抠白**（容差 RGB>225，
  只删与四角连通的白色，角色身上的白色不会被误伤）→ 透明底；
- prompt = 形象描述（与立绘一致）+ 姿态短语；system 强制「与参考图完全同一角色 + 透明底 + 朝右」；
- 失败重试不覆盖已有文件；个别类失败可单删该文件后重跑。

### Step 2 — 选每类「白模代表帧」

对每个类别，从白模包 air 里选一个**姿态最典型**的精灵（action, spriteIndex）：

- 用 `node .cache/tmp-grp.cjs`（或关键帧面板）确认候选 action 存在；
- 受击/倒地（5000 系）常**不在包内 cns**（引擎 common1 引用），但 air 里有定义——
  它们正是换身方案里 hurt/down 要替换的对象，照选；
- 起跳/空中类：air 里未必有 51，用 40（起跳，常引用蹲身精灵）替代，manifest 里写清。

### Step 3 — 落盘（mk-keyframes 脚本）

```powershell
node .cache\scripts\mk-keyframes.mjs
```

产物（全部落进资产集 `chars/<id>/keyframes/`）：

| 文件 | 说明 |
|---|---|
| `NN-<key>.png` ×10 | AI 整帧（sprite 0..9），从来源目录原样拷贝 |
| `reference/NN-<key>-ref.png` ×10 | 白模代表帧渲染图（身形/轴点对照基准） |
| `preview.png` | 白模 ↔ AI 逐类并排对照图 |
| `manifest.json` | 类别 → sprite index → 代表帧(action,sprite) → 生成参数全记录 |

**渲染废区裁剪（必做，否则对照图有黑块）**：白模包部分精灵的下半部带**近黑填充
废区**（原包作者的底色填充，特征：从底部开始的连续整行 100% 不透明）。引擎实测
**不画这些行**（走路/攻击截图干净）——离线渲染按同一几何规则把这些行置透明，
对齐引擎表现。实现见 templates/mk-keyframes-template.mjs 的 `refPngBuf()`。

### Step 4 — 验证

1. **目检 preview**：白模侧无黑/灰色填充块、AI 侧形象一致；
2. **对照角色立绘核验形象**：`avatar/full.png` 与 AI 图并排看——发色/服装/裤子/鞋必须对得上；
3. **manifest 核验**：10 类全齐、每类 refAction/refSprite 有效（能解码渲染）；
4. **引擎实测废区语义**（首次处理一个底座时做一次，之后引用结论）：
   `?auto=1&p1=<id>&p2=<对照>&ai=0` 起对局 → `document.dispatchEvent(KeyboardEvent(code))`
   让角色走路 → 截图放大目检无色块。
   ⚠️ 注入必须 `document.dispatchEvent` 且带 `code`（引擎绑 document、只读 ev.code，
   见 Notes 3）；验证坐标移动用 TF_HEAD 坐标包前后对比。
5. **两级 manifest 收口**：
   ```powershell
   node .cache\scripts\rebuild-manifest.mjs      # 引擎侧（若改了引擎侧文件）
   node .cache\tmp-fixman2.cjs                    # 资产集 manifest = 引擎镜像 ∩ 实有 + 自有资产
   ```
   自有资产 = `chars/<id>/{avatar,keyframes}/**`（引擎清单之外）也要登记进资产集 manifest。

### Step 4.5 — 在 ff-studio 查看器里核对（强烈建议）

`http://localhost:8100/ff-studio/src/viewer.html` → 服务器资产集 → 点角色 →
**「关键帧」标签页**：上半部分是本技能产出的 AI 关键帧对照（左白模代表帧 ↔ 右 AI 整帧），
下半部分是白模的分级分析（L0/L1/L2 + A/B/C）。
这是给用户验收「形象对不对、类别齐不齐」的最直接入口。

⚠️ 接入要点（viewer 的实现细节，改 viewer 前先读）：
- 服务器模式要**单独抓 `keyframes/` 目录**——它不在 def 的 `[Files]` 里；
- 抓下来的文件键必须是 `keyframes/<相对路径>`（保留前缀），viewer 靠它定位目录；
- `lower` map 的 value 是元组 `[path, file]`，取文件对象要写 `entry[1][1]`（写 `entry[1]` 会拿到数组）；
- 图片转 URL 用 `URL.createObjectURL(new Blob([await file.arrayBuffer()]))`。

### Step 5 — 回写 README

更新 `chars/<id>/README.md`：关键帧已就位章节（10 类映射表 + 废区结论 + 下一步组装路线），
同步引擎侧同名文件，再收口 manifest（README 字节数会变）。

## Output

| 产物 | 位置 |
|---|---|
| 10 张 AI 关键帧 + reference + preview + manifest | `map_design/<故事>/chars/<id>/keyframes/` |
| viewer 关键帧标签页（AI 资产对照 + 白模分级） | `ff-studio/src/viewer.html` 的「关键帧」tab |
| 资产集 manifest（398 条：引擎镜像 376 + 自有 22） | `map_design/<故事>/manifest.json` |
| 引擎 manifest（stamp 递增，若动了引擎侧文件） | `ikemen-fs/manifest.json` |
| README 关键帧章节 | 两侧 `chars/<id>/README.md` |
| 落盘脚本（永久方法） | `.cache/scripts/mk-keyframes.mjs` |

## Reference Templates

- [templates/mk-keyframes-template.mjs](templates/mk-keyframes-template.mjs)：落盘脚本模板
  （`REF` 代表帧映射表 / `CATS` 类别表 / `refPngBuf` 废区裁剪三处按目标包核对）
- [templates/gen-frames-note.md](templates/gen-frames-note.md)：现场生图的提示词与通道备忘

## 下一步：把关键帧装进引擎

**本技能只到「资产落盘」** —— 落盘的 10 张 PNG 引擎根本读不到（引擎只认 sff 里的精灵
和 air 里的帧行）。要真正在游戏里看到 AI 形象，需要组装成变体角色包：

| 模式 | 每帧显示什么 | 精灵数 | 包体 | 技能 |
|---|---|---|---|---|
| **抽关键帧**（some） | 代表帧=AI 图，其余=原精灵 | 10 + 白模全留 | +0.3MB | [keyframeMode/some/SKILL.md](keyframeMode/some/SKILL.md) |
| **融合关键帧**（merge） | 原精灵 **+** AI 图（叠加） | 777 张合成 | +5.7MB | [keyframeMode/merge/SKILL.md](keyframeMode/merge/SKILL.md) |
| **全替关键帧**（all） | 只有 AI 图 | 10 + 白模全留 | +0.3MB | [keyframeMode/all/SKILL.md](keyframeMode/all/SKILL.md) |
| 不使用（none） | 只有原精灵 | — | — | — |

三种模式的共同技术前提（各子技能的 SKILL.md 有完整细节）：

- **SFF v1 每个精灵可自带调色板**（子头 +18 的 `ps` 字节 = 0 表示自带），
  白模灰度与 AI 彩色才能共存于一个包
- **AI 精灵不能放 group 0**（白模占了 0..3 站立循环）→ 找原包空着的自定义区
- **air 必须原位替换**（只改目标帧行那一行的字节），且帧行正则的空白
  只能用 `[ \t]` 不能用 `\s`（`\s` 会吃掉 CRLF）
- **类别映射按目标包 cns 核对**，不猜 MUGEN 号段惯例
  （5000 系在 LinYu 上是受击不是倒地，1200/1250 是走位不是空中）

「融」模式额外注意：MUGEN 帧行一次只能画一个精灵，
所以「AI 图 + 原精灵一起显示」**必须在构建期烘焙**（合成成一张图）；
特效帧（group ≥ 7000）不融合。

`templates/` 下的脚本可直接运行（路径自包含）。

## Examples

- [examples.md](examples.md)：LinYu（98Ryo 白模底座）关键帧制作全程，含废区黑块的
  定位过程（解码统计 → 引擎走路实测裁决 → 几何裁剪对齐）
- [keyframeMode/some/examples.md](keyframeMode/some/examples.md)：LinYuKF 变体包组装全程，
  含三个踩坑（AI 精灵覆盖 group 0 / CRLF 被改 / 服务端调色板被灰度覆盖）
- [keyframeMode/merge/examples.md](keyframeMode/merge/examples.md)：LinYuKFM 融合包组装全程，
  含共享块解引用、全透明废区跳过、特效帧判定
- [keyframeMode/all/examples.md](keyframeMode/all/examples.md)：LinYuKFA 全替包组装全程，
  含旧版 build-ai-char 的两个问题（丢弃白模精灵 / 覆盖 group 0）

## Notes

1. **每类一帧的口径**：10 类 = MUGEN 惯例动作号段的归类（A 站桩/B 攻击/C 受击…），
   与关键帧面板（viewer）和 analyze-keyframes.mjs 同一口径；sprite 0..9 的序号即
   `air-remap.cjs` 的 CATEGORIES 顺序，组装引擎包时 AIR 重映射按这个序号换图。
2. **废区（重要）**：白模底座部分精灵下半带近黑填充废区。引擎**不画**它们（引擎
   调色板路径实测干净），离线渲染要按「底部连续 100% 不透明行」几何裁剪，否则
   reference/preview 有大黑块误导。此结论只在 98Ryo 底座上实测过，换底座要重测一次。
3. **引擎键盘注入**：必须 `document.dispatchEvent(new KeyboardEvent('keydown',{code}))`
   ——引擎 listener 绑在 document（system_js.go）且只认 `ev.code`（jsCodeToKey）；
   dispatch 到 window 不生效。
4. **生图配额**：后端模型有 Token Plan 上限（文本模型 2056 错误实测）；生图通道
   （storyImageModel）独立计费，失败时错误会透传，重试即可；已有图优先复用。
5. **manifest 双层**：资产集 manifest = 「引擎镜像（字节数逐一校验）+ 自有资产」；
   引擎侧文件任何改动（连 README）都要 rebuild-manifest → stamp 递增 → 资产集侧重算。
6. 版权：AI 关键帧是本项目生成资产可随资产集分发；白模底座仍受原作者授权约束
   （仅私有侧载）。
