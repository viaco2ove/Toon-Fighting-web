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
// 虚化模式的原帧颜色权重（1 = 旧行为：原帧 100% 贡献颜色）。
// 2026-11-28 增：可传 <1（如 0.2）——重叠区按相对权重混合 RGB，
// 但 mask 依然不动（body-only 像素保持实心，不抖动、无碎片）。
const MERGE_BODY_ALPHA = 1;

/**
 * 虚化模式的融合：AI 帧按权重混进原帧，原帧保持实心。
 *
 * @param body  {rgba,w,h,ax,ay}  原精灵（已解成 RGBA）
 * @param ai    {rgba,w,h}         AI 整帧（原图，未缩放）
 * @param alpha AI 帧权重（默认 0.55）
 * @param bodyAlpha 原帧颜色权重（默认 1；重叠区按相对权重混 RGB）
 * @returns {w,h,rgba,ax,ay} 融合后的精灵（自带锚点）；原精灵全透明时返回 null
 */
function mergeAlpha(body, ai, alpha = MERGE_ALPHA, bodyAlpha = MERGE_BODY_ALPHA) {
  const L = mergeLayout(body, ai);
  if (!L) return null;
  const { bBox, aBox, fit, aiX, aiY, minX, minY, w, h } = L;
  const out = new Uint8Array(w * h * 4);

  // 1) 先铺原精灵 —— mask 原样保留（实心、不抖动：虚化模式无碎片的核心特征）。
  //    RGB 按 bodyAlpha 压暗：原帧 20% → 亮度 20% 的暗色残影。
  //    SFF v1 只有二值透明，「原帧 20%」无法用真半透明表达（真半透明 = 索引 0 整片挖空），
  //    无碎片的近似手段就是把亮度烘到同比例 —— 残影的浓度与口径一致。
  //    bodyAlpha=1 时保持原色（旧行为）。
  const bodyDim = bodyAlpha < 1 ? bodyAlpha : 1;
  for (let y = bBox.y0; y <= bBox.y1; y++) {
    for (let x = bBox.x0; x <= bBox.x1; x++) {
      const so = (y * body.w + x) * 4;
      const dof = ((y - minY) * w + (x - minX)) * 4;
      const a = body.rgba[so + 3];
      if (a <= 24) continue;
      out[dof] = Math.round(body.rgba[so] * bodyDim);
      out[dof + 1] = Math.round(body.rgba[so + 1] * bodyDim);
      out[dof + 2] = Math.round(body.rgba[so + 2] * bodyDim);
      out[dof + 3] = a;
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

module.exports = { MERGE_ALPHA, MERGE_BODY_ALPHA, mergeAlpha };
