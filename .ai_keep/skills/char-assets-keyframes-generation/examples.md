# 示例：LinYu（98Ryo 白模底座）AI 关键帧制作

> 2026-11-25 实际执行记录。底座 = `chars/LinYu`（98Ryo 白模素体，white-mold-conversion 产出），
> 关键帧图来源 = `.cache/ai-frames/linyu/`（2026-11-24 由 gen-ai-frames.mjs 生成，本轮复用）。

## Input

| 项 | 值 |
|---|---|
| 白模包 | `ikemen-fs/file/chars/LinYu/`（Lin.sff 777 精灵 / Lin.air 223 action / LinYu1-6.act 灰白） |
| 形象描述 | 19岁中国男大学生，黑色高马尾，白色连帽衫，黑色长裤 |
| 现成图 | `.cache/ai-frames/linyu/`（10 张全齐，manifest 里 baseDesc/style/systemPrompt 在案） |

## Step 1 复用判定（**这一步漏了，被用户当场指出「图也不是 AI 生成的」**）

抽样目检 00-stand（站立）/ 04-heavy（回旋踢）/ 07-down（倒地横躺）：
形象一致（白帽衫/黑裤/黑马尾/白鞋）、姿态典型、厚描边扁平色风格统一 → 看起来可以复用。

**但这是错的**：再与角色立绘 `avatar/full.png` / `avatar/head.png` 并排一比——
立绘是**黑短碎发 + 黑卫衣 + 黑工装裤 + 军靴**，而那 10 张图是**黑马尾 + 白帽衫 + 白鞋**，
根本不是同一个角色。根因：v1 生成脚本（`gen-ai-frames.mjs`）只传了泛化 baseDesc
「19岁中国男大学生，黑色高马尾，白色连帽衫，黑色长裤」，**没带参考图**，
模型按文字自由发挥，形象与角色设定脱钩。

→ **「10 张内部一致」不等于「就是这个角色」**，必须与立绘对照核验。

## Step 1' 重新生成（v3 脚本）

`gen-ai-frames3.mjs` 三处关键改动：
1. **带参考图**：`refImages=[full.png, head.png]`（后端 sprite agent 支持 ≤3 张）→ 形象立刻对上；
2. **直连后端**：BFF 的 `bf()` 15s 超时扛不住参考图生图（实测 17s/张），
   改直连 `POST {BACKEND}/plugin/agentRun`，登录一次复用 token；
3. **白底抠图**：模型不给 alpha（白底），四角 BFS 泛洪抠白（RGB>225 且与四角连通）
   → 透明底，角色身上的白色不误伤。10 张各抠掉 79~87% 像素。

结果：10 张全部 16~18s/张，形象与立绘一致（黑短碎发/黑卫衣/黑工装裤/军靴/背包）。

## Step 2 代表帧选择

候选 action 全部核对存在于 Lin.air（0/5/20/40/130/220/410/1000/5000/5300 ✓，51 ✗ → air 类改用 40）：

| 类别 | sprite | 白模代表帧 | 说明 |
|---|---|---|---|
| stand | 0 | 0,0（74×109） | 站立 idle 首帧 |
| walk | 1 | 20,0（58×102） | 行走循环首帧 |
| turn | 2 | 5,0（56×100） | 转身 |
| light | 3 | 220,0（74×102） | 轻拳出拳 |
| heavy | 4 | 410,0（62×66） | 重踢 |
| special | 5 | 1000,1（91×96） | 必杀起手 |
| hurt | 6 | 5000,0（74×99） | 受击（引擎 common1 引用，包内 cns 不引用） |
| down | 7 | 5300,0（66×96） | 倒地 |
| air | 8 | 40→10,0（67×86） | air 无 51，用起跳 40（首帧引用蹲身精灵 10,0） |
| guard | 9 | 130→120,2（64×88） | 站立防御 |

## Step 3 落盘

`node .cache/scripts/mk-keyframes.mjs` → 全部 10 类 OK，落进
`workshops/.../chars/LinYu/keyframes/`（10 AI 图 + 10 reference + preview + manifest）。

## Step 4 踩坑与裁决：preview 出现大黑块

**现象**：preview 里 walk/turn/light/hurt/down/guard 的白模侧有大块黑矩形。

**定位三步**：
1. 解码统计 `(20,0)`：灰白 act 路径 black(<10)=0，但 deep-gray(<30)=2693 ——
   黑块其实是**近黑深灰 (12,12,12)**（灰阶化 clamp GRAY_MIN=12 的产物）；
   彩色 Ryo01.act 路径同位置是纯黑 2693（彩色原包也有）。
2. 逐行统计 `(20,0)`：**y=60..101 整行 100% 不透明、单一颜色** —— 原包作者的
   近黑填充废区（位图下半 40% 被填满）；角色本体行最多 ~85% 覆盖。
3. **引擎实测裁决**（关键）：`?auto=1&p1=LinYu&p2=Lin&ai=0` →
   `document.dispatchEvent(KeyboardEvent('keydown',{code:'ArrowRight'}))` 走路 0.9s →
   TF_HEAD x 从 90.0 → 227.1（确认移动）→ 截图放大 P1 区域：**完全干净，无色块**。

**结论**：引擎调色板路径不画废区行；离线渲染按「底部连续 100% 不透明行 = 填充废区
→ 整行置透明」几何裁剪对齐引擎表现。修复后 preview 全部干净。

（调试副产物：键盘注入 dispatch 到 window 不生效——引擎 listener 绑 document 且只认
ev.code；verify-result.mjs 的 `document.dispatchEvent` 是正确姿势。）

## Step 5 manifest 收口与 README

- 引擎侧 README 同步（关键帧章节）→ `rebuild-manifest.mjs`：stamp local47 → **local48**（1 处变化）；
- 资产集 manifest 重写：**引擎镜像 376（字节数逐一校验，不符 0）+ 自有资产 22**
  （keyframes 23 个文件里 22 个不在引擎清单 + avatar 2）= **398 条**，stamp local48；
- README 关键帧章节含 10 类映射表、废区结论、下一步组装路线。

## Step 6 viewer 接入（用户要求「你自己看关键帧标签页」）

ff-studio 查看器原本只有「动作列表 / 精灵浏览」两个标签，关键帧标签页只做白模的
L0/L1/L2 分级分析，**根本没接入 keyframes/ 资产**。接入踩了三个坑（都在 viewer 里）：

1. **服务器模式要单独抓 keyframes/** —— 它不在 def 的 `[Files]` 里（是资产集自有资产）；
2. **抓下来的文件键要保留 `keyframes/` 前缀** —— 原来 `mkFile()` 用 `name.split('/').pop()`
   把目录剥掉了，viewer 靠前缀定位目录，全找不到；
3. **`lower` map 的 value 是元组 `[path, file]`** —— 取文件对象必须写 `entry[1][1]`；
   写 `entry[1]` 拿到的是数组，`arrayBuffer()` 报 undefined，manifest 解析失败。

另外图片转 URL 要用 `URL.createObjectURL(new Blob([await file.arrayBuffer()]))`。
验证：CDP 探针 5 断言全绿（10 对对照 / 20 张图 / 0 破图 / 0 JS 异常），
浏览器实看截图确认「左白模 ↔ 右 AI」对照正常。

## 产出清单

```
workshops/.../chars/LinYu/keyframes/{00-stand..09-guard.png ×10,
  reference/×10, preview.png, manifest.json}
workshops/.../chars/LinYu/README.md          （关键帧章节）
workshops/.../map_design/末世选择…/manifest.json （398 条，stamp local48）
ikemen-fs/manifest.json                       （local48）
.cache/scripts/mk-keyframes.mjs               （落盘脚本，含废区裁剪）
.cache/shots-linyu/walk-*.png                 （引擎走路实测证据）
```

## 关键设计点

1. **先查后生成**：10 张图是最贵的输入（生图配额+时间），manifest 里 baseDesc/
   style/systemPrompt 全记录让「复用 vs 重生成」有据可查。
2. **白模代表帧是组装的锚**：每类 AI 图 ↔ (action, sprite) 的映射写进 manifest，
   后续 AIR 重映射/SFF 换图直接照表施工，不再猜。
3. **引擎实测裁决渲染差异**：离线渲染与引擎调色板语义有差异时，用引擎截图做
   ground truth，再让离线渲染向引擎对齐（几何裁剪），而不是反过来改引擎。
