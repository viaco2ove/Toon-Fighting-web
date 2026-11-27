#!/usr/bin/env bash
# MSYS2 MINGW64 编译原生 Ikemen_GO.exe
# 用法：MSYSTEM=MINGW64 /d/msys64/usr/bin/bash.exe -lc '/path/to/build-native.sh'
# 占位符：{{REPO}}=引擎源码绝对路径(MSYS风格)  {{FFMPEG_PKGCONFIG_DIR}}=FFmpeg dev 的 lib/pkgconfig(MSYS风格)
#         {{GOPATH}}=Go 工作区(如 /d/go-workspace)
set -euo pipefail
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:/bin:$PATH"
export GOPROXY="https://goproxy.cn,direct"
# MSYS shell 里 HOME 解析不到用户目录，Go 1.27 必须显式给缓存路径
export GOPATH={{GOPATH}}
export GOMODCACHE={{GOPATH}}/pkg/mod
export GOCACHE={{GOPATH}}/cache
mkdir -p "$GOMODCACHE" "$GOCACHE"
# 有 FFmpeg shared dev 包时走系统库（省 20 分钟源码编译）；没有就删掉这行让 build.sh 自动编
export PKG_CONFIG_PATH="/mingw64/lib/pkgconfig:{{FFMPEG_PKGCONFIG_DIR}}"
cd {{REPO}}
echo "== go =="; go version
echo "== pkg-config =="
pkg-config --modversion sdl2 libxmp libavcodec libavformat libavutil libswscale || true
echo "== build =="
BUILD_FFMPEG=no ./build/build.sh Win64
echo "== output =="
ls -lh Ikemen_GO.exe lib/*.dll 2>/dev/null || true
