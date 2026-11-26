package com.viaco.toonfighting.mcp;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.util.List;

/**
 * APK 内 webview 用的本地 API —— 让游戏在手机上有资产集可用。
 *
 * <p><b>为什么需要</b>：APK 里没有 Node 服务端，webview 的
 * {@code fetch('/api/assetpacks')} 会失败 → 资产集列表永远是空的。
 * 但资产集是**独立安装到手机**的数据（不进 APK），所以手机必须自己能
 * 提供资产集清单 + 角色名单 + 文件挂载。
 *
 * <p>提供的接口（与 PC 的 serve.cjs 同路径同语义）：
 * <ul>
 *   <li>{@code GET /api/assetpacks} —— 已安装资产集列表 + 角色池 + 角色元信息</li>
 *   <li>{@code GET /api/packs/:dir/files} —— 某资产集的文件清单（vpath → 字节数）</li>
 *   <li>{@code GET /api/packs/:dir/select.def} —— 按资产集角色生成的 select.def</li>
 *   <li>{@code GET /packs/:dir/…} —— 资产集里的**原始文件**（VFS 按需拉取）</li>
 * </ul>
 */
public class PackApi {

    private static final String TAG = "PackApi";

    private final PackStore store;

    public PackApi(PackStore store) {
        this.store = store;
    }

    /** 处理一个请求；不属于 PackApi 的返回 null。 */
    public McpHttpServer.Response handle(McpHttpServer.Request req) {
        String path = req.path;
        if (path.equals("/api/assetpacks")) return listPacks();
        if (path.startsWith("/api/packs/")) return packApi(req, path);
        if (path.startsWith("/packs/")) return packFile(req, path);
        return null;
    }

    // ------------------------------------------------------------ /api/assetpacks

    private McpHttpServer.Response listPacks() {
        try {
            JSONObject out = new JSONObject();
            JSONArray packs = store.listPacks();
            JSONObject packChars = new JSONObject();
            JSONObject charMeta = new JSONObject();
            for (int i = 0; i < packs.length(); i++) {
                JSONObject p = packs.getJSONObject(i);
                String id = p.optString("id");
                File dir = store.packDir(id);
                if (dir == null) continue;
                List<String> ids = store.charIds(dir);
                JSONArray pool = new JSONArray();
                for (String c : ids) pool.put(c);
                packChars.put(id, pool);
                // char.json：职业 / roleType / 关键帧模式
                for (String c : ids) {
                    File cj = new File(new File(dir, "chars"), c + "/char.json");
                    if (!cj.exists()) continue;
                    try {
                        JSONObject m = new JSONObject(new String(PackStore.readAll(new FileInputStream(cj)), "UTF-8"));
                        charMeta.put(c, m);
                    } catch (Exception e) {
                        // 单个 char.json 坏了不影响整体
                    }
                }
            }
            out.put("ok", true);
            out.put("packs", packs);
            // 兜底角色：APK 自带的通用角色（由 webview 侧判断，这里只报空）
            out.put("fallbackChars", new JSONArray());
            out.put("localChars", new JSONArray());
            out.put("packChars", packChars);
            out.put("charMeta", charMeta);
            out.put("story", null);
            return McpHttpServer.Response.json(out.toString());
        } catch (Exception e) {
            Log.e(TAG, "列资产集失败", e);
            return err(e);
        }
    }

    // ------------------------------------------------------------ /api/packs/:dir/*

    private McpHttpServer.Response packApi(McpHttpServer.Request req, String path) {
        try {
            String rest = path.substring("/api/packs/".length());
            int slash = rest.indexOf('/');
            String dir = slash < 0 ? rest : rest.substring(0, slash);
            String tail = slash < 0 ? "" : rest.substring(slash + 1);
            dir = McpHttpServer.urlDecode(dir);

            File packDir = store.packDir(dir);
            if (packDir == null) {
                JSONObject o = new JSONObject();
                o.put("ok", false);
                o.put("error", "没装这个资产集：" + dir);
                return McpHttpServer.Response.json(o.toString());
            }

            // 元数据（与 PC 端 /api/packs/:dir 同形状：{ok, dir, meta}）
            if (tail.isEmpty()) {
                JSONObject meta = new JSONObject();
                for (String name : new String[]{"pack", "story", "roster", "mapping"}) {
                    File f = new File(packDir, name + ".json");
                    if (!f.isFile()) continue;
                    try {
                        meta.put(name, new JSONObject(new String(PackStore.readAll(new FileInputStream(f)), "UTF-8")));
                    } catch (Exception e) {
                        Log.w(TAG, "读 " + name + ".json 失败", e);
                    }
                }
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("dir", dir);
                o.put("meta", meta);
                return McpHttpServer.Response.json(o.toString());
            }

            if (tail.equals("files")) {
                JSONObject files = store.manifest(packDir);
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("dir", dir);
                // webview 的 vfs 挂载要用 baseUrl 拼 URL：/packs/<dir>/<vpath>
                o.put("baseUrl", "./packs/" + dir);
                o.put("files", files);
                JSONArray pool = new JSONArray();
                for (String c : store.charIds(packDir)) pool.put(c);
                o.put("pool", pool);
                o.put("chars", pool);
                // 入口 .def（每个角色目录里与目录同名的那个优先）
                JSONObject defs = new JSONObject();
                for (String c : store.charIds(packDir)) {
                    String def = entryDef(new File(new File(packDir, "chars"), c));
                    if (def != null) defs.put(c, "chars/" + c + "/" + def);
                }
                o.put("defs", defs);
                return McpHttpServer.Response.json(o.toString());
            }

            if (tail.equals("select.def")) {
                return McpHttpServer.Response.text(buildSelectDef(packDir));
            }

            // 其余子路径：当成资产集里的原始文件
            return packFile(req, "/packs/" + dir + (tail.isEmpty() ? "" : "/" + tail));
        } catch (Exception e) {
            Log.e(TAG, "资产集 API 失败", e);
            return err(e);
        }
    }

    /** 角色的入口 .def：与目录同名的优先，否则第一个。 */
    private String entryDef(File charDir) {
        String[] fs = charDir.list();
        if (fs == null) return null;
        String same = charDir.getName() + ".def";
        for (String f : fs) {
            if (f.equalsIgnoreCase(same)) return f;
        }
        List<String> defs = new java.util.ArrayList<>();
        for (String f : fs) if (f.toLowerCase().endsWith(".def")) defs.add(f);
        java.util.Collections.sort(defs);
        return defs.isEmpty() ? null : defs.get(0);
    }

    /**
     * 按资产集的角色目录生成 select.def。
     *
     * <p>与 PC 端 packSelectDef 同口径：只列这个资产集能跑的角色。
     * 引擎的选人屏读 data/select.def，webview 会用这份覆盖兜底层那份。
     */
    private String buildSelectDef(File packDir) {
        StringBuilder sb = new StringBuilder();
        sb.append("; 由手机端 MCP 服务按资产集 ").append(packDir.getName()).append(" 的 chars/ 目录生成\n");
        sb.append("[Characters]\n");
        for (String c : store.charIds(packDir)) {
            String def = entryDef(new File(new File(packDir, "chars"), c));
            if (def == null) continue;
            sb.append(c).append('/').append(def).append('\n');
        }
        sb.append("\n[ExtraStages]\n");
        File stages = new File(packDir, "stages");
        File[] sf = stages.listFiles();
        if (sf != null) {
            List<String> ds = new java.util.ArrayList<>();
            for (File f : sf) if (f.getName().toLowerCase().endsWith(".def")) ds.add(f.getName());
            java.util.Collections.sort(ds);
            for (String d : ds) sb.append("stages/").append(d).append('\n');
        }
        return sb.toString();
    }

    // ------------------------------------------------------------ /packs/:dir/...（原始文件）

    private McpHttpServer.Response packFile(McpHttpServer.Request req, String path) {
        try {
            String rest = path.substring("/packs/".length());
            int slash = rest.indexOf('/');
            String dir = slash < 0 ? rest : rest.substring(0, slash);
            String vpath = slash < 0 ? "" : rest.substring(slash + 1);
            dir = McpHttpServer.urlDecode(dir);
            vpath = McpHttpServer.urlDecode(vpath);
            if (vpath.isEmpty()) return McpHttpServer.Response.notFound();

            File packDir = store.packDir(dir);
            if (packDir == null) return McpHttpServer.Response.notFound();
            File f = new File(packDir, vpath);
            // 防目录穿越
            String cp = f.getCanonicalPath();
            if (!cp.startsWith(packDir.getCanonicalPath() + File.separator)) {
                return McpHttpServer.Response.notFound();
            }
            if (!f.isFile()) return McpHttpServer.Response.notFound();

            McpHttpServer.Response r = new McpHttpServer.Response();
            r.body = PackStore.readAll(new FileInputStream(f));
            r.contentType = mimeOf(vpath);
            return r;
        } catch (Exception e) {
            Log.e(TAG, "读资产集文件失败", e);
            return err(e);
        }
    }

    /** 静态文件的 MIME（与 serve.cjs 的表一致）。 */
    static String mimeOf(String p) {
        String lower = p.toLowerCase();
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".def") || lower.endsWith(".cns") || lower.endsWith(".cmd") || lower.endsWith(".air")) {
            return "text/plain; charset=iso-8859-1";
        }
        return "application/octet-stream";
    }

    private McpHttpServer.Response err(Exception e) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", String.valueOf(e.getMessage()));
            return McpHttpServer.Response.json(o.toString());
        } catch (Exception ignored) {
            return McpHttpServer.Response.notFound();
        }
    }
}