---
name: h5-app-up-collections
description: 把 PC 端资产集（workshops/.../map_design/<故事>）打包更新到已装 Toon-Fighting APK 的手机，并绑定故事会话。走 APK 内置 MCP HTTP 服务（7073）：install_asset_pack 全量覆盖安装 + bind_story_session 原生直写 tf_fight_bind。当用户要求「更新手机上的资产集 / 把资产集装到手机 / 绑定故事」时使用。
---

# h5-app-up-collections —— 资产集推送到手机 + 绑定故事

## 定位

APK 里**没有 Node 服务端**：资产集是安装到手机独立目录的数据（`/data/data/com.viaco.toonfighting/files/packs/<packId>/`），
不随 APK 分发。PC 端改了 `workshops/toon-fighting-web/map_design/<故事>/` 之后，
手机上的拷贝要**单独同步**——本技能就是那条链路 + 故事绑定。

```
PC: map_design/<故事>/  ──zip──►  /data/local/tmp/tf-<packId>.zip
                        ──adb push──►  手机
                        ──MCP install_asset_pack──►  files/packs/<packId>/（整目录覆盖）
                        ──MCP bind_story_session──►  写会话 tf_fight_bind + 本机配置
```

## 前置条件

| 条件 | 说明 |
|---|---|
| adb 可见设备 | USB 或 WiFi adb；多设备用 `ADB_SERIAL` 指定 |
| APK 已安装 | `com.viaco.toonfighting`（app 没开脚本会自动 monkey 拉起并等 MCP 起来） |
| MCP 开关开着 | app 系统设置里可关；默认开、端口 7073（改过用 `MCP_PORT`） |
| app 已登录后端 | **绑定故事要查会话列表**：设置面板里配好 backendUrl + 账号（或 `set_config` 的 `login`）；查询类工具不登录也能用 |
| 包内 pack.json | `stories` 必须声明故事名——手机端「切换故事资产集跟随」靠它（`list_installed_packs` 会回 stories） |

## 用法

```bash
# 只装包
node .zcode/skills/h5-app-up-collections/templates/push-pack.mjs \
     "workshops/toon-fighting-web/map_design/通天传授-收徒系统"

# 装包 + 绑定故事（推荐；读包内 story.json 的 sessionId，失败按故事名兜底找会话）
node .zcode/skills/h5-app-up-collections/templates/push-pack.mjs \
     "workshops/toon-fighting-web/map_design/通天传授-收徒系统" --bind

# 直连手机 IP（同一 WiFi，不用 USB）：PHONE_HOST=192.168.x.x
# 多设备：ADB_SERIAL=<serial>
```

脚本做的事：① 打 zip（deflate，UTF-8 文件名标志位，跳过 `*.bak*`）→ ② `adb push`
到 `/data/local/tmp/tf-<packId>.zip` → ③ `install_asset_pack`（dest 先删后装=全量覆盖）
→ ④ `list_installed_packs` 复核 chars/stories → ⑤（`--bind`）`bind_story_session` +
`get_config` 复核 boundSessionId/boundPackId。zip 默认落 `.cache/push/` 用完即删（`--keep` 保留）。

## 手机端 MCP 工具面（POST /mcp，JSON-RPC 2.0）

```bash
node .zcode/skills/h5-app-up-collections/templates/mcp.mjs list        # 工具清单
node .zcode/skills/h5-app-up-collections/templates/mcp.mjs call list_installed_packs
```

| 工具 | 参数 | 执行路径 |
|---|---|---|
| `install_asset_pack` | `{source:手机本地zip或目录, packId}` | 原生 PackStore：解压/复制 → 读 pack.json 补登记簿 |
| `uninstall_asset_pack` | `{packId}` | 原生 |
| `list_installed_packs` | - | 原生（含 stories——**故事跟随的依据**） |
| `list_asset_packs` / `get_asset_pack` / `select_asset_pack` / `get_current_asset_pack` | packId | webview `__tfMcp.*`（挂载/切包必须走运行时；预算 90s） |
| `bind_story_session` | `{sessionId, packId?}` | **原生直写**：查会话列表拿 title → getSessionMeta 拿 worldId → PUT 会话 `tf_fight_bind` `{storyName,sessionId,worldId,packId}` + 写本机配置；页面同步是 best-effort（15s 预算，冷启动拿不到就算了，绑定本体已落库） |
| `list_story_sessions` / `get_story_session` / `get_current_story` | sessionId | webview |
| `get_config` / `set_config` | `{enabled?,port?,backendUrl?,login?{user,password}}` | 原生 McpConfig（password/token 不回显） |

## 排查

| 症状 | 根因 → 处理 |
|---|---|
| `ECONNREFUSED 127.0.0.1:7073` | app 没开或 MCP 开关关了 → 脚本会自动 monkey 拉起等 45s；还不行去 app 设置里看开关/端口 |
| 装完 `list_installed_packs` 没有 stories | 包内 pack.json 没声明 `stories`，或 APK 是旧版（PackStore.listPacks 的 stories 是 2026-11-27 加的，重装 APK） |
| 绑定报「没有这个会话」 | 手机登录账号的会话列表里没有包内 story.json 的 sessionId → 脚本自动按故事名兜底找会话再绑 |
| 绑定成功但界面没反应 | 原生绑定不依赖 webview；冷启动页面同步失败是正常的（note 字段会说明），重进故事面板/重启 app 自动恢复 |
| push 很慢 | 大包 zip 后单文件 push 本来就快；慢说明在传目录——本技能恒走 zip |
| webview 工具超时 | `callGame` 走 evaluateJavascript 两步桥（`__tfMcpCall` → 轮询 `__tfMcpResults`），冷启动+大包挂载会拖满 90s 预算；重试或先手动进 app |

## 红线

- app 运行时**不依赖 PC**：MCP/后端/资产集全在手机本地，PC 只在推送瞬间参与。
- 后端账号凭据只允许在**本地命令**里出现（`set_config` 的 login），不写进任何文档或提交。
- `install_asset_pack` 是**整目录覆盖**：手机上手工改过的包内容会被 PC 版冲掉，推之前确认。
