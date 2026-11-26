package com.viaco.toonfighting.mcp;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * MCP 的 JSON-RPC 2.0 报文构造/解析。
 *
 * <p>MCP over HTTP 的形状：
 * <ul>
 *   <li>POST /mcp，body 是 JSON-RPC 单条消息或数组（批量）</li>
 *   <li>响应是同形状的 JSON-RPC 消息（成功带 result，失败带 error）</li>
 *   <li>通知（无 id）不返回响应</li>
 * </ul>
 */
public final class McpJson {

    // JSON-RPC 标准错误码
    public static final int PARSE_ERROR = -32700;
    public static final int INVALID_REQUEST = -32600;
    public static final int METHOD_NOT_FOUND = -32601;
    public static final int INVALID_PARAMS = -32602;
    public static final int INTERNAL_ERROR = -32603;
    // MCP 规范：工具执行失败落在 -32000 段
    public static final int TOOL_ERROR = -32000;

    private McpJson() {}

    /** 成功响应。 */
    public static JSONObject ok(Object id, JSONObject result) {
        JSONObject o = new JSONObject();
        try {
            o.put("jsonrpc", "2.0");
            if (id != null) o.put("id", id);
            o.put("result", result == null ? new JSONObject() : result);
        } catch (JSONException e) {
            // 键名都是字面量，不会走到这里
        }
        return o;
    }

    /** 错误响应。 */
    public static JSONObject err(Object id, int code, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("jsonrpc", "2.0");
            if (id != null) o.put("id", id);
            JSONObject e = new JSONObject();
            e.put("code", code);
            e.put("message", message == null ? "未知错误" : message);
            o.put("error", e);
        } catch (JSONException ex) {
            // 同上
        }
        return o;
    }

    /** 工具执行结果（MCP 约定：content 数组 + isError 标记）。 */
    public static JSONObject toolResult(Object text, boolean isError) {
        JSONObject result = new JSONObject();
        try {
            JSONArray content = new JSONArray();
            JSONObject c = new JSONObject();
            c.put("type", "text");
            c.put("text", text == null ? "" : text);
            content.put(c);
            result.put("content", content);
            result.put("isError", isError);
        } catch (JSONException e) {
            // 同上
        }
        return result;
    }

    /** 文本内容块。 */
    public static JSONObject textContent(String text) {
        JSONObject c = new JSONObject();
        try {
            c.put("type", "text");
            c.put("text", text == null ? "" : text);
        } catch (JSONException e) {
            // 同上
        }
        return c;
    }

    /**
     * 解析请求体 —— 支持单条对象与批量数组。
     *
     * @return 解析出的消息列表；body 不是合法 JSON 时返回 null（调用方回 parse error）
     */
    public static List<JSONObject> parseBatch(String body) {
        List<JSONObject> out = new ArrayList<>();
        if (body == null) return null;
        String t = body.trim();
        if (t.isEmpty()) return null;
        try {
            if (t.charAt(0) == '[') {
                JSONArray arr = new JSONArray(t);
                for (int i = 0; i < arr.length(); i++) {
                    Object item = arr.get(i);
                    if (item instanceof JSONObject) out.add((JSONObject) item);
                }
                return out.isEmpty() ? null : out;
            }
            JSONObject o = new JSONObject(t);
            out.add(o);
            return out;
        } catch (JSONException e) {
            return null;
        }
    }

    /** 取字符串参数，缺失返回默认值。 */
    public static String str(JSONObject args, String key, String def) {
        if (args == null) return def;
        if (!args.has(key) || args.isNull(key)) return def;
        String v = args.optString(key, def);
        return v == null ? def : v;
    }

    /** 取布尔参数，缺失返回默认值。 */
    public static boolean bool(JSONObject args, String key, boolean def) {
        if (args == null || !args.has(key) || args.isNull(key)) return def;
        return args.optBoolean(key, def);
    }

    /** 取整数参数，缺失返回默认值。 */
    public static int integer(JSONObject args, String key, int def) {
        if (args == null || !args.has(key) || args.isNull(key)) return def;
        return args.optInt(key, def);
    }
}