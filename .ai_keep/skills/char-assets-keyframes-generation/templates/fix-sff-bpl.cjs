// SFF v1 的 bpl 外科修复：把「引擎会丢弃的 raw 精灵」的 bpl 改成 w。
//
// 背景（2026-11-26）：
//   引擎 raw 路径（encoding=0）不做行距换算 —— readPcxHeader 只在 encoding==1 时
//   把 bpl 存进 s.rle；raw 时 s.rle=0，RlePcxDecode 原样返回字节流 → px 长度 = bpl*h。
//   而 SetPxl（src/image.go）要求 len(px) == Size[0]*Size[1] == w*h，否则直接 return，
//   纹理不生成 → **整张精灵隐形，且不报任何错**。
//   所以写出器把 bpl 补成 w+(w&1) 会让所有奇数宽精灵消失。
//
// 本工具只动「ps==0（自带调色板） 且 encoding==0（raw） 且 bpl!=w」的精灵块：
//   - 把 PCX 头里的 bpl 改成 w
//   - 每行去掉行尾的补齐字节
//   - 重排精灵链的 next / size
// 其余字节（精灵数据、调色板、AIR、def）一律逐字节保留。
//
// 用法: node fix-sff-bpl.cjs <file.sff> [...]
// （自包含脚本，无外部依赖；拷到任意机器都能跑）
'use strict';
const fs = require('fs');
const path = require('path');

const SUB = 32;

function readDir(buf) {
  const sig = buf.toString('latin1', 0, 12);
  if (sig !== 'ElecbyteSpr\0') throw new Error('不是 SFF v1');
  if (buf[15] !== 1) throw new Error('不是 SFF v1（版本 ' + buf[15] + '）');
  const nspr = buf.readUInt32LE(20);
  const first = buf.readUInt32LE(24);
  const sprites = [];
  let of = first;
  const seen = new Set();
  for (let i = 0; i < nspr; i++) {
    if (of + SUB > buf.length) throw new Error('精灵目录越界');
    if (seen.has(of)) throw new Error('精灵子头链成环');
    seen.add(of);
    sprites.push({
      i, ofs: of,
      next: buf.readUInt32LE(of),
      size: buf.readUInt32LE(of + 4),
      ax: buf.readInt16LE(of + 8), ay: buf.readInt16LE(of + 10),
      group: buf.readUInt16LE(of + 12), index: buf.readUInt16LE(of + 14),
      link: buf.readUInt16LE(of + 16),
      ps: buf[of + 18],
    });
    if (sprites[i].next === 0) break;
    of = sprites[i].next;
  }
  return sprites;
}

/** 精灵块 = [128B PCX 头][像素行][可选 0x0C + 768B 调色板] */
function parseBlock(buf, sp) {
  const off = sp.ofs + SUB;
  const header = buf.subarray(off, off + 128);
  const enc = header[2];
  const bpl = header.readUInt16LE(66);
  const xmin = header.readUInt16LE(4), xmax = header.readUInt16LE(8);
  const ymin = header.readUInt16LE(6), ymax = header.readUInt16LE(10);
  const w = xmax - xmin + 1, h = ymax - ymin + 1;
  const dataEnd = sp.ofs + SUB + sp.size;     // 块尾
  const pixelsEnd = (sp.ps === 0)
    ? (() => { let p = dataEnd - 769; while (p >= off + 128 && buf[p] !== 0x0c) p--; return p >= off + 128 ? p : dataEnd - 769; })()
    : dataEnd;
  const palette = (sp.ps === 0) ? buf.subarray(pixelsEnd + 1, pixelsEnd + 769) : null;
  return { off, header, enc, bpl, w, h, pixels: buf.subarray(off + 128, pixelsEnd), palette, dataEnd };
}

/** 重排精灵链：保持精灵顺序与内容不变，只更新 next / size / 偏移 */
function repack(buf, sprites, blocks) {
  const out = [];
  let pos = buf.readUInt32LE(24);   // 首个子头偏移（512）
  const offsets = [];
  for (const b of blocks) { offsets.push(pos); pos += SUB + b.length; }
  for (let i = 0; i < sprites.length; i++) {
    const sp = sprites[i];
    const sub = Buffer.from(buf.subarray(sp.ofs, sp.ofs + SUB));
    sub.writeUInt32LE(i + 1 < sprites.length ? offsets[i + 1] : 0, 0);  // next
    sub.writeUInt32LE(blocks[i].length, 4);                              // size
    out.push(sub, blocks[i]);
  }
  const tail = Buffer.concat(out);
  const head = Buffer.from(buf.subarray(0, buf.readUInt32LE(24)));
  const res = Buffer.concat([head, tail]);
  res.writeUInt32LE(sprites.length, 20);
  res.writeUInt32LE(buf.readUInt32LE(24), 24);
  return res;
}

function fixFile(file) {
  const buf = fs.readFileSync(file);
  const sprites = readDir(buf);
  const blocks = [];
  let fixed = 0, fixedKeys = [];

  for (const sp of sprites) {
    const b = parseBlock(buf, sp);
    // 只修 ps==0（自带调色板，块尾有明确 0x0C 标记）+ raw + bpl!=w
    const needFix = sp.ps === 0 && b.enc === 0 && b.bpl !== b.w && b.pixels.length === b.bpl * b.h;
    if (!needFix) {
      blocks.push(buf.subarray(sp.ofs + SUB, sp.ofs + SUB + sp.size));
      continue;
    }
    const header = Buffer.from(b.header);
    header.writeUInt16LE(b.w, 66);              // bpl := w
    const rows = [];
    for (let y = 0; y < b.h; y++) {
      rows.push(Buffer.from(b.pixels.subarray(y * b.bpl, y * b.bpl + b.w)));
    }
    const data = Buffer.concat([header, ...rows, Buffer.from([0x0C]), b.palette]);
    blocks.push(data);
    fixed++;
    if (fixedKeys.length < 5) fixedKeys.push(`${sp.group},${sp.index}(w${b.w}→bpl${b.bpl})`);
  }
  if (!fixed) return { fixed: 0 };
  const res = repack(buf, sprites, blocks);
  fs.writeFileSync(file, res);
  return { fixed, fixedKeys, before: buf.length, after: res.length };
}

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node fix-sff-bpl.cjs <file.sff> [...]'); process.exit(1); }
let total = 0;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('跳过（不存在）', f); continue; }
  const r = fixFile(f);
  total += r.fixed;
  console.log(`${path.basename(f).padEnd(22)} 修复 ${r.fixed} 张精灵` +
    (r.fixed ? ` · ${r.fixedKeys.join(' ')} · ${r.before} → ${r.after} 字节` : ''));
}
console.log('合计修复', total, '张精灵');
