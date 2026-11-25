// white-mold-conversion 模板 —— CDP 引擎实测探针
// 用法: node verify-char.mjs <outDir> <cdpPort>
// 前置: 8100 跑着 serve.cjs；`node .cache/tmp-launch.mjs <cdpPort>` 已起测试 Edge
// 断言: 引擎起帧 → 无 missing sprite / cns 错误 → facebar 出现该角色 → 无 JS 异常 → 截图
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('file:///D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/');
const WebSocket = require('ws');

const outDir = process.argv[2] || '.cache/shots-char';
const PORT = Number(process.argv[3] || 9411);
// {{CHAR_ID}}: 白模角色 ASCII id；{{CONTROL_ID}}: 彩色对照角色 id（同台位对比用）
const CHAR_ID = process.argv[4] || '{{CHAR_ID}}';
const CONTROL_ID = process.argv[5] || '{{CONTROL_ID}}';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
console.log('TARGET', page?.url);

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let seq = 0;
const pending = new Map();
const errors = [];
const logs = [];
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + String(m.params.exceptionDetails.exception?.value || m.params.exceptionDetails.text).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled') {
    const s = (m.params.args || []).map((a) => a.value || '').join('');
    if (s) logs.push(s);
  }
});
await new Promise((r) => ws.on('open', r));
const send = (method, params = {}) => Promise.race([
  new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }),
  sleep(15000).then(() => null),
]);
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }))?.result?.result?.value;
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r?.result?.data) return console.log('SHOT FAIL', name);
  const p = path.join(outDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('SHOT', name, fs.statSync(p).size);
};
const ok = (name, cond, extra) => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''));

await send('Runtime.enable');
await send('Page.enable');

// 直启对局：白模 P1 vs 彩色对照 P2，AI 4 级互打
await send('Page.navigate', { url: `http://localhost:8100/?auto=1&p1=${CHAR_ID}&p2=${CONTROL_ID}&ai=4` });
let frames = 0;
for (let i = 0; i < 25; i++) {
  await sleep(2000);
  frames = await ev(`window.__ikemenEngineFrames || 0`) || 0;
  if (frames > 200) break;
}
ok('engine-running', frames > 200, { frames });

// 引擎 console 扫描：missing sprite / cns 编译错误
// （"Executable not implemented for js" 是引擎在 js 环境的无害噪音，不算错）
const all = logs.join('\n');
ok('no-missing-sprite', !/missing sprite/i.test(all), all.match(/.{0,80}missing sprite.{0,80}/i)?.[0] || '');
const cnsErr = /invalid state controller|error compiling|statedef.*error/i.test(all);
ok('no-cns-error', !cnsErr, all.match(/.{0,120}(invalid|compiling).{0,120}/i)?.[0] || '');

// facebar / HUD 出现角色
const state = await ev(`({
  facebar: document.getElementById('facebar').classList.contains('on'),
  faceText: document.getElementById('facebar').textContent.replace(/\\s+/g,' ').slice(0,120),
  hud: document.getElementById('hud').textContent.replace(/\\s+/g,' ').slice(0,140),
})`);
ok('facebar-on', !!state.facebar, state);
ok('char-in-match', new RegExp(CHAR_ID, 'i').test(state.hud || ''), state.hud);
await shot('v1-battle.png');

// 打几拳确认状态机活着，再截一张
for (let i = 0; i < 6; i++) {
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z'}))`);
  await sleep(120);
  await ev(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'z'}))`);
  await sleep(400);
}
await sleep(600);
ok('no-js-exception', errors.length === 0, errors.slice(0, 3));
await shot('v2-attack.png');

console.log('LOGS_TAIL', JSON.stringify(logs.slice(-6)));
process.exit(0);
