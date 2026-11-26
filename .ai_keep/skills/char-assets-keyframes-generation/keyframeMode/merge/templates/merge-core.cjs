// 「融」模式的**共享核心**：几何对齐 + 内容包围盒 + 缩放。
//
// 为什么要拆成 core：
//   融合有两种互斥的透明度语义（虚化 / 二值碎片），两者的**几何完全一样**，
//   差别只在像素怎么算。几何抽出来共用，两种模式各自只管自己的像素算法，
//   避免「改一处漏另一处」。
//
// 几何对齐口径（两种模式一致）：
//   AI 图按**原精灵的内容高度**缩放（这样每帧的融合图大小跟原帧一致），
//   内容中心与原精灵内容中心对齐、内容底边与原精灵内容底边对齐。
//   融合画布 = 原精灵内容包围盒 ∪ AI 图矩形；锚点沿用原精灵的锚点
//   （加上画布偏移），这样 air 的帧偏移不用改。
'use strict';

/**
 * 求不透明像素的包围盒。
 * @returns {null|{x0,y0,x1,y1,cx,cy,bottom}} x1/y1 是闭区间
 */
function contentBox(rgba, w, h, thresh = 24) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > thresh) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, bottom: y1 };
}

/**
 * 裁透明边 + 按目标高缩放（与 build-kf-char 的 fitFrame 同一口径）。
 * @returns {w,h,rgba}
 */
function fitFrame(rgba, w, h, targetH) {
  const box = contentBox(rgba, w, h);
  if (!box) return { w: targetH, h: targetH, rgba: new Uint8Array(targetH * targetH * 4) };
  const srcW = box.x1 - box.x0 + 1, srcH = box.y1 - box.y0 + 1;
  const scale = targetH / srcH;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const out = new Uint8Array(dstW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = box.y0 + Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const sx = box.x0 + Math.min(srcW - 1, Math.floor(x / scale));
      const so = (sy * w + sx) * 4, dof = (y * dstW + x) * 4;
      out[dof] = rgba[so]; out[dof + 1] = rgba[so + 1];
      out[dof + 2] = rgba[so + 2]; out[dof + 3] = rgba[so + 3];
    }
  }
  return { w: dstW, h: targetH, rgba: out };
}

/**
 * 算两种模式共用的布局：画布尺寸、AI 图位置、内容包围盒。
 * @returns {null|object} 原精灵或 AI 图全透明时返回 null（无从融起）
 */
function mergeLayout(body, ai) {
  const bBox = contentBox(body.rgba, body.w, body.h);
  if (!bBox) return null;

  // AI 图按原精灵的内容高度缩放
  const targetH = bBox.y1 - bBox.y0 + 1;
  const fit = fitFrame(ai.rgba, ai.w, ai.h, targetH);
  const aBox = contentBox(fit.rgba, fit.w, fit.h);
  if (!aBox) return null;

  // AI 图放置位置：内容中心对齐原精灵内容中心，内容底边对齐原精灵内容底边
  const aiX = Math.round(bBox.cx - (aBox.x0 + aBox.x1) / 2);
  const aiY = bBox.y1 - aBox.y1;

  // 融合画布 = 原精灵内容包围盒 ∪ AI 图矩形
  const minX = Math.min(bBox.x0, aiX + aBox.x0);
  const minY = Math.min(bBox.y0, aiY + aBox.y0);
  const maxX = Math.max(bBox.x1, aiX + aBox.x1);
  const maxY = Math.max(bBox.y1, aiY + aBox.y1);

  return {
    bBox, aBox, fit, aiX, aiY, minX, minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

/**
 * 相对权重混合的核心公式（两种模式共用）。
 *
 * 两个 alpha 作为「相对权重」烘进 RGB：
 *   ka = ai 像素覆盖 × aiAlpha，kb = 原精灵像素覆盖 × bodyAlpha
 *   AI 先叠，原精灵透出比例 = kb × (1 - ka)；最后按总权重归一化，
 *   避免 bodyAlpha 调低时颜色整体变暗（亮度不该随比例掉）。
 *
 * @param sr sg sb  AI 像素 RGB
 * @param dr dg db  原精灵像素 RGB（已铺在画布上）
 * @param sa        AI 像素 alpha（0~255）
 * @param da        原精灵像素 alpha（0~255）
 * @param alpha     AI 权重（0~1）
 * @param bodyAlpha 原精灵权重（0~1）
 * @returns {[r,g,b]} 混合后的 RGB
 */
function blendRGB(sr, sg, sb, dr, dg, db, sa, da, alpha, bodyAlpha) {
  const ka = (sa / 255) * alpha;
  const kb = (da / 255) * bodyAlpha;
  const denom = ka + kb * (1 - ka);
  if (denom <= 0) return null;
  const ba = da / 255;
  const bgR = ba ? dr : 0, bgG = ba ? dg : 0, bgB = ba ? db : 0;
  return [
    Math.round((sr * ka + bgR * kb * (1 - ka)) / denom),
    Math.round((sg * ka + bgG * kb * (1 - ka)) / denom),
    Math.round((sb * ka + bgB * kb * (1 - ka)) / denom),
  ];
}

module.exports = { contentBox, fitFrame, mergeLayout, blendRGB };
