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
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PLUGIN_ID = 'com.viaco.toon-fighting';
const SPRITE_AGENT = 'field-survival-sprite-gener'; // PluginAgentRunner sprite 分支

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

// ---------- 后端调用 ----------
async function bf(pathname, body, { auth = true, method = 'POST', timeoutMs = 15000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    if (!token) throw new Error('无 token');
    headers.Authorization = 'Bearer ' + token;
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
    if (e.code === 401) { await login(); return await bf(pathname, body, opt); }
    throw e;
  }
}

// getSession 是 NDJSON 流（{type:"meta",data} → {type:"message",data}×N → {type:"done",data}），
// 代理层重组为 {meta, messages:[], done} 再给前端
async function bfNdjson(pathname, body) {
  const run = () => bfRaw(pathname, body);
  let text;
  try { text = await run(); }
  catch (e) {
    if (e.code === 401) { await login(); text = await run(); } else throw e;
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

async function bfRaw(pathname, body) {
  if (!token) throw new Error('无 token');
  const r = await fetch(BACKEND + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
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

function mergedSet(sid, key, value) {
  const k = sid + '::' + key;
  const prev = setMerge.get(k);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(async () => {
    setMerge.delete(k);
    try { await bfAuth('/plugin/data', { sessionId: sid, pluginId: PLUGIN_ID, op: 'set', dataKey: key, value }); }
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

async function handleApi(req, res, urlPath) {
  if (!CONN) return json(res, 503, { ok: false, error: '未启用 --conn（node serve.cjs --conn）' });
  if (!BACKEND) return json(res, 200, { ok: false, error: '.env 缺 game_app_service_url' });

  try {
    // 联通自检
    if (urlPath === '/api/conn/status') {
      let version = '';
      try { const v = await bf('/other/version', undefined, { auth: false, method: 'GET' }); version = (v && v.version) || ''; } catch { /* 后端未起 */ }
      let connected = false, sessions = 0;
      if (version) {
        try { const s = await bfAuth('/game/listSession', { limit: 100 }); sessions = Array.isArray(s) ? s.length : (s && s.total) || 0; connected = true; }
        catch { /* token 问题 */ }
      }
      return json(res, 200, { ok: true, connected, backendVersion: version, sessions, user: tokenUser ? { id: tokenUser.id, name: tokenUser.name } : null });
    }

    // 会话列表（60s 缓存）
    if (urlPath === '/api/conn/sessions') {
      const now = Date.now();
      if (sessionsCache.data && now - sessionsCache.at < SESSIONS_TTL) {
        return json(res, 200, { ok: true, cached: true, sessions: sessionsCache.data });
      }
      const s = await bfAuth('/game/listSession', { limit: 100 });
      const list = Array.isArray(s) ? s : (s && s.list) || [];
      sessionsCache.data = list; sessionsCache.at = now;
      return json(res, 200, { ok: true, sessions: list });
    }

    // 会话消息（NDJSON 流重组为 meta/messages/done）
    let m = /^\/api\/conn\/sessions\/([^/]+)\/messages$/.exec(urlPath);
    if (m) {
      const sid = decodeURIComponent(m[1]);
      const s = await bfNdjson('/game/getSession', { sessionId: sid, messageLimit: 50 });
      return json(res, 200, { ok: true, meta: s.meta, messages: s.messages, done: s.done });
    }

    // pluginData 读
    m = /^\/api\/conn\/session-data\/([^/]+)\/(.+)$/.exec(urlPath);
    if (m && req.method === 'GET') {
      const sid = decodeURIComponent(m[1]), key = decodeURIComponent(m[2]);
      const r = await bfAuth('/plugin/data', { sessionId: sid, pluginId: PLUGIN_ID, op: 'get', dataKey: key });
      return json(res, 200, { ok: true, key, value: r ? r.value : null, updatedAt: r ? r.updatedAt : 0 });
    }
    // pluginData 写（800ms 同 key 合并）
    if (m && req.method === 'PUT') {
      const sid = decodeURIComponent(m[1]), key = decodeURIComponent(m[2]);
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let value;
        try { value = JSON.parse(body || 'null').value; } catch { return json(res, 200, { ok: false, error: 'body 需为 {"value":...}' }); }
        mergedSet(sid, key, value);
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

    // 资产集列表（本地概念，不依赖 --conn；扫 map_design/*/pack.json）
    if (urlPath === '/api/assetpacks') {
      const root = path.join(ROOT, 'workshops', 'toon-fighting-web', 'map_design');
      const packs = [];
      try {
        for (const dir of fs.readdirSync(root)) {
          const pf = path.join(root, dir, 'pack.json');
          if (!fs.existsSync(pf)) continue;
          try {
            const pack = JSON.parse(fs.readFileSync(pf, 'utf8'));
            packs.push(Object.assign({ dir, stories: [], type: 'mapping' }, pack));
          } catch { /* 坏 pack.json 跳过 */ }
        }
      } catch { /* map_design 不存在 */ }
      return json(res, 200, { ok: true, packs });
    }

    // 发言 agent（文本）：走后端 agentRun，agentName 由前端指定；
    // 失败/超时静默跳过（前端约定），不缓存。注意：对局中的调用都是
    // fire-and-forget 异步请求，不阻塞帧循环。
    if (urlPath === '/api/conn/agent/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let input;
        try { input = JSON.parse(body || '{}'); } catch { return json(res, 200, { ok: false, error: 'body 需为 JSON' }); }
        const prompt = String(input.prompt || '').slice(0, 1500);
        if (!prompt) return json(res, 200, { ok: false, error: 'prompt 为空' });
        try {
          const r = await bfAuth('/plugin/agentRun', {
            agentName: String(input.agentName || 'toon-fighting-speech'),
            input: { prompt, system: input.system ? String(input.system).slice(0, 800) : undefined },
          });
          // 后端返回形态未知（文本 agent 可能回 data.text/message/content 任一），统一取字符串
          const text = r && (r.text || r.message || r.content || (typeof r.data === 'string' ? r.data : (r.data && (r.data.text || r.data.message || r.data.content)))) || '';
          json(res, 200, { ok: !!text, text: String(text).slice(0, 400), raw: r });
        } catch (e) { fail(res, e, 'agentChat'); }
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
