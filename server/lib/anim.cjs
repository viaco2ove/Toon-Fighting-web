// MUGEN 角色的 AIR 动作 → 可播放的帧序列（PNG 帧 + 时长）。
// 用途：选人屏大头像区显示「MUGEN 角色动态效果」（动作列表第一个 = 站立 action 0）。
//
// 帧合成口径与引擎渲染一致（简化版）：
//   每帧 = 精灵位图画在 (frame.x - ax, frame.y - ay)；
//   画布 = 所有帧的包围盒；H 标志 = 水平镜像（引擎还有 1px phantom 修正，预览忽略）。
// 调色板：精灵自带（ps 链）优先，pal1 指定的 .act 作对照（取引擎语义：外部 ACT 追加、
//   索引 0 重定向），这里统一用「外部 act 存在就用它」—— 与选人屏第一套配色的观感一致。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadSff, spriteRgba, readPaletteFile } = require('./sff.cjs');
const { encodePng } = require('./png.cjs');

function parseDef(text) {
  const get = (key) => {
    const m = new RegExp('^\\s*' + key + '\\s*=\\s*(.+?)\\s*(?:;.*)?$', 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  return { sprite: get('sprite'), anim: get('anim'), pal1: get('pal1') };
}

// 解析一个 action 的帧行：<grp>,<idx>,<x>,<y>,<dur>[, H|V|S...]
// Clsn 行 / 注释 / loopstart 跳过；dur<=0 按 1 tick 处理（-1 是代码控帧，预览当 1）。
function parseAirAction(text, actionNo) {
  const re = new RegExp('^\\[Begin Action\\s+' + actionNo + '\\b', 'im');
  const m = re.exec(text);
  if (!m) return null;
  const body = text.slice(m.index);
  // 找**下一个** action 头 —— body 开头就是当前 action 的头，必须先跳过第一行
  const firstNl = body.indexOf('\n');
  const rest = firstNl >= 0 ? body.slice(firstNl + 1) : '';
  const endRel = rest.search(/^\s*\[Begin Action\b/im);
  const lines = (endRel >= 0 ? rest.slice(0, endRel) : rest).split(/\r?\n/);
  const frames = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (/^(Clsn|loopstart)/i.test(line)) continue;
    const fm = /^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(.*))?$/.exec(line);
    if (!fm) continue;
    const flags = (fm[6] || '').toUpperCase();
    frames.push({
      grp: +fm[1], idx: +fm[2], x: +fm[3], y: +fm[4],
      dur: Math.max(1, +fm[5]),
      flipH: flags.includes('H'), flipV: flags.includes('V'),
    });
  }
  return frames.length ? frames : null;
}

// 角色的一个动作 → 帧序列。失败返回 null（调用方回退静态头像）。
function animFrames(charsRoot, charId, actionNo) {
  const dir = path.join(charsRoot, charId);
  let defFile = null;
  try { defFile = fs.readdirSync(dir).find((f) => /\.def$/i.test(f)); } catch { return null; }
  if (!defFile) return null;
  const def = parseDef(fs.readFileSync(path.join(dir, defFile), 'latin1'));
  if (!def.sprite || !def.anim) return null;
  let buf, airText;
  try {
    buf = fs.readFileSync(path.join(dir, def.sprite));
    airText = fs.readFileSync(path.join(dir, def.anim), 'latin1');
  } catch { return null; }
  let sff;
  try { sff = loadSff(buf); } catch { return null; }
  let pal = null;
  if (def.pal1) {
    const palPath = path.join(dir, def.pal1);
    if (fs.existsSync(palPath)) {
      try { pal = readPaletteFile(fs.readFileSync(palPath)); } catch { pal = null; }
    }
  }
  const frames = parseAirAction(airText, actionNo);
  if (!frames) return null;

  // 每帧解码精灵 + 翻转。
  // 注意：服务端 spriteRgba 返回值不带 ax/ay（那在精灵目录头里），单独取。
  //
  // 调色板：只有**自带调色板**的精灵才用自己的调色板；
  // 其余精灵用 def 的 pal1（.act，灰度素体色）。
  // 不能一律套 pal —— 那样会把 AI 关键帧（自带彩色调色板）染成灰色。
  const sprites = [];
  for (const f of frames) {
    let img = null;
    const sp0 = sff.sprites.get(f.grp + ',' + f.idx);
    const ownPal = !!(sp0 && sp0.ownPal);
    try { img = spriteRgba(buf, sff, f.grp, f.idx, ownPal ? null : pal); } catch { img = null; }
    if (!img) continue;
    const sp = sff.sprites.get(f.grp + ',' + f.idx);
    img.ax = sp ? sp.ax : Math.round(img.w / 2);
    img.ay = sp ? sp.ay : img.h;
    if (f.flipH) {
      const { w, h, rgba } = img;
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4, d = (y * w + (w - 1 - x)) * 4;
        out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
      }
      img = { w, h, rgba: out };
    }
    if (f.flipV) {
      const { w, h, rgba } = img;
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        const s = ((h - 1 - y) * w) * 4, d = (y * w) * 4;
        out.set(rgba.subarray(s, s + w * 4), d);
      }
      img = { w, h, rgba: out };
    }
    sprites.push({ f, img });
  }
  if (!sprites.length) return null;

  // 包围盒（所有帧画出来的区域）
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const { f, img } of sprites) {
    const x0 = f.x - img.ax, y0 = f.y - img.ay;
    minX = Math.min(minX, x0); minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x0 + img.w); maxY = Math.max(maxY, y0 + img.h);
  }
  const W = Math.min(400, maxX - minX), H = Math.min(400, maxY - minY);
  if (W <= 0 || H <= 0) return null;

  // 逐帧合成
  const out = [];
  for (const { f, img } of sprites) {
    const rgba = new Uint8Array(W * H * 4);
    const ox = f.x - img.ax - minX, oy = f.y - img.ay - minY;
    for (let y = 0; y < img.h; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= H) continue;
      for (let x = 0; x < img.w; x++) {
        const dx = ox + x;
        if (dx < 0 || dx >= W) continue;
        const s = (y * img.w + x) * 4, d = (dy * W + dx) * 4;
        if (img.rgba[s + 3] <= 8) continue;      // 透明
        rgba[d] = img.rgba[s]; rgba[d + 1] = img.rgba[s + 1];
        rgba[d + 2] = img.rgba[s + 2]; rgba[d + 3] = img.rgba[s + 3];
      }
    }
    out.push({ png: encodePng(rgba, W, H).toString('base64'), ms: Math.round(f.dur / 60 * 1000) });
  }
  return { w: W, h: H, frames: out };
}

module.exports = { animFrames, parseAirAction };
