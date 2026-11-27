---
name: ikemen_go_build
description: 在 Windows 上从上游源码编译原生 Ikemen GO 引擎（Ikemen_GO.exe）并部署到 Toon-Fighting-web 的 serve.cjs `--go` 启动档。涵盖 MSYS2/MINGW64 工具链安装、依赖包处理、编译、DLL 部署与端到端验证。Use when the user asks to 编译原生引擎 / build native Ikemen_GO / 出引擎原生版 / rebuild ikemen exe / 部署 --go 档。
---

# ikemen_go_build

## Purpose
把「编译原生 Ikemen GO 引擎 + 接入 serve.cjs `--go` 档」这件上下文密集的事固化成可重复流程。适用场景：
- `.cache/ikemen-native/Ikemen_GO.exe` 缺失，serve.cjs `--go` 档回落 wasm，需要出原生版
- 上游 `Toon-WebMUGEN-2.0/ikemen-go-web` 源码更新后需要重编
- 换机器 / 新环境从零搭建编译工具链

## Input

必须提供：

1. 上游引擎源码路径（默认 `../Toon-WebMUGEN-2.0/ikemen-go-web`，含 `build/build.sh` 与 `src/`）
2. 目标部署目录（默认本项目 `.cache/ikemen-native/`）

可选提供：

3. FFmpeg 开发库路径（有 gyan.dev shared 版可跳过从源码编 FFmpeg，省 ~20 分钟；没有就让 build.sh 自动编）
4. MSYS2 安装位置（默认 `D:\msys64`；`C:\msys64` 亦可，只要当前用户可写）

## Process

### Step 1 — 环境侦查
- [ ] `go version` / `which gcc pkg-config make nasm` 是否已可用
- [ ] 是否已有 MSYS2（`ls -d /c/msys64 /d/msys64`）
- [ ] 是否已有 FFmpeg shared 开发包（带 `include/` + `lib/*.dll.a` + `lib/pkgconfig/`，gyan.dev 版即符合）
- 已齐全则直接跳到 Step 4。

### Step 2 — 安装 MSYS2（缺才做）
- **不要用 `choco install msys2`**——非管理员终端会卡在 UAC 提权提示上无限等待。
- 从 `https://repo.msys2.org/distrib/x86_64/` 取最新 `msys2-x86_64-*.exe`。网络慢（<100KB/s）时用 [templates/parallel-dl.sh](templates/parallel-dl.sh) 分段并行下载后 `cat` 拼回。
- headless 安装（新版是 Qt Installer Framework，**不是** 7z SFX 的 `-y -o` 语法）：
  ```bash
  MSYS2_ARG_CONV_EXCL='*' /d/msys2-installer.exe in -t 'D:\msys64' -c
  ```

### Step 3 — pacman 装依赖
- 先把国内镜像提到 mirrorlist 最前（`/etc/pacman.d/mirrorlist.mingw` 与 `mirrorlist.msys` 各加三行清华/USTC/BFSU）。
- `pacman -Syu --noconfirm` **会升级 pacman 自身并杀掉当前 shell**——必须再执行一次才能真正装包：
  ```bash
  MSYSTEM=MSYS /d/msys64/usr/bin/bash.exe -lc "pacman -Syu --noconfirm; pacman -S --noconfirm \
    git make diffutils mingw-w64-x86_64-pkg-config mingw-w64-x86_64-go \
    mingw-w64-x86_64-toolchain mingw-w64-x86_64-nasm mingw-w64-x86_64-libxmp mingw-w64-x86_64-SDL2"
  ```
- 新版 MSYS2 已移除 `mingw-w64-x86_64-tools-git`（含 gendef）和 yasm，别照抄上游 BUILDING.md 的包清单。
- 验收：`go/gcc/pkg-config/make/nasm` 全部可寻址，`gendef` 允许缺失（见 Step 4 处理）。

### Step 4 — 处理 gendef 缺失 + Go 环境
- build.sh 只在 `create_delay_import_libs_windows` 里用 gendef。两项处理后可跳过：
  1. 造 no-op stub：`/d/msys64/mingw64/bin/gendef`（内容 `exit 0`，chmod +x）
  2. 在引擎仓库 `build/delaylib/` 放一个占位文件（如 `zz-skip.dll.a`）——该目录非空时 build.sh 直接跳过 gendef/dlltool 阶段，改用标准 import lib 链接
- MSYS shell 里 HOME 解析不到用户目录，Go 1.27 会报 `module cache not found`：显式设 `GOPATH/GOMODCACHE/GOCACHE`，并 `GOPROXY=https://goproxy.cn,direct` 加速模块下载。

### Step 5 — 编译
- 用 [templates/build-native.sh](templates/build-native.sh)（填好 `{{REPO}}`、`{{FFMPEG_PKGCONFIG_DIR}}`、`{{GOPATH}}` 后执行）。
- 有 FFmpeg shared dev 包 → `BUILD_FFMPEG=no` + `PKG_CONFIG_PATH` 指过去；路径带空格先做 junction（PowerShell：`New-Item -ItemType Junction`，cmd.exe 会被安全策略拦）。
- 编译报错先对照 [examples.md](examples.md) 的「踩坑清单」——上游源码本身的编译 bug 也在里面（netplay_desktop.go 类型错误）。

### Step 6 — 部署
- exe + 运行 DLL 一起放进 `.cache/ikemen-native/`。DLL 清单用 `objdump -p Ikemen_GO.exe | grep "DLL Name"` 核对，本项目当前需要：
  `SDL2.dll`、`libxmp.dll`、`avcodec-62.dll`、`avfilter-11.dll`、`avformat-62.dll`、`avutil-60.dll`、`swresample-6.dll`、`swscale-9.dll`
  （mingw64 的 SDL2/libxmp 在 `/d/msys64/mingw64/bin`，FFmpeg DLL 在 gyan 安装目录 `bin/`）

### Step 7 — 端到端验证（serve.cjs `--go` 档）
- [ ] `node serve.cjs 8155 --go` 后 `GET /api/engine/status` 返回 `supported:true, available:true`
- [ ] `POST /api/engine/start`（body 带 `argv`，含 `-p1 chars/... -p2 chars/...`）→ 10s 内 `status.head` 出现 `TF_HEAD` 坐标串
- [ ] 手写 `value = 1` 进 `<cwd>/save/tf-result.ini` → `status.result` 捕获 `{value:1}`
- [ ] `POST /api/engine/stop` → `running:false`，且能再次 start（验证 exited 标志修复）
- [ ] 不带 `--go` 启动 → `supported:false`，前端自然回落 wasm

## Output

默认产出：

| 文件 | 说明 |
| --- | --- |
| `.cache/ikemen-native/Ikemen_GO.exe` | 原生引擎（GUI 子系统，stdout 仍可收 TF_HEAD/TF_RESULT） |
| `.cache/ikemen-native/*.dll` | 8 个运行时 DLL（与 exe 同目录，Windows DLL 搜索优先 exe 目录） |
| `D:\msys64`（或自选路径） | MINGW64 工具链，可复用，重编无需重装 |
| `.cache/build-native.sh` | 本项目的编译入口脚本（模板实例化产物） |

## Reference Templates

- [templates/build-native.sh](templates/build-native.sh)：MSYS2 MINGW64 编译脚本（占位符 `{{}}`）
- [templates/parallel-dl.sh](templates/parallel-dl.sh)：限速网络下的分段并行下载器

## Examples

参见 [examples.md](examples.md)：2026-11-26 完整实做记录，含全部踩坑与修复 diff。

## Notes

- **不要改 wasm 构建**：上游 bug 修复只动 `//go:build !js` 的文件；`src/` 里 js/非 js 双后端并存，改共享文件会破坏 wasm 档。
- gendef stub 与 delaylib 占位文件是环境级补丁：换机器要重做；`build/delaylib/` 一旦有内容，删除才会重新生成 delay-load 库。
- gyan.dev 的 FFmpeg DLL 很大（~169MB），本地 demo 无所谓；若要分发考虑用 build.sh 自动编的 decoder-only 精简版（`BUILD_FFMPEG=yes`，需要 nasm）。
- 引擎 stderr 的 BGM 缺失 / 角色 state 参数警告不影响对局，别当成编译问题排查。
- serve.cjs 侧的存活判断必须用独立 `exited` 标志而非 `exitCode===null`——被 kill 的进程 exitCode 也是 null（此坑已在 serve.cjs 修复，重写调度逻辑时勿回退）。
- 依赖 MCP/特殊环境：无。纯本机命令行，但 `cmd.exe`/PowerShell 的部分调用会被 Agent 安全策略拦截，junction 用 PowerShell 工具的 `New-Item -ItemType Junction` 创建。
