# examples — 末世包 21 角色六键接线实测（2026-11-27）

## Input

- 用户问题：「手柄这些按钮有几个能用是不是角色资产决定的」+ 截图（X 钮按了没反应，备注「X 不起作用，引擎无响应」）
- charsRoot：`workshops/toon-fighting-web/map_design/末世选择，从解析神明开始成神/chars`

## 执行

```sh
node .cache/scripts/analyze-pad-buttons.mjs "workshops/.../末世选择，从解析神明开始成神/chars"
```

## Output（修正版矩阵）

| 角色 | A | B | C | X | Y | Z | 指令数/被引用 |
|---|---|---|---|---|---|---|---|
| SuWanqingKFM（用户） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 50/16 |
| Hinako / K' / Leona / LinYueKFM / XiaoLingdangKFM | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| BaishuKFM（白术，98Billy 底座） | · | ✓ | · | ✓ | ✓ | · | 77/17 |
| Rugal2nd | ✓ | ✓ | · | ✓ | ✓ | · | 69/52 |
| ChenAyiKFM / ZhenXuanshiKFM | ✓ | ✓ | · | · | · | · | 51/12 |
| LinYu 全系（KF/KFM/KFA） | · | · | · | ✓ | ✓ | · | 89/9 |
| **LaoLeiKFM** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 86/19 |
| **JiangHaoKFM / ZhaoDachuanKFM / 98-kim / Lin** | · | · | · | · | · | · | 64/0 等 |
| **MasterRyu** | · | · | · | · | · | · | 181/0 |

## 关键判定

1. **注入链先排除**：六钮注入链路一致（settings.keys.p1 → KeyboardEvent.code），「某键没反应」
   在矩阵 `·` 的前提下归属资产，不需要查手柄/引擎。
2. **两层口径缺一不可**：98-kim 有 98 条指令但被引用 0（状态机没接 `command=` 触发）→ 全键无反应；
   这类是「AI 打法包」，纯靠引擎 AI 随机按键驱动。
3. **⚠️ 多 def 包必须用入口 def**（本案例踩坑）：
   - 首版脚本取目录里任意第一个 `.def`，LaoLeiKFM 目录按字母序拿到 `ikari.def`（附属 def，
     没挂 cmd）→ 误报「def 没挂 cmd、全键不可用」；
   - 修法：与目录同名的 def 优先（LaoLeiKFM.def 挂了 cmd，实测六键全通 86/19）；
   - 教训：`(def 没挂 cmd)` 这种整行否定结论出现时，先确认解析到的是不是入口 def。
4. 「X 没反应」的归属：看 X 列。BaishuKFM 的 X 是 ✓（有反应）；若测的是江浩/赵大川这类零键
   角色，六个键全没反应是资产没接玩家指令，不是引擎无响应。
5. **判定根因要看对层**：MasterRyu 181 条指令/0 被引用——是「指令没接状态」，不是「def 没挂
   cmd」（它的 def 挂了 cmd，只是状态机全靠 AI 随机按键）。两类零键根因不同，补法也不同：
   前者要在 cns 里接 `command=` 触发，后者要先补 `cmd=` 文件。

## 技能条 v2 联动（2026-11-27）

技能条 `#skills` 已改为直接消费**同一套双层过滤**：

- `FFDecode.loadCommands(pack, charId)`（ff-decode.js）→ 只保留「被状态引用的有按钮指令」，
  同名去重 → 技能条按钮 = 真实指令名 + 原始搓招记法（如 `ball1 ~D DB B x`）；
- 回放器 `compileCommand(tokens)`（index.html，调试钩子 `window.__tfCompileCommand`）按
  MUGEN 指令语义编译注入时间线（方向滑动按住、方向→按钮不松方向、`~Ns`≥320ms 蓄力、
  双击缓冲、`>` 尾保持），旧 `DEFAULT_MOVES` 通用假宏只在装载完成前占位；
- 本矩阵 `✓` 的键 = 技能条可用的招式来源；0 wired 角色（江浩/赵大川/98-kim/Lin/MasterRyu）
  技能条诚实隐藏。
- 已知限制：回放固定「P1 面向右」注入 F=right/B=left，对手换边后 F/B 类指令不触发
  （进阶路线：引擎 Lua 通道直接 changeState，需重编 wasm）。
- 验证探针：`.cache/scripts/probe-skill-commands.mjs`（三类角色装载 + 波动拳时序 + 双击，9/9）。

## 修复落点（如果要把键「接活」）

资产侧工作：cmd 补 `[Command]`（按键序列）+ cns 补 `command="名字"` 触发的状态（changeState）。
不要改手柄/注入链。补完后重跑本技能矩阵核对，技能条会自动出现新招。
