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

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname; const m = req.method;
  const ip = ipOf(req);

  if (p === '/api/health') return send(res, 200, { ok: true, signup: Object.keys(users).length === 0 || SIGNUP === 'open' || ALLOWED.length > 0 });

  if (m === 'POST' && (p === '/api/signup' || p === '/api/login')) {
    if (limited(`auth:${ip}`)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes.');
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
    const u = users[email];
    if (u && u.lockUntil > Date.now()) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes.');
    const h = await scrypt(b.key, u ? u.salt : DUMMY_SALT); // same work whether or not the email exists
    if (!u || !same(h, u.hash)) {
      if (u) { u.fails = (u.fails || 0) + 1; if (u.fails >= 8) { u.lockUntil = Date.now() + 15 * 60e3; u.fails = 0; } saveUsers(); }
      throw new HttpError(401, 'Wrong email or password');
    }
    if (u.fails) { u.fails = 0; saveUsers(); }
    return send(res, 200, { token: newSession(u.id), email });
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
      if (typeof b.body !== 'string' || !b.body) throw new HttpError(400, 'Empty file');
      const existing = await listFiles(me.uid);
      const fid = id || crypto.randomBytes(12).toString('hex');
      if (id && !existing.some((f) => f.id === id)) throw new HttpError(404, 'Not found');
      if (!id && existing.length >= MAX_FILES) throw new HttpError(507, 'Too many copies stored');
      const size = Buffer.byteLength(b.body);
      if (existing.filter((f) => f.id !== fid).reduce((s, f) => s + (f.size || 0), 0) + size > MAX_BYTES) throw new HttpError(507, 'Storage full');
      const meta = cleanMeta(b);
      const prev = id ? await readJson(fileOf(me.uid, id), {}) : {};
      const rec = { id: fid, name: meta.name ?? prev.name, appProperties: meta.appProperties, modifiedTime: new Date().toISOString(), size, body: b.body };
      await fs.mkdir(userDir(me.uid), { recursive: true, mode: 0o700 });
      await writeAtomic(fileOf(me.uid, fid), JSON.stringify(rec));
      const { body, ...out } = rec; return send(res, 200, out);
    }
  }
  throw new HttpError(404, 'Not found');
}

await fs.mkdir(FILES, { recursive: true, mode: 0o700 });
users = await readJson(USERS, {});
sessions = await readJson(SESSIONS, {});
http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : e.message });
  });
}).listen(PORT, () => console.log(`FinPlan Cloud on :${PORT} · ${Object.keys(users).length} account(s) · sign-up: ${ALLOWED.length ? 'allow-list' : SIGNUP}`));
