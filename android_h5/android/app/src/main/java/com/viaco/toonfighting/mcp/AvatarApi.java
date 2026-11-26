package com.viaco.toonfighting.mcp;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 图片接口。APK 内没有 Node/sharp，用平台 BitmapFactory 做缩放。
 * <b>不依赖 PC</b>：任何接口都不会去代理 PC 端 serve.cjs（2026-11-27 移除
 * role-avatar 的 PC 代理与 /api/anim 的 PC 透传 —— SFF/AIR 解码由 webview 里的
 * ff-decode.js 直接从本机 /packs/* 取字节自解，/api/anim 故意不提供，立即 404）。
 *
 * <ul>
 *   <li><b>GET /api/role-avatar/&lt;后端OSS相对路径&gt;</b> —— toonflow 角色头像。
 *       直接取后端（backendUrl，部署在服务器上的 toonflow 平台）原图，
 *       解码后缩到 192px 方形再编码 webp（7MB → 十几 KB）。
 *       已知折中：Android 平台解码 animated webp 只拿得到第一帧，
 *       所以手机端头像会是静态图（PC 端 sharp animated:true 才有动图）。</li>
 *   <li><b>GET /api/portrait/&lt;charId&gt;?pack=&lt;dir&gt;</b> —— MUGEN 实体头像。
 *       不做 SFF 解码（工程量大），直接读资产集构建期生成的
 *       {@code chars/<id>/avatar/head.png}，缩到 256px。</li>
 *   <li><b>GET /api/pose/&lt;charId&gt;?pack=&lt;dir&gt;</b> —— 选人屏立绘，
 *       读 {@code full.png}（等比缩到最长边 512，不裁方形），回落 head.png。</li>
 *   <li><b>GET /api/anim/&lt;charId&gt;/&lt;action&gt;</b> —— 故意不实现（立即 404）。
 *       帧序列由前端 ff-decode.js 在 webview 里解 SFF+AIR 本地生成，不需要任何服务端。</li>
 * </ul>
 *
 * <p>找不到/失败一律 404 —— 前端 img 的 onerror 会回落到首字占位，不会破图。
 */
public class AvatarApi {

    private static final String TAG = "AvatarApi";
    private static final Pattern SAFE_PATH = Pattern.compile("^/[A-Za-z0-9_\\-./]+\\.(png|jpe?g|webp|gif)$");

    private final McpConfig config;
    private final PackStore packStore;

    /** 压缩小图 LRU 缓存（每张十几～几十 KB，48 张足够整个花名册）。 */
    private final LinkedHashMap<String, byte[]> cache = new LinkedHashMap<String, byte[]>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, byte[]> e) { return size() > 48; }
    };

    AvatarApi(McpConfig config, PackStore packStore) {
        this.config = config;
        this.packStore = packStore;
    }

    /** @return 响应；不归本类管的路径返回 null（继续走其它路由）。 */
    public McpHttpServer.Response handle(McpHttpServer.Request req) {
        if (!"GET".equals(req.method)) return null;
        String p = req.path;
        try {
            if (p.startsWith("/api/role-avatar/")) return roleAvatar(req);
            if (p.startsWith("/api/portrait/")) {
                return packImage(p.substring("/api/portrait/".length()), req.param("pack"), 256, true, "head.png", "full.png");
            }
            if (p.startsWith("/api/pose/")) {
                return packImage(p.substring("/api/pose/".length()), req.param("pack"), 512, false, "full.png", "head.png");
            }
            // /api/anim 故意不路由：帧序列由前端 ff-decode.js 本地解码（不依赖 PC），
            // 这里立即 404，前端拿不到响应就先走本地解码，不再空等任何代理。
            if (p.startsWith("/api/anim/")) return McpHttpServer.Response.notFound();
        } catch (Exception e) {
            Log.w(TAG, "图片接口失败 " + p, e);
        }
        return null;
    }

    // ------------------------------------------------------------ 后端头像代理

    private McpHttpServer.Response roleAvatar(McpHttpServer.Request req) throws Exception {
        String rel = McpHttpServer.urlDecode(req.path.substring("/api/role-avatar/".length()));
        int q = rel.indexOf('?');
        if (q >= 0) rel = rel.substring(0, q);
        if (!rel.startsWith("/")) rel = "/" + rel;
        if (!SAFE_PATH.matcher(rel).matches()) return McpHttpServer.Response.notFound();

        String base = config.getBackendUrl() == null ? "" : config.getBackendUrl().trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        if (base.isEmpty()) return McpHttpServer.Response.notFound();

        String key = rel + "@v3";
        byte[] out;
        synchronized (cache) { out = cache.get(key); }
        if (out == null) {
            // 直接取后端原图（不经过任何 PC 代理），用 BitmapFactory 缩到 192px。
            // Android 对 animated webp 只能解第一帧（部分 ROM 甚至解不出 →
            // 缩放失败），失败时原样转发 —— 大，但比 404 强。
            byte[] raw = httpGetQuiet(base + rel);
            if (looksLikeImage(raw)) {
                out = scale(raw, 192, true, webpFormat(), 85);
                if (out == null) {
                    Log.w(TAG, "BitmapFactory 缩放失败，回落原图转发 " + rel + " (" + raw.length + "B)");
                    out = raw;
                }
            }
            if (out == null) return McpHttpServer.Response.notFound();
            // 只缓存小图；原尺寸大图（几 MB）不进缓存，避免把内存吃光
            if (out.length < 1024 * 1024) {
                synchronized (cache) { cache.put(key, out); }
            }
        }
        McpHttpServer.Response r = new McpHttpServer.Response();
        r.contentType = "image/webp";
        r.body = out;
        return r;
    }

    // ------------------------------------------------------------ 站立动画（见类注释：前端本地解码，这里不再有任何代理）

    private static boolean looksLikeImage(byte[] b) {
        if (b == null || b.length < 16) return false;
        if ((b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return true;   // PNG
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) return true;                        // JPEG
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F') return true;              // WEBP
        if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F') return true;                             // GIF
        return false;
    }

    // ------------------------------------------------------------ 资产集自带头像

    private McpHttpServer.Response packImage(String tail, String pack, int target,
                                             boolean square, String primary, String fallback) throws Exception {
        int q = tail.indexOf('?');
        if (q >= 0) tail = tail.substring(0, q);
        String charId = McpHttpServer.urlDecode(tail).trim();
        if (charId.isEmpty() || charId.contains("..") || charId.contains("/")) {
            return McpHttpServer.Response.notFound();
        }
        String key = "pack:" + pack + ":" + charId + ":" + primary + "@" + target;
        byte[] out;
        synchronized (cache) { out = cache.get(key); }
        if (out == null) {
            byte[] raw = readPackFile(pack, charId, primary);
            if (raw == null) raw = readPackFile(pack, charId, fallback);
            if (raw == null) return McpHttpServer.Response.notFound();
            out = scale(raw, target, square, Bitmap.CompressFormat.PNG, 100);
            if (out == null) out = raw;
            synchronized (cache) { cache.put(key, out); }
        }
        McpHttpServer.Response r = new McpHttpServer.Response();
        r.contentType = "image/png";
        r.body = out;
        return r;
    }

    private byte[] readPackFile(String pack, String charId, String file) {
        if (pack == null || pack.isEmpty()) return null;
        File d = packStore.packDir(pack);
        if (d == null) return null;
        File f = new File(new File(d, "chars" + File.separator + charId + File.separator + "avatar"), file);
        if (!f.isFile()) return null;
        try {
            InputStream in = new FileInputStream(f);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            return bo.toByteArray();
        } catch (Exception e) {
            Log.w(TAG, "读资产集头像失败 " + f, e);
            return null;
        }
    }

    // ------------------------------------------------------------ 缩放与网络

    /**
     * 解码图片并缩放。
     *
     * @param square true = cover 裁成方形（顶部对齐，头像取上半身）；false = 等比缩到最长边 target
     */
    private static byte[] scale(byte[] raw, int target, boolean square, Bitmap.CompressFormat fmt, int quality) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
            if (o.outWidth <= 0 || o.outHeight <= 0) return null;

            int sample = 1;
            while (Math.min(o.outWidth, o.outHeight) / (sample * 2) >= target) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            Bitmap src = BitmapFactory.decodeByteArray(raw, 0, raw.length, o2);
            if (src == null) return null;

            Bitmap outB;
            if (square) {
                int side = Math.min(src.getWidth(), src.getHeight());
                int x = (src.getWidth() - side) / 2;
                Bitmap sq = Bitmap.createBitmap(src, x, 0, side, side);
                outB = Bitmap.createScaledBitmap(sq, target, target, true);
                if (sq != src && sq != outB) sq.recycle();
            } else {
                int max = Math.max(src.getWidth(), src.getHeight());
                double k = max > target ? (double) target / max : 1.0;
                int w = Math.max(1, (int) Math.round(src.getWidth() * k));
                int h = Math.max(1, (int) Math.round(src.getHeight() * k));
                outB = Bitmap.createScaledBitmap(src, w, h, true);
            }
            if (outB != src) src.recycle();

            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            outB.compress(fmt, quality, bo);
            outB.recycle();
            return bo.toByteArray();
        } catch (Exception e) {
            Log.w(TAG, "图片缩放失败", e);
            return null;
        }
    }

    private static Bitmap.CompressFormat webpFormat() {
        return Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP;
    }

    private static byte[] httpGet(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(30000);
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            return bo.toByteArray();
        } finally {
            conn.disconnect();
        }
    }

    /** 同 {@link #httpGet(String)}，但失败（网络/HTTP 错）返回 null 而不抛。 */
    private static byte[] httpGetQuiet(String url) {
        try { return httpGet(url); } catch (Exception e) { return null; }
    }
}
