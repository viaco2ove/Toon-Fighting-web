# ai格斗设计
## 运行
- 基础启动：node serve.cjs
- 连接toonflow-game-app 后端：node serve.cjs --conn
将会读取 [.env](../../../.env)
- 选定故事启动：
node serve.cjs -- --story 末世选择，从解析神明开始成神 --conn
将会加载资产集(地图集)：[末世选择，从解析神明开始成神](../../../workshops/toon-fighting-web/map_design/%E6%9C%AB%E4%B8%96%E9%80%89%E6%8B%A9%EF%BC%8C%E4%BB%8E%E8%A7%A3%E6%9E%90%E7%A5%9E%E6%98%8E%E5%BC%80%E5%A7%8B%E6%88%90%E7%A5%9E)
并绑定 [story.json](../../../workshops/toon-fighting-web/map_design/%E6%9C%AB%E4%B8%96%E9%80%89%E6%8B%A9%EF%BC%8C%E4%BB%8E%E8%A7%A3%E6%9E%90%E7%A5%9E%E6%98%8E%E5%BC%80%E5%A7%8B%E6%88%90%E7%A5%9E/story.json) 
对应的故事

## 连接后端的形式：独立插件
可以参考：toonflow-game-plugins。但是也有不同的地方。
原则：与后端的通信不能过于频繁，也不能影响流畅性。

## Toon-Fighting-web 的默认资产
角色等资产是放哪里的？
角色等游戏资产都在 **`ikemen-fs/file/`**
**角色包** `ikemen-fs/file/chars/`**（版权素材，已 gitignore 不入库
**场景包** `ikemen-fs/file/stages/`
其余在 `ikemen-fs/file/` 下的还有 `data/`（system.def、select.def、common/fight 引擎公共脚本）、`external/script/`（main.lua 等 Lua 脚本，这部分是能进仓库的）、`font/`（含 SimHei 的 cn.ttf 9.5MB）、`sound/`、`save/`。

几个关键联动关系：

- **入库情况**：`chars/`、`stages/`、`ikemen.wasm` 被根 .gitignore 排除（SNK/Capcom 版权素材），获取方式写在 README.md「资产获取」一节和 NOTICE.md。
- **web 运行**：靠 `ikemen-fs/manifest.json`（按文件大小登记）+ vfs.js 懒加载进引擎。
- **安卓 APK**：`android_h5/sync.mjs` 会把 chars/stages 全量复制进 www/ 打进包里（私有侧载不分发，所以 APK 有 84MB）。

角色资产：最好分为多种职业的角色。
## 资产集设计
[资产集](%E8%B5%84%E4%BA%A7%E9%9B%86)
对故事会话进行资产集绑定，t_plugin_session_data 做个简单绑定即可不需要上传到后端。
资产集 安装：是安装到终端(pc/安卓)不是后端服务器。格式是tbg 文件。


## 主流程设计
主界面对接toonflow-game-app 后端，获取用户的聊过数据。点击后给角色随机分配默认资产 的角色。分配的数据持久化
可以进行修改。沿用toonflow-field-survival 在实体头上挂个悬浮头像的低成本做法。数据储存.t_plugin_session_data 机制。
如果可以的话也实现一种类似 “toonflow-field-survival”的ai 生成实体形象的做法。




