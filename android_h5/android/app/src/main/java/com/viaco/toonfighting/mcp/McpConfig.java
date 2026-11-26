package com.viaco.toonfighting.mcp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * MCP 服务配置（持久化在 SharedPreferences）。
 *
 * <p>配置项：
 * <ul>
 *   <li>{@code enabled} —— 是否启用 MCP 服务（系统设置里可关）</li>
 *   <li>{@code port} —— 监听端口，默认 7073</li>
 *   <li>{@code backendUrl} —— 后端服务地址（可改）</li>
 *   <li>{@code user} / {@code password} —— 账号登录信息</li>
 *   <li>{@code token} —— 登录后拿到的 auth_token</li>
 * </ul>
 *
 * <p>默认值从 {@code .env} 语义映射过来：端口 7073、启用默认开。
 * 后端地址与账号登录由用户在设置页填写（也可以由 MCP 的 set_config 工具写入）。
 */
public class McpConfig {
    public static final String PREFS = "toon_mcp";
    public static final int DEFAULT_PORT = 7073;

    private static final String K_ENABLED = "enabled";
    private static final String K_PORT = "port";
    private static final String K_BACKEND = "backendUrl";
    private static final String K_USER = "user";
    private static final String K_PASSWORD = "password";
    private static final String K_TOKEN = "token";
    private static final String K_PACK = "packId";
    private static final String K_SESSION = "sessionId";

    private final SharedPreferences sp;

    public McpConfig(Context ctx) {
        this.sp = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean isEnabled() {
        return sp.getBoolean(K_ENABLED, true);   // 默认启用
    }

    public void setEnabled(boolean v) {
        sp.edit().putBoolean(K_ENABLED, v).apply();
    }

    public int getPort() {
        int p = sp.getInt(K_PORT, DEFAULT_PORT);
        return (p >= 1 && p <= 65535) ? p : DEFAULT_PORT;
    }

    public void setPort(int p) {
        if (p < 1 || p > 65535) throw new IllegalArgumentException("端口必须在 1~65535 之间");
        sp.edit().putInt(K_PORT, p).apply();
    }

    public String getBackendUrl() {
        return sp.getString(K_BACKEND, "");
    }

    public void setBackendUrl(String u) {
        sp.edit().putString(K_BACKEND, u == null ? "" : u.trim()).apply();
    }

    public String getUser() {
        return sp.getString(K_USER, "");
    }

    public void setUser(String u) {
        sp.edit().putString(K_USER, u == null ? "" : u).apply();
    }

    public String getPassword() {
        return sp.getString(K_PASSWORD, "");
    }

    public void setPassword(String p) {
        sp.edit().putString(K_PASSWORD, p == null ? "" : p).apply();
    }

    public String getToken() {
        return sp.getString(K_TOKEN, "");
    }

    public void setToken(String t) {
        sp.edit().putString(K_TOKEN, t == null ? "" : t).apply();
    }

    public String getBoundPackId() {
        return sp.getString(K_PACK, "");
    }

    public void setBoundPackId(String v) {
        sp.edit().putString(K_PACK, v == null ? "" : v).apply();
    }

    public String getBoundSessionId() {
        return sp.getString(K_SESSION, "");
    }

    public void setBoundSessionId(String v) {
        sp.edit().putString(K_SESSION, v == null ? "" : v).apply();
    }

    /** 导出成 JSON（给 MCP 的 get_config 用；password/token 不外泄）。 */
    public JSONObject toPublicJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", isEnabled());
            o.put("port", getPort());
            o.put("backendUrl", getBackendUrl());
            o.put("user", getUser());
            o.put("loggedIn", !getToken().isEmpty());
            o.put("boundPackId", getBoundPackId());
            o.put("boundSessionId", getBoundSessionId());
        } catch (Exception e) {
            // JSONObject.put 只在极端情况抛异常（键名非法），键名都是常量
        }
        return o;
    }
}
