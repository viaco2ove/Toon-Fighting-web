package com.viaco.toonfighting.mcp;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * MCP 工具执行器 —— 把 {@link McpTools} 里定义的工具真正跑起来。
 *
 * <p>三类工具，三条不同的执行路径：
 * <ul>
 *   <li><b>资产集 / 故事</b>：调 webview 里的 {@code window.__tfMcp.*}（绑定动作
 *       必须发生在游戏运行时 —— 要挂载资产集、换角色名单、写会话绑定）</li>
 *   <li><b>配置</b>：直接读写 {@link McpConfig}</li>
 *   <li><b>后端登录</b>：走 HTTP 到后端服务（URL 取自配置）</li>
 * </ul>
 */
public class McpExecutor {

    private static final String TAG = "McpExec";

    private final McpPlugin plugin;
    private final McpConfig config;
    private final PackStore packStore;

    public McpExecutor(McpPlugin plugin, McpConfig config, PackStore packStore) {
        this.plugin = plugin;
        this.config = config;
        this.packStore = packStore;
    }

    /**
     * 执行一个工具。
     *
     * @return MCP 的 tool result（content 数组 + isError）
     */
    public JSONObject call(String name, JSONObject args) {
        try {
            if (name == null) {
                return McpJson.toolResult("缺少工具名", true);
            }
            if ("list_asset_packs".equals(name)) return doListPacks();
            if ("get_asset_pack".equals(name)) return doGetPack(args);
            if ("select_asset_pack".equals(name)) return doSelectPack(args);
            if ("get_current_asset_pack".equals(name)) return doCurrentPack();
            if ("list_installed_packs".equals(name)) return doListInstalled();
            if ("install_asset_pack".equals(name)) return doInstallPack(args);
            if ("uninstall_asset_pack".equals(name)) return doUninstallPack(args);
            if ("list_story_sessions".equals(name)) return doListSessions();
            if ("get_story_session".equals(name)) return doGetSession(args);
            if ("bind_story_session".equals(name)) return doBindSession(args);
            if ("get_current_story".equals(name)) return doCurrentStory();
            if ("get_config".equals(name)) return doGetConfig();
            if ("set_config".equals(name)) return doSetConfig(args);
            return McpJson.toolResult("未知工具：" + name, true);
        } catch (Exception e) {
            Log.e(TAG, "执行工具失败 " + name, e);
            return McpJson.toolResult("执行失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()), true);
        }
    }

    // ------------------------------------------------------------ 资产集

    private JSONObject doListPacks() throws Exception {
        Object r = callGame("listPacks", null);
        JSONArray arr = toArray(r);
        JSONObject out = new JSONObject();
        out.put("packs", arr == null ? new JSONArray() : arr);
        return McpJson.toolResult(out.toString(), false);
    }

    private JSONObject doGetPack(JSONObject args) throws Exception {
        String packId = McpJson.str(args, "packId", "");
        if (packId.isEmpty()) return McpJson.toolResult("缺少参数 packId", true);
        Object r = callGame("getPack", "[" + jsStr(packId) + "]");
        if (r == null) return McpJson.toolResult("没有这个资产集：" + packId, true);
        return McpJson.toolResult(String.valueOf(r), false);
    }

    private JSONObject doSelectPack(JSONObject args) throws Exception {
        String packId = McpJson.str(args, "packId", "");
        if (packId.isEmpty()) return McpJson.toolResult("缺少参数 packId", true);
        Object r = callGame("selectPack", "[" + jsStr(packId) + "]");
        JSONObject o = asObject(r);
        if (o == null) return McpJson.toolResult("切换失败：游戏未响应", true);
        if (!o.optBoolean("ok", false)) {
            return McpJson.toolResult("切换失败：" + o.optString("error", "未知原因"), true);
        }
        config.setBoundPackId(o.optString("id", ""));
        return McpJson.toolResult(o.toString(), false);
    }

    private JSONObject doCurrentPack() throws Exception {
        Object r = callGame("currentPack", null);
        return McpJson.toolResult(r == null ? "{}" : String.valueOf(r), false);
    }

    // ------------------------------------------------------------ 资产集安装（设备本地）

    private JSONObject doListInstalled() {
        JSONObject o = new JSONObject();
        try {
            o.put("packs", packStore.listPacks());
            o.put("root", packStore.getRootPath());
        } catch (Exception e) {
            // 忽略
        }
        return McpJson.toolResult(o.toString(), false);
    }

    private JSONObject doInstallPack(JSONObject args) {
        String src = McpJson.str(args, "source", "");
        String packId = McpJson.str(args, "packId", "");
        if (src.isEmpty()) return McpJson.toolResult("缺少参数 source", true);
        java.io.File f = new java.io.File(src);
        if (!f.exists()) return McpJson.toolResult("路径不存在：" + src, true);
        JSONObject r = packStore.install(f, packId);
        boolean ok = r.optBoolean("ok", false);
        return McpJson.toolResult(r.toString(), !ok);
    }

    private JSONObject doUninstallPack(JSONObject args) {
        String packId = McpJson.str(args, "packId", "");
        if (packId.isEmpty()) return McpJson.toolResult("缺少参数 packId", true);
        JSONObject r = packStore.uninstall(packId);
        boolean ok = r.optBoolean("ok", false);
        return McpJson.toolResult(r.toString(), !ok);
    }

    // ------------------------------------------------------------ 故事绑定

    private JSONObject doListSessions() throws Exception {
        Object r = callGame("listSessions", null);
        JSONArray arr = toArray(r);
        JSONObject out = new JSONObject();
        out.put("sessions", arr == null ? new JSONArray() : arr);
        return McpJson.toolResult(out.toString(), false);
    }

    private JSONObject doGetSession(JSONObject args) throws Exception {
        String sid = McpJson.str(args, "sessionId", "");
        if (sid.isEmpty()) return McpJson.toolResult("缺少参数 sessionId", true);
        Object r = callGame("getSession", "[" + jsStr(sid) + "]");
        if (r == null) return McpJson.toolResult("没有这个会话：" + sid, true);
        return McpJson.toolResult(String.valueOf(r), false);
    }

    private JSONObject doBindSession(JSONObject args) throws Exception {
        String sid = McpJson.str(args, "sessionId", "");
        if (sid.isEmpty()) return McpJson.toolResult("缺少参数 sessionId", true);
        String packId = McpJson.str(args, "packId", "");
        Object r = callGame("bindSession", "[" + jsStr(sid) + "," + jsStr(packId) + "]");
        JSONObject o = asObject(r);
        if (o == null) return McpJson.toolResult("绑定失败：游戏未响应", true);
        if (!o.optBoolean("ok", false)) {
            return McpJson.toolResult("绑定失败：" + o.optString("error", "未知原因"), true);
        }
        config.setBoundSessionId(o.optString("sessionId", sid));
        config.setBoundPackId(o.optString("packId", ""));
        return McpJson.toolResult(o.toString(), false);
    }

    private JSONObject doCurrentStory() throws Exception {
        Object r = callGame("currentStory", null);
        return McpJson.toolResult(r == null ? "{}" : String.valueOf(r), false);
    }

    // ------------------------------------------------------------ 配置

    private JSONObject doGetConfig() {
        JSONObject o = config.toPublicJson();
        return McpJson.toolResult(o.toString(), false);
    }

    private JSONObject doSetConfig(JSONObject args) throws Exception {
        JSONObject applied = new JSONObject();
        boolean restartNeeded = false;

        if (args != null && args.has("enabled") && !args.isNull("enabled")) {
            boolean en = McpJson.bool(args, "enabled", true);
            config.setEnabled(en);
            applied.put("enabled", en);
            restartNeeded = true;
        }
        if (args != null && args.has("port") && !args.isNull("port")) {
            int p = McpJson.integer(args, "port", McpConfig.DEFAULT_PORT);
            if (p < 1 || p > 65535) return McpJson.toolResult("端口必须在 1~65535 之间", true);
            if (p != config.getPort()) {
                config.setPort(p);
                restartNeeded = true;
            }
            applied.put("port", p);
        }
        if (args != null && args.has("backendUrl") && !args.isNull("backendUrl")) {
            String u = McpJson.str(args, "backendUrl", "");
            config.setBackendUrl(u);
            applied.put("backendUrl", u);
        }
        // 账号登录
        if (args != null && args.has("login") && !args.isNull("login")) {
            JSONObject login = args.optJSONObject("login");
            if (login != null) {
                String user = McpJson.str(login, "user", "");
                String pass = McpJson.str(login, "password", "");
                if (!user.isEmpty()) { config.setUser(user); applied.put("user", user); }
                if (!pass.isEmpty()) { config.setPassword(pass); }
                if (!user.isEmpty()) {
                    String token = backendLogin(user, pass);
                    if (token == null) {
                        return McpJson.toolResult("登录失败：请检查后端地址与账号密码（backendUrl=" + config.getBackendUrl() + "）", true);
                    }
                    config.setToken(token);
                    applied.put("loggedIn", true);
                }
            }
        }
        if (restartNeeded) {
            plugin.applyConfig();
            applied.put("restarted", true);
        }
        JSONObject out = new JSONObject();
        out.put("applied", applied);
        out.put("config", config.toPublicJson());
        return McpJson.toolResult(out.toString(), false);
    }

    /**
     * 账号登录（对外）：拿 token 并写进配置。
     *
     * @return token；失败返回 null
     */
    public String loginNow(String user, String pass) {
        String token = backendLogin(user, pass);
        if (token != null) config.setToken(token);
        return token;
    }

    /**
     * 账号登录：POST 后端的登录接口，拿 auth_token。
     *
     * <p>后端契约（与 serve.cjs 的 /other/login 一致）：
     * <pre>POST {backendUrl}/other/login   {"username":..., "password":...}
     * → {"token": "..."}（可能带 "Bearer " 前缀，要剥掉）</pre>
     *
     * @return token；失败返回 null
     */
    private String backendLogin(String user, String pass) {
        String base = config.getBackendUrl();
        if (base == null || base.trim().isEmpty()) {
            Log.w(TAG, "未配置 backendUrl，无法登录");
            return null;
        }
        try {
            String body = "{\"username\":\"" + jsonEsc(user) + "\",\"password\":\"" + jsonEsc(pass) + "\"}";
            HttpURLConnection conn = open(base, "POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            OutputStream os = conn.getOutputStream();
            os.write(body.getBytes(StandardCharsets.UTF_8));
            os.close();
            int code = conn.getResponseCode();
            InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = readAll(is);
            JSONObject o = new JSONObject(text);
            if (!o.optBoolean("success", o.optBoolean("ok", true))) {
                Log.w(TAG, "登录失败：" + text);
                return null;
            }
            JSONObject data = o.optJSONObject("data");
            String token = data != null ? data.optString("token", "") : o.optString("token", "");
            token = token.replaceFirst("(?i)^Bearer\\s+", "");
            return token.isEmpty() ? null : token;
        } catch (Exception e) {
            Log.w(TAG, "登录异常", e);
            return null;
        }
    }

    private HttpURLConnection open(String base, String method) throws Exception {
        String b = base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        URL u = new URL(b + "/other/login");
        HttpURLConnection conn = (HttpURLConnection) u.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("Accept", "application/json");
        return conn;
    }

    // ------------------------------------------------------------ 与 webview 通信

    /**
     * 调 webview 里的 {@code window.__tfMcp.<fn>(args…)} 并取回结果。
     *
     * <p>WebView 的 evaluateJavascript **不 await Promise**，而 __tfMcp 的方法
     * 都是 async —— 直接调只能拿到 "[object Promise]"。所以走两步：
     * <ol>
     *   <li>eval {@code window.__tfMcpCall({id,fn,args})} 启动异步任务（立即返回）</li>
     *   <li>轮询 {@code window.__tfMcpResults[id]} 直到结果落地</li>
     * </ol>
     *
     * @param fn        __tfMcp 上的方法名
     * @param argsJson  参数数组（JSON 文本，如 ["test-pack"]；可为 null）
     * @return 结果对象（JSON 文本）；超时/异常返回 null
     */
    private Object callGame(String fn, String argsJson) throws Exception {
        String id = "cb" + System.nanoTime();
        JSONObject req = new JSONObject();
        req.put("id", id);
        req.put("fn", fn);
        req.put("args", new org.json.JSONArray(argsJson == null ? "[]" : argsJson));

        // ① 启动（同步 eval，返回 "accepted" 即已受理）
        String ack = evalRaw("window.__tfMcpCall(" + req + ")");
        if (ack == null || !ack.contains("accepted")) {
            Log.w(TAG, "callGame 启动失败：__tfMcpCall 不可用（ack=" + ack + "）");
            return null;
        }

        // ② 轮询结果 —— **总预算 20s**（不是每步 20s）。页面忙时单次 eval
        //    可能阻塞很久，不设总限的话最坏 100 次 × 10s ≈ 17 分钟。
        long deadline = System.currentTimeMillis() + 20_000;
        while (System.currentTimeMillis() < deadline) {
            Thread.sleep(200);
            String v = evalRaw("window.__tfMcpResults['" + id + "']");
            if (v != null && !"undefined".equals(v)) {
                evalRaw("(function(){delete window.__tfMcpResults['" + id + "']})()");
                return parseEvalResult(v);
            }
        }
        Log.w(TAG, "callGame 超时：" + fn);
        return null;
    }

    /** 同步 eval 一段 JS，返回原始结果字符串（无结果 / 超时返回 null）。 */
    private String evalRaw(String js) throws Exception {
        final AtomicReference<String> out = new AtomicReference<>(null);
        final CountDownLatch latch = new CountDownLatch(1);
        plugin.getBridge().eval(js, new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                out.set(value);
                latch.countDown();
            }
        });
        if (!latch.await(10, TimeUnit.SECONDS)) {
            return null;
        }
        return out.get();
    }

    /**
     * Capacitor 的 eval 回调给的是「JS 表达式结果」的字符串形式。
     * 对象/数组会以 JSON 文本回来，字符串会带引号，undefined 是 "undefined"。
     */
    private Object parseEvalResult(String v) {
        String s = v.trim();
        if (s.isEmpty() || "undefined".equals(s) || "null".equals(s)) return null;
        if (s.startsWith("{") || s.startsWith("[")) {
            try {
                return new JSONObject(s).toString();
            } catch (Exception e) {
                try {
                    return new JSONArray(s).toString();
                } catch (Exception e2) {
                    return s;
                }
            }
        }
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            try {
                return new JSONObject("{\"v\":" + s + "}").optString("v");
            } catch (Exception e) {
                return s.substring(1, s.length() - 1);
            }
        }
        return s;
    }

    // ------------------------------------------------------------ 小工具

    private static String jsStr(String s) {
        return "\"" + jsonEsc(s) + "\"";
    }

    private static String jsonEsc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }

    private static JSONArray toArray(Object o) {
        if (o == null) return null;
        try {
            if (o instanceof JSONArray) return (JSONArray) o;
            return new JSONArray(String.valueOf(o));
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject asObject(Object o) {
        if (o == null) return null;
        try {
            if (o instanceof JSONObject) return (JSONObject) o;
            return new JSONObject(String.valueOf(o));
        } catch (Exception e) {
            return null;
        }
    }

    static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toString("UTF-8");
    }
}