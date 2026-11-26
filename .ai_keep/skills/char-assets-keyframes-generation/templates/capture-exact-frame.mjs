// 在**精确的引擎帧号**上抓图，消除动画相位噪声。
// 用途：判定「精灵是否被引擎丢弃」—— 引擎对尺寸不符的精灵是静默丢弃的，
// 不打任何日志，只能靠同相位帧的像素差异来判定。
//
// 用法: node capture-exact-frame.mjs <outFile> <cdpPort> <serverPort> <p1> <p2> <frameNo> [pack]
//
// 依赖 ws：先 `npm i ws`，或用环境变量 WS_PATH 指向它。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
function loadWs() {
  for (const c of [process.env.WS_PATH, 'ws', path.resolve(__dirname, '../../../node_modules/ws')].filter(Boolean)) {
    try { return require(c); } catch { /* 试下一个 */ }
  }
  console.error('找不到 ws。先 `npm i ws`，或设环境变量 WS_PATH 指向它。');
  process.exit(2);
}
const WebSocket = loadWs();
const outFile = process.argv[2];
const PORT = Number(process.argv[3] || 9399);
const serverPort = Number(process.argv[4] || 8100);
const p1 = process.argv[5];
const p2 = process.argv[6] || p1;
const targetFrame = Number(process.argv[7] || 90);
const pack = process.argv[8] || 'moshi-v1';
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let seq = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.on('open', r));
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${serverPort}/index.html?pack=${pack}&auto=1&ai=0&p1=${encodeURIComponent(p1)}&p2=${encodeURIComponent(p2)}` });
await sleep(1500);

// 等到精确帧号
let hit = false;
for (let i = 0; i < 600; i++) {
  await sleep(50);
  const f = Number(await ev('window.__ikemenEngineFrames || 0')) || 0;
  if (f >= targetFrame) { hit = true; break; }
}
const f = await ev('window.__ikemenEngineFrames || 0');
console.log('抓图时引擎帧号', f, hit ? '(已达到目标)' : '(超时)');
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(outFile, Buffer.from(r.result.data, 'base64'));
console.log('已存', outFile);
process.exit(0);