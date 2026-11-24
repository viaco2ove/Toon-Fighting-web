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

- `index.html` —— 唯一页面外壳，**已按 `md/curdesign/ai格斗设计/界面设计/` 10 份设计文档 + `prototype/` 高保真原型重构**（2026-11-25 二轮）：主界面 `#home`（**2026-11-25 三轮按 prototype/home.html 重写**：stage 760px 居中 + brand 行=左 `TOON·FIGHTING` 金色小标 22px/右联动状态点+文本 `#home-conn-text` + 三张 card（当前故事=nm+金「切换故事」钮 / 资产集绑定=pn+pv meta+「选择资产集文件夹」 / 角色的实体绑定=pn+「点击进入 ›」）+ `.btns` 一行四钮 grid（练习/对战红边/生存绿边/设置，small=TRAINING·VERSUS·SURVIVAL·SETTINGS 文案）；老版大 logo/ctxline/底部提示条已删；空态样式走 `.free` 类，JS `renderHomeStory`/`renderPackLine`/`probeConn` 已适配）、故事列表 `#story`（**2026-11-25 三轮按 prototype/story-list.html + roster-bind.html 重写：整页 overlay（radial 底 + `#story .stage`）+ head=「← 返回主界面/← 会话列表」链接 + h1（选择故事 / 角色实体绑定）+ `.hint` 状态行 + 会话卡 `.sess`（44px 📖 图标块 + 标题+● 当前 + 描述 + 右侧 meta 角色数/时间，1 列整行）；点会话 → 实体绑定视图 `.rostering`（stage 780、`.brow` 三栏 grid `1fr 30px 1fr`＝左 toonflow 头像 46px+名+职业金徽章 / 中「:」/ 右 select+棋盘格 `.mava` 46px、底部金渐变整行【保 存】）；`#story-close`/`#sr-back` 两个返回链接按视图切换显隐**）、会话卡片 → 点选 → 拉故事全部角色 → 自动随机分配默认资产 → **持久化** → 角色实体绑定视图（左 toonflow 头像+名+职业徽章，右 MUGEN 实体头像+下拉换绑；**无站位下拉/无随机/无开打按钮**，`saveRoster` 落盘前 `autoSideRoster()` 按列表顺序自动分配 side：第 1 个=p1、第 2 个=p2、其余 bench；底部只有【保存】）、资产集选择器 `#packpick`、**街机风选人屏 `#select`**（樱街机截图式：粉红天空渐变+云层背景、金属斜体 `#sel-title`、左右斜切 clip-path 大头像面板 `.port`（巨型金属字名字 `.pname`+信息条 `.pinfo`=toonflow 名+实体 id+职业）、透视地板 `.floor`（rotateX 52deg，5 列 `.k` 格+`?` 随机格，选中金框+出场序号）、已选小头像行 `#selrow`（金色序号，点击切编辑位）、⇄ 出场顺序交换 `#btn-swp`、顶部模式/人数 bar、底部双名字条+难度+红色【开始】；左上 `≡ 菜单` 下拉=回主界面/切换故事/角色实体绑定/直接开打/系统设置；1/3 人编队、可取消重选；生存模式隐藏 p2 面板）、战斗层（双头像 facebar=toonflow 头像+名+职业+战绩 与 MUGEN 头像并排，**top 108px 避开引擎血条**；快捷技能 `#skills`=**2 列网格 bottom 272px**，超过 5 个自动分页+「🔁 切换技能组 n/m」按钮，发键走 INI2CODE 反查；**虚拟手柄=左下虚拟摇杆 `#joy`**（170px 圆底座+可拖 stick，pointer capture，八方向 atan2 判定 deadzone 13px，对角双键：NE=↑+→，松手/失焦自动释放全部方向键，注入走 `settings.keys.p1` 反查）；**攻击键 2×3 六键 `#pad .bt`**（A/B/C/X/Y/Z）+ START 底部居中；战斗菜单 `#bmenu`（练习假人 站桩/跳跃/防守/自由攻击 四行为=前端周期注入 P2 键实现；招式查看）；`#countdown` 3 秒倒计时；`#speech` 发言条**打字机式逐字显示**，发言 agent 走 `/api/conn/agent/speech`（人设/世界观提示词在 `server/lib/speech-agent.cjs` 组装，fire-and-forget 不阻塞对局，接口挂了静默跳过）；实体头顶悬浮头像 `#headav`（引擎 TF_HEAD 坐标包驱动，系统设置可隐藏，坐标口径见机制 10））、生存模式链（胜→`?mode=survival&stage=N+1&ai+1&auto=1` reload 续关，负→回主界面，best 存 localStorage）。`startEngine(p1List, p2List, aiVal)` 多编队签名，3 人走 `-p1/-p3/-p5 -tmode1 1`；`?auto=1&p1=&p2=&ai=` 直启路径保留。前端 localStorage：`toonfight:settings-v1`（+battle:{speech,countdown}；pad 默认 **show**——设计文档要求虚拟手柄默认显示）、`toonfight:pack-v1`、`toonfight:survival`、`toonfight:server-v1`。
- `serve.cjs` —— 静态服务器，no-store + Range 支持 + 正确的 wasm MIME。**兼做 BFF**：
  - 不依赖 `--conn` 的本地接口：`GET /api/assetpacks`（扫 `workshops/toon-fighting-web/map_design/*/pack.json`，返回包列表+本地可跑角色+`--story` 指定的资产集）、`GET /api/packs/:dir`（资产集元数据 pack/story/roster/mapping）、`GET /api/portrait/:charId`（**从角色包 sff 解出头像 PNG**，见 server/lib/portrait.cjs）、`GET /api/role-avatar/*`（toonflow 角色头像代理，OSS 相对路径→图片字节，**用后端项目的 sharp 缩到 192px webp**，8MB→7KB；无 sharp 时降级返回原图）。
  - `--conn` 时的 `/api/conn/*`：`status`（联通自检+当前登录用户）、`sessions`（会话列表，60s 缓存）、`sessions/:sid/messages`（NDJSON 重组）、**`sessions/:sid/roles`**（会话→故事全部角色：先 getSessionMeta 取 worldId 再 getWorld 取 `settings.roles`，含 name/roleType/description/avatarPath/skills）、`session-data/:sid/:key` 读写（PUT 800ms 同 key 合并）、`agent/generate`（生图）、`agent/chat`（通用文本）、**`agent/speech`**（格斗台词，提示词由本项目构造）、**`login`**/**`register`**（账号登录/注册，**后端 token 只存服务端内存表**，页面只拿到 HttpOnly cookie `tf_sid`，页面 JS 永远接触不到后端 token）。
  - 会话 token 优先于 .env token；会话 token 失效时**不**用 .env token 顶替（那是另一个账号），直接报「登录已过期」。
- `server/lib/` —— 本项目自带的 BFF 支撑模块（零依赖，Node 直接 require）：
  - `sff.cjs` —— **MUGEN SFF/ACT 解码器**：SFF v1（PCX+RLE）与 v2（raw/RLE8/RLE5/LZ5/PNG）的精灵目录、调色板、像素→RGBA。字节布局以本项目引擎 `../Toon-WebMUGEN-2.0/ikemen-go-web/src/image.go` 为准（`SffHeader.Read`/`readHeader`/`readHeaderV2`/`readV2`/`loadPalettes`/`readActPalette`/`RlePcxDecode`/`sffv1PalState`），并与 bitcraft/mugen-tools 的 `sff.py` 交叉核对。
  - `portrait.cjs` —— 从角色包提取头像：候选精灵 `9000,0`（引擎 portrait.spr，选人格 25×25）→ `9000,10`/`9000,222` → `9000,3` → `9000,2` → `0,0`，按 `portraitScore`（不透明占比/长宽比/颜色数）择优；**排除 9000,1**（那是动画帧横向拼贴图，不是头像）。
  - `png.cjs` —— 最小 PNG 编码器（RGBA8，node:zlib + 自带 CRC32）。
  - `packs.cjs` —— 资产集扫描与元数据读取。
  - `speech-agent.cjs` —— **发言 agent（写在本项目）**：按角色人设+故事世界观构造 system/user 提示词，走后端 `plugin-llm` 通道；输出清洗（剥围栏/引号/「角色名：」前缀）。
- `ikemen.wasm`（约 24MB）/ `wasm_exec.js` —— 引擎本体与 Go runtime 胶水层。
- `vfs.js` —— 引擎虚拟文件系统。入口 `ikemenVfsInit(manifestUrl, preloadList, onProgress)`，懒加载 + localStorage 覆盖层。
- `ikemen-fs/manifest.json` —— `{"stamp": "...", "files": {"<相对 file/ 的路径>": <字节数>}}`。
- `ikemen-fs/file/` —— 336 个游戏资源文件：
  - `chars/{Hinako, K', Lin, Rugal2nd, Leona, 98-kim, MasterRyu}`（后两者资源残缺，缺 sff/cns，跑不起来；Leona=KOFA 版，var(59) 天然惰性免 AI 闸）
  - `stages/` 9 个 def
  - `data/`：`system.def`、`select.def`、`common.*`、`fight.*`、`training.zss`
  - `external/script/`：`main.lua`、`start.lua`、`menu.lua`、`options.lua`、`debug.lua`、`default.lua`、`headavatar.lua`（实体头顶悬浮头像的坐标输出，见机制 10）
  - `save/{config.json, stats.json}`（引擎运行时会回写）
  - `font/`、`sound/`
- `workshops/toon-fighting-web/{map_design, map_design_pre}` —— 美术资源工作区，未参与运行。
- `android_h5/` —— Capacitor 7 安卓打包工程（形态 B），把站点装进 APK 侧载：
  - `node sync.mjs` 把 index.html/vfs.js/wasm_exec.js/ikemen.wasm + ikemen-fs 全量（含 chars/stages，134MB 级）复制进 `www/`（排除 `*.bak*`）；APK 是私有侧载不分发，所以资产全量打包。
  - `npm run apk:debug` = sync + `npx cap sync android` + `gradlew assembleDebug`，产物 `android/app/build/outputs/apk/debug/app-debug.apk`（约 84MB，wasm/资源已被 zip 压缩）。
  - 构建环境：JAVA_HOME 必须指 `D:\Users\viaco\.jdks\jdk-21.0.10+7`（PATH 里的 java 1.8 无关）；`android/local.properties` 已写 SDK 路径（被 .gitignore，换机器要重写）；gradle wrapper 指向本地已缓存的 `gradle-8.14-all.zip` 免下载；`android/build.gradle` 前置了阿里云 maven 镜像（google/public/gradle-plugin），google()/mavenCentral() 兜底。
  - `www/`、`android/app/build/`、`local.properties` 都在 `android_h5/.gitignore` 里；`android/` 平台源码要提交。改了 web 层文件后要重跑 `node sync.mjs && npx cap sync android` 才会进 APK。
  - 虚拟手柄：设置项 `settings.pad`（auto/show/hide，默认 auto=触屏显示），注入走 INI2CODE 反查 `settings.keys.p1` 后合成 KeyboardEvent（引擎只读 `ev.code` 不校验 isTrusted，`system_js.go:96-120`）；改绑键位后手柄自动跟随。蓝牙手柄走 `input_js.go` 的 getGamepads 轮询，零代码可用。
  - 验证脚本 `.cache/scripts/verify-pad.mjs <outDir> <port>`（无头 Edge，桌面默认隐藏→UI 开 show→reload→touch 注入→keyecho 全链路）。
- `md/curdesign/ai格斗设计/` —— 故事联动设计文档（总体设计 + 资产集 tbg 子设计）。
- 故事联动（形态 B/C，serve.cjs --conn）：
  - serve.cjs 兼做 BFF 代理：前端只打同源 `/api/conn/*`（status/sessions/messages/session-data/agent.generate/story），token 只在 serve.cjs 内存、永不进页面；401 自动用 .env 账号重登；sessions 60s 缓存；pluginData 同 key 写 800ms 合并。**对局进行中前端 0 请求是硬红线**。
  - 后端 toonflow-game-app（.env `game_app_service_url`，本地 60002）：登录 `POST /other/login`；会话 `POST /game/listSession`；消息 `POST /game/getSession` 是 **NDJSON 流**（meta→message×N→done，serve.cjs 已重组）；插件数据 `POST /plugin/data {sessionId, pluginId, op:get|set|list|remove, dataKey, value}`（pluginId 固定 `com.viaco.toon-fighting`）；生图 `POST /plugin/agentRun {agentName:"field-survival-sprite-gener", input:{prompt,refImages≤3,size}}`。
  - index.html「故事联动」面板：`?conn=1` 自动打开；会话卡片 → 角色分配（从消息 role/roleType 提取角色，narrator/system 排除，按出场次数取前 6）；持久化 key：`tf_fight_roster`（side: p1/p2/bench + charId + 战绩）、`tf_fight_bind`（storyName/sessionId/worldId）。开打=第一个 p1 出 P1、第一个 p2 出 P2。
  - 验证脚本 `.cache/scripts/verify-story.mjs <outDir> <cdpPort>`（面板自动开→列表→分配→保存服务端读回→开打 HUD VS→reload 持久化）。设计文档：`md/curdesign/ai格斗设计/ai格斗联动-总体设计.md`（里程碑 M1-M6，M3=HUD 头像条+结算回写，M4=tbg 资产集，M5=AI 头像）。
  - M3 结算信号（已验收）：网页开打 = argv `-p1/-p2/-loadmotif` 走 main.lua `main.f_commandLine()` 的 **quickmatch-with-motif 分支**（4309 行条件），一场打完 `game()` 返回后 `os.exit()` 结束进程——`start.f_game` 根本不在路径上。结果信号：quickmatch 尾部 + `start.f_game` 内均 `saveIni({Result={value,mode,t}}, 'save/tf-result.ini')` → vfs.js 对 `save/` 下文件防抖 400ms 持久化到 localStorage `ikemen-vfs11:save/tf-result.ini`（base64，纯 JS 定时器，紧跟的 os.exit 不影响落盘）；index.html 每 500ms 轮询该 key，内容变化→onMatchResult（PUT 回写一次 + 6s 后自动 reload 回分配视图）。**引擎一场一进程**，复开下一场靠 reload。诊断注意：Lua print 经 vfs `writeStd`→console.log 是通的（主 chunk 实测可见），但 CDP 探针必须监听 `Runtime.consoleAPICalled` 才能抓到；`Log.enable` 在新版 Edge 不回放 console.log。headless 保活按键别用 Enter（P1 Start=开暂停菜单），用 Z。验证脚本 `.cache/scripts/verify-result.mjs <outDir> <port>`（facebar→挂机→settled 标志→服务端战绩读回，已全绿）。
- `src/` —— 空。
- `ff-studio/` —— 角色资产工具链（Python + Node）：
  - `sff.py` —— SFF v1 读写（精灵目录统计 / 导出 PNG / contact sheet / 像素替换 / 调色板重映射）
  - `palette.py` —— .act 调色板（**倒序存储**：文件第 i 个三元组 → palette[255-i]）
  - `whitemold.py` —— **白模（素体）化**：只改调色板不碰像素，把彩色包转灰白人台
    （详见 `.zcode/skills/white-mold-conversion`）
  - `gen-ai-frames.mjs` —— **AI 整帧关键帧生成**：带参考图（avatar/full.png + head.png）直连后端
    `/plugin/agentRun` 的 sprite agent + 四角 BFS 抠白得透明底（详见
    `.zcode/skills/char-assets-keyframes-generation`）
  - `src/viewer.html` —— 角色资产查看器（`http://localhost:8100/ff-studio/src/viewer.html`）：
    三个标签页——**动作列表** / **精灵浏览** / **关键帧**。关键帧页上半是 AI 关键帧资产对照
    （左白模代表帧 ↔ 右 AI 整帧，从 `chars/<id>/keyframes/` 读），下半是白模分级分析
    （L0/L1/L2 规模分层 + A/B/C 关键帧分级，口径同 `.cache/scripts/analyze-keyframes.mjs`）。
    服务器模式会跟随 def 的 `[Files]` 抓全量文件，**并单独抓 `keyframes/` 目录**（它不在 def 里）。
- `.cache/` —— 一切测试脚本与实验产物都放这里（根目录不再放临时代码）：
  - `.cache/scripts/` 全部 CDP 探针脚本
  - `.cache/bak/` 原始文件备份（从 `ikemen-fs/file` 移出，manifest 本就不收录 `*.bak*`，故移出不影响引擎）
  - `.cache/shots-*`、`.cache/shots/`、`.cache/shots2..6` 历次截图

## 改动前必读的四条机制

1. **manifest.json 按文件大小登记，不同步就等于没改。**
   只要动了 `ikemen-fs/file/` 下任何文件（尤其 `.lua`），必须重建 `ikemen-fs/manifest.json`，否则引擎会静默加载旧内容——这是本项目最容易踩的坑，表现为「代码明明改了，引擎行为一点没变」。
   重建方式：遍历 `ikemen-fs\file` 递归所有文件、排除 `*.bak*`、key 取相对 `file/` 的路径并把 `\` 换成 `/`、值取字节数，写成 `{stamp, files}`。重建脚本 `node .cache/scripts/rebuild-manifest.mjs`。当前 stamp `local38`。

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

6. **加载屏必须在主界面出现时收起（2026-11-24 踩过）。**
   `#boot` 是 `z-index:50` 的全屏遮罩，压在 `z-index:40` 的 `#home` 上面。boot() 的主界面路径里那句 `bootEl.classList.add('done')` 一旦丢了，**主界面其实渲染好了却被加载屏盖住**，表现就是永远停在「30% · 清单就绪」（清单已就绪、引擎没起、没报错）。重构 boot() 时这条最容易丢。复现/回归脚本：`.cache/scripts/repro-30.mjs <outDir> <url>`（读 DOM 类名 + 中心点命中元素 + 截图）。

7. **MUGEN 头像只能从 9000,0 取；9000,1 是动画帧拼贴图。**
   引擎 `system.def` 的 `portrait.spr = 9000,0`（各角色都是 25×25 选人格头像）；`9000,1` 是 `p1.face.spr`，是**多帧横向拼接**的 374×480 大图，直接当头像会显示成一堆重复画面。取色有两条完全不同的路径（引擎 `Sprite.read` 的预载路径 vs `sffv1PalState` 状态机），把两者混用会让「9000,0 恰好是该包目录首个精灵」的角色（Hinako/K'/Leona）拿到错误调色板或解不出像素。`server/lib/sff.cjs` 是按引擎逐行移植的，改动前先读 `../Toon-WebMUGEN-2.0/ikemen-go-web/src/image.go`。

8. **toonflow 的角色头像是 1024 级的 webp/png（8–10MB），必须缩。**
   角色 `avatarPath` 指向 OSS（`/1/game/scene/<uuid>.webp`），直接 `<img src>` 会把页面拖死。BFF 用**后端项目里的 sharp**（`../../toonflow-game-app/node_modules/sharp`）缩到 192px webp（8.4MB → 7.4KB），找不到 sharp 时降级返回原图。sharp 是后端的依赖、不是本项目的——本项目仍无 package.json。

9. **引擎的选人/VS 画面要按确认键才进对局。**
   引擎启动后先走自己的选人流程（`select.def` 里列的角色），不是直接进战斗。headless 验证脚本必须模拟按 Enter 推进（旧脚本 `verify-result.mjs` 就是这么做的）。这不是 bug。

10. **TF_HEAD 头顶头像的坐标口径（2026-11-24 实测标定，勿凭直觉改）。**
   `external/script/headavatar.lua` 每 4 帧输出 `TF_HEAD:g=<zoom>,<gameW>,<gameH>|1:<x>,<y>|2:<x>,<y>`，index.html 的 `#headav` 据此定位。三个坑都实测过：
   - 引擎的 `screenPosX()/screenPosY()` **不含相机缩放**（char.go:6131 的 TODO 注释），Lua 侧已按 `anim.go:1456` 的渲染管线反推补偿：`x += gameWidth/2*(1-1/zoom)`、`y += cameraPosY*(1-1/zoom)`；zoom=1 时退化为原值。
   - `gameWidth()` 实测返回 **320**（不是 canvas 的 640×480，中间隔着 `widthScale`）。前端缩放必须用坐标包里的 gameW/gameH 除以 canvas 的 contain-fit 内容区，**不要**用设置面板的分辨率。
   - `spriteVar("height")` 是精灵位图尺寸、**含透明边距**（Hinako 站立 sprH=126，实际画出 ~70 游戏像素），不能拿来当抬升量。前端用固定抬升 102 游戏像素（角色实测身高 70~100）。2026-11-25 原型对齐：`.ha` 盒内只剩 46px 白边方块（**名字条已删**），方块底=style.top，故 84→102。

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
- `node .cache/scripts/verify-settings.mjs <outDir> <port> panel|match` —— 系统设置面板截图 + user-config.ini 注入/引擎回写验证（panel 走 home-settings 开面板；match 走 `?auto=1` 直启等 boot ready，不等主界面）。
- `node .cache/scripts/lib/cdp.mjs` —— **共用的轻量 CDP 客户端**（`launchEdge`/`connect`/`checker`）：起独立 user-data-dir 的 Edge、真实鼠标事件点击（`clickSel`）、视口模拟、断言收集。`--user-data-dir` 必须是绝对路径（相对路径 Edge 起不来）；清理进程时按 profile 目录名过滤，**不要误杀用户自己开着的 Edge**。
- `node .cache/scripts/verify-ui.mjs <outDir> <cdpPort>` —— **界面全链冒烟**（连到已起的 Edge）：主界面→选人（预填/3 人编队）→练习开局（引擎起帧）→facebar/skills/pad/bmenu→无 JS 异常。起 Edge 用 `node .cache/tmp-launch.mjs <cdpPort>`（launchEdge 封装）。
- `node .cache/scripts/verify-conn.mjs <outDir> <cdpPort>` —— **联动端到端（14 断言）**：需 8100 跑 `node serve.cjs -- --story <名> --conn` + 已起的 Edge。故事列表→点会话→角色实体绑定（双头像加载/职业徽章/换绑头像跟随/随机分配/保存）→服务端读回持久化→用此分配开打→选人预填→引擎起帧→facebar 双人→无 JS 异常。需真实后端（.env）。
- `node .cache/scripts/repro-30.mjs <outDir> <url> [cdpPort] [w] [h]` —— 「卡在 30%」回归：读 boot/home 的类名 + 中心点命中元素 + 截图。
- `node .cache/scripts/sff-inspect.mjs` —— 逐个角色包 dump SFF 目录（版本/精灵数/目录链/9000 系列尺寸），验证 `server/lib/sff.cjs` 的解析。
- `node .cache/scripts/probe-layout.mjs <url> [cdpPort] [w] [h]` —— 量各 UI 元素的几何位置，查重叠（技能按钮 vs 手柄、facebar vs 引擎血条）。
- `node .cache/scripts/probe-select.mjs <outDir> <cdpPort>` —— 选人屏专项（versus 打开、面板/地板几何、异常采集、截图）。
- `node .cache/scripts/probe-fight.mjs <outDir> <cdpPort>` —— 战斗层专项（?auto=1 直启、pad/skills/headav 状态、摇杆注入 keyecho、异常采集、截图）。
- `node .cache/scripts/shot-fight.mjs <outDir> <url> [cdpPort]` / `shot-series.mjs` —— 对局画面单张 / 连续采样。
- `node .cache/scripts/probe-shot.mjs <outDir> <file> <url> <cdpPort> [ms]` —— 通用单页截图（无头，1280×800），原型对照基准 `.cache/shots-proto/proto-select.png`/`proto-fight.png` 与实做对照就靠它。
- `node .cache/scripts/probe-home.mjs <outDir> <cdpPort>` —— 主界面 vs prototype/home.html 结构断言（stage 760/三卡/四列按钮/边框色/老版元素已删/练习按钮冒烟），连已起 Edge。
- `node .cache/scripts/probe-story-settings.mjs <outDir> <cdpPort>` —— 故事列表/实体绑定/设置面板 vs prototype 断言（39 条：stage 680/780、`.sess` 结构、`.brow` 三栏+46px 双头像+棋盘格、金保存钮、设置整页 880+h1 26px+5 tab+connbox×2+底栏双钮），需 8100 `--conn`。
- `node .cache/scripts/verify-leona.mjs <outDir> <port>` —— Leona 入库验证（?auto 直启 Phase A AI 对打→settled；Phase B 人控对照）。
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
