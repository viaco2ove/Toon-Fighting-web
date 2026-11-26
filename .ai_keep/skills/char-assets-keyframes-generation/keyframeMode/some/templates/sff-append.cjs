// SFF v1 读写器：在**保留原文件全部字节**的前提下，追加带自有调色板的精灵。
//
// 为什么需要它：
//   SFF v1 的调色板机制是「每个精灵可自带调色板」（subheader+18 = 1 表示自带，
//   数据块尾部 0x0C 标记后跟 768 字节调色板）。
//   白模（98Ryo）是灰度索引色，靠 def 的 pal1..pal6（.act）着色；
//   AI 帧是彩色，必须自带调色板，否则会被 .act 的灰度调色板染成灰色。
//   所以「抽关键帧」包 = 原 Lin.sff 全部 777 个精灵（一个字节不改）
//   + 10 个带自有彩色调色板的 AI 精灵。
//
// 字节布局（与本项目引擎 src/image.go 一致）：
//   文件头 512B：签名 'ElecbyteSpr\0'，偏移 15 = 版本(1)，
//                 偏移 20 = 精灵数(u32LE)，偏移 24 = 首个精灵子头偏移(u32LE)
//   精灵子头 32B：next(u32) size(u32) ax(i16) ay(i16) group(u16) index(u16)
//                 link(u16) palByte(u8)  ← palByte 在子头 +17
//                 b18(u8) = 「该精灵自带调色板」标志
//   精灵数据：offset = 子头偏移 + 32
//              [0]=0x0A PCX magic, [1]=5 PCX ver, [2]=0 编码(raw),
//              [3]=8 bpp, [8..10]=xmax, [10..12]=ymax, [66]=bpl(u16)
//              之后 bpl*h 行像素，块尾 0x0C 标记 + 768 字节调色板
'use strict';
const fs = require('fs');

// ---------- 精灵子头常量 ----------
const SUB_HEADER_SIZE = 32;
// ps 字节在子头 +18：ps === 0 表示「该精灵自带调色板」（块尾 0x0C 后的 768 字节），
// ps !== 0 表示「沿用上一精灵的调色板」。
// 引擎 src/image.go：paletteSame := ps != 0 && prev != nil
const PS_BYTE_OFFSET = 18;

/**
 * 读取 SFF v1 的精灵子头目录。
 * @returns {{ nspr:number, firstOfs:number, sprites:Array }}
 */
function readSffV1Dir(buf) {
  const sig = buf.toString('latin1', 0, 12);
  if (sig !== 'ElecbyteSpr\0') throw new Error('不是 SFF 文件（签名不符）');
  const ver = buf[15];
  if (ver !== 1) throw new Error('只支持 SFF v1（当前版本 ' + ver + '）');
  const nspr = buf.readUInt32LE(20);
  const firstOfs = buf.readUInt32LE(24);
  const sprites = [];
  let of = firstOfs;
  const seen = new Set();
  for (let i = 0; i < nspr; i++) {
    if (of + SUB_HEADER_SIZE > buf.length) throw new Error('精灵目录越界（第 ' + i + ' 个）');
    if (seen.has(of)) throw new Error('精灵子头链成环');
    seen.add(of);
    const sp = {
      i,
      ofs: of,
      next: buf.readUInt32LE(of),
      size: buf.readUInt32LE(of + 4),
      ax: buf.readInt16LE(of + 8),
      ay: buf.readInt16LE(of + 10),
      group: buf.readUInt16LE(of + 12),
      index: buf.readUInt16LE(of + 14),
      link: buf.readUInt16LE(of + 16),
      ps: buf[of + PS_BYTE_OFFSET],
      // ps === 0 → 自带调色板
      ownPal: buf[of + PS_BYTE_OFFSET] === 0,
    };
    sprites.push(sp);
    if (sp.next === 0) break;
    of = sp.next;
  }
  return { nspr, firstOfs, sprites };
}

/**
 * 取某个精灵的数据块（子头 +32 起，长度 size）。
 * 末尾 0x0C 标记后的 768 字节是调色板（仅 ownPal=true 时存在）。
 */
function readSpriteBlock(buf, sp) {
  const dataOfs = sp.ofs + SUB_HEADER_SIZE;
  const block = buf.subarray(dataOfs, dataOfs + sp.size);
  // 找块尾的 0x0C 调色板标记
  let palAt = -1;
  for (let pos = block.length - 769; pos >= 128; pos--) {
    if (block[pos] === 0x0C) { palAt = pos; break; }
  }
  const pixEnd = palAt >= 0 ? palAt : block.length;
  const palette = palAt >= 0 ? block.subarray(palAt + 1, palAt + 1 + 768) : null;
  return {
    dataOfs,
    header: block.subarray(0, 128),
    pixels: block.subarray(128, pixEnd),
    palette,
  };
}

/**
 * 构造一个带自有调色板的精灵数据块。
 * @param px Uint8Array 索引色像素（宽×高），0 = 透明
 * @param palette Uint8Array|Buffer 768 字节（RGB 三元组）
 */
function buildOwnPalBlock(px, w, h, palette, ax, ay) {
  // bpl 必须**等于** w，不能补偶数。
  //
  // 引擎 raw 路径（encoding=0）不做任何行距换算：
  //   readPcxHeader: 只有 encoding==1 才把 bpl 存进 s.rle；raw 时 s.rle = 0
  //   RlePcxDecode:  s.rle<=0 时原样返回字节流 → px 长度 = rleSize = bpl*h
  //   SetPxl:       if len(px) != Size[0]*Size[1] { return }  ← 纹理不生成 → 精灵隐形
  // 而 Size = w*h。**bpl ≠ w 时整张精灵被引擎静默丢弃，且不报任何错**。
  // 宽度为奇数时 bpl=w+1 → bpl*h ≠ w*h → 精灵消失（2026-11-26 苏晚晴 KFM 实测）。
  const bpl = w;
  const header = Buffer.alloc(128);
  header[0] = 0x0A;                    // PCX magic
  header[1] = 5;                       // PCX version
  header[2] = 0;                       // 编码 = raw（不压缩）
  header[3] = 8;                       // bpp
  header.writeUInt16LE(0, 4);          // xmin
  header.writeUInt16LE(0, 6);          // ymin
  header.writeUInt16LE(w - 1, 8);      // xmax
  header.writeUInt16LE(h - 1, 10);     // ymax
  header.writeUInt16LE(72, 12);        // hres
  header.writeUInt16LE(72, 14);        // vres
  header[65] = 1;                      // planes
  header.writeUInt16LE(bpl, 66);       // bytes per line
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.from(px.subarray(y * w, (y + 1) * w));
    const padded = Buffer.alloc(bpl);
    row.copy(padded);
    rows.push(padded);
  }
  return Buffer.concat([
    header, ...rows, Buffer.from([0x0C]), Buffer.from(palette),
  ]);
}

/**
 * 在原 SFF v1 尾部追加精灵，原有字节一个不动。
 *
 * 做法：
 *   1. 找到最后一个精灵（next === 0）的数据块结束位置 = 文件末尾
 *      （原文件的精灵块是连续排列的，next 链就是物理顺序）
 *   2. 新精灵接在文件末尾，它的 next 指向自己（0）→ 作为新链尾
 *   3. 原来最后一个精灵的 next 改成新精灵的子头偏移
 *   4. 文件头精灵数 +1
 *
 * @param buf 原 SFF 字节
 * @param spritesToAppend [{group,index,ax,ay,px,w,h,palette}]
 * @returns {{buf:Buffer, added:number}}
 */
function appendSprites(buf, spritesToAppend) {
  if (!spritesToAppend.length) return { buf, added: 0 };
  const dir = readSffV1Dir(buf);
  if (!dir.sprites.length) throw new Error('SFF 里没有精灵');
  const last = dir.sprites[dir.sprites.length - 1];

  // 原文件末尾 = 最后一个精灵块结束处
  const lastBlock = readSpriteBlock(buf, last);
  let end = lastBlock.dataOfs + last.size;

  const out = Buffer.from(buf);           // 拷贝一份
  const newSubHeaders = [];
  const newBlocks = [];

  for (const sp of spritesToAppend) {
    const block = buildOwnPalBlock(sp.px, sp.w, sp.h, sp.palette, sp.ax, sp.ay);
    const sub = Buffer.alloc(SUB_HEADER_SIZE);
    sub.writeUInt32LE(0, 0);                      // next（稍后回填）
    sub.writeUInt32LE(block.length, 4);           // size
    sub.writeInt16LE(sp.ax | 0, 8);               // axis x
    sub.writeInt16LE(sp.ay | 0, 10);              // axis y
    sub.writeUInt16LE(sp.group, 12);
    sub.writeUInt16LE(sp.index, 14);
    sub.writeUInt16LE(0, 16);                     // link
    sub[PS_BYTE_OFFSET] = 0;                      // ps=0 → 读自己的调色板
    newSubHeaders.push(sub);
    newBlocks.push(block);
  }

  // 物理布局：新块紧跟原文件末尾；子头在块之前（next 指向下一个块的子头）
  let pos = end;
  const offsets = [];
  for (const block of newBlocks) {
    offsets.push(pos);
    pos += SUB_HEADER_SIZE + block.length;
  }
  // 子头写在块前面，所以要重排：先算每块的整体起点
  const starts = [];
  let p = end;
  for (const block of newBlocks) {
    starts.push(p);
    p += SUB_HEADER_SIZE + block.length;
  }
  // 组装：[sub0][block0][sub1][block1]...
  const tail = [];
  for (let i = 0; i < newBlocks.length; i++) {
    const sub = newSubHeaders[i];
    const nextSub = i + 1 < newBlocks.length ? starts[i + 1] : 0;
    sub.writeUInt32LE(nextSub, 0);
    tail.push(sub, newBlocks[i]);
  }

  const outBuf = Buffer.concat([out, Buffer.concat(tail)]);

  // 回填原最后一个精灵的 next → 第一个新子头
  outBuf.writeUInt32LE(starts[0], last.ofs);
  // 文件头精灵数 +n
  outBuf.writeUInt32LE(dir.nspr + spritesToAppend.length, 20);
  return { buf: outBuf, added: spritesToAppend.length };
}

module.exports = {
  readSffV1Dir, readSpriteBlock, buildOwnPalBlock, appendSprites,
  SUB_HEADER_SIZE, PS_BYTE_OFFSET,
};
