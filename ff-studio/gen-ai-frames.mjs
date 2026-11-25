// AI 整帧关键帧批量生成 v3：直连后端（绕 BFF 15s 超时）+ 参考图 + 白底抠图
//
// 跑: node .cache/scripts/gen-ai-frames3.mjs <outDir> [only类别,逗号分隔]
// 例: node .cache/scripts/gen-ai-frames3.mjs .cache/ai-frames/linyu-v2
//     node .cache/scripts/gen-ai-frames3.mjs .cache/ai-frames/linyu-v2 light,heavy
//
// 要点：
//   - refImages=[full.png, head.png] → 形象对齐角色设定（v1 只用泛化提示词，形象全跑偏）
//   - 生图模型不给 alpha（白底），四角 BFS 泛洪抠白 → 透明底（角色内白色不被误伤）
//   - 后端 agentRun 直连（登录一次），BFF /api/conn/agent/generate 的 bf() 15s 超时
//     扛不住参考图生图的 17~150s，绕开
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/node_modules/sharp');

const outDir = process.argv[2] || '.cache/ai-frames/linyu-v2';
const only = process.argv[3] ? process.argv[3].split(',') : null;
// 角色来源：FRAME_CHAR_DIR 指向含 avatar/full.png + head.png 的目录；
// FRAME_PERSONA 是该角色的英文外貌描述（不设则沿用 LinYu v2 的兜底）。
const CHAR = path.resolve(process.env.FRAME_CHAR_DIR
  || 'workshops/toon-fighting-web/map_design/末世选择，从解析神明开始成神/chars/LinYu');

// ---------- 登录一次 ----------
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BACKEND = String(env.game_app_service_url || '').replace(/\/+$/, '');
const lr = await fetch(BACKEND + '/other/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: env.user_name, password: env.user_psw }),
});
const lj = await lr.json();
const token = String((lj.data || lj).token || '').replace(/^Bearer\s+/i, '');
if (!token) throw new Error('后端登录失败');

// ---------- 参考图 ----------
const du = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const refImages = [
  du(path.join(CHAR, 'avatar/full.png')),
  du(path.join(CHAR, 'avatar/head.png')),
];

const PERSONA = process.env.FRAME_PERSONA
  || 'the same young man as in the reference images: short messy black hair, black hoodie, black cargo pants, black combat boots, lean build';
const PROMPTS = {
  stand:   'standing idle pose, arms relaxed, facing right, full body visible from head to toe',
  walk:    'walking forward, one leg forward, facing right, full body visible',
  turn:    'turning around, body twisted, facing left, full body visible',
  light:   'throwing a quick straight punch with the right fist, facing right, full body visible',
  heavy:   'delivering a high roundhouse kick, facing right, full body visible',
  special: 'channeling energy, both hands forward releasing a glowing energy blast, facing right, full body visible',
  hurt:    'recoiling from a hit, head snapped back, staggered, facing right, full body visible',
  down:    'lying on the ground knocked out, collapsed sideways, full body visible',
  air:     'jumping in mid air, knees tucked, facing right, full body visible',
  guard:   'blocking with both arms raised defensively, facing right, full body visible',
};
const STYLE = 'side-view fighting game sprite, thick outlines, flat colors';
const SYSTEM = 'Generate ONE full-body fighting game sprite of the EXACT same character as the reference images (same hairstyle, same outfit, same colors). Transparent background only, no ground, no shadow, no props, no text. The whole character centered, facing right.';

const CATS = [
  ['stand', '站桩'], ['walk', '行走/移动'], ['turn', '转身'], ['light', '轻拳'],
  ['heavy', '重拳/踢'], ['special', '特殊技'], ['hurt', '受击'], ['down', '倒地'],
  ['air', '空中'], ['guard', '防御/胜利'],
];

// ---------- 白底抠图：四角 BFS 泛洪，容差内白色连通区 → 透明 ----------
async function knockOutWhite(pngBuf) {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const idx = (x, y) => (y * w + x) * ch;
  const isBgish = (i) => data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225;
  const visited = new Uint8Array(w * h);
  const queue = [];
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const i = idx(x, y);
    if (isBgish(i)) { visited[y * w + x] = 1; queue.push([x, y]); }
  }
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (visited[ny * w + nx]) continue;
      const i = idx(nx, ny);
      if (!isBgish(i)) continue;
      visited[ny * w + nx] = 1; queue.push([nx, ny]);
    }
  }
  let cut = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!visited[y * w + x]) continue;
      const i = idx(x, y);
      data[i + 3] = 0; cut++;
    }
  }
  console.log('    抠掉背景像素', cut, '/', w * h, '(' + ((cut / (w * h)) * 100).toFixed(1) + '%)');
  return { buf: Buffer.from(data), w, h, ch };
}

fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < CATS.length; i++) {
  const [key, label] = CATS[i];
  if (only && !only.includes(key)) continue;
  const file = path.join(outDir, String(i).padStart(2, '0') + '-' + key + '.png');
  if (fs.existsSync(file)) { console.log('已存在，跳过：', path.basename(file)); continue; }
  const prompt = `${PERSONA}. Pose: ${PROMPTS[key]}`;
  process.stdout.write(`生成 ${label.padEnd(6, '　')} … `);
  const t0 = Date.now();
  try {
    const ar = await fetch(BACKEND + '/plugin/agentRun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        agentName: 'field-survival-sprite-gener',
        input: { prompt, systemPrompt: SYSTEM, style: STYLE, refImages, size: '1K', aspectRatio: '2:3' },
      }),
      signal: AbortSignal.timeout(300000),
    });
    const jr = JSON.parse(await ar.text());
    const r = (jr && jr.data) ? jr.data : jr;
    if (!r.ok || !(r.output && r.output.image)) { console.log('失败：', r.error || '无图'); continue; }
    const b64 = String(r.output.image).replace(/^data:image\/png;base64,/, '');
    const png = Buffer.from(b64, 'base64');
    const ko = await knockOutWhite(png);
    const out = await sharp(ko.buf, { raw: { width: ko.w, height: ko.h, channels: ko.ch } })
      .png().toBuffer();
    fs.writeFileSync(file, out);
    console.log('OK', ((Date.now() - t0) / 1000).toFixed(1) + 's', out.length + 'B');
  } catch (e) {
    console.log('异常：', e.message);
  }
}
console.log('完成 →', outDir);
