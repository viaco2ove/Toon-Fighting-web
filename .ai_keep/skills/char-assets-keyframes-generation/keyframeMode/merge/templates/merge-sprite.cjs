// 「融」模式的核心：把 AI 整帧与原精灵**逐像素合成**成一个精灵。
//
// 为什么必须烘焙（bake）而不是运行时叠加：
//   MUGEN 的 air 帧行一次只能画**一个**精灵，没有「两个精灵叠加」的表达力。
//   所以「AI 图 + 原精灵一起显示」只能在构建期合成为一张图，
//   运行时就跟普通精灵一样（效果等价，代价是包体变大）。
//
// 合成规则（对应 ff-studio 查看器的 merge 模式预览）：
//   out.rgb = ai.rgb * (aiAlpha * MERGE_ALPHA) + body.rgb * (1 - aiAlpha * MERGE_ALPHA)
//   out.a   = max(bodyAlpha, aiAlpha)
//   → AI 图半透明叠在原精灵上，两者都能看出来（原精灵的姿势/明暗 + AI 的配色）。
//
// 几何对齐：
//   AI 图按**原精灵的内容高度**缩放（这样每帧的融合图大小跟原帧一致），
//   内容中心与原精灵内容中心对齐、内容底边与原精灵内容底边对齐。
//   融合后的画布 = 原精灵内容包围盒 ∪ AI 图矩形；锚点沿用原精灵的锚点
//   （加上画布偏移），这样 air 的帧偏移不用改。
'use strict';

// 融合时 AI 图的不透明度（与 viewer 的 state.aiMergeAlpha 一致）
const MERGE_ALPHA = 0.55;

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
 * 把 AI 图与原精灵合成一个精灵。
 *
 * @param body  {rgba,w,h,ax,ay}  原精灵（已解成 RGBA）
 * @param ai    {rgba,w,h}         AI 整帧（原图，未缩放）
 * @param alpha MERGE_ALPHA
 * @returns {w,h,rgba,ax,ay}      融合后的精灵（自带锚点）
 */
function mergeSprites(body, ai, alpha = MERGE_ALPHA) {
  const bBox = contentBox(body.rgba, body.w, body.h);
  if (!bBox) return null;                       // 原精灵全透明 → 无从融起

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
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const out = new Uint8Array(w * h * 4);

  // 1) 先铺原精灵（整体搬到画布）
  for (let y = bBox.y0; y <= bBox.y1; y++) {
    for (let x = bBox.x0; x <= bBox.x1; x++) {
      const so = (y * body.w + x) * 4;
      const dof = ((y - minY) * w + (x - minX)) * 4;
      out[dof] = body.rgba[so]; out[dof + 1] = body.rgba[so + 1];
      out[dof + 2] = body.rgba[so + 2]; out[dof + 3] = body.rgba[so + 3];
    }
  }

  // 2) 再把 AI 图按 alpha 叠上去
  for (let y = aBox.y0; y <= aBox.y1; y++) {
    for (let x = aBox.x0; x <= aBox.x1; x++) {
      const sa = fit.rgba[(y * fit.w + x) * 4 + 3];
      if (sa === 0) continue;
      const k = (sa / 255) * alpha;
      const px = aiX + x, py = aiY + y;
      const dof = ((py - minY) * w + (px - minX)) * 4;
      const sr = fit.rgba[(y * fit.w + x) * 4];
      const sg = fit.rgba[(y * fit.w + x) * 4 + 1];
      const sb = fit.rgba[(y * fit.w + x) * 4 + 2];
      const dr = out[dof], dg = out[dof + 1], db = out[dof + 2], da = out[dof + 3];
      const ba = da / 255;
      // 先把原精灵当背景（按 alpha 预乘合成），再叠 AI
      const bgR = ba ? dr : 0, bgG = ba ? dg : 0, bgB = ba ? db : 0;
      out[dof] = Math.round(sr * k + bgR * (1 - k));
      out[dof + 1] = Math.round(sg * k + bgG * (1 - k));
      out[dof + 2] = Math.round(sb * k + bgB * (1 - k));
      out[dof + 3] = Math.max(da, sa);
    }
  }

  // 锚点：原精灵锚点平移到新画布
  const ax = body.ax - minX;
  const ay = body.ay - minY;
  return { w, h, rgba: out, ax, ay };
}

module.exports = { MERGE_ALPHA, contentBox, fitFrame, mergeSprites };