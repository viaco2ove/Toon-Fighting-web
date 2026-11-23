# AI 格斗联动 · 总体设计（实施方案）

> 上游设计：[ai格斗设计.md](ai格斗设计.md)（本文件把它落成可实施的设计）
> 资产集子设计：[资产集/README.md](资产集/README.md)
> 基线日期：2026-11-23 · 基于已交付形态（设置面板/虚拟手柄/APK/GitHub 开源版）

---

## 0. 现状基线（设计输入）

| 已有 | 内容 |
|---|---|
| 站点形态 | 静态站 + serve.cjs（47 行纯静态，无任何 API）+ wasm 引擎 |
| .env（已存在，禁止外泄） | `game_app_service_url` / `user_name` / `user_psw` / `auth_token` / `game_app_sessionId` / `game_app_storyName` / `game_app_worldId` |
| 末世绑定种子 | `workshops/toon-fighting-web/map_design/末世选择，…/story.json`：`{storyName, sessionId, worldId}` |
| 参考插件 | toonflow-field-survival：`tsApi.pluginData.get/set` ↔ `t_plugin_session_data`；`tsApi.agent.run` 生图契约 `{prompt, refImages≤3, size} → {image}`；manifest `contributes.minigame/sidebar/mcpTools` |
| 默认资产 | `ikemen-fs/file/chars/`（4 可跑角色）、`stages/`（9 def）、版权素材不入库 |

---

## 1. 运行形态总览

| 形态 | 启动命令 | 后端 | 资产 | 说明 |
|---|---|---|---|---|
| A 纯本地 | `node serve.cjs` | 无 | 默认资产 | 现状，保持不变（默认形态） |
| B 联动 | `node serve.cjs --conn` | 读 .env | 默认资产 + 故事绑定 | 主界面出现「故事联动」 |
| C 故事会话 | `node serve.cjs -- --story 末世选择，从解析神明开始成神 --conn` | 读 .env | 绑定资产集(地图集) + story.json | 形态 B 的直达快捷方式 |
| D 插件壳（可选，M6） | 由 toonflow 宿主拉起 | 宿主注入 | 同 B/C | field-survival 同款 minigame 入口 |

**形态递进原则**：B/C/D 全部以 A 为降级底线——后端不可达时自动回退 A，格斗功能永不全瘫。

---

## 2. serve.cjs --conn：BFF 代理层设计

**核心决策：前端永不直连后端。** serve.cjs 兼做「API 代理 + 节流缓存 + 凭据保管」。这样：
- auth_token 不进页面 JS（XSS/抓包面小）
- 无 CORS 问题（安卓 WebView 直打同源代理即可）
- 「通信不能过于频繁」的红线在代理层一处强制执行

### 2.1 代理端点契约

| 端点 | 方法 | 作用 | 对应后端 |
|---|---|---|---|
| `/api/conn/status` | GET | 联通状态 + 会话数（登录态自检） | service_url 探活 |
| `/api/conn/sessions` | GET | 用户的会话列表（聊过数据，仅元数据） | 会话列表接口 |
| `/api/conn/sessions/:id/messages` | GET | 会话消息（提取故事角色名/剧情概要） | 会话消息接口 |
| `/api/conn/session-data/:sessionId/:key` | GET / PUT | `t_plugin_session_data` 读写 | pluginData 接口 |
| `/api/conn/agent/generate` | POST | 生图（field-survival 的 sprite 契约） | PluginAgentRunner sprite 分支 |

> ⚠️ 后端真实路由/鉴权细节在 M1 用真实 .env 对齐；上表是代理层对前端的稳定契约，后端路径映射只在 serve.cjs 内改。

### 2.2 凭据与会话

1. 启动读 `.env`：优先用缓存 `auth_token`；`/api/*` 收到 401 时用 `user_name/user_psw` 重换 token 后重放一次。
2. `--story X` 直达：从 `workshops/toon-fighting-web/map_design/<X>/story.json` 读 `{storyName, sessionId, worldId}`，页面 query 带 `?story=<name>&session=<id>`，跳过会话选择。

### 2.3 节流与缓存（红线强制）

| 操作 | 时机 | 请求量 |
|---|---|---|
| 进联动主界面 | 用户点「故事联动」 | 1（sessions，服务端 60s 内存缓存） |
| 选会话 | 用户点击 | ≤2（messages + roster get） |
| 修改角色分配 | 编辑 | 防抖 800ms 合并成 1 次 PUT |
| **对局进行中** | — | **0（硬红线）** |
| 对局结算 | 结束时 | 1 次 PUT（胜负回写） |
| AI 生图 | 用户手动点 | 1 次/张 |

实现要点：pluginData 读写全部合并 key 写入（roster+bind 一次 set）；代理对同 key 写操作 5s 内合并。

### 2.4 降级

任何后端错误 → 代理返回 `{ok:false, error}` → 页面顶栏灰条「联动离线，已回退本地模式」；引擎 boot 与对局完全不受影响（联动数据全部在 boot 前取好）。

---

## 3. 插件化形态（形态 D，M6 可选）

参考 toonflow-game-plugins 的 field-survival，但有明确差异：

| 项 | field-survival | toon-fighting-plugin |
|---|---|---|
| 资产 | 自持（ui.tbg 内嵌） | **不自持**——引擎站是独立重资产宿主，插件只是入口壳 |
| minigame | 480×720 内嵌 game.html | iframe/外链指向 `http://<pc>:8100/index.html?conn=1`（全屏） |
| 打包 | 单 tpg | tpg（壳）+ tbg（资产集）分离 |
| entry.py | 奖励结算 | 对局胜负 → 角色参数卡奖励 |

不追求把 134MB 引擎资产塞进 tpg；终端各自装站点（PC=serve.cjs，安卓=APK），插件壳只负责「从聊天流拉起对局 + 结算回传」。

---

## 4. 资产集设计（详见 [资产集/README.md](资产集/README.md)）

一句话版：**资产集 = 安装到终端（PC/安卓）的 tbg 包，内容是「映射与文案」而非新引擎资产**——角色映射（故事角色 → 本地 chars）、场景映射（剧情 → 9 个 stages def）、主题文案。绑定用 `t_plugin_session_data` 存 `{sessionId, packId}` 即可，不上传资产到后端。

---

## 5. 主流程设计（形态 B/C）

```
主界面 ─点「故事联动」→ 会话列表(1 req, 60s缓存)
   └─ 选会话 ─→ 读 tf_fight_roster
        ├─ 无 → 按故事角色 × 默认4角色 随机分配 → PUT 持久化
        └─ 有 → 直接回显
             └─ 角色卡片可编辑：换绑 chars / 换头像 / 设对手
                  └─ 点「开打」→ roster 映射进 argv（index.html 既有拼装机制）
                       └─ 对局（0 请求）
                            └─ 结算 → 1 次 PUT 胜负 → 回联动面板
```

### 5.1 数据结构（t_plugin_session_data，3 个 key）

```jsonc
// tf_fight_bind —— 资产集绑定（简单绑定，不传资产）
{ "storyName": "末世选择，从解析神明开始成神", "sessionId": "gs_…", "worldId": 48, "packId": "moshi-v1" }

// tf_fight_roster —— 角色分配（核心持久化，可改）
{ "storyChars": [
  { "name": "陈默",          // 故事角色名（来自聊过数据/资产集角色表）
    "charId": "Hinako",      // 绑定的本地 chars 目录名（随机分配初值，可改）
    "avatarRef": null,       // 头像（图库 key 或 data:URL 小图），无则用 chars 头像
    "isPlayer": true,        // P1 候选
    "win": 0, "lose": 0 } ]  // 累计战绩，结算回写
}

// tf_fight_gallery —— AI 头像图库（体积红线：单图 ≤100KB data:URL，总量 ≤20 张）
{ "items": [ { "id": "av_01", "image": "data:image/png;base64,…", "prompt": "…", "createdAt": 0 } ] }
```

### 5.2 悬浮头像：低成本做法（沿用 field-survival 思路）

引擎 canvas 无法从 JS 拿实体坐标（wasm 内部状态），**v1 不做真正的头顶跟随**，改为两处 DOM overlay 头像（零引擎改动）：
1. **选人屏**：故事角色卡片显示头像 + 绑定 chars；
2. **对局 HUD**：左上 P1 / 右上 P2 头像条（头像 + 角色名 + 战绩），DOM 层 z-index 高于引擎 canvas。

v2 若要头顶跟随，需引擎侧 Lua 打印实体屏幕坐标（`print` → console 通道已验证可用），成本另计。

### 5.3 结算信号

对局结束感知是**待探查项**：优先从 `external/script/*.lua` 的 round 结局分支加 `print("TF_RESULT:…")`，index.html 拦 console 消息（cdp 探针同款机制反向用）；探不通则降级为「面板手动记录胜负」。

---

## 6. AI 生成实体形象

- **通道**：复用后端 PluginAgentRunner sprite 分支（契约与 field-survival 一致）：`{prompt, refImages≤3(data:URL/http), size} → {image}`；宿主未接入时返回 ok:false，前端提示且预选/绑定功能不受影响。
- **用途 v1 = 头像/立绘**（HUD 头像条、选人屏、roster 卡片）；**不替换 MUGEN 精灵**（chars 的 sff/air 是版权素材且格式复杂，v2 另议）。
- **生成流程**：角色卡片「AI 形象」→ 弹窗填提示词（预填故事角色描述）→ POST `/api/conn/agent/generate` → 生成图 → canvas 裁出头像小图（≤100KB）→ 存 tf_fight_gallery → 绑 avatarRef。
- 生成结果 + prompt 一并入库，参考 field-survival 的「图库条目可删除、绑定即换」交互。

---

## 7. 安卓端

- APK 默认形态 A（离线全功能）。
- 设置面板「个性化」新增**联动服务器地址**（默认 `http://<局域网PC>:8100`）：填了就直打该地址的 `/api/*`（serve.cjs --conn 开在 PC 上，WebView 同源代理，无 CORS）。
- tbg 资产集在安卓端安装到 app 私有目录（Capacitor Filesystem 或 WebView 可达路径），与 PC 端同一套映射逻辑。

---

## 8. 实施里程碑

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M1 代理层 | serve.cjs --conn + .env 登录 + /api/conn/status | `node serve.cjs --conn` 后 status 返回真实会话数；无 --conn 时 /api/* 返回 `{ok:false}` |
| M2 联动主界面 | 会话列表 + 选会话 + roster 随机分配 + 持久化可编辑 | 改分配 → 刷新/重启 serve → 分配仍在（t_plugin_session_data） |
| M3 对局衔接 | roster → argv 映射 + HUD 头像条 + 结算回写 | 开打后 P1/P2 就是绑定的 chars；结算后战绩 +1 |
| M4 资产集 | tbg 安装 + 映射 + 绑定 | 安装末世 tbg → 开打场景/文案按映射生效 |
| M5 AI 头像 | 生图 + 裁剪 + 图库 + 绑定 | 生成一张头像绑到角色并出现在 HUD |
| M6 插件壳（可选） | tpg 壳 + entry.py 结算 | 聊天流 `#AI格斗` 拉起全屏对局 |

依赖顺序：M1 → M2 → M3 必须串行；M4/M5 可并行；M6 最后。

---

## 9. 风险与开放问题

1. **后端 API 实际路由未核实**——M1 第一件事是用真实 .env 打通一条最小链路（status），再逐个对齐 sessions/messages/pluginData 路径；本文档只锁代理层契约。
2. **tbg 容器格式未验证**——M4 前先解包 field-survival 的 ui.tbg 确认（预计 zip 容器），再定安装器实现。
3. **pluginData 体积上限**——头像 data:URL 必须裁剪压缩（≤100KB/张），参考 field-survival「图库整体上传 sys_state 要控体积」的既有经验。
4. **对局结束信号**——Lua 侧 print 方案需 M3 探查，探不通降级为手动记录。
5. **P2 对手策略**——故事只有主角时的对手选择：默认随机 + 卡片可指定「宿敌」（roster 里 isPlayer=false 的角色）。
6. **红线不变**：chars/stages/wasm 不入库不进 tpg/tbg 公开分发；.env 永不外泄；对局中 0 后端请求。
