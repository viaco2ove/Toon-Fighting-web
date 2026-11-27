// SFF v2 融合包写出器（真逐像素 alpha，泛化版）
//
// 把「v1 白模底座 + 10 张 AI 整帧」组装成 SFF v2 融合包：
//   · 所有精灵转 format 11（PNG RGBA）——原精灵实心（引擎口径解色），合成精灵带真 alpha
//   · 两种 body-only 模式（第 5 参数）：
//       alpha  二值虚化：body 整层真半透明（α=bodyAlpha），无点阵无暗影
//       binary Bayer 碎片：body-only 区按 4×4 Bayer（2×2 像素块判定）保留约 bodyAlpha
//              密度的**原色实心点**（α=1），其余完全透明；重叠区 body 按相对权重混在 AI 下
//   · 合成公式（预乘 alpha，配引擎 BlendOne+OneMinusSrcAlpha fast path）：
//         aAI = AI.a × aiAlpha；aBody = body.a × bodyAlpha
//         pre.rgb = AI.rgb×aAI + body.rgb×aBody×(1−aAI)      （预乘）
//         out.a   = aAI + aBody×(1−aAI)                       （标准 over）
//       body-only → a=bodyAlpha；AI-only → a=aiAlpha；重叠区 → over 结果
//   · AI 缩放用 sharp lanczos3（内容盒逐行紧凑裁剪——raw 输入不支持行跨距，直接
//     Buffer.from(buffer, offset, aH*aw*4) 会越界行错位，AI 人形被稀释到消失）
//   · 特效帧不融合（group ≥ 7000，air 原位替换身体帧行，CRLF/Clsn/注释一字不改）
//   · def 同名替换 sprite/anim 行；其余资源原样拷贝
//
// 跑: node build-merge-v2.mjs <baseCharDir> <framesDir> <outDir> <id> [mode] [bodyAlpha] [aiAlpha] [grayscale]
//     mode 默认 alpha；bodyAlpha 默认 alpha 模式 0.5 / binary 模式 0.2；aiAlpha 默认 0.95
//     grayscale=1 时 body 层去色成灰白（Rec.601 亮度，whitemold 同规则）——「灰白像素风」口径
// 环境变量（底座目录里文件名不唯一时必须显式指定）：BASE_SFF / BASE_AIR / BASE_DEF
// 依赖：sharp（环境变量 SHARP_PATH 可指；缺省用 toonflow-game-app 的）
//
// 引擎侧事实（换底座不用重查，来源 2026-11-28 实测）：
//   · SFF v2 头布局：36=FirstSpriteHeaderOffset、40=NumberOfSprites、44=FirstPaletteHeaderOffset、
//     48=NumberOfPalettes、52=lofs、60=tofs（与 JS 解码器 server/lib/sff.cjs 一致）
//   · v2 精灵目录 28B/条：group/index/w/h/ax/ay/link/format/coldepth/ofs/size/palidx/flags；
//     flags bit0=1 → ofs+=tofs；数据块=[4B packedLen][data]（引擎 readV2 Seek(offset+4)）
//   · format 11 = PNG RGBA → SetRaw(32) 逐像素 alpha；RGBA 精灵渲染 blend=BlendOne+
//     OneMinusSrcAlpha（fast path），**RGB 必须预乘**（shader 不自动乘）
//   · RGBA 纹理放大质量由 [Video] RGBSpriteBilinearFilter 控制：0=最近邻（像素风锐利），
//     1=双线性（糊）——项目由 index.html buildConfigIni 注入 =0
//   · v1 目录条目没有 w/hh 字段（那是 v2 结构）——尺寸必须用解码结果的 rgba.w/h
//   · 验证合成精灵别按「group≥6100 取第一个」——底座原包可能有 6100+ 特效段
//     （98Kim 顶到 6905），合成段在 **sff 目录尾部追加**，按目录尾段或构建日志的
//     「合成精灵 group： X .. Y」取
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 找项目根（含 server/lib/sff.cjs 的目录）——模板可能放在任意层级
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
const ROOT = findProjectRoot(__dirname);

const { loadSff, spriteRgba, readPaletteFile } = require(path.join(ROOT, 'server', 'lib', 'sff.cjs'));
const { encodePng } = require(path.join(ROOT, 'server', 'lib', 'png.cjs'));
const { decodePng } = require(path.join(__dirname, 'sprite-pack.cjs'));
const { parseAir, scanFrames, classifyAction, SPRITE_OF } = require(path.join(__dirname, 'air-some.cjs'));
const sharpPath = process.env.SHARP_PATH
  || 'D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/node_modules/sharp';
const sharp = require(sharpPath);

const AI_ALPHA_DEFAULT = 0.95;
const [baseCharDir, framesDir, outDir, id, modeArg, bodyArg, aiArg, grayArg] = process.argv.slice(2);
if (!baseCharDir || !framesDir || !outDir || !id) {
  console.error('用法: node build-merge-v2.mjs <baseCharDir> <framesDir> <outDir> <id> [mode=alpha|binary] [bodyAlpha] [aiAlpha]');
  process.exit(1);
}
const MODE = (modeArg || 'alpha').toLowerCase();
if (!['alpha', 'binary'].includes(MODE)) { console.error('mode 只能是 alpha | binary'); process.exit(1); }
const BODY_ALPHA = Number.isFinite(Number(bodyArg)) && Number(bodyArg) > 0
  ? Number(bodyArg) : (MODE === 'binary' ? 0.2 : 0.5);
const AI_ALPHA = Number.isFinite(Number(aiArg)) && Number(aiArg) > 0
  ? Number(aiArg) : AI_ALPHA_DEFAULT;
const GRAYSCALE = grayArg === '1';   // body 层灰白化（「原20% 灰白 像素风」口径）
console.log('模式', MODE, '· AI', AI_ALPHA, '/ body', BODY_ALPHA, GRAYSCALE ? '· body 灰白化' : '');

// 4×4 Bayer 有序抖动矩阵（与 v1 merge-binary 同款）；2×2 像素块共用一格判定 → 方块碎片
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const pick = (envName, re) => {
  const name = process.env[envName];
  if (name) {
    const p = path.join(baseCharDir, name);
    if (fs.existsSync(p)) return p;
    console.warn(`${envName}=${name} 不存在，回退搜索`);
  }
  const find = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { const r = find(p); if (r) return r; }
      else if (re.test(f)) return p;
    }
    return null;
  };
  return find(baseCharDir);
};
const baseSffPath = pick('BASE_SFF', /\.sff$/i);
const baseAirPath = pick('BASE_AIR', /\.air$/i);
const baseDefPath = pick('BASE_DEF', /\.def$/i);
const baseSffBuf = fs.readFileSync(baseSffPath);
const baseSff = loadSff(baseSffBuf);
const baseAirText = fs.readFileSync(baseAirPath, 'latin1');
const baseDef = fs.readFileSync(baseDefPath, 'latin1');
console.log('底座：', path.basename(baseSffPath), '精灵数', baseSff.sprites.size);

const ACT_PAL = (() => {
  const m = /^[ \t]*pal1[ \t]*=[ \t]*(.+)$/im.exec(baseDef);
  if (!m) return null;
  try { return readPaletteFile(fs.readFileSync(path.join(baseCharDir, m[1].trim().replace(/\\/g, '/')))); } catch { return null; }
})();
console.log('pal1：', ACT_PAL ? '已加载' : '缺（ownPal 精灵用自带调色板）');

// ---------- 1) 读 AI 图（manifest 或 NN-<key>.png） ----------
const manifestPath = path.join(framesDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { frames: [] };
if (!manifest.frames.length) {
  for (const f of fs.readdirSync(framesDir).filter((x) => x.endsWith('.png')).sort()) {
    const m = /^(\d+)-(\w+)\.png$/.exec(f);
    if (!m) continue;
    if (SPRITE_OF[m[2]] !== undefined) manifest.frames.push({ key: m[2], sprite: SPRITE_OF[m[2]], file: path.join(framesDir, f) });
  }
}
manifest.frames.sort((a, b) => a.sprite - b.sprite);
for (const f of manifest.frames) {
  if (!f.file && f.aiFile) f.file = path.isAbsolute(f.aiFile) ? f.aiFile : path.join(framesDir, f.aiFile);
}
console.log('AI 图：', manifest.frames.length, '张');
const aiBySprite = new Map();
for (const fr of manifest.frames) {
  if (!fs.existsSync(fr.file)) { console.error('缺图：', fr.file); process.exit(1); }
  aiBySprite.set(fr.sprite, decodePng(fs.readFileSync(fr.file)));
}

// ---------- 2) 特效判定 + 帧计划（group ≥ 7000 不融合） ----------
const HELPER_GROUP_MIN = 7000;
const acts = parseAir(baseAirText);
const effectGroups = new Set();
for (const a of acts) for (const f of scanFrames(a.body)) {
  if (f.g >= HELPER_GROUP_MIN) effectGroups.add(f.g);
}
const needMerge = new Map();
const framePlan = [];
for (const a of acts) {
  const frames = scanFrames(a.body);
  const { cat } = classifyAction(a.id);
  const plan = [];
  for (const f of frames) {
    if (effectGroups.has(f.g)) { plan.push({ ...f, merge: false }); continue; }
    const key = f.g + ',' + f.n + '|' + cat;
    needMerge.set(key, { g: f.g, n: f.n, cat });
    plan.push({ ...f, merge: true, key });
  }
  framePlan.push({ act: a, plan });
}
console.log('身体帧行 → 合成', framePlan.reduce((n, p) => n + p.plan.filter((x) => x.merge).length, 0),
  '· 特效帧行 → 原样', framePlan.reduce((n, p) => n + p.plan.filter((x) => !x.merge).length, 0),
  '· 合成精灵', needMerge.size, '张');

const AI_GROUP = (() => {
  const used = new Set([...baseSff.sprites.keys()].map((k) => +k.split(',')[0]));
  for (const m of baseAirText.matchAll(/^\s*(\d+)\s*,\s*\d+\s*,/gm)) used.add(+m[1]);
  let run = [];
  for (let g = 6100; g < 20000; g++) {
    if (used.has(g)) { run = []; continue; }
    run.push(g);
    if (run.length >= needMerge.size) { console.log('合成精灵 group：', run[0], '..', run[run.length - 1]); return run[0]; }
  }
  throw new Error('找不到足够的空闲 group');
})();

// ---------- 3) 合成 ----------
const dir1 = baseSff.byIndex;
function resolveSprite(g, n) {
  let sp = baseSff.sprites.get(g + ',' + n), hops = 0;
  while (sp && sp.size === 0 && hops < 64) { sp = dir1[sp.link]; hops++; }
  return sp || null;
}

async function mergeTrueAlpha(body, ai) {
  // body 内容包围盒
  const bw = body.w, bh = body.h;
  let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (body.rgba[(y * bw + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  // AI 内容包围盒
  const aw = ai.w, ah = ai.h;
  let ax0 = aw, ay0 = ah, ax1 = -1, ay1 = -1;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    if (ai.rgba[(y * aw + x) * 4 + 3] > 8) { if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
  }
  if (ax1 < 0) return null;
  const aW = ax1 - ax0 + 1, aH = ay1 - ay0 + 1;
  // AI 等比缩放：内容高对齐 body 内容高
  const scale = (y1 - y0 + 1) / aH;
  const fitW = Math.max(1, Math.round(aW * scale)), fitH = y1 - y0 + 1;
  // 逐行紧凑拷出内容子矩形（sharp raw 不支持行跨距；直接 offset 取整图宽会越界错位）
  const cropW = aW;
  const crop = Buffer.alloc(cropW * aH * 4);
  for (let y = 0; y < aH; y++) {
    const src = ((ay0 + y) * aw + ax0) * 4;
    crop.set(ai.rgba.subarray(src, src + cropW * 4), y * cropW * 4);
  }
  const fitRaw = await sharp(crop, { raw: { width: cropW, height: aH, channels: 4 } })
    .resize(fitW, fitH, { kernel: 'lanczos3', fit: 'fill' })
    .raw().toBuffer();
  const fit = new Float32Array(fitW * fitH * 4);
  for (let i = 0; i < fitW * fitH * 4; i++) fit[i] = fitRaw[i];
  // 画布 = body bbox ∪ AI 盒（AI 与 body 内容盒同高、水平居中）
  const aiBoxX0 = Math.floor((x0 + x1 + 1) / 2 - fitW / 2), aiBoxY0 = y0;
  const minX = Math.min(x0, aiBoxX0), minY = Math.min(y0, aiBoxY0);
  const W = Math.max(x1, aiBoxX0 + fitW - 1) - minX + 1, H = Math.max(y1, aiBoxY0 + fitH - 1) - minY + 1;
  const pre = new Float32Array(W * H * 4);
  const cov = new Float32Array(W * H);
  // AI 覆盖掩码：只认实心覆盖（>128）——lanczos 半透明边缘带的 body 像素也走抖动（保碎片感）
  const inAI = new Uint8Array(W * H);
  for (let y = 0; y < fitH; y++) for (let x = 0; x < fitW; x++) {
    if (fit[(y * fitW + x) * 4 + 3] > 128) {
      const px = aiBoxX0 + x, py = aiBoxY0 + y;
      if (px >= minX && py >= minY && px < W + minX && py < H + minY) inAI[(py - minY) * W + (px - minX)] = 1;
    }
  }
  // 1) body 层
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const so = (y * bw + x) * 4;
    const dof = ((y - minY) * W + (x - minX)) * 4;
    const cell = (y - minY) * W + (x - minX);
    if (MODE === 'binary') {
      // 二值碎片：重叠区 body 按相对权重混在 AI 下；body-only 走 Bayer 抖动（2×2 块）——
      // 保留约 bodyAlpha 密度的原色实心点（α=1），其余完全透明（v1 merge-binary 语义）
      if (inAI[cell]) {
        const aB = (body.rgba[so + 3] / 255) * BODY_ALPHA;
        if (aB <= 0) continue;
        pre[dof] += body.rgba[so] * aB; pre[dof + 1] += body.rgba[so + 1] * aB; pre[dof + 2] += body.rgba[so + 2] * aB;
        cov[cell] += aB;
      } else {
        if (BAYER[(((y - minY) >> 1) & 3) * 4 + (((x - minX) >> 1) & 3)] / 16 >= BODY_ALPHA) continue;
        if (body.rgba[so + 3] <= 24) continue;
        pre[dof] += body.rgba[so]; pre[dof + 1] += body.rgba[so + 1]; pre[dof + 2] += body.rgba[so + 2];
        cov[cell] = 1;
      }
    } else {
      // 二值虚化：body 整层真半透明（α=BODY_ALPHA）
      const aB = (body.rgba[so + 3] / 255) * BODY_ALPHA;
      if (aB <= 0) continue;
      pre[dof] += body.rgba[so] * aB; pre[dof + 1] += body.rgba[so + 1] * aB; pre[dof + 2] += body.rgba[so + 2] * aB;
      cov[cell] += aB;
    }
  }
  // 2) AI over
  for (let y = 0; y < fitH; y++) for (let x = 0; x < fitW; x++) {
    const so = (y * fitW + x) * 4;
    const aA = (fit[so + 3] / 255) * AI_ALPHA;
    if (aA <= 0) continue;
    const px = aiBoxX0 + x, py = aiBoxY0 + y;
    if (px < minX || py < minY || px >= W + minX || py >= H + minY) continue;
    const dof = ((py - minY) * W + (px - minX)) * 4;
    const k = 1 - aA;
    pre[dof] = fit[so] * aA + pre[dof] * k;
    pre[dof + 1] = fit[so + 1] * aA + pre[dof + 1] * k;
    pre[dof + 2] = fit[so + 2] * aA + pre[dof + 2] * k;
    cov[(py - minY) * W + (px - minX)] = aA + cov[(py - minY) * W + (px - minX)] * k;
  }
  // Float32 → Uint8（预乘 RGBA；a=0 的像素 RGB 清零，配合 SetRaw 的防渗色）
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = Math.max(0, Math.min(1, cov[i]));
    out[i * 4] = a > 0 ? Math.max(0, Math.min(255, Math.round(pre[i * 4]))) : 0;
    out[i * 4 + 1] = a > 0 ? Math.max(0, Math.min(255, Math.round(pre[i * 4 + 1]))) : 0;
    out[i * 4 + 2] = a > 0 ? Math.max(0, Math.min(255, Math.round(pre[i * 4 + 2]))) : 0;
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return { w: W, h: H, rgba: out, ax: body.ax - minX, ay: body.ay - minY };
}

const mergeCache = new Map();
const v2Sprites = [];
let pngTotal = 0;
const stats = { ok: 0, fail: 0 };
for (const [key, spec] of needMerge) {
  const sp = resolveSprite(spec.g, spec.n);
  if (!sp) { stats.fail++; continue; }
  let body = null;
  try {
    body = spriteRgba(baseSffBuf, baseSff, sp.group, sp.index, sp.ownPal ? null : ACT_PAL);
  } catch { body = null; }
  if (!body) { stats.fail++; continue; }
  body.ax = sp.ax; body.ay = sp.ay;
  const ai = aiBySprite.get(SPRITE_OF[spec.cat]);
  if (!ai) { stats.fail++; continue; }
  const merged = await mergeTrueAlpha(body, ai);
  if (!merged) { stats.fail++; continue; }
  const png = await encodePng(merged.rgba, merged.w, merged.h);
  v2Sprites.push({ group: AI_GROUP + mergeCache.size, index: 0, w: merged.w, h: merged.h, ax: merged.ax, ay: merged.ay, link: 0, size0: false, pngBuf: png });
  mergeCache.set(key, { group: AI_GROUP + mergeCache.size, index: 0 });
  pngTotal += png.length;
  stats.ok++;
}
console.log('合成精灵：成功', stats.ok, '跳过', stats.fail, '· PNG 总量', Math.round(pngTotal / 1048576 * 10) / 10, 'MB');

// ---------- 4) 全部精灵 → v2 条目（原精灵原序 + 合成追加） ----------
const all = [];
for (const sp of dir1) {
  if (sp.size === 0) { all.push({ group: sp.group, index: sp.index, w: 0, h: 0, ax: sp.ax, ay: sp.ay, link: sp.link, size0: true, pngBuf: null }); continue; }
  let rgba = null;
  try { rgba = spriteRgba(baseSffBuf, baseSff, sp.group, sp.index, sp.ownPal ? null : ACT_PAL); } catch { rgba = null; }
  if (!rgba) {
    console.warn('  原精灵解不出（按空处理）：', sp.group + ',' + sp.index);
    all.push({ group: sp.group, index: sp.index, w: 0, h: 0, ax: sp.ax, ay: sp.ay, link: 0, size0: true, pngBuf: null });
    continue;
  }
  const png = await encodePng(rgba.rgba, rgba.w, rgba.h);
  all.push({ group: sp.group, index: sp.index, w: rgba.w, h: rgba.h, ax: sp.ax, ay: sp.ay, link: 0, size0: false, pngBuf: png });
}
for (const s of v2Sprites) all.push(s);
console.log('v2 精灵总数：', all.length, '（原', dir1.length, '+ 合成', v2Sprites.length, '）');

// ---------- 5) 写 v2 ----------
const idxOf = new Map();
all.forEach((s, i) => { if (!idxOf.has(s.group + ',' + s.index)) idxOf.set(s.group + ',' + s.index, i); });
for (const s of all) {
  if (s.size0 && s.link) {
    const src = dir1[s.link];
    if (src) s.link = idxOf.get(src.group + ',' + src.index) ?? 0;
  }
}
const dataBlocks = [];
let cursor = 0;
const dirEntries = [];
for (const s of all) {
  if (s.size0) { dirEntries.push({ ...s, ofs: 0, size: 0 }); continue; }
  const block = Buffer.alloc(4 + s.pngBuf.length);
  block.writeUInt32LE(s.pngBuf.length, 0);
  s.pngBuf.copy(block, 4);
  dirEntries.push({ ...s, ofs: cursor, size: s.pngBuf.length });
  dataBlocks.push(block);
  cursor += block.length;
}
const HEAD = 512, DIR = 28 * all.length, tofs = HEAD + DIR;
const buf = Buffer.alloc(tofs + cursor);
buf.write('ElecbyteSpr\0', 0, 'latin1');
buf[12] = 0; buf[13] = 0; buf[14] = 1; buf[15] = 2;   // ver 2.1
buf.writeUInt32LE(HEAD, 36);           // FirstSpriteHeaderOffset
buf.writeUInt32LE(all.length, 40);     // NumberOfSprites
buf.writeUInt32LE(HEAD + DIR, 44);     // FirstPaletteHeaderOffset
buf.writeUInt32LE(0, 48);              // NumberOfPalettes
buf.writeUInt32LE(0, 52);              // lofs
buf.writeUInt32LE(tofs, 60);           // tofs（flags bit0=1 的精灵数据基址）
dirEntries.forEach((s, i) => {         // 注意遍历 dirEntries（ofs/size 在它上面）
  const o = HEAD + i * 28;
  buf.writeUInt16LE(s.group, o);
  buf.writeUInt16LE(s.index, o + 2);
  buf.writeUInt16LE(s.w, o + 4);
  buf.writeUInt16LE(s.h, o + 6);
  buf.writeInt16LE(s.ax, o + 8);
  buf.writeInt16LE(s.ay, o + 10);
  buf.writeUInt16LE(s.link ?? 0, o + 12);
  buf[o + 14] = s.size0 ? 0 : 11;      // format 11 = PNG RGBA
  buf[o + 15] = s.size0 ? 0 : 32;      // coldepth
  buf.writeUInt32LE(s.size0 ? 0 : s.ofs, o + 16);
  buf.writeUInt32LE(s.size0 ? 0 : s.size, o + 20);
  buf.writeUInt16LE(0, o + 24);        // palidx
  buf.writeUInt16LE(1, o + 26);        // flags bit0=1 → ofs += tofs
});
let at = tofs;
for (const b of dataBlocks) { b.copy(buf, at); at += b.length; }
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, id + '.sff'), buf);
console.log('写 sff(v2)：', path.join(outDir, id + '.sff'), (buf.length / 1048576).toFixed(2), 'MB');

// ---------- 6) air 原位替换 ----------
const edits = [];
for (const { act, plan } of framePlan) {
  for (const p of plan) {
    if (!p.merge) continue;
    const m = mergeCache.get(p.key);
    if (!m) continue;
    const tail = p.animType !== undefined ? ', ' + p.animType : '';
    edits.push({ start: act.bodyStart + p.start, end: act.bodyStart + p.end, newLine: `${p.lead}${m.group}, ${m.index}, ${p.ox}, ${p.oy}, ${p.t}${tail}` });
  }
}
edits.sort((a, b) => b.start - a.start);
let newAirText = baseAirText;
for (const e of edits) newAirText = newAirText.slice(0, e.start) + e.newLine + newAirText.slice(e.end);
fs.writeFileSync(path.join(outDir, id + '.air'), newAirText, 'latin1');
console.log('写 air：改写帧行', edits.length);

// ---------- 7) def ----------
let def = baseDef;
def = def.replace(/^(\s*name\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*displayname\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*sprite\s*=\s*).*$/im, `$1${id}.sff`);
def = def.replace(/^(\s*anim\s*=\s*).*$/im, `$1${id}.air`);
fs.writeFileSync(path.join(outDir, id + '.def'), def, 'latin1');

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
console.log('完成 →', outDir);
