---
name: probe-generic-fx
description: 给 Toon-Fighting 资产集角色配置「主题化泛技能 + 属性特效」并用 CDP 探针全链验证：按故事档案定技能名与属性（fire/water/thunder/…12 词汇，对齐 toonflow-field-survival effects_type），生成器写入 char.json genericSkills，游戏端属性色浮字 + #skfx 爆发层渲染，PC 探针断言后部署真机复核。当用户要求「给角色配泛技能 / 加属性特效 / 飘字+特效 / 泛技能主题命名 / 验证技能特效渲染」时使用。
---

# probe-generic-fx（泛技能 × 属性特效：配置 → 游戏端 → 探针 → 真机）

## Purpose

一个资产集的所有角色都能有「按了有反应」的泛技能，且释放时有**属性色飘字 + 属性爆发特效**。
本技能沉淀全链做法：故事档案 → 属性分配 → 主题命名 → 生成器写 char.json → 游戏端渲染
（已在 index.html 内建，**新角色包零前端改动**）→ PC 探针 15 断言 → 部署 + 手机资产集同步。

## Input

必须：

1. 资产集角色根目录：`workshops/toon-fighting-web/map_design/<包>/chars/`
2. 角色「人设来源」：故事档案 md（npc 异能/性格/职业）或角色 char.json 的 profession/description

可选：

3. 只处理部分角色（缺省=全目录扫描）
4. 特殊属性指定（缺省按人设推断，见 Step 2 词汇表）

## Process

### Step 1 — 读人设来源，建主题表

从档案提取每个角色的：异能关键词（解析/回溯/铁壁/蛮力…）、职业、性格。据此两件事：
- **属性**：异能色彩 → fx 词汇（火系异能=fire、防御力场=earth、窃听飘逸=wind、精神系=dark、
  治疗厨艺=wood、金色系统=light/metal、普通人=normal、毒系=poison…）
- **命名**：每个技能一个主题名（不要叫「波动击」这种通用名；主题名仍按模板 key 分类）

产出 THEMES 表（模板见 templates/generic-skills-theme-template.mjs）：`charId → {attr, names{模板key→名}, singles{键→名}, moves{移动技→名}}`。
非故事线角色按角色特质定属性（如 K'=fire、Leona=thunder、Lin=poison）。

### Step 2 — 属性词汇（游戏端已支持，勿再造）

fx 对齐 `toonflow-field-survival` 的 effects_type，12 个：

| fx | 色(浮字/按钮) | #skfx 爆发形态 | | fx | 色 | 爆发形态 |
|----|----|----|----|----|----|----|
| normal | #ffffff | 环爆 | | wood | #58dd66 | 环爆+闪光 |
| fire | #ff6020 | 环爆+闪光+粒子 | | light | #fff9c2 | 环爆+闪光 |
| water | #40b8ff | 环爆+闪光 | | dark | #b06ae0 | 聚拢环 v-implo |
| thunder | #f8ff66 | 闪光+双倍粒子 | | poison | #88dd33 | 液滴 v-drops |
| wind | #a0ffdd | 条纹 v-streak | | bleed | #dd2233 | 液滴 v-drops |
| earth | #c28c50 | 大慢尘环 v-dust | | metal | #ffdd77 | 双斩波 .sl |

游戏端（index.html，已内建）：`.skillpop.fx-<attr>` 浮字属性色、技能钮键序 `--fxc` 同色、
`#skfx` 爆发层锚定 P1 头顶头像（`#headav.on .ha`，无坐标包回落画布 30%/45%），1s 自清。
未知 fx 回落金色；旧动作类 fx（projectile/melee…）兼容。

### Step 3 — 生成器写 char.json

复制 `.cache/scripts/gen-generic-skills-v2.mjs` 改 THEMES 后运行：

```
node .cache/scripts/gen-generic-skills-v2.mjs "<charsRoot>" [--dry]   # 先 --dry 预览再实写
```

要点（全部实踩过）：
- **指令必须双层过滤**：def→cmd 的 [Command] 且被 def 声明状态文件（St/St1..4/Cns/StCommon
  广收）`command="名字"` 引用——未声明文件的引用引擎不加载，按了没反应；
- 模板分类只管**结构**（波动 d df f / 反射 d db b / 升龙 f d df / 双子双键 / 超必杀双段 /
  蓄力 ~Ns），命名与属性全来自 THEMES；
- **零 wired 角色（AI 打法包）不跳过**：配引擎公共移动技兜底 `f f`/`b b`/`u f`/`d b`
  （走 common 状态必然有反应），杜绝废钮；
- 不足 4 条用单键补位（主题 singles 名），仍不足再垫移动技；
- 写入是 read-modify-write；写完抽一个 char.json 查 **U+FFFD 乱码**（中文落盘必检）。

### Step 4 — PC 探针（15 断言模板）

复制 templates/probe-generic-fx-template.mjs，替换 `{{CHAR}}/{{COLOR}}/{{THEME_GREP}}/{{ATTR}}`：
需要 8105 起 `node serve.cjs 8105`。断言链：
1. 数据链：`PACKS.charMeta[id].genericSkills` 经 `/api/assetpacks` 到达（fx=属性值）；
2. 技能条：按钮数 ≥3、主题名命中、`style --fxc` = 属性主色；
3. 点击 → `.skillpop.fx-<attr>` + 浮字 computed color + `#skfx .sk` 环/粒子数/锚点；
4. 1.1s 后 `#skfx` 自清；
5. 换一个**零接线角色**开对局：移动兜底技出钮 + 属性色；
6. 换一个**异形态属性**（如 dark→v-implo）核爆发形态类名。

### Step 5 — 部署 + 手机资产集同步 + 真机复核

1. `node .zcode/skills/h5-app-install/deploy.mjs`（index.html 有改动才需要；纯 char.json 更新可跳过）；
2. char.json 是**资产集数据不进 APK**，外科同步：
   ```sh
   # ★ 先清暂存目录：adb push 到已存在目录会嵌套一层（tfpackpatch/<dirname>/…），
   #   cp 旧路径等于把旧文件又盖回去（真机技能名没变才暴露的坑）
   rm -rf .cache/pack-sync-patch   # 并用 node 重新组装 chars/<id>/char.json 结构
   MSYS_NO_PATHCONV=1 adb push .cache/pack-sync-patch /data/local/tmp/tfpackpatch
   MSYS_NO_PATHCONV=1 adb shell "run-as com.viaco.toonfighting sh -c \
     'cp -r /data/local/tmp/tfpackpatch/chars/. files/packs/moshi-v1/chars/'"
   ```
3. force-stop + am start 重启（原生 PackApi 无缓存但页面要重新 loadPacks）；
4. CDP 复核（h5-app-debug 通道）：技能条主题名 + 属性色 + 点击后 `#skfx` 粒子数 + screencap 截图。

## Output

| 文件 | 说明 |
|---|---|
| `chars/<id>/char.json` 的 genericSkills | 每角色 4 条：{name, desc(含拇指序), cmd, fx, cd, rarity} |
| `.cache/scripts/probe-generic-fx.mjs` 运行结果 | PC 15 断言 + 截图 `.cache/shots-genericfx/` |
| `.cache/shots-device/*.png` | 真机爆发特效截图 |
| `../../../md/curdesign/ai格斗设计/角色技能与搓招/泛技能与属性特效.md` | schema 与主题表文档（首次建，增量更新） |

## Reference Templates

- [templates/probe-generic-fx-template.mjs](templates/probe-generic-fx-template.mjs)：探针骨架，`{{}}` 换角色/属性/颜色
- [templates/generic-skills-theme-template.mjs](templates/generic-skills-theme-template.mjs)：生成器 THEMES 主题表骨架

## Examples

- [examples.md](examples.md)：末世包 21 角色全量配置（苏晚晴 water / 江浩 fire / 甄选使 dark…）
  的完整执行记录，含 push 嵌套坑的发现过程。

## Notes

- **新增角色包不需要改 index.html**：12 属性的 CSS/JS 游戏端已内建；只要 char.json 的 fx
  取值在词汇表内。要新属性（如「冰 ice」）才需扩 ATTR_FX 表 + `.skillpop.fx-*` CSS + `#skfx` 形态。
- 探针依赖 `.cache/scripts/lib/cdp.mjs`（launchEdge/connect/checker）与 8105 静态服务；
  真机通道走 h5-app-debug（forward tcp:9333 localabstract:webview_devtools_remote_<pid>，socket 名带 pid 重装会变）。
- 引擎真实可跑与「泛技能有反应」是两回事：移动兜底技走 common 状态永远有效；搓招指令类
  仍受 def 接线约束（见 analyze-pad-buttons 技能）。
- 中文写入后必须检查 U+FFFD；生成器统一 utf8 落盘。
