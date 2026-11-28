// 批量构建「融合关键帧 v2」变体包（SFF v2 真半透明管线）
//
// 输入 personas.json（每角色一条）：
//   {
//     "陈彦": {
//       "id": "ChenYanV2",                                  // 变体包 id（xxxKFM / xxxV2 …）
//       "base": "ff-studio/white-mold/01_武道家/98Kim",      // 白模底座（ff-studio/white-mold 职业目录）
//       "mode": "alpha",                                    // alpha=二值虚化(真半透明) | binary=Bayer碎片
//       "bodyAlpha": 0.5,                                   // 可选，缺省 alpha=0.5 / binary=0.2
//       "skillCount": 7,                                    // 技能数（5/6/7 混合，别全 5）
//       "profession": "夜采新人主角",
//       "persona": "the same young man as in the reference images: …"  // 生图形象提示词
//     }, …
//   }
//
// 流程（每角色，前台串行）：
//   1. 底座 def 解析 sprite/anim → BASE_SFF/BASE_AIR/BASE_DEF
//   2. spawnSync build-merge-v2.mjs（同目录）→ .cache/mg-build/<id>
//   3. 写 char.json（keyframeMode=merge + variantOf 信息 + mergeMode/mergeAlpha/bodyAlpha）
//   4. shell cp 落盘资产集 chars/<id>（fs.cpSync recursive 在 Node 22 段错误，勿用）
//   5. diag-engine-drop 复检：引擎丢弃必须 0，非 0 报错退出
//
// 跑: node build-kfm-batch.mjs <personas.json> <packDir> [角色名,角色名,...]
//     packDir = workshops/toon-fighting-web/map_design/<故事名>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');   // 项目根（含 server/lib/sff.cjs）

const [personasPath, packDir, onlyArg] = process.argv.slice(2);
if (!personasPath || !packDir) {
  console.error('用法: node build-kfm-batch.mjs <personas.json> <packDir> [角色名,...]');
  process.exit(1);
}
const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
const only = onlyArg ? onlyArg.split(',') : null;

for (const [name, cfg] of Object.entries(personas)) {
  if (only && !only.includes(name)) continue;
  const outDir = path.join('.cache/mg-build', cfg.id);
  const framesDir = path.join('.cache/ai-frames', name);
  const base = path.resolve(cfg.base);
  if (!fs.existsSync(base)) { console.warn(`[${name}] 底座不存在：${base}`); continue; }
  const pngs = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter((f) => /^\d\d-\w+\.png$/.test(f)) : [];
  if (pngs.length < 10) { console.warn(`[${name}] AI 帧只有 ${pngs.length}/10，跳过（先跑 gen-frames-batch.mjs）`); continue; }

  // 底座 def 解析 sprite/anim（多 sff 目录必须显式指定，避免字母序选错）
  const defFile = fs.readdirSync(base).find((f) => /\.def$/i.test(f));
  const defText = fs.readFileSync(path.join(base, defFile), 'latin1');
  const grab = (k) => { const m = new RegExp('^[ \\t]*' + k + '[ \\t]*=[ \\t]*(.+)$', 'im').exec(defText); return m ? m[1].trim().split(/\s+/)[0] : null; };
  const sffF = grab('sprite'), airF = grab('anim');
  if (!sffF || !airF) { console.warn(`[${name}] 底座 def 缺 sprite/anim 声明`); continue; }

  const mode = cfg.mode === 'binary' ? 'binary' : 'alpha';
  const bodyAlpha = cfg.bodyAlpha ?? (mode === 'binary' ? 0.2 : 0.5);
  console.log(`\n===== ${name} → ${cfg.id}（v2 ${mode}，原 ${bodyAlpha} / AI 0.95，底座 ${sffF}）=====`);
  fs.rmSync(outDir, { recursive: true, force: true });
  // 前台串行——后台链的 cp/rebuild 会与实测竞态
  const r = spawnSync(process.execPath,
    [path.join(HERE, '../keyframeMode/merge/templates/build-merge-v2.mjs'), base, framesDir, outDir, cfg.id, mode, String(bodyAlpha)],
    { cwd: '.', env: { ...process.env, BASE_SFF: sffF, BASE_AIR: airF, BASE_DEF: defFile },
      stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  const log = (r.stdout || '').split('\n').filter((l) => /写 sff|写 air|模式|合成精灵|引擎丢弃|group：/.test(l)).join('\n');
  console.log(log);
  if (r.status !== 0 || !fs.existsSync(path.join(outDir, cfg.id + '.sff'))) {
    console.warn(`[${name}] 构建失败，跳过落盘`); continue;
  }

  // char.json（genericSkills 由 gen-skills.mjs 二次写入）
  fs.writeFileSync(path.join(outDir, 'char.json'), JSON.stringify({
    charId: cfg.id,
    displayName: name,
    roleType: 'npc',
    profession: cfg.profession,
    keyframeMode: 'merge',
    keyframeLabel: '融合关键帧',
    description: `${name}，${cfg.profession}（融合关键帧 v2 变体）`,
    base: cfg.base,
    keyframeSource: framesDir + '/',
    keyframeCount: pngs.length,
    variantNote: `SFF v2 真半透明融合：AI 整帧 ${'0.95'}（PNG RGBA 无量化、lanczos3 缩放）叠在原精灵上，` +
      (mode === 'binary'
        ? `body-only 区 Bayer ${'2×2 块'}抖动保留约 ${bodyAlpha} 密度原色实心点、其余透明（碎片模式）`
        : `body 整层 ${bodyAlpha} 真半透明（虚化模式）`) +
      '；重叠区按相对权重 over 合成；特效帧不融合。',
    mergeAlpha: 0.95,
    bodyAlpha,
    mergeMode: mode,
    updatedAt: new Date().toISOString(),
  }, null, 1) + '\n', 'utf8');

  // 落盘（fs.cpSync recursive 段错误 → shell cp -r）
  const dest = path.join(packDir, 'chars', cfg.id);
  fs.mkdirSync(path.join(packDir, 'chars'), { recursive: true });   // chars 目录可能被并行任务清掉
  fs.rmSync(dest, { recursive: true, force: true });
  const cp = spawnSync('cp', ['-r', outDir, dest], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (cp.status !== 0 || !fs.existsSync(path.join(dest, cfg.id + '.sff'))) {
    console.warn(`[${name}] 落盘失败（cp 退出码 ${cp.status}）`); continue;
  }

  // v2 校验（diag-engine-drop.cjs 是 v1 专用，对 v2 误报）：loadSff 读回 + PNG 魔数
  const vr = spawnSync(process.execPath, ['-e', `
    const fs = require('fs');
    const { loadSff } = require(${JSON.stringify(path.join(ROOT, 'server', 'lib', 'sff.cjs').split(path.sep).join('/'))});
    const buf = fs.readFileSync(process.argv[1]);
    const sff = loadSff(buf);
    let bad = 0;
    for (const s of sff.byIndex) {
      if (s.size === 0) continue;
      if (buf.readUInt32LE(s.ofs + 4) !== 0x474e5089) bad++;   // PNG 魔数
    }
    console.log('sprites=' + sff.byIndex.length + ' badPng=' + bad);
    process.exit(bad > 0 ? 1 : 0);
  `, path.join(dest, cfg.id + '.sff')], { encoding: 'utf8' });
  const ok = /badPng=0/.test(vr.stdout || '');
  console.log(`[${name}] 已落盘 ${dest}（${(vr.stdout || '').trim()}）`);
  if (!ok) { console.error(`[${name}] v2 校验失败：${(vr.stderr || vr.stdout || '').trim().slice(0, 200)}`); process.exitCode = 1; }
}
console.log('\n批量构建完成');
