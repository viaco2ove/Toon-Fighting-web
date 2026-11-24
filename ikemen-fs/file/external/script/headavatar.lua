--;===========================================================
--; HEAD AVATAR —— 实体头顶悬浮头像的坐标输出
--;===========================================================
--; 做法沿用 toonflow-field-survival 的「实体头上挂个悬浮头像」：
--;   那边是 canvas 直接按实体坐标画头像；这边引擎 canvas 是 wasm 画的、
--;   HTML 侧盖不进画布内部，所以拆成两步：
--;     1) 引擎每 4 帧把双方的**最终渲染屏幕坐标**吐给前端（print）
--;     2) 前端把头像 DOM 定位到该坐标上方（见 index.html 的 headAvatar）
--;
--; 坐标口径（2026-11-24 实测标定，勿凭直觉改）：
--;   引擎的 screenPosX()/screenPosY() **不含相机缩放**——
--;   char.go:6131 的原话是 "TODO: supposed to be affected by zoom camera"，
--;   直接拿它当屏幕坐标用，开镜头缩放的 stage 会偏。
--;   从渲染管线反推（anim.go:1456 DrawList.draw + camera.go:211 setScreenPos）：
--;     screenX = screenPosX + gameWidth/2 * (1 - 1/zoom)   + 常数项(相机offset, 通常0)
--;     screenY = screenPosY + cameraPosY * (1 - 1/zoom)    + 同上
--;   其中 gameWidth()/cameraPosY()/cameraZoom() 都有 Lua 绑定。
--;   本文件把修正后的「游戏坐标」(单位=gameWidth×gameHeight 的像素，左上原点)
--;   发给前端；前端再用 canvas 的 contain-fit 缩放换算成 CSS 像素。
--;
--; 实测参考：默认 320x240 分辨率下，站立的 P1 在 screenPosX≈60，
--;   画面对应位置 ≈ 60/320 = 19% 处 —— 公式在 zoom=1 时退化为原值，已验证。
--;
--; 性能：每帧 print 是一次跨进程往返（stdout → vfs.js → console），
--; 所以攒 4 帧输出一次，并且**坐标没变就不输出**——
--; 角色站着不动时完全静默，动起来才每 4 帧一发。

headAvatar = {}

-- 诊断开关：每 interval 帧打印一次相机/坐标原始值（排查头像偏移用，平时关）
headAvatar.debug = false

-- 每帧计数与上次坐标（按玩家号存）
headAvatar.tick = 0
headAvatar.last = {}
-- 输出间隔（帧）。4 ≈ 15 次/秒，够跟手又不吵。
headAvatar.interval = 4

-- 某个玩家修正缩放后的游戏坐标（游戏分辨率像素，左上原点）。
-- player(pn) 会把引擎的 debugWC 切到该玩家，随后 screenPosX/Y 读的就是它。
local function headAvatar_pos(pn)
	if not player(pn) then
		return nil, nil
	end
	local z = cameraZoom()
	local hw = gameWidth() / 2
	local x = screenPosX() + hw * (1 - 1 / z)
	local y = screenPosY() + cameraPosY() * (1 - 1 / z)
	-- 切回玩家 1，免得影响别的脚本的上下文
	player(1)
	return x, y
end

local function headAvatar_emit()
	headAvatar.tick = headAvatar.tick + 1
	if headAvatar.tick < headAvatar.interval then
		return
	end
	headAvatar.tick = 0

	if headAvatar.debug then
		local dbg = {}
		dbg[#dbg + 1] = "zoom=" .. string.format("%.3f", cameraZoom())
		dbg[#dbg + 1] = "camPos=" .. string.format("%.1f,%.1f", cameraPosX(), cameraPosY())
		dbg[#dbg + 1] = "game=" .. gameWidth() .. "x" .. gameHeight()
		for pn = 1, 2 do
			if player(pn) then
				dbg[#dbg + 1] = pn .. ":s=" .. string.format("%.1f,%.1f", screenPosX(), screenPosY()) ..
					" p=" .. string.format("%.1f,%.1f", posX(), posY()) ..
					" h=" .. tostring(spriteVar("height"))
			end
		end
		player(1)
		print("TF_CAM:" .. table.concat(dbg, "|"))
	end

	-- g= 段：zoom + 游戏分辨率，前端算「游戏像素 → CSS 像素」的缩放要用
	local meta = "g=" .. string.format("%.3f", cameraZoom()) .. "," .. gameWidth() .. "," .. gameHeight()
	local parts = {}
	for pn = 1, 2 do
		local x, y = headAvatar_pos(pn)
		if x ~= nil then
			-- 取整到 0.1px：浮点尾巴会让「没变」判定失效
			local cur = string.format("%.1f,%.1f", x, y)
			local key = tostring(pn)
			if headAvatar.last[key] ~= cur then
				headAvatar.last[key] = cur
				parts[#parts + 1] = key .. ":" .. cur
			end
		end
	end
	if #parts > 0 then
		print("TF_HEAD:" .. meta .. "|" .. table.concat(parts, "|"))
	end
end

hook.add("loop", "headAvatar", headAvatar_emit)
