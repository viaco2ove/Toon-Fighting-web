# Toon-Fighting-web
对接 toonflow-game-app 后端，实现ai 化的格斗游戏终端。

把 [Ikemen GO](https://github.com/ikemen-engine/Ikemen-GO)（MUGEN 兼容的 2D 格斗引擎）编译成
WebAssembly，在浏览器里直接用真实 MUGEN 角色资产跑对局的网页格斗 Demo。

- 纯静态前端 + 自写 Node 静态服务器，无构建脚本、无依赖
- 中文选人屏 / 练习模式（P2 站桩）/ 正式对战（CPU 强度可调）
- 主界面「系统设置」：键位改绑、性能↔质量档位（默认最佳性能 640×480）、分辨率 / 滤镜 / 音量，
  全部保存在浏览器 localStorage，换机不丢
- 引擎虚拟文件系统（vfs.js）懒加载资源，首次进局才拉角色包

## 运行

```bash
node serve.cjs          # 默认 8100 端口
# 浏览器打开 http://localhost:8100/
```

Node ≥ 18 即可，无需安装依赖。建议用独立的 Chrome / Edge 窗口游玩（WebGL 硬件加速），
不要用 IDE 内嵌浏览器（软件渲染会掉帧，且窗口失焦时浏览器会把帧循环降到 1fps）。

调试与开发的工程规范见 [AGENTS.md](AGENTS.md)。
- 基础启动：node serve.cjs
- 连接toonflow-game-app 后端：node serve.cjs --conn
将会读取 [.env](../../../.env)
- 选定故事启动：
node serve.cjs -- --story 末世选择，从解析神明开始成神 --conn
将会加载资产集(地图集)：[末世选择，从解析神明开始成神](../../../workshops/toon-fighting-web/map_design/%E6%9C%AB%E4%B8%96%E9%80%89%E6%8B%A9%EF%BC%8C%E4%BB%8E%E8%A7%A3%E6%9E%90%E7%A5%9E%E6%98%8E%E5%BC%80%E5%A7%8B%E6%88%90%E7%A5%9E)
并绑定 [story.json](../../../workshops/toon-fighting-web/map_design/%E6%9C%AB%E4%B8%96%E9%80%89%E6%8B%A9%EF%BC%8C%E4%BB%8E%E8%A7%A3%E6%9E%90%E7%A5%9E%E6%98%8E%E5%BC%80%E5%A7%8B%E6%88%90%E7%A5%9E/story.json) 
对应的故事

## gui 运行(构想中)
node serve.cjs -gui --conn 

## 资产获取（重要）

出于版权原因，本仓库**不包含**以下内容（已在 `.gitignore` 排除），
克隆后需自行放入对应位置才能开打：

| 缺失内容 | 位置 | 获取方式 |
|---|---|---|
| 引擎二进制 | `ikemen.wasm`（仓库根目录） | 从上游 fork `Toon-WebMUGEN-2.0/ikemen-go-web` 用 Go 工具链构建（`GOOS=js GOARCH=wasm`，配套的 `wasm_exec.js` 已在仓库内）；或使用 Ikemen GO 官方发行包编译 |
| 角色包 | `ikemen-fs/file/chars/<角色名>/` | MUGEN 社区站点：[MUGEN Archive](https://mugenarchive.com)、[MUGEN Free For All](https://mugenfreeforall.com) 等；KOF 系角色（K'、Lin、Rugal、Hinako）源自 SNK《拳皇》素材，MasterRyu 源自 Capcom《街头霸王》素材，**版权归原厂商，仅供个人学习研究** |
| 场景包 | `ikemen-fs/file/stages/` | 同上，MUGEN 社区站点获取；KFM 等基础场景随 Ikemen GO / MUGEN 1.x 官方发行包自带 |

放入资产后，若文件与 `ikemen-fs/manifest.json` 登记的大小不符，引擎会静默加载旧内容——
需按 AGENTS.md「改动前必读」第 1 条重建 manifest（遍历 `ikemen-fs/file`、排除 `*.bak*`、
登记相对路径与字节数）。

## 协议

- 本仓库自有工程代码（`index.html`、`serve.cjs`、`AGENTS.md` 等）：[MIT](LICENSE)
- 第三方组件（引擎 Ikemen GO = MIT、Go 胶水层 = BSD-3、vfs.js = 上游未附许可证）：见 [NOTICE.md](NOTICE.md)
- 角色包 / 场景包中的美术与音频素材**不在本仓库内**，版权属于 SNK、Capcom 等原厂商及
  MUGEN 社区作者，禁止随本仓库再分发

## 目录结构（仅列本仓库自有部分）

- `index.html` —— 页面外壳：加载屏、选人屏、练习/对战/系统设置、遮罩与按键回显
- `serve.cjs` —— 静态服务器（no-store + Range + wasm MIME），`node serve.cjs` 直接跑
- `vfs.js` / `wasm_exec.js` —— 引擎虚拟文件系统与 Go runtime 胶水层（来源见 NOTICE.md）
- `AGENTS.md` —— 面向 AI/开发者的工程规范（四条必读机制：manifest 同步、AI 闸、
  窗口遮挡死锁、localStorage 覆盖层 + 系统设置注入机制）
- `ikemen-fs/manifest.json` —— 资源清单（路径 → 字节数，stamp 防缓存）
- `ikemen-fs/file/{data,external,font,save}` —— 引擎内置脚本、motif、字体、存档目录
  （来自 Ikemen GO fork，MIT）
