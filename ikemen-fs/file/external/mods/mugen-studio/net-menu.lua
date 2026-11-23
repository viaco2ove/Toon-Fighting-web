-- Online menu (Mugen Studio). Delete this file to remove the N menu.
--
-- A screenpack made before online play has no menu entry for it, and an
-- entry added to a title menu drawn as art, or shown one item at a time,
-- cannot be seen. This draws PRESS N FOR ONLINE on the title screen of every
-- screenpack; N opens a NETWORK box in the engine's own font, over the
-- title background, that no screenpack style can hide. Each item runs the
-- engine's own handler for it, the same call the title menu makes, so
-- hosting and joining work exactly as they do from a NETWORK menu. Mods load
-- after main.lua has built its tables, so these are wrappers, not edits.

-- Written by the Studio for this build.
local HINT = 'PRESS N FOR ONLINE'
local TITLE = 'NETWORK'
local LOBBY = 'CONNECTED'
local ITEMS = {
	{ id = 'serverhost', label = 'HOST GAME', lobby = true },
	{ id = 'join', label = 'JOIN GAME' },
	{ id = 'back', label = 'BACK' },
}

if not (main and main.f_createMenu and main.f_menuCommonDraw and main.t_itemname and motif) then
	print('[net-menu] off: this engine has no title menu to add to')
	return
end

-- The menu the engine opens once both players of a lobby are connected
-- (main.menu.submenu.server). It never shows on the title, but without it
-- the first lobby to connect stops with an error. The build adds it to the
-- screenpack's own file; this covers one the build did not reach. main.f_start
-- runs after the mods, and builds it as if the screenpack had declared it.
do
	local g = motif[main.group]
	local m = g and g.menu
	if m and type(m.itemname) == 'table' and main.f_appendItemname then
		local has = false
		for k in pairs(m.itemname) do
			if type(k) == 'string' and k:match('^server_') then
				has = true
				break
			end
		end
		if not has then
			main.f_appendItemname(m, 'server', 'netplayversus', 'VERSUS 2P')
			main.f_appendItemname(m, 'server', 'netplayteamcoop', 'ARCADE CO-OP')
			main.f_appendItemname(m, 'server', 'netplaysurvivalcoop', 'SURVIVAL CO-OP')
			main.f_appendItemname(m, 'server', 'back', 'EXIT')
			print('[net-menu] added the hidden lobby menu')
		end
	end
end

-- Which menu loop is running: each loop pushes its menu table. The hint and
-- N belong to the top-level title menu only (main.menu, also the
-- attract-mode menu after a credit); every submenu, the screenpack's own
-- NETWORK menu and the lobby menu included, is built by the same function.
local stack, busy, disabled = {}, false, false
local stockCreate = main.f_createMenu
main.f_createMenu = function(tbl, ...)
	local loop = stockCreate(tbl, ...)
	if type(loop) ~= 'function' then return loop end
	return function(...)
		stack[#stack + 1] = tbl
		local r = {loop(...)}
		stack[#stack] = nil
		return unpack(r)
	end
end

-- The screen, in the screenpack's own coordinates, read on first use.
local W, H, S, CX
local function geom()
	if W then return end
	local lc = motif.info and motif.info.localcoord
	W = lc and tonumber(lc[1]) or 320
	H = lc and tonumber(lc[2]) or 240
	if W <= 0 or H <= 0 then W, H = 320, 240 end
	S = H / 240
	CX = W / 2
end

-- The engine's plain 6x9 font (all capitals), drawn at its natural size in
-- the screenpack's coordinates, on layer 2: above both background layers.
-- Text and color are pushed only when they change: re-setting the same
-- string every frame makes garbage, a visible hitch on the website.
local font = nil
local function newText(r, g, b)
	geom()
	if font == nil then
		-- the engine's font under a name no screenpack ships (netmenu.js)
		local name = 'f-6x9.def'
		if main.f_fileExists and main.f_fileExists('font/net-menu-6x9.def') then name = 'net-menu-6x9.def' end
		local ok, f = pcall(fontNew, name, -1)
		if not ok or f == nil then error('no font: ' .. tostring(f), 0) end
		font = f
	end
	local t = textImgNew()
	textImgSetFont(t, font)
	textImgSetAlign(t, 0)
	textImgSetColor(t, r, g, b)
	textImgSetLocalcoord(t, W, H)
	textImgSetScale(t, S, S)
	textImgSetWindow(t, 0, 0, W, H)
	textImgSetLayerno(t, 2)
	return {ti = t, r = r, g = g, b = b}
end
local function putText(sp, str, x, y, r, g, b)
	if sp.text ~= str then textImgSetText(sp.ti, str); sp.text = str end
	if sp.x ~= x or sp.y ~= y then textImgSetPos(sp.ti, x, y); sp.x, sp.y = x, y end
	if r and (sp.r ~= r or sp.g ~= g or sp.b ~= b) then
		textImgSetColor(sp.ti, r, g, b)
		sp.r, sp.g, sp.b = r, g, b
	end
	textImgDraw(sp.ti)
end
-- One rect per role, moved only when its place changes. rectDraw copies the
-- rect, so moving it later never changes what was queued.
local function newRect(r, g, b, src, dst)
	geom()
	local o = rectNew()
	rectSetLocalcoord(o, W, H)
	rectSetColor(o, r, g, b)
	rectSetAlpha(o, src, dst)
	rectSetLayerno(o, 2)
	return {o = o}
end
local function putRect(rc, x1, y1, x2, y2)
	if rc.x1 ~= x1 or rc.y1 ~= y1 or rc.x2 ~= x2 or rc.y2 ~= y2 then
		rectSetWindow(rc.o, x1, y1, x2, y2)
		rectUpdate(rc.o)
		rc.x1, rc.y1, rc.x2, rc.y2 = x1, y1, x2, y2
	end
	rectDraw(rc.o)
end

local function snd(v)
	if type(v) == 'table' and v[1] ~= nil and motif.Snd ~= nil then sndPlay(motif.Snd, v[1], v[2] or 0) end
end
local function moveSnd(sec) snd(sec.cursor and sec.cursor.move and sec.cursor.move.snd) end
local function cancelSnd(sec) snd(sec.cancel and sec.cancel.snd) end

-- The area the title menu draws in, estimated from its own layout: every
-- line it can show (all of them, cut to its window, when it has margins),
-- each label as wide as the longest at 8 units a letter (of 240) and 14
-- units above its line to 4 below, and its box cursor. Nil when the layout
-- cannot be read.
local function num(v, d)
	v = tonumber(v)
	if v == nil then return d end
	return v
end
local function at(tbl, k)
	if type(tbl) == 'table' then return tbl[k] end
	return nil
end
local function menuArea(sec, t)
	local m = at(sec, 'menu')
	if type(m) ~= 'table' or type(m.pos) ~= 'table' or type(t) ~= 'table' or #t == 0 then return nil end
	local it = m.item
	local px, py = num(m.pos[1], 0), num(m.pos[2], 0)
	local ox, oy = num(at(at(it, 'offset'), 1), 0), num(at(at(it, 'offset'), 2), 0)
	local sx, sy = num(at(at(it, 'spacing'), 1), 0), num(at(at(it, 'spacing'), 2), 0)
	local zx, zy = num(at(at(it, 'scale'), 1), 1), num(at(at(it, 'scale'), 2), 1)
	local n = #t
	local vis = num(at(at(m, 'window'), 'visibleitems'), 0)
	if vis <= 0 then vis = n end
	local slots = math.min(n, vis)
	local margins = at(at(m, 'window'), 'margins')
	local m1, m2 = num(at(at(margins, 'y'), 1), 0), num(at(at(margins, 'y'), 2), 0)
	local clip = m1 ~= 0 or m2 ~= 0
	-- no font (-1) for the items or the active one: the items are art, drawn
	-- by their own backgrounds
	local font = at(it, 'font')
	if num(at(font, 1), -1) < 0 then font = at(at(it, 'active'), 'font') end
	local longest = 0
	if num(at(font, 1), -1) >= 0 then
		for i = 1, n do
			local s = at(t[i], 'displayname')
			if type(s) == 'string' and #s > longest then longest = #s end
		end
	end
	local w = 8 * S * zx * longest
	local align = num(at(font, 3), 0)
	-- a line keeps its x spacing as the menu scrolls; y stays in the slots
	local x1, x2 = math.huge, -math.huge
	for i = 1, n do
		local x = px + ox + (i - 1) * sx
		local a, b = x - w / 2, x + w / 2
		if align > 0 then
			a, b = x, x + w
		elseif align < 0 then
			a, b = x - w, x
		end
		x1, x2 = math.min(x1, a), math.max(x2, b)
	end
	local last = slots
	if clip then last = n end
	local ya, yb = py + oy, py + oy + (last - 1) * sy
	local y1, y2 = math.min(ya, yb) - 14 * S * zy, math.max(ya, yb) + 4 * S * zy
	if clip then
		y1 = math.max(y1, py - m1)
		y2 = math.min(y2, py + (vis - 1) * sy + m2)
	end
	local bc = at(m, 'boxcursor')
	if at(bc, 'visible') and type(bc.coords) == 'table' then
		local c1, c2, c3, c4 = num(bc.coords[1], 0), num(bc.coords[2], 0), num(bc.coords[3], 0), num(bc.coords[4], 0)
		local dx, dy = (slots - 1) * sx, (slots - 1) * sy
		x1 = math.min(x1, px + c1, px + c1 + dx)
		x2 = math.max(x2, px + c3, px + c3 + dx)
		y1 = math.min(y1, py + c2, py + c2 + dy)
		y2 = math.max(y2, py + c4, py + c4 + dy)
	end
	if x1 > x2 or y1 > y2 then return nil end
	return x1, y1, x2, y2
end

-- THE HINT: a dark pill 15-27 units above the bottom (of 240), clear of a
-- screenpack footer strip. A title menu that reaches down there (MUGEN's
-- own layout ends inside it, and many packs copy that) moves it to 15-27
-- units below the top, unless the menu reaches up there too. Placed again
-- only when the number of title items changes.
local hint = nil
local function drawHint(sec, t)
	if HINT == '' then return end
	if hint == nil then
		geom()
		local half = (3 * #HINT + 6) * S
		hint = {pill = newRect(0, 0, 0, 0, 64), t = newText(255, 255, 255), x1 = CX - half, x2 = CX + half}
	end
	local n = type(t) == 'table' and #t or 0
	if hint.n ~= n then
		hint.n = n
		local top = false
		local a1, b1, a2, b2 = menuArea(sec, t)
		if a1 ~= nil then
			local function clear(y1, y2)
				return a2 <= hint.x1 or a1 >= hint.x2 or b2 <= y1 - 2 * S or b1 >= y2 + 2 * S
			end
			top = not clear(H - 27 * S, H - 15 * S) and clear(15 * S, 27 * S)
		end
		if top then
			hint.y1, hint.y2 = 15 * S, 27 * S
		else
			hint.y1, hint.y2 = H - 27 * S, H - 15 * S
		end
		if top and not hint.top then print('[net-menu] hint at the top: the title menu reaches the bottom') end
		hint.top = top
	end
	putRect(hint.pill, hint.x1, hint.y1, hint.x2, hint.y2)
	putText(hint.t, HINT, CX, hint.y2 - 3 * S)
end

-- THE BOX: the title background without the screenpack's menu, dimmed, and
-- a framed list. Rows 12 units tall under an 18-unit title band.
local box = nil
local function drawBox(title, rows, sel, footer)
	geom()
	if box == nil then
		box = {
			dim = newRect(0, 0, 0, 0, 128),
			edge = newRect(150, 160, 190, 255, 0),
			fill = newRect(16, 20, 36, 255, 0),
			bar = newRect(52, 72, 150, 255, 0),
			title = newText(150, 190, 255),
			foot = newText(230, 230, 230),
			rows = {},
		}
	end
	local bg = motif[main.background]
	if bg then
		if bg.bgclearcolor then clearColor(bg.bgclearcolor[1], bg.bgclearcolor[2], bg.bgclearcolor[3]) end
		if bg.BGDef then
			bgDraw(bg.BGDef, 0)
			bgDraw(bg.BGDef, 1)
		end
	end
	local longest = #title
	for i = 1, #rows do
		if #rows[i].label > longest then longest = #rows[i].label end
	end
	local w = math.max(120, 6 * longest + 28)
	local h = 18 + 12 * #rows + 8
	local x1, y1 = CX - w / 2 * S, H / 2 - h / 2 * S
	local x2, y2 = x1 + w * S, y1 + h * S
	putRect(box.dim, -W, 0, 2 * W, H)
	putRect(box.edge, x1 - S, y1 - S, x2 + S, y2 + S)
	putRect(box.fill, x1, y1, x2, y2)
	local ry = y1 + (18 + 12 * (sel - 1)) * S
	putRect(box.bar, x1 + 4 * S, ry, x2 - 4 * S, ry + 12 * S)
	putText(box.title, title, CX, y1 + 12 * S)
	for i = 1, #rows do
		local sp = box.rows[i]
		if sp == nil then
			sp = newText(230, 230, 230)
			box.rows[i] = sp
		end
		local y = y1 + (18 + 12 * (i - 1) + 9) * S
		if i == sel then
			putText(sp, rows[i].label, CX, y, 255, 224, 64)
		else
			putText(sp, rows[i].label, CX, y, 230, 230, 230)
		end
	end
	if footer then putText(box.foot, footer, CX, y2 + 12 * S) end
end

-- THE LOBBY BOX. A screenpack with a NETWORK menu of its own (a HOST or JOIN
-- item anywhere in its title menu) was made for online play and draws the
-- lobby menu itself. Any other draws it in its title menu's style, which a
-- menu drawn as art cannot show, so there the menu is drawn as a box. Read
-- from the items the title really has (itemname_order: a group the pack
-- hides by blanking its name leaves its children out of it), once: the
-- screenpack does not change while the game runs.
local ownNetwork = nil
local function hasOwnNetwork()
	if ownNetwork == nil then
		ownNetwork = false
		local m = motif[main.group] and motif[main.group].menu
		if m and type(m.itemname) == 'table' and type(m.itemname_order) == 'table' then
			for _, k in ipairs(m.itemname_order) do
				local v = m.itemname[k]
				if type(k) == 'string' and v ~= nil and v ~= '' and (k:match('^menunetwork') or k:match('serverhost$') or k:match('serverjoin$')) then
					ownNetwork = true
					break
				end
			end
		end
		if not ownNetwork then print('[net-menu] the lobby menu is drawn as a box: the screenpack has no NETWORK menu') end
	end
	return ownNetwork
end
local function inLobby()
	local sub = main.menu and main.menu.submenu
	return sub ~= nil and sub.server ~= nil and stack[#stack] == sub.server
end
-- The rows are the engine's own list, as its menu loop filtered it, and the
-- highlight is its cursor; the box only shows them.
local function lobbyRows(t, item)
	local rows, sel = {}, 1
	if type(t) ~= 'table' then return rows, sel end
	for i, v in ipairs(t) do
		if type(v) == 'table' and type(v.itemname) == 'string' and not v.itemname:match('^spacer%d*$') then
			rows[#rows + 1] = {id = v.itemname, label = string.upper(tostring(v.displayname or v.itemname))}
			if i == item then sel = #rows end
		end
	end
	return rows, sel
end

-- Draw and read input until a pick or a close. The screenpack's own menu
-- keys move and pick; Esc, the menu cancel key or N close.
local function keysOf(v, dflt)
	if type(v) == 'table' and v.key ~= nil then return v.key end
	return dflt
end
local function menuLoop(title, rows, sel, footer, delKey)
	local sec = motif[main.group]
	local m = sec.menu or {}
	local kPrev = keysOf(m.previous, {'U', 'L'})
	local kNext = keysOf(m.next, {'D', 'R'})
	local kDone = keysOf(m.done, {'a', 'b', 'c', 'x', 'y', 'z', 's'})
	local kCancel = keysOf(m.cancel, {'m'})
	while true do
		drawBox(title, rows, sel, footer)
		if main.f_preloadTick then main.f_preloadTick(2) end
		refresh()
		if esc() or getInput(-1, kCancel) or getKey('n') then
			return 'close', sel
		elseif getInput(-1, kNext) then
			sel = sel % #rows + 1
			moveSnd(sec)
		elseif getInput(-1, kPrev) then
			sel = (sel - 2) % #rows + 1
			moveSnd(sec)
		elseif getInput(-1, kDone) then
			return 'pick', sel
		elseif delKey and getKey(delKey) and rows[sel].id:match('^ip_') then
			return 'delete', sel
		end
	end
end
-- A fault in drawing or input turns the add-on off and hands the title back.
local function guarded(title, rows, sel, footer, delKey)
	local ok, what, at = pcall(menuLoop, title, rows, sel, footer, delKey)
	if ok then return what, at end
	disabled = true
	print('[net-menu] off: ' .. tostring(what))
	return 'fail', sel
end

-- After any handler or close: a handler can come back with esc set (a
-- canceled connection, a canceled text input), and the title menu quits
-- the game on esc. The guard keeps the button that closed the box from also
-- picking a title item on the next frame.
local function settle()
	esc(false)
	resetKey()
	resetTokenGuard()
end

local function has(id) return type(main.t_itemname[id]) == 'function' end
local function webJoin() return main.webBuild and has('webjoin') end
local function visibleRows()
	local rows = {}
	for _, it in ipairs(ITEMS) do
		local show
		if it.id == 'back' then
			show = true
		elseif it.id == 'join' then
			show = webJoin() or (has('serverconnect') and has('joinadd'))
		else
			show = has(it.id)
		end
		if show then rows[#rows + 1] = it end
	end
	return rows
end

-- Run an item the way the title menu does: a real list (handlers pass it to
-- their hooks, and the address join reads its name from it), the defaults
-- reset first, and no protection, so a netplay error is reported as always.
-- A lobby needs the post-connect menu, and no lobby or queue match opens
-- during netplay.
local function runItem(id, lobby, list, i, what, queue)
	local sec = motif[main.group]
	local sub = main.menu and main.menu.submenu
	if (lobby or queue) and netPlay() then
		print('[net-menu] skipped ' .. id .. ': already online')
		cancelSnd(sec)
		return
	end
	if lobby and not (sub and sub.server and sub.server.loop) then
		print('[net-menu] skipped ' .. id .. ': no lobby menu')
		cancelSnd(sec)
		return
	end
	print('[net-menu] run ' .. (what or id))
	main.f_default()
	local f = main.t_itemname[id](list, i)
	if type(f) == 'function' then
		f()
		main.f_default()
	end
end

-- JOIN GAME where the engine has no web join (the desktop engine): the saved
-- addresses, NEW ADDRESS and BACK, like the stock join menu. DELETE removes
-- the highlighted address. Returns 'fail' when the add-on turned itself off.
local function joinMenu()
	local sec = motif[main.group]
	local names = {}
	local ok, ips = pcall(gameOption, 'Netplay.IP')
	if ok and type(ips) == 'table' then
		for k in pairs(ips) do names[#names + 1] = tostring(k) end
	end
	table.sort(names)
	local list = {}
	for _, k in ipairs(names) do list[#list + 1] = {itemname = 'ip_' .. k, displayname = k} end
	list[#list + 1] = {itemname = 'joinadd', displayname = 'NEW ADDRESS'}
	list[#list + 1] = {itemname = 'back', displayname = 'BACK'}
	local delKey = sec.menu and sec.menu.item and sec.menu.item.delete and sec.menu.item.delete.keycode
	if type(delKey) ~= 'string' or delKey == '' then delKey = 'DELETE' end
	snd(sec.cursor and sec.cursor.done and sec.cursor.done.snd and sec.cursor.done.snd.default)
	local sel = 1
	while true do
		local rows, any = {}, false
		for i, v in ipairs(list) do
			rows[i] = {id = v.itemname, label = string.upper(tostring(v.displayname))}
			if v.itemname:match('^ip_') then any = true end
		end
		if sel > #rows then sel = #rows end
		local what, at = guarded('JOIN GAME', rows, sel, any and 'DELETE: REMOVE ADDRESS' or nil, delKey)
		if what == 'fail' then return 'fail' end
		sel = at
		local id = rows[at].id
		if what == 'delete' then
			list = main.f_deleteIP(at, list) or list
			settle()
		elseif what ~= 'pick' or id == 'back' then
			cancelSnd(sec)
			return
		elseif id == 'joinadd' then
			print('[net-menu] run joinadd')
			list = main.t_itemname.joinadd(list, at) or list
			settle()
		else
			runItem('serverconnect', true, list, at, 'serverconnect ' .. id)
			settle()
		end
	end
end

-- The NETWORK box. After an item it stays open on the same row, as the stock
-- NETWORK menu does after a lobby. Returns true when a handler ran.
local function openMenu()
	local sec = motif[main.group]
	local rows = visibleRows()
	local labels = {}
	for i, it in ipairs(rows) do labels[i] = it.label end
	print('[net-menu] open: ' .. table.concat(labels, ', '))
	moveSnd(sec)
	resetTokenGuard()
	local sel, ran = 1, false
	while true do
		local what, at = guarded(TITLE, rows, sel)
		if what == 'fail' then return ran end
		local it = rows[at]
		if what ~= 'pick' or it.id == 'back' then
			cancelSnd(sec)
			print('[net-menu] closed')
			return ran
		end
		ran = true
		local list = {{itemname = it.id, displayname = it.label}, {itemname = 'back', displayname = 'BACK'}}
		if it.id ~= 'join' then
			runItem(it.id, it.lobby, list, 1, nil, it.queue)
		elseif webJoin() then
			list[1].itemname = 'webjoin'
			runItem('webjoin', true, list, 1)
		elseif joinMenu() == 'fail' then
			return ran
		end
		settle()
		rows = visibleRows()
		sel = #rows
		for i, r in ipairs(rows) do
			if r.id == it.id then sel = i end
		end
	end
end

-- Opening the box counts as using the title menu: its demo countdown starts
-- over, as after a cursor move. The count is a main.lua local; f_demo zeroes
-- it when it finds demo mode off, so its first call after the box closes
-- finds it off.
local restartDemo = false
local stockDemo = main.f_demo
if type(stockDemo) == 'function' then
	main.f_demo = function(...)
		local d = motif.demo_mode
		if restartDemo and type(d) == 'table' and d.enabled then
			restartDemo = false
			d.enabled = false
			stockDemo(...)
			d.enabled = true
			return
		end
		restartDemo = false
		return stockDemo(...)
	end
end

-- THE TITLE HOOK. Only the title menu loop draws with its own section
-- (motif[main.group]) and a full frame (not skipClear); the stack narrows it
-- to the top-level title. It runs before the stock draw, so the box opens
-- between two title frames and the title draws again the moment it closes.
-- In the lobby menu on a screenpack with no NETWORK menu, the frame is the
-- lobby box instead of the stock draw, with the stock draw's preload tick and
-- its refresh, so the engine's loop runs exactly as it would. A fault drawing
-- it turns the add-on off and that frame is the stock one.
local stockDraw = main.f_menuCommonDraw
main.f_menuCommonDraw = function(t, item, cy, mt, sec, bg, skipClear, opts)
	if not disabled and not skipClear and sec ~= nil and sec == motif[main.group] and inLobby() and not hasOwnNetwork() then
		local rows, sel = lobbyRows(t, item)
		if #rows > 0 then
			local ok, err = pcall(drawBox, LOBBY, rows, sel)
			if ok then
				if main.f_preloadTick then main.f_preloadTick(2) end
				refresh()
				return
			end
			disabled = true
			print('[net-menu] off: ' .. tostring(err))
		end
	end
	if not busy and not disabled and not skipClear and sec ~= nil and sec == motif[main.group]
		and stack[#stack] == main.menu and not netPlay() then
		if getKey('n') and not fadeActive() and main.menu.f == nil then
			resetKey()
			busy = true
			local ran = openMenu()
			busy = false
			restartDemo = true
			settle()
			if ran then
				-- a lobby moved the shared menu cursor; snap it back, as the
				-- stock menu does when a submenu returns
				if main.f_menuSnap then main.f_menuSnap(sec) end
				if main.f_menuItemBgAnimReset then main.f_menuItemBgAnimReset(sec) end
			end
		end
		if not disabled then
			local ok, err = pcall(drawHint, sec, t)
			if not ok then
				disabled = true
				print('[net-menu] off: ' .. tostring(err))
			end
		end
	end
	return stockDraw(t, item, cy, mt, sec, bg, skipClear, opts)
end

print('[net-menu] ready (online items: no)')
