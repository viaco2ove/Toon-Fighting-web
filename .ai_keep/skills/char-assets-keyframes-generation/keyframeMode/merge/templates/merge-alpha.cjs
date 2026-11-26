// 「融」模式之一：**虚化模式（RGB 相对权重）**。
//
// 语义：
//   原帧 100%，AI 帧 55%。
//   **原帧不做任何透明度处理**，只把 AI 帧的权重乘 0.55 混进 RGB。
//   mask 全程保持不透明 —— 不会有挖空、不会有碎片、边缘干净。
//
// 为什么不是「真半透明 alpha」：
//   SFF v1 的调色板只有二值透明（alpha<128 → 索引 0 透明）。
//   真的写 55% 的 alpha → 那部分像素索引变 0 → **整片消失**，不是虚化。
//   所以 v1 下能落地的最接近形态就是「颜色层面的淡化」：
//   把 AI 帧按权重混进原帧 RGB，输出仍是不透明的索引色。
//
//   （引擎的 SFF **v2** 支持 format 11/12 = RGBA PNG，能真逐像素 alpha，
//     但项目里没有 v2 写出器，且底座包是 v1 —— 混编规则另议。
//     见 SKILL.md「两种透明度语义」。）
//
// 与「二值碎片模式」的差别（merge-binary.cjs）：
//   本模式：**不碰 mask**，所有 body-only 像素都实心。
//   二值模式：bodyAlpha<1 时 body-only 像素用 Bayer 抖动模拟淡显 → 碎片。
//
// 几何与混合公式在 merge-core.cjs（与二值模式共用）。
'use strict';
const { mergeLayout, blendRGB } = require('./merge-core.cjs');

// 融合时 AI 图的不透明度（与 viewer 的 state.aiMergeAlpha 一致）
const MERGE_ALPHA = 0.55;
// 虚化模式**固定原帧 100%** —— 原帧不做透明度处理是本模式的定义。
const MERGE_BODY_ALPHA = 1;

/**
 * 虚化模式的融合：AI 帧按权重混进原帧，原帧保持实心。
 *
 * @param body  {rgba,w,h,ax,ay}  原精灵（已解成 RGBA）
 * @param ai    {rgba,w,h}         AI 整帧（原图，未缩放）
 * @param alpha AI 帧权重（默认 0.55）
 * @returns {w,h,rgba,ax,ay} 融合后的精灵（自带锚点）；原精灵全透明时返回 null
 */
function mergeAlpha(body, ai, alpha = MERGE_ALPHA) {
  const L = mergeLayout(body, ai);
  if (!L) return null;
  const { bBox, aBox, fit, aiX, aiY, minX, minY, w, h } = L;
  const out = new Uint8Array(w * h * 4);

  // 1) 先铺原精灵 —— **不做任何透明度处理**，mask 原样保留
  for (let y = bBox.y0; y <= bBox.y1; y++) {
    for (let x = bBox.x0; x <= bBox.x1; x++) {
      const so = (y * body.w + x) * 4;
      const dof = ((y - minY) * w + (x - minX)) * 4;
      const a = body.rgba[so + 3];
      if (a <= 24) continue;
      out[dof] = body.rgba[so]; out[dof + 1] = body.rgba[so + 1];
      out[dof + 2] = body.rgba[so + 2]; out[dof + 3] = a;
    }
  }

  // 2) 再把 AI 图按权重叠上去（只混 RGB，mask 取 max）
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
        dr, dg, db, sa, da, alpha, 1,
      );
      if (!mixed) continue;
      out[dof] = mixed[0]; out[dof + 1] = mixed[1]; out[dof + 2] = mixed[2];
      out[dof + 3] = Math.max(da, sa);
    }
  }

  // 锚点：原精灵锚点平移到新画布
  return { w, h, rgba: out, ax: body.ax - minX, ay: body.ay - minY };
}

module.exports = { MERGE_ALPHA, MERGE_BODY_ALPHA, mergeAlpha };
