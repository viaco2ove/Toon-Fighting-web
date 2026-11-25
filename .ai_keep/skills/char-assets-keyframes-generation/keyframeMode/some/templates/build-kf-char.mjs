// 依赖：Node 22 + 同目录的 air-some.cjs / sff-append.cjs / sprite-pack.cjs
//       + 项目 server/lib/sff.cjs（解码器）+ 后端项目的 sharp（可选）
//
// 生成「抽关键帧」变体角色包：
//   <outDir>/<id>.sff   —— 原 sff 全部字节保留 + 追加 10 个带自有彩色调色板的 AI 精灵
//   <outDir>/<id>.air   —— 原 air 逐 action 只替换代表帧，其余帧原样
//   <outDir>/<id>.def   —— 指向新 sff/air
//
// 为什么能「白模灰度 + AI 彩色」共存：
//   SFF v1 每个精灵可自带调色板（子头 +18 的 ps 字节 = 0 表示自带，
//   块尾 0x0C 标记后跟 768 字节调色板）。白模精灵沿用 def 的 .act 灰度调色板，
//   AI 精灵自带彩色调色板 → 引擎分别用各自的调色板渲染。
//
// 跑: node build-kf-char-template.mjs <baseCharDir> <framesDir> <outDir> <id>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { decodePng, quantize } = require('./sprite-pack.cjs');
const { remapAirSome, listRepresentatives, CATEGORIES } = require('./air-some.cjs');
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
const ROOT = findProjectRoot(__dirname);
const { loadSff, spriteRgba } = require(path.join(ROOT, 'server', 'lib', 'sff.cjs'));

// 按 {{...}} 占位符定制四处：CHAR（白模包）/ FRAMES（关键帧目录）/ OUT（输出）/ ID（变体 id）
// 跑: node build-kf-char-template.mjs <baseCharDir> <framesDir> <outDir> <id>
// 例: node build-kf-char-template.mjs "ikemen-fs/file/chars/{{CHAR_ID}}" //        "ikemen-fs/file/chars/{{CHAR_ID}}/keyframes/keyframes" //        ".cache/kf-build/{{VARIANT_ID}}" "{{VARIANT_ID}}"
const baseCharDir = process.argv[2];
const framesDir = process.argv[3];
const outDir = process.argv[4];
const id = process.argv[5] || '{{VARIANT_ID}}';

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
    const cat = CATEGORIES.find((c) => c.key === m[2]);
    if (cat) manifest.frames.push({ ...cat, file: path.join(framesDir, f) });
  }
}
manifest.frames.sort((a, b) => a.sprite - b.sprite);
for (const f of manifest.frames) {
  if (!f.file && f.aiFile) f.file = path.isAbsolute(f.aiFile) ? f.aiFile : path.join(framesDir, f.aiFile);
}
console.log('待打包帧：', manifest.frames.length);

// ---------- 2) 原包的 sff / air ----------
const baseSffPath = findFile(baseCharDir, /\.sff$/i);
const baseAirPath = findFile(baseCharDir, /\.air$/i);
const baseDefPath = findFile(baseCharDir, /\.def$/i);
const baseSffBuf = fs.readFileSync(baseSffPath);
const baseSff = loadSff(baseSffBuf);
const baseAirText = fs.readFileSync(baseAirPath, 'latin1');
const baseDef = fs.readFileSync(baseDefPath, 'latin1');
const localcoord = (() => {
  const m = /^\s*localcoord\s*=\s*(\d+)\s*,\s*(\d+)/im.exec(baseDef);
  return m ? [+m[1], +m[2]] : [320, 240];
})();
console.log('底座：', path.basename(baseSffPath), '· localcoord', localcoord.join('x'));

// 精灵高度查询（挑代表帧用）
// 注意：45 个精灵是「共享块」（size=0，靠 link 指向别的精灵），像素解引用后才有尺寸。
// 这里直接从 PCX 头读 ymax（不解码像素），并对共享块解引用到被链接者。
const spriteHeight = (() => {
  const dir = readSffV1Dir(baseSffBuf);
  const byIdx = dir.sprites;
  const byKey = new Map();
  for (const sp of byIdx) byKey.set(sp.group + ',' + sp.index, sp);
  const cache = new Map();
  // PCX 头：magic(1) ver(1) encoding(1) bpp(1) xmin(2) ymin(2) xmax(2) ymax(2)
  const rawH = (sp) => {
    if (!sp || sp.size === 0) return 0;
    const off = sp.ofs + 32;
    if (off + 12 > baseSffBuf.length) return 0;
    const ymin = baseSffBuf.readUInt16LE(off + 6);
    const ymax = baseSffBuf.readUInt16LE(off + 10);
    return ymax - ymin + 1;
  };
  return (g, n) => {
    const k = g + ',' + n;
    if (cache.has(k)) return cache.get(k);
    const sp = byKey.get(k);
    let h = 0;
    if (sp) {
      h = rawH(sp);
      // 共享块（size=0）：解引用到被链接的精灵
      if (!h) {
        let hops = 0;
        let cur = sp;
        while (cur && cur.size === 0 && hops < 64) {
          cur = byIdx[cur.link];
          hops++;
        }
        h = rawH(cur);
      }
    }
    cache.set(k, h);
    return h;
  };
})();

// ---------- 3) 代表帧清单（打印出来供核对） ----------
const reps = listRepresentatives(baseAirText, spriteHeight);
console.log('\n代表帧（共 ' + reps.length + ' 个 action）：');
const byCat = {};
for (const r of reps) (byCat[r.cat] = byCat[r.cat] || []).push(r);
for (const cat of CATEGORIES) {
  const list = byCat[cat.key] || [];
  const sample = list.slice(0, 4).map((r) => `a${r.action}(${r.sprite} h${r.height})`).join(' ');
  console.log('  ' + cat.key.padEnd(8) + String(list.length).padStart(3) + ' 个  ' + sample);
}

// ---------- 4) 裁透明边 + 统一高度 + 对齐锚点 ----------
// 目标几何：参照帧（该类别的白模代表帧）的内容高度 + 锚点位置。
// 参照帧来自 manifest 的 refSprite（如 "0,0"），取自原包的 sff。
function nativeRef(refSprite) {
  if (!refSprite) return null;
  const [g, n] = String(refSprite).split(',').map(Number);
  const sp = baseSff.sprites.get(g + ',' + n);
  if (!sp) return null;
  const img = spriteRgba(baseSffBuf, baseSff, g, n, null);
  if (!img) return null;
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return {
    ax: sp.ax, ay: sp.ay,
    contentH: y1 - y0 + 1,
    centerShift: (x0 + x1) / 2 - sp.ax,
    footGap: y1 - sp.ay,
  };
}

function fitFrame(rgba, w, h, targetH) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { w: targetH, h: targetH, rgba: new Uint8Array(targetH * targetH * 4) };
  const srcW = maxX - minX + 1, srcH = maxY - minY + 1;
  const scale = targetH / srcH;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const out = new Uint8Array(dstW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = minY + Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const sx = minX + Math.min(srcW - 1, Math.floor(x / scale));
      const so = (sy * w + sx) * 4, dof = (y * dstW + x) * 4;
      out[dof] = rgba[so]; out[dof + 1] = rgba[so + 1]; out[dof + 2] = rgba[so + 2]; out[dof + 3] = rgba[so + 3];
    }
  }
  return { w: dstW, h: targetH, rgba: out };
}

// 每张 AI 图单独量化成自己的 256 色调色板（自带调色板，不需要和别的图共享）
function quantizeOwn(rgba, w, h) {
  const q = quantize(rgba, w, h, 255);
  const palette = q.palette;
  const px = new Uint8Array(w * h);
  const cache = new Map();
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 128) { px[i] = 0; continue; }
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      let bd = Infinity; idx = 1;
      for (let j = 1; j < 256; j++) {
        const dr = rgba[i * 4] - palette[j * 3], dg = rgba[i * 4 + 1] - palette[j * 3 + 1], db = rgba[i * 4 + 2] - palette[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; idx = j; if (!d) break; }
      }
      cache.set(key, idx);
    }
    px[i] = idx;
  }
  return { px, palette };
}

// AI 精灵要放哪个 group？
// **不能放 group 0** —— 白模已经占了 group 0 的 index 0..3（站立循环），
// 覆盖掉就会让站立动作缺帧。找一个原包完全没用到的 group。
// 6000-6999 是 MUGEN 惯例的自定义区，但也要逐个排除 air 里引用过的。
const AI_GROUP = (() => {
  const dir = readSffV1Dir(baseSffBuf);
  const used = new Set(dir.sprites.map((s) => s.group));
  // air 里引用过的 group 也要避开（万一以后 air 引用到）
  for (const m of baseAirText.matchAll(/^\s*(\d+)\s*,\s*\d+\s*,/gm)) used.add(+m[1]);
  // 从 6000 起找连续 10 个空闲 group
  let run = [];
  for (let g = 6000; g < 7000; g++) {
    if (used.has(g)) { run = []; continue; }
    run.push(g);
    if (run.length >= manifest.frames.length) {
      console.log('AI 精灵 group：', run.join(','));
      return run[0];
    }
  }
  throw new Error('找不到 10 个连续空闲的 group 放 AI 精灵');
})();

const aiSprites = [];
for (const fr of manifest.frames) {
  const p = fr.file;
  if (!fs.existsSync(p)) { console.error('缺图：', p); process.exit(1); }
  const img = decodePng(fs.readFileSync(p));
  const ref = nativeRef(fr.refSprite);
  const targetH = ref ? ref.contentH : Math.round(localcoord[1] * 0.92);
  const fit = fitFrame(img.rgba, img.w, img.h, targetH);
  const ax = ref ? Math.round(fit.w / 2 + ref.centerShift) : Math.round(fit.w / 2);
  const ay = ref ? Math.min(fit.h, Math.max(1, targetH - ref.footGap)) : fit.h;
  const { px, palette } = quantizeOwn(fit.rgba, fit.w, fit.h);
  aiSprites.push({
    group: AI_GROUP + fr.sprite, index: 0,
    w: fit.w, h: fit.h, px, palette, ax, ay, key: fr.key,
  });
  console.log('  ' + String(fr.key).padEnd(8) + fit.w + 'x' + fit.h + '  axis=' + ax + ',' + ay +
    (ref ? '  (参照 ' + fr.refSprite + ' 内容高 ' + ref.contentH + ')' : '  (无参照)'));
}

// ---------- 5) 追加到原 sff ----------
const { buf: newSffBuf } = appendSprites(baseSffBuf, aiSprites);
const newSffPath = path.join(outDir, id + '.sff');
fs.writeFileSync(newSffPath, newSffBuf);
const check = readSffV1Dir(newSffBuf);
console.log('\n写 sff：', newSffPath, newSffBuf.length, 'bytes · 精灵数', check.nspr, '（原 ' + baseSffBuf.length + '）');

// ---------- 6) 改写 air：只替换代表帧 ----------
const { text: newAirText, stats } = remapAirSome(baseAirText, { spriteH: spriteHeight, aiGroup: AI_GROUP });
const newAirPath = path.join(outDir, id + '.air');
fs.writeFileSync(newAirPath, newAirText, 'latin1');
console.log('写 air：', newAirPath, newAirText.length, 'bytes');
console.log('  action', stats.total, '· 替换代表帧', stats.replaced, '· 跳过', stats.skipped);
console.log('  类别分布', JSON.stringify(stats.byCat));

// ---------- 7) def：指向新 sff/air ----------
const oldBase = path.basename(baseDefPath).replace(/\.def$/i, '');
let def = baseDef;
def = def.replace(/^(\s*name\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*displayname\s*=\s*)"[^"]*"/im, `$1"${id}"`);
def = def.replace(/^(\s*sprite\s*=\s*).*$/im, `$1${id}.sff`);
def = def.replace(/^(\s*anim\s*=\s*).*$/im, `$1${id}.air`);
fs.writeFileSync(path.join(outDir, id + '.def'), def, 'latin1');
console.log('写 def：', id + '.def');

// ---------- 8) 复制其余资源（cns/cmd/snd/act/lee 等） ----------
function copyExcept(src, dst, skip) {
  for (const f of fs.readdirSync(src)) {
    if (skip.includes(f)) continue;
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyExcept(s, d, skip);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
const skip = [path.basename(baseSffPath), path.basename(baseAirPath), path.basename(baseDefPath)];
copyExcept(baseCharDir, outDir, skip);
console.log('已复制其余资源（cns/cmd/snd/act/lee）');
