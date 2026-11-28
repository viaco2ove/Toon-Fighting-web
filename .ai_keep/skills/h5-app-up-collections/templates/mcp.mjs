// 手机端 MCP 客户端 —— 走 adb forward 打到 APK 内置的 MCP HTTP 服务（默认 7073）。
//
// 服务在 app 进程里（com.viaco.toonfighting），app 没开就连不上：自动 monkey 拉起并等待。
//
// 用法:
//   node mcp.mjs list                                   # tools/list
//   node mcp.mjs call <工具名> ['<JSON 参数>']           # tools/call，如
//         node mcp.mjs call list_installed_packs
//         node mcp.mjs call install_asset_pack '{"source":"/data/local/tmp/x.zip","packId":"x-v1"}'
//         node mcp.mjs call bind_story_session '{"sessionId":"gs_...","packId":"x-v1"}'
// 环境变量: ADB_SERIAL（多设备时指定）、PHONE_HOST（WiFi 直连，如 192.168.1.20，跳过 adb forward）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const PACKAGE = 'com.viaco.toonfighting';
export const PORT = Number(process.env.MCP_PORT || 7073);
export const SERIAL = process.env.ADB_SERIAL || '';

export function adbPath() {
  if (process.env.ADB_PATH) return process.env.ADB_PATH;
  try {
    const lp = fs.readFileSync('android_h5/android/local.properties', 'utf8');
    const m = /^\s*sdk\.dir\s*=\s*(.+)\s*$/m.exec(lp);
    if (m) {
      // Java properties 转义（C\:\\Users\\…）→ 真实路径 → 正斜杠
      const sdk = m[1].trim().replace(/\\(.)/g, '$1').replace(/\\/g, '/');
      const cand = sdk + '/platform-tools/adb.exe';
      if (fs.existsSync(cand)) return cand;
    }
  } catch { }
  return 'adb';
}
const ADB = adbPath();

function adb(args, opts = {}) {
  return execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...args] : args,
    { encoding: 'utf8', timeout: opts.timeout || 30000, stdio: ['ignore', 'pipe', 'pipe'] });
}

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { } };
export function deviceReady() {
  for (let i = 0; i < 3; i++) {
    try {
      const out = adb(['devices']).replace(/\r/g, '').split('\n').filter((l) => /\tdevice$/.test(l));
      if (out.length) return { ok: true, serial: out[0].split('\t')[0] };
    } catch (e) {
      if (i === 2) return { ok: false, why: 'adb 不可用：' + e.message };
    }
    sleepSync(2000);   // adb server 刚重启时设备列表可能瞬时空，稍等重查
  }
  return { ok: false, why: '没有已连接的 adb 设备（adb devices 为空）' };
}

let forwarded = false;
export function baseUrl() {
  if (process.env.PHONE_HOST) return `http://${process.env.PHONE_HOST}:${PORT}`;
  if (!forwarded) {
    adb(['forward', `tcp:${PORT}`, `tcp:${PORT}`]);
    forwarded = true;
  }
  return `http://127.0.0.1:${PORT}`;
}

let rpcId = 0;
async function rpc(method, params, timeoutMs) {
  const res = await fetch(baseUrl() + '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params || {} }),
    signal: AbortSignal.timeout(timeoutMs || 30000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** 确保 app 已启动且 MCP 可达（最多等 waitSec 秒）。 */
export async function ensureApp(waitSec = 45) {
  const t0 = Date.now();
  for (let i = 0; i < Math.ceil(waitSec / 2); i++) {
    try {
      await rpc('ping', {}, 5000);
      return { ok: true, waited: (Date.now() - t0) / 1000 };
    } catch {
      if (i === 0) {
        try { adb(['shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']); } catch { }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { ok: false, why: `app 未响应 MCP（${baseUrl()}），确认 APK 已安装且设置里 MCP 开关未关` };
}

/** tools/call 并解出 result.content[0].text（MCP 工具结果都是 JSON 文本）。 */
export async function callTool(name, args, timeoutMs = 120000) {
  const r = await rpc('tools/call', { name, arguments: args || {} }, timeoutMs);
  if (r.error) throw new Error('MCP 错误：' + JSON.stringify(r.error).slice(0, 200));
  const c = (r.result && r.result.content || []).map((x) => x.text || '').join('');
  const text = c || JSON.stringify(r.result || {});
  let out;
  try { out = JSON.parse(text); } catch { out = text; }
  const isErr = r.result && r.result.isError;
  if (isErr) throw new Error(typeof out === 'string' ? out : JSON.stringify(out));
  return out;
}

// ---------- CLI ----------
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('h5-app-up-collections/templates/mcp.mjs')) {
  const [cmd, tool, argsJson] = process.argv.slice(2);
  const dev = deviceReady();
  if (!dev.ok) { console.error(dev.why); process.exit(1); }
  const app = await ensureApp();
  if (!app.ok) { console.error(app.why); process.exit(1); }
  if (cmd === 'list') {
    const r = await rpc('tools/list');
    for (const t of r.result.tools) console.log(t.name, '——', (t.description || '').split('\n')[0]);
  } else if (cmd === 'call') {
    const out = await callTool(tool, argsJson ? JSON.parse(argsJson) : {});
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
  } else {
    console.error('用法: node mcp.mjs list | call <工具名> [JSON参数]');
    process.exit(1);
  }
}
