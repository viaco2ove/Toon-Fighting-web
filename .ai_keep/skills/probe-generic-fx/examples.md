# Examples — 末世包 21 角色泛技能属性特效（2026-11-27）

## Input

- 资产集：`workshops/toon-fighting-web/map_design/末世选择，从解析神明开始成神/chars/`（21 角色）
- 人设来源：`map_design_pre/末世选择….md`（story_info JSON：林羽=解析金色数据流、苏晚晴=回溯急救、
  老雷=铁壁防御力场、甄选使=锁定/逆选会、小铃铛=黑雾铃鸣、赵大川=凡人司机、陈阿姨=大锅饭、白术=顺风耳、江浩=蛮力爆发、裁判=金刻度判罚、林悦=金印共鸣）
- 参照特效口径：`toonflow-game-plugins/md/curr_design/toonflow-field-survival/技能特效设计/V1/技能属性特效.md`

## 执行记录

1. **主题表**（THEMES）：21 角色按异能定属性+命名——
   林羽/LinYuKF/KFA/KFM=light（解析系：解析突刺/规则重击）、苏晚晴=water（回溯逆流/急救重锤）、
   林悦=light（印记回响/金纹突刺）、老雷=earth（铁壁反弹/消防斧重劈）、裁判=metal（刻度中敲/终审判罚）、
   赵大川=normal（油门冲撞/急退避让）、陈阿姨=wood（铁勺上撩/大锅焖击）、白术=wind（风语冲击/钻营突进）、
   江浩=fire（蛮力冲锋/跃起扣杀）、甄选使=dark（献祭之门/仪式升挑）、小铃铛=thunder（铃音冲击/黑雾铃爆）；
   非故事线：Hinako=earth（相扑）、K'=fire、Leona=thunder、Lin=poison（雾隐）、Rugal2nd=dark、
   98-kim=wind（飞燕）、MasterRyu=normal。
2. **首跑漏配**：LinYuKF/KFA/KFM 三个变体忘了进 THEMES（落成 normal 白色）——dry run 的属性列
   `[normal]` 直接暴露，补齐后重跑。教训：**dry run 先看属性列再实写**。
3. **游戏端**：index.html 加 `.skillpop.fx-*` 12 条属性色 + `#skfx` 爆发层（ring/flash/p/sl 四元素 +
   v-implo/v-dust/v-streak/v-drops 形态）+ 按钮 `--fxc`。SKILL 文档口径见
   `../../../md/curdesign/ai格斗设计/角色技能与搓招/泛技能与属性特效.md`。
4. **生成器实写**：21 角色每人 4 条；零接线 5 角色（98-kim/江浩/林/MasterRyu/赵大川）全部配移动兜底技
   （此前 v1 是直接跳过——「每个角色都要有」的需求下不再可跳）。
5. **PC 探针 15/15**：水属性（#40b8ff 浮字+环+9 粒子+自清）、火属性（+flash）、暗属性（v-implo 类名）、
   江浩移动兜底（蛮力冲锋 #ff6020）。
6. **真机部署**：deploy.mjs（68.6s，index.html 有改动）+ char.json 外科推送。
   **踩坑**：push 目标 `/data/local/tmp/tfpackpatch` 已存在（上次 survival 补丁残留）→ adb push 把
   `.cache/pack-sync-patch` 整个嵌套成 `tfpackpatch/pack-sync-patch/`，cp 还是旧内容——真机技能条
   仍是「反射波/金色」，用 `fetch('api/assetpacks')` 直查 charMeta 也是旧值、run-as grep 文件确认是旧文件，
   才定位到嵌套。修复：`rm -rf /data/local/tmp/tfpackpatch` 后重推，`grep fx` 确认 water。
7. **真机复核**：重启后 SuWanqingKFM=回溯逆流/急救重锤/病历横扫/手术刀突刺（全 #40b8ff 键序），
   点击 → 水蓝浮字 + `#skfx` 9 粒子 + 锚点 (226,138)=P1 头顶；JiangHaoKFM=蛮力冲锋系火色四钮。
   截图 `.cache/shots-device/genericfx-water.png`。

## Output

- 21 个 char.json 的 genericSkills（每人 4 条，fx 全部落在 12 词汇内）
- `.cache/scripts/gen-generic-skills-v2.mjs`（生成器）、`.cache/scripts/probe-generic-fx.mjs`（15/15）
- schema 文档 `../../../md/curdesign/ai格斗设计/角色技能与搓招/泛技能与属性特效.md`

## 关键设计点

- 命名与属性分离：TEMPLATES 只管指令结构分类（保证「按了有反应」），THEMES 管风味（保证「像这个角色」）。
- 移动兜底技 `f f/b b/u f/d b` 是零资产依赖的安全网：AI 打法包也能有 4 个可用技能钮。
- 验证顺序：文件 grep → API charMeta → PC 探针 → 真机；每层都能独立定位「数据没到/渲染没到/部署没到」。
