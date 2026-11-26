package com.viaco.toonfighting.mcp;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * MCP 插件（Capacitor 原生）—— 手机上的 MCP 服务控制面。
 *
 * <p>职责：
 * <ul>
 *   <li>按配置启停 MCP HTTP 服务（默认启用，端口默认 7073）</li>
 *   <li>处理 JSON-RPC：initialize / tools/list / tools/call / prompts/list / ping</li>
 *   <li>把「资产集 / 故事绑定」工具的执行委托给 {@link McpExecutor}，
 *       后者调 webview 里的 {@code window.__tfMcp.*}</li>
 *   <li>给前端（设置页）提供读配置 / 改配置的 JS 接口</li>
 * </ul>
 *
 * <p>JS 侧用法（设置页）：
 * <pre>
 * const {Mcp} = await import('@capacitor/core') → 实际用 window.Capacitor.Plugins.Mcp
 * await Mcp.getStatus()        // { enabled, running, port }
 * await Mcp.setEnabled(false)  // 关掉服务
 * await Mcp.setPort(7074)
 * await Mcp.setBackendUrl('http://192.168.1.10:60002/')
 * await Mcp.login('admin', '***')
 * </pre>
 */
@CapacitorPlugin(name = "Mcp")
public class McpPlugin extends Plugin {

    private static final String TAG = "McpPlugin";

    private McpConfig config;
    private McpExecutor executor;
    private McpHttpServer server;
    private PackStore packStore;
    private PackApi packApi;
    private ConnApi connApi;
    private AvatarApi avatarApi;

    @Override
    public void load() {
        config = new McpConfig(getContext());
        packStore = new PackStore(getContext());
        packApi = new PackApi(packStore);
        executor = new McpExecutor(this, config, packStore);
        connApi = new ConnApi(config, executor);
        avatarApi = new AvatarApi(config, packStore);
        startServerIfEnabled();
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------ 服务生命周期

    /** 按配置启停服务。改了端口/启用状态后调用。 */
    public void applyConfig() {
        stopServer();
        startServerIfEnabled();
    }

    private void startServerIfEnabled() {
        if (config == null || !config.isEnabled()) {
            Log.i(TAG, "MCP 服务未启用（可在设置里开启）");
            return;
        }
        if (server != null && server.isRunning()) return;
        int port = config.getPort();
        server = new McpHttpServer(port, new McpHttpServer.Handler() {
            @Override
            public McpHttpServer.Response handle(McpHttpServer.Request req) {
                return route(req);
            }
        });
        server.start();
        if (!server.isRunning()) {
            Log.e(TAG, "MCP 服务启动失败（端口 " + port + " 被占用？）");
        }
    }

    private void stopServer() {
        if (server != null) {
            server.stop();
            server = null;
        }
    }

    // ------------------------------------------------------------ HTTP 路由

    private McpHttpServer.Response route(McpHttpServer.Request req) {
        String path = req.path;

        // 预检（CORS）
        if ("OPTIONS".equals(req.method)) {
            McpHttpServer.Response r = new McpHttpServer.Response();
            r.status = 204;
            return r;
        }
        // MCP 端点
        if ("/mcp".equals(path) || "/".equals(path) || "/sse".equals(path)) {
            if (!"POST".equals(req.method)) {
                McpHttpServer.Response r = McpHttpServer.Response.notFound();
                r.status = 405;
                r.body = "{\"ok\":false,\"error\":\"MCP 端点只接受 POST\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                return r;
            }
            return handleMcp(req);
        }
        // 健康检查
        if ("/health".equals(path)) {
            JSONObject o = new JSONObject();
            try {
                o.put("ok", true);
                o.put("port", config.getPort());
                o.put("enabled", config.isEnabled());
                o.put("tools", McpTools.ALL.length);
                o.put("packs", packStore.listPacks().length());
            } catch (Exception e) {
                // 忽略
            }
            return McpHttpServer.Response.json(o.toString());
        }
        // 故事联动 API（APK 内 webview 用的）：/api/conn/*
        McpHttpServer.Response connResp = connApi.handle(req);
        if (connResp != null) return connResp;
        // 图片接口：/api/role-avatar、/api/portrait、/api/pose（PC 端 serve.cjs 同名接口的手机版）
        McpHttpServer.Response avResp = avatarApi.handle(req);
        if (avResp != null) return avResp;
        // 资产集 API（APK 内 webview 用的）：/api/assetpacks、/api/packs/:dir/*、/packs/:dir/*
        McpHttpServer.Response apiResp = packApi.handle(req);
        if (apiResp != null) return apiResp;
        return McpHttpServer.Response.notFound();
    }

    /** 处理 JSON-RPC 报文（支持单条与批量）。 */
    private McpHttpServer.Response handleMcp(McpHttpServer.Request req) {
        List<JSONObject> msgs = McpJson.parseBatch(req.body);
        if (msgs == null) {
            return McpHttpServer.Response.json(McpJson.err(null, McpJson.PARSE_ERROR, "JSON 解析失败").toString());
        }
        JSONArray out = new JSONArray();
        boolean anyResponse = false;
        for (JSONObject msg : msgs) {
            Object id = msg.opt("id");
            String method = msg.optString("method", "");
            JSONObject params = msg.optJSONObject("params");

            // 通知（无 id）不回复
            boolean isNotification = !msg.has("id") || msg.isNull("id");

            JSONObject resp = dispatch(id, method, params);
            if (resp != null) {
                anyResponse = true;
                out.put(resp);
            }
            if (isNotification) {
                // 通知不产生响应，但 execute 仍要跑（params 在）
            }
        }
        if (!anyResponse) {
            McpHttpServer.Response r = new McpHttpServer.Response();
            r.status = 202;
            r.body = new byte[0];
            return r;
        }
        // 单条请求回对象，批量回数组
        if (msgs.size() == 1) {
            return McpHttpServer.Response.json(out.optJSONObject(0).toString());
        }
        return McpHttpServer.Response.json(out.toString());
    }

    /** 分发一个 JSON-RPC 方法。 */
    private JSONObject dispatch(Object id, String method, JSONObject params) {
        try {
            if ("initialize".equals(method)) {
                JSONObject result = new JSONObject();
                result.put("protocolVersion", McpTools.PROTOCOL_VERSION);
                JSONObject caps = new JSONObject();
                JSONObject tools = new JSONObject();
                tools.put("listChanged", false);
                caps.put("tools", tools);
                result.put("capabilities", caps);
                JSONObject info = new JSONObject();
                info.put("name", "toon-fighting-android");
                info.put("version", "1.0.0");
                result.put("serverInfo", info);
                return McpJson.ok(id, result);
            }
            if ("notifications/initialized".equals(method) || "initialized".equals(method)) {
                return null;   // 通知，不回
            }
            if ("ping".equals(method)) {
                return McpJson.ok(id, new JSONObject());
            }
            if ("tools/list".equals(method)) {
                JSONArray arr = new JSONArray();
                for (McpTools.Tool t : McpTools.ALL) {
                    JSONObject o = new JSONObject();
                    o.put("name", t.name);
                    o.put("title", t.title);
                    o.put("description", t.description);
                    try {
                        o.put("inputSchema", new JSONObject(t.inputSchemaJson));
                    } catch (Exception e) {
                        o.put("inputSchema", new JSONObject());
                    }
                    arr.put(o);
                }
                JSONObject result = new JSONObject();
                result.put("tools", arr);
                return McpJson.ok(id, result);
            }
            if ("prompts/list".equals(method)) {
                JSONObject result = new JSONObject();
                result.put("prompts", new JSONArray());
                return McpJson.ok(id, result);
            }
            if ("tools/call".equals(method)) {
                String name = params == null ? "" : params.optString("name", "");
                JSONObject args = params == null ? null : params.optJSONObject("arguments");
                if (args == null) args = params == null ? new JSONObject() : params.optJSONObject("arguments");
                if (args == null) args = new JSONObject();
                JSONObject r = executor.call(name, args);
                return McpJson.ok(id, r);
            }
            if ("resources/list".equals(method)) {
                JSONObject result = new JSONObject();
                result.put("resources", new JSONArray());
                return McpJson.ok(id, result);
            }
            return McpJson.err(id, McpJson.METHOD_NOT_FOUND, "未知方法：" + method);
        } catch (Exception e) {
            Log.e(TAG, "分发失败 " + method, e);
            return McpJson.err(id, McpJson.INTERNAL_ERROR, String.valueOf(e.getMessage()));
        }
    }

    // ------------------------------------------------------------ JS 接口（设置页用）

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("enabled", config.isEnabled());
        o.put("running", server != null && server.isRunning());
        o.put("port", config.getPort());
        o.put("backendUrl", config.getBackendUrl());
        o.put("user", config.getUser());
        o.put("loggedIn", !config.getToken().isEmpty());
        o.put("boundPackId", config.getBoundPackId());
        o.put("boundSessionId", config.getBoundSessionId());
        o.put("ip", deviceIp());
        call.resolve(o);
    }

    /** 本机 WiFi 的 IPv4（给设置页显示真实的 MCP 地址用）。 */
    private static String deviceIp() {
        try {
            java.util.Enumeration<java.net.NetworkInterface> nis = java.net.NetworkInterface.getNetworkInterfaces();
            while (nis.hasMoreElements()) {
                java.net.NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                java.util.Enumeration<java.net.InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    java.net.InetAddress a = addrs.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) { /* 拿不到就显示占位符 */ }
        return "";
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean en = call.getBoolean("enabled", true);
        config.setEnabled(en);
        applyConfig();
        JSObject o = new JSObject();
        o.put("enabled", config.isEnabled());
        o.put("running", server != null && server.isRunning());
        call.resolve(o);
    }

    @PluginMethod
    public void setPort(PluginCall call) {
        Integer p = call.getInt("port");
        if (p == null || p < 1 || p > 65535) {
            call.reject("端口必须在 1~65535 之间");
            return;
        }
        config.setPort(p);
        applyConfig();
        JSObject o = new JSObject();
        o.put("port", config.getPort());
        o.put("running", server != null && server.isRunning());
        call.resolve(o);
    }

    @PluginMethod
    public void setBackendUrl(PluginCall call) {
        String u = call.getString("backendUrl", "");
        config.setBackendUrl(u);
        JSObject o = new JSObject();
        o.put("backendUrl", config.getBackendUrl());
        call.resolve(o);
    }

    @PluginMethod
    public void login(PluginCall call) {
        String user = call.getString("user", "");
        String pass = call.getString("password", "");
        if (user.isEmpty()) {
            call.reject("缺少用户名");
            return;
        }
        config.setUser(user);
        config.setPassword(pass);
        String token = null;
        String err = null;
        try {
            token = executorLogin(user, pass);
        } catch (Exception e) {
            err = String.valueOf(e.getMessage());
        }
        JSObject o = new JSObject();
        o.put("ok", token != null && !token.isEmpty());
        o.put("user", user);
        if (token == null || token.isEmpty()) {
            o.put("error", err != null ? err : "登录失败：请检查后端地址与账号密码");
        }
        call.resolve(o);
    }

    /** 走执行器做登录（复用后端契约）。 */
    private String executorLogin(String user, String pass) {
        try {
            return executor.loginNow(user, pass);
        } catch (Exception e) {
            return null;
        }
    }
}
