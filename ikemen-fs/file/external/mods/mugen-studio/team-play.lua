-- Team play (Mugen Studio). Delete this file to go back to stock.
--
-- * The CPU team in Arcade starts at the size of your own team, instead of
--   the mode's minimum.
-- * A screenpack that draws every team mode on the same spot also draws
--   every mode's size icons on the same spot, so the icons on screen belong
--   to whichever mode the engine drew last. While the menu is drawn, every
--   mode shows the HIGHLIGHTED mode's size; the real sizes are put back
--   straight after, so each mode still keeps its own.
-- Mods load after main.lua has built its tables, so these are wrappers, not
-- edits: the stock functions still run first.

local function fit(v, bounds)
	if not bounds then return v end
	return math.max(bounds[1], math.min(bounds[2], v))
end

if start and start.f_teamMenu then
	local followed = setmetatable({}, {__mode = 'k'})
	local sizeKey = {simul = 'numSimul', turns = 'numTurns', tag = 'numTag'}
	local stockTeamMenu = start.f_teamMenu
	start.f_teamMenu = function(side, t)
		local p = start.p[side]
		if side == 2 and main.cpuSide[2] and not main.cpuSide[1] and start.p[1].teamEnd and not p.teamEnd
			and p.t_selected and not followed[p.t_selected] then
			followed[p.t_selected] = true
			local n = start.p[1].numChars or 1
			if n >= 2 then
				p.numSimul = fit(n, main.numSimul)
				p.numTag = fit(n, main.numTag)
				p.numTurns = fit(n, main.numTurns)
				print('[team-play] CPU team starts at ' .. n)
			end
		end
		-- the icons: only for a menu whose items all sit on the same spot
		local spacing = motif.select_info['p' .. side].teammenu.item.spacing
		local active = t and t[p.teamMenu or 1]
		local key = active and sizeKey[active.itemname]
		local shown = nil
		if active and spacing and spacing[1] == 0 and spacing[2] == 0 then
			if active.itemname == 'single' then shown = 1 elseif key then shown = p[key] end
		end
		local saved = nil
		if shown then
			saved = {}
			for _, k in pairs(sizeKey) do
				if k ~= key then saved[k] = p[k]; p[k] = shown end
			end
		end
		-- the real sizes go back even if the stock menu raises an error
		local ok, r = pcall(stockTeamMenu, side, t)
		if saved then
			for k, v in pairs(saved) do p[k] = v end
		end
		if not ok then error(r, 0) end
		return r
	end
end
