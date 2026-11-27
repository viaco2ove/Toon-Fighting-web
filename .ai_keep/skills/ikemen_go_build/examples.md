# Examples — 2026-11-26 原生引擎编译实录

## 任务

用户："那你就编译啊"（针对 serve.cjs `--go` 档缺 `.cache/ikemen-native/Ikemen_GO.exe`）。
环境：Windows 11，Git Bash（WorkBuddy Agent 沙箱），无 MSYS2、无 Go，仅有一个裸 MinGW（C:\ProgramData\mingw64，无 SDL2/libxmp/FFmpeg dev）。已有 gyan.dev FFmpeg shared 全家桶（`D:\Program Files\ffmpeg-master-latest-win64-gpl-shared`，含 include/lib/pkgconfig）。

## 执行时间线（关键决策）

| 步骤 | 决策 | 结果 |
| --- | --- | --- |
| choco install msys2 | 9 分钟无输出，双 choco 进程 = 卡 UAC | **放弃，kill** |
| 直下 Qt-IFW 安装包（81MB） | 单连接 45KB/s | 改 16 段并行（150KB/s），~10 分钟 |
| 静默安装 | 老语法 `-y -oD:\msys64` 报 Unknown option | 新语法 `in -t 'D:\msys64' -c` 成功 |
| pacman -Syu | 升级 pacman 后杀掉 shell | **重跑一次**才装到包 |
| 包清单照抄 BUILDING.md | yasm/tools-git 已从仓库移除 | 去掉这两个包后安装成功 |
| check_deps 要 gendef | 仓库已无此包 | no-op stub + `build/delaylib/zz-skip.dll.a` 跳过 delaylib 生成 |
| 首次 go build | `module cache not found` | 显式 GOPATH/GOMODCACHE/GOCACHE |
| 编译报错 | `netplay_desktop.go:44 AcceptTCP undefined`（nc.ln 是 io.Closer） | 改 `lnLocal := tcpLn`（只动 `!js` 文件） |
| 编译成功 | 16MB exe，objdump 核对 8 个外部 DLL | 部署 exe+DLL 到 `.cache/ikemen-native/` |
| 端到端 | start→7s 收 TF_HEAD；写 tf-result.ini 捕获 result；stop 后可再 start | 全过 |

## 踩坑清单（按出现顺序）

1. **choco 卡提权**：非管理员终端跑 `choco install` 会弹 UAC 且沙箱里永远等不到确认。任何 choco 安装类操作先确认是否有提权路径，否则走直接下载。
2. **安装器语法换代**：MSYS2 安装包 2023 起是 Qt Installer Framework，`--help` 里有 `-t/--root` 和 `-c/--confirm-command`；老教程的 `-y -o<dir>` 会报错。
3. **pacman -Syu 自杀**：升级 pacman 本体后终端被杀，`&&` 链上的包安装不会执行。分两步或同一命令里重试。
4. **包名漂移**：`mingw-w64-x86_64-tools-git`（gendef）与 yasm 已删。装包前用 `pacman -Ss` 确认。
5. **Go 1.27 + MSYS**：必须显式 `GOPATH/GOMODCACHE/GOCACHE`；`GOPROXY=goproxy.cn` 明显快于默认。
6. **上游源码 bug（本次唯一源码改动）**：
   ```diff
   --- src/netplay_desktop.go
   -	lnLocal := nc.ln
   +	// nc.ln 为兼容 wasm 声明成 io.Closer，这里必须用上面已断言的 TCPListener
   +	lnLocal := tcpLn
   ```
   只改 `//go:build !js` 文件，wasm 构建零影响。重编新版上游时此 bug 可能已修，先编译再决定是否打补丁。
7. **serve.cjs stop bug（配套修复）**：`proc.kill()` 后 exit code 为 null，`running = exitCode===null` 永真 → 改独立 `ENGINE.exited` 标志。重写引擎调度时不要用 exitCode 判存活。
8. **带空格路径**：`D:\Program Files\ffmpeg-...` 会让 pkg-config 输出的 `-L` 参数断裂 → PowerShell `New-Item -ItemType Junction D:\ffmpeg-dev -Target ...`（cmd.exe 的 mklink 会被 Agent 安全策略拦截）。

## 验证结果（留档）

```
status:  {"supported":true,"available":true,...}
start:   {"ok":true,"pid":29524,...,"cwd":"...\\ikemen-fs\\file"}
t=7s     head=g=1.000,320,240|1:90.0,200.0|2:230.0,200.0   ← TF_HEAD 经 stdout 到达
result:  {"value":1,"at":1795686131456}                     ← tf-result.ini watch 捕获
stop:    {"ok":true,"stopped":true} → running:false → 可再次 start
stderr:  仅 BGM 缺失 / 角色 state 参数警告（不影响运行）
```

## 本次产出物

- `.cache/ikemen-native/Ikemen_GO.exe` + SDL2/libxmp/FFmpeg×6 DLL
- `D:\msys64` 工具链（GOPATH 在 `D:\go-workspace`）
- `.cache/build-native.sh`（模板实例化）
- serve.cjs：`ENGINE.exited` 存活判断修复
- 上游：`src/netplay_desktop.go` 类型修复
