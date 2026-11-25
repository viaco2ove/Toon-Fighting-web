// char-assets-keyframes-generation 模板 —— AI 关键帧落盘脚本
//
// 按 {{...}} 占位符定制三处：REF（类别→白模代表帧）/ CATS / CHAR & PACK 路径。
// 依赖：Node 22 + server/lib/sff.cjs（项目解码器）+ 后端项目的 sharp。
// 跑: node mk-keyframes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require('{{SHARP_PATH}}');   // 如 D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/node_modules/sharp
const { loadSff, spriteRgba, readAct } = require(path.join(root, 'server/lib/sff.cjs'));

// {{路径三件套}}
const CHAR = path.join(root, 'ikemen-fs/file/chars/{{CHAR_ID}}');        // 白模包（引擎侧）
const PACK = path.join(root, 'workshops/toon-fighting-web/map_design/{{STORY_DIR}}/chars/{{CHAR_ID}}');
const SRC_FRAMES = path.join(root, '.cache/ai-frames/{{CHAR_ID}}');      // 已有 AI 图（gen-ai-frames 产物）
const OUT = path.join(PACK, 'keyframes');

// {{REF}}：类别 → 白模代表帧 action。选姿态最典型的帧；候选必须在 air 里存在
//（用关键帧面板或 grep air 确认）。受击/倒地 5000 系常只在 air 有定义（引擎 common1 引用）。
const REF = {
  stand:   { action: {{REF_STAND}},   note: '站立 idle' },
  walk:    { action: {{REF_WALK}},    note: '行走' },
  turn:    { action: {{REF_TURN}},    note: '转身' },
  light:   { action: {{REF_LIGHT}},   note: '轻拳' },
  heavy:   { action: {{REF_HEAVY}},   note: '重拳/踢' },
  special: { action: {{REF_SPECIAL}}, note: '必杀起手' },
  hurt:    { action: 5000, note: '受击（引擎 common1 引用）' },
  down:    { action: 5300, note: '倒地' },
  air:     { action: 40,   note: '跳跃（无 51 时用起跳 40）' },
  guard:   { action: 130,  note: '防御' },
};

const sffBuf = fs.readFileSync(path.join(CHAR, '{{SFF_NAME}}'));   // 如 Lin.sff
const sff = loadSff(sffBuf);
const pal = readAct(fs.readFileSync(path.join(CHAR, '{{DEFAULT_ACT}}'))); // pal.defaults=1 对应的 act
const airText = fs.readFileSync(path.join(CHAR, '{{AIR_NAME}}'), 'utf8');

// 从 air 里取 action 第一帧行引用的精灵 (group,index)
function firstSpriteOf(action) {
  const m = new RegExp('\\[Begin Action ' + action + '\\]([\\s\\S]*?)(?=\\[Begin Action|$)', 'i').exec(airText);
  if (!m) return null;
  const fm = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*,/m.exec(m[1]);
  return fm ? { g: +fm[1], n: +fm[2] } : null;
}

// {{废区裁剪}}：白模底座部分精灵下半带近黑填充废区（原包作者底色填充，特征：
// 从底部开始的连续整行 100% 不透明）。引擎实测不画这些行（走路截图干净），
// 离线渲染按同一几何规则置透明，对齐引擎表现。换底座后必须重测一次引擎。
function refPngBuf(img) {
  const { w, h, rgba } = img;
  const isFullRow = (y) => {
    for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] < 250) return false;
    return true;
  };
  let cutFrom = h;
  for (let y = h - 1; y >= 0; y--) { if (isFullRow(y)) cutFrom = y; else break; }
  const buf8 = new Uint8ClampedArray(rgba);
  for (let y = cutFrom; y < h; y++) for (let x = 0; x < w; x++) buf8[(y * w + x) * 4 + 3] = 0;
  return sharp(Buffer.from(buf8.buffer, buf8.byteOffset, w * h * 4),
    { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

fs.mkdirSync(path.join(OUT, 'reference'), { recursive: true });

// {{manifest 元数据}}：character/style/systemPrompt 从来源目录的 manifest.json 继承（如有）
const srcManifest = fs.existsSync(path.join(SRC_FRAMES, 'manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(SRC_FRAMES, 'manifest.json'), 'utf8')) : {};
const manifest = {
  charId: '{{CHAR_ID}}',
  displayName: '{{DISPLAY_NAME}}',
  base: '{{BASE_PACK_NOTE}}',          // 如：98Ryo（作者 Ehnyd）白模底座
  scheme: '≤10 张 AI 整帧按动作类别替换身体（sprite 0..9），不做贴头',
  generatedAt: srcManifest.generatedAt || null,
  installedAt: new Date().toISOString(),
  character: srcManifest.baseDesc || '{{CHARACTER_DESC}}',
  style: srcManifest.style || 'side-scrolling fighting game sprite, single character, full body, plain background, clean silhouette, thick outlines, flat colors, no background scenery, no text',
  systemPrompt: srcManifest.systemPrompt || 'Generate one single game character sprite on a completely transparent background. The character must be shown full body from head to toe, centered, occupying most of the frame, facing right. No ground, no shadow, no props, no text, no watermark. Transparent background only.',
  frames: [],
};

// {{CATS}}：类别表（key 顺序 = sprite 0..9，与 air-remap.cjs 的 CATEGORIES 对齐）
const CATS = [
  ['stand', '站桩'], ['walk', '行走/移动'], ['turn', '转身'], ['light', '轻拳'],
  ['heavy', '重拳/踢'], ['special', '特殊技'], ['hurt', '受击'], ['down', '倒地'],
  ['air', '空中'], ['guard', '防御/胜利'],
];

const tiles = [];
for (let i = 0; i < CATS.length; i++) {
  const [key, label] = CATS[i];
  const nn = String(i).padStart(2, '0');
  const aiSrc = path.join(SRC_FRAMES, nn + '-' + key + '.png');
  if (!fs.existsSync(aiSrc)) { console.log('缺 AI 图，跳过：', key); continue; }
  const sp = firstSpriteOf(REF[key].action);
  if (!sp) { console.log('air 里找不到 action，跳过：', key, REF[key].action); continue; }
  const img = spriteRgba(sffBuf, sff, sp.g, sp.n, pal);
  if (!img) { console.log('代表帧渲染失败，跳过：', key); continue; }

  const aiDst = path.join(OUT, nn + '-' + key + '.png');
  fs.copyFileSync(aiSrc, aiDst);
  fs.writeFileSync(path.join(OUT, 'reference', nn + '-' + key + '-ref.png'), await refPngBuf(img));
  manifest.frames.push({
    key, label, sprite: i,
    aiFile: nn + '-' + key + '.png',
    refFile: 'reference/' + nn + '-' + key + '-ref.png',
    refAction: REF[key].action, refSprite: sp.g + ',' + sp.n,
    refSize: img.w + 'x' + img.h, refNote: REF[key].note,
  });
  tiles.push({ ref: await refPngBuf(img), ai: aiDst, label: label + ' (' + key + ')',
               meta: { sprite: i, g: sp.g, n: sp.n, w: img.w, h: img.h } });
  console.log('OK', key.padEnd(8), 'AI', path.basename(aiSrc), '↔ 白模', sp.g + ',' + sp.n, img.w + 'x' + img.h);
}

// 对照预览：每类一行 [白模代表帧 | AI 整帧]
(async () => {
  const cellH = 320, pad = 10, labelH = 28;
  const W = 760, H = tiles.length * (cellH + labelH + pad) + 16;
  const composites = [];
  let y = 8;
  for (const t of tiles) {
    const refR = await sharp(t.ref).resize({ height: cellH - 24 }).png().toBuffer();
    const aiR = await sharp(t.ai).resize({ height: cellH - 24 }).png().toBuffer();
    const refM = await sharp(refR).metadata();
    const svg = Buffer.from(
      `<svg width="${W}" height="${labelH}"><text x="14" y="19" font-size="15" fill="#dde3ea" font-family="sans-serif">` +
      `${t.label} · 白模 ${t.meta.g},${t.meta.n}（${t.meta.w}×${t.meta.h}） → AI 整帧 sprite ${t.meta.sprite}</text></svg>`);
    composites.push({ input: svg, top: y, left: 0 });
    composites.push({ input: refR, top: y + labelH, left: 16 });
    composites.push({ input: aiR, top: y + labelH, left: 16 + refM.width + 56 });
    y += cellH + labelH + pad;
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 27, g: 31, b: 38, alpha: 1 } } })
    .composite(composites).png().toFile(path.join(OUT, 'preview.png'));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nmanifest.frames =', manifest.frames.length, '→', path.relative(root, OUT));
})();
