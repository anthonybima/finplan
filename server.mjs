/**
 * FinPlan Cloud: a tiny sync server for the FinPlan website (email + password accounts).
 * Zero dependencies (Node 20+ built-ins only).
 *
 * What it stores: the SAME end-to-end encrypted FinPlan sync files the app used to put in Google Drive
 * (AES-256-GCM, encrypted on the device with the sync password). The server never sees your data in clear,
 * never sees your password (the browser sends a PBKDF2-derived login key, which is hashed again here with scrypt),
 * and never sees the sync password.
 *
 *   POST /api/signup   {email, key}           → {token, email}
 *   POST /api/login    {email, key}           → {token, email}
 *   POST /api/logout                          (Bearer)
 *   GET  /api/me                              (Bearer) → {email, files, bytes}
 *   POST /api/password {key, newKey}          (Bearer) → {token}   (other sessions are signed out)
 *   GET  /api/files                           (Bearer) → [{id, name, modifiedTime, size, appProperties}]
 *   POST /api/files    {name?, appProperties, body}       (Bearer) → meta   (create)
 *   GET  /api/files/:id                       (Bearer) → body (text)
 *   PUT  /api/files/:id {name?, appProperties, body}      (Bearer) → meta   (overwrite)
 *   DELETE /api/files/:id                     (Bearer)
 *   GET  /api/health
 *
 * Sign-up policy (env): ALLOWED_EMAILS="a@x.com,b@y.com" → only those; otherwise SIGNUP=first (default: only the
 * first account, then closed) | open | closed.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const PORT = Number(process.env.PORT) || 8080;
const ALLOWED = (process.env.ALLOWED_EMAILS || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const SIGNUP = (process.env.SIGNUP || 'first').toLowerCase();
const MAX_BODY = 25 * 1024 * 1024;          // one encrypted copy
const MAX_FILES = 40;                       // per user
const MAX_BYTES = 250 * 1024 * 1024;        // per user
const SESSION_DAYS = 30;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

/* ------------------------------------------------------------------ storage */

const USERS = path.join(DATA, 'users.json');
const SESSIONS = path.join(DATA, 'sessions.json');
const FILES = path.join(DATA, 'files');
let users = {};     // email → { id, salt, hash, created, fails, lockUntil }
let sessions = {};  // sha256(token) → { uid, exp, created }

async function readJson(p, d) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } }
async function writeAtomic(p, text) {
  const tmp = `${p}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 }); await fs.rename(tmp, p);
}
let saving = Promise.resolve();
const saveUsers = () => (saving = saving.then(() => writeAtomic(USERS, JSON.stringify(users))).catch((e) => console.error('save users', e)));
const saveSessions = () => (saving = saving.then(() => writeAtomic(SESSIONS, JSON.stringify(sessions))).catch((e) => console.error('save sessions', e)));

const userDir = (uid) => path.join(FILES, uid);
const fileOf = (uid, id) => path.join(userDir(uid), `${id}.json`);
async function listFiles(uid) {
  let names = []; try { names = await fs.readdir(userDir(uid)); } catch { return []; }
  const out = [];
  for (const n of names) if (/^[a-f0-9]{24}\.json$/.test(n)) {
    const f = await readJson(path.join(userDir(uid), n), null);
    if (f) out.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size, appProperties: f.appProperties || {} });
  }
  return out.sort((a, z) => (z.modifiedTime || '').localeCompare(a.modifiedTime || ''));
}

/* ------------------------------------------------------------------ crypto helpers */

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (key, salt) => new Promise((res, rej) => crypto.scrypt(key, Buffer.from(salt, 'hex'), 32, SCRYPT, (e, b) => (e ? rej(e) : res(b.toString('hex')))));
const same = (a, b) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

function newSession(uid) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = { uid, exp: Date.now() + SESSION_DAYS * 864e5, created: Date.now() };
  saveSessions();
  return token;
}

/* ------------------------------------------------------------------ rate limits */

const buckets = new Map(); // ip → { n, reset }
function limited(ip, max = 10, windowMs = 15 * 60e3) {
  const now = Date.now(); let b = buckets.get(ip);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(ip, b); }
  b.n++; return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); for (const [k, s] of Object.entries(sessions)) if (s.exp < now) delete sessions[k]; }, 10 * 60e3).unref();

/* ------------------------------------------------------------------ http */

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const KEY = /^[a-f0-9]{64}$/;
const FILE_ID = /^[a-f0-9]{24}$/;

function send(res, status, body, type = 'application/json') {
  const text = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}
async function json(req, limit = 64 * 1024) {
  const ct = req.headers['content-type'] || '';
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'JSON only');
  try { return JSON.parse(await readBody(req, limit)); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Bad JSON'); }
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function auth(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
  const s = m && sessions[sha(m[1])];
  if (!s || s.exp < Date.now()) throw new HttpError(401, 'Signed out. Sign in again.');
  if (s.exp - Date.now() < (SESSION_DAYS / 2) * 864e5) { s.exp = Date.now() + SESSION_DAYS * 864e5; saveSessions(); } // sliding
  const email = Object.keys(users).find((e) => users[e].id === s.uid);
  if (!email) throw new HttpError(401, 'Signed out. Sign in again.');
  return { uid: s.uid, email, sid: sha(m[1]) };
}
function cleanMeta(b) {
  const props = {};
  if (b.appProperties && typeof b.appProperties === 'object') for (const [k, v] of Object.entries(b.appProperties).slice(0, 12)) if (/^[A-Za-z0-9_]{1,40}$/.test(k)) props[k] = String(v).slice(0, 200);
  return { name: typeof b.name === 'string' ? b.name.slice(0, 120) : undefined, appProperties: props };
}
function signupAllowed(email) {
  if (ALLOWED.length) return ALLOWED.includes(email);
  if (SIGNUP === 'open') return true;
  if (SIGNUP === 'first') return Object.keys(users).length === 0;
  return false;
}

/* ------------------------------------------------------------------ market data (Yahoo Finance chart API, server-side: no CORS, cached) */
const MARKET_CACHE = new Map(); // key → {at, status, body}
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', '5y']);
const INTERVALS = new Set(['2m', '5m', '15m', '30m', '60m', '1h', '1d', '1wk']);
/** Yahoo chart JSON for one symbol, cached: {status, body}. Shared by /api/market/chart (website) and the market_chart MCP tool (FinPlan in Claude). */
async function yahooChart(sym, range = '1mo', interval = '1d', ip = '') {
  if (!/^[A-Za-z0-9^=.\-]{1,20}$/.test(sym)) throw new HttpError(400, 'Bad symbol');
  if (!RANGES.has(range) || !INTERVALS.has(interval)) throw new HttpError(400, 'Bad range');
  const key = `${sym}|${range}|${interval}`; const hit = MARKET_CACHE.get(key);
  const ttl = range === '1d' ? 60e3 : range === '5d' ? 300e3 : 1800e3;
  if (hit && Date.now() - hit.at < ttl) return hit;
  if (limited(`mk:${ip}`, 240, 60e3)) throw new HttpError(429, 'Too many requests');
  let status = 502, body = JSON.stringify({ chart: { result: null, error: { description: 'Market data unavailable' } } });
  for (const base of (process.env.YAHOO_BASES || 'https://query1.finance.yahoo.com,https://query2.finance.yahoo.com').split(',')) {
    try {
      const r = await fetch(`${base}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0 (FinPlan personal dashboard)', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const t = await r.text();
      if (r.ok || r.status === 404) { status = r.status; body = t; break; }
    } catch { /* try next host */ }
  }
  const out = { at: Date.now(), status, body };
  if (status === 200 || status === 404) { MARKET_CACHE.set(key, out); if (MARKET_CACHE.size > 2000) MARKET_CACHE.delete(MARKET_CACHE.keys().next().value); }
  return out;
}
async function marketChart(res, sym, q, ip) {
  const r = await yahooChart(sym, q.get('range') || '1mo', q.get('interval') || '1d', ip);
  res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(r.body);
}

async function putFile(uid, id, b) {
  if (typeof b.body !== 'string' || !b.body) throw new HttpError(400, 'Empty file');
  if (id && !FILE_ID.test(id)) throw new HttpError(404, 'Not found');
  const existing = await listFiles(uid);
  const fid = id || crypto.randomBytes(12).toString('hex');
  if (id && !existing.some((f) => f.id === id)) throw new HttpError(404, 'Not found');
  if (!id && existing.length >= MAX_FILES) throw new HttpError(507, 'Too many copies stored');
  const size = Buffer.byteLength(b.body);
  if (size > MAX_BODY) throw new HttpError(413, 'Too large');
  if (existing.filter((f) => f.id !== fid).reduce((s, f) => s + (f.size || 0), 0) + size > MAX_BYTES) throw new HttpError(507, 'Storage full');
  const meta = cleanMeta(b);
  const prev = id ? await readJson(fileOf(uid, id), {}) : {};
  const rec = { id: fid, name: meta.name ?? prev.name, appProperties: meta.appProperties, modifiedTime: new Date().toISOString(), size, body: b.body };
  await fs.mkdir(userDir(uid), { recursive: true, mode: 0o700 });
  await writeAtomic(fileOf(uid, fid), JSON.stringify(rec));
  const { body, ...out } = rec; return out;
}
async function verifyLogin(email, key, ip) {
  if (limited(`auth:${ip}`)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes.');
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || !KEY.test(String(key || ''))) throw new HttpError(400, 'Enter a valid email and password');
  const u = users[email];
  if (u && u.lockUntil > Date.now()) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes.');
  const h = await scrypt(key, u ? u.salt : DUMMY_SALT);
  if (!u || !same(h, u.hash)) {
    if (u) { u.fails = (u.fails || 0) + 1; if (u.fails >= 8) { u.lockUntil = Date.now() + 15 * 60e3; u.fails = 0; } saveUsers(); }
    throw new HttpError(401, 'Wrong email or password');
  }
  if (u.fails) { u.fails = 0; saveUsers(); }
  return { uid: u.id, email };
}

/* ------------------------------------------------------------------ OAuth 2.1 + MCP (FinPlan Cloud as a Claude connector) */
// Claude (claude.ai → Settings → Connectors → Add custom connector → https://<site>/mcp) registers itself (RFC 7591),
// sends you to /oauth/authorize (sign in with your FinPlan Cloud email + password, PKCE S256), and then calls the
// MCP tools below with a 1-hour access token (refresh token 30 days, rotated). Tools only move the SAME end-to-end
// encrypted copies as /api/files: neither Claude nor this server can read your FinPlan data.
const OAUTH = path.join(DATA, 'oauth.json');
let oauth = { clients: {}, tokens: {} }; // clients: id → {redirect_uris, name, created}; tokens: sha(token) → {uid, kind, exp, client}
const codes = new Map();   // sha(code) → {uid, client, redirect, challenge, exp, scope}
const uploads = new Map(); // upload id → {uid, parts:[], size, exp}
const saveOauth = () => (saving = saving.then(() => writeAtomic(OAUTH, JSON.stringify(oauth))).catch((e) => console.error('save oauth', e)));
const ACCESS_TTL = 3600e3, REFRESH_TTL = 30 * 864e5;
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.SITE_ADDRESS ? `https://${process.env.SITE_ADDRESS}` : '')).replace(/\/$/, '');
const originOf = (req) => PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const PAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains', 'X-Robots-Tag': 'noindex, nofollow',
};
function issueTokens(uid, client, scope) {
  const access = crypto.randomBytes(32).toString('base64url'), refresh = crypto.randomBytes(32).toString('base64url');
  oauth.tokens[sha(access)] = { uid, kind: 'access', exp: Date.now() + ACCESS_TTL, client };
  oauth.tokens[sha(refresh)] = { uid, kind: 'refresh', exp: Date.now() + REFRESH_TTL, client };
  saveOauth();
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: scope || 'finplan' };
}
setInterval(() => {
  const now = Date.now(); let ch = false;
  for (const [k, t] of Object.entries(oauth.tokens)) if (t.exp < now) { delete oauth.tokens[k]; ch = true; }
  for (const [k, c] of codes) if (c.exp < now) codes.delete(k);
  for (const [k, u] of uploads) if (u.exp < now) uploads.delete(k);
  if (ch) saveOauth();
}, 10 * 60e3).unref();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function authorizePage(q, client, error) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'].map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect FinPlan Cloud</title>
<style>body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8;color:#14212b;margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px #0001;padding:28px;width:min(400px,92vw)}h1{font-size:20px;margin:0 0 4px}.m{color:#5b6b78;font-size:13px}
label{display:block;font-size:13px;color:#4a5865;margin-top:12px}input[type=email],input[type=password]{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #d5dde3;border-radius:10px;font:inherit;margin-top:4px}
button{width:100%;margin-top:18px;padding:11px;border:0;border-radius:10px;background:#0f766e;color:#fff;font:600 15px system-ui;cursor:pointer}button:disabled{opacity:.6}
.err{color:#b42318;font-size:13px;min-height:18px;margin-top:10px}ul{padding-left:18px;font-size:13px;color:#4a5865}</style></head>
<body><main class="card"><h1>Connect FinPlan Cloud</h1><div class="m"><b>${esc(client.name || 'Claude')}</b> wants to sync your FinPlan data.</div>
<ul><li>It can list, read and save your <b>encrypted</b> FinPlan sync copies.</li><li>It can't read your data: only your sync password opens it, on your devices.</li></ul>
<form id="f" autocomplete="on">${hidden}<label>FinPlan Cloud email<input type="email" name="email" autocomplete="username" required></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button id="b" type="submit">Sign in &amp; allow</button><div class="err" id="e">${esc(error || '')}</div></form>
<div class="m">FinPlan Cloud sign-in. Your password never leaves this page in readable form.</div></main><script src="/oauth/authorize.js"></script></body></html>`;
}
const AUTHORIZE_JS = `(function(){var f=document.getElementById('f'),b=document.getElementById('b'),e=document.getElementById('e');
function hex(buf){return Array.from(new Uint8Array(buf),function(x){return x.toString(16).padStart(2,'0')}).join('')}
f.addEventListener('submit',async function(ev){ev.preventDefault();b.disabled=true;e.textContent='';var d=new FormData(f);var email=String(d.get('email')||'').trim().toLowerCase();
try{var base=await crypto.subtle.importKey('raw',new TextEncoder().encode(String(d.get('password')||'').normalize('NFKC')),'PBKDF2',false,['deriveBits']);
var key=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode('finplan-cloud-login:'+email),iterations:310000},base,256));
var body={email:email,key:key};['client_id','redirect_uri','state','code_challenge','code_challenge_method','scope','resource'].forEach(function(k){body[k]=d.get(k)||''});
var r=await fetch('/oauth/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var j=await r.json();
if(!r.ok)throw new Error(j.error||'Sign-in failed');location.replace(j.redirect);}catch(x){e.textContent=x.message||'Sign-in failed';b.disabled=false}});})();`;

async function readForm(req) {
  const ct = req.headers['content-type'] || '';
  const raw = await readBody(req, 64 * 1024);
  if (ct.startsWith('application/json')) { try { return new Map(Object.entries(JSON.parse(raw))); } catch { throw new HttpError(400, 'Bad JSON'); } }
  return new Map(new URLSearchParams(raw));
}
function oauthError(res, status, error, desc) { send(res, status, { error, error_description: desc }); }

async function handleOAuth(req, res, p, m, ip) {
  const base = originOf(req);
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')
    return send(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['finplan'], bearer_methods_supported: ['header'] });
  if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')
    return send(res, 200, { issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['finplan'] });
  if (p === '/oauth/authorize.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); return res.end(AUTHORIZE_JS); }
  if (p === '/oauth/register' && m === 'POST') {
    if (limited(`reg:${ip}`, 20, 60 * 60e3)) return oauthError(res, 429, 'slow_down', 'Too many registrations');
    if (Object.keys(oauth.clients).length > 500) return oauthError(res, 400, 'invalid_client_metadata', 'Too many clients');
    const b = Object.fromEntries(await readForm(req));
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || uris.some((u) => { try { const x = new URL(u); return !(x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname))) || x.hash; } catch { return true; } }))
      return oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris must be https (or http://localhost)');
    const id = 'fpc_' + crypto.randomBytes(16).toString('hex');
    oauth.clients[id] = { redirect_uris: uris, name: String(b.client_name || 'MCP client').slice(0, 80), created: Date.now() }; saveOauth();
    console.log(`oauth client registered ${id} (${oauth.clients[id].name})`);
    return send(res, 201, { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: oauth.clients[id].name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
  }
  if (p === '/oauth/authorize' && m === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams; const client = oauth.clients[q.get('client_id') || ''];
    const page = (code, html) => { res.writeHead(code, { ...PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    if (!client || !client.redirect_uris.includes(q.get('redirect_uri') || '')) return page(400, '<!doctype html><title>FinPlan Cloud</title><p>This sign-in link is not valid (unknown app or redirect). Remove and add the FinPlan Cloud connector again.</p>');
    if (q.get('response_type') !== 'code' || !q.get('code_challenge') || (q.get('code_challenge_method') || 'S256') !== 'S256') {
      const u = new URL(q.get('redirect_uri')); u.searchParams.set('error', 'invalid_request'); u.searchParams.set('error_description', 'PKCE S256 and response_type=code are required'); if (q.get('state')) u.searchParams.set('state', q.get('state'));
      res.writeHead(302, { Location: u.toString(), 'Cache-Control': 'no-store' }); return res.end();
    }
    return page(200, authorizePage(q, client));
  }
  if (p === '/oauth/approve' && m === 'POST') {
    const b = await json(req);
    const client = oauth.clients[b.client_id || ''];
    if (!client || !client.redirect_uris.includes(b.redirect_uri)) throw new HttpError(400, 'Unknown app. Add the connector again.');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(String(b.code_challenge || ''))) throw new HttpError(400, 'Bad PKCE challenge');
    const who = await verifyLogin(b.email, b.key, ip);
    const code = crypto.randomBytes(32).toString('base64url');
    codes.set(sha(code), { uid: who.uid, client: b.client_id, redirect: b.redirect_uri, challenge: b.code_challenge, exp: Date.now() + 120e3, scope: 'finplan' });
    const u = new URL(b.redirect_uri); u.searchParams.set('code', code); if (b.state) u.searchParams.set('state', b.state);
    console.log(`oauth approved for ${who.uid} → ${client.name}`);
    return send(res, 200, { redirect: u.toString() });
  }
  if (p === '/oauth/token' && m === 'POST') {
    const f = await readForm(req); const g = f.get('grant_type');
    if (g === 'authorization_code') {
      const c = codes.get(sha(String(f.get('code') || ''))); codes.delete(sha(String(f.get('code') || '')));
      if (!c || c.exp < Date.now() || c.client !== f.get('client_id') || c.redirect !== f.get('redirect_uri')) return oauthError(res, 400, 'invalid_grant', 'Code expired or not valid');
      if (b64url(crypto.createHash('sha256').update(String(f.get('code_verifier') || '')).digest()) !== c.challenge) return oauthError(res, 400, 'invalid_grant', 'PKCE check failed');
      return send(res, 200, issueTokens(c.uid, c.client, c.scope));
    }
    if (g === 'refresh_token') {
      const k = sha(String(f.get('refresh_token') || '')); const t = oauth.tokens[k];
      if (!t || t.kind !== 'refresh' || t.exp < Date.now() || (f.get('client_id') && t.client !== f.get('client_id'))) return oauthError(res, 400, 'invalid_grant', 'Sign in again');
      delete oauth.tokens[k];
      return send(res, 200, issueTokens(t.uid, t.client));
    }
    return oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  }
  if (p === '/oauth/revoke' && m === 'POST') { const f = await readForm(req); delete oauth.tokens[sha(String(f.get('token') || ''))]; saveOauth(); return send(res, 200, {}); }
  return null;
}

const MCP_TOOLS = [
  { name: 'whoami', title: 'Which FinPlan Cloud account', description: 'The FinPlan Cloud account (email) this connector is signed in to, and how many encrypted copies it holds.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'list_sync_copies', title: 'List encrypted FinPlan copies', description: 'Lists the end-to-end encrypted FinPlan sync copies (one per FinPlan user): id, name, modifiedTime, size, appProperties {rev, device, user, accountName}. The contents are ciphertext only.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'read_sync_copy', title: 'Read an encrypted copy (in parts)', description: 'Returns part of an encrypted copy: {size, offset, data}. Call with offset 0, then offset+data.length until offset reaches size. Max 200000 characters per call.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 200000 } }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'write_sync_copy', title: 'Save an encrypted copy (in parts)', description: 'Uploads an encrypted copy in parts of at most 200000 characters. First call: no upload_id (one is returned). Last call: done=true with appProperties, optional name, and id to overwrite an existing copy (omit id to create one). Returns the saved copy\'s metadata.', inputSchema: { type: 'object', properties: { upload_id: { type: 'string' }, data: { type: 'string', maxLength: 200000 }, done: { type: 'boolean' }, id: { type: 'string' }, name: { type: 'string' }, appProperties: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['data'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'market_chart', title: 'Market chart data', description: 'Price history for one market symbol (Yahoo Finance symbols, e.g. ^JKSE, ^N225, ^GDAXI, EIDO, GC=F): returns Yahoo chart JSON {chart:{result:[{meta, timestamp, indicators}]}}. range: 1d 5d 1mo 3mo 6mo ytd 1y 5y; interval: 5m 30m 1d 1wk.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, range: { type: 'string' }, interval: { type: 'string' } }, required: ['symbol'] }, annotations: { readOnlyHint: true } },
  { name: 'delete_sync_copy', title: 'Delete an encrypted copy', description: 'Deletes one encrypted copy by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: false, destructiveHint: true } },
];
async function mcpTool(uid, email, name, a = {}) {
  if (name === 'whoami') { const l = await listFiles(uid); return { email, copies: l.length, bytes: l.reduce((s, f) => s + (f.size || 0), 0) }; }
  if (name === 'list_sync_copies') return { files: await listFiles(uid) };
  if (name === 'read_sync_copy') {
    if (!FILE_ID.test(String(a.id || ''))) throw new HttpError(404, 'No such copy');
    const f = await readJson(fileOf(uid, a.id), null); if (!f) throw new HttpError(404, 'No such copy');
    const off = Math.max(0, Number(a.offset) || 0), len = Math.min(200000, Math.max(1, Number(a.length) || 200000));
    return { id: f.id, size: f.body.length, offset: off, data: f.body.slice(off, off + len), modifiedTime: f.modifiedTime };
  }
  if (name === 'write_sync_copy') {
    if (typeof a.data !== 'string' || a.data.length > 200000) throw new HttpError(400, 'data must be a string of at most 200000 characters');
    let up = a.upload_id ? uploads.get(String(a.upload_id)) : null;
    if (a.upload_id && (!up || up.uid !== uid)) throw new HttpError(400, 'Upload expired. Start again.');
    if (!up) { if ([...uploads.values()].filter((u) => u.uid === uid).length > 5) throw new HttpError(429, 'Too many uploads in progress'); up = { uid, parts: [], size: 0, exp: Date.now() + 10 * 60e3 }; a.upload_id = crypto.randomBytes(12).toString('hex'); uploads.set(a.upload_id, up); }
    up.parts.push(a.data); up.size += a.data.length; up.exp = Date.now() + 10 * 60e3;
    if (up.size > MAX_BODY) { uploads.delete(a.upload_id); throw new HttpError(413, 'Too large'); }
    if (!a.done) return { upload_id: a.upload_id, received: up.size };
    uploads.delete(a.upload_id);
    return { upload_id: a.upload_id, file: await putFile(uid, a.id || undefined, { body: up.parts.join(''), name: a.name, appProperties: a.appProperties }) };
  }
  if (name === 'market_chart') { const r = await yahooChart(String(a.symbol || ''), a.range || '1mo', a.interval || '1d', `mcp:${uid}`); if (r.status !== 200) throw new HttpError(r.status, 'No market data for this symbol'); return JSON.parse(r.body); }
  if (name === 'delete_sync_copy') { if (!FILE_ID.test(String(a.id || ''))) throw new HttpError(404, 'No such copy'); await fs.rm(fileOf(uid, a.id), { force: true }); return { ok: true }; }
  throw new HttpError(404, `Unknown tool ${name}`);
}
async function handleMcp(req, res) {
  const base = originOf(req);
  const challenge = () => { res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="finplan"`, 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'invalid_token' })); };
  const mm = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
  const t = mm && oauth.tokens[sha(mm[1])];
  if (!t || t.kind !== 'access' || t.exp < Date.now()) return challenge();
  const email = Object.keys(users).find((e) => users[e].id === t.uid);
  if (!email) return challenge();
  if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  let msg; try { msg = JSON.parse(await readBody(req, 512 * 1024)); } catch (e) { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const one = async (r) => {
    if (!r || r.jsonrpc !== '2.0' || typeof r.method !== 'string') return { jsonrpc: '2.0', id: r?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    if (r.id === undefined || r.id === null) return null; // notification
    try {
      if (r.method === 'initialize') return { jsonrpc: '2.0', id: r.id, result: { protocolVersion: r.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'FinPlan Cloud', title: 'FinPlan Cloud', version: '1.0.0' }, instructions: 'FinPlan Cloud keeps end-to-end encrypted FinPlan sync copies. The FinPlan app uses these tools to sync; the data is ciphertext, so there is nothing to read or analyse here.' } };
      if (r.method === 'ping') return { jsonrpc: '2.0', id: r.id, result: {} };
      if (r.method === 'tools/list') return { jsonrpc: '2.0', id: r.id, result: { tools: MCP_TOOLS } };
      if (r.method === 'resources/list') return { jsonrpc: '2.0', id: r.id, result: { resources: [] } };
      if (r.method === 'prompts/list') return { jsonrpc: '2.0', id: r.id, result: { prompts: [] } };
      if (r.method === 'tools/call') {
        try { const out = await mcpTool(t.uid, email, r.params?.name, r.params?.arguments || {}); return { jsonrpc: '2.0', id: r.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out } }; }
        catch (e) { if (!(e instanceof HttpError)) console.error(e); return { jsonrpc: '2.0', id: r.id, result: { isError: true, content: [{ type: 'text', text: e instanceof HttpError ? e.message : 'Server error' }] } }; }
      }
      return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Method not found' } };
    } catch (e) { console.error(e); return { jsonrpc: '2.0', id: r.id, error: { code: -32603, message: 'Internal error' } }; }
  };
  const out = Array.isArray(msg) ? (await Promise.all(msg.map(one))).filter(Boolean) : await one(msg);
  if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202); return res.end(); }
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (msg?.method === 'initialize') headers['Mcp-Session-Id'] = crypto.randomBytes(16).toString('hex');
  res.writeHead(200, headers); res.end(JSON.stringify(out));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname; const m = req.method;
  const ip = ipOf(req);

  if (p === '/mcp' || p === '/mcp/') return handleMcp(req, res);
  if (p.startsWith('/oauth/') || p.startsWith('/.well-known/')) { const r = await handleOAuth(req, res, p, m, ip); if (r !== null) return r; throw new HttpError(404, 'Not found'); }
  const mk = /^\/api\/market\/chart\/([^/]+)$/.exec(p);
  if (mk && m === 'GET') return marketChart(res, decodeURIComponent(mk[1]), url.searchParams, ip);
  if (p === '/api/health') return send(res, 200, { ok: true, signup: Object.keys(users).length === 0 || SIGNUP === 'open' || ALLOWED.length > 0 });

  if (m === 'POST' && (p === '/api/signup' || p === '/api/login')) {
    if (p === '/api/signup' && limited(`auth:${ip}`)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes.');
    const b = await json(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || !KEY.test(String(b.key || ''))) throw new HttpError(400, 'Enter a valid email and password');
    if (p === '/api/signup') {
      if (users[email]) throw new HttpError(409, 'This email already has an account. Sign in instead.');
      if (!signupAllowed(email)) throw new HttpError(403, 'New accounts are closed on this server.');
      const salt = crypto.randomBytes(16).toString('hex');
      users[email] = { id: crypto.randomBytes(12).toString('hex'), salt, hash: await scrypt(b.key, salt), created: new Date().toISOString(), fails: 0, lockUntil: 0 };
      await saveUsers();
      console.log(`signup ${users[email].id}`);
      return send(res, 200, { token: newSession(users[email].id), email });
    }
    const who = await verifyLogin(email, b.key, ip);
    return send(res, 200, { token: newSession(who.uid), email });
  }

  const me = auth(req);
  if (m === 'POST' && p === '/api/logout') { delete sessions[me.sid]; saveSessions(); return send(res, 200, { ok: true }); }
  if (m === 'GET' && p === '/api/me') { const fs_ = await listFiles(me.uid); return send(res, 200, { email: me.email, files: fs_.length, bytes: fs_.reduce((s, f) => s + (f.size || 0), 0) }); }
  if (m === 'POST' && p === '/api/password') {
    if (limited(`auth:${ip}`)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes.');
    const b = await json(req); const u = users[me.email];
    if (!KEY.test(String(b.key || '')) || !KEY.test(String(b.newKey || ''))) throw new HttpError(400, 'Bad request');
    if (!same(await scrypt(b.key, u.salt), u.hash)) throw new HttpError(401, 'Current password is wrong');
    u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await scrypt(b.newKey, u.salt); await saveUsers();
    for (const [k, s] of Object.entries(sessions)) if (s.uid === me.uid) delete sessions[k];
    for (const [k, t] of Object.entries(oauth.tokens)) if (t.uid === me.uid) delete oauth.tokens[k]; saveOauth();
    return send(res, 200, { token: newSession(me.uid) });
  }

  if (p === '/api/files' && m === 'GET') return send(res, 200, await listFiles(me.uid));
  const fm = /^\/api\/files(?:\/([^/]+))?$/.exec(p);
  if (fm) {
    const id = fm[1];
    if (id && !FILE_ID.test(id)) throw new HttpError(404, 'Not found');
    if (m === 'GET' && id) { const f = await readJson(fileOf(me.uid, id), null); if (!f) throw new HttpError(404, 'Not found'); return send(res, 200, f.body, 'text/plain'); }
    if (m === 'DELETE' && id) { await fs.rm(fileOf(me.uid, id), { force: true }); return send(res, 200, { ok: true }); }
    if ((m === 'POST' && !id) || (m === 'PUT' && id)) {
      const b = await json(req, MAX_BODY + 64 * 1024);
      return send(res, 200, await putFile(me.uid, id, b));
    }
  }
  throw new HttpError(404, 'Not found');
}

await fs.mkdir(FILES, { recursive: true, mode: 0o700 });
users = await readJson(USERS, {});
sessions = await readJson(SESSIONS, {});
oauth = { clients: {}, tokens: {}, ...(await readJson(OAUTH, {})) };
http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : e.message });
  });
}).listen(PORT, () => { yahooChart('^GDAXI', '5d', '1d', 'selfcheck').then((r) => { let px = ''; try { px = JSON.parse(r.body).chart.result[0].meta.regularMarketPrice; } catch { /* */ } console.log(`market data self-check: Yahoo ${r.status} · DAX ${px || 'n/a'}`); }).catch((e) => console.log(`market data self-check failed: ${e.message}`)); console.log(`FinPlan Cloud on :${PORT} · ${Object.keys(users).length} account(s) · sign-up: ${ALLOWED.length ? 'allow-list' : SIGNUP}`); });
