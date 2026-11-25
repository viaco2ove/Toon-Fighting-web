// 资产集（地图集）管理：扫描 map_design 下的资产集、读元数据、列出可安装的包，
// 以及登记「用户自己选的文件夹」到 assets/assetpacks/。
// 与 --conn 无关：纯本地模式也要能用默认资产集。
'use strict';
const fs = require('fs');
const path = require('path');

const MAP_ROOT = path.join(__dirname, '..', '..', 'workshops', 'toon-fighting-web', 'map_design');
// 用户自选资产集的登记区（只放元数据 JSON，不放引擎资产）
const ASSETS_ROOT = path.join(__dirname, '..', '..', 'assets', 'assetpacks');
const REGISTRY_PATH = path.join(ASSETS_ROOT, 'index.json');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ---------------- 登记簿（assets/assetpacks/index.json） ----------------

function readRegistry() {
  const r = readJson(REGISTRY_PATH);
  if (!r || !Array.isArray(r.packs)) return { packs: [] };
  return { packs: r.packs.filter((p) => p && p.id && p.dir) };
}

function writeRegistry(reg) {
  fs.mkdirSync(ASSETS_ROOT, { recursive: true });
  const tmp = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf8');
  fs.renameSync(tmp, REGISTRY_PATH); // 原子写，避免半截文件
}

// packId 只允许安全字符，防路径穿越（../ 之类）
function safePackId(id) {
  const s = String(id || '').trim();
  return /^[A-Za-z0-9_.\-]+$/.test(s) ? s : '';
}

// 把用户选中的文件夹登记成资产集。
// 只写元数据层（pack/story/roster/mapping），引擎资产不复制、不上传后端。
function registerPack({ dirName, pack, story, roster, mapping }) {
  if (!pack || typeof pack !== 'object') throw new Error('缺少 pack.json');
  const dirName0 = String(dirName || '').trim();
  if (!dirName0) throw new Error('缺少文件夹名');
  const id = safePackId(pack.id) || safePackId(dirName0);
  if (!id) throw new Error('pack.id 不合法（只允许字母数字 _ . -）');
  const name = String(pack.name || dirName0).trim() || dirName0;

  const base = path.join(ASSETS_ROOT, id);
  fs.mkdirSync(base, { recursive: true });
  const files = { 'pack.json': pack, 'story.json': story, 'roster.json': roster, 'mapping.json': mapping };
  for (const [fn, obj] of Object.entries(files)) {
    if (!obj || typeof obj !== 'object') continue; // 可选文件缺失就不写
    fs.writeFileSync(path.join(base, fn), JSON.stringify(obj, null, 2), 'utf8');
  }

  const reg = readRegistry();
  const entry = {
    id,
    name,
    dir: id,
    dirName: dirName0,
    stories: Array.isArray(pack.stories) ? pack.stories.map(String) : [],
    type: String(pack.type || 'mapping'),
    version: pack.version,
    notes: pack.notes || '',
    installedAt: Date.now(),
    source: 'user',
  };
  const i = reg.packs.findIndex((p) => p.id === id);
  if (i >= 0) reg.packs[i] = entry; else reg.packs.push(entry);
  writeRegistry(reg);
  return entry;
}

// 扫描所有资产集目录（以 pack.json 为准）
function listPacks() {
  const packs = [];
  let dirs = [];
  try { dirs = fs.readdirSync(MAP_ROOT); } catch { /* 无 map_design */ }
  for (const dir of dirs) {
    const pf = path.join(MAP_ROOT, dir, 'pack.json');
    if (!fs.existsSync(pf)) continue;
    const pack = readJson(pf);
    if (!pack) continue;
    packs.push(Object.assign({ dir, dirName: dir, stories: [], type: 'mapping', source: 'map_design' }, pack));
  }
  // 登记的资产集：同 id 时覆盖 map_design 的同名条目
  const byId = new Map(packs.map((p) => [p.id || p.dir, p]));
  for (const e of readRegistry().packs) {
    const pf = path.join(ASSETS_ROOT, e.dir, 'pack.json');
    if (!fs.existsSync(pf)) continue;
    const pack = readJson(pf);
    if (!pack) continue;
    byId.set(e.id, Object.assign({ dir: e.dir, dirName: e.dirName || e.dir, stories: e.stories || [], type: e.type || 'mapping', source: 'user', installedAt: e.installedAt }, pack));
  }
  return [...byId.values()];
}

// 资产集的元数据层：story / roster / mapping（都是可分发的 JSON）
// 读取顺序：**map_design/<dir> 优先**，再回落登记目录 assets/assetpacks/<dir>。
//
// 为什么 map_design 优先：登记目录是「用户选文件夹登记」时写的一份快照，
// 之后用户直接改 map_design 里的 roster.json（加 defCharacterAssets 等）时，
// 登记目录那份不会跟着更新 —— 若登记目录优先，改动永远不生效。
// 登记目录存在的意义是「用户选了 map_design 之外的文件夹」，那种情况 map_design 没有，
// 自然会回落到登记目录。
function packMeta(dir) {
  const bases = [path.join(MAP_ROOT, dir), path.join(ASSETS_ROOT, dir)];
  const base = bases.find((b) => fs.existsSync(b));
  if (!base) return null;
  // 逐个文件取「先找到的那个」：map_design 有就用它，没有的（用户自选目录）用登记目录补
  const pick = (fn) => {
    for (const b of bases) {
      const v = readJson(path.join(b, fn));
      if (v) return v;
    }
    return null;
  };
  return {
    dir,
    pack: pick('pack.json'),
    story: pick('story.json'),
    roster: pick('roster.json'),
    mapping: pick('mapping.json'),
  };
}

// 资产集里声明的角色池 ∩ 本地引擎已装且可跑的角色
function packCharPool(dir) {
  const meta = packMeta(dir);
  const pool = meta && meta.mapping && Array.isArray(meta.mapping.charPool) ? meta.mapping.charPool : [];
  return pool.filter((id) => localCharExists(id));
}

// 资产集目录下真实存在的角色包（<map_design>/<dir>/chars/<charId>/ 内有 .def）
// 用途：查看器用「本地选文件夹」载入后能反查这是哪个资产集的哪个角色，
// 从而刷新页面时按服务器路径恢复（本地 File 对象不可持久化）。
// 返回 [{ id, def, files: [{ name, size }], meta }]：meta = 该角色的 char.json
//   （职业 / roleType / 关键帧模式），没有该文件时为 null。
function packCharDirs(dir) {
  const byId = new Map();
  for (const base of [path.join(MAP_ROOT, dir), path.join(ASSETS_ROOT, dir)]) {
    const charsDir = path.join(base, 'chars');
    let names = [];
    try { names = fs.readdirSync(charsDir); } catch { continue; }
    for (const name of names) {
      const cd = path.join(charsDir, name);
      let files = [];
      try {
        if (!fs.statSync(cd).isDirectory()) continue;
        files = listFilesRecursive(cd);
      } catch { continue; }
      const def = files.find((f) => /\.def$/i.test(f.name));
      if (!def) continue;
      const prev = byId.get(name);
      if (prev && prev.files.length >= files.length) continue;
      const metaFile = files.find((f) => /^char\.json$/i.test(f.name));
      const meta = metaFile ? readJson(path.join(cd, metaFile.name)) : null;
      byId.set(name, { id: name, def: def.name, files, meta });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// 递归列文件（相对 root 的正斜杠路径 + 字节数），跳过二进制体积过大的？不跳过，
// 查看器要用 (name,size) 做「本地选中的文件夹 ↔ 服务器角色目录」指纹比对。
function listFilesRecursive(root, sub = '') {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(path.join(root, sub)); } catch { return out; }
  for (const n of names) {
    const rel = sub ? sub + '/' + n : n;
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.isDirectory()) out.push(...listFilesRecursive(root, rel));
    else out.push({ name: rel, size: st.size });
  }
  return out;
}

// ---------------- 兜底资产层（只读） ----------------
// ikemen-fs/file 是「随站点分发的默认集合」，不是资产集仓库。
// 资产集的角色永远不拷进这里 —— 见 md/curdesign/ai格斗设计/资产集/资产绑定方案.md。
const LOCAL_CHARS_DIR = path.join(__dirname, '..', '..', 'ikemen-fs', 'file', 'chars');
// 兜底层里资源残缺、引擎跑不起来的包（缺 sff / def 引用了不存在的文件）。
// 这条名单只管兜底层；资产集里的角色由资产集自己负责完整性。
const BROKEN_CHARS = new Set(['98-kim', 'MasterRyu']);

function localCharExists(id) {
  if (BROKEN_CHARS.has(id)) return false;
  try {
    const dir = path.join(LOCAL_CHARS_DIR, id);
    if (!fs.existsSync(dir)) return false;
    // 角色包要同时有 sff 和 def 才是完整包
    const files = fs.readdirSync(dir);
    return files.some((f) => /\.def$/i.test(f));
  } catch { return false; }
}
function localCharIds() {
  try {
    return fs.readdirSync(LOCAL_CHARS_DIR).filter((d) => localCharExists(d));
  } catch { return []; }
}

// ---------------- 资产集目录解析 ----------------
// 一个资产集可能有两个落点：
//   1) map_design/<dir>/            —— 仓库里的资产集（开发者维护）
//   2) assets/assetpacks/<dir>/     —— 用户登记的资产集（只落了元数据 JSON）
// 运行时资源（角色包等）只在 1) 里；2) 是登记快照。
// 下面所有「资产集自带文件」的解析都走 packBase()，保证一处口径。
function packBase(dir) {
  const a = path.join(MAP_ROOT, dir);
  if (fs.existsSync(a)) return a;
  const b = path.join(ASSETS_ROOT, dir);
  if (fs.existsSync(b)) return b;
  return null;
}

// 资产集里某个角色的包目录（找不到返回 null）
function packCharDir(dir, charId) {
  const base = packBase(dir);
  if (!base) return null;
  const cd = path.join(base, 'chars', charId);
  try { return fs.statSync(cd).isDirectory() ? cd : null; } catch { return null; }
}

// 资产集里某个角色用哪个 .def 作为入口。
// 一个角色包里常常有多个 .def（主角色 + 变体，例如 LaoLeiKFM 里有
// LaoLeiKFM.def / RalfAct.def / ikari.def），引擎的约定是「目录名同名的那个」
// 才是这个角色的入口 —— 它上面的 [Info] name 也是这个角色的名字。
// 找不到同名 .def 才退回第一个（按文件名排序）。
function packCharDefName(dir, charId) {
  const cd = packCharDir(dir, charId);
  if (!cd) return null;
  const names = listFilesRecursive(cd).filter((f) => /\.def$/i.test(f.name)).map((f) => f.name).sort();
  if (!names.length) return null;
  const exact = names.find((n) => n.toLowerCase() === (charId + '.def').toLowerCase());
  return exact || names[0];
}

// .def 里 [Files] 引用的资产是否都能找到
// extraRoot：额外的查找根（兜底层 ikemen-fs/file），引擎本来就会去那里找。
function defAssetsResolve(base, defRel, extraRoot) {
  let text;
  try { text = fs.readFileSync(path.join(base, defRel), 'latin1'); } catch { return false; }
  const KEYS = ['cns', 'st', 'st1', 'st2', 'st3', 'st4', 'st5', 'st6', 'st7', 'st8', 'stcommon',
    'sprite', 'anim', 'sound', 'cmd',
    'pal1', 'pal2', 'pal3', 'pal4', 'pal5', 'pal6'];
  const defDir = path.posix.dirname(defRel);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(';')[0].trim();
    if (!line || line[0] === '[') continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim().toLowerCase();
    const v = line.slice(eq + 1).trim();
    if (!KEYS.includes(k) || !v) continue;
    // 引擎的查找根：def 所在目录 / 根 / data/
    const roots = [defDir, '', 'data'];
    let found = false;
    for (const r of roots) {
      const rel = r ? r + '/' + v : v;
      for (const cand of [rel, rel + '.zss']) {
        try { if (fs.statSync(path.join(base, cand)).isFile()) { found = true; break; } } catch { /* 继续找 */ }
      }
      if (found) break;
    }
    if (!found && extraRoot) {
      for (const r of roots) {
        const rel = r ? r + '/' + v : v;
        for (const cand of [rel, rel + '.zss']) {
          try { if (fs.statSync(path.join(extraRoot, cand)).isFile()) { found = true; break; } } catch { /* 继续找 */ }
        }
        if (found) break;
      }
    }
    if (!found) return false;
  }
  return true;
}

// 资产集里实际存在的角色 id 列表（目录里有角色包就算存在）
function packCharIds(dir) {
  const base = packBase(dir);
  if (!base) return [];
  const charsDir = path.join(base, 'chars');
  let names = [];
  try { names = fs.readdirSync(charsDir); } catch { return []; }
  return names
    .filter((n) => { try { return fs.statSync(path.join(charsDir, n)).isDirectory(); } catch { return false; } })
    .sort();
}

// 资产集里真正「能用」的角色：入口 .def 引用的资产齐。
// 注意 MasterRyu：它的 Sprite.sff 是合法的 SFF v2（不是残缺文件），
// 但 def 里写的 stcommon=common1.cns 在角色包内不存在 —— 引擎的查找根
// 里有 data/，兜底层有 data/common1.cns.zss，所以它靠兜底层才跑得起来。
// 资产集自带 data/ 时同样成立，因此这里按「资产集根 + 兜底层」一起解析。
function packCharUsable(dir, charId) {
  const defName = packCharDefName(dir, charId);
  if (!defName) return false;
  const base = packBase(dir);
  const defRel = 'chars/' + charId + '/' + defName;
  if (defAssetsResolve(base, defRel)) return true;
  // 回落：允许引用兜底层的 data/（引擎本来就会去那里找）
  return defAssetsResolve(base, defRel, path.join(__dirname, '..', '..', 'ikemen-fs', 'file'));
}

// 资产集声明的角色池 ∩ 资产集自带且可用的角色
// 这是「这个资产集能跑哪些角色」的唯一真源 —— 不再看引擎目录。
function packCharPool(dir) {
  const meta = packMeta(dir);
  const pool = meta && meta.mapping && Array.isArray(meta.mapping.charPool) ? meta.mapping.charPool : [];
  const have = packCharIds(dir).filter((id) => packCharUsable(dir, id));
  const haveSet = new Set(have);
  const own = pool.filter((id) => haveSet.has(id));
  // 声明的池里没有可用的，但资产集目录里确实有能跑的角色 → 用目录里的
  // （声明可能过期，目录才是实物）
  return own.length ? own : have;
}

// ---------------- 资产集的文件清单（挂载用） ----------------
// 返回 { baseUrl, files: {vpath: size} }：
//   baseUrl 是这个资产集在 HTTP 上的根（相对仓库根的路径），
//   files 是「相对资产集根」的路径 → 字节数。
// 引擎按这个清单懒加载：只拉它真正打开的文件，一个 800 文件的资产集
// 不会一次性下载。
//
// 用资产集自带的 manifest.json（若存在）作为清单来源，它就是资产集自己的
// 「打包清单」；没有就现扫一遍目录。
function packFiles(dir) {
  const base = packBase(dir);
  if (!base) return null;
  const relBase = path.relative(path.join(__dirname, '..', '..'), base).split(path.sep).join('/');
  const files = {};
  const mf = readJson(path.join(base, 'manifest.json'));
  if (mf && mf.files && typeof mf.files === 'object') {
    for (const [k, v] of Object.entries(mf.files)) {
      if (typeof v === 'number') files[k] = v;
    }
  } else {
    for (const f of listFilesRecursive(base)) files[f.name] = f.size;
  }
  // 元数据 JSON 不是引擎资产，挂上去只会让引擎误以为有同名 .def
  for (const meta of ['manifest.json', 'pack.json', 'story.json', 'roster.json', 'mapping.json']) {
    delete files[meta];
  }
  return { baseUrl: './' + relBase, files, root: relBase };
}

// ---------------- 资产集的角色名单（select.def） ----------------
// 引擎的选人屏读 data/select.def 的 [Characters]。这份名单必须跟着
// 绑定到资产集走，所以按资产集自己的 chars/ 目录生成，运行时覆盖掉兜底层的那份。
function packSelectDef(dir) {
  // 只列真正能跑的角色（入口 .def 引用的资产齐），坏包不进名单
  const ids = packCharIds(dir).filter((id) => packCharUsable(dir, id));
  const lines = ['; 由服务端按资产集 ' + dir + ' 的 chars/ 目录生成（运行时覆盖 data/select.def）', '[Characters]'];
  for (const id of ids) {
    const defName = packCharDefName(dir, id);
    if (!defName) continue;
    lines.push(id + '/' + defName);
  }
  const base = packBase(dir);
  const stages = [];
  if (base) {
    let names = [];
    try { names = fs.readdirSync(path.join(base, 'stages')); } catch { names = []; }
    for (const n of names) {
      if (!/\.def$/i.test(n)) continue;
      stages.push('stages/' + n);
    }
  }
  lines.push('', '[ExtraStages]');
  for (const s of stages) lines.push(s);
  return lines.join('\n') + '\n';
}

// ---------------- 角色资产元信息（char.json） ----------------
// 每个角色包目录里可以放一个 char.json，声明：
//   { charId, displayName, roleType, profession, keyframeMode, description, ... }
// keyframeMode: 'some' = 抽关键帧（只换代表帧）/ 'merge' = 融合关键帧（AI 图与原精灵叠加）
//                / 'all' = 全替关键帧 / 'none' = 不用
//
// 查找顺序（先到先得）：
//   1) 资产集目录 map_design/<dir>/chars/<id>/char.json ← 资产集拥有这份标记
//   2) 登记目录 assets/assetpacks/<dir>/chars/<id>/char.json
//   3) 兜底目录 ikemen-fs/file/chars/<id>/char.json   ← 只有兜底角色才有
function readCharMeta(charId, packDir) {
  const dirs = [];
  if (packDir) {
    dirs.push(path.join(MAP_ROOT, packDir, 'chars', charId));
    dirs.push(path.join(ASSETS_ROOT, packDir, 'chars', charId));
  }
  dirs.push(path.join(LOCAL_CHARS_DIR, charId));
  for (const d of dirs) {
    const m = readJson(path.join(d, 'char.json'));
    if (m && typeof m === 'object') return m;
  }
  return null;
}

// 批量：资产集下所有角色的元信息（{ charId: meta }）
function packCharMetas(dir) {
  const out = {};
  for (const c of packCharDirs(dir)) {
    const m = readCharMeta(c.id, dir);
    if (m) out[c.id] = m;
  }
  return out;
}

// ---------------- 写入角色资产标记（char.json） ----------------
// 写到哪里（先到先得，只写一处，避免同一角色有两份不一致的标记）：
//   1) 资产集目录 map_design/<dir>/chars/<id>/char.json   ← 资产集拥有这份标记
//   2) 登记目录 assets/assetpacks/<dir>/chars/<id>/char.json
//   3) 兜底目录 ikemen-fs/file/chars/<id>/char.json（只有兜底角色才有）
// 引擎目录是只读的兜底层，不写。
function writeCharMeta({ charId, packDir, meta }) {
  const id = String(charId || '').trim();
  if (!id || !/^[A-Za-z0-9_'\-]+$/.test(id)) throw new Error('角色名不合法');
  const m = meta && typeof meta === 'object' ? meta : {};
  const kf = String(m.keyframeMode || '').toLowerCase();
  if (kf && !['some', 'merge', 'all', 'none'].includes(kf)) {
    throw new Error('keyframeMode 只能是 some/merge/all/none');
  }
  const dir = packDir ? String(packDir) : '';
  const targets = [];
  if (dir) {
    targets.push(path.join(MAP_ROOT, dir, 'chars', id));
    targets.push(path.join(ASSETS_ROOT, dir, 'chars', id));
  }
  targets.push(path.join(LOCAL_CHARS_DIR, id));
  if (!targets.length) throw new Error('找不到角色目录：' + id);
  // 已存在 char.json 的那个目录优先（避免同一角色出现两份不一致的标记）
  const existing = targets.find((d) => fs.existsSync(path.join(d, 'char.json')));
  const target = existing || targets[0];
  const file = path.join(target, 'char.json');
  const old = readJson(file) || {};
  const out = {
    ...old,
    ...m,
    charId: id,
    keyframeLabel: m.keyframeLabel ||
      ({ some: '抽关键帧', merge: '融合关键帧', all: '全替关键帧', none: '不使用关键帧' })[kf] || old.keyframeLabel || '',
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  return { path: file, meta: out };
}

module.exports = {
  MAP_ROOT, ASSETS_ROOT, REGISTRY_PATH,
  listPacks, packMeta, packCharPool, packCharDirs, packCharMetas,
  readCharMeta, writeCharMeta,
  localCharIds, localCharExists,
  readRegistry, registerPack,
  // 资产集自己的资源（挂载 / 名单 / 角色完整性）
  packBase, packCharDir, packCharIds, packCharUsable, packFiles, packSelectDef,
};