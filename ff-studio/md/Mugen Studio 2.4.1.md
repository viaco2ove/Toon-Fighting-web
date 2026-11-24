# mugen-studio-app
在 `Toon-WebMUGEN-2.0\mugen-studio-app\`——**Mugen Studio 2.4.1 已经装好了**（`MugenStudio.exe`，还有 `downloads\` 里 130MB 的安装 zip 备份），不用再去下 Fighter Factory。

它是 energyjp 开源的免费 Windows 工具（MIT 协议，源码就在同级 `mugen-studio\`）：拖入角色/舞台/音乐/界面包 → 排布 → 导出成网页游戏或 Ikemen GO 桌面版。角色查看/编辑能力来自它挂的 Ikemen GO 本体，内置 KFM 示例和 Training 帧计量器 add-on。

不过要说明定位差异：**它是「拼游戏」的工具，不是逐帧美术编辑器**——适合把做好的角色包装配进游戏、调界面、导出站点；而逐帧改图、改动画、改判定框这类精灵级编辑，还是 `ff-studio` 脚本（程序化批量）或 Fighter Factory Studio（交互式）。

所以你手上的资产工具链现在是三层：

| 层 | 工具 | 用途 |
|---|---|---|
| 拼装/导出 | `mugen-studio-app\MugenStudio.exe`（本机已装） | 组阵容、调 screenpack、导出网页/桌面版 |
| 程序化批处理 | `ff-studio\sff.py / palette.py` | 贴头、换配色、量产角色包（林羽 v0.2 就是它做的） |
| 交互式精修 | Fighter Factory Studio 3.7（未装，需要再说） | 逐帧改图、编 AIR 动画、改判定框 |

想现在验证 Mugen Studio 能不能认 LinYu 包的话，可以直接把 `chars\LinYu\` 拖进它界面试试——要我帮你跑起来看吗？