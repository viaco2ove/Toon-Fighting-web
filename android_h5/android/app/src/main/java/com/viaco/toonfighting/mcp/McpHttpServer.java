package com.viaco.toonfighting.mcp;

import android.util.Log;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 手机上的原生 HTTP 服务器 —— 同时提供：
 *
 * <ul>
 *   <li><b>MCP</b>：{@code POST /mcp}（JSON-RPC 2.0）</li>
 *   <li><b>游戏内 API</b>：{@code /api/*} —— 让 APK 里的 webview 能取到
 *       资产集清单、角色名单等（APK 内没有 Node 服务端，webview 的
 *       {@code fetch('/api/assetpacks')} 必须有人应答）</li>
 *   <li><b>静态文件</b>：{@code /} → APK 内的 www/；{@code /packs/*} → 已安装的资产集目录</li>
 * </ul>
 *
 * <p>为什么用裸 Socket 而不用 {@code com.sun.net.httpserver}：
 * minSdk 23 上 HttpServer 可用，但 Android 的实现有已知的 keep-alive /
 * chunked 怪癖；裸 Socket 自己控更稳，量也不大。
 *
 * <p>线程模型：每个连接一个线程（ThreadPool 限制并发），足够本场景。
 */
public class McpHttpServer {

    private static final String TAG = "McpHttp";

    public interface Handler {
        /** @return 响应体（字节）；null 表示 404 */
        Response handle(Request req) throws Exception;
    }

    /** 请求。 */
    public static class Request {
        public String method = "";
        public String path = "";
        public String query = "";
        public String body = "";
        public java.util.Map<String, String> headers = new java.util.HashMap<>();

        public String header(String name) {
            return headers.get(name.toLowerCase());
        }

        public String param(String name) {
            if (query == null || query.isEmpty()) return null;
            for (String kv : query.split("&")) {
                int i = kv.indexOf('=');
                String k = i < 0 ? kv : kv.substring(0, i);
                if (urlDecode(k).equals(name)) {
                    return i < 0 ? "" : urlDecode(kv.substring(i + 1));
                }
            }
            return null;
        }
    }

    /** 响应。 */
    public static class Response {
        public int status = 200;
        public String contentType = "application/json; charset=utf-8";
        public byte[] body = new byte[0];

        public static Response json(String s) {
            Response r = new Response();
            r.body = s.getBytes(StandardCharsets.UTF_8);
            return r;
        }

        public static Response text(String s) {
            Response r = new Response();
            r.contentType = "text/plain; charset=utf-8";
            r.body = s.getBytes(StandardCharsets.UTF_8);
            return r;
        }

        public static Response notFound() {
            Response r = new Response();
            r.status = 404;
            return json("{\"ok\":false,\"error\":\"not found\"}");
        }
    }

    private final int port;
    private final Handler handler;
    private ServerSocket server;
    private Thread acceptThread;
    private ExecutorService pool;
    private volatile boolean running = false;

    public McpHttpServer(int port, Handler handler) {
        this.port = port;
        this.handler = handler;
    }

    public synchronized void start() {
        if (running) return;
        try {
            server = new ServerSocket();
            server.setReuseAddress(true);
            // 绑 0.0.0.0：手机在同一 WiFi 下要能被 PC 上的 agent 访问
            server.bind(new InetSocketAddress((InetAddress) null, port), 64);
        } catch (IOException e) {
            Log.e(TAG, "监听端口 " + port + " 失败", e);
            server = null;
            return;
        }
        running = true;
        pool = Executors.newFixedThreadPool(8);
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "mcp-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        Log.i(TAG, "MCP HTTP 服务已启动，监听 0.0.0.0:" + port);
    }

    public synchronized void stop() {
        if (!running) return;
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        if (pool != null) pool.shutdownNow();
        Log.i(TAG, "MCP HTTP 服务已停止");
    }

    public boolean isRunning() {
        return running;
    }

    public int getPort() {
        return port;
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket sock = server.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handleConn(sock);
                    }
                });
            } catch (IOException e) {
                if (running) Log.w(TAG, "accept 失败", e);
                return;
            }
        }
    }

    private void handleConn(Socket sock) {
        try {
            sock.setSoTimeout(30000);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();

            // ---- 读请求头 ----
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            Request req = new Request();
            req.method = parts.length > 0 ? parts[0] : "GET";
            String full = parts.length > 1 ? parts[1] : "/";
            int q = full.indexOf('?');
            req.path = q >= 0 ? full.substring(0, q) : full;
            req.query = q >= 0 ? full.substring(q + 1) : "";

            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0) {
                    req.headers.put(line.substring(0, c).trim().toLowerCase(), line.substring(c + 1).trim());
                }
            }

            // ---- 读请求体 ----
            String cl = req.header("content-length");
            if (cl != null) {
                int n = Integer.parseInt(cl.trim());
                if (n > 0) req.body = readN(in, n);
            }

            // ---- 处理 ----
            Response resp;
            try {
                resp = handler.handle(req);
            } catch (Exception e) {
                Log.e(TAG, "处理请求失败 " + req.path, e);
                resp = new Response();
                resp.status = 500;
                resp.body = ("{\"ok\":false,\"error\":\"" + escape(String.valueOf(e.getMessage())) + "\"}")
                        .getBytes(StandardCharsets.UTF_8);
            }
            if (resp == null) resp = Response.notFound();

            // ---- 写响应 ----
            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(resp.status).append(' ').append(statusText(resp.status)).append("\r\n");
            head.append("Content-Type: ").append(resp.contentType).append("\r\n");
            head.append("Content-Length: ").append(resp.body.length).append("\r\n");
            head.append("Access-Control-Allow-Origin: *\r\n");
            head.append("Access-Control-Allow-Headers: Content-Type, Authorization, Mcp-Session-Id\r\n");
            head.append("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n");
            head.append("Connection: close\r\n\r\n");
            out.write(head.toString().getBytes(StandardCharsets.UTF_8));
            out.write(resp.body);
            out.flush();
        } catch (Exception e) {
            Log.w(TAG, "连接处理异常", e);
        } finally {
            try { sock.close(); } catch (IOException ignored) { }
        }
    }

    private static String statusText(int s) {
        switch (s) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 500: return "Internal Server Error";
            default: return "OK";
        }
    }

    private static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int c;
        boolean any = false;
        while ((c = in.read()) >= 0) {
            any = true;
            if (c == '\n') break;
            if (c != '\r') buf.write(c);
        }
        if (!any && buf.size() == 0) return null;
        return buf.toString("UTF-8");
    }

    private static String readN(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int read = 0;
        while (read < n) {
            int r = in.read(b, read, n - read);
            if (r < 0) break;
            read += r;
        }
        return new String(b, 0, read, StandardCharsets.UTF_8);
    }

    public static String urlDecode(String s) {
        if (s == null) return null;
        try {
            return java.net.URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}
