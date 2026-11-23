# 资产集（tbg）子设计

> 上游：[ai格斗联动-总体设计.md](../ai格斗联动-总体设计.md) §4
> 样本：`workshops/toon-fighting-web/map_design/末世选择，从解析神明开始成神/`（当前仅 story.json 绑定种子）

## 1. 定位

资产集回答一个问题：**「这个故事该用哪些角色、哪些场景、什么文案」**。它不携带新引擎资产（chars/stages 是 SNK/Capcom 版权包，随仓库/安装包分发都违法红线），只携带**映射与文案**，安装到终端（PC/安卓），不进后端服务器。

## 2. 包结构（tbg）

```
<pack>.tbg                          ← zip 容器（M4 前先解包 field-survival ui.tbg 验证格式）
├── pack.json                       ← 包元数据
│   { "id": "moshi-v1", "name": "末世选择资产集", "version": 1,
│     "stories": ["末世选择，从解析神明开始成神"] }
├── story.json                      ← 绑定种子（同 map_design 现有格式）
│   { "storyName": "…", "sessionId": "gs_…", "worldId": 48 }
├── roster.json                     ← 故事角色表（分配池来源）
│   { "chars": [ { "name": "陈默", "desc": "…", "isPlayer": true }, … ] }
├── mapping.json                    ← 映射表
│   { "charPool": ["Hinako","K'","Lin","Rugal2nd"],   // 可用引擎角色（≤本地已装集合）
│     "stages": { "default": "stage0", "boss": "rugalstage", … },  // 剧情→场景 def
│     "copy": { "opening": "…", "victory": "…", "defeat": "…" } }   // 主题文案
└── README.md                       ← 资产来源声明（商用授权说明，对齐 NOTICE.md 口径）
```

## 3. 安装（终端侧）

| 终端 | 安装位置 | 入口 |
|---|---|---|
| PC | `<项目根>/assets/assetpacks/<packId>/`（解包后目录） | 设置面板 → 资产集 → 选择 .tbg |
| 安卓 | app 私有目录 `assetpacks/<packId>/` | 同上（Capacitor Filesystem） |

安装器动作：解包 → 校验 pack.json/roster.json/mapping.json 结构 → `charPool` 与本地 `chars/` 目录求交集（不存在的角色剔出分配池）→ 登记 `assets/assetpacks/index.json` → 支持卸载。

## 4. 绑定（会话侧）

`serve.cjs --conn` 启动或页面选会话时：
1. 读 `t_plugin_session_data` key=`tf_fight_bind`——有 `{packId}` 且本地已装 → 生效；
2. 无绑定 → 按 `--story` 参数或会话 storyName 匹配 `stories[]` 提示一键绑定（写回 tf_fight_bind，不上传任何资产）。

绑定生效范围：联动面板的角色分配池、开打的场景选择、HUD 文案。**纯本地形态（A）完全不读资产集。**

## 5. 与版权红线的关系

- tbg 内不含任何 sff/air/snd/wasm 二进制资产 → 可入库、可分发；
- `mapping.json` 里出现的角色名（Hinako 等）只是目录名引用，资产本体仍由用户按 README「资产获取」自行获取；
- AI 生成头像属新生成物，存 `t_plugin_session_data`（会话侧），不进 tbg。
