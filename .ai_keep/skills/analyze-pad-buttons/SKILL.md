---
name: analyze-pad-buttons
description: 分析 MUGEN 角色手柄六键（引擎键 a/b/c/x/y/z = 手柄 A/B/C/X/Y/Z）哪些真正接进状态机：解析 def→cmd 的 [Command] 按键序列，再双层核对 cns/st 里 command="名字" 的状态引用，输出六键接线矩阵。当用户问「某个攻击键没反应 / 按钮能不能用 / 键位接线 / 给角色补招式键」时使用。
---

# analyze-pad-buttons（手柄六键 × 角色资产接线分析）

## Purpose

回答「手柄上某个攻击键按下去为什么没反应 / 一个角色有几个键能用」。核心事实：
六钮的注入链路完全一致（settings.keys.p1 反查 → 合成 KeyboardEvent，引擎只读 ev.code），
**按下去有没有反应由角色资产决定**——两层都满足才有动作：

1. 角色 `.cmd`（def 的 `[Files] cmd=` 指定的文件）里存在用到该键的 `[Command]`；
2. 该指令被角色的 `.cns/.st/.zss` 状态以 `command = "名字"` 引用。

任一层缺失 = 该键没反应，且这是资产侧问题，不是手柄/引擎/注入链的问题。

## Input

必须提供：

1. **charsRoot**：角色根目录（资产集 `workshops/.../<包>/chars/` 或引擎 `ikemen-fs/file/chars/`）。
   目录名含中文没问题，脚本按 latin1 读 cmd、utf8 读 cns。

可选提供：

2. **charId 列表**：只分析指定角色（并输出每个被引用指令的按键明细）。
3. 怀疑的按钮：例如「X 没反应」——输出表里直接看 X 列。

## Process

### Step 1 — 跑接线分析

```sh
node .zcode/skills/analyze-pad-buttons/templates/analyze-pad-buttons-template.mjs \
  "workshops/toon-fighting-web/map_design/<资产集目录>/chars" [charId...]
```

输出六键矩阵：每角色一行，`✓` = 该键被「被状态引用的指令」使用；行尾是
指令总数/被引用数。带 charId 参数时会列出每条被引用指令的按键明细。

### Step 2 — 读矩阵，对号入座

| 现象 | 归属 |
|---|---|
| 某键列 `✓` 但按了没反应 | 才需要怀疑注入链（settings.keys.p1 / INI2CODE）或引擎 |
| 某键列 `·` | 资产缺这条指令的接线（cmd 无该键指令，或指令没被状态引用） |
| 全六键 `·` 且 指令数>0/被引用 0 | AI 打法包：cmd 有指令但状态机没接 `command=` 触发 |
| `(def 没挂 cmd)` | def 的 [Files] 缺 `cmd=` 行，引擎没有玩家指令可触发 |

### Step 3 — 结论落点

- 补键 = 资产侧工作：cmd 里加 `[Command]` + cns 里加 `command="…"` 触发的状态；
- 不要去改手柄/注入链——注入对所有钮一致，先排除（Step 2 第一行）；
- **技能条 v2 已直接消费同一套双层过滤**（`FFDecode.loadCommands`，见 Notes）——补完键后
  选人屏/对局的技能条会自动出现新招（0 wired 的角色技能条隐藏，补上即恢复显示）。

## Output

| 产出 | 说明 |
|---|---|
| 六键矩阵（stdout 表格） | 角色 × A/B/C/X/Y/Z 勾表 + 指令数/被引用数 |
| （带 charId 时）指令明细 | 每条被引用指令的名字与按键序列 |
| 结论 | 「某键没反应」的归属：资产缺接线 / def 缺 cmd / 注入链问题 |

## Reference Templates

- [templates/analyze-pad-buttons-template.mjs](templates/analyze-pad-buttons-template.mjs)：
  可直接运行的零依赖 Node 脚本（`{{charsRoot}}` 占位符见文件头用法注释）。

## Examples

参见 [examples.md](examples.md)：末世包 21 个角色的实测矩阵与「X 没反应」的归属判定案例。

## Notes

- 引擎键名与手柄钮同名对应：A轻拳=a、B中拳=b、C重拳=c、X/Y/Z攻击=x/y/z；START=s（本脚本不计）。
- 脚本零依赖、Node 直接跑；也可以拷到 `.cache/scripts/` 下执行（项目惯例：执行脚本进 .cache）。
- cmd 按 latin1 读、cns 按 utf8 读——指令名/触发名都是 ASCII，不受中文路径影响。
- 解析口径：command 序列里方向 token（F/B/D/U/DF/DB/UF/UB、`~` 保持、`30s` 时间）剥掉，
  只留 a/b/c/x/y/z；指令名大小写不敏感比较。
- 适用范围：本项目资产集/引擎 chars 布局（def 的 [Files] 段 `cmd=` 指定指令文件；一个目录
  可能有多个 def 时取目录内唯一 .def——多 def 包以「与目录同名」的入口 def 为准）。
- **MUGEN 指令时序语义**（补键/回放都要遵守；技能条 v2 的 `compileCommand` 已按此实现，
  调试钩子 `window.__tfCompileCommand(tokens)` 可在页面里直接编译查看注入时间线）：
  - 方向 token 是**滑动按住**——d→df 时 down 保持不松、按钮落在方向保持期里（波动拳语义）；
  - `~Ns` = 前一 token 按住 ≥N ticks 再松（蓄力，回放取 ≥320ms 下限）；
  - 连续相同方向 = 双击缓冲（前冲/疾退：第一击按下-松开，第二击重按）；
  - `>` 结尾 = 该键保持到序列结束。
  - 已知限制：回放固定按「P1 面向右」注入 F=right/B=left，对手换边后这类指令不触发
    （进阶路线：引擎 Lua 通道直接 changeState，需重编 wasm）。
- def 的状态文件键是**混用一族**：`St / St1..StN / Cns / StCommon`（SuWanqingKFM.def 实测）。
  要扫「状态引用」时必须广收 `st\d*|cns|stcommon`，只认 `st=` 会漏掉大部分状态文件。
