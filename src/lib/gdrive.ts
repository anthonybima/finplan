/**
 * Google Drive (appDataFolder) access for sync, from the hosted website / installed PWA.
 *
 * Sign-in: OAuth 2.0 token flow in a popup that returns to FinPlan's own /oauth-google.html page,
 * which hands the token back through same-origin storage. No Google script is loaded into the app
 * (keeps the strict CSP), and the token only covers the hidden app folder (drive.appdata):
 * FinPlan cannot see any other file in the user's Drive.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const SYNC_FILE = 'finplan-sync.json'; // older single-file sync (one per Google account); migrated to per-account files
export const ACCOUNT_FILE = (user: string) => `finplan-account-${user.replace(/[^A-Za-z0-9-]/g, '')}.json`;
const K_CLIENT = 'finplan.google.clientId';
const K_TOKEN = 'finplan.google.token';       // sessionStorage: { access_token, exp, email? }
const K_PENDING = 'finplan.oauth.pending';    // localStorage: { state, at, redirect }
const K_RESULT = 'finplan.oauth.result';      // localStorage: written by oauth-google.html

export interface Token { access_token: string; exp: number; email?: string }
import { claudeStore, type CloudFile } from './claudeCloud';
/* Inside Claude the same sync runs on Claude storage (claudeCloud.ts) instead of Google Drive: no Google sign-in or client ID. */
const CLAUDE_TOKEN: Token = { access_token: 'claude-storage', exp: Number.MAX_SAFE_INTEGER, email: 'your Claude account' };
export const usingClaude = () => !!claudeStore();
/** Where the encrypted copies live, for labels: "your Claude account" or "Google Drive". */
export const cloudLabel = () => (usingClaude() ? 'your Claude account' : 'Google Drive');
/** A Google OAuth client ID is only needed for Google Drive. */
export const needsClientId = () => !usingClaude() && !validClientId(clientId());
export class NeedsSignIn extends Error { constructor(m = 'Sign in to Google to sync') { super(m); this.name = 'NeedsSignIn'; } }

const ENV_CLIENT = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;
export function clientId(): string { try { return localStorage.getItem(K_CLIENT) || ENV_CLIENT || ''; } catch { return ENV_CLIENT || ''; } }
export function setClientId(id: string) { try { id ? localStorage.setItem(K_CLIENT, id.trim()) : localStorage.removeItem(K_CLIENT); } catch { /* */ } }
export const validClientId = (id: string) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(id.trim());

/** Sync runs on the hosted website / installed web app only (an https origin Google can redirect to). */
export function driveSyncSupported(): boolean {
  if (usingClaude()) return true;
  try {
    if ((window as any).claude || (window as any).finplanNative) return false;
    return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  } catch { return false; }
}
export const redirectUri = () => new URL('oauth-google.html', location.origin + location.pathname.replace(/[^/]*$/, '')).href;

let mem: Token | null = null;
export function currentToken(): Token | null {
  if (usingClaude()) return CLAUDE_TOKEN;
  if (mem && mem.exp - Date.now() > 60_000) return mem;
  try { const t = JSON.parse(sessionStorage.getItem(K_TOKEN) || 'null'); if (t && t.exp - Date.now() > 60_000) { mem = t; return t; } } catch { /* */ }
  return null;
}
function saveToken(t: Token) { mem = t; try { sessionStorage.setItem(K_TOKEN, JSON.stringify(t)); } catch { /* */ } }
export function forgetToken() { mem = null; try { sessionStorage.removeItem(K_TOKEN); } catch { /* */ } }

const randState = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** After a full-page redirect sign-in (popup blocked), pick up the token on load. */
export function consumeRedirectResult(): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(K_PENDING) || 'null');
    const r = JSON.parse(localStorage.getItem(K_RESULT) || 'null');
    if (!p?.redirect || !r) return false;
    localStorage.removeItem(K_RESULT); localStorage.removeItem(K_PENDING);
    if (r.state !== p.state || !r.access_token) return false;
    saveToken({ access_token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
    return true;
  } catch { return false; }
}

/** Get a token. Interactive = may open Google's sign-in (must run from a tap/click). */
export async function getToken(interactive: boolean, hint?: string): Promise<Token> {
  if (usingClaude()) return CLAUDE_TOKEN;
  const t = currentToken(); if (t) return t;
  if (!interactive) throw new NeedsSignIn();
  const id = clientId(); if (!validClientId(id)) throw new Error('Add your Google OAuth client ID first (Settings → Sync).');
  const state = randState();
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, state, include_granted_scopes: 'true', prompt: hint ? 'none' : 'select_account' });
  if (hint) q.set('login_hint', hint);
  const url = `${AUTH}?${q}`;
  localStorage.removeItem(K_RESULT);
  const w = window.open(url, 'finplan-google', 'popup,width=500,height=660');
  if (!w) { localStorage.setItem(K_PENDING, JSON.stringify({ state, at: Date.now(), redirect: true })); location.assign(url); return new Promise(() => {}); }
  localStorage.setItem(K_PENDING, JSON.stringify({ state, at: Date.now(), redirect: false }));
  const r = await waitForResult(state, hint ? 25_000 : 180_000);
  if (r.error === 'interaction_required' || r.error === 'login_required' || r.error === 'consent_required') throw new NeedsSignIn('Google needs you to sign in again: tap Connect.'); // quick re-auth not possible
  if (r.error) throw new Error(r.error === 'access_denied' ? 'Google sign-in was cancelled' : `Google sign-in failed: ${r.error}`);
  const tok: Token = { access_token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, email: hint };
  saveToken(tok);
  return tok;
}

function waitForResult(state: string, ms: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let done = false;
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('finplan-oauth') : null;
    const finish = (r: any) => {
      if (done || !r || r.state !== state) return;
      done = true; cleanup(); try { localStorage.removeItem(K_RESULT); localStorage.removeItem(K_PENDING); } catch { /* */ }
      resolve(r);
    };
    const onStorage = (e: StorageEvent) => { if (e.key === K_RESULT && e.newValue) { try { finish(JSON.parse(e.newValue)); } catch { /* */ } } };
    const poll = setInterval(() => { try { const v = localStorage.getItem(K_RESULT); if (v) finish(JSON.parse(v)); } catch { /* */ } }, 500);
    const timer = setTimeout(() => { if (!done) { done = true; cleanup(); reject(new Error('Google sign-in timed out. Try again (allow pop-ups for this site).')); } }, ms);
    const cleanup = () => { clearInterval(poll); clearTimeout(timer); window.removeEventListener('storage', onStorage); bc?.close(); };
    window.addEventListener('storage', onStorage);
    if (bc) bc.onmessage = (e) => finish(e.data);
  });
}

/* ------------------------------------------------------------------ Drive calls */

async function api(tok: Token, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok.access_token}` } });
  if (r.status === 401) { forgetToken(); throw new NeedsSignIn('Google sign-in expired'); }
  if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json())?.error?.message || m; } catch { /* */ } throw new Error(`Google Drive: ${m}`); }
  return r;
}

/** One FinPlan account's encrypted copy. `user` / `accountName` identify the account (the name is the only readable label). */
export interface RemoteMeta { id: string; rev: number; modifiedTime: string; size?: number; device?: string; user?: string; accountName?: string; legacy?: boolean }
export interface AccountRef { user: string; name: string }

export async function whoAmI(tok: Token): Promise<string | undefined> {
  if (usingClaude()) return CLAUDE_TOKEN.email;
  try { const j = await (await api(tok, `${API}/about?fields=user(emailAddress)`)).json(); const e = j?.user?.emailAddress; if (e) saveToken({ ...tok, email: e }); return e; } catch { return undefined; }
}

/** Every FinPlan copy in this Google account's hidden app folder: one per FinPlan account (plus an older shared file, if any). */
const fromCloud = (f: CloudFile): RemoteMeta => ({ id: f.id, rev: Number(f.appProperties.rev) || 0, modifiedTime: f.modifiedTime, size: f.size, device: f.appProperties.device, user: f.appProperties.user || undefined, accountName: f.appProperties.accountName || undefined, legacy: !f.appProperties.user });
export async function listSyncFiles(tok: Token): Promise<RemoteMeta[]> {
  const cs = claudeStore(); if (cs) return (await cs.list()).sort((a, z) => (z.modifiedTime || '').localeCompare(a.modifiedTime || '')).map(fromCloud);
  const q = encodeURIComponent('trashed=false');
  const j = await (await api(tok, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size,appProperties)&orderBy=modifiedTime desc&pageSize=100`)).json();
  return (j.files || [])
    .filter((f: any) => f.appProperties?.user || f.appProperties?.rev || f.name === SYNC_FILE)
    .map((f: any) => ({ id: f.id, rev: Number(f.appProperties?.rev) || 0, modifiedTime: f.modifiedTime, size: Number(f.size) || undefined, device: f.appProperties?.device, user: f.appProperties?.user || undefined, accountName: f.appProperties?.accountName || undefined, legacy: !f.appProperties?.user }));
}

/** This account's copy: by file id, then by account id. With `allowLegacy`, an older shared file counts too (it is migrated on the next upload). */
export async function findSyncFile(tok: Token, user?: string, fileId?: string, allowLegacy = true): Promise<RemoteMeta | null> {
  const all = await listSyncFiles(tok);
  return all.find((f) => fileId && f.id === fileId) // the copy this device joined, whoever's id it carries
    || all.find((f) => user && f.user === user)
    || (allowLegacy ? all.find((f) => f.legacy) : undefined)
    || (!user && all[0]) || null;
}

export async function downloadFile(tok: Token, id: string): Promise<string> {
  const cs = claudeStore(); if (cs) return cs.download(id);
  return (await api(tok, `${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
}

/** Create (no id) or overwrite the sync file, recording the revision + device in appProperties. */
export async function uploadFile(tok: Token, body: string, rev: number, device: string, id?: string, acct?: AccountRef): Promise<RemoteMeta> {
  const meta: any = { appProperties: { rev: String(rev), device: device.slice(0, 100), ...(acct ? { user: acct.user, accountName: acct.name.slice(0, 60) } : {}) } };
  if (acct) meta.name = ACCOUNT_FILE(acct.user); // also renames an older shared file
  else if (!id) meta.name = SYNC_FILE;
  const cs = claudeStore();
  if (cs) { const f = await cs.upload(body, { name: meta.name, appProperties: meta.appProperties }, id); return { ...fromCloud(f), rev, user: acct?.user, accountName: acct?.name }; }
  if (!id) meta.parents = ['appDataFolder'];
  const boundary = 'finplan' + randState();
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const url = id ? `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,modifiedTime,appProperties` : `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime,appProperties`;
  const j = await (await api(tok, url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart })).json();
  return { id: j.id, rev: Number(j.appProperties?.rev) || rev, modifiedTime: j.modifiedTime, user: acct?.user, accountName: acct?.name };
}

export async function deleteFile(tok: Token, id: string) {
  const cs = claudeStore(); if (cs) return cs.remove(id);
  await api(tok, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
