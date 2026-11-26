package com.viaco.toonfighting.mcp;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 手机上的 /api/conn/* —— APK 内 webview 的故事联动接口。
 *
 * <p><b>为什么需要</b>：APK 里没有 Node 服务端。webview 的故事绑定
 * （选会话 → 拉角色 → 写 tf_fight_bind）走的全是 /api/conn/*，
 * 手机上必须有人应答。这里用 {@link McpConfig} 里的 backendUrl + token
 * 直连后端（不经 PC 的 serve.cjs）。
 *
 * <p>后端契约（与 serve.cjs 的 bf/bfAuth 一致）：
 * <ul>
 *   <li>统一响应 {@code {code, data, message}} → 取 data；无 data 透传</li>
 *   <li>鉴权：{@code Authorization: Bearer <token>}</li>
 *   <li>GET /other/version、POST /game/listSession {limit}、
 *       POST /game/getSessionMeta {sessionId}、POST /game/getWorld {worldId}、
 *       POST /plugin/data {sessionId, pluginId, op, dataKey, value}、
 *       POST /other/login {username, password} → {token}</li>
 * </ul>
 *
 * <p>token 来源：设置页「MCP 服务」里的账号登录（或 MCP set_config 工具）。
 * 与 serve.cjs 的差异：没有 cookie 会话 —— token 存本进程（McpConfig），
 * 手机上页面与原生服务本就同进程。
 */
public class ConnApi {

    private static final String TAG = "ConnApi";

    private static final String PLUGIN_ID = "com.viaco.toon-fighting";

    private final McpConfig config;
    private final McpExecutor executor;
    private final Object tokenLock = new Object();

    // 会话列表 60s 缓存（与 serve.cjs 同口径）
    private volatile String sessionsCache = null;
    private volatile long sessionsCacheAt = 0;
    private static final long SESSIONS_TTL = 60_000;

    public ConnApi(McpConfig config, McpExecutor executor) {
        this.config = config;
        this.executor = executor;
    }

    /** 处理一个 /api/conn 请求；不属于这里的返回 null。 */
    public McpHttpServer.Response handle(McpHttpServer.Request req) {
        String path = req.path;
        if (!path.startsWith("/api/conn/")) return null;
        try {
            if (path.equals("/api/conn/status")) return status();
            if (path.equals("/api/conn/sessions")) return sessions();
            String m;
            if ((m = match(path, "/api/conn/sessions/", "/roles")) != null) return roles(m);
            if ((m = match(path, "/api/conn/sessions/", "/messages")) != null) return notSupported("messages");
            if (path.startsWith("/api/conn/session-data/")) return sessionData(req);
            if (path.equals("/api/conn/login")) return login(req);
            if (path.equals("/api/conn/register")) return login(req);
            if (path.startsWith("/api/conn/agent/")) return notSupported("agent");
            if (path.equals("/api/conn/story")) {
                JSONObject o = new JSONObject();
                o.put("ok", false);
                o.put("error", "手机版没有 --story 预设；资产集与故事由 MCP / 主界面选择");
                return McpHttpServer.Response.json(o.toString());
            }
            return null;
        } catch (Exception e) {
            Log.e(TAG, "conn API 失败 " + path, e);
            return err(e);
        }
    }

    private static String match(String path, String prefix, String suffix) {
        if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
        String mid = path.substring(prefix.length(), path.length() - suffix.length());
        if (mid.isEmpty() || mid.contains("/")) return null;
        return McpHttpServer.urlDecode(mid);
    }

    // ------------------------------------------------------------ status

    private McpHttpServer.Response status() throws Exception {
        String version = "";
        try {
            JSONObject v = bf("/other/version", null, false, "GET");
            version = v == null ? "" : v.optString("version", "");
        } catch (Exception ignored) { /* 后端未起 */ }
        boolean connected = false;
        int sessions = 0;
        if (!version.isEmpty()) {
            try {
                JSONObject s = bf("/game/listSession", new JSONObject("{\"limit\":100}"), true, "POST");
                if (s != null) {
                    JSONArray arr = s.optJSONArray("list");
                    if (arr != null) sessions = arr.length();
                    else if (s.has("total")) sessions = s.optInt("total", 0);
                    else sessions = 0;
                }
                connected = true;
            } catch (Exception e) {
                Log.w(TAG, "listSession 探测失败：" + e.getMessage());
            }
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("connected", connected);
        o.put("backendVersion", version);
        o.put("sessions", sessions);
        // 带回实际使用的后端地址：前端把它显示在报错里，避免「输入框是 A、
        // 实际连的是 B」时无从排查（2026-11-27 实踩）
        String u = config.getBackendUrl();
        o.put("backendUrl", u == null ? JSONObject.NULL : u);
        String name = tokenUserName();
        o.put("user", name == null ? JSONObject.NULL : new JSONObject().put("name", name));
        o.put("viaSession", false);
        return McpHttpServer.Response.json(o.toString());
    }

    // ------------------------------------------------------------ sessions

    private McpHttpServer.Response sessions() throws Exception {
        long now = System.currentTimeMillis();
        if (sessionsCache != null && now - sessionsCacheAt < SESSIONS_TTL) {
            return McpHttpServer.Response.json(sessionsCache);
        }
        JSONObject s = bf("/game/listSession", new JSONObject("{\"limit\":100}"), true, "POST");
        JSONArray list = s == null ? new JSONArray() : s.optJSONArray("list");
        if (list == null && s != null) {
            // 后端可能直接回数组形态 —— bf 解不出数组时兜底空表
            list = new JSONArray();
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("sessions", list);
        sessionsCache = o.toString();
        sessionsCacheAt = now;
        return McpHttpServer.Response.json(sessionsCache);
    }

    /** 会话列表（带 60s 缓存；bind_story_session 校验会话存在 + 取故事名用）。 */
    public org.json.JSONArray sessionList() throws Exception {
        if (sessionsCache == null || System.currentTimeMillis() - sessionsCacheAt >= SESSIONS_TTL) {
            sessions();
        }
        JSONObject o = new JSONObject(sessionsCache == null ? "{}" : sessionsCache);
        org.json.JSONArray a = o.optJSONArray("sessions");
        return a == null ? new org.json.JSONArray() : a;
    }

    /** 会话元数据（getSessionMeta）—— bind 取 worldId 用。bf 失败抛异常，调用方自己兜。 */
    public JSONObject sessionMeta(String sid) throws Exception {
        return bf("/game/getSessionMeta", new JSONObject().put("sessionId", sid), true, "POST");
    }

    /** 写会话插件数据（op=set）。bf 失败抛异常，调用方自己兜。 */
    public JSONObject putSessionData(String sid, String key, Object value) throws Exception {
        return bf("/plugin/data", new JSONObject()
                .put("sessionId", sid)
                .put("pluginId", PLUGIN_ID)
                .put("op", "set")
                .put("dataKey", key)
                .put("value", value), true, "POST");
    }

    // ------------------------------------------------------------ roles

    private McpHttpServer.Response roles(String sid) throws Exception {
        try {
            JSONObject meta = bf("/game/getSessionMeta", new JSONObject().put("sessionId", sid), true, "POST");
            long worldId = meta == null ? 0 : meta.optLong("worldId", 0);
            String worldName = meta != null && meta.optJSONObject("world") != null
                    ? meta.optJSONObject("world").optString("name", "") : "";
            if (worldId == 0) {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("roles", new JSONArray());
                o.put("worldId", 0);
                o.put("worldName", worldName);
                o.put("note", "这个会话没有关联故事");
                return McpHttpServer.Response.json(o.toString());
            }
            JSONObject world = bf("/game/getWorld", new JSONObject().put("worldId", worldId), true, "POST");
            JSONObject settings = world == null ? new JSONObject() : world.optJSONObject("settings");
            JSONArray roles = settings == null ? new JSONArray() : settings.optJSONArray("roles");
            if (roles == null) roles = new JSONArray();
            // 主角单独存在 world.playerRole，不在 settings.roles —— 与 serve.cjs 同口径合并
            JSONObject playerRole = world == null ? null : world.optJSONObject("playerRole");
            JSONArray merged = new JSONArray();
            int playerIdx = -1;
            if (playerRole != null && !playerRole.optString("name", "").isEmpty()) {
                for (int i = 0; i < roles.length(); i++) {
                    JSONObject r = roles.optJSONObject(i);
                    if (r != null && r.optString("name", "").equals(playerRole.optString("name", ""))) {
                        playerIdx = i;
                        break;
                    }
                }
                JSONObject pr = new JSONObject(playerRole.toString());
                if (playerIdx >= 0) {
                    JSONObject base = roles.optJSONObject(playerIdx);
                    JSONObject m2 = new JSONObject(base == null ? "{}" : base.toString());
                    java.util.Iterator<String> it = pr.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        m2.put(k, pr.get(k));
                    }
                    merged.put(m2);
                } else {
                    merged.put(pr);
                }
            }
            for (int i = 0; i < roles.length(); i++) {
                if (i == playerIdx) continue;
                JSONObject r = roles.optJSONObject(i);
                if (r != null) merged.put(r);
            }
            JSONArray out = new JSONArray();
            for (int i = 0; i < merged.length(); i++) {
                JSONObject r = merged.optJSONObject(i);
                if (r != null) out.put(normalizeRole(r));
            }
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("worldId", worldId);
            o.put("worldName", world == null ? worldName : world.optString("name", worldName));
            o.put("intro", world == null ? "" : world.optString("intro", ""));
            o.put("roles", out);
            return McpHttpServer.Response.json(o.toString());
        } catch (Exception e) {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", e.getMessage() == null ? "取角色列表失败" : e.getMessage());
            return McpHttpServer.Response.json(o.toString());
        }
    }

    /** 与 serve.cjs 的 normalizeRole 同口径（裁剪到前端用的字段）。 */
    private static JSONObject normalizeRole(JSONObject r) throws Exception {
        JSONObject card = new JSONObject();
        String cardJson = r.optString("parameterCardJson", "");
        if (cardJson != null && !cardJson.isEmpty()) {
            try {
                Object c = new org.json.JSONTokener(cardJson).nextValue();
                if (c instanceof JSONObject) card = (JSONObject) c;
            } catch (Exception ignored) { /* 卡片 JSON 坏了按空处理 */ }
        }
        String name = r.optString("name", "").trim();
        JSONObject o = new JSONObject();
        o.put("id", r.optString("id", name).trim());
        o.put("name", name);
        String rt = r.optString("roleType", "npc").trim();
        o.put("roleType", rt.isEmpty() ? "npc" : rt);
        o.put("description", cut(r.optString("description", ""), 400));
        String av = firstNonEmpty(r.optString("avatarPath", ""), card.optString("avatarPath", "")).trim();
        o.put("avatarPath", av);
        String ab = firstNonEmpty(r.optString("avatarBgPath", ""), card.optString("avatarBgPath", "")).trim();
        o.put("avatarBgPath", ab);
        String prof = firstNonEmpty(card.optString("profession", ""), r.optString("profession", "")).trim();
        o.put("profession", prof);
        o.put("level", card.optInt("level", r.optInt("level", 0)));
        o.put("hp", card.optInt("hp", r.optInt("hp", 0)));
        JSONArray skills = card.optJSONArray("skills");
        JSONArray sk = new JSONArray();
        if (skills != null) {
            for (int i = 0; i < skills.length() && i < 12; i++) sk.put(skills.get(i));
        }
        o.put("skills", sk);
        o.put("sample", cut(r.optString("sample", ""), 200));
        return o;
    }

    private static String firstNonEmpty(String a, String b) {
        return (a != null && !a.isEmpty()) ? a : (b == null ? "" : b);
    }

    private static String cut(String s, int n) {
        if (s == null) return "";
        return s.length() > n ? s.substring(0, n) : s;
    }

    // ------------------------------------------------------------ session-data

    private McpHttpServer.Response sessionData(McpHttpServer.Request req) throws Exception {
        // /api/conn/session-data/<sid>/<key>
        String rest = req.path.substring("/api/conn/session-data/".length());
        int slash = rest.indexOf('/');
        if (slash < 0) return err(new Exception("缺 key"));
        String sid = McpHttpServer.urlDecode(rest.substring(0, slash));
        String key = McpHttpServer.urlDecode(rest.substring(slash + 1));
        if ("GET".equals(req.method)) {
            JSONObject r = bf("/plugin/data", new JSONObject()
                    .put("sessionId", sid)
                    .put("pluginId", PLUGIN_ID)
                    .put("op", "get")
                    .put("dataKey", key), true, "POST");
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("key", key);
            o.put("value", r == null || !r.has("value") ? JSONObject.NULL : r.get("value"));
            o.put("updatedAt", r == null ? 0 : r.optLong("updatedAt", 0));
            return McpHttpServer.Response.json(o.toString());
        }
        if ("PUT".equals(req.method)) {
            JSONObject body = new JSONObject(req.body == null || req.body.isEmpty() ? "{}" : req.body);
            JSONObject r = bf("/plugin/data", new JSONObject()
                    .put("sessionId", sid)
                    .put("pluginId", PLUGIN_ID)
                    .put("op", "set")
                    .put("dataKey", key)
                    .put("value", body.opt("value")), true, "POST");
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("value", r == null || !r.has("value") ? JSONObject.NULL : r.get("value"));
            return McpHttpServer.Response.json(o.toString());
        }
        return null;
    }

    // ------------------------------------------------------------ login / register

    private McpHttpServer.Response login(McpHttpServer.Request req) throws Exception {
        JSONObject body = new JSONObject(req.body == null || req.body.isEmpty() ? "{}" : req.body);
        String username = body.optString("username", "").trim();
        String password = body.optString("password", "");
        if (username.isEmpty() || password.isEmpty()) {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", "请填写账号与密码");
            return McpHttpServer.Response.json(o.toString());
        }
        JSONObject r = bf("/other/login", new JSONObject()
                .put("username", username)
                .put("password", password), false, "POST");
        String token = r == null ? "" : r.optString("token", "");
        token = token.replaceFirst("(?i)^Bearer\\s+", "");
        if (token.isEmpty()) {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", "后端没有返回 token");
            return McpHttpServer.Response.json(o.toString());
        }
        synchronized (tokenLock) {
            config.setToken(token);
            config.setUser(username);
            config.setPassword(password);
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("user", new JSONObject().put("name", r.optString("name", username)));
        return McpHttpServer.Response.json(o.toString());
    }

    // ------------------------------------------------------------ 后端调用

    /**
     * 调后端（{code,data,message} 解包 + Bearer 鉴权），等价 serve.cjs 的 bf()。
     */
    private JSONObject bf(String pathname, JSONObject body, boolean auth, String method) throws Exception {
        String base = config.getBackendUrl();
        if (base == null || base.trim().isEmpty()) throw new Exception("未配置后端地址（设置 → MCP 服务）");
        String b = base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        HttpURLConnection conn = (HttpURLConnection) new URL(b + pathname).openConnection();
        conn.setRequestMethod(method);
        // 连接超时 5s：必须短于 webview 侧 fetch 的 AbortSignal（原生 15s），
        // 否则 JS 先报笼统的「signal timed out」，Java 侧精确的
        // refused / connect timed out 就传不回界面了
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(20000);
        conn.setRequestProperty("Accept", "application/json");
        if (auth) {
            String token = config.getToken();
            if (token == null || token.isEmpty()) throw new Exception("未登录（设置 → MCP 服务 → 账号登录）");
            conn.setRequestProperty("Authorization", "Bearer " + token);
        }
        if (body != null) {
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            os.close();
        }
        int code = conn.getResponseCode();
        InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = McpExecutor.readAll(in);
        if (code == 401) throw new Exception("登录已过期，请重新登录");
        if (code >= 400) throw new Exception("HTTP " + code + ": " + cut(text, 160));
        JSONObject j;
        try {
            j = new JSONObject(text);
        } catch (Exception e) {
            throw new Exception("后端返回不是 JSON：" + cut(text, 160));
        }
        // {code, data, message} → data；无 data 透传
        if (j.has("data") && !j.isNull("data")) {
            Object d = j.get("data");
            if (d instanceof JSONObject) return (JSONObject) d;
            if (d instanceof JSONArray) {
                // 数组形态包一层，调用方按 optJSONArray("list") 读不到时走空表
                return new JSONObject().put("list", d);
            }
        }
        return j;
    }

    /** 从 token 的 JWT payload 里解出用户名（与 serve.cjs 的 tokenUser 同口径）。 */
    private String tokenUserName() {
        String token = config.getToken();
        if (token == null || token.isEmpty()) return null;
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 2) return null;
            String payload = new String(android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE), StandardCharsets.UTF_8);
            JSONObject p = new JSONObject(payload);
            long id = p.optLong("id", 0);
            if (id <= 0) return null;
            return p.optString("name", "");
        } catch (Exception e) {
            return null;
        }
    }

    private McpHttpServer.Response notSupported(String what) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", "手机版暂不支持 " + what + " 接口");
            return McpHttpServer.Response.json(o.toString());
        } catch (Exception e) {
            return McpHttpServer.Response.notFound();
        }
    }

    private McpHttpServer.Response err(Exception e) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", e.getMessage() == null ? String.valueOf(e) : e.getMessage());
            return McpHttpServer.Response.json(o.toString());
        } catch (Exception ignored) {
            return McpHttpServer.Response.notFound();
        }
    }
}
