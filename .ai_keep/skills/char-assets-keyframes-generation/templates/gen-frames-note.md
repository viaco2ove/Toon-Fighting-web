# 现场生图备忘（无现成图时）

## 通道

```powershell
node .cache/scripts/gen-ai-frames.mjs <角色名> "<形象描述>" .cache/ai-frames/<角色> <BFF>
```

- 走后端 `/plugin/agentRun` 的 sprite 生成通道（agentName=`field-survival-sprite-gener`），
  BFF 侧入口 `POST /api/conn/agent/generate`（serve.cjs）；
- 约 10s/张 ×10；**已有文件自动跳过**——个别类失败时单删该文件重跑即可；
- 生成参数（style/systemPrompt/size/aspectRatio）已内置在脚本里，与 manifest 记录一致。

## 提示词要素（改形象时只动 baseDesc）

- `baseDesc`：一句话人设外观（发型/发色/上衣/裤/鞋，尽量具体到颜色）；
- 每类动作短语（英文）内置：stand=standing idle / walk=walking forward /
  turn=turning around / light=light punch / heavy=roundhouse kick /
  special=energy attack / hurt=recoiling / down=lying knocked out /
  air=jumping knees tucked / guard=blocking both arms；
- style：`side-scrolling fighting game sprite, single character, full body, plain
  background, clean silhouette, thick outlines, flat colors, no background scenery, no text`；
- system：`单人全身、头到脚、居中占满、朝右、无地面无阴影无道具无文字无水印、透明底`。

## 生成后自检（抽 2–3 张）

- 形象一致性：发色/服装/鞋在 10 张之间是否统一（AI 易跑色，跑色严重就重生成该类）；
- 透明底：背景必须 alpha=0（有底色会毁掉后续 SFF 量化）；
- 姿态典型性：light 要像直拳、down 要横躺——不像就重生成该类；
- 朝向统一（朝右），2:3 竖构图。

## 配额

后端模型有 Token Plan 上限（文本模型实测报 `已达到 Token Plan 用量上限 (2056)`）；
生图模型通道独立计费。失败时错误透传到脚本输出，按类重试。
