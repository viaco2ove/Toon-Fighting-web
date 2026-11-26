// 把截图的指定区域打成 ASCII（`#`=有彩色内容 `*`=有亮度 `.`=弱内容 ` `=空），
// 便于在终端里直接目检「角色到底画出来了没」。
//
// 为什么需要（2026-11-26 实测）：
//   引擎对非法精灵是**静默丢弃**的（精灵隐形、零日志），而舞台背景本身在动，
//   逐帧 diff 全是噪声（实测同组内两帧自比就有 33% 差异）。
//   可靠做法是**抓同一个引擎帧号**对齐相位，再把角色区打成 ASCII 目检：
//   坏包角色区只有背景（满屏 `#`），好包会出现完整人形（`*` 组成的头/身/腿）。
//
// 依赖 sharp：先在项目里 `npm i sharp`，或用环境变量 SHARP_PATH 指向它。
// 用法: node ascii-region.cjs <png> [fx0 fx1 fy0 fy1]
//   默认看角色区：x 20%~45%，y 30%~92%
'use strict';
const path = require('path');

function loadSharp() {
  const candidates = [
    process.env.SHARP_PATH,
    'sharp',
    path.resolve(__dirname, '../../../node_modules/sharp'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* 试下一个 */ }
  }
  console.error('找不到 sharp。先 `npm i sharp`，或设环境变量 SHARP_PATH 指向它。');
  process.exit(2);
}

(async () => {
  const sharp = loadSharp();
  const p = process.argv[2];
  if (!p) { console.error('用法: node ascii-region.cjs <png> [fx0 fx1 fy0 fy1]'); process.exit(1); }
  const fx0 = Number(process.argv[3] || 0.20), fx1 = Number(process.argv[4] || 0.45);
  const fy0 = Number(process.argv[5] || 0.30), fy1 = Number(process.argv[6] || 0.92);
  const COLS = 64, ROWS = 34;
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  console.log(p, `(${W}x${H}) 区域 x${fx0}~${fx1} y${fy0}~${fy1}`);
  for (let ry = 0; ry < ROWS; ry++) {
    let line = '';
    const y0 = Math.floor(fy0 * H + (fy1 - fy0) * H * ry / ROWS);
    const y1 = Math.floor(fy0 * H + (fy1 - fy0) * H * (ry + 1) / ROWS);
    for (let rx = 0; rx < COLS; rx++) {
      const x0 = Math.floor(fx0 * W + (fx1 - fx0) * W * rx / COLS);
      const x1 = Math.floor(fx0 * W + (fx1 - fx0) * W * (rx + 1) / COLS);
      let bright = 0, sat = 0, tot = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * ch;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        tot++;
        if (mx > 110) bright++;
        if (mx - mn > 50) sat++;
      }
      line += (sat / tot > 0.20) ? '#' : (bright / tot > 0.35) ? '*' : (bright / tot > 0.12) ? '.' : ' ';
    }
    console.log(line);
  }
})();