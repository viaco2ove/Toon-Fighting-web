// 拉取 toonflow 故事（world）全部角色的 avatar 并抽帧成生图参考
//   full.png 512x512（全身立绘、拍平第一帧）+ head.png 600x600（cover top 裁头）
//   同时落盘 roles-<worldId>.json（settings.roles + playerRole 合并清单，后续 personas 用）
// 跑: node fetch-avatars.mjs <worldId> <outRefsDir>
// 例: node fetch-avatars.mjs 47 .cache/role-refs-sheye
// 依赖：sharp（后端项目的）；后端地址/账号读项目 .env
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH
  || 'D:/Users/viaco/tools/Toonflow-game/toonflow-game-app/node_modules/sharp');

const [worldIdArg, outRefsArg] = process.argv.slice(2);
if (!worldIdArg || !outRefsArg) {
  console.error('用法: node fetch-avatars.mjs <worldId> <outRefsDir>');
  process.exit(1);
}
const worldId = Number(worldIdArg);
const OUT = outRefsArg;

// ---------- 登录（.env） ----------
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BACKEND = String(env.game_app_service_url || '').replace(/\/+$/, '');
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(env.auth_token || '').trim().replace(/^Bearer\s+/i, '') };

// ---------- getWorld ----------
const w = await (await fetch(BACKEND + '/game/getWorld', {
  method: 'POST', headers: H, body: JSON.stringify({ worldId }), signal: AbortSignal.timeout(30000),
})).json();
const data = w.data || {};
const roles = data?.settings?.roles || [];
const playerRole = data?.playerRole;   // 玩家主角不在 settings.roles 里，单独字段！
const all = [...(playerRole ? [playerRole] : []), ...roles];
console.log(`world ${worldId} 角色：${all.length}（含 player: ${playerRole ? playerRole.name : '无'}）`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `roles-${worldId}.json`), JSON.stringify(data, null, 1), 'utf8');

// ---------- 下载 + 抽帧 ----------
for (const r of all) {
  if (!r.avatarPath) { console.warn('[skip]', r.name, '无 avatarPath'); continue; }
  const dir = path.join(OUT, r.name, 'avatar');
  if (fs.existsSync(path.join(dir, 'full.png')) && fs.existsSync(path.join(dir, 'head.png'))) {
    console.log('[have]', r.name); continue;
  }
  const url = BACKEND + r.avatarPath;   // OSS 相对路径直连后端（原图 75 帧动图 webp）
  const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) { console.warn('[fail]', r.name, resp.status); continue; }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  await sharp(buf).resize(512, 512, { fit: 'contain', background: '#ffffff' }).png().toFile(path.join(dir, 'full.png'));
  await sharp(buf).resize(600, 600, { fit: 'cover', position: 'top' }).png().toFile(path.join(dir, 'head.png'));
  console.log('[ok]', r.name, Math.round(buf.length / 1048576 * 10) / 10, 'MB');
}
console.log('done →', OUT);
