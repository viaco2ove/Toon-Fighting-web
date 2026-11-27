// 「抽关键帧」air 改写器：每个 action **只替换代表帧**，其余帧保持原精灵。
//
// 与「全替」（air-remap.cjs）的区别：
//   全替：每个 action 的**所有**帧行都换成 `0,<类别 sprite>`
//   抽  ：每个 action 只有**一帧**（代表帧）换成 `0,<类别 sprite>`，其余帧行原样保留
//
// 类别映射的来源：**不用猜的 MUGEN 号段惯例，而是这个包 cns 里实际引用的 anim**。
// 依据：
//   Lin-N.st（站立/受击/倒地）→ stand / hurt / down
//   Lin-S.st（蹲/普通技）    → light / heavy
//   Lin-H.st（跳跃/必杀）    → walk / air / special
// 号段惯例（air-remap.cjs 那套）在这个包上是错的：
//   5000/5010/5020 被当成 down，实际是受击；
//   1200/1250 被当成 air，实际是走位；
//   1400 被当成 special，实际是起手。
//
// 帧行格式：<spriteGroup>, <spriteIndex>, <offsetX>, <offsetY>, <time>[, <AnimType>]
// 紧跟其前的 Clsn1/Clsn2 行是「下一帧行之前生效」的碰撞盒声明，必须原样保留。
'use strict';

// 10 个动作类别 → AI 整帧精灵的 index（sprite 0..9）
const CATEGORIES = [
  { key: 'stand',   sprite: 0, label: '站桩' },
  { key: 'walk',    sprite: 1, label: '行走/移动' },
  { key: 'turn',    sprite: 2, label: '转身' },
  { key: 'light',   sprite: 3, label: '轻拳' },
  { key: 'heavy',   sprite: 4, label: '重拳/踢' },
  { key: 'special', sprite: 5, label: '特殊技' },
  { key: 'hurt',    sprite: 6, label: '受击' },
  { key: 'down',    sprite: 7, label: '倒地' },
  { key: 'air',     sprite: 8, label: '空中' },
  { key: 'guard',   sprite: 9, label: '防御/胜利' },
];

const SPRITE_OF = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.sprite]));

/**
 * action 号 → 类别。**按这个包 cns 的实际引用**建表。
 * 没列到的 action 走 fallback（号段惯例），并被标记为低置信。
 */
const ACTION_CATEGORY = {
  // stand：站立 / 转身前的常态
  stand: [0, 40, 47, 105, 106, 181, 182, 183, 184, 191, 192, 193, 194, 195],
  // light：轻拳等普通技
  light: [200, 205, 210, 215, 220, 225, 230, 235, 240, 250, 255],
  // heavy：重拳 / 踢
  heavy: [300, 305, 310, 350, 355, 360, 365, 370, 375, 400, 410, 420, 430],
  // turn：转身 / 后跳
  turn: [600, 610, 620, 630, 640, 650, 790, 791],
  // walk：前冲 / 走位
  walk: [1000, 1005, 1006, 1010, 1015, 1016, 1017, 1100, 1101, 1150, 1151],
  // air：跳跃 / 空中攻击
  air: [1200, 1201, 1250, 1251, 1300, 1301, 1302, 1350, 1351, 1352, 1353, 1354],
  // special：必杀 / 特殊技
  special: [1400, 1401, 1450, 1451, 1500, 1501, 1550, 1551, 1590, 1600, 1650, 1700,
            1800, 1810, 1820, 1850, 1851, 1855],
  // hurt：受击（cns 里 stateno 5000/5010/5020）
  hurt: [5000, 5001, 5002, 5005, 5006, 5007, 5010, 5011, 5012, 5015, 5016, 5017,
         5020, 5021, 5022, 5025, 5026, 5027, 5030, 5035, 5040, 5050, 5060, 5070,
         5080, 5090, 5100, 5110, 5111, 5120, 5121, 5140, 5150, 5151, 5152, 5156,
         5157, 5160, 5161, 5162, 5170, 5171, 5172],
  // down：倒地 / 起身 / 地面特殊
  down: [5200, 5210, 5300, 9400, 9410, 9500, 9501, 9502, 9503, 9504, 5901],
  // guard：防御 / 胜利姿势（这个包里没有对应 action，留空表）
  guard: [],
};

// 反查表：action 号 → 类别
const CAT_OF_ACTION = {};
for (const cat of Object.keys(ACTION_CATEGORY)) {
  for (const id of ACTION_CATEGORY[cat]) CAT_OF_ACTION[id] = cat;
}

/**
 * 兜底的号段惯例（只在 cns 没引用、也没进表时用）。
 * 置信度低 —— 宁可标成 stand 也不要错替换。
 */
function fallbackCategory(id) {
  if (id >= 5300) return 'down';
  if (id >= 5000) return 'hurt';
  if (id >= 2100 && id < 3000) return id < 2300 ? 'hurt' : 'down';
  if (id >= 1400 && id < 2100) return 'special';
  if (id >= 1200 && id < 1400) return 'air';
  if (id >= 1000 && id < 1200) return 'walk';
  if (id >= 600 && id < 1000) return 'turn';
  if (id >= 400 && id < 600) return 'heavy';
  if (id >= 200 && id < 400) return 'light';
  return 'stand';
}

/**
 * 取 action 的类别。
 * @returns {{cat:string, exact:boolean}}
 */
function classifyAction(id) {
  if (CAT_OF_ACTION[id]) return { cat: CAT_OF_ACTION[id], exact: true };
  return { cat: fallbackCategory(id), exact: false };
}

// 帧行：<group>,<index>,<x>,<y>,<time>[, <AnimType>]
// time 允许负数（-1 = 持续到下一帧）
// 注意：行首/行尾的空白只能用 [ \t]，**不能用 \s** ——
// \s 会匹配 \r\n，把换行符一起吃掉 → 原位替换时行数对不上、字节错位。
// animType 是字母（H/U/D/F/B 等），不是数字；漏掉会整行不被扫描，
// 导致翻转帧永远保持原精灵 → 融合角色每几个动作就闪回白模。
const FRAME_RE = /^([ \t]*)(\d+)[ \t]*,[ \t]*(\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*(?:,[ \t]*([A-Za-z0-9]*)[ \t]*)*$/;

// helper / 特效（group ≥ 7000）：cns 里用 helper / id=7500 直接引用，**不能重映射**
const HELPER_GROUP_MIN = 7000;

/**
 * 解析 air → [{ id, head, body }]
 */
function parseAir(text) {
  const out = [];
  const re = /\[Begin Action \d+\]/gi;
  // 先收集所有 [Begin Action 头的位置，再算每个 body 的区间
  const heads = [];
  let m;
  while ((m = re.exec(text))) {
    heads.push({ index: m.index, head: m[0], id: +(/(\d+)/.exec(m[0]) || [0, 0])[1] });
  }
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const bodyStart = h.index + h.head.length;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].index : text.length;
    out.push({ id: h.id, head: h.head, body: text.slice(bodyStart, bodyEnd), bodyStart, bodyEnd });
  }
  return out;
}

/**
 * 在 body 里找出所有帧行的位置（不破坏原文）。
 * @returns [{start, end, raw, lead, g, n, ox, oy, t, animType}]
 */
function scanFrames(body) {
  const out = [];
  const re = new RegExp(FRAME_RE.source, 'gm');
  let m;
  while ((m = re.exec(body))) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      lead: m[1], g: +m[2], n: +m[3], ox: m[4], oy: m[5], t: +m[6],
      animType: m[7] || undefined,   // 空尾段（"9, , "）按无翻转帧处理，避免重写时留下尾逗号
    });
  }
  return out;
}

/**
 * 找出 action 的代表帧行下标。
 * 规则：身体精灵（非 helper）里**内容高度最大**的那一帧 = 动作幅度最大的瞬间。
 * 负时长帧（-1，持续到下一帧）只在没有正时长候选时才用。
 */
function pickRepresentative(frames, spriteH) {
  let best = -1;
  let bestH = -1;
  let bestNeg = true;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.g >= HELPER_GROUP_MIN) continue;          // helper 不参与
    const h = spriteH(f.g, f.n);
    if (h <= 0) continue;
    const isNeg = f.t < 0;
    if (isNeg && best >= 0 && !bestNeg) continue;  // 有正时长候选就别用负时长的
    if (h > bestH || (h === bestH && isNeg && !bestNeg)) {
      best = i; bestH = h; bestNeg = isNeg;
    }
  }
  return { index: best, height: bestH };
}

/**
 * 「抽」模式改写：只替换代表帧。
 * @param text air 原文
 * @param opts.spriteH (group,index)→高度；用于挑代表帧
 * @param opts.onlyCategories 可选：只对这些类别生效（null = 全部）
 * @param opts.aiGroup AI 精灵所在的 group（每个类别用 aiGroup + sprite）
 * @returns {{text, stats, reps}}
 */
function remapAirSome(text, opts = {}) {
  const spriteH = opts.spriteH || (() => 0);
  const onlyCategories = opts.onlyCategories || null;
  const aiGroup = opts.aiGroup === undefined ? 0 : opts.aiGroup;
  const acts = parseAir(text);
  const stats = { total: 0, replaced: 0, skipped: 0, inexact: 0, byCat: {} };
  const reps = [];
  const edits = [];

  // 原位替换：只动代表帧那一行，其余字节（CRLF 换行、注释、Clsn 行）一字不改
  for (const a of acts) {
    const frames = scanFrames(a.body);
    const { cat, exact } = classifyAction(a.id);
    stats.total++;
    stats.byCat[cat] = (stats.byCat[cat] || 0) + 1;
    if (!exact) stats.inexact++;

    const rep = pickRepresentative(frames, spriteH);
    const allowed = !onlyCategories || onlyCategories.includes(cat);
    if (rep.index < 0 || !allowed) {
      stats.skipped++;
      continue;
    }
    // 只改这一行的 group,index；offset / time / AnimType 原样保留
    const f = frames[rep.index];
    const tail = f.animType !== undefined ? ', ' + f.animType : '';
    const aiSprite = SPRITE_OF[cat];
    const newLine = `${f.lead}${aiGroup + aiSprite}, 0, ${f.ox}, ${f.oy}, ${f.t}${tail}`;
    edits.push({ start: a.bodyStart + f.start, end: a.bodyStart + f.end, newLine });
    stats.replaced++;
    reps.push({
      action: a.id, cat, sprite: aiSprite, group: aiGroup + aiSprite,
      from: `${f.g},${f.n}`, height: rep.height, exact,
    });
  }
  // 从后往前替换，避免偏移量失效
  edits.sort((x, y) => y.start - x.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.newLine + out.slice(e.end);
  return { text: out, stats, reps };
}

/**
 * 列出所有 action 的代表帧（供人工确认用，不改写）。
 */
function listRepresentatives(text, spriteH) {
  const acts = parseAir(text);
  const out = [];
  for (const a of acts) {
    const frames = scanFrames(a.body);
    const rep = pickRepresentative(frames, spriteH);
    if (rep.index < 0) continue;
    const f = frames[rep.index];
    const { cat, exact } = classifyAction(a.id);
    out.push({
      action: a.id,
      cat,
      exact,
      frameIdx: rep.index,
      sprite: `${f.g},${f.n}`,
      height: rep.height,
      time: f.t,
    });
  }
  return out;
}

module.exports = {
  CATEGORIES, classifyAction, parseAir, scanFrames, remapAirSome, listRepresentatives,
  pickRepresentative, SPRITE_OF, HELPER_GROUP_MIN, FRAME_RE,
  ACTION_CATEGORY, CAT_OF_ACTION,
};