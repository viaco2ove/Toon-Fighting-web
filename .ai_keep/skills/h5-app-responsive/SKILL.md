---
name: h5-app-responsive
description: Toon-Fighting web 层的多视口响应式验证：按真机实测视口跑 Playwright 仿真矩阵，几何探针（断点命中/卡片高度/列表可见行数）+ 截图对照，部署前抓布局问题。当用户要求「检查响应式 / 验证布局适配 / 横竖屏断点 / 改了媒体查询要验证」时使用。
---

# h5-app-responsive（响应式布局验证）

## Purpose

改媒体查询 / 加新断点之后，「本地看着没问题」不等于「手机上没问题」。
本技能用统一的视口矩阵 + 几何探针 + 截图，把布局问题拦在部署前，
并沉淀了本项目实测踩出的塌陷类 bug 的判别方法。

**第一原则：真机视口优先。** 仿真断点高度不可信——一加6 横屏实测 751×307（dpr 3.5），
比想当然的 412px 矮 100px+（Capacitor edge-to-edge margins + 显示缩放都压 vh）。
真机实际视口用 `h5-app-debug` 技能实测，测完先更新下面的 MATRIX。

## Input

必须提供：

1. 要验证的目标界面与验收标准（默认：选人屏列表 ≥2 行完整可见、无叠字/遮挡、各档互不回归）

可选提供：

2. 自定义视口档位（有真机实测数据时优先用实测值）
3. 自定义探针目标（默认选人屏 `#kgrid`；技能面板看 `#skills`，战斗层看 `#facebar`）

## Process

### Step 1 — 跑验证矩阵

```sh
cp .zcode/skills/h5-app-responsive/viewport-matrix.mjs .cache/uitest/
cd .cache/uitest && node viewport-matrix.mjs     # 需 node serve.cjs（8100）在跑
```

自动遍历四档（desktop / ultra-land / land / port）→ 打开选人屏 → 输出探针 JSON → 落盘截图。
验证其它界面/元素时按 templates 的 `{{}}` 占位符改探针。

### Step 2 — 读探针数字

| 字段 | 正常 | 异常含义 |
|---|---|---|
| `mqUltra/mqLand/mqPort` | 档位与预期命中一致 | 断点写错 / 源码顺序被覆盖 |
| `cardH` | 超矮 36 / 横屏 52 / 竖屏 62 / 桌面 85 | 塌成 11/15 = 行高塌陷 bug（见 Notes #1） |
| `gridH` | ≥ 2×cardH | 列表被挤没（中栏固定元素太多或 stage 太矮） |
| `rotbtn` | true | false = 手机在跑旧版（转 h5-app-debug 判别） |

### Step 3 — 人工过截图

用 ViewImage 逐档看 `<档位名>.png`：叠字、遮挡、溢出、空框——**探针数字对不代表视觉没问题**
（2026-11-26 真机标题叠字就是探针全绿、截图才现形的）。

### Step 4 — 自查

- [ ] 超矮横屏（751×307）+ 竖屏 + 桌面三档都跑了吗（新档生效 + 旧档无回归）
- [ ] 探针异常对号入座了 Notes 里的已知坑吗
- [ ] 修完后重跑矩阵 + 截图复验了吗

## Output

| 产出 | 说明 |
|---|---|
| 每档一行 JSON 探针 | 断点命中 / cardH / gridH / cards / rotbtn |
| `<档位名>.png` ×4 | 视觉证据，ViewImage 人工过 |
| 结论 | 可部署 / 哪档有问题、根因（对号 Notes） |

## Reference Templates

- [templates/viewport-matrix-template.mjs](templates/viewport-matrix-template.mjs)：矩阵骨架，
  `{{}}` 处换目标界面入口 / 探针选择器 / 断点条件
- 同目录 `viewport-matrix.mjs`：选人屏可用版（无占位符）

## Examples

参见 [examples.md](examples.md)：超矮横屏层（max-height:360px）从设计到四档验收的完整案例。

## Notes

1. **flex:1 受限滚动 grid 的 auto 行高塌陷**：`.rozlist` 变成
   `flex:1 1 auto;min-height:0;overflow-y:auto` 后卡片行高只剩 border+padding（横屏 11px/
   竖屏 15px），内容被 overflow:hidden 裁掉。只在 isMobile 仿真 + 受限高度复现，桌面不复现。
   **唯一有效修法**：`grid-auto-rows:minmax(<px>,auto)` 显式行高。text-size-adjust、去
   overflow、button→div 都治不了。
2. **媒体查询源码顺序**：MQ 不加权重大小，必须写在被覆盖的基础规则之后（#pad 踩过）。
3. **仿真 vh ≠ 真机 vh**：新断点先用 h5-app-debug 实测真机视口，别拍脑荘认为横屏是 412。
4. 虚拟手柄 `#pad.selmode`（z-index 60）浮在选人屏上：注意区分「被手柄挡住」和「没渲染」，
   `#padtog` 可收起手柄再验。
5. 依赖：本地 serve.cjs（8100）+ `.cache/uitest` 的 playwright-core + ms-playwright chromium-1243
   （均已就位）；只验证 web 层，APK 里的版本用 h5-app-debug。
6. **探针档位 ≠ CSS 档位**：矩阵探针的 `mqUltra`（`max-height:360px`）可以先于 CSS 落地存在 ——
   探针 true 只说明「视口命中区间」，不说明有对应规则。2026-11-27 实踩：751×307 下 `mqUltra:true`
   但 index.html 没有该档 CSS，横屏档（按 412 高设计：top52 + bottom104 + 中栏家具 ~114）把 307 高
   吃剩 37px，名单 gridH=0「连选什么都看不见」。判别：gridH=0 且 mqUltra=true → 先 grep 确认该档
   CSS 是否存在。超矮档设计口径：看见可选的人优先 —— 藏标题/中栏立绘区（面板里已有同款实体
   动画）、压 topbar 与底部名字条、名单显式 `grid-auto-rows:minmax(44px,auto)` 保底 3 行。
7. **可玩性优先的取舍**：超矮档里虚拟手柄（`#pad.selmode`）会压到左右面板一角 —— 接受
   （手柄可收起，列表可见是刚需）；截图验证时先 `#pad{display:none}` 再 screencap，过完恢复。
