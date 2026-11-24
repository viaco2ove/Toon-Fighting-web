--;===========================================================
--; HEAD AVATAR —— 实体头顶悬浮头像的坐标输出
--;===========================================================
--; 做法沿用 toonflow-field-survival 的「实体头上挂个悬浮头像」：
--;   那边是 canvas 直接按实体坐标画头像；这边引擎 canvas 是 wasm 画的、
--;   HTML 侧盖不进画布内部，所以拆成两步：
--;     1) 引擎每帧把双方的**最终渲染屏幕坐标**吐给前端（print）
--;     2) 前端把头像 DOM 定位到该坐标上方（见 index.html 的 headAvatar）
--;
--; 坐标口径：screenPosX()/screenPosY() 是引擎自己的最终渲染屏幕坐标
--;   screenPosX = pos[0]*localscl - cam.ScreenPos[0]
--;   screenPosY = pos[1]*localscl - cam.ScreenPos[1]
--; 已经含角色局部坐标缩放与相机偏移，前端按画布缩放换算即可。
--;
--; 性能：每帧 print 是一次跨进程往返（stdout → vfs.js → console），
--; 所以攒 4 帧输出一次，并且**坐标没变就不输出**——
--; 角色站着不动时完全静默，动起来才每 4 帧一发。

headAvatar = {}

-- 每帧计数与上次坐标（按玩家号存）
headAvatar.tick = 0
headAvatar.last = {}
-- 输出间隔（帧）。4 ≈ 15 次/秒，够跟手又不吵。
headAvatar.interval = 4

-- 取某个玩家的屏幕坐标与角色可见高度。
-- player(pn) 会把引擎的 debugWC 切到该玩家，随后 screenPosX/Y 读的就是它。
-- 角色高度用当前帧精灵的高度（spriteVar("height")）：它就是屏幕上真实画出来的高度，
-- 前端拿它把头像抬到头顶 —— 比按 localcoord 猜准得多
-- （倒地/跳跃时精灵高度会变，头像也跟着贴合）。
local function headAvatar_pos(pn)
	if not player(pn) then
		return nil, nil, nil
	end
	local x = screenPosX()
	local y = screenPosY()
	local h = spriteVar("height")
	local w = spriteVar("width")
	-- 切回玩家 1，免得影响别的脚本的上下文
	player(1)
	return x, y, h, w
end

local function headAvatar_emit()
	headAvatar.tick = headAvatar.tick + 1
	if headAvatar.tick < headAvatar.interval then
		return
	end
	headAvatar.tick = 0

	local parts = {}
	for pn = 1, 2 do
		local x, y, h, w = headAvatar_pos(pn)
		if x ~= nil then
			-- 取整到 0.5px：浮点尾巴会让「没变」判定失效
			local sx = string.format("%.1f", x)
			local sy = string.format("%.1f", y)
			local key = string.format("%d", pn)
			local prev = headAvatar.last[key]
			local cur = sx .. "," .. sy .. "," .. tostring(h) .. "," .. tostring(w)
			if prev ~= cur then
				headAvatar.last[key] = cur
				parts[#parts + 1] = pn .. ":" .. cur
			end
		end
	end
	if #parts > 0 then
		print("TF_HEAD:" .. table.concat(parts, "|"))
	end
end

hook.add("loop", "headAvatar", headAvatar_emit)
