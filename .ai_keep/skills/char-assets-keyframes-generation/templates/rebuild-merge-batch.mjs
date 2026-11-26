// 批量重建「关键帧」变体包（some 抽 / merge 融 / all 全替三种模式），带幂等校验与引擎丢弃复检。
//
// 为什么要有这个（2026-11-26 实测）：
//   写出器的 PCX 行宽 `bpl` 缺陷会让**奇数宽的合成精灵被引擎静默丢弃**
//   （纹理不生成 → 精灵隐形 → 零日志，查看器还照常显示）。
//   一次踩坑要修 11 个包，逐个手敲命令容易漏 —— 所以要一个能批量跑、
//   **自带判据**、**不会把改坏的包装进去**的重建器。
//
// 两个硬判据（任一不过就**不安装**，只报告）：
//   ① AIR 逐字节一致 —— AIR 只依赖底座与类别映射，与 alpha 无关。
//      不一致说明「底座选错了」或「分类口径变了」，必须人工确认。
//   ② 引擎丢弃数 = 0 —— 按引擎口径复算，见 templates/diag-engine-drop.cjs。
//
// ⚠️ 判据①只在「用同一套底座+分类口径重建」时成立。
//   线上包如果有**手工补丁**（本项目 LinYuKF / LinYuKFA 的 AIR 有 H 镜像标志处理），
//   重建会把补丁冲掉 → AIR 不一致 → 判据①会自动拦住。
//   这种包要用外科修复：node templates/fix-sff-bpl.cjs <包>/<id>.sff
//
// 用法:
//   node rebuild-merge-batch.mjs <plan.json> [--dry]
//
// plan.json 格式：
// {
//   "packCharsDir": "workshops/.../chars",       // 变体包所在目录（必填）
//   "aiFramesDir": ".cache/ai-frames",            // AI 图根目录（必填）
//   "outDir": ".cache/mg-build",                  // 重建产物目录（必填）
//   "mode": "merge",                              // some | merge | all（默认 merge）
//   "mergeAlpha": 0.95,                           // merge 模式：AI 图不透明度（默认 0.95）
//   "mergeMode": "binary",                      // merge 模式：alpha=虚化 / binary=二值碎片（默认按 bodyAlpha 自动选）
//   "bodyAlpha": 0.2,                             // merge 模式：原精灵权重（默认 0.2）
//   "packages": [
//     { "id": "SuWanqingKFM",
//       "baseDir": "ff-studio/white-mold/04_异能者/98Athena",
//       "baseSff": "Athena-98.sff", "baseAir": "Athena-98.air", "baseDef": "98Athena.def",
//       "frames": "苏晚晴" }                      // aiFramesDir/<frames> 下的 10 张图
//   ]
// }
//
// baseSff/baseAir/baseDef 可省略（脚本会按后缀搜），但**底座目录里有多个
// def/sff 时必须显式指定** —— 否则会按字母序选错（踩过：LaoLeiKFM 里
// 有 LaoLeiKFM.def / RalfAct.def / ikari.def 三个）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------- 引擎丢弃判定（严格按 ikemen-go-web/src/image.go） ----------------
const SUB = 32;
function readSffDir(buf) {
  if (buf.toString('latin1', 0, 12) !== 'ElecbyteSpr\0') throw new Error('不是 SFF');
  if (buf[15] !== 1) throw new Error('不是 SFF v1（版本 ' + buf[15] + '）');
  const nspr = buf.readUInt32LE(20);
  let of = buf.readUInt32LE(24);
  const sprites = [];
  const seen = new Set();
  for (let i = 0; i < nspr; i++) {
    if (of + SUB > buf.length) throw new Error('精灵目录越界');
    if (seen.has(of)) throw new Error('精灵子头链成环');
    seen.add(of);
    sprites.push({
      i, ofs: of,
      next: buf.readUInt32LE(of),
      size: buf.readUInt32LE(of + 4),
      group: buf.readUInt16LE(of + 12), index: buf.readUInt16LE(of + 14),
      ps: buf[of + 18],
    });
    if (sprites[i].next === 0) break;
    of = sprites[i].next;
  }
  return sprites;
}

function engineDropCount(file) {
  const b = fs.readFileSync(file);
  const sprites = readSffDir(b);
  let dropped = 0, kept = 0;
  for (const s of sprites) {
    if (s.size === 0) continue;                 // 共享块：无自有像素
    const offset = s.ofs + SUB, dataStart = offset + 128;
    const enc = b[offset + 2];
    let blockEnd = s.next > offset ? s.next : offset + s.size;
    if (blockEnd > b.length) blockEnd = b.length;
    let palOff;
    if (s.ps !== 0) {
      palOff = blockEnd;                        // 沿用上一精灵调色板
    } else {
      palOff = -1;                              // 自带调色板：往前找 0x0C
      for (let q = blockEnd - 769; q >= dataStart; q--) {
        if (b[q] === 0x0c) { palOff = q; break; }
      }
      if (palOff < 0) palOff = blockEnd - 769;
    }
    let rleSize = palOff - dataStart; if (rleSize < 0) rleSize = 0;
    const w = b.readUInt16LE(offset + 8) - b.readUInt16LE(offset + 4) + 1;
    const h = b.readUInt16LE(offset + 10) - b.readUInt16LE(offset + 6) + 1;
    const pxLen = (enc === 1) ? w * h : rleSize;
    if (pxLen !== w * h) dropped++; else kept++;
  }
  return { dropped, kept };
}

// ---------------- 主流程 ----------------
const planPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!planPath) {
  console.error('用法: node rebuild-merge-batch.mjs <plan.json> [--dry]');
  console.error('plan.json 格式见本文件头部注释。');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
for (const k of ['packCharsDir', 'aiFramesDir', 'outDir', 'packages']) {
  if (!plan[k]) { console.error('plan.json 缺字段：' + k); process.exit(1); }
}
const ROOT = process.cwd();
const PK = path.resolve(ROOT, plan.packCharsDir);
const AI = path.resolve(ROOT, plan.aiFramesDir);
const OUT = path.resolve(ROOT, plan.outDir);
const ALPHA = plan.mergeAlpha ?? 0.95;
const BODY = plan.bodyAlpha ?? 0.2;
const MODE = plan.mode || 'merge';

// 三种模式各自的组装脚本
const BUILDERS = {
  some:  path.join(__dirname, '..', 'keyframeMode', 'some',  'templates', 'build-kf-char.mjs'),
  merge: path.join(__dirname, '..', 'keyframeMode', 'merge', 'templates', 'build-merge-char.mjs'),
  all:   path.join(__dirname, '..', 'keyframeMode', 'all',   'templates', 'build-all-char.mjs'),
};
if (!BUILDERS[MODE]) {
  console.error('plan.json 的 mode 不认识：' + MODE + '（可选 some / merge / all）');
  process.exit(1);
}
const BUILDER = BUILDERS[MODE];

let fail = 0, ok = 0;
for (const pkg of plan.packages) {
  const id = pkg.id;
  const pkgDir = path.join(PK, id);
  const curAir = path.join(pkgDir, id + '.air');
  const curSff = path.join(pkgDir, id + '.sff');
  if (!fs.existsSync(curAir)) { console.log(`跳过 ${id}（${pkgDir} 里没有）`); continue; }

  const outDir = path.join(OUT, id + '-rebuild');
  fs.rmSync(outDir, { recursive: true, force: true });
  const env = { ...process.env };
  if (pkg.baseSff) env.BASE_SFF = pkg.baseSff;
  if (pkg.baseAir) env.BASE_AIR = pkg.baseAir;
  if (pkg.baseDef) env.BASE_DEF = pkg.baseDef;
  // merge 模式收最后两个不透明度参数 + 模式名；some/all 不收
  const args = [BUILDER, path.resolve(ROOT, pkg.baseDir), path.resolve(AI, pkg.frames), outDir, id];
  if (MODE === 'merge') {
    args.push(String(ALPHA), String(BODY));
    // 融合的透明度语义：alpha=虚化（mask 不动）/ binary=二值碎片（Bayer 抖动）
    // 不传时构建脚本按 bodyAlpha 自动选，与历史行为一致
    args.push(pkg.mergeMode || plan.mergeMode || '');
  }
  try {
    execFileSync(process.execPath, args, { env, stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    console.log(`✗ ${id} 构建失败：\n${(e.stdout || '') + (e.stderr || '')}`);
    fail++; continue;
  }

  const newAir = path.join(outDir, id + '.air');
  const newSff = path.join(outDir, id + '.sff');
  const airSame = fs.readFileSync(curAir).equals(fs.readFileSync(newAir));
  const dropNew = engineDropCount(newSff).dropped;
  const dropOld = engineDropCount(curSff).dropped;
  const mark = airSame && dropNew === 0 ? '✓' : '✗';
  console.log(`${mark} ${id.padEnd(18)} AIR ${airSame ? '一致' : '不一致(!!)'} · 引擎丢弃 ${dropOld} → ${dropNew}`);
  if (!airSame || dropNew !== 0) {
    console.log(`    → 未安装。${!airSame ? 'AIR 不一致：底座选错了或分类口径变了，需人工确认。' : ''}${dropNew ? ' 仍有精灵会被丢弃：写出器有 bpl 缺陷。' : ''}`);
    fail++; continue;
  }

  if (!dry) {
    fs.copyFileSync(newSff, curSff);
    fs.copyFileSync(newAir, curAir);
    const newDef = path.join(outDir, id + '.def');
    if (fs.existsSync(newDef)) fs.copyFileSync(newDef, path.join(pkgDir, id + '.def'));
  }
  ok++;
}
console.log(`\n通过 ${ok} 个，未通过 ${fail} 个${dry ? '（--dry：未写入任何文件）' : '（通过的已安装）'}`);
process.exit(fail ? 1 : 0);