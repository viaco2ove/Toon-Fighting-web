// 浏览器端（安卓 APK webview）MUGEN 资源解码：SFF（v1/v2）+ AIR → 头像/立绘/动作帧。
//
// 为什么存在：APK 里没有 Node serve.cjs，原生 AvatarApi 的 /api/portrait、/api/pose
// 只读包里现成的 avatar/head.png|full.png（绝大多数 MUGEN 包没有），/api/anim 透传 PC
// 端 serve.cjs —— PC 不在线时选人屏的实体头像/立绘/站立动画全空。本文件让 webview
// 自己解码：字节从手机本地取（资产集角色走原生 PackApi 的 /packs/<dir>/… 静态服务，
// 兜底角色走 Capacitor 内置 server 的 www/），PNG 编码走 canvas，全程不出手机。
//
// 解码语义的权威实现在 server/lib/sff.cjs / anim.cjs / portrait.cjs；本文件是它的
// 浏览器移植（Buffer → Uint8Array/TextDecoder，encodePng → canvas.toDataURL）。
// ⚠️ 三份解码器改动必须同步：server/lib/sff.cjs（权威）、ff-studio/src/viewer.html、本文件。
//
// 对外 API（window.FFDecode）：
//   loadChar(pack, charId)               → Promise<{buf,sff,airText,pal}|null>
//   portrait(pack, charId)               → Promise<{url,w,h}|null>   url 是 data:PNG
//   anim(pack, charId, actionNo)         → Promise<{ok,w,h,frames:[{png(base64),ms}]}|null>
// pack 传 '' 表示兜底角色（ikemen-fs/file/chars/）；传资产集目录名走 packs/<dir>/chars/。
// fetch 走相对路径 —— 原生环境里 index.html 的 fetch 劫持会把 api/、packs/ 重写到 7073。
'use strict';
window.FFDecode = (function () {
  'use strict';

  // ---------- 基础读取（移植自 server/lib/sff.cjs 的 Reader） ----------
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

  // ACT：768 字节 = 256 × (R,G,B)，倒序存储（文件第 j 组 → 调色板下标 255-j），下标 0 透明。
  function readAct(buf) {
    const pal = new Array(256).fill(0);
    const n = Math.floor(Math.min(buf.length, 768) / 3);
    for (let i = 0; i < n; i++) {
      const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
      pal[255 - i] = pack(r, g, b, 255 - i === 0 ? 0 : 255);
    }
    return pal;
  }

  // 带 PLTE 的索引 PNG 调色板：自然顺序，下标 0 透明。
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
    const ver = r.u8();
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

  // 只解目录与调色板表，像素按需解码（SFF 可能几 MB，目录很小）。
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
        // v1：ps===0 自带调色板（块尾 0x0C 后的 768 字节），ps!==0 沿用上一精灵的。
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
  // SFFv1：精灵块 = [32 字节子头][128 字节 PCX 头][RLE 数据]。
  // 像素长度按引擎口径：首精灵（0,0 / 9000,0）用「块长 - 128」，ps!=0 用「块尾 - 像素起点」，
  // ps==0 停在 0x0C 标记（找不到退回块尾 - 769）。逐条注释见权威版 sff.cjs decodeV1。
  function decodeV1(buf, sp, pal, isCharFirstSprite) {
    const offset = sp.at + 32;
    const dataStart = offset + 128;
    const hr = new Reader(buf);
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
      const datasize = sp.next > offset ? sp.next - offset : sp.size;
      dataEnd = offset + datasize - 128;
      if (dataEnd > blockEnd) dataEnd = blockEnd;
    } else if (sp.ps !== 0) {
      // ps!=0：像素流读到块尾。不能只在 0x0C 处截断（幻影不透明像素，见权威版注释）。
      dataEnd = blockEnd;
    } else {
      let p = blockEnd - 769;
      while (p >= dataStart && buf[p] !== 0x0c) p--;
      dataEnd = p >= dataStart ? p : blockEnd - 769;
    }
    if (dataEnd < dataStart) dataEnd = dataStart;

    const src = buf.subarray(dataStart, dataEnd);
    const px = new Uint8Array(w * h);
    if (encoding === 1) {
      // 引擎 RlePcxDecode 的逐行等价移植：写满 bpl 就换行并强制结束 run（不跨行）。
      let i = 0, j = 0, k = 0;
      while (j < px.length) {
        let n = 1;
        let d = src[i] || 0;
        if (i < src.length - 1) i++;
        if (d >= 0xc0) {
          n = d & 0x3f;
          d = src[i] || 0;
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

    // 坏 rect 包（Leona 的 9000,0 ymax 写成 999）：按「实际内容的最后一行」裁掉虚假高度。
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

  // 引擎 Rle8Decode / Rle5Decode / Lz5Decode 的逐行等价移植。
  // 引擎读指针只在 i < len-1 时自增（停在最后一个字节上），照搬才逐字节一致。
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

  // SFFv2：0=raw 1=链接 2=RLE8 3=RLE5 4=LZ5 10+=PNG（KFM v2 融合包全精灵都是 PNG RGBA）。
  function decodeV2(buf, sp, sff) {
    const w = sp.w, h = sp.hh;
    if (sp.format === 0) {
      const px = buf.slice(sp.ofs, sp.ofs + sp.size);
      return { w, h, px, depth: sp.depth, pal: paletteOfIndex(sff, sp.pal) };
    }
    if (sp.format >= 10) throw new Error('SFFv2 PNG 精灵请走 spriteRgbaAsync（异步解 PNG）');
    const src = buf.subarray(sp.ofs + 4, sp.ofs + sp.size);
    const n = w * h;
    const dec = { 2: rle8, 3: rle5, 4: lz5 }[sp.format];
    if (!dec) throw new Error('SFFv2 未知格式：' + sp.format);
    return { w, h, px: dec(src, n), depth: 8, pal: paletteOfIndex(sff, sp.pal) };
  }

  // PNG 载荷 → RGBA。走 Image 元素 + blob URL（PC Chrome 与 Android WebView 都支持）——
  // 不用 createImageBitmap：真机（Android 16 WebView）对同一 PNG 报
  // 「The source image could not be decoded」，PC 同字节却能解（实机诊断实锤）。
  // 结果 depth=32（shade 对 32 位直通，调色板/act 覆盖对 PNG 精灵天然不生效）。
  async function decodePngRgba(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    try {
      const img = new Image();
      await new Promise((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error('PNG 解码失败（img onerror）'));
        img.src = url;
      });
      const w = img.naturalWidth, h = img.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, w, h);
      return { w, h, px: new Uint8Array(d.data), depth: 32 };
    } finally { URL.revokeObjectURL(url); }
  }

  // v2 通用异步取精灵：PNG（format 10+）解一次缓存到 sff.pngCache（key=精灵 ofs），
  // 其余（raw/RLE/LZ5/size==0 链接）沿用同步 decodeV2；v1 整体走原 spriteRgba。
  async function spriteRgbaAsync(buf, sff, group, index, palOverride) {
    const target = sff.sprites.get(group + ',' + index);
    if (!target) return null;
    if (sff.ver !== 2) return spriteRgba(buf, sff, group, index, palOverride);
    let sp = target, hops = 0;
    while (sp.size === 0) {
      if (sp.link >= sff.byIndex.length || ++hops > 64) throw new Error('精灵链接无效');
      sp = sff.byIndex[sp.link];
    }
    if (sp.format < 10) return shade(decodeV2(buf, sp, sff), palOverride);
    if (!sff.pngCache) sff.pngCache = new Map();
    let img = sff.pngCache.get(sp.ofs);
    if (!img) {
      // PNG 载荷前有 4 字节前缀（与 decodeV2 的 RLE 路径 subarray(ofs+4) 同一约定），
      // 不跳过的话 createImageBitmap 直接「source image could not be decoded」
      img = await decodePngRgba(buf.subarray(sp.ofs + 4, sp.ofs + sp.size));
      if (img) sff.pngCache.set(sp.ofs, img);
    }
    if (!img) throw new Error('PNG 精灵解码失败（格式 ' + sp.format + '）');
    return shade(img, palOverride);
  }

  // SFFv1 取色：对局渲染的 paletteSame 规则（ps!=0 沿用上一精灵；size==0 共享块也沿用；
  // 0,0 走 legacy 首精灵路径：块尾 - 768，不找 0x0C）。逐条注释见权威版 v1PaletteMap。
  function v1PaletteMap(buf, sff) {
    const out = new Map();
    let prev = null;
    for (const s of sff.byIndex) {
      let pal = null;
      if (s.group === 0 && s.index === 0) {
        pal = readPaletteAt(buf, s.next - 768);
      } else if (s.size === 0) {
        pal = prev;
      } else if (s.ps === 0) {
        pal = v1OwnPalette(buf, s);
      } else {
        pal = prev;
      }
      const use = pal || prev;
      if (use) out.set(s, use);
      prev = use || prev;
    }
    return out;
  }

  // ps==0：块尾往前找 0x0C 标记，调色板在标记 + 1；找不到回退 blockEnd - 768。
  // ⚠️ 只对 ps==0 成立；ps!=0 扫 0x0C 会撞假标记解出垃圾调色板（红块杂斑坑）。
  function v1OwnPalette(buf, sp) {
    const offset = sp.at + 32;
    const dataStart = offset + 128;
    let blockEnd = sp.next > offset ? sp.next : offset + sp.size;
    if (blockEnd > buf.length) blockEnd = buf.length;
    let p = blockEnd - 769;
    while (p >= dataStart && buf[p] !== 0x0c) p--;
    const off = p >= dataStart ? p + 1 : blockEnd - 768;
    return readPaletteAt(buf, off);
  }

  // 预载精灵（9000 组）的取色路径：首精灵块尾 - 768，其余同 v1OwnPalette。
  function v1PreloadedPalette(buf, sp) {
    const offset = sp.at + 32;
    if (sp.group === 0 && sp.index === 0) {
      const datasize = sp.next > offset ? sp.next - offset : sp.size;
      return readPaletteAt(buf, offset + datasize - 768);
    }
    return v1OwnPalette(buf, sp);
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

  // ---------- 对外：取一张精灵并着色为 RGBA（口径与权威版 spriteRgba 一致） ----------
  function spriteRgba(buf, sff, group, index, palOverride) {
    const target = sff.sprites.get(group + ',' + index);
    if (!target) return null;

    if (sff.ver === 2) {
      let sp = target, hops = 0;
      while (sp.size === 0) {
        if (sp.link >= sff.byIndex.length || ++hops > 64) throw new Error('精灵链接无效');
        sp = sff.byIndex[sp.link];
      }
      return shade(decodeV2(buf, sp, sff), palOverride);
    }

    let prevSprite = null;
    const palMap = v1PaletteMap(buf, sff);
    for (const s of sff.byIndex) {
      const isCharFirstSprite = prevSprite === null || (s.group === 0 && s.index === 0);
      if (s === target) {
        const pre = s.group === 9000 ? v1PreloadedPalette(buf, s) : null;
        const pal = pre || palMap.get(s);
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

  // 头像质量评分（移植 portraitScore）：全透明 0 分 / 极端长宽比与纯色块扣分。
  function portraitScore(img) {
    const total = img.w * img.h;
    if (!total) return 0;
    let opaque = 0;
    const colors = new Set();
    for (let i = 0; i < total; i++) {
      const a = img.rgba[i * 4 + 3];
      if (a > 8) {
        opaque++;
        if (colors.size < 4096) colors.add((img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | (img.rgba[i * 4 + 2]));
      }
    }
    const ratio = opaque / total;
    if (ratio < 0.08) return 0;
    let score = ratio * 100;
    const ar = img.w / img.h;
    if (ar > 6 || ar < 1 / 6) score *= 0.25;
    if (colors.size < 8) score *= 0.4;
    return score;
  }

  // 按不透明像素裁掉空白边，留 1px 边距（移植 portrait.cjs cropToContent）。
  function cropToContent(img) {
    const w = img.w, h = img.h, rgba = img.rgba;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (rgba[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return img;
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
    maxX = Math.min(w - 1, maxX + 1); maxY = Math.min(h - 1, maxY + 1);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const out = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const src = ((y + minY) * w + minX) * 4;
      out.set(rgba.subarray(src, src + cw * 4), y * cw * 4);
    }
    return { w: cw, h: ch, rgba: out };
  }

  // ---------- def / air 文本解析（移植 anim.cjs / portrait.cjs 的同名函数） ----------
  function parseDef(text) {
    const get = (key) => {
      const m = new RegExp('^\\s*' + key + '\\s*=\\s*(.+?)\\s*(?:;.*)?$', 'im').exec(text);
      return m ? m[1].trim() : null;
    };
    // 状态文件键一族：st（可多次）、st1..stN（部分包的拆分约定）、cns（单文件约定）、stcommon。
    // SuWanqingKFM.def 实测：St/St1..St4/Cns/StCommon 五种键混用，漏收会丢引用过滤。
    const st = [];
    const stRe = /^\s*(?:st\d*|cns)\s*=\s*(.+?)\s*(?:;.*)?$/gim;
    let sm;
    while ((sm = stRe.exec(text))) st.push(sm[1].trim());
    return { sprite: get('sprite'), anim: get('anim'), pal1: get('pal1'), cmd: get('cmd'), stcommon: get('stcommon'), st };
  }

  // ---------- 指令（[Command]）解析：技能条的数据源 ----------
  // MUGEN 指令块大小写混用（[Command] / [command] 都有），匹配必须带 i。
  // token 序列语义：F/B/D/U/DF/DB/UF/UB 方向（相对面向）、a/b/c/x/y/z 按钮键、
  // s=START、~Ns = 前一 token 按住 N ticks 后松开、~ = 快速释放、> = 结尾保持。
  function parseCommands(text) {
    const out = [];
    const nameRe = /^\s*name\s*=\s*"?([^"\r\n;]+)"?\s*(?:;.*)?$/im;
    const cmdRe = /^\s*command\s*=\s*(.+?)\s*(?:;.*)?$/im;
    const blocks = text.split(/^\s*\[Command\]\s*$/im).slice(1);
    for (const b of blocks) {
      const nm = nameRe.exec(b);
      const km = cmdRe.exec(b);
      if (!nm || !km) continue;
      const name = nm[1].trim().replace(/^"|"$/g, '');
      const tokens = km[1].split(',').map((t) => t.trim()).filter(Boolean);
      const btnSet = new Set(tokens.map((t) => t.toLowerCase().replace(/^~/, '').replace(/\d+s$/, '')).filter((t) => /^[abcxyz]$/.test(t)));
      out.push({ name, tokens, btns: btnSet });
    }
    return out;
  }

  // 装载角色的指令包（cmd 文本 + cns/st 引用集合，全部带缓存）。
  // 只取文本，不碰 SFF —— 即使角色几 MB 也能秒级出技能表。
  const cmdCache = new Map();
  async function loadCommands(pack, charId) {
    const key = (pack || '') + '|' + charId;
    if (cmdCache.has(key)) return cmdCache.get(key);
    const p = (async () => {
      try {
        let root = pack ? 'packs/' + enc(pack) + '/' : 'ikemen-fs/file/';
        let defRel = 'chars/' + enc(charId) + '/' + enc(charId) + '.def';
        const fl = await packFiles(pack);
        if (fl) {
          if (fl.baseUrl) root = encPath(fl.baseUrl) + '/';
          if (fl.defs && fl.defs[charId]) defRel = fl.defs[charId].split('/').map(enc).join('/');
        }
        const base = root + 'chars/' + enc(charId) + '/';
        const defText = await fetchLatin(root + defRel);
        const meta = parseDef(defText);
        if (!meta.cmd) return { ok: false, reason: 'def 没挂 cmd', moves: [] };
        const cmdText = await fetchLatin(base + enc(meta.cmd));
        const all = parseCommands(cmdText);
        // 引用过滤：只认 def 的 st/stcommon 文件里 command="名字" 引用过的指令。
        // st 文件 404/读不到时不算失败（hasRefs=false → 不过滤，全部展示）。
        const stFiles = [...new Set([...(meta.st || []), meta.stcommon].filter(Boolean))];
        const wired = new Set();
        let hasRefs = false;
        await Promise.all(stFiles.map(async (f) => {
          try {
            const t = await fetchLatin(base + enc(f));
            hasRefs = true;
            const re = /command\s*=\s*"([^"]+)"/gi;
            let m;
            while ((m = re.exec(t))) wired.add(m[1].trim().toLowerCase());
          } catch (e) { /* 该 st 文件不存在 */ }
        }));
        const seen = new Set();
        const moves = [];
        for (const c of all) {
          const lk = c.name.toLowerCase();
          if (seen.has(lk)) continue;                       // 同名指令（x/y 两个版本）只留第一个
          seen.add(lk);
          if (!c.btns.size) continue;                       // 纯方向/时间指令，技能条没意义
          if (hasRefs && !wired.has(lk)) continue;          // 没被任何状态引用 → 按了也白发
          moves.push({ name: c.name, cmd: c.tokens });
        }
        return { ok: moves.length > 0, cmdFile: meta.cmd, total: all.length, wiredCount: wired.size, hasRefs, moves };
      } catch (e) { return null; }
    })();
    cmdCache.set(key, p);
    return p;
  }

  function parseAirAction(text, actionNo) {
    const re = new RegExp('^\\[Begin Action\\s+' + actionNo + '\\b', 'im');
    const m = re.exec(text);
    if (!m) return null;
    const body = text.slice(m.index);
    const firstNl = body.indexOf('\n');
    const rest = firstNl >= 0 ? body.slice(firstNl + 1) : '';
    const endRel = rest.search(/^\s*\[Begin Action\b/im);
    const lines = (endRel >= 0 ? rest.slice(0, endRel) : rest).split(/\r?\n/);
    const frames = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      if (/^(Clsn|loopstart)/i.test(line)) continue;
      const fm = /^(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(.*))?$/.exec(line);
      if (!fm) continue;
      const flags = (fm[6] || '').toUpperCase();
      frames.push({
        grp: +fm[1], idx: +fm[2], x: +fm[3], y: +fm[4],
        dur: Math.max(1, +fm[5]),
        flipH: flags.includes('H'), flipV: flags.includes('V'),
      });
    }
    return frames.length ? frames : null;
  }

  // ---------- 取字节 / 文本（def、sff、air、pal 都按 def 所在目录相对解析） ----------
  let latin1Dec = null;
  function latin1() {
    if (!latin1Dec) {
      try { latin1Dec = new TextDecoder('windows-1252'); }
      catch (e) { latin1Dec = new TextDecoder('utf-8'); }
    }
    return latin1Dec;
  }
  let utf8Dec = null;
  function utf8() {
    if (!utf8Dec) utf8Dec = new TextDecoder('utf-8');
    return utf8Dec;
  }
  async function fetchLatin(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return latin1().decode(await r.arrayBuffer());
  }
  async function fetchBytes(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  const enc = (s) => encodeURIComponent(s);
  // 相对路径逐段编码（目录名可能含中文/空格，整段 encodeURIComponent 会把 '/' 也编掉）
  const encPath = (p) => p.replace(/^\.\//, '').split('/').filter(Boolean).map(enc).join('/');

  // 资产集的文件清单（拿 baseUrl 与「与目录同名的入口 def」）：/api/packs/<dir>/files（带缓存）。
  // baseUrl 不能写死 packs/<dir>/ —— PC 端它指向 workshops/map_design 物理目录，
  // 手机端（PackApi）才是 ./packs/<dir>，两边都以接口返回值为准。
  const packDefsCache = new Map();
  async function packFiles(dir) {
    if (!dir) return null;
    if (!packDefsCache.has(dir)) {
      packDefsCache.set(dir, fetch('api/packs/' + enc(dir) + '/files')
        .then((r) => r.json())
        .then((j) => (j && j.ok) ? { baseUrl: j.baseUrl || null, defs: j.defs || null } : null)
        .catch(() => null));
    }
    return packDefsCache.get(dir);
  }

  // ---------- 角色装载（def → sff/air/pal，全部带缓存） ----------
  const charCache = new Map();   // pack|charId → Promise<载荷|null>
  async function loadChar(pack, charId) {
    const key = (pack || '') + '|' + charId;
    if (charCache.has(key)) return charCache.get(key);
    const p = (async () => {
      try {
        // pack 非空 → 资产集角色（root 取 files 接口的 baseUrl）；空 → 兜底角色（Capacitor 内置 www/）
        let root = pack ? 'packs/' + enc(pack) + '/' : 'ikemen-fs/file/';
        // 入口 def：资产集按 files 清单里的 defs[charId]（与目录同名那个，一个包常有多个 def）；
        // 兜底层没有清单，猜 <charId>.def。
        let defRel = 'chars/' + enc(charId) + '/' + enc(charId) + '.def';
        const fl = await packFiles(pack);
        if (fl) {
          if (fl.baseUrl) root = encPath(fl.baseUrl) + '/';
          if (fl.defs && fl.defs[charId]) defRel = fl.defs[charId].split('/').map(enc).join('/');
        }
        const base = root + 'chars/' + enc(charId) + '/';
        const defText = await fetchLatin(root + defRel);
        const meta = parseDef(defText);
        if (!meta.sprite) return null;
        const buf = await fetchBytes(base + enc(meta.sprite));
        const airText = meta.anim
          ? await fetchLatin(base + enc(meta.anim)).catch(() => null)
          : null;
        const pal = meta.pal1
          ? await fetchBytes(base + enc(meta.pal1)).then(readPaletteFile).catch(() => null)
          : null;
        return { pack: pack || '', charId, base, buf, sff: loadSff(buf), airText, pal };
      } catch (e) { return null; }
    })();
    charCache.set(key, p);
    return p;
  }

  // ---------- RGBA → PNG（canvas 编码，不用自带 PNG 编码器） ----------
  function png64(rgba, w, h) {
    try {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const id = ctx.createImageData(w, h);
      id.data.set(rgba);
      ctx.putImageData(id, 0, 0);
      return c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    } catch (e) { return null; }
  }

  // ---------- 头像（移植 portrait.cjs portraitFor：候选表 + 评分 + 裁边） ----------
  // 9000,1 是动画帧横向拼贴图，不能当头像 —— 候选表里没有它，且拒绝超宽/超大图。
  const CANDIDATES = [[9000, 0], [9000, 10], [9000, 222], [9000, 3], [9000, 2], [0, 0]];
  const MAX_SIDE = 160;
  const MIN_SCORE = 45;
  const portraitCache = new Map();
  async function portrait(pack, charId) {
    const key = (pack || '') + '|' + charId;
    if (portraitCache.has(key)) return portraitCache.get(key);
    const p = (async () => {
      const ch = await loadChar(pack, charId);
      if (!ch) return null;
      for (const c of CANDIDATES) {
        let img = null;
        try { img = await spriteRgbaAsync(ch.buf, ch.sff, c[0], c[1], null); } catch (e) { img = null; }
        if (!img || img.w < 8 || img.h < 8) continue;
        if (Math.max(img.w, img.h) > MAX_SIDE) continue;
        const ar = img.w / img.h;
        if (ar > 4 || ar < 1 / 4) continue;
        let score = portraitScore(img);
        if (ch.pal) {
          // 有些包精灵自带调色板是占位的，用外部 act 再解一次，取分高的
          try {
            const alt = await spriteRgbaAsync(ch.buf, ch.sff, c[0], c[1], ch.pal);
            if (alt) {
              const altScore = portraitScore(alt);
              if (altScore > score) { img = alt; score = altScore; }
            }
          } catch (e) { /* 用原图 */ }
        }
        if (score < MIN_SCORE) continue;
        const cropped = cropToContent(img);
        const b64 = png64(cropped.rgba, cropped.w, cropped.h);
        return b64 ? { url: 'data:image/png;base64,' + b64, w: cropped.w, h: cropped.h } : null;
      }
      return null;
    })();
    portraitCache.set(key, p);
    return p;
  }

  // ---------- 动作帧序列（移植 anim.cjs animFrames：包围盒合成 + 翻转） ----------
  const animCache = new Map();   // pack|charId|action → Promise<结果|null>
  async function anim(pack, charId, actionNo) {
    const key = (pack || '') + '|' + charId + '|' + (actionNo | 0);
    if (animCache.has(key)) return animCache.get(key);
    const p = (async () => {
      const ch = await loadChar(pack, charId);
      if (!ch || !ch.airText) return null;
      const frames = parseAirAction(ch.airText, actionNo | 0);
      if (!frames) return null;

      // 每帧解码精灵 + 翻转。调色板：自带调色板（ps==0）的精灵用自己的；
      // 其余用 def 的 pal1 —— 一律套 pal 会把 AI 关键帧（自带彩色板）染灰。
      const sprites = [];
      for (const f of frames) {
        let img = null;
        const sp0 = ch.sff.sprites.get(f.grp + ',' + f.idx);
        const ownPal = !!(sp0 && sp0.ownPal);
        try { img = await spriteRgbaAsync(ch.buf, ch.sff, f.grp, f.idx, ownPal ? null : ch.pal); } catch (e) { img = null; }
        if (!img) continue;
        const sp = ch.sff.sprites.get(f.grp + ',' + f.idx);
        img.ax = sp ? sp.ax : Math.round(img.w / 2);
        img.ay = sp ? sp.ay : img.h;
        if (f.flipH) {
          const w = img.w, h = img.h, rgba = img.rgba;
          const out = new Uint8Array(w * h * 4);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const s = (y * w + x) * 4, d = (y * w + (w - 1 - x)) * 4;
            out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
          }
          img = { w, h, rgba: out };
        }
        if (f.flipV) {
          const w = img.w, h = img.h, rgba = img.rgba;
          const out = new Uint8Array(w * h * 4);
          for (let y = 0; y < h; y++) {
            const s = ((h - 1 - y) * w) * 4, d = (y * w) * 4;
            out.set(rgba.subarray(s, s + w * 4), d);
          }
          img = { w, h, rgba: out };
        }
        sprites.push({ f, img });
      }
      if (!sprites.length) return null;

      // 包围盒（所有帧画出来的区域），最长边 400（与权威版一致）
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const it of sprites) {
        const x0 = it.f.x - it.img.ax, y0 = it.f.y - it.img.ay;
        minX = Math.min(minX, x0); minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x0 + it.img.w); maxY = Math.max(maxY, y0 + it.img.h);
      }
      const W = Math.min(400, maxX - minX), H = Math.min(400, maxY - minY);
      if (W <= 0 || H <= 0) return null;

      const out = [];
      for (const it of sprites) {
        const rgba = new Uint8Array(W * H * 4);
        const ox = it.f.x - it.img.ax - minX, oy = it.f.y - it.img.ay - minY;
        for (let y = 0; y < it.img.h; y++) {
          const dy = oy + y;
          if (dy < 0 || dy >= H) continue;
          for (let x = 0; x < it.img.w; x++) {
            const dx = ox + x;
            if (dx < 0 || dx >= W) continue;
            const s = (y * it.img.w + x) * 4, d = (dy * W + dx) * 4;
            if (it.img.rgba[s + 3] <= 8) continue;
            rgba[d] = it.img.rgba[s]; rgba[d + 1] = it.img.rgba[s + 1];
            rgba[d + 2] = it.img.rgba[s + 2]; rgba[d + 3] = it.img.rgba[s + 3];
          }
        }
        const b64 = png64(rgba, W, H);
        if (!b64) return null;
        out.push({ png: b64, ms: Math.round(it.f.dur / 60 * 1000) });
      }
      return { ok: true, w: W, h: H, frames: out };
    })();
    animCache.set(key, p);
    return p;
  }

  // 资产集内任意文本文件（utf8 解码，survival.json / 配置类文件用）。
  // 相对 rel 按资产集根解析；不带 pack 时按兜底 www/ 解析。
  async function fetchPackText(pack, rel) {
    let root = pack ? 'packs/' + enc(pack) + '/' : 'ikemen-fs/file/';
    const fl = await packFiles(pack);
    if (fl && fl.baseUrl) root = encPath(fl.baseUrl) + '/';
    const r = await fetch(root + rel.split('/').map(enc).join('/'));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return utf8().decode(await r.arrayBuffer());
  }

  return { loadChar, portrait, anim, loadCommands, fetchPackText };
})();
