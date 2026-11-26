// 「融」模式的**兼容入口** —— 两种透明度语义已拆成独立脚本：
//
//   merge-alpha.cjs   虚化模式：原帧 100%，只把 AI 帧权重乘进 RGB
//                      （mask 不动 → 无挖空、无碎片、边缘干净）
//   merge-binary.cjs  二值模式：原帧可调不透明度（bodyAlpha<1 时 body-only
//                      像素走 4×4 Bayer 抖动 → 方块小碎片）
//   merge-core.cjs    两者共用的几何对齐与相对权重混合公式
//
// 本文件保留是为了不破坏既有调用方（build-merge-char.mjs / 历史脚本）：
//   mergeSprites(body, ai, alpha, bodyAlpha)
//     → bodyAlpha === 1  → 走 mergeAlpha（虚化模式，行为与旧版完全一致）
//     → bodyAlpha <  1  → 走 mergeBinary（二值碎片模式）
//
// 新代码请直接 require 对应的模式脚本，别再走这个 shim。
'use strict';
const { mergeAlpha } = require('./merge-alpha.cjs');
const { mergeBinary } = require('./merge-binary.cjs');
const { contentBox, fitFrame } = require('./merge-core.cjs');

const MERGE_ALPHA = 0.55;
const MERGE_BODY_ALPHA = 1;

/**
 * 兼容入口：按 bodyAlpha 自动选模式。
 * @param body {rgba,w,h,ax,ay}
 * @param ai {rgba,w,h}
 * @param alpha AI 帧权重
 * @param bodyAlpha 原帧权重（<1 → 二值碎片模式）
 * @returns {w,h,rgba,ax,ay}
 */
function mergeSprites(body, ai, alpha = MERGE_ALPHA, bodyAlpha = MERGE_BODY_ALPHA) {
  if (bodyAlpha >= 1) return mergeAlpha(body, ai, alpha);
  return mergeBinary(body, ai, alpha, bodyAlpha, true);
}

module.exports = { MERGE_ALPHA, MERGE_BODY_ALPHA, contentBox, fitFrame, mergeSprites };