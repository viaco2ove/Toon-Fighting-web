#!/usr/bin/env node
// Toon-Fighting-web 静态服务器 +（--conn）toonflow 后端 BFF 代理
//
// 用法：
//   node serve.cjs [port]                        # 纯本地（形态 A）
//   node serve.cjs [port] --conn                 # 联动后端（读 .env，形态 B）
//   node serve.cjs -- --story <故事名> --conn    # 直达故事会话（形态 C）
//   node serve.cjs --chrome [port]               # Chrome/Edge app 模式（无地址栏独立窗口）
//   node serve.cjs --go [exe路径]                # 原生引擎档：网页做 UI + spawn Ikemen_GO.exe 跑对局
//                                                #   exe 默认找 .cache/ikemen-native/Ikemen_GO.exe
//
// 代理契约（前端只打 /api/conn/*，token 永不下发到页面）：
//   GET  /api/conn/status                        # 联通自检（版本+登录态+会话数）
//   GET  /api/conn/sessions                      # 会话列表（60s 内存缓存）
//   GET  /api/conn/sessions/:sid/messages        # 会话消息（取故事角色/剧情概要）
//   GET  /api/conn/session-data/:sid/:key        # t_plugin_session_data 读
//   PUT  /api/conn/session-data/:sid/:key        # 写，body {value}（800ms 同 key 合并）
//   POST /api/conn/agent/generate                # 生图，body {prompt, refImages?, size?}
//   GET  /api/conn/story                         # --story 绑定种子或 .env 缺省
//
// 红线：对局进行中前端不发任何 /api 请求；后端不可达时全部 {ok:false}，页面回退本地模式。
//
// 本地接口（不依赖 --conn）：
//   GET  /api/assetpacks                         # 资产集列表（map_design 扫描 + assets/assetpacks 登记簿）
//   GET  /api/packs/:dir                         # 资产集元数据 pack/story/roster/mapping
//   POST /api/packs/register                     # 登记用户自选的资产集文件夹（body {dirName,pack,story,roster,mapping}）
const { listPacks, packMeta, localCharIds, registerPack, packCharDirs, packCharMetas, writeCharMeta, packFiles, packSelectDef, packCharPool, packCharIds, packBase, packCharDir, packCharDefName } = require('./server/lib/packs.cjs');
const { portraitFor } = require('./server/lib/portrait.cjs');
const { animFrames } = require('./server/lib/anim.cjs');
const { buildSpeechRequest, cleanLine } = require('./server/lib/speech-agent.cjs');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PLUGIN_ID = 'com.viaco.toon-fighting';
const SPRITE_AGENT = 'field-survival-sprite-gener'; // PluginAgentRunner sprite 分支
const CHARS_DIR = path.join(ROOT, 'ikemen-fs', 'file', 'chars');

// 角色包的查找根：绑定资产集时，角色在资产集自己的 chars/ 里；
// 没有绑定（或角色不在资产集里）才回落到兜底层。
// 这就是「资产集自带资产、引擎目录只放兜底」在读路径上的体现 ——
// 同一个角色 id，在不同资产集下解析到不同的目录。
function charPkgDir(packDir, charId) {
  if (packDir) {
    const cd = packCharDir(packDir, charId);
    if (cd) return cd;
  }
  return path.join(CHARS_DIR, charId);
}
// 端口rait/anim/pose 用的「chars 根」：资产集优先
function charPkgRoot(packDir) {
  if (packDir) {
    const base = packBase(packDir);
    if (base) return path.join(base, 'chars');
  }
  return CHARS_DIR;
}

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const dashIdx = argv.indexOf('--');
const preArgs = dashIdx === -1 ? argv : argv.slice(0, dashIdx);
const postArgs = dashIdx === -1 ? [] : argv.slice(dashIdx + 1);
const allArgs = argv; // --conn 在两段都认
let PORT = 8100;
for (const a of preArgs) { const n = Number(a); if (Number.isFinite(n) && n > 0) PORT = n; }
const CONN = allArgs.includes('--conn');

// --chrome：Chrome/Edge 的 --app 模式开一个无地址栏的独立窗口（伪 GUI 壳）
const CHROME = allArgs.includes('--chrome');
// --go：原生引擎调度档。前端网页照旧做全部 UI，对局交给 serve.cjs spawn 的
// 原生 Ikemen_GO.exe 子进程：argv 直通、stdout 收 TF_HEAD/TF_RESULT、
// watch save/tf-result.ini 收结算、SendInput 桥注入虚拟手柄按键。
// 可选紧跟一个 exe 路径：node serve.cjs --go D:\path\Ikemen_GO.exe
const GO_MODE = allArgs.includes('--go');
let GO_EXE = '';
{
  const i = allArgs.indexOf('--go');
  if (i !== -1) {
    const next = allArgs[i + 1];
    if (next && !next.startsWith('--') && /\.(exe|AppImage)$/i.test(next)) GO_EXE = next;
  }
}

// --story 末世选择，从解析神明开始成神
let storyName = '';
{
  const i = postArgs.indexOf('--story') !== -1 ? postArgs.indexOf('--story') : allArgs.indexOf('--story');
  const src = postArgs.indexOf('--story') !== -1 ? postArgs : allArgs;
  if (i !== -1 && src[i + 1] && !src[i + 1].startsWith('--')) {
    storyName = src.slice(i + 1).join(' ').split(/\s+--/)[0].trim();
  }
}

// ---------- .env ----------
function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
    }
  } catch { /* 无 .env 时 --conn 不可用 */ }
  return out;
}
const ENV = loadEnv();
const BACKEND = String(ENV.game_app_service_url || '').replace(/\/+$/, '');
// OSS 静态根：角色头像（avatarPath）就在这里，后端用 express.static 暴露。
const OSS_ROOT = String(ENV.oss_url || '').trim() || BACKEND;

// ---------- token 管理（仅内存，永不回传前端） ----------
let token = String(ENV.auth_token || '').trim().replace(/^Bearer\s+/i, '');
let tokenUser = null;
try { const p = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8')); tokenUser = p && Number(p.id) > 0 ? p : null; } catch { /* 无 token */ }

async function login() {
  const username = ENV.user_name, password = ENV.user_psw;
  if (!username || !password) throw new Error('.env 缺 user_name/user_psw，无法登录');
  const r = await bfPost('/other/login', { username, password }, { auth: false });
  token = String(r.token || '').replace(/^Bearer\s+/i, '');
  try { tokenUser = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')); } catch { tokenUser = null; }
  console.log('[conn] 已用账号重新获取 token');
}

// ---------- 登录会话（后端 token 只留服务端） ----------
// 页面拿到的是 HttpOnly cookie 里的本地 sid；后端 token 存在这里，
// 转发请求时按 cookie 取。页面 JS 永远接触不到后端 token。
const sessions = new Map(); // sid -> { token, user, at }
function issueSession(tok, user) {
  const sid = require('crypto').randomBytes(24).toString('hex');
  sessions.set(sid, { token: tok, user: user || null, at: Date.now() });
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
  for (const [k, v] of sessions) if (v.at < cutoff) sessions.delete(k);
  return sid;
}
function sessionFromReq(req) {
  const raw = String(req.headers.cookie || '');
  const m = /(?:^|;\s*)tf_sid=([0-9a-f]+)/.exec(raw);
  if (!m) return null;
  return sessions.get(m[1]) || null;
}

// ---------- 角色头像缩放（可选依赖 sharp） ----------
// 后端存的角色头像是 1024×1024 的 webp/png（8–10MB），直接进页面太重。
// sharp 在后端项目里已有依赖；同机部署时直接借用，找不到就降级返回原图。
let sharpMod = null;
for (const p of [
  process.env.SHARP_PATH,
  // 同机部署：Toonflow-game/Toonflow-game-plugin-ex/Toon-Fighting-web → 上 2 层到 Toonflow-game
  path.join(ROOT, '..', '..', 'toonflow-game-app', 'node_modules', 'sharp'),
  path.join(ROOT, 'node_modules', 'sharp'),
]) {
  if (!p) continue;
  try { sharpMod = require(p); break; } catch { /* 试下一个 */ }
}
const AVATAR_SIZE = 192;   // 界面里头像最多 96px，192 足够 2x
const thumbCache = new Map();

// ---------- 后端调用 ----------
// authTokenOverride：来自登录会话的 token（页面登录后优先用），否则用 .env 的。
async function bf(pathname, body, { auth = true, method = 'POST', timeoutMs = 15000, authTokenOverride = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const use = authTokenOverride || token;
    if (!use) throw new Error('无 token');
    headers.Authorization = 'Bearer ' + use;
  }
  const r = await fetch(BACKEND + pathname, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (r.status === 401 && auth) { const e = new Error('401'); e.code = 401; throw e; }
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error((j && (j.message || j.error)) || ('HTTP ' + r.status)); e.code = r.status; throw e; }
  // 后端响应统一 {code, data, message}；无 data 字段的透传
  return j && 'data' in j && j.data !== undefined ? j.data : j;
}

async function bfAuth(pathname, body, opt) {
  try { return await bf(pathname, body, opt); }
  catch (e) {
    if (e.code === 401) {
      // 会话 token 失效：不能拿 .env 的 token 顶替（那是另一个账号），直接报过期
      if (opt && opt.authTokenOverride) { const e2 = new Error('登录已过期，请重新登录'); e2.code = 401; throw e2; }
      await login(); return await bf(pathname, body, opt);
    }
    throw e;
  }
}

// getSession 是 NDJSON 流（{type:"meta",data} → {type:"message",data}×N→{type:"done",data}），
// 代理层重组为 {meta, messages:[], done} 再给前端
async function bfNdjson(pathname, body, opt) {
  const run = () => bfRaw(pathname, body, opt);
  let text;
  try { text = await run(); }
  catch (e) {
    // 会话 token 失效时不能用 .env 的 token 顶替（那是另一个账号）
    if (e.code === 401 && !(opt && opt.authTokenOverride)) { await login(); text = await run(); }
    else throw e;
  }
  const meta = {}, messages = [];
  let done = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'meta') Object.assign(meta, j.data || {});
    else if (j.type === 'message') messages.push(j.data);
    else if (j.type === 'done') done = j.data;
    else if (j.type === 'error') throw new Error((j.data && j.data.message) || '流内错误');
  }
  return { meta, messages, done };
}

async function bfRaw(pathname, body, opt) {
  const use = (opt && opt.authTokenOverride) || token;
  if (!use) throw new Error('无 token');
  const r = await fetch(BACKEND + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + use },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401) { const e = new Error('401'); e.code = 401; throw e; }
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ': ' + text.slice(0, 200)), { code: r.status });
  return text;
}

// ---------- 节流/缓存 ----------
const sessionsCache = { at: 0, data: null };
const SESSIONS_TTL = 60_000;
const setMerge = new Map(); // `${sid}::${key}` -> {value, timer}
const SET_MERGE_MS = 800;

function mergedSet(sid, key, value, authTok) {
  const k = sid + '::' + key;
  const prev = setMerge.get(k);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(async () => {
    setMerge.delete(k);
    try { await bfAuth('/plugin/data', { sessionId: sid, pluginId: PLUGIN_ID, op: 'set', dataKey: key, value }, { authTokenOverride: authTok }); }
    catch (e) { console.error('[conn] pluginData set 失败', key, e.message); }
  }, SET_MERGE_MS);
  setMerge.set(k, { value, timer });
}

// ---------- /api/conn/* 处理 ----------
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
const fail = (res, e, what) => json(res, 200, { ok: false, error: (e && e.message) || String(e), what });

// 后端 TTS 合成结果缓存（audioProxy 拉回的字节）：同台词+同音色不重复合成。
// Map 按插入序淘汰，超 64 条删最旧。
const TTS_CACHE = new Map();

// ---------- 角色归一化 ----------
// 世界角色（settings.roles 的元素）→ 格斗联动用的统一形态。
// 字段口径来自后端 listImportableRoles / buildMiniGameRoleOptions。
function normalizeRole(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let card = {};
  try { card = typeof r.parameterCardJson === 'string' ? JSON.parse(r.parameterCardJson || '{}') : (r.parameterCardJson || {}); } catch { card = {}; }
  const name = String(r.name || '').trim();
  return {
    id: String(r.id || name).trim(),
    name,
    roleType: String(r.roleType || 'npc').trim() || 'npc',
    description: String(r.description || '').slice(0, 400),
    avatarPath: String(r.avatarPath || card.avatarPath || '').trim(),
    avatarBgPath: String(r.avatarBgPath || card.avatarBgPath || '').trim(),
    profession: String(card.profession || r.profession || '').trim(),
    level: Number(card.level || r.level || 0) || 0,
    hp: Number(card.hp || r.hp || 0) || 0,
    skills: Array.isArray(card.skills) ? card.skills.slice(0, 12) : [],
    sample: String(r.sample || '').slice(0, 200),
    // 音色配置（原样透传给 /api/conn/agent/tts → 后端 /game/streamvoice）：
    // mode 与后端 VoiceMode 枚举同口径：text|clone|mix|prompt_voice
    voice: {
      mode: String(r.voiceMode || '').trim(),
      presetId: String(r.voicePresetId || '').trim(),
      referenceAudioPath: String(r.voiceReferenceAudioPath || '').trim(),
      referenceText: String(r.voiceReferenceText || '').trim(),
      promptText: String(r.voicePromptText || '').trim(),
      mixVoices: Array.isArray(r.voiceMixVoices) ? r.voiceMixVoices.slice(0, 6) : [],
    },
  };
}

async function handleApi(req, res, urlPath, query) {
  // ---- 本地接口：不依赖 --conn（纯本地模式也要有资产集与头像） ----

  // 资产集列表（本地概念，扫 map_design/*/pack.json）
  if (urlPath === '/api/assetpacks') {
    const packs = listPacks();
    // 角色资产元信息（char.json：职业 / roleType / 关键帧模式）
    // 前端运行时（选人屏 / 角色绑定 / 战斗头像条）要读它，
    // 所以随资产集列表一起下发，避免多一次请求。
    const charMeta = {};
    // 每个资产集自带的可跑角色（资产集自己的 chars/，不看引擎目录）
    const packChars = {};
    for (const p of packs) {
      // 键用 p.dir（前端认这个：登记簿里的 packId），值用 dirName 去查资源
      const key = p.dir || p.dirName;
      const res = p.dirName || p.dir;
      if (!key || !res) continue;
      try { Object.assign(charMeta, packCharMetas(res)); } catch { /* 该资产集无 char.json */ }
      try { packChars[key] = packCharPool(res); } catch { packChars[key] = []; }
    }
    return json(res, 200, {
      ok: true,
      packs,
      // 兜底角色：随站点分发的默认集合（ikemen-fs/file/chars，只读）
      fallbackChars: localCharIds(),
      // 旧字段保留：前端老代码读 localChars，语义等于兜底角色
      localChars: localCharIds(),
      packChars,
      charMeta,
      story: storyName || null,
    });
  }

  // 资产集下真实存在的角色目录（<dir>/chars/<charId>）
  // 查看器用它把「本地选文件夹」载入的资产反查成 (pack, charId)，
  // 刷新页面后按服务器路径恢复 —— 本地 File 对象不可持久化，只能走这条路。
  {
    const mc = /^\/api\/packs\/([^/]+)\/chars$/.exec(urlPath);
    if (mc) {
      const dir = decodeURIComponent(mc[1]);
      return json(res, 200, { ok: true, dir, chars: packCharDirs(dir) });
    }
  }

  // 写入角色资产标记（char.json）：关键帧模式 / 职业 / roleType …
  // ff-studio 查看器的「写入 char.json」按钮调用；
  // 运行时（选人屏 / 角色绑定 / 战斗头像条）读的就是这份文件。
  if (urlPath === '/api/charmeta' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload = null;
      try { payload = JSON.parse(body || 'null'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
      try {
        const r = writeCharMeta(payload || {});
        return json(res, 200, { ok: true, ...r });
      } catch (e) {
        return json(res, 200, { ok: false, error: (e && e.message) || String(e) });
      }
    });
    return;
  }

  // 登记用户自选的资产集文件夹（只落元数据 JSON，不拷引擎资产、不上传后端）
  // 注意：这个分支要排在下面 /api/packs/:dir 之前，否则 'register' 会被当成 dir。
  if (urlPath === '/api/packs/register' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload = null;
      try { payload = JSON.parse(body || 'null'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
      try {
        const entry = registerPack({
          dirName: payload && payload.dirName,
          pack: payload && payload.pack,
          story: payload && payload.story,
          roster: payload && payload.roster,
          mapping: payload && payload.mapping,
        });
        return json(res, 200, { ok: true, pack: entry });
      } catch (e) {
        return json(res, 200, { ok: false, error: (e && e.message) || String(e) });
      }
    });
    return;
  }

  // 资产集元数据（story / roster / mapping）
  let m = /^\/api\/packs\/([^/]+)$/.exec(urlPath);
  if (m) {
    const dir = decodeURIComponent(m[1]);
    const meta = packMeta(dir);
    if (!meta) return json(res, 200, { ok: false, error: '没有这个资产集：' + dir });
    return json(res, 200, { ok: true, meta });
  }

  // 资产集的文件清单（挂载用）：vpath → 字节数 + 这个资产集在 HTTP 上的根。
  // 前端拿它调 vfs 的 ikemenVfsMount，把资产集挂进 VFS —— 零拷贝。
  m = /^\/api\/packs\/([^/]+)\/files$/.exec(urlPath);
  if (m) {
    const dir = decodeURIComponent(m[1]);
    const f = packFiles(dir);
    if (!f) return json(res, 200, { ok: false, error: '没有这个资产集：' + dir });
    // 每个角色的入口 def 的完整相对路径（chars/<id>/<def>）。
    // 一个角色包里常常有多个 .def（主角色 + 变体），入口必须是「与目录同名」
    // 那个，否则引擎会加载错角色（LaoLeiKFM 里有 ikari.def / RalfAct.def）。
    const defs = {};
    for (const id of packCharIds(dir)) {
      const dn = packCharDefName(dir, id);
      if (dn) defs[id] = 'chars/' + id + '/' + dn;
    }
    return json(res, 200, {
      ok: true, dir, baseUrl: f.baseUrl, files: f.files,
      chars: packCharIds(dir), pool: packCharPool(dir), defs,
    });
  }

  // 资产集的角色名单（select.def）：按资产集自己的 chars/ 目录生成，
  // 运行时覆盖掉兜底层 data/select.def 的那份。
  m = /^\/api\/packs\/([^/]+)\/select\.def$/.exec(urlPath);
  if (m) {
    const dir = decodeURIComponent(m[1]);
    if (!packBase(dir)) return json(res, 200, { ok: false, error: '没有这个资产集：' + dir });
    const text = packSelectDef(dir);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(text);
  }

  // MUGEN 角色头像（从角色包的 sff 里解 9000,0 立绘 → PNG）
  // ?pack=<dir> 时从该资产集的角色包里取（资产集自带资产优先，兜底层其次）
  m = /^\/api\/portrait\/([^/]+)$/.exec(urlPath);
  if (m) {
    const charId = decodeURIComponent(m[1]);
    if (!/^[A-Za-z0-9_'\-]+$/.test(charId)) return json(res, 400, { ok: false, error: '角色名不合法' });
    const packDir = query.get('pack') || '';
    let png = null;
    try { png = portraitFor(charPkgRoot(packDir), charId); } catch { png = null; }
    if (!png) return json(res, 200, { ok: false, error: '这个角色没有可用头像' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.png.length, 'Cache-Control': 'no-store' });
    return res.end(png.png);
  }

  // MUGEN 角色「动态效果」：AIR 动作的帧序列（选人屏大头像区播放，动作列表第一个 = 0 站立）
  // 返回 { w, h, frames: [{ png(base64), ms }] }，前端逐帧换图即为动画。
  const ANIM_CACHE = new Map();   // charId|action → 结果（进程内缓存，角色包不热更）
  m = /^\/api\/anim\/([^/]+)\/(\d+)$/.exec(urlPath);
  if (m) {
    const charId = decodeURIComponent(m[1]);
    const actionNo = Number(m[2]);
    if (!/^[A-Za-z0-9_'\-]+$/.test(charId)) return json(res, 400, { ok: false, error: '角色名不合法' });
    const packDir = query.get('pack') || '';
    const key = (packDir ? packDir + '|' : '') + charId + '|' + actionNo;
    let anim = ANIM_CACHE.get(key);
    if (anim === undefined) {
      try { anim = animFrames(charPkgRoot(packDir), charId, actionNo); } catch { anim = null; }
      ANIM_CACHE.set(key, anim);
    }
    if (!anim) return json(res, 200, { ok: false, error: '这个角色没有可用的动作帧' });
    return json(res, 200, { ok: true, charId, action: actionNo, ...anim });
  }

  // MUGEN 角色站立姿势单帧 PNG（选人列表卡片用：比 9000,0 头像更像「人」）
  m = /^\/api\/pose\/([^/]+)$/.exec(urlPath);
  if (m) {
    const charId = decodeURIComponent(m[1]);
    if (!/^[A-Za-z0-9_'\-]+$/.test(charId)) return json(res, 400, { ok: false, error: '角色名不合法' });
    const packDir = query.get('pack') || '';
    const key = (packDir ? packDir + '|' : '') + charId + '|0';
    let anim = ANIM_CACHE.get(key);
    if (anim === undefined) {
      try { anim = animFrames(charPkgRoot(packDir), charId, 0); } catch { anim = null; }
      ANIM_CACHE.set(key, anim);
    }
    let pngBuf = null;
    if (anim && anim.frames.length) {
      pngBuf = Buffer.from(anim.frames[0].png, 'base64');
    }
    if (!pngBuf) {
      // 没有 air/动作帧 → 回退 9000,0 头像
      try { const p = portraitFor(charPkgRoot(packDir), charId); pngBuf = p && p.png; } catch { pngBuf = null; }
    }
    if (!pngBuf) return json(res, 200, { ok: false, error: '没有可用姿势' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': pngBuf.length, 'Cache-Control': 'no-store' });
    return res.end(pngBuf);
  }

  // toonflow 角色头像代理：avatarPath（OSS 相对路径）→ 图片字节。
  // 前端不直接连后端 OSS（可能跨域、也可能带鉴权），统一走这里；
  // 并用 sharp 缩到 192px（后端存的是 1024 级 webp，8–10MB，直接进页面会拖死）。
  // 注意：前端会带 ?v= 版本号破缓存，这里匹配时要把 query 去掉。
  m = /^\/api\/role-avatar\/(.+)$/.exec(urlPath);
  if (m && req.method === 'GET') {
    let rel = decodeURIComponent(m[1]).split('?')[0];
    if (!rel.startsWith('/')) rel = '/' + rel;
    if (!/^\/[A-Za-z0-9_\-./]+\.(png|jpe?g|webp|gif)$/i.test(rel)) {
      return json(res, 400, { ok: false, error: '头像路径不合法' });
    }
    try {
      const isWebp = /\.webp$/i.test(rel);
      const key = rel + '@' + AVATAR_SIZE + (isWebp ? '@anim' : '');
      let out = thumbCache.get(key);
      if (!out) {
        const r = await fetch(OSS_ROOT.replace(/\/+$/, '') + rel, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return json(res, 200, { ok: false, error: '头像取不到（HTTP ' + r.status + '）' });
        const raw = Buffer.from(await r.arrayBuffer());
        // 关键：webp 动图必须带 animated:true，否则 sharp 只保留第一帧，
        // 输出退化成静态 VP8X/ALPH/VP8，头像就变成死图。
        out = sharpMod
          ? await sharpMod(raw, isWebp ? { animated: true } : {})
              .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'top' })
              .webp({ quality: 82 }).toBuffer()
          : raw;
        thumbCache.set(key, out);
      }
      const type = sharpMod ? 'image/webp'
        : (/\.png$/i.test(rel) ? 'image/png' : /\.jpe?g$/i.test(rel) ? 'image/jpeg' : /\.webp$/i.test(rel) ? 'image/webp' : 'image/png');
      // 动图和静态图缓存策略不同：动图内容不变但体积大，静态图可能被重新生成。
      const cc = isWebp ? 'public, max-age=86400' : 'public, max-age=3600';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': out.length, 'Cache-Control': cc });
      return res.end(out);
    } catch (e) {
      return json(res, 200, { ok: false, error: (e && e.message) || '头像取不到' });
    }
  }

  // ---- --go 原生引擎调度接口（不依赖 --conn）----
  // 前端先用 status 探测（supported+available 才走原生分支），失败自动回落 wasm。
  if (urlPath === '/api/engine/status') {
    return json(res, 200, engineStatus());
  }
  if (urlPath === '/api/engine/start' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(body || '{}'); } catch { /* 空参也允许 */ }
      return json(res, 200, engineStart(input));
    });
    return;
  }
  if (urlPath === '/api/engine/stop' && req.method === 'POST') {
    return json(res, 200, engineStop());
  }
  if (urlPath === '/api/engine/key' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
      return json(res, 200, engineKey(input));
    });
    return;
  }

  // ---- 以下都需要 --conn ----
  if (!CONN) return json(res, 503, { ok: false, error: '未启用 --conn（node serve.cjs --conn）' });
  if (!BACKEND) return json(res, 200, { ok: false, error: '.env 缺 game_app_service_url' });

  try {
    // 页面登录后用会话 token（页面自己登录的那个账号），否则用 .env 的
    const sess = sessionFromReq(req);
    const authTok = sess ? sess.token : null;

    // 联通自检
    if (urlPath === '/api/conn/status') {
      let version = '';
      try { const v = await bf('/other/version', undefined, { auth: false, method: 'GET' }); version = (v && v.version) || ''; } catch { /* 后端未起 */ }
      let connected = false, sessions = 0;
      if (version) {
        try {
          const s = await bfAuth('/game/listSession', { limit: 100 }, { authTokenOverride: authTok });
          sessions = Array.isArray(s) ? s.length : (s && s.total) || 0; connected = true;
        }
        catch { /* token 问题 */ }
      }
      return json(res, 200, {
        ok: true, connected, backendVersion: version, sessions,
        user: sess ? (sess.user || null) : (tokenUser ? { id: tokenUser.id, name: tokenUser.name } : null),
        viaSession: !!sess,
      });
    }

    // 会话列表（60s 缓存）
    if (urlPath === '/api/conn/sessions') {
      const now = Date.now();
      if (sessionsCache.data && now - sessionsCache.at < SESSIONS_TTL) {
        return json(res, 200, { ok: true, cached: true, sessions: sessionsCache.data });
      }
      const s = await bfAuth('/game/listSession', { limit: 100 }, { authTokenOverride: authTok });
      const list = Array.isArray(s) ? s : (s && s.list) || [];
      sessionsCache.data = list; sessionsCache.at = now;
      return json(res, 200, { ok: true, sessions: list });
    }

    // 会话消息（NDJSON 流重组为 meta/messages/done）
    let m2 = /^\/api\/conn\/sessions\/([^/]+)\/messages$/.exec(urlPath);
    if (m2) {
      const sid = decodeURIComponent(m2[1]);
      const s = await bfNdjson('/game/getSession', { sessionId: sid, messageLimit: 50 }, { authTokenOverride: authTok });
      return json(res, 200, { ok: true, meta: s.meta, messages: s.messages, done: s.done });
    }

    // 会话 → 故事的全部角色（设计文档「角色的实体绑定」要的就是这份清单）。
    // 先取会话元信息里的 worldId，再取世界的 settings.roles（含人设/头像/技能）。
    m2 = /^\/api\/conn\/sessions\/([^/]+)\/roles$/.exec(urlPath);
    if (m2) {
      const sid = decodeURIComponent(m2[1]);
      try {
        const meta = await bfAuth('/game/getSessionMeta', { sessionId: sid }, { authTokenOverride: authTok });
        const worldId = Number((meta && meta.worldId) || 0);
        const worldName = String((meta && meta.world && meta.world.name) || '');
        if (!worldId) return json(res, 200, { ok: true, roles: [], worldId: 0, worldName, note: '这个会话没有关联故事' });
        const world = await bfAuth('/game/getWorld', { worldId }, { authTokenOverride: authTok });
        const settings = (world && world.settings) || {};
        const roles = Array.isArray(settings.roles) ? settings.roles : [];
        // 玩家角色（主角）单独存在 world.playerRole 里，不在 settings.roles 里。
        // 不合并的话，主角在选人屏上就没有 toonflow 头像（只剩静态兜底图）。
        const playerRole = (world && world.playerRole) || null;
        const merged = roles.slice();
        if (playerRole && playerRole.name) {
          const i = merged.findIndex((r) => r && String(r.name || '') === String(playerRole.name));
          if (i >= 0) merged[i] = { ...merged[i], ...playerRole };
          else merged.unshift(playerRole);
        }
        return json(res, 200, {
          ok: true,
          worldId,
          worldName: String((world && world.name) || worldName),
          intro: String((world && world.intro) || ''),
          roles: merged.map(normalizeRole),
        });
      } catch (e) {
        return json(res, 200, { ok: false, error: (e && e.message) || '取角色列表失败' });
      }
    }

    // pluginData 读
    m2 = /^\/api\/conn\/session-data\/([^/]+)\/(.+)$/.exec(urlPath);
    if (m2 && req.method === 'GET') {
      const sid = decodeURIComponent(m2[1]), key = decodeURIComponent(m2[2]);
      const r = await bfAuth('/plugin/data', { sessionId: sid, pluginId: PLUGIN_ID, op: 'get', dataKey: key }, { authTokenOverride: authTok });
      return json(res, 200, { ok: true, key, value: r ? r.value : null, updatedAt: r ? r.updatedAt : 0 });
    }
    // pluginData 写（800ms 同 key 合并）
    if (m2 && req.method === 'PUT') {
      const sid = decodeURIComponent(m2[1]), key = decodeURIComponent(m2[2]);
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let value;
        try { value = JSON.parse(body || 'null').value; } catch { return json(res, 200, { ok: false, error: 'body 需为 {"value":...}' }); }
        mergedSet(sid, key, value, authTok);
        json(res, 200, { ok: true, merged: true });
      });
      return;
    }

    // 生图（field-survival sprite 契约）
    if (urlPath === '/api/conn/agent/generate' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
        try {
          // 后端 sprite 分支要求 systemPrompt（提示词由插件自带，宿主不持有），
          // 少了它会直接报「提示词缺失」。
          const sys = String(input.systemPrompt || '').trim();
          if (!sys) return json(res, 200, { ok: false, error: '缺少 systemPrompt（生图 agent 必须带风格/画风约束）' });
          const r = await bfAuth('/plugin/agentRun', {
            agentName: SPRITE_AGENT,
            input: {
              prompt: String(input.prompt || '').slice(0, 800),
              systemPrompt: sys.slice(0, 600),
              style: String(input.style || '2.5d-topdown-pixel').slice(0, 60),
              refImages: (input.refImages || []).slice(0, 3),
              size: input.size || '1K',
              aspectRatio: String(input.aspectRatio || '1:1').trim(),
            },
          });
          // 后端 agentRun 的返回是 { ok, output: { image } }；
          // bf() 会剥掉外层 {code,data,message}，这里再剥一层 output。
          const out = (r && r.output) ? r.output : r;
          const image = out && (out.image || out.data || out.url);
          json(res, 200, { ok: !!(r && r.ok && image), image: image || null, error: (r && r.error) || (image ? undefined : '生图 agent 没返回图片') });
        } catch (e) { fail(res, e, 'agentRun'); }
      });
      return;
    }

    // 通用文本通道：后端 `plugin-llm` 只要 systemPrompt + userPrompt，
// 返回纯文本时落在 output.text（JSON 输出则原样直通 output）。
    // 失败/超时静默跳过（前端约定），不缓存。注意：对局中的调用都是
    // fire-and-forget 异步请求，不阻塞帧循环。
    if (urlPath === '/api/conn/agent/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
        // 后端要求必须有 systemPrompt（插件自带提示词，宿主不持有）
        const systemPrompt = String(input.systemPrompt || input.system || '').trim();
        const userPrompt = String(input.userPrompt || input.prompt || '').slice(0, 2000);
        if (!systemPrompt) return json(res, 200, { ok: false, error: 'systemPrompt 必填（后端 plugin-llm 通道要求）' });
        if (!userPrompt) return json(res, 200, { ok: false, error: 'userPrompt 为空' });
        try {
          const r = await bfAuth('/plugin/agentRun', {
            agentName: 'plugin-llm',
            aiConfigKey: String(input.aiConfigKey || 'storyMiniGameModel'),
            input: { systemPrompt, userPrompt },
          }, { authTokenOverride: authTok, timeoutMs: 70000 });
          if (r && r.ok === false) return json(res, 200, { ok: false, error: r.error || '模型调用失败' });
          const out = (r && r.output) ? r.output : r;
          const text = String((out && (out.text || out.content)) || '').trim();
          json(res, 200, text ? { ok: true, text: text.slice(0, 400) } : { ok: false, error: '模型返回为空', output: out || null });
        } catch (e) { fail(res, e, 'agentChat'); }
      });
      return;
    }

    // 登录 / 注册。
    // 凭据只到服务端为止：后端 token 存进内存会话表，页面只拿到一个
    // 本地 sid（HttpOnly cookie），页面 JS 永远看不到后端 token。
    if ((urlPath === '/api/conn/login' || urlPath === '/api/conn/register') && req.method === 'POST') {
      const isReg = urlPath.endsWith('register');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
        const username = String(input.username || '').trim();
        const password = String(input.password || '');
        if (isReg) {
          if (username.length < 2 || username.length > 32) return json(res, 200, { ok: false, error: '账号需 2–32 个字符' });
          if (password.length < 6 || password.length > 64) return json(res, 200, { ok: false, error: '密码需 6–64 个字符' });
        } else if (!username || !password) {
          return json(res, 200, { ok: false, error: '请填写账号与密码' });
        }
        try {
          const r = await bf(isReg ? '/other/register' : '/other/login', { username, password }, { auth: false });
          const data = (r && r.data) ? r.data : r;
          const tok = String((data && data.token) || '').replace(/^Bearer\s+/i, '');
          if (!tok) return json(res, 200, { ok: false, error: '后端没有返回 token' });
          const sid = issueSession(tok, { id: data.id, name: data.name || username });
          res.setHeader('Set-Cookie', 'tf_sid=' + sid + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 60 * 60 * 24 * 180);
          json(res, 200, { ok: true, user: { id: data.id, name: data.name || username } });
        } catch (e) {
          json(res, 200, { ok: false, error: (e && e.message) || (isReg ? '注册失败' : '登录失败') });
        }
      });
      return;
    }

    // 格斗台词：提示词由本项目构造（server/lib/speech-agent.cjs），
    // 走后端通用插件 LLM 通道拿文本。超时/出错都返回 {ok:false}，前端静默跳过。
    if (urlPath === '/api/conn/agent/speech' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
        const req0 = buildSpeechRequest(input);
        try {
          const r = await bfAuth('/plugin/agentRun', {
            agentName: req0.agentName,
            aiConfigKey: req0.aiConfigKey,
            input: req0.input,
          }, { authTokenOverride: authTok, timeoutMs: 70000 });
          // plugin-llm 返回 { ok, output:{ text } }；失败时 output 为空、error 带原因
          // （例如模型额度用尽），要如实透出，不能假装「台词为空」
          if (r && r.ok === false) return json(res, 200, { ok: false, error: r.error || '模型调用失败' });
          const out = (r && r.output) ? r.output : r;
          const text = cleanLine(out && (out.text || out.content) || '');
          if (!text) return json(res, 200, { ok: false, error: (r && r.error) || '台词为空' });
          json(res, 200, { ok: true, text });
        } catch (e) { fail(res, e, 'speech'); }
      });
      return;
    }

    // 后端语音（TTS）：按角色音色（clone 参考音频 / 预设音色 / 混音 / 提示词音色）
    // 调后端 /game/streamvoice → 拿 audioProxy 地址 → 取回音频字节给前端播。
    // 模式字段与角色档案的 voiceMode 同口径（normalizeRole.voice 原样透传）。
    // 失败返回 {ok:false}，前端静默跳过；同一行台词+音色命中内存缓存不重复合成。
    if (urlPath === '/api/conn/agent/tts' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
        const text = String(input.text || '').trim().slice(0, 300);
        if (!text) return json(res, 200, { ok: false, error: '缺 text' });
        const v = (input.voice && typeof input.voice === 'object') ? input.voice : {};
        const mode = ['text', 'clone', 'mix', 'prompt_voice'].includes(String(v.mode)) ? String(v.mode) : 'text';
        const speed = Number(input.speed) > 0 ? Math.min(2, Number(input.speed)) : 1.1;
        const voiceKey = mode === 'clone' ? String(v.referenceAudioPath || '')
          : mode === 'mix' ? JSON.stringify(v.mixVoices || [])
          : mode === 'prompt_voice' ? String(v.promptText || '')
          : String(v.presetId || '');
        const key = mode + '|' + voiceKey + '|' + speed + '|' + text;
        const cached = TTS_CACHE.get(key);
        if (cached) {
          res.writeHead(200, { 'Content-Type': cached.ct, 'Content-Length': cached.buf.length, 'X-TTS-Cache': 'hit' });
          return res.end(cached.buf);
        }
        try {
          const b = { text, mode, speed, use_cache: true };
          if (mode === 'clone') {
            if (!String(v.referenceAudioPath || '').trim()) return json(res, 200, { ok: false, error: '该角色没有配置克隆参考音频' });
            b.referenceAudioPath = String(v.referenceAudioPath).trim();
            if (String(v.referenceText || '').trim()) b.referenceText = String(v.referenceText).trim();
          } else if (mode === 'text') {
            if (!String(v.presetId || '').trim()) return json(res, 200, { ok: false, error: '该角色没有配置预设音色' });
            b.voiceId = String(v.presetId).trim();
          } else if (mode === 'mix') {
            const mv = Array.isArray(v.mixVoices) ? v.mixVoices.filter((m) => m && String(m.voiceId || '').trim()).map((m) => ({ voiceId: String(m.voiceId).trim(), weight: Number(m.weight) || undefined })) : [];
            if (!mv.length) return json(res, 200, { ok: false, error: '该角色没有配置混音音色' });
            b.mixVoices = mv;
          } else {
            if (!String(v.promptText || '').trim()) return json(res, 200, { ok: false, error: '该角色没有配置音色提示词' });
            b.promptText = String(v.promptText).trim();
          }
          const r = await bfAuth('/game/streamvoice', b, { authTokenOverride: authTok, timeoutMs: 90000 });
          const audioUrl = r && r.audioUrl;
          if (!audioUrl) return json(res, 200, { ok: false, error: (r && (r.message || r.error)) || '后端没有返回音频地址' });
          // audioProxy 地址自带 token 参数（buildProxyAudioUrl 已塞进 query），直接取流
          const ar = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) });
          if (!ar.ok) return json(res, 200, { ok: false, error: '音频代理返回 ' + ar.status });
          const ab = Buffer.from(await ar.arrayBuffer());
          if (ab.length < 512) return json(res, 200, { ok: false, error: '音频内容异常（' + ab.length + 'B）' });
          const ct = ar.headers.get('content-type') || 'audio/wav';
          if (TTS_CACHE.size >= 64) { TTS_CACHE.delete(TTS_CACHE.keys().next().value); }
          TTS_CACHE.set(key, { buf: ab, ct });
          res.writeHead(200, { 'Content-Type': ct, 'Content-Length': ab.length, 'X-TTS-Cache': 'miss' });
          res.end(ab);
        } catch (e) { fail(res, e, 'tts'); }
      });
      return;
    }

    // 故事绑定种子
    if (urlPath === '/api/conn/story') {
      if (storyName) {
        const p = path.join(ROOT, 'workshops', 'toon-fighting-web', 'map_design', storyName, 'story.json');
        if (fs.existsSync(p)) return json(res, 200, { ok: true, source: 'map_design', story: JSON.parse(fs.readFileSync(p, 'utf8')) });
        return json(res, 200, { ok: false, error: 'map_design 里找不到 ' + storyName });
      }
      if (ENV.game_app_sessionId) {
        return json(res, 200, { ok: true, source: 'env', story: { storyName: ENV.game_app_storyName || '', sessionId: ENV.game_app_sessionId, worldId: Number(ENV.game_app_worldId || 0) } });
      }
      return json(res, 200, { ok: false, error: '未指定 --story，.env 也没有 game_app_sessionId' });
    }

    return json(res, 404, { ok: false, error: '未知 API: ' + urlPath });
  } catch (e) {
    return fail(res, e, urlPath);
  }
}

// ---------- --go 原生引擎调度 ----------
// 形态：前端网页（Chrome app 档或普通浏览器）做 UI，这里 spawn 原生
// Ikemen_GO.exe 跑对局。桥接四条通道：
//   1. 启动参数：前端把 startEngine 构造的 argv 原样 POST 过来（直通 spawn）
//   2. TF_HEAD：引擎 stdout 逐行解析（headavatar.lua 每 4 帧输出一次）
//   3. 结算：watch <cwd>/save/tf-result.ini（main.lua/start.lua saveIni 写），
//      stdout 里的 TF_RESULT: 行也一并收
//   4. 输入注入：常驻 PowerShell 进程吃 stdin 行 → keybd_event 合成按键
//      （引擎 SDL 窗口在前台时收到；物理键盘不经桥、直接进引擎）
const GO_DEFAULT_EXE = path.join(ROOT, '.cache', 'ikemen-native', 'Ikemen_GO.exe');
const GO_FALLBACK_CWD = path.join(ROOT, 'ikemen-fs', 'file');
const ENGINE = {
  proc: null, status: 'stopped', pid: 0, exe: '', cwd: '', argv: [],
  startedAt: 0, exited: true, exitCode: null, error: '', stderrTail: '',
  head: null,   // { line, at }  最新一条 TF_HEAD
  result: null, // { value, at } 最新一次对局结算
  fight: null,  // { at }        开战信号 TF_FIGHT（combatfx.lua roundState>=1 时报一次）
};
let resultWatcherFile = '';
let inputBridge = null; // 常驻 PowerShell：stdin 一行一个 keybd_event 调用

// KeyboardEvent.code → Windows VK 码（keybd_event 只认 VK）
const VK_MAP = {
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, Insert: 0x2D, Delete: 0x2E,
  Backspace: 0x08, Tab: 0x09, Enter: 0x0D, Escape: 0x1B, Space: 0x20,
  ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA3,
  AltLeft: 0xA4, AltRight: 0xA5, CapsLock: 0x14, ContextMenu: 0x5D,
  NumpadAdd: 0x6B, NumpadSubtract: 0x6D, NumpadMultiply: 0x6A, NumpadDivide: 0x6F,
  NumpadDecimal: 0x6E, NumpadEnter: 0x0D,
};
for (let i = 1; i <= 12; i++) VK_MAP['F' + i] = 0x70 + i - 1;
for (let i = 0; i < 10; i++) { VK_MAP['Digit' + i] = 0x30 + i; VK_MAP['Numpad' + i] = 0x60 + i; }
for (let i = 0; i < 26; i++) VK_MAP['Key' + String.fromCharCode(65 + i)] = 0x41 + i;

function engineStatus() {
  // 不能用 exitCode===null 判断存活：被 kill 的进程 exitCode 也是 null
  if (ENGINE.proc && !ENGINE.exited && ENGINE.proc.exitCode !== null) ENGINE.exited = true;
  const running = !!(ENGINE.proc && !ENGINE.exited);
  const exePath = GO_EXE || GO_DEFAULT_EXE;
  return {
    ok: true,
    supported: GO_MODE,
    available: GO_MODE && (fs.existsSync(exePath) || running),
    defaultExe: exePath,
    running,
    pid: running ? ENGINE.pid : 0,
    exe: ENGINE.exe, cwd: ENGINE.cwd, argv: ENGINE.argv,
    startedAt: ENGINE.startedAt, exitCode: ENGINE.exitCode,
    error: ENGINE.error, stderrTail: ENGINE.stderrTail.slice(-800),
    head: ENGINE.head, result: ENGINE.result, fight: ENGINE.fight,
  };
}

// 输入桥：懒启动一个 powershell（-Command - 从 stdin 逐行执行），断线自动重建。
// 每个按键事件写一行 [TF.U32]::keybd_event(vk,0,flags,0)。
function bridgeWrite(line) {
  if (!inputBridge || inputBridge.exitCode !== null) {
    inputBridge = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { stdio: ['pipe', 'ignore', 'ignore'] });
    inputBridge.on('exit', () => { inputBridge = null; });
    // P/Invoke 定义只发一次（会话内常驻）
    inputBridge.stdin.write(
      "Add-Type -Namespace TF -Name U32 -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtra);'\n"
    );
  }
  try { inputBridge.stdin.write(line + '\n'); } catch { inputBridge = null; }
}

function engineKey(input) {
  if (!GO_MODE) return { ok: false, error: '未启用 --go 启动档' };
  const code = String(input.code || '');
  const vk = VK_MAP[code];
  if (!vk) return { ok: false, error: '不认识的键码：' + code };
  const down = !!input.down;
  bridgeWrite('[TF.U32]::keybd_event(' + vk + ',0,' + (down ? 0 : 2) + ',[UIntPtr]::Zero)');
  return { ok: true, code, down, vk };
}

// 引擎窗口置前（spawn 后 MainWindowHandle 可能要几百毫秒才就绪 → 轮询重试）
function focusEngineWindow(pid) {
  bridgeWrite(
    "Add-Type -Namespace TF -Name Wnd -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);'\n" +
    '1..20 | ForEach-Object { Start-Sleep -Milliseconds 400; ' +
    '$p = Get-Process -Id ' + Number(pid) + ' -ErrorAction SilentlyContinue; ' +
    'if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { [TF.Wnd]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; break } }\n'
  );
}

function engineStop() {
  if (!ENGINE.proc || ENGINE.exited) return { ok: true, stopped: false };
  try { ENGINE.proc.kill(); } catch { /* 已退出 */ }
  ENGINE.exited = true; // kill 后 exit 事件的 code 可能是 null，不能靠它判断
  return { ok: true, stopped: true };
}

function watchResultFile(cwd) {
  const f = path.join(cwd, 'save', 'tf-result.ini');
  if (resultWatcherFile === f) return;
  if (resultWatcherFile) try { fs.unwatchFile(resultWatcherFile); } catch { /* 没在 watch */ }
  resultWatcherFile = f;
  fs.watchFile(f, { interval: 400 }, () => {
    try {
      const text = fs.readFileSync(f, 'utf8');
      const m = text.match(/value\s*=\s*"?(-?\d+)"?/);
      if (m) ENGINE.result = { value: Number(m[1]), at: Date.now() };
    } catch { /* 写一半时读失败，等下一轮 */ }
  });
}

function engineStart(input) {
  if (!GO_MODE) return { ok: false, error: '未启用 --go 启动档（node serve.cjs --go）' };
  if (ENGINE.proc && !ENGINE.exited && ENGINE.proc.exitCode === null) return { ok: false, error: '引擎已在运行（先 stop）' };
  const exe = String(input.exe || GO_EXE || GO_DEFAULT_EXE).trim();
  if (!fs.existsSync(exe)) {
    return {
      ok: false,
      error: '没有找到原生引擎 exe：' + exe,
      hint: '编译好的 Ikemen_GO.exe 放到 .cache/ikemen-native/ 下，或 node serve.cjs --go <exe路径>',
    };
  }
  // cwd 决定引擎读哪套资产：优先资产集（chars/data/stages 全量），回落兜底层
  let cwd = String(input.cwd || '').trim();
  if (!cwd && input.pack) {
    try { const b = packBase(String(input.pack)); if (b) cwd = b; } catch { /* pack 不存在 */ }
  }
  if (!cwd || !fs.existsSync(cwd)) cwd = GO_FALLBACK_CWD;
  // -config 指向的 save/user-config.ini 资产集里未必有 → 从兜底层拷一份
  const cfg = path.join(cwd, 'save', 'user-config.ini');
  if (!fs.existsSync(cfg)) {
    const src = path.join(GO_FALLBACK_CWD, 'save', 'user-config.ini');
    if (fs.existsSync(src)) {
      try { fs.mkdirSync(path.join(cwd, 'save'), { recursive: true }); fs.copyFileSync(src, cfg); } catch { /* 引擎会自己处理缺省 */ }
    }
  }
  const argv = Array.isArray(input.argv) ? input.argv.map(String) : [];
  const proc = spawn(exe, argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  Object.assign(ENGINE, {
    proc, pid: proc.pid, exe, cwd, argv, status: 'starting',
    startedAt: Date.now(), exited: false, exitCode: null, error: '', stderrTail: '',
    head: null, result: null, fight: null,
  });
  let outBuf = '';
  const onLine = (line) => {
    line = line.trim();
    if (!line) return;
    const j = line.indexOf('TF_HEAD:');
    if (j !== -1) ENGINE.head = { line: line.slice(j + 8).trim(), at: Date.now() };
    const i2 = line.indexOf('TF_RESULT:');
    if (i2 !== -1) ENGINE.result = { value: Number(line.slice(i2 + 10).trim()) || 0, at: Date.now() };
    // 开战信号（combatfx.lua 在 roundState>=1 回合画面立起时报一次）——
    // 前端用它撤加载遮罩 + 起倒数，替代「TF_HEAD 首条输出」的过早门槛
    const ff = line.indexOf('TF_FIGHT:');
    if (ff !== -1 && !ENGINE.fight) ENGINE.fight = { at: Date.now() };
  };
  proc.stdout.on('data', (d) => {
    outBuf += d.toString();
    let nl;
    while ((nl = outBuf.indexOf('\n')) !== -1) { onLine(outBuf.slice(0, nl)); outBuf = outBuf.slice(nl + 1); }
    ENGINE.status = 'running';
  });
  proc.stderr.on('data', (d) => { ENGINE.stderrTail = (ENGINE.stderrTail + d.toString()).slice(-2000); });
  proc.on('exit', (code) => {
    ENGINE.exited = true;
    ENGINE.exitCode = code;
    ENGINE.status = code === 0 ? 'exited' : 'error';
    if (resultWatcherFile) try { fs.unwatchFile(resultWatcherFile); } catch { /* 忽略 */ }
    resultWatcherFile = '';
  });
  proc.on('error', (e) => { ENGINE.error = String(e && e.message || e); ENGINE.status = 'error'; });
  watchResultFile(cwd);
  focusEngineWindow(proc.pid); // 把对局窗口拉到前台：SendInput 注入的是前台窗口的键
  return { ok: true, pid: proc.pid, exe, cwd, argv };
}

// ---------- --chrome 启动档 ----------
// Chrome/Edge --app 模式：无地址栏、独立任务栏图标、独立 profile —— 观感接近桌面应用，
// 内核仍是系统 Chrome（和安卓端「干净 Chromium 所以流畅」是同一个道理）。
function findChromeExe() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* 跳过 */ } }
  return null;
}
function launchChromeApp() {
  const exe = findChromeExe();
  if (!exe) { console.log('[chrome] 没找到 Chrome/Edge，--chrome 启动档失效（请手动打开页面）'); return; }
  const profile = path.join(ROOT, '.cache', 'chrome-profile');
  try { fs.mkdirSync(profile, { recursive: true }); } catch { /* 已存在 */ }
  const url = 'http://127.0.0.1:' + PORT + '/index.html';
  spawn(exe, [
    '--app=' + url,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,800',
  ], { stdio: 'ignore' });
  console.log('[chrome] app 模式窗口已拉起：' + exe);
}

// ---------- 静态服务（原逻辑不变） ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.sff': 'application/octet-stream', '.def': 'text/plain; charset=iso-8859-1', '.cns': 'text/plain; charset=iso-8859-1',
  '.cmd': 'text/plain; charset=iso-8859-1', '.air': 'text/plain; charset=iso-8859-1', '.snd': 'application/octet-stream',
};

http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const urlPath = decodeURIComponent(rawUrl.split('?')[0]);
  // ?pack=<dir>：角色资源按资产集解析（资产集自带优先，兜底层其次）。
  // 没有它就按兜底层解析 —— 纯本地模式、不绑定资产集时行为不变。
  const query = new URLSearchParams(rawUrl.split('?')[1] || '');
  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath, query);
  let p = urlPath;
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found: ' + urlPath); }
    const range = req.headers.range;
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (range) {
      const mm = /bytes=(\d*)-(\d*)/.exec(range);
      let start = mm && mm[1] ? parseInt(mm[1], 10) : 0;
      let end = mm && mm[2] ? parseInt(mm[2], 10) : st.size - 1;
      if (end >= st.size) end = st.size - 1;
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1, 'Cache-Control': 'no-store',
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => {
  console.log('serving ' + ROOT + ' on http://localhost:' + PORT);
  if (CONN) {
    console.log('[conn] 后端: ' + (BACKEND || '(缺 game_app_service_url)') + (storyName ? '  story: ' + storyName : ''));
    if (!token) console.log('[conn] .env 无 auth_token，首次请求将尝试账号登录');
  } else {
    console.log('[conn] 未启用（加 --conn 开启联动）');
  }
  if (GO_MODE) {
    const exe = GO_EXE || GO_DEFAULT_EXE;
    console.log('[go] 原生引擎调度已启用，默认 exe: ' + exe + (fs.existsSync(exe) ? '（存在）' : '（不存在，前端将回落 wasm）'));
    console.log('[go] 引擎资产 cwd 优先级：请求 pack 参数 > 兜底层 ' + GO_FALLBACK_CWD);
  }
  if (CHROME) launchChromeApp();
});
