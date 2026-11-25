// 验证「抽关键帧」包：
//   1) sff 结构完整（精灵数、AI 精灵、白模精灵都在）
//   2) AI 精灵的像素能解出来，且**是彩色**（不是被灰度调色板染掉的）
//   3) air 里每个 action 只有**一行**被换成 AI 精灵，其余帧行原样
//   4) Clsn 碰撞盒行数量与原 air 一致（判定不变）
// 依赖：Node 22 + 同目录的 air-some.cjs / sff-append.cjs / sprite-pack.cjs
//       + 项目 server/lib/sff.cjs（解码器）
//
// 验证「抽关键帧」包：
//   1) sff 结构完整（精灵数、AI 精灵、白模精灵都在）
//   2) AI 精灵的像素能解出来，且**是彩色**（不是被灰度调色板染掉的）
//   3) air 里每个 action 只有**一行**被换成 AI 精灵，其余帧行原样
//   4) Clsn 碰撞盒行数量与原 air 一致（判定不变）
//
// 跑: node verify-kf-char-template.cjs <baseCharDir> <kfDir> [aiGroup]
const fs = require('fs');
const path = require('path');
const { readSffV1Dir, readSpriteBlock } = require('./sff-append.cjs');
const { parseAir, FRAME_RE } = require('./air-some.cjs');

const baseDir = process.argv[2];
const kfDir = process.argv[3];
const aiGroup = Number(process.argv[4] || 6000);

let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fail++;
};

// ---------- 1) sff ----------
console.log('\n[1] SFF 结构');
const baseSffBuf = fs.readFileSync(path.join(baseDir, 'Lin.sff'));
const kfSffBuf = fs.readFileSync(path.join(kfDir, 'LinYuKF.sff'));
const baseDir2 = readSffV1Dir(baseSffBuf);
const kfDir2 = readSffV1Dir(kfSffBuf);
ok(kfDir2.nspr === baseDir2.nspr + 10, `精灵数 ${baseDir2.nspr} → ${kfDir2.nspr}（+10）`);
const baseKeys = new Set(baseDir2.sprites.map((s) => s.group + ',' + s.index));
const kfKeys = new Set(kfDir2.sprites.map((s) => s.group + ',' + s.index));
let missing = 0;
for (const k of baseKeys) if (!kfKeys.has(k)) missing++;
ok(missing === 0, `原有 ${baseKeys.size} 个精灵全部保留（缺 ${missing} 个）`);
// 原文件字节是否保留
// 允许两处改动（本来就必须改）：
//   1) 文件头 +20 的精灵数（777 → 787）
//   2) 最后一个精灵子头的 next 指针（指向新精灵）
const lastBase = baseDir2.sprites[baseDir2.sprites.length - 1];
const allowed = new Set([20, 21, 22, 23, lastBase.ofs, lastBase.ofs + 1, lastBase.ofs + 2, lastBase.ofs + 3]);
let unexpected = 0, firstUnexpected = -1;
for (let i = 0; i < baseSffBuf.length; i++) {
  if (baseSffBuf[i] === kfSffBuf[i]) continue;
  if (allowed.has(i)) continue;
  if (unexpected === 0) firstUnexpected = i;
  unexpected++;
}
ok(unexpected === 0,
  '原 sff 的字节全部保留（只改了精灵数字段和最后一个精灵的 next 指针；意外改动 ' +
  unexpected + ' 字节' + (firstUnexpected >= 0 ? '，首个在 ' + firstUnexpected : '') + '）');
// 白模 group 0 未被覆盖
const g0 = kfDir2.sprites.filter((s) => s.group === 0).map((s) => s.index);
ok(g0.join(',') === '0,1,2,3', '白模 group 0 的 0..3 仍在（未被 AI 精灵覆盖）');
// AI 精灵
const aiSprites = kfDir2.sprites.filter((s) => s.group >= aiGroup && s.group < aiGroup + 10);
ok(aiSprites.length === 10, `AI 精灵 ${aiSprites.length} 个（group ${aiGroup}..${aiGroup + 9}）`);
for (const s of aiSprites) {
  const b = readSpriteBlock(kfSffBuf, s);
  ok(b.palette && b.palette.length === 768, `group ${s.group} 自带 768 字节调色板（ps=${s.ps}）`);
}

// ---------- 2) AI 精灵解出来的颜色与源图一致 ----------
// 注意：不能只看「有多少彩色项」——林羽穿黑卫衣，本色就以灰度为主。
// 正确口径：解出来的精灵像素颜色，应该落在**源图的颜色集合**里
// （即调色板确实来自 AI 图，而不是被 .act 的灰度调色板覆盖）。
console.log('\n[2] AI 精灵颜色（与源图比对）');
const { decodePng } = require('./sprite-pack.cjs');
// 找项目根（含 server/lib/sff.cjs 的目录）—— 模板可能放在任意层级
function findProjectRoot(start) {
  let d = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, 'server', 'lib', 'sff.cjs'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  throw new Error('找不到项目根（含 server/lib/sff.cjs）');
}
const { loadSff: loadSff2, spriteRgba } = require(path.join(findProjectRoot(__dirname), 'server', 'lib', 'sff.cjs'));
const kfSffObj = loadSff2(kfSffBuf);
const frameFiles = fs.readdirSync(path.join(baseDir, 'keyframes', 'keyframes'))
  .filter((f) => /^\d+-\w+\.png$/.test(f)).sort();
for (const s of aiSprites) {
  const img = spriteRgba(kfSffBuf, kfSffObj, s.group, s.index, null);
  if (!img) { ok(false, `group ${s.group} 精灵解不出来`); continue; }
  const src = decodePng(fs.readFileSync(
    path.join(baseDir, 'keyframes', 'keyframes', frameFiles[s.group - aiGroup])));
  const srcColors = new Set();
  for (let i = 0; i < src.w * src.h; i++) {
    if (src.rgba[i * 4 + 3] < 128) continue;
    srcColors.add((src.rgba[i * 4] << 16) | (src.rgba[i * 4 + 1] << 8) | src.rgba[i * 4 + 2]);
  }
  let hit = 0, tot = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.rgba[i * 4 + 3] < 128) continue;
    tot++;
    const r = img.rgba[i * 4], g = img.rgba[i * 4 + 1], b = img.rgba[i * 4 + 2];
    let found = false;
    for (const c of srcColors) {
      if (Math.abs(((c >> 16) & 255) - r) <= 12 &&
          Math.abs(((c >> 8) & 255) - g) <= 12 &&
          Math.abs((c & 255) - b) <= 12) { found = true; break; }
    }
    if (found) hit++;
  }
  const pct = tot ? Math.round((hit / tot) * 100) : 0;
  ok(pct >= 90, `group ${s.group} 颜色 ${pct}% 来自源图（${tot} 像素，源图 ${srcColors.size} 色）`);
}

// ---------- 3) air 改写 ----------
console.log('\n[3] air 改写（每 action 只换一行）');
const baseAir = fs.readFileSync(path.join(baseDir, 'Lin.air'), 'latin1');
const kfAir = fs.readFileSync(path.join(kfDir, 'LinYuKF.air'), 'latin1');
const baseActs = parseAir(baseAir);
const kfActs = parseAir(kfAir);
ok(baseActs.length === kfActs.length, `action 数量 ${baseActs.length} → ${kfActs.length}`);

let multiReplace = 0, changedActs = 0, unchangedActs = 0, badGroup = 0;
for (let i = 0; i < baseActs.length; i++) {
  const bl = baseActs[i].body.split(/\r?\n/);
  const kl = kfActs[i].body.split(/\r?\n/);
  if (bl.length !== kl.length) { console.log(`  ✗ action ${baseActs[i].id} 行数变了`); fail++; continue; }
  let diffs = 0;
  for (let j = 0; j < bl.length; j++) {
    if (bl[j] === kl[j]) continue;
    diffs++;
    const m = FRAME_RE.exec(kl[j]);
    if (!m || +m[2] < aiGroup || +m[2] >= aiGroup + 10) badGroup++;
  }
  if (diffs === 0) unchangedActs++;
  else {
    changedActs++;
    if (diffs > 1) { multiReplace++; console.log(`  ✗ action ${baseActs[i].id} 改了 ${diffs} 行（应为 1）`); fail++; }
  }
}
ok(multiReplace === 0, `每个 action 最多改 1 行（违例 ${multiReplace} 个）`);
ok(badGroup === 0, `改动的行都指向 AI 精灵 group（违例 ${badGroup} 行）`);
console.log(`  · 改了 ${changedActs} 个 action，未改 ${unchangedActs} 个`);

// ---------- 4) Clsn 碰撞盒不变 ----------
console.log('\n[4] Clsn 碰撞盒（判定必须不变）');
const countClsn = (text) => (text.match(/^\s*clsn[12]/gim) || []).length;
const bc = countClsn(baseAir), kc = countClsn(kfAir);
ok(bc === kc, `Clsn 行数 ${bc} → ${kc}`);
// 逐个 action 比对 Clsn 行内容
let clsnDiff = 0;
for (let i = 0; i < baseActs.length; i++) {
  const b = baseActs[i].body.split(/\r?\n/).filter((l) => /^\s*clsn/i.test(l));
  const k = kfActs[i].body.split(/\r?\n/).filter((l) => /^\s*clsn/i.test(l));
  if (b.join('|') !== k.join('|')) clsnDiff++;
}
ok(clsnDiff === 0, `逐 action 比对 Clsn 内容一致（不一致 ${clsnDiff} 个）`);

// ---------- 5) 其余帧行原样 ----------
console.log('\n[5] 未改动的帧行是否与原文件逐字节一致');
let lineDiff = 0;
for (let i = 0; i < baseActs.length; i++) {
  const bl = baseActs[i].body.split(/\r?\n/);
  const kl = kfActs[i].body.split(/\r?\n/);
  for (let j = 0; j < bl.length; j++) {
    if (bl[j] !== kl[j] && !FRAME_RE.test(kl[j])) lineDiff++;
  }
}
ok(lineDiff === 0, `Clsn / 注释 / 空行等非帧行全部原样（差异 ${lineDiff} 行）`);

console.log('\n' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗'));
process.exit(fail === 0 ? 0 : 1);