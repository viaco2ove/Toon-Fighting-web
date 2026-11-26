// 「融」模式之二：**二值透明模式（原帧可调不透明度）**。
//
// 语义：
//   例如 原帧 20%，AI 帧 95%。
//   SFF v1 只有二值透明（alpha<128 → 索引 0 透明），所以「原帧 20%」
//   不能靠写半透明 alpha 实现 —— 那样 body-only 像素会**整片消失**。
//
//   本模式的口径：
//     ① 重叠区（AI 覆盖到的像素）→ 按**相对权重**把配比烘进 RGB
//        （AI 95% / 原 20% → 颜色里 AI 占主导，原帧只透出一点）
//     ② 原帧独有区（body-only 像素）→ 想要「淡显」就只能用
//        **4×4 Bayer 有序抖动**近似：按 bodyAlpha 比例保留部分像素为不透明，
//        其余落到 alpha=0（索引 0 透明）→ 视觉上成为「方块小碎片」
//
// ⚠️ 「碎片」不是刻意设计的美术效果，而是**二值透明下模拟淡显的必然手段**
//   （SFF v1 没有逐像素 alpha，想让 body-only 像素半透明只能抖动）。
//   bodyAlpha=1 时不抖动（保留全部像素实心），所以碎片只在 bodyAlpha<1 时出现。
//   要「不碎片」的淡显 → 用 merge-alpha.cjs（虚化模式，mask 不动）。
//
// 几何与混合公式在 merge-core.cjs（与虚化模式共用）。
'use strict';
const { mergeLayout, blendRGB } = require('./merge-core.cjs');

// 融合时 AI 图的不透明度（与 viewer 的 state.aiMergeAlpha 一致）
const MERGE_ALPHA = 0.55;
// 融合时原精灵的不透明度（二值模式的典型用法是 0.2）
// 注意：SFF v1 调色板只有二值透明（alpha<128 → 索引 0 透明），写 20% alpha 会让
// body-only 像素整片消失。所以 bodyAlpha 走「相对权重」烘进 RGB，
// 输出 alpha 仍沿用 max(bodyAlpha, aiAlpha) 的二值 mask 口径。
const MERGE_BODY_ALPHA = 1;

// 4×4 Bayer 有序抖动矩阵（阈值化后当作「保留比例」用）
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * 二值模式的融合。
 *
 * @param body  {rgba,w,h,ax,ay}  原精灵（已解成 RGBA）
 * @param ai    {rgba,w,h}         AI 整帧（原图，未缩放）
 * @param alpha AI 帧权重（默认 0.55）
 * @param bodyAlpha 原帧权重（默认 1）；<1 时 body-only 像素走 Bayer 抖动 → 碎片
 * @param dither 是否对 body-only 像素用抖动模拟淡显（默认 true）
 * @returns {w,h,rgba,ax,ay} 融合后的精灵；原精灵全透明时返回 null
 */
function mergeBinary(body, ai, alpha = MERGE_ALPHA, bodyAlpha = MERGE_BODY_ALPHA, dither = true) {
  const L = mergeLayout(body, ai);
  if (!L) return null;
  const { bBox, aBox, fit, aiX, aiY, minX, minY, w, h } = L;
  const out = new Uint8Array(w * h * 4);
  const useDither = dither && bodyAlpha < 1;

  // 1) 先铺原精灵。
  //    bodyAlpha<1 且开抖动 → 用 4×4 Bayer 有序抖动把「淡」烘进二值 mask：
  //    保留约 bodyAlpha 比例的像素为不透明，其余写到 alpha=0（索引 0 透明）。
  //    SFF v1 没有每像素 alpha，只能这样近似查看器里 globalAlpha 的效果。
  for (let y = bBox.y0; y <= bBox.y1; y++) {
    for (let x = bBox.x0; x <= bBox.x1; x++) {
      const so = (y * body.w + x) * 4;
      const dof = ((y - minY) * w + (x - minX)) * 4;
      const a = body.rgba[so + 3];
      if (a <= 24) continue;
      if (useDither && BAYER[((y - minY) & 3) * 4 + ((x - minX) & 3)] / 16 >= bodyAlpha) continue;
      out[dof] = body.rgba[so]; out[dof + 1] = body.rgba[so + 1];
      out[dof + 2] = body.rgba[so + 2]; out[dof + 3] = a;
    }
  }

  // 2) 再把 AI 图按权重叠上去（重叠区按相对权重烘进 RGB）
  for (let y = aBox.y0; y <= aBox.y1; y++) {
    for (let x = aBox.x0; x <= aBox.x1; x++) {
      const sa = fit.rgba[(y * fit.w + x) * 4 + 3];
      if (sa === 0) continue;
      const px = aiX + x, py = aiY + y;
      const dof = ((py - minY) * w + (px - minX)) * 4;
      const dr = out[dof], dg = out[dof + 1], db = out[dof + 2], da = out[dof + 3];
      const mixed = blendRGB(
        fit.rgba[(y * fit.w + x) * 4],
        fit.rgba[(y * fit.w + x) * 4 + 1],
        fit.rgba[(y * fit.w + x) * 4 + 2],
        dr, dg, db, sa, da, alpha, bodyAlpha,
      );
      if (!mixed) continue;
      out[dof] = mixed[0]; out[dof + 1] = mixed[1]; out[dof + 2] = mixed[2];
      out[dof + 3] = Math.max(da, sa);
    }
  }

  // 锚点：原精灵锚点平移到新画布
  return { w, h, rgba: out, ax: body.ax - minX, ay: body.ay - minY };
}

module.exports = { MERGE_ALPHA, MERGE_BODY_ALPHA, mergeBinary };