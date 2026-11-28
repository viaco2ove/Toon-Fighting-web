// 把 PC 端资产集目录打包推到手机并安装（+可选绑定故事）。
//
// 流程：zip（deflate，UTF-8 文件名标志位）→ adb push → MCP install_asset_pack
//       → list_installed_packs 复核（含 stories 字段）→ --bind 时读包内 story.json 绑定。
//
// 用法:
//   node push-pack.mjs <资产集目录> [--bind] [--packId <id>] [--keep]
// 例:
//   node push-pack.mjs "workshops/toon-fighting-web/map_design/通天传授-收徒系统" --bind
// 环境变量: ADB_SERIAL / PHONE_HOST / MCP_PORT（见 mcp.mjs）
//   zip 落 .cache/push/<packId>.zip；--keep 保留 zip 不删
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { deviceReady, ensureApp, callTool, adbPath, SERIAL } from './mcp.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const srcDir = args[0];
const doBind = flags.includes('--bind');
const keep = flags.includes('--keep');
const packIdArg = (flags.find((f) => f.startsWith('--packId')) || '').split('=')[1] || null;
if (!srcDir || !fs.existsSync(srcDir)) { console.error('用法: node push-pack.mjs <资产集目录> [--bind] [--packId <id>]'); process.exit(1); }

const packJson = JSON.parse(fs.readFileSync(path.join(srcDir, 'pack.json'), 'utf8'));
const packId = packIdArg || packJson.id;
const storyName = (packJson.stories || [])[0] || null;
console.log(`资产集 ${packId}（${storyName || '未声明 stories'}）`);

// ---------- ① zip（根层内容；跳过垃圾文件） ----------
const SKIP = [/\.bak/i, /^\._/, '.DS_Store', 'Thumbs.db'];
function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.some((s) => (s instanceof RegExp ? s.test(name) : name === s))) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    const key = rel ? rel + '/' + name.replace(/\\/g, '/') : name;
    if (st.isDirectory()) walk(full, key, out);
    else out.push({ key, full, size: st.size });
  }
  return out;
}
function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  // 局部头 + 数据 + 中央目录（version 2.0，method 8=deflate / 0=store，bit11=UTF-8 文件名）
  const chunks = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff], u32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const raw = fs.readFileSync(f.full);
    const def = zlib.deflateRawSync(raw, { level: 6 });
    const useDef = def.length < raw.length;
    const data = useDef ? def : raw;
    const method = useDef ? 8 : 0;
    const crc = crc32(raw);
    const name = Buffer.from(f.key, 'utf8');
    const dosTime = 0, dosDate = ((new Date().getFullYear() - 1980) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate();
    const local = Buffer.concat([Buffer.from(u32(0x04034b50)), Buffer.from(u16(20)), Buffer.from(u16(0x0800)),
      Buffer.from(u16(method)), Buffer.from(u16(dosTime)), Buffer.from(u16(dosDate)), Buffer.from(u32(crc)),
      Buffer.from(u32(data.length)), Buffer.from(u32(raw.length)), Buffer.from(u16(name.length)), Buffer.from(u16(0)), name]);
    chunks.push(local, data);
    central.push(Buffer.concat([Buffer.from(u32(0x02014b50)), Buffer.from(u16(20)), Buffer.from(u16(20)), Buffer.from(u16(0x0800)),
      Buffer.from(u16(method)), Buffer.from(u16(dosTime)), Buffer.from(u16(dosDate)), Buffer.from(u32(crc)),
      Buffer.from(u32(data.length)), Buffer.from(u32(raw.length)), Buffer.from(u16(name.length)), Buffer.from(u16(0)),
      Buffer.from(u16(0)), Buffer.from(u16(0)), Buffer.from(u16(0)), Buffer.from(u32(0)), Buffer.from(u32(offset)), name]));
    offset += local.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.concat([Buffer.from(u32(0x06054b50)), Buffer.from(u16(0)), Buffer.from(u16(0)),
    Buffer.from(u16(files.length)), Buffer.from(u16(files.length)), Buffer.from(u32(cd.length)), Buffer.from(u32(offset)), Buffer.from(u16(0))]);
  return Buffer.concat([...chunks, cd, end]);
}
const files = walk(srcDir, '', []);
const total = files.reduce((s, f) => s + f.size, 0);
const outDir = path.join('.cache/push');
fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, packId + '.zip');
process.stdout.write(`打包 ${files.length} 文件 / ${(total / 1048576).toFixed(1)}MB → ${zipPath} … `);
fs.writeFileSync(zipPath, makeZip(files));
console.log(`zip ${(fs.statSync(zipPath).size / 1048576).toFixed(1)}MB`);

// ---------- ② adb push ----------
const dev = deviceReady();
if (!dev.ok) { console.error(dev.why); process.exit(1); }
const remote = '/data/local/tmp/tf-' + packId + '.zip';
process.stdout.write(`adb push → ${remote} … `);
const t0 = Date.now();
execFileSync(adbPath(), SERIAL ? ['-s', SERIAL, 'push', zipPath, remote] : ['push', zipPath, remote],
  { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------- ③ 安装 ----------
const app = await ensureApp();
if (!app.ok) { console.error(app.why); process.exit(1); }
const r = await callTool('install_asset_pack', { source: remote, packId });
console.log('安装：', JSON.stringify(r));

// ---------- ④ 复核（含 stories，故事跟随逻辑靠它） ----------
const list = await callTool('list_installed_packs');
const mine = (list.packs || []).find((p) => (p.id || p.packId) === packId || p.dir === packId);
console.log('复核：', JSON.stringify(mine || null));
if (!mine) { console.error('安装后没在 list_installed_packs 里看到 ' + packId); process.exit(1); }
const stories = mine.stories || (mine.info && mine.info.stories) || [];
if (storyName && !stories.includes(storyName)) console.warn(`⚠️ 已安装但 stories 未声明「${storyName}」——故事跟随会失效（查包内 pack.json）`);
else if (storyName) console.log(`stories ✓ 「${storyName}」`);

// ---------- ⑤ 绑定故事 ----------
if (doBind) {
  const storyJsonPath = path.join(srcDir, 'story.json');
  if (!fs.existsSync(storyJsonPath)) { console.error('包内无 story.json，无法 --bind'); process.exit(1); }
  const story = JSON.parse(fs.readFileSync(storyJsonPath, 'utf8'));
  let sid = story.sessionId;
  try {
    const b = await callTool('bind_story_session', { sessionId: sid, packId });
    console.log('绑定：', JSON.stringify(b));
  } catch (e) {
    // 会话 id 对不上（手机端登录账号的会话列表里没有）→ 按故事名在会话列表里找
    console.warn('按 story.json 绑定失败：', String(e.message || e).slice(0, 120), '→ 改按故事名找会话');
    const ls = await callTool('list_story_sessions');
    const sessions = ls.sessions || [];
    const hit = sessions.find((s) => (s.title || s.name || '').includes(storyName || '')) || sessions[0];
    if (!hit) { console.error('会话列表为空，无法兜底绑定'); process.exit(1); }
    sid = hit.sessionId || hit.id;
    console.log(`兜底会话：${sid}（${hit.title || hit.name}）`);
    const b = await callTool('bind_story_session', { sessionId: sid, packId });
    console.log('绑定：', JSON.stringify(b));
  }
  const cfg = await callTool('get_config');
  const c = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
  console.log('当前绑定：', JSON.stringify({ sessionId: c.boundSessionId, packId: c.boundPackId, story: c.boundStoryName || undefined }));
}

if (!keep && fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
console.log('完成');
