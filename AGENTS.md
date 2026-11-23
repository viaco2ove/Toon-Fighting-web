# AGENTS.md

## 项目概述

- 名称：Toon-Fighting-web
- 定位：把 Ikemen GO（MUGEN 兼容的 2D 格斗引擎）编译成 WebAssembly，在浏览器里直接用真实角色资产跑对局的网页格斗 demo。
- 工程形态：纯静态前端 + 一个自写的 Node 静态服务器。**无 package.json、无构建脚本、无 git 仓库**。
- 上游源码：`../Toon-WebMUGEN-2.0/ikemen-go-web`（Go + Lua 引擎源码，76 个 Go 文件）、`../Toon-WebMUGEN-2.0/web-test`（参考站点）。可读，改引擎需重编 wasm。

## 运行

```
node serve.cjs                 # 默认 8100
→ http://localhost:8100/index.html
```

Node 版本 v22.23.2，直接跑，不需要装依赖。

## 目录结构

- `index.html` —— 唯一页面外壳：加载屏、进度条、中文选人屏、「练 习 · 对手站桩」「正 式 对 战」「系 统 设 置」三颗按钮、首局等待遮罩、失焦暂停遮罩、按键回显、键位条。引擎参数由它按 URL query 拼出来。
- `serve.cjs` —— 静态服务器，no-store + Range 支持 + 正确的 wasm MIME。
- `ikemen.wasm`（约 24MB）/ `wasm_exec.js` —— 引擎本体与 Go runtime 胶水层。
- `vfs.js` —— 引擎虚拟文件系统。入口 `ikemenVfsInit(manifestUrl, preloadList, onProgress)`，懒加载 + localStorage 覆盖层。
- `ikemen-fs/manifest.json` —— `{"stamp": "...", "files": {"<相对 file/ 的路径>": <字节数>}}`。
- `ikemen-fs/file/` —— 336 个游戏资源文件：
  - `chars/{Hinako, K', Lin, Rugal2nd, 98-kim, MasterRyu}`（后两者资源残缺，缺 sff/cns，跑不起来）
  - `stages/` 9 个 def
  - `data/`：`system.def`、`select.def`、`common.*`、`fight.*`、`training.zss`
  - `external/script/`：`main.lua`、`start.lua`、`menu.lua`、`options.lua`、`debug.lua`、`default.lua`
  - `save/{config.json, stats.json}`（引擎运行时会回写）
  - `font/`、`sound/`
- `workshops/toon-fighting-web/{map_design, map_design_pre}` —— 美术资源工作区，未参与运行。
- `src/` —— 空。
- `.cache/` —— 一切测试脚本与实验产物都放这里（根目录不再放临时代码）：
  - `.cache/scripts/` 全部 CDP 探针脚本
  - `.cache/bak/` 原始文件备份（从 `ikemen-fs/file` 移出，manifest 本就不收录 `*.bak*`，故移出不影响引擎）
  - `.cache/shots-*`、`.cache/shots/`、`.cache/shots2..6` 历次截图

## 改动前必读的四条机制

1. **manifest.json 按文件大小登记，不同步就等于没改。**
   只要动了 `ikemen-fs/file/` 下任何文件（尤其 `.lua`），必须重建 `ikemen-fs/manifest.json`，否则引擎会静默加载旧内容——这是本项目最容易踩的坑，表现为「代码明明改了，引擎行为一点没变」。
   重建方式：遍历 `ikemen-fs\file` 递归所有文件、排除 `*.bak*`、key 取相对 `file/` 的路径并把 `\` 换成 `/`、值取字节数，写成 `{stamp, files}`。当前 stamp `local30`。

2. **AI 等级 0 = 人类控制，但角色包自带"野 AI"必须用 Ailevel 闸关掉。**
   两层缺一不可：
   - 引擎层：`setCom(n, 0)` 且必须在角色创建前生效（`main.lua` 的 `f_commandLine` 里先 `setCom(1,0)/setCom(2,0)` 再进 per-player 循环，循环内 `setCom` 先于 `selectChar`）。`controller` 在 `newChar` 时刻按 `aiLevel != 0` 定死，事后 setCom 不改 controller。
   - 角色层：Hinako / Rugal2nd / K' / Lin 的 AI Start 块原来是 `RoundState=2 && 敌人活着 → var(59)=1`，不看 Ailevel，会把"人类"角色照样打成电脑。四个文件已各加一行 `TriggerAll = Ailevel > 0`（带 `;[toon]` 注释）：练习模式（Ailevel=0）AI 关死，正式对战（Ailevel>0）不受影响。补丁脚本 `.cache/scripts/patch-char-ai.mjs`，新角色包要跑一遍。

3. **窗口被遮挡会整体死锁。**
   浏览器停掉 rAF → 引擎 `refresh()` 忙等帧通道 → wasm 主线程卡死。表现就是「画面冻结 / 像卡死 / 帧率约 2 帧/秒」。headless 与可见窗口都复现，`Page.bringToFront`、Win32 `SetForegroundWindow` 只能短暂缓解。**调试和游玩都必须保持窗口最前。**

4. **vfs.js 有 localStorage 覆盖层。**
   老页面的 localStorage 会压住服务器的新文件。改完资源验证时，若行为像旧版本，先清 localStorage 或换全新 user-data-dir 的浏览器实例。

5. **系统设置（键位/性能/个性化）经 mod overlay 注入为 `save/user-config.ini`。**
   index.html 的设置面板把设置存 localStorage `toonfight:settings-v1`，boot() 时用 vfs.js 的公共 API `ikemenMods.add('save/user-config.ini', bytes)` 写进 IndexedDB overlay（必须在 `ikemenVfsInit` 之前，overlay 在其内部装载），argv 带 `-config save/user-config.ini` 让引擎优先读它（config.go 会把内置 defaultConfig.ini 叠在下面，first-wins，所以只写覆盖项）。键位段是 `[Keys_P1]`/`[Keys_P2]`（up/down/left/right/a/b/c/x/y/z/start/d/w），分辨率是 `[Video] GameWidth/GameHeight`，音量是 `[Sound] MasterVolume/WavVolume/BGMVolume`。键名枚举见 `ikemen-go-web/src/input_js.go` 的 `KeyToStringLUT`。引擎启动时会把合并后的完整配置回写到该文件（经 vfs 持久化到 localStorage `ikemen-vfs11:save/user-config.ini`），但下次 boot 仍会被设置面板的 overlay 覆盖——**设置面板是键位/分辨率/音量的唯一真源**。验证脚本：`.cache/scripts/verify-settings.mjs <outDir> <port> panel|match`。

## 键位

- P1：`←↑↓→`，A=`z` B=`x` C=`c` X=`a` Y=`s` Z=`d`，Start=`Enter`，D=`q` W=`w`，Esc
- P2：`j k l i`（←↓→↑），A=`f` B=`g` C=`h` X=`r` Y=`t` Z=`y`，Start=`RShift`，Back=`Tab`

## 调试

CDP 探针脚本统一在 `.cache/scripts/`，运行方式 `node .cache/scripts/cdp-watch.mjs <outDir> <port> <secs>`。**注意两个非显性约束**：

- 脚本用 `createRequire('file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/')` 去另一个工程借 `ws` 依赖，项目本身没有 `node_modules`；那条绝对路径失效的话所有探针都会挂在 `require('ws')`。
- 输出目录参数是相对当前工作目录解析的，从项目根跑就传 `.cache/shots-xxx`，别传裸名字否则会落在根目录。

- `node cdp-log.mjs <port> <url> <secs>` —— 只监听 console/exception，不 evaluate。**判断 Lua 有没有执行、卡在哪一步，用它最可靠。**
- `node cdp-watch.mjs <outDir> <port> <secs>` —— 纯截图。窗口失焦时 `Page.captureScreenshot` 会超时。
- `node cdp-input-test.mjs "<url>" <outDir> <port>` —— reload + 静置 + 按键 + 连拍，人控实验。
- `node .cache/scripts/probe-p2.mjs <outDir> <port>` —— 按住 P2 左键 1.4 秒前后各拍一张，验证 P2 吃键盘。
- `node .cache/scripts/watch-loop.mjs <outDir> <port> <secs> <interval>` —— 定时连拍不退出，低帧率长观察必用。
- `node .cache/scripts/patch-char-ai.mjs` —— 给角色包 AI Start 块加 `Ailevel > 0` 闸（新角色包入库后跑一遍）。
- `node .cache/scripts/verify-settings.mjs <outDir> <port> panel|match` —— 系统设置面板截图 + user-config.ini 注入/引擎回写验证。
- `cdp-stance.mjs` / `cdp-dummy.mjs` / `cdp-probe.mjs` / `cdp-mini.mjs` —— 针对特定实验的观察探针。

起一个可调试的 Edge：

```
msedge --remote-debugging-port=<port> --user-data-dir=<临时目录> \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding --no-first-run <url>
```

引擎的 `print` 会进 DevTools console。Lua 侧没有 `getAILevel` 之类的便捷接口，诊断只能靠 print。

## 开发规范

- 无构建步骤：改完直接重启 `serve.cjs` 或强刷浏览器（`vfs.js` 有 localStorage 覆盖层，必要时清 localStorage）。
- 改 Lua 的标准流程：编辑 `external/script/*.lua` → 重建 manifest → 强刷 → 用 `cdp-log.mjs` 确认 print 是否出现。
- 不要直接改：`ikemen.wasm`（要 Go 工具链重编）、`vfs.js`（vendor）、`wasm_exec.js`（Go 官方胶水）。
- 测试脚本、截图、备份、临时文档一律放 `.cache/`，不要散落在根目录。
- `.env` 里有服务地址与 `auth_token`，**禁止外泄、禁止写进任何文档或提交**。

## Agent 注意事项

- 结论先行，给实证（截图、进程号、帧数、日志），不要空谈。
- 遇到「改了没反应」，第一反应先查 manifest 有没有重建，而不是再改一遍代码。
- 判断「P1 到底是不是人控」这类问题，用不发键的对照实验（静置 vs 只按一键），不要靠回显或推测。
- 上游引擎语义要看源码：`../Toon-WebMUGEN-2.0/ikemen-go-web/src/{system_js.go, char.go, script.go, input.go}`。
