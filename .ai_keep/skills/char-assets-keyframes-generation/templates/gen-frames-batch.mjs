// 批量生成故事角色的 10 类 AI 整帧关键帧（直连后端，绕 BFF 15s 超时）
//   · 参考图 = refs/<角色>/avatar/{full.png, head.png}（fetch-avatars.mjs 产出）
//   · 形象提示词 = personas.json[name].persona（必须对照 avatar 参考图写，缺了形象必跑偏）
//   · 直返图通常自带 alpha（抠白 0%），脚本保留四角 BFS 抠白兜底
//   · 已有文件自动跳过（断点续跑）；manifest 落 .cache/ai-frames/<角色>/
// 跑: node gen-frames-batch.mjs <personas.json> <refsDir> [角色名,角色名,...]
// 例: node gen-frames-batch.mjs .cache/ai-frames/_sheye/personas.json .cache/role-refs-sheye
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH
  || 'D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/node_modules/sharp');

const [personasPath, refsDir, onlyArg] = process.argv.slice(2);
if (!personasPath || !refsDir) {
  console.error('用法: node gen-frames-batch.mjs <personas.json> <refsDir> [角色名,...]');
  process.exit(1);
}
const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
const only = onlyArg ? onlyArg.split(',') : null;
const names = Object.keys(personas).filter((n) => !only || only.includes(n));

// ---------- 登录（.env） ----------
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
  ['stand', '站桩'], ['walk', '行走'], ['turn', '转身'], ['light', '轻拳'],
  ['heavy', '重拳'], ['special', '特殊技'], ['hurt', '受击'], ['down', '倒地'],
  ['air', '空中'], ['guard', '防御'],
];

// 白底四角 BFS 泛洪抠白（直返带 alpha 时抠 0%，仅兜底）
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
  for (let i = 0; i < w * h; i++) if (visited[i]) data[i * ch + 3] = 0;
  return { buf: Buffer.from(data), w, h, ch };
}
const du = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

for (const name of names) {
  const cfg = personas[name];
  const refDir = path.join(refsDir, name, 'avatar');
  const full = path.join(refDir, 'full.png'), head = path.join(refDir, 'head.png');
  if (!fs.existsSync(full) || !fs.existsSync(head)) { console.warn(`[${name}] 缺参考图（先跑 fetch-avatars.mjs）`); continue; }
  const outDir = path.join('.cache/ai-frames', name);
  fs.mkdirSync(outDir, { recursive: true });
  const refImages = [du(full), du(head)];
  const fail = [];
  for (let i = 0; i < CATS.length; i++) {
    const [key, label] = CATS[i];
    const file = path.join(outDir, String(i).padStart(2, '0') + '-' + key + '.png');
    if (fs.existsSync(file)) continue;
    process.stdout.write(`[${name}] ${label} … `);
    const t0 = Date.now();
    try {
      const ar = await fetch(BACKEND + '/plugin/agentRun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          agentName: 'field-survival-sprite-gener',
          input: { prompt: `${cfg.persona}. Pose: ${PROMPTS[key]}`, systemPrompt: SYSTEM, style: STYLE, refImages, size: '1K', aspectRatio: '2:3' },
        }),
        signal: AbortSignal.timeout(300000),
      });
      const jr = JSON.parse(await ar.text());
      const r = (jr && jr.data) ? jr.data : jr;
      if (!r.ok || !(r.output && r.output.image)) { console.log('失败：', (r.error || '无图').slice(0, 100)); fail.push(key); continue; }
      const png = Buffer.from(String(r.output.image).replace(/^data:image\/png;base64,/, ''), 'base64');
      const ko = await knockOutWhite(png);
      const out = await sharp(ko.buf, { raw: { width: ko.w, height: ko.h, channels: ko.ch } }).png().toBuffer();
      fs.writeFileSync(file, out);
      console.log('OK', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    } catch (e) { console.log('异常：', e.message.slice(0, 100)); fail.push(key); }
  }
  const frames = CATS.map(([key, label], i) => ({
    key, label, sprite: i, aiFile: String(i).padStart(2, '0') + '-' + key + '.png',
  })).filter((f) => fs.existsSync(path.join(outDir, f.aiFile)));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    charId: cfg.id, displayName: name, character: cfg.profession,
    baseDesc: cfg.persona, style: STYLE,
    refBase: cfg.base, mergeMode: cfg.mode, skillCount: cfg.skillCount,
    generatedAt: new Date().toISOString(), frames,
  }, null, 2));
  console.log(`[${name}] ${frames.length}/10 就绪${fail.length ? '，失败：' + fail.join(',') : ''}\n`);
}
console.log('全部完成');
