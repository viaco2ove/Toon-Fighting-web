// MUGEN 资源解码：SFF（v1 / v2）精灵 + ACT / PNG 调色板 → RGBA 像素。
// 只读、纯函数、无依赖，供头像提取工具 / serve.cjs 启动期生成 / 安卓同步脚本共用。
//
// 字节布局以本项目引擎自己的解析器为准（上游 ikemen-go-web/src/image.go：
// SffHeader.Read / readHeader / readHeaderV2 / readV2 / loadPalettes / readActPalette），
// 并与 bitcraft/mugen-tools 的 sff.py 交叉核对过。
'use strict';

// ---------- 基础读取 ----------
class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  seek(p) { this.p = p; }
  u8() { return this.b[this.p++]; }
  u16() { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  i16() { const v = this.u16(); return v & 0x8000 ? v - 0x10000 : v; }
  u32() { const v = (this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] << 24)) >>> 0; this.p += 4; return v; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
}

// ---------- 调色板 → 0xAARRGGBB（与引擎内存布局一致：alpha<<24 | b<<16 | g<<8 | r） ----------
function pack(r, g, b, a) { return ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0; }

// ACT：768 字节 = 256 × (R,G,B)。
// 引擎把文件里的第 j 组颜色写到调色板下标 255-j（readActPalette 的 destIdx = 255 - i），
// 下标 0 强制透明。这里保持与引擎完全一致的映射，头像才和对局里看到的颜色相同。
function readAct(buf) {
  const pal = new Array(256).fill(0);
  const n = Math.floor(Math.min(buf.length, 768) / 3);
  for (let i = 0; i < n; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    pal[255 - i] = pack(r, g, b, 255 - i === 0 ? 0 : 255);
  }
  return pal;
}

// 调色板也可以是带 PLTE 的索引 PNG（引擎 readPngPalette）：自然顺序，下标 0 透明。
function readPngPalette(buf) {
  const SIG = '\x89PNG\r\n\x1a\n';
  if (buf.length < SIG.length) return null;
  let sig = '';
  for (let i = 0; i < SIG.length; i++) sig += String.fromCharCode(buf[i]);
  if (sig !== SIG) return null;
  const pal = new Array(256).fill(0);
  for (let i = 8; i + 8 <= buf.length;) {
    const ln = (buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3]) >>> 0;
    const typ = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    if (ln > buf.length - i - 8) return null;
    if (typ === 'PLTE') {
      const n = Math.min(256, Math.floor(ln / 3));
      for (let j = 0; j < n; j++) {
        pal[j] = pack(buf[i + 8 + j * 3], buf[i + 9 + j * 3], buf[i + 10 + j * 3], j === 0 ? 0 : 255);
      }
      return pal;
    }
    if (typ === 'IEND') break;
    i += 12 + ln;
  }
  return null;
}

function readPaletteFile(buf) {
  const png = readPngPalette(buf);
  if (png) return png;
  if (buf.length >= 8 && readPngPalette(buf.subarray(0, 8)) === null && buf[0] === 0x89 && buf[1] === 0x50) {
    throw new Error('调色板 PNG 没有 PLTE 块（不是索引 PNG）');
  }
  return readAct(buf);
}

// ---------- SFF 文件头 / 精灵目录 ----------
function parseSff(buf) {
  const r = new Reader(buf);
  let sig = '';
  for (let i = 0; i < 12; i++) sig += String.fromCharCode(buf[i]);
  if (sig !== 'ElecbyteSpr\0') throw new Error('不是 SFF 文件（签名不符）');
  r.seek(15);
  const ver = r.u8(); // 引擎用偏移 15 这一个字节判版本（1 / 2）
  if (ver !== 1 && ver !== 2) throw new Error('不认识的 SFF 版本：' + ver);
  r.seek(16); r.u32();
  const h = { ver };
  if (ver === 1) {
    h.nspr = r.u32();
    h.sprOfs = r.u32();
  } else {
    r.seek(36);
    h.sprOfs = r.u32(); h.nspr = r.u32();
    h.palOfs = r.u32(); h.npal = r.u32();
    h.lofs = r.u32(); r.u32(); h.tofs = r.u32();
  }
  return h;
}

function paletteOfIndex(sff, idx) {
  let hops = 0;
  while (sff.pals[idx].link >= 0 && sff.pals[idx].colors === null) {
    if (++hops > 64) throw new Error('SFFv2 调色板链接成环');
    idx = sff.pals[idx].link;
  }
  return sff.pals[idx].colors || new Array(256).fill(0);
}

// ---------- 对外：解析整个 SFF（只解目录与调色板表，像素按需解码） ----------
function loadSff(buf) {
  const h = parseSff(buf);
  const r = new Reader(buf);
  const sff = { ver: h.ver, sprites: new Map(), byIndex: [] };

  if (h.ver === 2) {
    sff.pals = [];
    for (let i = 0; i < h.npal; i++) {
      r.seek(h.palOfs + i * 16);
      r.u16(); r.u16();          // group, number
      const ncol = r.u16();
      const link = r.u16();
      const ofs = r.u32(), size = r.u32();
      let colors = null;
      if (size > 0) {
        // 每色 4 字节 R,G,B,flags；不足 256 的部分补 0
        colors = new Array(256).fill(0);
        const n = Math.min(256, Math.floor(size / 4));
        r.seek(h.lofs + ofs);
        for (let c = 0; c < n; c++) {
          const rr = r.u8(), gg = r.u8(), bb = r.u8(); r.u8();
          colors[c] = pack(rr, gg, bb, c === 0 ? 0 : 255);
        }
      }
      sff.pals.push({ ncol, link, colors });
    }
  }

  let of = h.sprOfs;
  for (let i = 0; i < h.nspr; i++) {
    if (of + (h.ver === 1 ? 32 : 28) > buf.length) throw new Error('SFF 精灵目录越界（第 ' + i + ' 个）');
    r.seek(of);
    let sp;
    if (h.ver === 1) {
      sp = { next: r.u32(), size: r.u32(), ax: r.i16(), ay: r.i16(), group: r.u16(), index: r.u16(), link: r.u16(), ps: r.u8(), at: of };
      // SFF v1：ps === 0 表示该精灵**自带调色板**（块尾 0x0C 后的 768 字节），
      // ps !== 0 表示沿用上一精灵的调色板。
      // 自带调色板的精灵不能套用 def 的 .act（否则颜色被覆盖）——
      // 「抽关键帧」变体包里的 AI 精灵就是这种情况。
      sp.ownPal = sp.ps === 0;
      of = sp.next;
    } else {
      sp = {
        group: r.u16(), index: r.u16(), w: r.u16(), hh: r.u16(), ax: r.i16(), ay: r.i16(), link: r.u16(),
        format: r.u8(), depth: r.u8(), ofs: r.u32(), size: r.u32(), pal: r.u16(), flags: r.u16(), at: of,
      };
      sp.ofs = (sp.ofs + ((sp.flags & 1) === 0 ? h.lofs : h.tofs)) >>> 0;
      of += 28;
    }
    sp.i = i;
    sff.byIndex.push(sp);
    if (!sff.sprites.has(sp.group + ',' + sp.index)) sff.sprites.set(sp.group + ',' + sp.index, sp);
  }
  return sff;
}

// ---------- 像素解码 ----------
// SFFv1：精灵块 = [32 字节子头][128 字节 PCX 头][RLE 数据]
// 调色板不在这里读——由 v1PaletteMap 的状态机单独提供（位置规则完全不同）。
// 像素长度按引擎：首精灵（角色 0,0 / 9000,0）用「块长 - 128」，
// 其余精灵用「调色板起点 - 像素起点」，而调色板起点由 0x0C 标记或块尾回退决定。
function decodeV1(buf, sp, pal, isCharFirstSprite) {
  // 引擎的口径：offset = 子头起点 + 32（子头之后），datasize = next - offset。
  // 注意不是 next - at，别差这 32 字节。
  const offset = sp.at + 32;
  const dataStart = offset + 128;
  const hr = new Reader(buf);
  // 引擎 readPcxHeader：2 字节 dummy（manufacturer + version），然后 encoding、bpp，
  // 接着 4 个 uint16 的 rect，最后跳到 offset+66 读 bpl。
  hr.seek(offset);
  hr.u16();
  const encoding = hr.u8(), bpp = hr.u8();
  const xmin = hr.u16(), ymin = hr.u16(), xmax = hr.u16(), ymax = hr.u16();
  hr.seek(offset + 66);
  const bpl = hr.u16();
  if (bpp !== 8) throw new Error('PCX 只支持 8 位色深（实际 ' + bpp + ' 位）');
  const w0 = xmax - xmin + 1, h0 = ymax - ymin + 1;
  let w = w0, h = h0;

  let blockEnd = sp.next > offset ? sp.next : offset + sp.size;
  if (blockEnd > buf.length) blockEnd = buf.length;

  let dataEnd;
  if (isCharFirstSprite) {
    // 引擎：datasize = next - offset；rleSize = datasize - 128。
    // 像素流会连带读到后面的调色板，靠 RLE 的「写满 bpl 就换行」把多余的丢弃。
    const datasize = sp.next > offset ? sp.next - offset : sp.size;
    dataEnd = offset + datasize - 128;
    if (dataEnd > blockEnd) dataEnd = blockEnd;
  } else {
    // 找 0x0C 标记（调色板起点前一字节）；找不到就退回「块尾 - 769」
    let p = blockEnd - 769;
    while (p >= dataStart && buf[p] !== 0x0c) p--;
    dataEnd = p >= dataStart ? p : blockEnd - 769;
  }
  if (dataEnd < dataStart) dataEnd = dataStart;

  const src = buf.subarray(dataStart, dataEnd);
  const px = new Uint8Array(w * h);
  if (encoding === 1) {
    // 引擎 RlePcxDecode 的逐行等价移植：
    // k 记录当前行已写字节数，写满 bpl 就换行并强制结束当前 run
    //（MUGEN 的 PCX RLE 不允许一个 run 跨行）。
    let i = 0, j = 0, k = 0;
    while (j < px.length && i < src.length) {
      let n = 1;
      let d = src[i];
      if (i < src.length - 1) i++;
      if (d >= 0xc0) {
        n = d & 0x3f;
        d = src[i];
        if (i < src.length - 1) i++;
      }
      for (; n > 0; n--) {
        if (k < w && j < px.length) px[j++] = d;
        k++;
        if (k === bpl) { k = 0; n = 1; }
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) px[y * w + x] = src[y * bpl + x] || 0;
    }
  }

  // 有些包的头像块 PCX 头写坏了（Leona 的 9000,0 把 ymax 写成 999，
  // 而实际像素只有 25 行）。引擎的 SetPxl 严格要求 len(px)==w*h，
  // 长度不符会整张丢弃；这里按「实际解出内容的最后一行」裁掉虚假高度。
  let lastRow = -1;
  for (let y = h - 1; y >= 0 && lastRow < 0; y--) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] !== 0) { lastRow = y; break; }
    }
  }
  if (lastRow >= 0 && lastRow + 1 < h) {
    h = lastRow + 1;
    const fixed = new Uint8Array(w * h);
    fixed.set(px.subarray(0, fixed.length));
    return { w, h, px: fixed, depth: 8, pal };
  }
  if (w * h !== px.length) {
    const fixed = new Uint8Array(w * h);
    fixed.set(px.subarray(0, Math.min(px.length, fixed.length)));
    return { w, h, px: fixed, depth: 8, pal };
  }
  return { w, h, px, depth: 8, pal };
}

// 下面三个解码器是对引擎 Rle8Decode / Rle5Decode / Lz5Decode 的逐行等价移植。
// 引擎的读指针有个细节：只有 i < len-1 时才自增（指针停在最后一个字节上），
// 照搬这个语义才能保证解出的像素与引擎逐字节一致。差异只有 JS 侧的越界保护。
function cursor(src) {
  const c = { i: 0, len: src.length };
  c.cur = () => src[c.i];
  c.adv = () => { if (c.i < c.len - 1) c.i++; };
  c.at = () => src[c.i] | 0;
  return c;
}
function rle8(src, n) {
  const p = new Uint8Array(n), c = cursor(src);
  for (let j = 0; j < n;) {
    let run = 1, d = c.cur();
    c.adv();
    if ((d & 0xc0) === 0x40) { run = d & 0x3f; d = c.cur(); c.adv(); }
    for (; run > 0; run--) if (j < n) p[j++] = d;
  }
  return p;
}
function rle5(src, n) {
  const p = new Uint8Array(n), c = cursor(src);
  for (let j = 0; j < n;) {
    let rl = c.cur(); c.adv();
    let dl = c.cur() & 0x7f;
    let col = 0;
    if (c.cur() >> 7) { c.adv(); col = c.cur(); }
    c.adv();
    for (;;) {
      if (j < n) p[j++] = col;
      if (--rl < 0) {
        if (--dl < 0) break;
        col = c.cur() & 0x1f;
        rl = c.cur() >> 5;
        c.adv();
      }
    }
  }
  return p;
}
function lz5(src, n) {
  const p = new Uint8Array(n), c = cursor(src);
  let j = 0, run = 0;
  let ct = c.cur(), cts = 0, rb = 0, rbc = 0;
  c.adv();
  while (j < n) {
    let d = c.cur(); c.adv();
    if ((ct & (1 << cts)) !== 0) {
      if ((d & 0x3f) === 0) {
        d = ((d << 2) | c.cur()) + 1; c.adv();
        run = c.cur() + 2; c.adv();
      } else {
        rb |= ((d & 0xc0) >> rbc) & 255;
        rbc += 2;
        run = d & 0x3f;
        if (rbc < 8) { d = c.cur() + 1; c.adv(); }
        else { d = rb + 1; rb = 0; rbc = 0; }
      }
      for (;;) {
        if (j < n) { p[j] = j - d >= 0 ? p[j - d] : 0; j++; }
        if (--run < 0) break;
      }
    } else {
      if ((d & 0xe0) === 0) { run = c.cur() + 8; c.adv(); }
      else { run = d >> 5; d &= 0x1f; }
      for (; run > 0; run--) if (j < n) p[j++] = d;
    }
    if (++cts >= 8) { ct = c.cur(); cts = 0; c.adv(); }
  }
  return p;
}

// SFFv2：格式 0=raw 1=链接 2=RLE8 3=RLE5 4=LZ5 10=索引PNG 11/12=真彩PNG（压缩/PNG 数据带 4 字节长度前缀）
function decodeV2(buf, sp, sff) {
  const w = sp.w, h = sp.hh;
  if (sp.format === 0) {
    const px = buf.slice(sp.ofs, sp.ofs + sp.size);
    return { w, h, px, depth: sp.depth, pal: paletteOfIndex(sff, sp.pal) };
  }
  if (sp.format >= 10) throw new Error('SFFv2 PNG 精灵（格式 ' + sp.format + '）暂不支持作为头像来源');
  const src = buf.subarray(sp.ofs + 4, sp.ofs + sp.size);
  const n = w * h;
  const dec = { 2: rle8, 3: rle5, 4: lz5 }[sp.format];
  if (!dec) throw new Error('SFFv2 未知格式：' + sp.format);
  return { w, h, px: dec(src, n), depth: 8, pal: paletteOfIndex(sff, sp.pal) };
}

// SFFv1 调色板解析。
//
// 引擎有两条完全不同的取色路径：
//  A) 预载精灵（角色包的 9000,0 / 9000,1 等）走 Sprite.read：
//     - isCharFirstSprite（该角色的第一个精灵）：paletteOffset = offset + datasize - 768，
//       且不跳过 0x0C 标记；
//     - 其他：先往前找 0x0C 标记，paletteOffset = 标记位置 + 1（跳过标记）。
//  B) 其余精灵走 sffv1PalState 状态机：
//     location 初始 = 首个精灵的 next - 768；遇到 (0,0) 复位；
//     ps==0 → location = 本精灵 next - 768（state 变 1/3）；ps!=0 → 沿用。
//     取色条件：(group==0&&index==0) || state%2==0，否则沿用上一精灵的调色板。
//
// 之前把 A/B 混在一起，导致「9000,0 是目录首个」的角色（该包首个精灵就是它）
// 拿不到正确调色板。
function v1PaletteMap(buf, sff) {
  const list = sff.byIndex;
  const out = new Map();      // sprite 对象 → 调色板数组
  let state = 0, current = 0;
  let location = list.length ? list[0].next - 768 : 0;
  const initialLocation = location;
  let shared = null;

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.group === 0 && s.index === 0) {
      state = 2;
      location = initialLocation;
    } else if (s.ps === 0 && state === 2) {
      state = 3;
      current++;
      location = s.next - 768;
    } else if (s.ps === 0) {
      if (current === 0) state = 1;
      current++;
      location = s.next - 768;
    }
    const takeFromFile = (s.group === 0 && s.index === 0) || (state % 2 === 0);
    if (takeFromFile) {
      const pal = readPaletteAt(buf, location);
      if (pal) { out.set(s, pal); shared = pal; }
    } else {
      out.set(s, shared);
    }
  }
  return out;
}

// 预载精灵（9000,0 / 9000,1）自己的取色路径，与上面的状态机不同。
function v1PreloadedPalette(buf, sp) {
  const offset = sp.at + 32;              // 引擎口径：子头起点 + 32
  const isFirstInFile = sp.group === 0 && sp.index === 0;
  const datasize = sp.next > offset ? sp.next - offset : sp.size;
  if (isFirstInFile) {
    // 引擎首精灵路径：offset + datasize - 768，不跳 0x0C
    return readPaletteAt(buf, offset + datasize - 768);
  }
  // 其余预载精灵：找 0x0C 标记，调色板在标记 + 1
  const dataStart = offset + 128;
  let blockEnd = sp.next > offset ? sp.next : offset + sp.size;
  if (blockEnd > buf.length) blockEnd = buf.length;
  let p = blockEnd - 769;
  while (p >= dataStart && buf[p] !== 0x0c) p--;
  const off = p >= dataStart ? p + 1 : blockEnd - 769;
  return readPaletteAt(buf, off);
}

function readPaletteAt(buf, offset) {
  if (offset <= 0 || offset + 768 > buf.length) return null;
  const pal = new Array(256).fill(0);
  for (let i = 0; i < 256; i++) {
    const o = offset + i * 3;
    pal[i] = pack(buf[o], buf[o + 1], buf[o + 2], i === 0 ? 0 : 255);
  }
  return pal;
}

// ---------- 对外：取一张精灵并着色为 RGBA ----------
// palOverride：外部调色板（def 的 pal1 等）；不给就用精灵自带的。
//
// SFFv1 里调色板可以「与前一精灵共用」（子头的 ps 标志），所以要按目录顺序
// 逐个解下来、把前一精灵的调色板传下去；角色包的首精灵（9000,0）走引擎的
// isCharFirstSprite 特殊路径（调色板固定在块尾 - 768）。这几种路径的头像
// 颜色各不相同，不能简化成一种。
function spriteRgba(buf, sff, group, index, palOverride) {
  const target = sff.sprites.get(group + ',' + index);
  if (!target) return null;

  if (sff.ver === 2) {
    let sp = target, hops = 0;
    while (sp.size === 0) {                       // 链接精灵沿用被链接者的像素
      if (sp.link >= sff.byIndex.length || ++hops > 64) throw new Error('精灵链接无效');
      sp = sff.byIndex[sp.link];
    }
    return shade(decodeV2(buf, sp, sff), palOverride);
  }

  let prevSprite = null;
  const palMap = v1PaletteMap(buf, sff);
  for (const s of sff.byIndex) {
    // 引擎：isCharFirstSprite = (还没解过任何精灵) || (group==0 && index==0)
    const isCharFirstSprite = prevSprite === null || (s.group === 0 && s.index === 0);
    if (s === target) {
      // 预载精灵（9000,0 / 9000,1）走引擎的 Sprite.read 取色路径
      const pal = v1PreloadedPalette(buf, s) || palMap.get(s);
      return shade(decodeV1(buf, s, pal, isCharFirstSprite), palOverride);
    }
    prevSprite = s;
  }
  return null;
}

function shade(img, palOverride) {
  const pal = palOverride || img.pal || new Array(256).fill(0);
  const rgba = new Uint8Array(img.w * img.h * 4);
  if (img.depth === 8) {
    for (let i = 0; i < img.px.length; i++) {
      const c = pal[img.px[i]] || 0;
      rgba[i * 4] = c & 255; rgba[i * 4 + 1] = (c >> 8) & 255; rgba[i * 4 + 2] = (c >> 16) & 255; rgba[i * 4 + 3] = (c >>> 24) & 255;
    }
  } else if (img.depth === 24) {
    for (let i = 0; i < img.w * img.h; i++) {
      rgba[i * 4] = img.px[i * 3]; rgba[i * 4 + 1] = img.px[i * 3 + 1]; rgba[i * 4 + 2] = img.px[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    }
  } else if (img.depth === 32) {
    rgba.set(img.px.subarray(0, rgba.length));
  } else {
    throw new Error('未知色深：' + img.depth);
  }
  return { w: img.w, h: img.h, rgba, ax: img.ax, ay: img.ay };
}

// 头像质量评分：用来在多个候选精灵里挑一张「像人像」而不是坏图。
//  - 全透明 / 几乎全透明 → 0 分（解坏了）
//  - 长宽比极端（>6 或 <1/6）→ 扣分（多半是把坏 rect 当真了）
//  - 颜色数太少 → 扣分（纯色块，不是图）
function portraitScore(img) {
  const total = img.w * img.h;
  if (!total) return 0;
  let opaque = 0;
  const colors = new Set();
  for (let i = 0; i < total; i++) {
    const a = img.rgba[i * 4 + 3];
    if (a > 8) {
      opaque++;
      if (colors.size < 4096) colors.add((img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2]);
    }
  }
  const ratio = opaque / total;
  if (ratio < 0.08) return 0;                    // 几乎没内容
  let score = ratio * 100;
  const ar = img.w / img.h;
  if (ar > 6 || ar < 1 / 6) score *= 0.25;        // 极端长宽比 → 大概率 rect 坏了
  if (colors.size < 8) score *= 0.4;              // 颜色太少 → 纯色块
  return score;
}

module.exports = { readAct, readPngPalette, readPaletteFile, parseSff, loadSff, spriteRgba, portraitScore };
