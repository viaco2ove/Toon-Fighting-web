-- 实体头顶悬浮头像：坐标输出（引擎侧）
--
-- 通过引擎配置 [Common] Lua = <本段> 每帧执行一次，读取 P1/P2 的最终渲染屏幕坐标，
-- 用 print 吐给前端（vfs.js 的 stdout → console.log → index.html 拦截）。
-- 前端据此把头像 DOM 定位到实体头顶（见 index.html 的 headAvatar 相关代码）。
--
-- 为什么不直接在引擎里画头像：
--   引擎的动画绘制 API 只能画精灵文件（sff）里的内容，而 toonflow 角色头像是
--   png/webp（OSS 上的图片），塞不进 sff。所以走「引擎给坐标 → 前端摆 DOM」这条路，
--   与 toonflow-field-survival 的「实体头顶挂头像」是同一种低成本做法。
--
-- 坐标口径：screenPosX()/screenPosY() 是引擎自己的最终渲染屏幕坐标
--   screenPosX = pos[0]*localscl - cam.ScreenPos[0]
--   screenPosY = pos[1]*localscl - cam.ScreenPos[1]
-- 已经含角色局部坐标缩放与相机偏移，前端按画布缩放换算即可。
--
-- 降频：每帧 print 会拖慢引擎（stdout 是一次跨进程往返），所以攒 4 帧输出一次，
-- 并且坐标没变就不输出（角色站着不动时完全静默）。

local tf_head = {
    tick = 0,
    last = {},
    enabled = true,
}

-- 取某个玩家的屏幕坐标。player(p) 会把引擎的 debugWC 切到该玩家。
local function tf_pos(pn)
    if not player(pn) then return nil end
    local x = screenPosX()
    local y = screenPosY()
    -- 回到玩家 1，免得影响别的脚本的上下文
    player(1)
    return x, y
end

local function tf_head_emit()
    if not tf_head.enabled then return end
    tf_head.tick = tf_head.tick + 1
    if tf_head.tick < 4 then return end
    tf_head.tick = 0

    local parts = {}
    for pn = 1, 2 do
        local x, y = tf_pos(pn)
        if x ~= nil then
            local key = pn
            local prev = tf_head.last[key]
            local sx = string.format("%.1f", x)
            local sy = string.format("%.1f", y)
            -- 坐标没变就不重复输出（角色站着不动时完全静默）
            if prev == nil or prev ~= sx .. "," .. sy then
                tf_head.last[key] = sx .. "," .. sy
                parts[#parts + 1] = pn .. ":" .. sx .. "," .. sy
            end
        end
    end
    if #parts > 0 then
        print("TF_HEAD:" .. table.concat(parts, "|"))
    end
end

tf_head_emit()
