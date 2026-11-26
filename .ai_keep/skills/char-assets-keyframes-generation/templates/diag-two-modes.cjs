// 两种透明度语义的对比诊断：
//   虚化模式（merge-alpha.cjs）  —— mask 不动，无挖空、无碎片
//   二值模式（merge-binary.cjs） —— bodyAlpha<1 时 body-only 像素走 Bayer 抖动 → 碎片
//
// 输出：两种模式下的不透明像素数、透明像素数、颜色数、碎片特征（孤立像素比例）。
// 用法: node .cache/scripts/diag-two-modes.cjs <baseCharDir> <framesDir> [group] [index]
'use strict';
const fs = require('fs');
const path = require('path');


const T = path.resolve('.zcode/skills/char-assets-keyframes-generation/keyframeMode/merge/templates');
const { mergeAlpha } = require(path.join(T, 'merge-alpha.cjs'));
const { mergeBinary } = require(path.join(T, 'merge-binary.cjs'));
const { loadSff, spriteRgba, readPaletteFile } = require(path.resolve('server/lib/sff.cjs'));
const { decodePng } = require(path.join(T, 'sprite-pack.cjs'));

const baseDir = process.argv[2];
const framesDir = process.argv[3];
const group = Number(process.argv[4] || 0);
const index = Number(process.argv[5] || 0);

function findFile(d, re) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { const r = findFile(p, re); if (r) return r; }
    else if (re.test(f)) return p;
  }
  return null;
}
const sffPath = findFile(baseDir, /\.sff$/i);
const defPath = findFile(baseDir, /\.def$/i);
const def = fs.readFileSync(defPath, 'latin1');
const m = /^[ \t]*pal1[ \t]*=[ \t]*(.+)$/im.exec(def);
const ACT = m ? readPaletteFile(fs.readFileSync(path.join(baseDir, m[1].trim()))) : null;

const buf = fs.readFileSync(sffPath);
const sff = loadSff(buf);
const body = spriteRgba(buf, sff, group, index, ACT);
if (!body) { console.log('解不出原精灵', group, index); process.exit(1); }
const sp = sff.sprites.get(group + ',' + index);
body.ax = sp.ax; body.ay = sp.ay;

// AI 图：取 manifest 里 stand 那张
const man = JSON.parse(fs.readFileSync(path.join(framesDir, 'manifest.json'), 'utf8'));
const fr = man.frames.find((f) => f.key === 'stand') || man.frames[0];
const aiFile = path.isAbsolute(fr.aiFile) ? fr.aiFile : path.join(framesDir, fr.aiFile);
const ai = decodePng(fs.readFileSync(aiFile));

function stat(name, merged) {
  if (!merged) { console.log(name, '合并失败'); return; }
  let opaque = 0, transparent = 0, semi = 0;
  const colors = new Set();
  const mask = new Uint8Array(merged.w * merged.h);
  for (let i = 0; i < merged.w * merged.h; i++) {
    const a = merged.rgba[i * 4 + 3];
    mask[i] = a > 128 ? 1 : 0;
    if (a > 128) {
      opaque++;
      colors.add((merged.rgba[i * 4] << 16) | (merged.rgba[i * 4 + 1] << 8) | merged.rgba[i * 4 + 2]);
    } else if (a > 24) semi++; else transparent++;
  }
  // 碎片特征：孤立的 1 像素（四邻域都是 0）—— 抖动出来的典型形态
  let isolated = 0, ones = 0;
  for (let y = 1; y < merged.h - 1; y++) for (let x = 1; x < merged.w - 1; x++) {
    const i = y * merged.w + x;
    if (!mask[i]) continue;
    ones++;
    if (!mask[i - 1] && !mask[i + 1] && !mask[i - merged.w] && !mask[i + merged.w]) isolated++;
  }
  console.log(name.padEnd(22),
    '不透明', String(opaque).padStart(6),
    '| 半透明', String(semi).padStart(6),
    '| 透明', String(transparent).padStart(6),
    '| 颜色', String(colors.size).padStart(5),
    '| 孤立像素', String(isolated).padStart(6),
    ones ? '= ' + (isolated / ones * 100).toFixed(1) + '%' : '');
}

console.log('底座', path.basename(sffPath), `精灵 ${group},${index} ${body.w}x${body.h}`);
stat('虚化 AI55/原100', mergeAlpha(body, ai, 0.55));
stat('二值 AI95/原20(抖动)', mergeBinary(body, ai, 0.95, 0.2, true));
stat('二值 AI95/原20(不抖动)', mergeBinary(body, ai, 0.95, 0.2, false));
stat('二值 AI95/原100', mergeBinary(body, ai, 0.95, 1, true));