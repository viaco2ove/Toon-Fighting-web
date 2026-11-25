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
// 优先读登记目录（assets/assetpacks/<dir>），再回落 map_design/<dir>
function packMeta(dir) {
  const bases = [path.join(ASSETS_ROOT, dir), path.join(MAP_ROOT, dir)];
  const base = bases.find((b) => fs.existsSync(b));
  if (!base) return null;
  return {
    dir,
    pack: readJson(path.join(base, 'pack.json')),
    story: readJson(path.join(base, 'story.json')),
    roster: readJson(path.join(base, 'roster.json')),
    mapping: readJson(path.join(base, 'mapping.json')),
  };
}

// 资产集里声明的角色池 ∩ 本地引擎已装且可跑的角色
function packCharPool(dir) {
  const meta = packMeta(dir);
  const pool = meta && meta.mapping && Array.isArray(meta.mapping.charPool) ? meta.mapping.charPool : [];
  return pool.filter((id) => localCharExists(id));
}

// 本地引擎已装角色目录
const LOCAL_CHARS_DIR = path.join(__dirname, '..', '..', 'ikemen-fs', 'file', 'chars');
// 资源残缺、引擎跑不起来的角色（见资产集 mapping.charPoolExcluded）
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

module.exports = { MAP_ROOT, ASSETS_ROOT, REGISTRY_PATH, listPacks, packMeta, packCharPool, localCharIds, localCharExists, readRegistry, registerPack };