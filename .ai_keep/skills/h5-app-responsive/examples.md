# h5-app-responsive 示例：2026-11-26 超矮横屏层的设计与验收

## Input

背景：h5-app-debug 实测真机横屏视口 751×307（dpr 3.5），按 412px 设计的横屏布局下
选人列表只剩 ~27px，用户看到「列表没显示」。任务：按真机视口重做横屏布局并验证。

## 执行过程

### 1. 设计（先想清楚 307px 怎么分）

```
307 = 顶部 44（标题隐藏、menu/topbar 压到 top:8）
    + stage 201（bottom:62，foot 压到 48+6）
中栏 stage 201 = 阶段条 14 + 随机/翻页行 18 + gaps 24 + 列表 ~145
列表 145 ÷ 行高 36 → 3~4 行 × 3 列 ≈ 10 张卡可见
```

关键取舍：**立绘框/信息行在手机上让位**（/api/anim 手机上不通，本来就是空的）；
列表卡从「立绘大卡」改「头像+名字横条卡」。

### 2. 实现

嵌套媒体查询 `@media (max-width:920px) and (max-height:360px)`（叠在 412 横屏 MQ 之后）：

```css
#sel-title{display:none}
#select .mid .hlab,#select .mugfig,#select .minfo{display:none}
.rozlist{grid-auto-rows:minmax(36px,auto);gap:4px}
#select .rozlist .k{display:flex;align-items:center;gap:7px;padding:2px 8px 2px 6px}
#select .rozlist .k .face{position:static;width:28px;height:28px;flex:none;margin:0}
#select .rozlist .k .fig{display:none}
```

### 3. 矩阵验证（viewport-matrix.mjs 实跑输出）

```
desktop     {"mqUltra":false,"mqLand":false,"mqPort":false,"cardH":85,"gridH":245,"rotbtn":true}
ultra-land  {"mqUltra":true, "mqLand":true, "mqPort":false,"cardH":36,"gridH":125,"rotbtn":true}
land        {"mqUltra":false,"mqLand":true, "mqPort":false,"cardH":52,"gridH":102,"rotbtn":true}
port        {"mqUltra":false,"mqLand":false,"mqPort":true, "cardH":62,"gridH":113,"rotbtn":true}
```

四档断点命中各自正确、卡片高度全部健康、旧档无回归 ✓。截图人工过一遍确认无叠字/遮挡 ✓。

### 4. 真机终验（h5-app-debug）

部署后 CDP 探针 + adb screencap：13 卡 36px、grid 125px、3×3 可见（林羽/苏晚晴/林悦/
老雷/裁判/赵大川/陈阿姨/白术/江浩…），标题叠字与空立绘框消失。

## 关键设计点

- **验收标准量化**：「列表 ≥2 行完整可见」→ gridH ≥ 2×cardH，探针可判，不靠感觉。
- 每个断点档位都要「新档生效 + 旧档无回归」双查——矩阵脚本一次跑全。
- 探针 + 截图缺一不可：数字验结构，截图验视觉（叠字/遮挡探针测不出）。
