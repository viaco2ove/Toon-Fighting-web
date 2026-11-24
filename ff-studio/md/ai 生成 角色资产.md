# ai 生成 角色资产
有，而且 2026 年这类工具已经相当成熟。按对你 Toon-Fighting 管线（侧视格斗小人、多帧、透明底、要转 SFF）的实用度排序：

**第一梯队（直接出可用的逐帧 sprite sheet）**

- **Retro Diffusion**（retrodiffusion.ai）——目前像素画 AI 里口碑最好的，输出是真像素网格不是“看起来像素”的高清图。杀手锏是 **Advanced Animations**：上传一张你自己的角色图（比如 LinYu 站立帧），选 walking / idle / attack，直接回一段 4~16 帧的循环动画 sprite sheet，**角色保持 on-model**。按张计费（约 $0.03~0.18/图，动画 $0.10 起），新账号送 $0.50 余额，有免费 API 和 MCP 服务器
- **PixelLab**（pixellab.ai）——老牌像素 AI，工具面最广：文字/骨骼驱动动画、**4/8 方向旋转**、风格一致的 inpainting 编辑，16×16 到 512×512。有 Aseprite 插件和 MCP，可以接到 Claude Code 里让 agent 直接生成素材。缺点是动画质量不是它最强项
- **SpriteGen / Sprite Fusion**——描述角色+动作（idle/walk/attack/hurt/death 都有预设），一分钟出透明底 PNG 图集，帧距均匀，且支持“上传参考图让下一个动作保持同一角色”——这正是格斗角色多动作一致性的痛点。SpriteGen 免费给 2 次，订阅 $16/月

**给你的管线的接入点**：这些工具的输出（透明底逐帧 PNG）正好能喂进你 ff-studio 已有的流程——白模体帧 AI 生成 → 贴头（paste_head）→ 调色板重映射 → 回写 SFF。也就是说 AI 负责“造身体帧”，你现有的管线负责入库，headswap 那套完全复用。另外别忘了一条**零成本路**：toonflow 后端本来就有生图通道（`plugin/agentRun` 的 sprite 生成 agent），先拿它试，效果不够再上这些付费站。

**注意事项**：AI 生成的帧轴心（axis）、身高比例、帧间距不会自动对齐 MUGEN 规范，转 SFF 前需要在查看器里逐帧校一遍——你现在正好有 viewer.html 可以干这个。另外格斗角色需要大量受击/防御/投技帧，这类工具预设动作有限（attack 通常只有一两段），复杂动作可能还得靠现成包改编。
