// 资产集（地图集）管理：扫描 map_design 下的资产集、读元数据、列出可安装的包。
// 与 --conn 无关：纯本地模式也要能用默认资产集。
'use strict';
const fs = require('fs');
const path = require('path');

const MAP_ROOT = path.join(__dirname, '..', '..', 'workshops', 'toon-fighting-web', 'map_design');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// 扫描所有资产集目录（以 pack.json 为准）
function listPacks() {
  const packs = [];
  let dirs = [];
  try { dirs = fs.readdirSync(MAP_ROOT); } catch { return packs; }
  for (const dir of dirs) {
    const pf = path.join(MAP_ROOT, dir, 'pack.json');
    if (!fs.existsSync(pf)) continue;
    const pack = readJson(pf);
    if (!pack) continue;
    packs.push(Object.assign({ dir, stories: [], type: 'mapping' }, pack));
  }
  return packs;
}

// 资产集的元数据层：story / roster / mapping（都是可分发的 JSON）
function packMeta(dir) {
  const base = path.join(MAP_ROOT, dir);
  if (!fs.existsSync(base)) return null;
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

module.exports = { MAP_ROOT, listPacks, packMeta, packCharPool, localCharIds, localCharExists };