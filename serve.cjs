#!/usr/bin/env node
// Toon-Fighting-web 静态服务器 +（--conn）toonflow 后端 BFF 代理
//
// 用法：
//   node serve.cjs [port]                        # 纯本地（形态 A）
//   node serve.cjs [port] --conn                 # 联动后端（读 .env，形态 B）
//   node serve.cjs -- --story <故事名> --conn    # 直达故事会话（形态 C）
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
const { listPacks, packMeta, localCharIds } = require('./server/lib/packs.cjs');
const { portraitFor } = require('./server/lib/portrait.cjs');
const { buildSpeechRequest, cleanLine } = require('./server/lib/speech-agent.cjs');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PLUGIN_ID = 'com.viaco.toon-fighting';
const SPRITE_AGENT = 'field-survival-sprite-gener'; // PluginAgentRunner sprite 分支
const CHARS_DIR = path.join(ROOT, 'ikemen-fs', 'file', 'chars');

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const dashIdx = argv.indexOf('--');
const preArgs = dashIdx === -1 ? argv : argv.slice(0, dashIdx);
const postArgs = dashIdx === -1 ? [] : argv.slice(dashIdx + 1);
const allArgs = argv; // --conn 在两段都认
let PORT = 8100;
for (const a of preArgs) { const n = Number(a); if (Number.isFinite(n) && n > 0) PORT = n; }
const CONN = allArgs.includes('--conn');

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
  };
}

async function handleApi(req, res, urlPath) {
  // ---- 本地接口：不依赖 --conn（纯本地模式也要有资产集与头像） ----

  // 资产集列表（本地概念，扫 map_design/*/pack.json）
  if (urlPath === '/api/assetpacks') {
    const packs = listPacks();
    return json(res, 200, {
      ok: true,
      packs,
      localChars: localCharIds(),
      story: storyName || null,
    });
  }

  // 资产集元数据（story / roster / mapping）
  let m = /^\/api\/packs\/([^/]+)$/.exec(urlPath);
  if (m) {
    const dir = decodeURIComponent(m[1]);
    const meta = packMeta(dir);
    if (!meta) return json(res, 200, { ok: false, error: '没有这个资产集：' + dir });
    return json(res, 200, { ok: true, meta });
  }

  // MUGEN 角色头像（从角色包的 sff 里解 9000,0 立绘 → PNG）
  m = /^\/api\/portrait\/([^/]+)$/.exec(urlPath);
  if (m) {
    const charId = decodeURIComponent(m[1]);
    if (!/^[A-Za-z0-9_'\-]+$/.test(charId)) return json(res, 400, { ok: false, error: '角色名不合法' });
    let png = null;
    try { png = portraitFor(CHARS_DIR, charId); } catch { png = null; }
    if (!png) return json(res, 200, { ok: false, error: '这个角色没有可用头像' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.png.length, 'Cache-Control': 'no-store' });
    return res.end(png.png);
  }

  // toonflow 角色头像代理：avatarPath（OSS 相对路径）→ 图片字节。
  // 前端不直接连后端 OSS（可能跨域、也可能带鉴权），统一走这里；
  // 并用 sharp 缩到 192px（后端存的是 1024 级 webp，8–10MB，直接进页面会拖死）。
  m = /^\/api\/role-avatar\/(.+)$/.exec(urlPath);
  if (m && req.method === 'GET') {
    let rel = decodeURIComponent(m[1]);
    if (!rel.startsWith('/')) rel = '/' + rel;
    if (!/^\/[A-Za-z0-9_\-./]+\.(png|jpe?g|webp|gif)$/i.test(rel)) {
      return json(res, 400, { ok: false, error: '头像路径不合法' });
    }
    try {
      const key = rel + '@' + AVATAR_SIZE;
      let out = thumbCache.get(key);
      if (!out) {
        const r = await fetch(OSS_ROOT.replace(/\/+$/, '') + rel, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return json(res, 200, { ok: false, error: '头像取不到（HTTP ' + r.status + '）' });
        const raw = Buffer.from(await r.arrayBuffer());
        out = sharpMod
          ? await sharpMod(raw).resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'top' }).webp({ quality: 82 }).toBuffer()
          : raw;
        thumbCache.set(key, out);
      }
      const type = sharpMod ? 'image/webp'
        : (/\.png$/i.test(rel) ? 'image/png' : /\.jpe?g$/i.test(rel) ? 'image/jpeg' : /\.webp$/i.test(rel) ? 'image/webp' : 'image/png');
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': out.length, 'Cache-Control': 'public, max-age=3600' });
      return res.end(out);
    } catch (e) {
      return json(res, 200, { ok: false, error: (e && e.message) || '头像取不到' });
    }
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
        return json(res, 200, {
          ok: true,
          worldId,
          worldName: String((world && world.name) || worldName),
          intro: String((world && world.intro) || ''),
          roles: roles.map(normalizeRole),
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

// ---------- 静态服务（原逻辑不变） ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.sff': 'application/octet-stream', '.def': 'text/plain; charset=iso-8859-1', '.cns': 'text/plain; charset=iso-8859-1',
  '.cmd': 'text/plain; charset=iso-8859-1', '.air': 'text/plain; charset=iso-8859-1', '.snd': 'application/octet-stream',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath);
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
});
