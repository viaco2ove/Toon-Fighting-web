---
name: h5-app-install
description: 把 Toon-Fighting-web 站点打包成 Android APK 并更新部署到手机（Capacitor 7 工程）。当用户要求「装到手机 / 更新手机上的 app / 部署 APK / 打 APK 包 / h5 安装到手机」时使用。核心是四步流水线：sync.mjs → npx cap sync android → gradlew assembleDebug → adb install，任何一步漏掉（尤其 cap sync）都会让手机跑到旧版界面。
---

# h5-app-install（APK 更新部署到手机）

## Purpose

把仓库根的 web 站点（index.html / vfs.js / wasm + ikemen-fs 兜底层）打包进
Capacitor 7 Android 工程并安装到手机。装完 app 自带：

- **兜底层**（ikemen-fs/file/chars 的通用角色，只读）
- **原生 MCP 服务**（默认 `0.0.0.0:7073`，同一 WiFi 下的 agent 可连）
- **资产集仓库**（`files/packs/`，资产集是**独立安装到手机的数据**，不在 APK 里）

## 快速用法（推荐：一键脚本）

```powershell
node .zcode/skills/h5-app-install/deploy.mjs
```

脚本按顺序做完全部四步 + 启动 + MCP 健康检查，任何一步失败即中止并报出原因。
选项：

| 选项 | 作用 |
|---|---|
| `--skip-build` | 跳过 sync/编译，只安装现有 APK |
| `--skip-launch` | 装完不启动 app |
| `--skip-test` | 装完不做 MCP 健康检查 |
| `--device <serial>` | 多设备时指定（默认取唯一那台） |

## 流水线（deploy.mjs 做了什么，手动跑也要按这个顺序）

```
① node sync.mjs                  仓库根 → android_h5/www/（排除 *.bak）
② npx cap sync android           www/ → android/app/src/main/assets/public/   ★必做
③ gradlew.bat assembleDebug      需 JDK 21（PATH 里的 java 1.8 编不过 AGP 8.7.2）
④ adb install -r -t app-debug.apk
⑤ am force-stop + am start       重启到新版
⑥ adb forward tcp:17073 tcp:7073 + GET /health   验收
```

**★ 第 ② 步是历史上真实踩过的坑**：只跑 `sync.mjs` 时 `www/` 是新的，但
gradle 打包的是 `assets/public/` —— 那是 `cap sync` 的产物。漏掉它，
**APK 里的界面就是很久以前的版本**，而且手机上怎么看都是旧 UI、本地文件却明明改过。
产品代码里依赖 webview 侧的每个新函数（如 `window.__tfMcpCall`）都会报「不存在」。

## Verification（装完必查）

```powershell
adb devices                                  # 设备在列
adb shell pidof com.viaco.toonfighting       # app 进程活着
adb forward tcp:17073 tcp:7073
curl http://127.0.0.1:17073/health           # {"ok":true,"port":7073,...}
```

health 返回 `tools:13`（MCP 工具数）与 `packs:N`（已装资产集数）。
部署 MCP 相关改动后，再走一次真实 MCP 调用（经 forward 的 POST /mcp）确认
webview 桥接的工具（`get_current_asset_pack` 等）返回结构化结果而不是 `{}`。

界面版本不对的快查：`adb shell dumpsys package com.viaco.toonfighting | grep lastUpdateTime`
—— 若早于你改代码的时间，就是装了旧包（回去查第 ② 步）。

## 踩坑记录（都是实测踩过的）

1. **漏 `npx cap sync android` → 手机上是旧界面**（见上，★ 最高频）。
2. **JDK 版本**：PATH 里的 `java 1.8` 编不过 AGP 8.7.2，必须
   `JAVA_HOME=D:\Users\viaco\.jdks\jdk-21.0.10+7`。deploy.mjs 已内置（可用环境变量覆盖）。
3. **Git Bash 路径转换**：`adb push x /data/local/tmp/` 会被 MSYS 翻译成
   `C:/Program Files/Git/data/...` → 失败。命令前加 `MSYS_NO_PATHCONV=1`。
   deploy.mjs 用 spawn 直调 adb，不受影响。
4. **`Failure [-99]`**：`adb install -r` 偶发失败，加 `-t`（允许 test 包）重试即可。
5. **USB 连接不稳**：设备可能中途掉线（logcat -d 卡死、install 报 no devices）。
   等 `adb devices` 出现 `device$` 再继续；`adb kill-server && adb start-server`
   可解假死。deploy.mjs 内置最多 90s 的等设备循环。
6. **logcat 卡死**：设备不稳时 `adb logcat -d` 可能永久挂起 —— 外面套
   `timeout 15`（Git Bash）或用 `-t 200` 限行数。
7. **首次安装 MCC 健康检查失败**：MCP 服务在 Activity load() 即启动，但
   webview 引擎加载 24MB wasm 期间主线程忙，桥接类 MCP 调用（走 evaluateJavascript）
   要等页面 ready —— 健康检查只打 `/health`（纯原生），桥接工具留给人工/MCP 验证。

## Notes

1. APK 是私有侧载不分发，资产集**不进 APK**（373MB 级数据装进手机的
   `files/packs/`，通过 MCP 的 `install_asset_pack` 工具或后续 UI 安装）。
2. `android/local.properties` 被 .gitignore（换机器要重写 sdk.dir）；
   `www/`、`android/app/build/` 同样不入库。
3. MCP 服务默认启用、端口 7073；系统设置 →「MCP 服务」可关/改端口/配后端/登录。
4. 引擎 wasm 24MB + 兜底层 → APK 约 88MB；`sync.mjs` 排除 `*.bak*`。
5. 改了 `android/` 平台源码（Java/manifest/gradle）也走同一条流水线，
   cap sync 不会覆盖平台代码。
