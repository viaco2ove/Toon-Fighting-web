// 10 张 AI 整帧图 → 一个可跑的 MUGEN 角色包骨架
//
// 产物：
//   <out>/<id>.sff   —— 只有 10 个精灵（group 0，index 0..9）+ 一个基础调色板
//   <out>/<id>.air   —— 把原包的 action 全部重写：精灵换成 10 张之一，
//                       **但 Clsn1/Clsn2 碰撞盒行原样保留** → 攻击判定不变
//
// 为什么要保留 Clsn：MUGEN 的碰撞盒写在 air 的帧行里（不是精灵像素里），
// 引擎 getClsn() 直接读 AnimFrame.Clsn1/Clsn2。只换精灵号、不动 Clsn 行，
// 判定与原角色完全一致——这是本方案能做「不贴头、不改判定」的关键。
//
// 字节格式以本项目引擎 ../Toon-WebMUGEN-2.0/ikemen-go-web/src/image.go 为准。
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- 最小 PNG 编码（RGBA8） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(...parts) { let c = 0xffffffff; for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typ = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typ, data), 0);
  return Buffer.concat([len, typ, data, crc]);
}
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- PNG 解码（只要支持本项目生成/AI 生成的 8 位 RGBA / RGB / 调色板 PNG） ----------
function decodePng(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('不是 PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const typ = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (typ === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (typ === 'PLTE') plte = Buffer.from(body);
    else if (typ === 'tRNS') trns = Buffer.from(body);
    else if (typ === 'IDAT') idat.push(Buffer.from(body));
    else if (typ === 'IEND') break;
    off += 12 + len;
  }
  if (interlace) throw new Error('不支持隔行 PNG');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('未知颜色类型 ' + ctype);
  const bpp = Math.ceil(channels * depth / 8);
  const stride = Math.ceil(w * channels * depth / 8);
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  // 统一成 RGBA8
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + x * channels * (depth / 8);
      const d = (y * w + x) * 4;
      if (ctype === 6 && depth === 8) { rgba[d] = out[o]; rgba[d + 1] = out[o + 1]; rgba[d + 2] = out[o + 2]; rgba[d + 3] = out[o + 3]; }
      else if (ctype === 2 && depth === 8) { rgba[d] = out[o]; rgba[d + 1] = out[o + 1]; rgba[d + 2] = out[o + 2]; rgba[d + 3] = 255; }
      else if (ctype === 6 && depth === 16) { rgba[d] = out[o]; rgba[d + 1] = out[o + 2]; rgba[d + 2] = out[o + 4]; rgba[d + 3] = out[o + 6]; }
      else if (ctype === 2 && depth === 16) { rgba[d] = out[o]; rgba[d + 1] = out[o + 2]; rgba[d + 2] = out[o + 4]; rgba[d + 3] = 255; }
      else if (ctype === 3) { const i = out[o]; rgba[d] = plte[i * 3]; rgba[d + 1] = plte[i * 3 + 1]; rgba[d + 2] = plte[i * 3 + 2]; rgba[d + 3] = (trns && i < trns.length) ? trns[i] : 255; }
      else { const v = out[o]; rgba[d] = v; rgba[d + 1] = v; rgba[d + 2] = v; rgba[d + 3] = 255; }
    }
  }
  return { w, h, rgba };
}

// ---------- 量化到 8 位索引色（PNG 透明底 + 索引色，IKEMEN 完整支持） ----------
// 保留 alpha：透明像素写 0，其余按 RGB 量化到 1..255。
function quantize(rgba, w, h, maxColors = 255) {
  // 收集不透明像素的颜色直方图
  const hist = new Map();
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const pal = new Uint8Array(256 * 3);
  const palCount = Math.min(maxColors, Math.max(1, sorted.length));
  // 索引 0 保留给透明
  const lut = new Map();
  for (let i = 0; i < palCount; i++) {
    const k = sorted[i][0];
    const idx = i + 1;
    pal[idx * 3] = (k >> 16) & 255; pal[idx * 3 + 1] = (k >> 8) & 255; pal[idx * 3 + 2] = k & 255;
    lut.set(k, idx);
  }
  const px = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) { px[i] = 0; continue; }
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let idx = lut.get(key);
    if (idx === undefined) {
      // 未在直方图里（理论上不会发生）→ 找最近色
      let bd = Infinity; idx = 1;
      for (let j = 1; j <= palCount; j++) {
        const dr = rgba[i * 4] - pal[j * 3], dg = rgba[i * 4 + 1] - pal[j * 3 + 1], db = rgba[i * 4 + 2] - pal[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; idx = j; }
      }
    }
    px[i] = idx;
  }
  return { px, palette: pal };
}

// ---------- SFF v1 写出 ----------
// 结构：512 字节头 + N 个（32 字节子头 + 数据块）
// 数据块 = 128 字节 PCX 头 + 原始像素行（bpl 对齐）+ [0x0C + 768 字节调色板]
// 第一个精灵（0,0）必须带调色板 —— 引擎的 legacy 路径把它当全文件真源。
function buildSffV1(sprites) {
  // 头：签名 + 版本 + 精灵数 + 首精灵头偏移 + 调色板数
  const header = Buffer.alloc(512);
  header.write('ElecbyteSpr\0', 0, 'latin1');
  header[15] = 1;                     // verhi = 1（SFF v1）
  header.writeUInt32LE(sprites.length, 20);
  header.writeUInt32LE(512, 24);      // FirstSpriteHeaderOffset

  const blocks = [];
  for (const sp of sprites) {
    const { px, w, h, palette } = sp;
    const bpl = w + (w & 1);
    const data = Buffer.alloc(128);
    data[0] = 0x0A;                   // PCX magic（引擎兼作 paletteSame 标志，须为 0x0A）
    data[1] = 5;                      // PCX version
    data[2] = 0;                      // encoding = raw
    data[3] = 8;                      // bpp
    data.writeUInt16LE(0, 4);          // xmin
    data.writeUInt16LE(0, 6);          // ymin
    data.writeUInt16LE(w - 1, 8);
    data.writeUInt16LE(h - 1, 10);
    data.writeUInt16LE(72, 12);        // hres
    data.writeUInt16LE(72, 14);        // vres
    data[65] = 1;                      // planes
    data.writeUInt16LE(bpl, 66);       // bpl
    const rows = [];
    for (let y = 0; y < h; y++) {
      const row = Buffer.from(px.subarray(y * w, (y + 1) * w));
      const padded = Buffer.alloc(bpl);
      row.copy(padded);
      rows.push(padded);
    }
    // 块尾调色板：0x0C 标记 + 768 字节
    blocks.push(Buffer.concat([data, ...rows, Buffer.from([0x0C]), Buffer.from(palette)]));
  }
  // 计算每个精灵块的偏移与 next 链
  const offsets = [];
  let pos = 512;
  for (const b of blocks) { offsets.push(pos); pos += 32 + b.length; }
  const out = [header];
  for (let i = 0; i < sprites.length; i++) {
    const sub = Buffer.alloc(32);
    sub.writeUInt32LE(i + 1 < sprites.length ? offsets[i + 1] : 0, 0);  // next
    sub.writeUInt32LE(blocks[i].length, 4);                                // size
    sub.writeInt16LE(sprites[i].axis[0] || 0, 8);                          // axis x
    sub.writeInt16LE(sprites[i].axis[1] || 0, 10);                         // axis y
    sub.writeUInt16LE(sprites[i].group, 12);
    sub.writeUInt16LE(sprites[i].index, 14);
    sub.writeUInt16LE(0, 16);                                             // link
    out.push(sub, blocks[i]);
  }
  return Buffer.concat(out);
}

module.exports = { encodePng, decodePng, quantize, buildSffV1 };