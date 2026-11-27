--;===========================================================
--; COMBAT FX —— 战斗反馈桥：命中/伤害信号输出给前端（[toon] 缺陷E）
--;===========================================================
--; 做法沿用 headavatar.lua 的「print 通道」：
--;   引擎侧每 2 帧采样双方 life()，掉血即视为被击中，输出
--;     TF_HIT:v=<受害者pn>,d=<掉血量>,x=<游戏坐标x>,y=<游戏坐标y>
--;   前端（index.html 的 hookEngineConsole）解析后在受害者位置画
--;   击中火花 + 伤害数字——这就是「伤害机制」的可视化层；
--;   技能的圆/扇形范围指示与 buff 徽章由前端按技能语义绘制。
--; 坐标口径与 headavatar 完全一致：screenPosX/screenPosY 补偿相机缩放
--; 后的「游戏分辨率像素」（左上原点），前端用 contain-fit 换算 CSS 像素。
--; 性能：采样本身便宜；只在 life 下降时输出，站桩/移动/回血完全静默。
--; 回合重置 life 回满（上升）不会误报；KO 一击的大额掉血会如实输出。

combatfx = {}

combatfx.tick = 0
combatfx.last = {} -- pn -> 上一次采样的 life

local function combatfx_pos()
	local x = screenPosX() + gameWidth() / 2 * (1 - 1 / cameraZoom())
	local y = screenPosY() + cameraPosY() * (1 - 1 / cameraZoom())
	return x, y
end

local function combatfx_emit()
	combatfx.tick = combatfx.tick + 1
	if combatfx.tick < 2 then
		return
	end
	combatfx.tick = 0
	local parts = {}
	for pn = 1, 2 do
		if player(pn) then
			local life = life()
			local prev = combatfx.last[pn]
			if prev ~= nil and life < prev then
				local x, y = combatfx_pos()
				if x ~= nil then
					parts[#parts + 1] = 'v=' .. tostring(pn) ..
						',d=' .. tostring(prev - life) ..
						',x=' .. string.format('%.1f', x) ..
						',y=' .. string.format('%.1f', y)
				end
			end
			combatfx.last[pn] = life
		end
	end
	-- 切回玩家 1，免得影响别的脚本（headavatar 同款约定）
	player(1)
	if #parts > 0 then
		print('TF_HIT:' .. table.concat(parts, '|'))
	end
end

hook.add('loop', 'combatfx', combatfx_emit)
