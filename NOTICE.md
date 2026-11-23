# Third-party components and their licenses

本仓库 MIT LICENSE 仅覆盖本仓库自有的工程代码。以下第三方组件各自的授权如下。

## 1. Ikemen GO（引擎 + data/、external/ 内置脚本与字体）

- 许可证：MIT（完整文本见上游 `ikemen-go-web/LICENCE.txt`）
- 版权：Copyright (c) 2016-2026 Ikemen GO contributors（Suehiro, K4thos, NeatUnsou 等）
- 上游：https://github.com/ikemen-engine/Ikemen-GO ；本仓库所用为定制 fork（`../Toon-WebMUGEN-2.0/ikemen-go-web`），同样以 MIT 分发
- 涉及文件：`ikemen-fs/file/data/**`（公共脚本、fight 资源、motif）、`ikemen-fs/file/external/script/**`、`ikemen-fs/file/font/**`、`ikemen.wasm`（由该 fork 编译）

## 2. wasm_exec.js（Go 官方胶水层）

- 许可证：BSD 3-Clause（Go 工具链发行物，随 `GOOS=js GOARCH=wasm` 生成）
- 注意：必须与编译 `ikemen.wasm` 的 Go 版本配套，勿单独替换

## 3. vfs.js（虚拟文件系统 shim）

- 来源：上游 `Toon-WebMUGEN-2.0/web-test` 项目
- 许可证：**上游未附带 LICENSE 文件**，默认保留所有权利；本仓库仅在私有部署场景下随源使用，未单独授权再分发。如需公开分发请先取得上游作者授权或替换为自研实现

## 4. 字体

- `font/cn.ttf`：内部名为 **SimHei（中易黑体）**，版权归北京中易电子/微软所有，
  随 Windows 发行。本仓库为保持中文界面可用而随源附带，
  **商用请自行替换为开源字体（如思源黑体 Noto Sans SC，重命名为 cn.ttf 即可）**。
- `font/Open_Sans/**`：随附其自有 LICENSE.txt。

## 5. mugen-studio 相关（如引用其产物）

- 许可证：MIT（Copyright (c) 2026 energy.jp）

## 5. 游戏角色包与场景（不随本仓库分发）

- `chars/`、`stages/` 中的 MUGEN 角色包与场景包**不属于本仓库代码**，
  其美术素材版权归 SNK、Capcom 等原厂商及 MUGEN 社区作者所有。
  本仓库按 .gitignore 排除这些内容；获取方式见 README.md「资产获取」。