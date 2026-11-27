// 生成「融合关键帧」变体角色包：
//   <outDir>/<id>.sff   —— 原 sff 全部字节保留 + 追加「AI 图 ⊕ 原精灵」合成精灵
//   <outDir>/<id>.air   —— 原 air 的身体帧行改指向合成精灵；**特效帧保持原样**
//   <outDir>/<id>.def   —— 指向新 sff/air
//
// 「融」的定义（对应 ff-studio 查看器的 merge 模式）：
//   AI 整帧与原精灵**一起显示** —— AI 图半透明叠在原精灵上，
//   两者的姿势、明暗、配色都能看出来。
//   **特效帧等本来就没有人像的不融合** —— 特效精灵（group ≥ 7000）
//   直接引用原精灵，融了只是把爆炸/飞行道具涂花。
//
// 为什么必须烘焙（bake）：
//   MUGEN 的 air 帧行一次只能画一个精灵，没有「两精灵叠加」的表达力。
//   所以「AI + 原精灵一起显示」只能在构建期合成为一张图。
//
// 同一精灵可能出现在不同类别的 action 里 → 每个 (精灵, 类别) 组合
// 各生成一张合成精灵（804 个），air 按所属 action 的类别改指向。
//
// 跑: node build-merge-char.mjs <baseCharDir> <framesDir> <outDir> <id> [mergeAlpha] [bodyAlpha] [mode]
//
// mode（两种互斥的透明度语义）：
//   alpha  （默认）虚化模式：原帧 100% 不做透明处理，只把 AI 权重混进 RGB
//                     → mask 不动，无挖空、无碎片、边缘干净
//   binary          二值模式：原帧可调不透明度；bodyAlpha<1 时 body-only 像素
//                     走 4×4 Bayer 抖动 → 方块小碎片
// 不传时按 bodyAlpha 自动选（<1 → binary，否则 alpha），与历史行为一致。
//
// 环境变量（底座目录里文件名不唯一时必须显式指定，避免选错）：
//   BASE_SFF / BASE_AIR / BASE_DEF —— 显式指定底座的 sff / air / def 文件名
//
// 例（苏晚晴 KFM，二值碎片模式，与线上包一致）：
//   BASE_SFF=Athena-98.sff BASE_AIR=Athena-98.air BASE_DEF=98Athena.def \
//   node build-merge-char.mjs ff-studio/white-mold/04_异能者/98Athena \
//        .cache/ai-frames/苏晚晴 .cache/mg-build/SuWanqingKFM SuWanqingKFM 0.95 0.2 binary
//
// 例（同上，但走虚化模式 —— 无碎片）：
//   ... SuWanqingKFM 0.55 1 alpha
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { decodePng, quantize } = require('./sprite-pack.cjs');
// 两种透明度语义是独立脚本：
//   merge-alpha.cjs  虚化模式（原帧 100%，只混 RGB，mask 不动）
//   merge-binary.cjs 二值模式（原帧可调不透明度，bodyAlpha<1 → Bayer 抖动碎片）
const { mergeAlpha, MERGE_ALPHA } = require('./merge-alpha.cjs');
const { mergeBinary, MERGE_BODY_ALPHA } = require('./merge-binary.cjs');
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
const { loadSff, spriteRgba, readPaletteFile } = require(path.join(findProjectRoot(__dirname), 'server', 'lib', 'sff.cjs'));

const baseCharDir = process.argv[2];
const framesDir = process.argv[3];
const outDir = process.argv[4];
const id = process.argv[5] || 'MergeChar';
const alphaArg = Number(process.argv[6]);
const ALPHA = Number.isFinite(alphaArg) && alphaArg > 0 ? alphaArg : MERGE_ALPHA;
// 第 7 个参数：原精灵不透明度（默认 1，即旧行为）
const bodyArg = Number(process.argv[7]);
const BODY_ALPHA = Number.isFinite(bodyArg) && bodyArg > 0 && bodyArg <= 1 ? bodyArg : MERGE_BODY_ALPHA;
// 第 8 个参数：融合模式
//   alpha（默认）= 虚化模式：原帧 100%，只把 AI 权重乘进 RGB，mask 不动
//   binary        = 二值模式：原帧可调不透明度，bodyAlpha<1 时 body-only
//                   像素走 4×4 Bayer 抖动 → 方块小碎片
// 不传时按 bodyAlpha 自动选（<1 → binary，否则 alpha），与历史行为一致。
const modeArg = (process.argv[8] || '').toLowerCase();
const MODE = ['alpha', 'binary'].includes(modeArg)
  ? modeArg
  : (BODY_ALPHA < 1 ? 'binary' : 'alpha');

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
    const cat = SPRITE_OF[m[2]] !== undefined ? m[2] : null;
    if (cat) manifest.frames.push({ key: cat, sprite: SPRITE_OF[cat], file: path.join(framesDir, f) });
  }
}
manifest.frames.sort((a, b) => a.sprite - b.sprite);
for (const f of manifest.frames) {
  if (!f.file && f.aiFile) f.file = path.isAbsolute(f.aiFile) ? f.aiFile : path.join(framesDir, f.aiFile);
}
console.log('AI 图：', manifest.frames.length, '张 · 融合模式', MODE, '· AI 权重', ALPHA, '/ 原', BODY_ALPHA);
  console.log('  （alpha=虚化：原帧 100% 不做透明处理，只混 RGB；binary=二值：原帧 <1 走 Bayer 抖动 → 碎片）');

// ---------- 2) 原包 ----------
// 显式文件名优先（环境变量），避免目录里有多个 def/sff 时 findFile 按字母序选错。
// 例：RalfAct 目录有 RalfAct.def（正确）和 ikari.def（无 sprite/anim 行）。
const pick = (envName, re) => {
  const name = process.env[envName];
  if (name) {
    const p = path.join(baseCharDir, name);
    if (fs.existsSync(p)) return p;
    console.warn(`${envName}=${name} 不存在，回退搜索`);
  }
  return findFile(baseCharDir, re);
};
const baseSffPath = pick('BASE_SFF', /\.sff$/i);
const baseAirPath = pick('BASE_AIR', /\.air$/i);
const baseDefPath = pick('BASE_DEF', /\.def$/i);
const baseSffBuf = fs.readFileSync(baseSffPath);
const baseSff = loadSff(baseSffBuf);
const baseAirText = fs.readFileSync(baseAirPath, 'latin1');
const baseDef = fs.readFileSync(baseDefPath, 'latin1');
console.log('底座：', path.basename(baseSffPath));

// 角色默认调色板（def 的 pal1）。引擎对局里普通精灵吃的是这个 .act，
// 不是 sff 内嵌调色板 —— 融合图必须按「玩家实际看到的颜色」烘，
// 否则会拿解码器猜出来的内嵌色（Lin.sff 的 0,1/0,2/0,3 会读到假 0x0C 的垃圾调色板）。
const ACT_PAL = (() => {
  const m = /^[ \t]*pal1[ \t]*=[ \t]*(.+)$/im.exec(baseDef);
  if (!m) return null;
  const rel = m[1].trim().replace(/\\/g, '/');
  const p = path.join(baseCharDir, rel);
  try { return readPaletteFile(fs.readFileSync(p)); } catch { return null; }
})();
console.log('角色调色板 pal1：', ACT_PAL ? '已加载' : '缺（退回精灵内嵌调色板）');

// AI 图（RGBA 原图）
const aiBySprite = new Map();
for (const fr of manifest.frames) {
  const p = fr.file;
  if (!fs.existsSync(p)) { console.error('缺图：', p); process.exit(1); }
  aiBySprite.set(fr.sprite, decodePng(fs.readFileSync(p)));
}

// ---------- 3) 逐 action 决定每帧是「融合」还是「保持原样」 ----------
// 特效判定：原包 group ≥ 7000 视为 helper/特效段。
// 注意合成精灵区会扩到 20000，不能单纯用 g>=7000 判定——
// 改从原包 air 里收集「实际用到的 ≥7000 group」，只对原包 group 生效。
const HELPER_GROUP_MIN = 7000;
const acts = parseAir(baseAirText);
const effectGroups = new Set();
for (const a of acts) for (const f of scanFrames(a.body)) {
  if (f.g >= HELPER_GROUP_MIN) effectGroups.add(f.g);
}

// (精灵, 类别) → 该组合需要一张合成精灵
const needMerge = new Map();   // "g,n|cat" → {g,n,cat}
const framePlan = [];          // 每个 action 的帧行决定
for (const a of acts) {
  const frames = scanFrames(a.body);
  const { cat } = classifyAction(a.id);
  const plan = [];
  for (const f of frames) {
    const isEffect = effectGroups.has(f.g);
    if (isEffect) { plan.push({ ...f, merge: false }); continue; }
    const key = f.g + ',' + f.n + '|' + cat;
    needMerge.set(key, { g: f.g, n: f.n, cat });
    plan.push({ ...f, merge: true, key });
  }
  framePlan.push({ act: a, plan });
}
console.log('\n融合判定：');
console.log('  身体帧行 → 合成', framePlan.reduce((n, p) => n + p.plan.filter((x) => x.merge).length, 0));
console.log('  特效帧行 → 保持原样', framePlan.reduce((n, p) => n + p.plan.filter((x) => !x.merge).length, 0));
console.log('  需要合成精灵', needMerge.size, '张（每个「精灵×类别」组合一张）');

// ---------- 4) 分配新 group ----------
const AI_GROUP = (() => {
  const dir = readSffV1Dir(baseSffBuf);
  const used = new Set(dir.sprites.map((s) => s.group));
  for (const m of baseAirText.matchAll(/^\s*(\d+)\s*,\s*\d+\s*,/gm)) used.add(+m[1]);
  // 合成精灵数量可能上千 → 需要连续多个 group
  const need = needMerge.size;
  let run = [];
  // group 是 u16；6100..7000 放不下上千张合成精灵时扩到 20000
  // （底座实际 group 一般 <3000，扩区不会撞原包）
  for (let g = 6100; g < 20000; g++) {
    if (used.has(g)) { run = []; continue; }
    run.push(g);
    if (run.length >= need) { console.log('合成精灵 group：', run[0], '..', run[run.length - 1]); return run[0]; }
  }
  throw new Error('找不到足够的空闲 group 放合成精灵');
})();

// ---------- 5) 逐个生成合成精灵 ----------
const mergeCache = new Map();   // key → {group,index}
const toAppend = [];
let idx = 0;
const stats = { ok: 0, fail: 0, pxTotal: 0 };
// 精灵解码：处理「共享块」（size=0，靠 link 指向别的精灵）。
// 项目解码器 server/lib/sff.cjs 的 spriteRgba 只解 v2 的共享块，
// v1 的共享块（Lin.sff 里有 45 个）要自己解引用。
const dir1 = readSffV1Dir(baseSffBuf);
const byIdx = dir1.sprites;
const byKey1 = new Map();
for (const sp of byIdx) byKey1.set(sp.group + ',' + sp.index, sp);
function resolveSprite(g, n) {
  let sp = byKey1.get(g + ',' + n);
  let hops = 0;
  while (sp && sp.size === 0 && hops < 64) {
    sp = byIdx[sp.link];
    hops++;
  }
  return sp || null;
}

for (const [key, spec] of needMerge) {
  const sp = resolveSprite(spec.g, spec.n);
  if (!sp) { stats.fail++; stats.missing = (stats.missing || 0) + 1; continue; }
  // 共享块（size=0）本身没有像素 → 要解它 link 指向的那个精灵。
  // 但**锚点用共享块自己的**（轴点可能与被链接者不同）。
  const tgtG = sp.group, tgtN = sp.index;
  let body = null;
  // 自带调色板的精灵（ps==0，如 AI 精灵）用自己那块调色板；
  // 其余（ps!=0，白模素体）用 def 的 pal1 —— 与引擎对局渲染、/api/anim 同一口径。
  const ownPal = !!(baseSff.sprites.get(tgtG + ',' + tgtN) || {}).ownPal;
  try { body = spriteRgba(baseSffBuf, baseSff, tgtG, tgtN, ownPal ? null : ACT_PAL); } catch { body = null; }
  if (!body) { stats.fail++; stats.decodeFail = (stats.decodeFail || 0) + 1; continue; }
  body.ax = sp.ax; body.ay = sp.ay;
  const ai = aiBySprite.get(SPRITE_OF[spec.cat]);
  if (!ai) { stats.fail++; continue; }
  const merged = MODE === 'binary'
    ? mergeBinary(body, ai, ALPHA, BODY_ALPHA, true)
    : mergeAlpha(body, ai, ALPHA, BODY_ALPHA);
  if (!merged) {
    // 原精灵全透明（白模包里的废区精灵）→ 没有可融合的东西，保持原样
    stats.fail++; stats.blank = (stats.blank || 0) + 1; continue;
  }
  // 每张合成精灵自带 256 色调色板（ps=0）
  const q = quantize(merged.rgba, merged.w, merged.h, 255);
  toAppend.push({
    group: AI_GROUP + idx, index: 0,
    w: merged.w, h: merged.h, px: q.px, palette: q.palette,
    ax: merged.ax, ay: merged.ay,
  });
  mergeCache.set(key, { group: AI_GROUP + idx, index: 0 });
  stats.pxTotal += merged.w * merged.h;
  idx++;
}
console.log('合成精灵：成功', stats.ok = toAppend.length, '跳过', stats.fail,
  '（空废区', stats.blank || 0, '· 共享块解引用失败', stats.decodeFail || 0, '· 精灵不存在', stats.missing || 0, '）');
console.log('  总像素', stats.pxTotal, '· 估算 sff 增量', Math.round(stats.pxTotal * 1.05 / 1024), 'KB');

// ---------- 6) 写 sff ----------
const { buf: newSffBuf } = appendSprites(baseSffBuf, toAppend);
const newSffPath = path.join(outDir, id + '.sff');
fs.writeFileSync(newSffPath, newSffBuf);
console.log('\n写 sff：', newSffPath, newSffBuf.length, 'bytes（', (newSffBuf.length / 1048576).toFixed(2), 'MB）');

// ---------- 7) 改写 air ----------
// 身体帧行 → 指向合成精灵；特效帧行 → 原样
// 用原位替换（只动被改的帧行），保证 CRLF / Clsn / 注释一字不动
const edits = [];
for (const { act, plan } of framePlan) {
  for (const p of plan) {
    if (!p.merge) continue;
    const m = mergeCache.get(p.key);
    if (!m) continue;
    const tail = p.animType !== undefined ? ', ' + p.animType : '';
    const newLine = `${p.lead}${m.group}, ${m.index}, ${p.ox}, ${p.oy}, ${p.t}${tail}`;
    edits.push({ start: act.bodyStart + p.start, end: act.bodyStart + p.end, newLine });
  }
}
edits.sort((a, b) => b.start - a.start);
let newAirText = baseAirText;
for (const e of edits) newAirText = newAirText.slice(0, e.start) + e.newLine + newAirText.slice(e.end);
const newAirPath = path.join(outDir, id + '.air');
fs.writeFileSync(newAirPath, newAirText, 'latin1');
console.log('写 air：', newAirPath, newAirText.length, 'bytes · 改写帧行', edits.length);

// ---------- 8) def ----------
const oldBase = path.basename(baseDefPath).replace(/\.def$/i, '');
let def = baseDef;
def = def.replace(/^(\s*name\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*displayname\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*sprite\s*=\s*).*$/im, `$1${id}.sff`);
def = def.replace(/^(\s*anim\s*=\s*).*$/im, `$1${id}.air`);
fs.writeFileSync(path.join(outDir, id + '.def'), def, 'latin1');
console.log('写 def：', id + '.def');

// ---------- 9) 复制其余资源 ----------
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