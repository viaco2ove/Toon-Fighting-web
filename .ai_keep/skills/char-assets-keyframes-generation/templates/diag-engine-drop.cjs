// 静态复检：按引擎口径算出「有多少精灵会被引擎静默丢弃」。
//
// 为什么需要（2026-11-26，苏晚晴 KFM 实测）：
//   引擎对**非法精灵是静默丢弃的** —— 数据长度对不上 → SetPxl 直接 return
//   → 纹理不生成 → 精灵隐形，**全程零日志**，ff-studio 查看器还照常显示正常。
//   所以「精灵不见了」必须靠这个静态复检定位，不能靠查日志 / 查渲染。
//
// 引擎口径（ikemen-go-web/src/image.go）：
//   readPcxHeader: 只有 encoding==1(RLE) 才把 bpl 存进 s.rle；raw(encoding=0) 时 s.rle=0
//   RlePcxDecode : s.rle<=0 时原样返回字节流 → px 长度 = rleSize
//   SetPxl       : if len(px) != Size[0]*Size[1] { return }   ← 丢弃
//   其中 rleSize 的算法分两支：
//     ps!=0（沿用上一精灵调色板）→ paletteOffset = 块尾 → rleSize = 块尾 - 像素起点
//     ps==0（自带调色板）        → 从块尾往前找 0x0C → rleSize = 标记位置 - 像素起点
//
// 用法: node diag-engine-drop.cjs <file.sff> [...]
// 输出: 「保留 N 引擎丢弃 M」—— M 必须是 0。
'use strict';
const fs = require('fs');
const path = require('path');

const SUB = 32;

function readDir(buf) {
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
  const sprites = readDir(b);
  let dropped = 0, kept = 0;
  const droppedKeys = [];
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
    // raw: px = rle 原样（长度 rleSize）；RLE: RlePcxDecode 输出 w*h
    const pxLen = (enc === 1) ? w * h : rleSize;
    if (pxLen !== w * h) {
      dropped++;
      if (droppedKeys.length < 6) droppedKeys.push(`${s.group},${s.index}(w${w}h${h}enc${enc})`);
    } else kept++;
  }
  return { dropped, kept, droppedKeys };
}

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node diag-engine-drop.cjs <file.sff> [...]'); process.exit(1); }
let total = 0, failed = 0;
for (const p of files) {
  try {
    const r = engineDropCount(p);
    total += r.dropped;
    if (r.dropped) failed++;
    console.log(path.basename(p).padEnd(24), '保留', String(r.kept).padStart(5),
      '引擎丢弃', String(r.dropped).padStart(5), r.droppedKeys.join(' '));
  } catch (e) {
    console.log(path.basename(p).padEnd(24), '跳过：' + e.message);
  }
}
console.log(total ? `\n✗ 共 ${total} 张精灵会被引擎静默丢弃（${failed} 个文件）` : '\n✓ 没有会被丢弃的精灵');
process.exit(total ? 1 : 0);