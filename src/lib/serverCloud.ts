/**
 * FinPlan Cloud (the website's own sync server, server/server.mjs): sign in with email + password.
 *
 * The password never leaves the device: the browser derives a login key from it
 * (PBKDF2-SHA256, 310k, salt "finplan-cloud-login:<email>") and sends only that; the server hashes it again (scrypt).
 * The data itself stays end-to-end encrypted with the sync password (sync.ts), so the server only stores ciphertext.
 * The session token is kept on this device (localStorage) for 30 days, renewed while in use.
 */
import type { CloudFile, CloudStore } from './claudeCloud';

const K_SESSION = 'finplan.cloud.session';
const API = '/api';
const K_LAST = 'finplan.cloud.lastEmail';
export const lastEmail = () => { try { return localStorage.getItem(K_LAST) || ''; } catch { return ''; } };
interface Session { token: string; email: string }

export class CloudAuthError extends Error { constructor(m = 'Sign in to FinPlan Cloud') { super(m); this.name = 'CloudAuthError'; } }

export function session(): Session | null { try { const s = JSON.parse(localStorage.getItem(K_SESSION) || 'null'); return s?.token ? s : null; } catch { return null; } }
function setSession(s: Session | null) { try { s ? localStorage.setItem(K_SESSION, JSON.stringify(s)) : localStorage.removeItem(K_SESSION); } catch { /* */ } }

/** The website (https) has the server; the desktop/phone builds and file:// pages don't. */
export function serverAvailable(): boolean {
  try {
    if ((window as any).claude || (window as any).finplanNative) return false;
    return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  } catch { return false; }
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
export async function loginKey(email: string, password: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`finplan-cloud-login:${e}`), iterations: 310_000 }, base, 256));
}

async function call(path: string, init: RequestInit = {}, authed = true): Promise<Response> {
  const s = session();
  if (authed && !s) throw new CloudAuthError();
  let r: Response;
  try {
    r = await fetch(API + path, { ...init, credentials: 'omit', cache: 'no-store', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(authed ? { Authorization: `Bearer ${s!.token}` } : {}), ...(init.headers || {}) } });
  } catch { throw new Error('Can’t reach FinPlan Cloud. Check your internet connection.'); }
  if (r.status === 401 && authed) { setSession(null); throw new CloudAuthError('Signed out of FinPlan Cloud. Sign in again.'); }
  if (!r.ok) { let m = `FinPlan Cloud error ${r.status}`; try { m = (await r.json())?.error || m; } catch { /* */ } throw new Error(m); }
  return r;
}

export async function health(): Promise<{ ok: boolean; signup: boolean } | null> {
  try { const r = await fetch(`${API}/health`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}
export async function signIn(email: string, password: string, create = false): Promise<string> {
  const key = await loginKey(email, password);
  const j = await (await call(create ? '/signup' : '/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), key }) }, false)).json();
  setSession({ token: j.token, email: j.email });
  try { localStorage.setItem(K_LAST, j.email); } catch { /* */ }
  return j.email;
}
export async function signOut() { try { await call('/logout', { method: 'POST' }); } catch { /* */ } setSession(null); }
export async function changePassword(oldPw: string, newPw: string) {
  const s = session(); if (!s) throw new CloudAuthError();
  const j = await (await call('/password', { method: 'POST', body: JSON.stringify({ key: await loginKey(s.email, oldPw), newKey: await loginKey(s.email, newPw) }) })).json();
  setSession({ token: j.token, email: s.email });
}

/** CloudStore over the server, same shape as the Claude store (claudeCloud.ts). */
export const serverStoreImpl: CloudStore = {
  async list(): Promise<CloudFile[]> { return (await call('/files')).json(); },
  async download(id: string) { return (await call(`/files/${encodeURIComponent(id)}`)).text(); },
  async upload(body, meta, id) {
    return (await call(id ? `/files/${encodeURIComponent(id)}` : '/files', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ ...meta, body }) })).json();
  },
  async remove(id) { await call(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
};
