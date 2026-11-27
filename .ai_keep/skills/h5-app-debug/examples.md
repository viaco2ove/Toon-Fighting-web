# h5-app-debug 示例：2026-11-26「横屏优化完全没实现」排查

## Input

用户反馈：「我测试了，你前面说的横屏优化完全没有实现。是界面没更新还是你没做，还是没做好？」
——现象模糊（没更新/没做/没做好三选一），手机已装当天 18:21 的 APK。

## 执行过程

### 1. 先排除「没更新」（打包层 + 安装层）

```
grep -c "grid-auto-rows" android_h5/android/app/src/main/assets/public/index.html   → 3（新代码已打包）
grep -c "rotbtn" ...（同上）                                                          → 6
adb shell dumpsys package com.viaco.toonfighting | grep lastUpdateTime               → 18:21:45（刚装）
```

结论：打包层、安装层都是新的 → 剩下「运行层」，必须看真机实况。

### 2. CDP 直连实测（运行层）

```sh
adb shell pidof com.viaco.toonfighting            → 26568
adb shell cat /proc/net/unix | grep webview_devtools_remote_26568
adb forward tcp:9333 localabstract:webview_devtools_remote_26568
```

探针结果（关键数据）：

```json
{ "vw": 751, "vh": 307, "dpr": 3.5,
  "mqLand": true, "rotbtn": true, "cardH": 52, "cards": 13, "htmlHasFix": true }
```

**关键发现：真机横屏视口只有 751×307**，不是仿真假设的 732×412。新代码全部在跑
（rotbtn 在、卡片 52px 健康、修复 CSS 已加载）——所以既不是没更新、也不是没做，
**是布局断点按错误的视口高度设计**：307px 下 stage 只剩 151px，中栏固定元素吃掉 124px，
列表只分到 27px，用户看到的就是「没实现」。

### 3. 截图取证据 + 定位根因

```sh
adb exec-out screencap -p > device-screen.png     # CDP 截图会卡 fonts 超时，用 screencap
```

截图确认：列表区空白 + 大标题「TOON·FIGHTING」与顶部按钮叠字 + 立绘框空的
（手机上 /api/anim 不通，立绘框在手机上本来就是白占空间）。

### 4. 修复与验收（转 h5-app-responsive）

按真机 307px 设计超矮横屏 MQ → 重部署 → 再跑本技能验收：

```json
{ "mqUltra": true, "cardH": 36, "gridH": 125, "cards": 13, "titleHidden": true, "mugfigHidden": true }
```

真机截图：13 张角色卡 3×3 清晰可见。

## 关键设计点

- **三层核对**把「用户说不清的现象」变成可判别的问题，避免了盲改。
- 真机探针的 `vw/vh/dpr` 是响应式设计的**唯一可信输入**——仿真视口是假设，不是事实。
- `adb screencap` 代替 CDP screenshot 是踩过坑的固定动作。
