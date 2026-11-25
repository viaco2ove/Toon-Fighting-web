// 生成「全替关键帧」变体角色包：
//   <outDir>/<id>.sff   —— 原 sff 全部字节保留 + 追加 10 个带自有彩色调色板的 AI 精灵
//   <outDir>/<id>.air   —— 原 air 的**所有身体帧行**改指向 AI 精灵；特效帧行原样
//   <outDir>/<id>.def   —— 指向新 sff/air
//
// 「全」的定义：每个 action 的每一帧都用该类别的 AI 整帧。
// 效果是「贴纸人物」—— 动作连贯性靠 AI 图本身的姿势承担，不是原动画。
//
// 与旧版 build-ai-char.mjs 的区别（重要）：
//   旧版：sff 只保留 AI 精灵 + helper，**丢弃全部白模身体精灵**，
//         且 AI 精灵放 group 0（会覆盖白模的 0..3 站立循环）。
//         → 特效帧如果引用了白模精灵就会「缺精灵」，引擎报错。
//   本版：白模精灵**一个不少**地保留（AI 精灵追加在文件尾），
//         AI 精灵放空闲 group，特效帧行原样指向原精灵 → 不会缺精灵。
//
// 跑: node .cache/scripts/build-all-char.mjs <baseCharDir> <framesDir> <outDir> <id>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { decodePng, quantize } = require('./sprite-pack.cjs');
const { parseAir, scanFrames, classifyAction, SPRITE_OF } = require('./air-some.cjs');
const { appendSprites, readSffV1Dir } = require('./sff-append.cjs');
// 找项目根（含 server/lib/sff.cjs 的目录）—— 模板可能放在任意层级
function findProjectRoot(start) {
  let d = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, 'server', 'lib', 'sff.cjs'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  throw new Error('找不到项目根（含 server/lib/sff.cjs）');
}
const { loadSff, spriteRgba } = require(path.join(findProjectRoot(__dirname), 'server', 'lib', 'sff.cjs'));

const baseCharDir = process.argv[2];
const framesDir = process.argv[3];
const outDir = process.argv[4];
const id = process.argv[5] || 'AllChar';

fs.mkdirSync(outDir, { recursive: true });

function findFile(d, re) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { const r = findFile(p, re); if (r) return r; }
    else if (re.test(f)) return p;
  }
  return null;
}

// ---------- 1) 读 10 张 AI 图 ----------
const manifestPath = path.join(framesDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { frames: [] };
if (!manifest.frames.length) {
  for (const f of fs.readdirSync(framesDir).filter((x) => x.endsWith('.png')).sort()) {
    const m = /^(\d+)-(\w+)\.png$/.exec(f);
    if (!m) continue;
    if (SPRITE_OF[m[2]] !== undefined) {
      manifest.frames.push({ key: m[2], sprite: SPRITE_OF[m[2]], file: path.join(framesDir, f) });
    }
  }
}
manifest.frames.sort((a, b) => a.sprite - b.sprite);
for (const f of manifest.frames) {
  if (!f.file && f.aiFile) f.file = path.isAbsolute(f.aiFile) ? f.aiFile : path.join(framesDir, f.aiFile);
}
console.log('AI 图：', manifest.frames.length, '张');

// ---------- 2) 原包 ----------
const baseSffPath = findFile(baseCharDir, /\.sff$/i);
const baseAirPath = findFile(baseCharDir, /\.air$/i);
const baseDefPath = findFile(baseCharDir, /\.def$/i);
const baseSffBuf = fs.readFileSync(baseSffPath);
const baseSff = loadSff(baseSffBuf);
const baseAirText = fs.readFileSync(baseAirPath, 'latin1');
const baseDef = fs.readFileSync(baseDefPath, 'latin1');
console.log('底座：', path.basename(baseSffPath));

// AI 图（RGBA 原图）
const aiBySprite = new Map();
for (const fr of manifest.frames) {
  const p = fr.file;
  if (!fs.existsSync(p)) { console.error('缺图：', p); process.exit(1); }
  aiBySprite.set(fr.sprite, decodePng(fs.readFileSync(p)));
}

// ---------- 3) AI 精灵的几何 ----------
// 「全」模式：同一动作内 AI 图尺寸必须稳定（否则人物忽大忽小），
// 所以统一用**该动作的代表帧**（内容高度最大的一帧）作参照。
// 这里取全包最高的身体精灵内容高度作为统一基准 → 动作之间也不跳。
function contentBox(rgba, w, h, thresh = 24) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > thresh) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, cx: (x0 + x1) / 2, bottom: y1 };
}
function fitFrame(rgba, w, h, targetH) {
  const box = contentBox(rgba, w, h);
  if (!box) return { w: targetH, h: targetH, rgba: new Uint8Array(targetH * targetH * 4) };
  const srcW = box.x1 - box.x0 + 1, srcH = box.y1 - box.y0 + 1;
  const scale = targetH / srcH;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const out = new Uint8Array(dstW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = box.y0 + Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const sx = box.x0 + Math.min(srcW - 1, Math.floor(x / scale));
      const so = (sy * w + sx) * 4, dof = (y * dstW + x) * 4;
      out[dof] = rgba[so]; out[dof + 1] = rgba[so + 1];
      out[dof + 2] = rgba[so + 2]; out[dof + 3] = rgba[so + 3];
    }
  }
  return { w: dstW, h: targetH, rgba: out };
}

// 参照帧：manifest 里的 refSprite（白模代表帧），取它的内容高度与锚点关系
function nativeRef(refSprite) {
  if (!refSprite) return null;
  const [g, n] = String(refSprite).split(',').map(Number);
  const sp = baseSff.sprites.get(g + ',' + n);
  if (!sp) return null;
  const img = spriteRgba(baseSffBuf, baseSff, g, n, null);
  if (!img) return null;
  const box = contentBox(img.rgba, img.w, img.h);
  if (!box) return null;
  return { ax: sp.ax, ay: sp.ay, contentH: box.y1 - box.y0 + 1, centerShift: box.cx - sp.ax, footGap: box.bottom - sp.ay };
}

const aiSprites = [];
for (const fr of manifest.frames) {
  const img = aiBySprite.get(fr.sprite);
  const ref = nativeRef(fr.refSprite);
  const targetH = ref ? ref.contentH : Math.round(240 * 0.92);
  const fit = fitFrame(img.rgba, img.w, img.h, targetH);
  const ax = ref ? Math.round(fit.w / 2 + ref.centerShift) : Math.round(fit.w / 2);
  const ay = ref ? Math.min(fit.h, Math.max(1, targetH - ref.footGap)) : fit.h;
  const q = quantize(fit.rgba, fit.w, fit.h, 255);
  aiSprites.push({
    group: 0, index: fr.sprite,          // group 稍后统一改
    w: fit.w, h: fit.h, px: q.px, palette: q.palette,
    ax, ay, key: fr.key, sprite: fr.sprite,
  });
  console.log('  ' + String(fr.key).padEnd(8) + fit.w + 'x' + fit.h + '  axis=' + ax + ',' + ay +
    (ref ? '  (参照 ' + fr.refSprite + ' 内容高 ' + ref.contentH + ')' : '  (无参照)'));
}

// ---------- 4) 分配空闲 group ----------
const AI_GROUP = (() => {
  const dir = readSffV1Dir(baseSffBuf);
  const used = new Set(dir.sprites.map((s) => s.group));
  for (const m of baseAirText.matchAll(/^\s*(\d+)\s*,\s*\d+\s*,/gm)) used.add(+m[1]);
  let run = [];
  for (let g = 6000; g < 6100; g++) {
    if (used.has(g)) { run = []; continue; }
    run.push(g);
    if (run.length >= aiSprites.length) { console.log('AI 精灵 group：', run.join(',')); return run[0]; }
  }
  throw new Error('找不到空闲 group');
})();
for (const sp of aiSprites) { sp.group = AI_GROUP + sp.sprite; sp.index = 0; }

// ---------- 5) 写 sff（追加） ----------
const { buf: newSffBuf } = appendSprites(baseSffBuf, aiSprites);
const newSffPath = path.join(outDir, id + '.sff');
fs.writeFileSync(newSffPath, newSffBuf);
console.log('\n写 sff：', newSffPath, newSffBuf.length, 'bytes · 精灵数',
  readSffV1Dir(newSffBuf).nspr, '（原 ' + baseSffBuf.length + '）');

// ---------- 6) 改写 air：所有身体帧行 → AI 精灵 ----------
const HELPER_GROUP_MIN = 7000;
const acts = parseAir(baseAirText);
const edits = [];
let bodyChanged = 0, effKept = 0;
for (const act of acts) {
  const { cat } = classifyAction(act.id);
  const aiSprite = SPRITE_OF[cat];
  for (const f of scanFrames(act.body)) {
    if (f.g >= HELPER_GROUP_MIN) { effKept++; continue; }   // 特效帧保持原样
    const tail = f.animType !== undefined ? ', ' + f.animType : '';
    const newLine = `${f.lead}${AI_GROUP + aiSprite}, 0, ${f.ox}, ${f.oy}, ${f.t}${tail}`;
    edits.push({ start: act.bodyStart + f.start, end: act.bodyStart + f.end, newLine });
    bodyChanged++;
  }
}
edits.sort((a, b) => b.start - a.start);
let newAirText = baseAirText;
for (const e of edits) newAirText = newAirText.slice(0, e.start) + e.newLine + newAirText.slice(e.end);
const newAirPath = path.join(outDir, id + '.air');
fs.writeFileSync(newAirPath, newAirText, 'latin1');
console.log('写 air：', newAirPath, newAirText.length, 'bytes');
console.log('  身体帧行改写', bodyChanged, '· 特效帧行保持原样', effKept);

// ---------- 7) def ----------
let def = baseDef;
def = def.replace(/^(\s*name\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*displayname\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*sprite\s*=\s*).*$/im, `$1${id}.sff`);
def = def.replace(/^(\s*anim\s*=\s*).*$/im, `$1${id}.air`);
fs.writeFileSync(path.join(outDir, id + '.def'), def, 'latin1');
console.log('写 def：', id + '.def');

// ---------- 8) 复制其余资源 ----------
function copyExcept(src, dst, skip) {
  for (const f of fs.readdirSync(src)) {
    if (skip.includes(f)) continue;
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyExcept(s, d, skip); }
    else fs.copyFileSync(s, d);
  }
}
copyExcept(baseCharDir, outDir, [path.basename(baseSffPath), path.basename(baseAirPath), path.basename(baseDefPath)]);
console.log('已复制其余资源（cns/cmd/snd/act/lee）');