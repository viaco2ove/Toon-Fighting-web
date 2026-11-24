// 从 MUGEN 角色包里提取头像（9000,0 立绘），落成 PNG。
// 供：serve.cjs 启动时为资产集角色生成头像、前端 /api/portrait/<charId> 使用。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadSff, spriteRgba, readPaletteFile, portraitScore } = require('./sff.cjs');
const { encodePng } = require('./png.cjs');

// 解析 def 里的 sprite / pal1（大小写不敏感、允许 ; 注释）
function parseDef(text) {
  const get = (key) => {
    const m = new RegExp('^\\s*' + key + '\\s*=\\s*(.+?)\\s*(?:;.*)?$', 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  return { sprite: get('sprite'), pal1: get('pal1'), name: get('name') };
}

// 角色目录 → 头像 PNG 字节。找不到或解析失败时返回 null（调用方回退到文字头像）。
//
// 精灵候选按优先级排列，取「第一个质量达标且尺寸合理」的：
//   9000,0 —— 引擎的 portrait.spr（选人格头像，各角色都有，25×25）
//   9000,10 / 9000,222 —— 部分包的脸部特写
//   9000,2 / 9000,3 —— 血条脸 / 立绘
//   0,0 —— 站立姿势精灵
//
// 注意 9000,1 是「动画帧横向拼贴图」（374×480 一类），不能当头像——
// 引擎用它做血条脸的多帧动画。所以候选表里不放它，且拒绝超宽的图。
const CANDIDATES = [
  [9000, 0], [9000, 10], [9000, 222], [9000, 3], [9000, 2], [0, 0],
];
const MAX_SIDE = 160;          // 头像最大边长
const MIN_SCORE = 45;          // 质量门槛（不透明占比等）

function portraitFor(charsRoot, charId) {
  const dir = path.join(charsRoot, charId);
  let defFile = null;
  try {
    defFile = fs.readdirSync(dir).find((f) => /\.def$/i.test(f));
  } catch { return null; }
  if (!defFile) return null;
  const def = parseDef(fs.readFileSync(path.join(dir, defFile), 'latin1'));
  if (!def.sprite) return null;
  const sffPath = path.join(dir, def.sprite);
  if (!fs.existsSync(sffPath)) return null;
  let buf;
  try { buf = fs.readFileSync(sffPath); } catch { return null; }
  let sff;
  try { sff = loadSff(buf); } catch { return null; }

  // def 的 pal1（外部 .act）：精灵没自带调色板时用它
  let externalPal = null;
  if (def.pal1) {
    const palPath = path.join(dir, def.pal1);
    if (fs.existsSync(palPath)) {
      try { externalPal = readPaletteFile(fs.readFileSync(palPath)); } catch { externalPal = null; }
    }
  }

  for (const key of CANDIDATES) {
    let img = null;
    try { img = spriteRgba(buf, sff, key[0], key[1], null); } catch { img = null; }
    if (!img || img.w < 8 || img.h < 8) continue;
    if (Math.max(img.w, img.h) > MAX_SIDE) continue;     // 动画拼贴图，太大
    const ar = img.w / img.h;
    if (ar > 4 || ar < 1 / 4) continue;                    // 极端长宽比 → rect 坏了
    let score = portraitScore(img);
    if (externalPal) {
      // 有些包精灵自带调色板是占位的，用外部 act 再解一次，取分高的
      try {
        const alt = spriteRgba(buf, sff, key[0], key[1], externalPal);
        if (alt) {
          const altScore = portraitScore(alt);
          if (altScore > score) { img = alt; score = altScore; }
        }
      } catch { /* 用原图 */ }
    }
    if (score < MIN_SCORE) continue;
    const cropped = cropToContent(img);
    return { png: encodePng(cropped.rgba, cropped.w, cropped.h), w: cropped.w, h: cropped.h };
  }
  return null;
}

// 按不透明像素裁掉空白边（立绘四周常有整块透明区），并留 1px 边距。
function cropToContent(img) {
  const { w, h, rgba } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img;                       // 全透明：原样返回
  minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
  maxX = Math.min(w - 1, maxX + 1); maxY = Math.min(h - 1, maxY + 1);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((y + minY) * w + minX) * 4;
    out.set(rgba.subarray(src, src + cw * 4), y * cw * 4);
  }
  return { w: cw, h: ch, rgba: out };
}

module.exports = { portraitFor, parseDef };
