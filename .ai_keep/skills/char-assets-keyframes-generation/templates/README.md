# templates —— 脚本模板与检查工具

这个目录里的脚本**自包含**（路径自包含、拷到任意机器都能跑），是本技能的常驻工具。

## 落盘阶段

| 文件 | 用途 |
|---|---|
| `mk-keyframes-template.mjs` | 关键帧落盘脚本模板（`REF` 代表帧映射表 / `CATS` 类别表 / `refPngBuf` 废区裁剪**三处必须按目标包核对**） |
| `gen-frames-note.md` | 现场生图的提示词与通道备忘 |

## 引擎兼容性检查（2026-11-26 新增，三种模式通用）

**背景**：引擎对非法精灵是**静默丢弃**的 —— 数据长度对不上 → `SetPxl` 直接 return
→ 纹理不生成 → 精灵隐形，**全程零日志**，ff-studio 查看器还照常显示正常。
所以「精灵不见了」不能靠查日志 / 查渲染定位，必须靠静态复检。

| 文件 | 用途 | 依赖 |
|---|---|---|
| `diag-engine-drop.cjs` | **静态复检**：按引擎口径算出「会被静默丢弃的精灵数」，必须为 0。退出码 0=通过 / 1=有丢弃，可直接进 CI | 无 |
| `fix-sff-bpl.cjs` | **外科修复**：只重排 SFF 精灵链把 `bpl` 改成 `w`，AIR / def 一字不动（线上包可能有手工补丁，不能整体重建） | 无 |
| `rebuild-merge-batch.mjs` | **批量重建**：一份 plan.json 驱动，三种模式通用，带两个硬判据（见下） | 无 |
| `diag-two-modes.cjs` | **两种透明度语义对比**：虚化 vs 二值碎片的像素统计与碎片特征 | 无 |
| `capture-exact-frame.mjs` | 抓**指定引擎帧号**的截图（消除舞台背景动画的相位噪声） | `ws`（或设 `WS_PATH`） |
| `ascii-region.cjs` | 把截图指定区域打成 ASCII（`#`=彩色背景 `*`=有内容），终端里直接目检「角色在不在」 | `sharp`（或设 `SHARP_PATH`） |

### 用法

```powershell
# 组装完必跑：静态复检（退出码非 0 就是有问题）
node templates/diag-engine-drop.cjs <包>/<id>.sff

# 已有坏包：外科修复（不碰 AIR/def）
node templates/fix-sff-bpl.cjs <包>/<id>.sff

# 融合的两种透明度语义对比（虚化 vs 二值碎片）
node templates/diag-two-modes.cjs <底座目录> <AI图目录> [group] [index]

# 实机黑盒验证：同帧对比 + ASCII 目检
node templates/capture-exact-frame.mjs out.png 9399 8100 <id> <id> 120
node templates/ascii-region.cjs out.png 0.22 0.42 0.32 0.90
```

### 批量重建（`rebuild-merge-batch.mjs`）

一次踩坑要修十几个包时用这个。它带**两个硬判据**，任一不过就**不安装**（只报告）：

| 判据 | 含义 | 不过说明什么 |
|---|---|---|
| ① AIR 逐字节一致 | AIR 只依赖底座与类别映射，与 alpha 无关 | 底座选错了，或分类口径变了，或线上包有**手工补丁** |
| ② 引擎丢弃数 = 0 | 按引擎口径复算 | 写出器还有 `bpl` 缺陷 |

```powershell
node templates/rebuild-merge-batch.mjs plan.json --dry   # 先干跑，不写文件
node templates/rebuild-merge-batch.mjs plan.json         # 确认后再实跑
```

plan.json 格式（`mode` 可选 `some` / `merge` / `all`，默认 `merge`）：

```json
{
  "packCharsDir": "workshops/.../chars",
  "aiFramesDir": ".cache/ai-frames",
  "outDir": ".cache/mg-build",
  "mode": "merge",
  "mergeAlpha": 0.95,
  "bodyAlpha": 0.2,
  "packages": [
    { "id": "SuWanqingKFM",
      "baseDir": "ff-studio/white-mold/04_异能者/98Athena",
      "baseSff": "Athena-98.sff", "baseAir": "Athena-98.air", "baseDef": "98Athena.def",
      "frames": "苏晚晴" }
  ]
}
```

⚠️ `baseSff`/`baseAir`/`baseDef` **底座目录里有多个 def/sff 时必须显式指定** ——
否则会按字母序选错（踩过：`LaoLeiKFM` 底座里有 `LaoLeiKFM.def` / `RalfAct.def` / `ikari.def` 三个）。

⚠️ 判据①只在「用同一套底座+分类口径重建」时成立。线上包有手工补丁时（本项目
`LinYuKF` / `LinYuKFA` 的 AIR 有 H 镜像标志处理），判据①会自动拦住并提示改用外科修复。

### 为什么 `bpl` 必须等于 `w`

引擎 `src/image.go`：

```go
// readPcxHeader：只有 encoding==1(RLE) 才把 bpl 存进 s.rle；raw 时 s.rle=0
if encoding == 1 { s.rle = int(bpl) } else { s.rle = 0 }
// RlePcxDecode：s.rle<=0 时原样返回字节流 → px 长度 = bpl*h
// SetPxl：if len(px) != Size[0]*Size[1] { return }   ← 丢弃
```

`Size = w*h`，raw 模式下 `px` 长度 = `bpl*h` → **`bpl` 必须严格等于 `w`**。
PCX 惯例的「补偶数」（`w + (w&1)`）在 MUGEN 引擎里会让奇数宽精灵全部隐形。

详见 [keyframeMode/merge/examples.md 的「2026-11-26 三次修复」](../keyframeMode/merge/examples.md)。

## 模式专属模板

各模式的组装脚本在 `keyframeMode/<模式>/templates/`：

| 模式 | 文件 |
|---|---|
| some（抽） | `build-kf-char.mjs` / `air-some.cjs` / `sff-append.cjs` / `sprite-pack.cjs` / `verify-kf-char.cjs` |
| merge（融） | `build-merge-char.mjs` / `merge-sprite.cjs` / `air-some.cjs` / `sff-append.cjs` / `sprite-pack.cjs` |
| all（全） | `build-all-char.mjs` / `air-some.cjs` / `sff-append.cjs` / `sprite-pack.cjs` |

⚠️ `sff-append.cjs` 和 `sprite-pack.cjs` 里写精灵的 `bpl` **必须是 `w`**
（三个模式共用，2026-11-26 已修正）。
