---
name: white-mold-conversion
description: 把一个 MUGEN 完整角色包转成灰白素体「白模」角色包并入库 Ikemen GO 引擎。当用户要求「转白模 / 白模化角色 / 做素体底座 / white-mold 转换 / 换成灰白人台」时使用。核心手法是只改调色板（.act + SFF v1 内嵌）不改任何像素，产出可直接进引擎的完整角色包（def/st/air/cmd/sff/snd/act），并以解码器渲染与引擎实测双重验证收尾。
---

# white-mold-conversion

## Purpose

把「下载来的彩色 MUGEN 角色包」变成**灰白素体（白模/人台）**，作为后续 AI 换身
（≤10 张 AI 整帧替换身体）的统一底座。白模的价值：

- 一眼可辨是占位素体，不冒充任何原角色；
- 保留原作者的明暗层次与体积感（按亮度映射灰阶，不做一刀切）；
- **一个像素都不动** → 轴点、AIR 动画、Clsn 判定、引擎兼容性与原包完全一致；
- 脚本化后分钟级/角色，可量产（一套骨架 × N 张头像/AI 帧）。

权威依据：引擎源码 `../Toon-WebMUGEN-2.0/ikemen-go-web/src/`（image.go / char.go / compiler.go），
格式工具 `ff-studio/sff.py`、`ff-studio/palette.py`（已踩平的坑都写在注释里）。

## Input

**必填**

| 项 | 说明 |
|---|---|
| 源角色包目录 | 完整 MUGEN 包（.def/.sff/.air/.cmd/.snd/.act），如 `ff-studio/white-mold/01_武道家/98Ryo` |
| 目标角色 id / 显示名 | ASCII id（引擎 argv 与 select.def 用，如 `LinYu`）+ 中文显示名（如 `林羽`） |
| 资产集落盘目录 | `workshops/toon-fighting-web/map_design/<故事>/chars/<id>/` |
| 引擎落盘目录 | `ikemen-fs/file/chars/<id>/`（运行副本，覆盖式同步，先备份旧包） |

**可选**

| 项 | 默认 |
|---|---|
| 灰阶参数 scale/min/max | 0.92 / 12 / 240 |
| 特效组保留彩色 | 不支持按组分档（SFF v1 调色板全文件共享），只有全灰或全彩 |
| def 的文件名映射表 | 按源包实际文件名写（见 templates/whitemold-template.py 的 `FILE_MAP`） |

## Process

### Step 1 — 核实源包（不许跳过）

```powershell
python ff-studio\sff.py <src>.sff info        # 精灵数/组数；确认 SFF v1（v2 不适用本技能）
cat <src>.def                                  # 记下 [Files] 全部引用、pal.defaults、stcommon
```

- def 引用的每个文件都必须在盘上存在，缺一个就先补源；
- 记下 `stcommon` 指向：包内文件还是 `common1.cns`（后者会由引擎 fallback 到
  `data/common1.cns.zss`，见 Notes 第 5 条）；
- 记下每个 cns 文件里有哪些 Statedef（判定跨文件状态号冲突）。

### Step 2 — 字节级探查 ps 字节（**不要猜，先实测**）

SFF v1 子头是 `<IIHHHHH>`（18B）+ 14B 无用尾巴，**第 18 字节（子头偏移 +18）是 `ps`**：

```powershell
# 输出 ps 直方图与调色板标记命中统计（模板见 templates/whitemold-template.py 的 probe_pack()）
python .cache\tmp-ps.py
```

判定规则（与引擎 image.go 逐行对齐）：

- `ps==0` 的精灵**自带调色板**：从块尾往前扫 `0x0C` 标记，命中处 +1 即 768B 调色板起点；
- `ps!=0` 的精灵沿用上游，**其块尾 768B 是 RLE 数据，动了必坏**；
- 首帧 `(0,0)` 走 legacy 路径：调色板直接位于块末 768B（无 `0x0C` 标记）。

### Step 3 — 转换（只改调色板）

```powershell
python ff-studio\whitemold.py pack <srcDir> <outDir>
```

脚本做三件事，全部在 `ff-studio/whitemold.py`（或 templates 模板）：

1. 逐精灵按 Step 2 的规则定位**自带**调色板 → 按 `v=0.299r+0.587g+0.114b`（Rec.601）
   映射灰阶，`clamp(v*0.92, 12, 240)`；索引 0 不动（引擎当透明）；
2. 6 套 `.act` 同样灰阶化（act 是**倒序**存储：文件第 i 个三元组 → palette[255-i]）；
3. cns/air/cmd/snd **字节级改名拷贝**（绝不重新编码——cns 是 CRLF+Shift-JIS 混合，
   引擎 `decodeShiftJIS` 读，重编码会乱码）；def 新写。

### Step 4 — 结构验证（改色前后对比）

```powershell
python .cache\tmp-verify.py   # 逐精灵对比 pixels / size / 组键 / 组帧数
```

验收标准：**像素有差异的精灵数 = 0**，精灵数/组数/组帧数与源完全一致。

### Step 5 — 渲染核对（灰白 or 彩色残留）

两层都做：

```powershell
# a) PIL 渲染（快）：0,0 / 20,0 / 300,0 等代表帧，肉眼确认灰白人台
python .cache\tmp-render.py
# b) 项目解码器渲染 + 饱和度统计（准）：灰占比必须 = 1.000，彩色对照 < 0.3
node .cache\tmp-proof.cjs
```

### Step 6 — 入库

1. 备份引擎侧旧包（如有）→ `.cache/<id>-vXX-backup/`；
2. 转换产物拷入资产集目录 `map_design/<故事>/chars/<id>/`，再覆盖同步到
   `ikemen-fs/file/chars/<id>/`（保留该目录下已有的 `avatar/` 素材）；
3. `select.def` 注册 `<id>/<id>.def`（引擎侧与资产集侧各一份，两份内容要一致）；
4. 写 README.md：底座来源与作者、授权口径（仅私有侧载）、白模化改了什么、
   AI 说明（有没有 `var(59)=1` 段 → 决定要不要跑 patch-char-ai.mjs）、下一轮路线；
5. 原作者说明（Leeme.TXT / readme.txt）保留为 `README-upstream.txt`。

```powershell
node .cache\scripts\rebuild-manifest.mjs        # 引擎 manifest，stamp 递增
node .cache\scripts\sync-pack-manifest.mjs      # 资产集 manifest 对齐引擎 stamp
```

manifest 同步后**必须复查字节数一致**（模板 `verify-checklist.md` 第 4 节）；
`select.def` / 引擎脚本这类两边文件不一致的，以引擎侧为准拷回资产集。

### Step 7 — 引擎实测

```powershell
node .cache\tmp-launch.mjs <cdpPort>            # 起测试 Edge（launchEdge 封装）
node .cache\scripts\verify-<id>.mjs .cache\shots-<id> <cdpPort>
```

探针断言（模板 `templates/verify-char.mjs`）：引擎起帧 >200、无 `missing sprite`、
无 cns 编译错误、facebar 出现该角色、无 JS 异常、截图目检素体形态。
URL 用 `?auto=1&p1=<id>&p2=<对照角色>&ai=4` 直启。

## Output

| 产物 | 位置 |
|---|---|
| 白模角色包（def/st×5/air/cmd/sff/snd/act×6/README） | `map_design/<故事>/chars/<id>/` |
| 引擎运行副本（同上 + 保留 avatar/） | `ikemen-fs/file/chars/<id>/` |
| 引擎 manifest 重建（stamp +1） | `ikemen-fs/manifest.json` |
| 资产集 manifest 对齐 | `map_design/<故事>/manifest.json` |
| select.def 注册 | 两侧 `data/select.def` |
| 验证截图与饱和度报告 | `.cache/shots-<id>/`、`.cache/gray/` |
| 永久工具（如尚无） | `ff-studio/whitemold.py` |

## Reference Templates

- [templates/whitemold-template.py](templates/whitemold-template.py)：整包转换脚本模板
  （`FILE_MAP`/`PAL_FILES`/`DEF_TEMPLATE` 三处按源包填占位符）
- [templates/verify-checklist.md](templates/verify-checklist.md)：入库与验证核对清单
- [templates/verify-char.mjs](templates/verify-char.mjs)：CDP 引擎实测探针模板

## Examples

- [examples.md](examples.md)：LinYu ← 98Ryo 全过程（含踩坑实录与验证数据）

## Notes

**四个致命坑（踩过一次，代价是整包重做）**

1. **只有 `ps==0` 的精灵自带调色板**。`ps` 字节在子头偏移 +18。`ps!=0` 的精灵
   沿用上游，其块尾 768B 是 RLE 数据——按块尾盲改会让 sff 解码直接报
   `IndexError`（实测）。规则：`ps==0` 时从块尾往前扫 `0x0C`；扫不到退化到
   `blockEnd-769`；首帧 `(0,0)` 走 legacy（块末 768B、无标记）。
2. **引擎对 SFF v1 的 ACT 是追加不是覆盖**（char.go loadPalettes：
   `Append ACT palettes instead of overwriting` + `Remap(0, targetIdx)`），且
   `palState.state%2==0` 的帧**强制从文件重读调色板**——所以 .act 与 sff 内嵌
   调色板必须**同步灰阶化**，只改一边会得到「部分帧彩色、部分帧灰白」的斑驳。
3. **`.act` 是倒序存储**（文件第 i 个三元组 → palette[255-i]，image.go
   readActPalette）；索引 0 永远不能动（引擎 alpha=0 当透明）。
4. **VFS 大小写敏感**（vfs.js `norm()` 不做 lower-case，manifest 是精确 key）：
   调色板平铺命名 `<id>1.act`，不要放进 `Pal/` 这种大写子目录。

**其它约束**

5. `stcommon = common1.cns` 在包内缺文件时，引擎按
   `{角色包, "", motif, "data/"}` 搜索并 fallback 到 `common1.cns.zss`（compiler.go
   6755 行）→ 命中引擎自带公共状态；正状态号**后编译的覆盖先编译的**
   （compiler.go 7111），所以角色自定义的 0/40/50/52 等不会被引擎版顶掉。
6. AI 闸：只有源包存在 `var(59) = 1` 式 AI Start 段才需要跑
   `patch-char-ai.mjs`；靠 `type = A` 状态 + 引擎内置 `AiInput` 的包**不需要**。
7. 依赖：Python 3.13 + Pillow（本机 `python` 可用，无 `python3`）；Node 22 +
   `server/lib/sff.cjs`（项目自带解码器）；CDP 探针借 `ws` 的路径见项目 AGENTS.md。
8. 版权：白模包仅私有侧载、不随资产集分发；README 必须署名原作者并保留其原说明。
9. 引擎侧与资产集侧的双 manifest / 双 select.def 必须逐字节核对一致，
   不一致以引擎侧为准拷回（sync-pack-manifest.mjs 会报「大小不一致」）。
