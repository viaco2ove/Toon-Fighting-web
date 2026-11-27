--;===========================================================
--; COMBAT FX —— 战斗反馈桥：命中/伤害/命令桥/开战信号
--;===========================================================
--; 1) 命中信号：每 2 帧采样双方 life()，掉血即输出
--;      TF_HIT:v=<受害者pn>,d=<掉血量>,x=<游戏坐标x>,y=<游戏坐标y>
--;    前端画击中火花 + 伤害数字；坐标口径与 headavatar 一致（已补偿相机缩放）。
--; 2) 命令桥（2026-11-27 技能机制 v3）：前端把技能的真实效果写进
--;      save/tf-cmd.ini  （[Cmd] seq=<n> healPct=<pct> name=... durSec=...）
--;    这里每 2 帧读一次（loadText 走 VFS，浏览器覆盖层写入立即可见），
--;    seq 变化即执行：回血 = player(1) 上下文里 setLife(life + lifeMax*pct/100)
--;    （引擎只给 setLife，没有 lifeAdd；只有活着才生效），然后输出
--;      TF_HEAL:v=1,amt=<真实回血量>
--;    前端据此画绿色治疗数字。攻击力/持续时间的可视化（徽章）由前端自管。
--; 3) 开战信号（2026-11-28 修「二阶段黑屏」）：
--;    **引擎开始出帧 ≠ 战斗画面已经画出来**。原先前端用
--;    「帧数 > 20 且帧率 ≥ 12fps」撤加载遮罩并开始倒数，
--;    那时引擎还在 pre-intro（stage/角色仍在解码）→ canvas 全黑 →
--;    用户看到「倒数完了还是黑屏，再开打」。
--;    这里改成引擎自己报告：
--;      roundState() >= 1  → 回合画面已经立起来了（stage + 角色 + ROUND 1 公告）
--;    此时输出一次 TF_FIGHT:1，前端才撤遮罩 + 起倒数 → 倒数期间画面是活的。
--;    顺带输出 TF_TL: 时间线（帧数/roundState/introState/stageTime/角色数），
--;    探针用它和 canvas 亮度采样对齐，定位黑屏窗口。
--; 性能：采样便宜；只在 life 下降 / seq 变化 / 阶段切换时输出，其余完全静默。

combatfx = {}

combatfx.tick = 0
combatfx.last = {} -- pn -> 上一次采样的 life
combatfx.cmdSeq = -1
combatfx.fight = false -- 是否已经报过「战斗画面已就绪」
combatfx.tlTick = 0 -- TF_TL 时间线的帧计数

local function combatfx_pos()
	local x = screenPosX() + gameWidth() / 2 * (1 - 1 / cameraZoom())
	local y = screenPosY() + cameraPosY() * (1 - 1 / cameraZoom())
	return x, y
end

local function combatfx_cmd()
	local ok, txt = pcall(loadText, 'save/tf-cmd.ini')
	if not ok or txt == nil then return end
	-- 注意：string.match 可能返回 nil，而这个引擎的 Lua 里 tonumber(nil) 会直接抛错
	--（2026-11-28 实测：扣血命令文件里没有 healPct → combatfx.lua:46 崩到引擎错误弹窗）。
	-- 所有「可选键」的解析都必须走 matchnil 安全封装。
	local function tonum(pat)
		local m = string.match(txt, pat)
		if m == nil then return nil end
		return tonumber(m)
	end
	local seq = tonum('seq%s*=%s*(-?%d+)')
	if seq == nil or seq <= combatfx.cmdSeq then return end
	combatfx.cmdSeq = seq
	local pct = tonum('healPct%s*=%s*([%d.]+)')
	if pct ~= nil and pct > 0 then
		if player(1) then
			local lm = lifeMax()
			local before = life()
			local add = math.floor(lm * pct / 100 + 0.5)
			if add > 0 then
				local after = math.min(lm, before + add)
				setLife(after)
				print('TF_HEAL:v=1,amt=' .. tostring(after - before))
			end
		end
		player(1)
	end
	-- 技能球体伤害（2026-11-28 用户实报「球体没有伤害判定」）：
	-- 前端逐帧做碰撞判定，碰到谁就写 dmgPct=<最大生命百分比> victim=<pn>，
	-- 这里直接 setLife 扣血；掉血会被上面的采样循环自动报成
	-- TF_HIT:v=<victim>,d=<扣血量>,x=...,y=...（前端画伤害数字，无需新信号）。
	local dpct = tonum('dmgPct%s*=%s*([%d.]+)')
	local victim = tonum('victim%s*=%s*(%d+)')
	if dpct ~= nil and dpct > 0 and victim ~= nil and victim >= 1 and victim <= 4 then
		if player(victim) then
			local lm = lifeMax()
			local before = life()
			local sub = math.floor(lm * dpct / 100 + 0.5)
			if sub > 0 then
				setLife(math.max(0, before - sub))
			end
		end
		player(1)
	end
end

-- 开战信号 + 时间线
local function combatfx_stage()
	-- roundState: 0=pre-intro / 1=回合画面已立起 / 2=战斗中 / 3=回合结束 / 4=结算
	local rs = roundState()
	local is = introState()
	local st = 0
	pcall(function() st = stageTime() end)
	local ch = 0
	for pn = 1, 4 do
		if player(pn) then
			ch = ch + 1
		end
	end
	player(1)

	combatfx.tlTick = combatfx.tlTick + 1
	if combatfx.tlTick >= 6 then
		combatfx.tlTick = 0
		print("TF_TL:f=" .. tostring(getFrameCount()) ..
			",rs=" .. tostring(rs) ..
			",is=" .. tostring(is) ..
			",st=" .. tostring(st) ..
			",ch=" .. tostring(ch))
	end

	-- 回合画面立起来 = 可以撤加载遮罩了
	if not combatfx.fight and rs >= 1 then
		combatfx.fight = true
		print('TF_FIGHT:1')
	end
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
	combatfx_stage()
	combatfx_cmd()
end

hook.add('loop', 'combatfx', combatfx_emit)