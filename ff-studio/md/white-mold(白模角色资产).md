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