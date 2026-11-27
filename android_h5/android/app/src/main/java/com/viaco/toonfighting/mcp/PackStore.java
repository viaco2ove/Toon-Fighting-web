package com.viaco.toonfighting.mcp;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 手机上的资产集（地图集数据）仓库。
 *
 * <p><b>设计要点</b>：资产集是**独立安装到手机的数据**，不是集成进 APK。
 * APK 只带兜底层（ikemen-fs/file/chars 里那几个通用角色）。
 * 资产集装在应用私有目录 {@code files/packs/<packId>/} 下：
 *
 * <pre>
 *   files/packs/
 *     ├── registry.json            ← 登记簿（装了哪些资产集）
 *     └── &lt;packId&gt;/
 *         ├── pack.json  story.json  roster.json  mapping.json
 *         ├── manifest.json         ← 文件清单（vpath → 字节数）
 *         ├── chars/&lt;charId&gt;/…    ← 角色包
 *         └── data/ external/ stages/ …
 * </pre>
 *
 * <p>安装方式：把一个资产集目录（或它的 zip）复制/解压进来即可。
 * MCP 的「安装资产集」工具、以及将来的「从 URL 安装」都走这一条路径。
 */
public class PackStore {

    private static final String TAG = "PackStore";

    private final File root;      // files/packs
    private final File registry;  // files/packs/registry.json

    public PackStore(Context ctx) {
        this.root = new File(ctx.getFilesDir(), "packs");
        this.registry = new File(root, "registry.json");
        if (!root.exists()) root.mkdirs();
    }

    /** 资产集仓库根目录（给 MCP 报告用）。 */
    public String getRootPath() {
        return root.getAbsolutePath();
    }

    // ------------------------------------------------------------ 登记簿

    /** 登记簿：packId → { dirName, name, installedAt, chars } */
    private JSONObject readRegistry() {
        if (!registry.exists()) return new JSONObject();
        try {
            InputStream in = new FileInputStream(registry);
            byte[] b = readAll(in);
            return new JSONObject(new String(b, StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "读登记簿失败", e);
            return new JSONObject();
        }
    }

    private void writeRegistry(JSONObject o) {
        try {
            FileOutputStream out = new FileOutputStream(registry);
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            out.close();
        } catch (Exception e) {
            Log.e(TAG, "写登记簿失败", e);
        }
    }

    // ------------------------------------------------------------ 查询

    /** 已安装的资产集列表。 */
    public JSONArray listPacks() {
        JSONArray arr = new JSONArray();
        JSONObject reg = readRegistry();
        File[] dirs = root.listFiles();
        if (dirs == null) return arr;
        for (File d : dirs) {
            if (!d.isDirectory()) continue;
            String id = d.getName();
            try {
                JSONObject p = new JSONObject();
                p.put("id", id);
                p.put("dir", id);
                p.put("dirName", id);
                String name = id;
                File pf = new File(d, "pack.json");
                if (pf.exists()) {
                    JSONObject pk = new JSONObject(new String(readAll(new FileInputStream(pf)), StandardCharsets.UTF_8));
                    name = pk.optString("name", pk.optString("title", id));
                    // stories/type 提到顶层：webview 的「资产集跟随故事」按 p.stories 匹配
                    // （PC 端 serve.cjs 的 listPacks 有这个字段，原生端漏了 → 切故事永远匹配不上）
                    if (pk.has("stories")) p.put("stories", pk.optJSONArray("stories"));
                    if (pk.has("type")) p.put("type", pk.optString("type"));
                }
                if (!p.has("stories") && reg.has(id)) {
                    JSONObject info = reg.optJSONObject(id);
                    if (info != null && info.has("stories")) p.put("stories", info.optJSONArray("stories"));
                }
                p.put("name", name);
                p.put("installed", true);
                p.put("chars", countChars(d));
                if (reg.has(id)) p.put("info", reg.get(id));
                arr.put(p);
            } catch (Exception e) {
                Log.w(TAG, "读资产集 " + id + " 失败", e);
            }
        }
        return arr;
    }

    /** 资产集目录（按 packId）。没有返回 null。 */
    public File packDir(String packId) {
        if (packId == null || packId.isEmpty()) return null;
        File d = new File(root, sanitize(packId));
        return (d.isDirectory()) ? d : null;
    }

    /** 资产集里的角色目录名列表。 */
    public List<String> charIds(File packDir) {
        List<String> out = new ArrayList<>();
        File chars = new File(packDir, "chars");
        File[] ds = chars.listFiles();
        if (ds == null) return out;
        for (File d : ds) {
            if (!d.isDirectory()) continue;
            // 有 .def 才算角色包
            File[] fs = d.listFiles();
            if (fs == null) continue;
            for (File f : fs) {
                if (f.getName().toLowerCase().endsWith(".def")) { out.add(d.getName()); break; }
            }
        }
        java.util.Collections.sort(out);
        return out;
    }

    private int countChars(File packDir) {
        return charIds(packDir).size();
    }

    // ------------------------------------------------------------ 安装

    /**
     * 安装一个资产集（从 zip 解压或从目录复制）。
     *
     * @param source  zip 文件或目录
     * @param packId  资产集 id（用目录名）
     * @return 安装结果 JSON
     */
    public JSONObject install(File source, String packId) {
        JSONObject out = new JSONObject();
        try {
            String id = (packId == null || packId.isEmpty())
                ? (source.isDirectory() ? source.getName() : stripExt(source.getName()))
                : sanitize(packId);
            File dest = new File(root, id);
            if (dest.exists()) deleteRec(dest);
            dest.mkdirs();

            if (source.isDirectory()) {
                copyDir(source, dest);
            } else {
                unzip(source, dest);
            }
            // zip 常见两种打包形态：内容直接在根 / 顶层套一层目录。
            // 解压后若 dest 下只有一个子目录（且 pack.json/chars 在那层），
            // 把子目录内容上提一层 —— 否则清单和角色都会找不到。
            File[] top = dest.listFiles();
            if (top != null && top.length == 1 && top[0].isDirectory()) {
                File inner = top[0];
                if (new File(inner, "pack.json").isFile() || new File(inner, "chars").isDirectory()) {
                    File[] fs = inner.listFiles();
                    if (fs != null) {
                        for (File f : fs) {
                            if (!f.renameTo(new File(dest, f.getName()))) {
                                copyDir(f, new File(dest, f.getName()));
                                deleteRec(f);
                            }
                        }
                    }
                    inner.delete();
                }
            }

            // 读 pack.json 补登记簿
            JSONObject reg = readRegistry();
            JSONObject info = new JSONObject();
            info.put("installedAt", System.currentTimeMillis());
            info.put("chars", countChars(dest));
            File pf = new File(dest, "pack.json");
            if (pf.exists()) {
                JSONObject pk = new JSONObject(new String(readAll(new FileInputStream(pf)), StandardCharsets.UTF_8));
                info.put("name", pk.optString("name", pk.optString("title", id)));
            }
            reg.put(id, info);
            writeRegistry(reg);

            out.put("ok", true);
            out.put("packId", id);
            out.put("chars", countChars(dest));
            out.put("path", dest.getAbsolutePath());
            return out;
        } catch (Exception e) {
            Log.e(TAG, "安装资产集失败", e);
            try {
                out.put("ok", false);
                out.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) { }
            return out;
        }
    }

    /** 卸载一个资产集。 */
    public JSONObject uninstall(String packId) {
        JSONObject out = new JSONObject();
        try {
            File d = packDir(packId);
            if (d == null) { out.put("ok", false); out.put("error", "没装这个资产集"); return out; }
            deleteRec(d);
            JSONObject reg = readRegistry();
            reg.remove(packId);
            writeRegistry(reg);
            out.put("ok", true);
            out.put("packId", packId);
            return out;
        } catch (Exception e) {
            try { out.put("ok", false); out.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
            return out;
        }
    }

    // ------------------------------------------------------------ 文件清单

    /**
     * 资产集的文件清单（vpath → 字节数），供 webview 的 VFS 挂载用。
     *
     * <p>优先读资产集自带的 manifest.json；没有就现扫一遍目录。
     */
    public JSONObject manifest(File packDir) {
        JSONObject files = new JSONObject();
        File mf = new File(packDir, "manifest.json");
        if (mf.exists()) {
            try {
                JSONObject m = new JSONObject(new String(readAll(new FileInputStream(mf)), StandardCharsets.UTF_8));
                JSONObject f = m.optJSONObject("files");
                if (f != null) {
                    java.util.Iterator<String> it = f.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        files.put(k, f.optLong(k));
                    }
                    return files;
                }
            } catch (Exception e) {
                Log.w(TAG, "读 manifest 失败，改为现扫", e);
            }
        }
        scan(packDir, "", files);
        return files;
    }

    private void scan(File dir, String prefix, JSONObject out) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            String rel = prefix.isEmpty() ? f.getName() : prefix + "/" + f.getName();
            if (f.isDirectory()) {
                scan(f, rel, out);
            } else {
                try { out.put(rel, f.length()); } catch (Exception ignored) { }
            }
        }
    }

    // ------------------------------------------------------------ 工具

    private static String sanitize(String s) {
        return s.replaceAll("[^a-zA-Z0-9._\\-]", "_");
    }

    private static String stripExt(String s) {
        int i = s.lastIndexOf('.');
        return i > 0 ? s.substring(0, i) : s;
    }

    static void copyDir(File src, File dst) throws Exception {
        File[] fs = src.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            File d = new File(dst, f.getName());
            if (f.isDirectory()) {
                d.mkdirs();
                copyDir(f, d);
            } else {
                copyFile(f, d);
            }
        }
    }

    static void copyFile(File src, File dst) throws Exception {
        InputStream in = new FileInputStream(src);
        OutputStream out = new FileOutputStream(dst);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        out.close();
    }

    static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] fs = f.listFiles();
            if (fs != null) for (File x : fs) deleteRec(x);
        }
        f.delete();
    }

    /**
     * 解压 zip（资产集的分发格式）。
     * 只支持 store 与 deflate 两种方式 —— 资产生成的都是标准 zip。
     *
     * <p>兼容两种打包怪癖：
     * <ul>
     *   <li>Windows 工具（PowerShell Compress-Archive）的条目分隔符是 '\'；</li>
     *   <li>目录条目可能**不带尾部 '/'**（isDirectory()=false、数据 0 字节）——
     *       直接当文件写会挡住后续子路径（ENOTDIR）。判据：0 字节且名字是
     *       其它条目的父路径 → 当目录。</li>
     * </ul>
     */
    static void unzip(File zip, File dest) throws Exception {
        java.util.zip.ZipFile zf = new java.util.zip.ZipFile(zip);
        try {
            String root = dest.getCanonicalPath() + File.separator;
            // 第一遍：归一化名字，找出「伪目录」条目（0 字节且是其它条目的父路径）
            java.util.List<java.util.zip.ZipEntry> entries = new java.util.ArrayList<>();
            java.util.Set<String> names = new java.util.HashSet<>();
            java.util.Enumeration<? extends java.util.zip.ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) entries.add(en.nextElement());
            for (java.util.zip.ZipEntry e : entries) names.add(e.getName().replace('\\', '/'));
            java.util.Set<String> dirs = new java.util.HashSet<>();
            for (java.util.zip.ZipEntry e : entries) {
                String name = e.getName().replace('\\', '/');
                if (e.isDirectory() || name.endsWith("/")) {
                    dirs.add(name);
                    continue;
                }
                if (e.getSize() == 0) {
                    String prefix = name + "/";
                    boolean isParent = false;
                    for (String other : names) {
                        if (other.startsWith(prefix)) { isParent = true; break; }
                    }
                    if (isParent) dirs.add(name);
                }
            }
            // 第二遍：先建目录，再写文件
            for (String d : dirs) {
                new File(dest, d).mkdirs();
            }
            for (java.util.zip.ZipEntry e : entries) {
                String name = e.getName().replace('\\', '/');
                if (dirs.contains(name)) continue;   // 目录条目，第一遍已建
                File out = new File(dest, name);
                // 防目录穿越（../）
                if (!out.getCanonicalPath().startsWith(root)) {
                    Log.w(TAG, "跳过越界条目：" + e.getName());
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();
                InputStream in = zf.getInputStream(e);
                FileOutputStream fo = new FileOutputStream(out);
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
                in.close();
                fo.close();
            }
        } finally {
            zf.close();
        }
    }

    static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toByteArray();
    }
}