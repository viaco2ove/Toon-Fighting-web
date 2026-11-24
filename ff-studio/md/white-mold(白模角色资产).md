直说结论：**“按职业分类的现成白模” 在 MUGEN 圈基本不存在**，但两类东西能拼出你要的路线：
[角色职业.md](../../md/curdesign/ai%E6%A0%BC%E6%96%97%E8%AE%BE%E8%AE%A1/%E8%A7%92%E8%89%B2%E8%81%8C%E4%B8%9A.md)

## 2. 职业表

| # | 职业 | 战斗风格定位 | 故事角色示例（末世题材） | 现有引擎角色 | 可下载候选（MUGEN） | 优先级 |
|---|------|------------|------------------------|------------|--------------------|--------|
| 1 | 武道家 | 近战均衡、投技+打击，玩家主角默认职业 | 林羽（player）、收徒系统师父类 NPC | Rugal2nd（霸道武坛，可兼 boss） | 坂崎亮 Ryo / Takuma / Robert（极拳流，天下第一空手道）；金家藩 Kim（已有 98-kim 但 sff 残缺，需换完整版） | ★★★ |
| 2 | 军人/佣兵 | 火力+纪律，中距离牵制，稳定输出 | 江浩、幸存者营地卫队、前特种兵 | **Leona（已入库 2026-11-24，KOFA 版，manifest local38）** | Whip、Clark、Ralf、Heidern（怒队补员） | ★★★ |
| 3 | 忍者/刺客 | 高机动、突进+隐袭，PVP 速度型 | 暗杀者 NPC、夜袭事件对手 | Lin（暗杀忍者） | 蜊山永司 Eiji Kisaragi（乱入忍者）、Galford（侍魂系，注意风格差） | ★★☆ |
| 4 | 异能者 | 元素/精神力远程，玻璃大炮 | 苏晚晴（解析神明天赋觉醒者）、教团异能者 | K'（火焰） | Kula Diamond（冰霜）、麻宫雅典娜 Athena（精神力+治愈系，可兼 §辅助）、包 Bao | ★★★ |
| 5 | 摔跤/力量型 | 重甲坦克、投技终结、扛线 | 变异巨人、竞技场力士、壮汉保镖 | Hinako（相扑少女，风格特殊可做彩蛋） | Raiden（摔角面具）、Antonov（自封冠军）、Brian Battler | ★★☆ |
| 6 | 特工/搜查官 | 抓捕+投技控制，反击流 | 执法官、赏金猎人、队伍纪律担当 | — | Blue Mary（女特警，抓技代表）、Ramon | ★★☆ |
| 7 | 改造人/机械强化 | 数值压制、光束/机械臂，"人造神"意象 | 神明解析产物、教团兵器、赛博佣兵 | —（联动主题强相关） | Maxima（改造人）、K9999 / Nameless（异能改造实验体） | ★★☆ |
| 8 | 黑帮/街头斗士 | 蛮横连段+蛇拳，混乱中立 | 废墟帮派头目、黑市拳师、劫掠者 | — | 山崎龙二 Ryuji Yamazaki（黑帮蛇拳）、Geese Howard（恶势力大首领） | ★★☆ |
| 9 | 辅助/医疗 | 治疗与增益（对局内以精神力/气功示意） | 营地医师、后勤担当 | —（KOF 无纯治疗位） | 由 Athena（治愈系超能力）兼任，独立职业位暂缓 | ★☆☆ |
| 10 | Boss/神明系 | 压制型最终对手，剧情关专用 | 「神明」具象化、各章 Boss | Rugal2nd（可复用） | Orochi 大蛇 / Mukai / 祸忌 Saiki（按章节逐步引入） | ★☆☆（M5 后再上） |

**① MUGEN 开箱即用的 “白模” = Kung Fu Man（KFM）系模板**

KFM 是 MUGEN 官方自带的模板角色，整个圈子都拿它当 “白模” 改。下载点：

- **MUGEN ARCHIVE** 的 Kung Fu Man edits 分类 —— 几十个 KFM 变体（KOF 风格版、SS 版等）
- **Mugen Fighters Guild** 上的 **GoldEX KFM（POTS Style Template）**——2025 年更新的开发友好模板，config.txt 可切风格、带弹道 / 超杀模板，是当前最好的 “造角色底座”
- 你游戏里已有的 7 个包（Hinako、K'、Lin…）本身也都能当编辑底座

**② 按职业的像素角色资产（不是 MUGEN 格式，但帧全、免费）**

- **itch.io**：搜 free + fighting /pixel art /beat-em-up 三个 tag（合计 400+ 个免费包）。推荐几个：LuizMelo 的 **Martial Hero**（免费）、ansimuz 的 **Streets of Fight**、Pixel Moon 的 **FREE Male/Female Realistic Pixel Art Template Sprite Pack**—— 这俩就是真 “白模”（紫绿分色人体模板，专为换装换头设计）、Nemesiz 的 **Anime Fighter 免费样例**（idle/run/punch/kick/hurt/knockout 全状态 + portrait + JSON 帧数据，格斗专用结构）
- **[OpenGameArt.org](https://OpenGameArt.org)**、**Universal LPC Spritesheet 生成器**（网页上按 战士 / 法师 / 盗贼 等职业 + 性别 + 武器拼角色，导出 sheet—— 不过它是 RPG 视角，比例和格斗小人差很多）

**③ 跟你 AI 量产路线最对口的**：itch.io 上 tantk 的 **SpriteForge** 资产 ——42 个格斗角色参考图 + 22 张 4×4 格斗动作 sheet 模板，本来就是给 “AI 换角色生成格斗 sprite” 训练用的，和 Retro Diffusion/PixelLab 那条 AI 管线正好衔接。

**关键落差要有预期**：②③ 都是 PNG sprite sheet，进你的游戏需要 ff-studio 回写成 SFF（工具已有）**+ 编写 CNS/AIR**（这部分 MUGEN 逻辑工作量大，是真正的瓶颈）。所以实用排序是：先拿 KFM/GoldEX 模板验证职业化改造（改 AIR+CNS 最少），PNG 资产转 MUGEN 作为第二批。

# white-mold —— 角色资产仓库

Toon-Fighting-web 的角色资产中转仓库：白膜底座 + 按职业归档的 MUGEN 完整角色包。
入库引擎前先在本目录归位，再走「拷入 chars/ → patch-char-ai → manifest 重建 → 引擎实测」四步流程。

更新：2026-11-24

---

## 目录结构

```
white-mold/
├── README.md                  本文件
├── _原始包/                    历史积累的散装原始包（未按职业分类）
│
├── 01_武道家/                  近战均衡、投技+打击（玩家主角默认职业）
├── 02_军人佣兵/                火力+纪律、中距离牵制
├── 03_忍者刺客/                高机动、突进+隐袭（PVP 速度型）
├── 04_异能者/                  元素/精神力远程、玻璃大炮
├── 05_摔跤力量/                重甲坦克、投技终结、扛线
├── 06_特工搜查/                抓捕+投技控制、反击流
├── 07_改造人机械/              数值压制、光束/机械臂（"人造神"意象）
├── 08_黑帮街头/                蛮横连段+蛇拳、混乱中立
├── 09_辅助医疗/                治疗与增益（暂由异能者 Athena 兼任，无独立角色）
├── 10_Boss神明/                压制型最终对手、剧情关专用
│
├── 01_白膜-男 / 02_白膜-女 /   白膜 PNG 底座资产（贴头管线用，见 LinYu v0.2）
├── 03_格斗家-武术 / 04_斗殴少女 /
├── 05_街头混混 / 06_火焰格斗士
└── 90_场景素材/                场景类素材
```

## 职业文件夹内约定

每个职业文件夹两层结构：

- `<职业>/_原始包/` —— 下载的原始压缩包（zip/rar/7z），保留不删，解压出错可回溯
- `<职业>/<包名>/` —— 解压后的完整 MUGEN 角色（含 .def/.sff/.air/.cns/.act 等）

来源分组一致时，包名前缀即作者/版本系列：

- `98XXX` —— KOF98 风格复刻系列（Kim/Ryo/Athena/Big/Mary/Geese/Billy/Krauser/Rugal/Eiji 等）
- `kof_XXX` —— kof_ 系列重制（mugen 1.0）
- `XXXAct` / ActJapan 系列 —— ActJapan 作者包（含多套调色板 act 文件）
- `MF_XXX` —— MFFA 整理版
- `XXX-20140510` —— 2014-05-10 整理版（mugen1.0 / winmugen 双份，取 mugen1.0）

## 当前角色清单（24 包，全部校验 .def + .sff 完整）

| 职业 | 包 | 主 def | sff 大小 | 说明 |
|------|-----|--------|---------|------|
| 01_武道家 | 98Kim | 98Kim.def | 5.1MB | **完整版 Kim，可替代引擎内 sff 残缺的 98-kim** |
| 01_武道家 | 98Ryo | 98Ryo.def | 3.7MB | 坂崎亮 KOF98 风格 |
| 01_武道家 | kof_ryo | kof_ryo.def | 2.9MB | 坂崎亮 kof_ 重制系列 |
| 01_武道家 | kof_takuma | kof_takuma.def | 3.4MB | 坂崎琢磨 |
| 01_武道家 | RobertAcZ | RobertAcZ.def | 1.8MB | 罗伯特 |
| 01_武道家 | takumaact | TakumaAct.def | 2.3MB | 坂崎琢磨（ActJapan，多调色板） |
| 02_军人佣兵 | kof_ralf | kof_ralf.def | 2.4MB | 拉尔夫 |
| 02_军人佣兵 | RalfAct | RalfAct.def（附带 ikari.def） | 0.5MB | 拉尔夫（ActJapan，怒队） |
| 03_忍者刺客 | 98Eiji | 98Eiji.def | 3.2MB | 蜊山永司 KOF98 风格 |
| 03_忍者刺客 | kof_eiji | kof_eiji.def | 2.0MB | 蜊山永司 kof_ 重制 |
| 03_忍者刺客 | nbc_fuuma | nbc_fuuma.def | 3.0MB | 風魔小太郎（NBC 风格忍者） |
| 04_异能者 | Kula-mugen1.0 | Kula.def | 9.5MB | 库拉（2014 整理版 mugen1.0） |
| 04_异能者 | 98Athena | 98Athena.def | 3.8MB | 麻宫雅典娜（精神力+治愈系，可兼 09 辅助位） |
| 04_异能者 | athena3 | athena3.def（另含 Athena03NAct 等多版本 def） | 2.6MB | 雅典娜 2003（ActJapan，多调色板） |
| 05_摔跤力量 | 98Big | 98Big.def | 3.8MB | 大熊（重量级扛线） |
| 05_摔跤力量 | earthquake | earthquake.def | 3.1MB | 地震（SVC 巨汉） |
| 06_特工搜查 | 98Mary | 98Mary.def | 4.1MB | 布鲁·玛丽 KOF98 风格（女特警抓技代表） |
| 06_特工搜查 | MaryAct2nd | MaryAct2nd.def | 5.4MB | 玛丽 2001（ActJapan） |
| 08_黑帮街头 | 98Geese | 98Geese.def | 4.9MB | 基斯·霍华德 |
| 08_黑帮街头 | 98Billy | 98Billy.def | 5.0MB | 比利·凯恩 |
| 08_黑帮街头 | MF_Yamazaki | MF_Yamazaki.def | 15.7MB | 山崎龙二（蛇拳） |
| 10_Boss神明 | 98Rugal | 98Rugal.def | 4.6MB | 卢卡尔 |
| 10_Boss神明 | 98Krauser | 98Krauser.def | 4.5MB | 克劳萨 |
| 10_Boss神明 | GodRugal-mugen1.0 | GodRugal.def（另含 Rugal.def） | 11.4MB | 神卢卡尔（2014 整理版） |

## 尚缺的候选（按 10 职业表）

- 02_军人佣兵：Whip、Clark、Heidern（怒队补员）
- 05_摔跤力量：Raiden（摔角面具）、Antonov、Brian Battler
- 07_改造人机械：Maxima、K9999、Nameless（整职业未覆盖）
- 08_黑帮街头：Ramon（特工/黑帮跨界）
- 10_Boss神明：Orochi 大蛇、Mukai、Saiki（M5 后再上）
- 09_辅助医疗：由 Athena 兼任，暂缓

候选补源：Mugen Guild「Mediafire Backup Thread」存档帖的 mega 文件夹映射表
（`%TEMP%\mfbackup\charmap.csv`，730 条角色→文件夹映射）。抓取/下载脚本见
`.cache/ff-studio/megajs/`（mega-list.cjs 列目录、mega-dl.cjs + dl-manifest.json 批量下载），
走 Clash 代理 127.0.0.1:7890，mega 免登录。

## 与引擎的关系

- 本目录只做**归档与挑选**，不直接被引擎读取；进引擎需拷贝到 `ikemen-fs/file/chars/<角色>/` 并重建 manifest（`node .cache/scripts/rebuild-manifest.mjs`）
- 新角色包入库后必须跑 `node .cache/scripts/patch-char-ai.mjs` 给 AI Start 块加 `Ailevel > 0` 闸
- 引擎内已有角色（Rugal2nd/Leona/Hinako/K'/Lin/98-kim 残缺/LinYu 自制）不在本目录，见项目 AGENTS.md
- 查看角色资产：`http://localhost:8100/ff-studio/src/viewer.html`（SFF v1/v2 + ACT + AIR + DEF，支持拖拽与服务器模式）