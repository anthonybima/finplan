import type { AppData } from './types';
import { platform } from './net';
import { b64, dec, deriveKey, enc, importDataKey, KDF_ITER, open, rand, seal, wipe, type Box } from './cryptoBox';
export { KDF_ITER };

/**
 * Local accounts + encrypted vault (no server).
 *  - Each user has a random 256-bit AES-GCM *data key*. Their FinPlan data is encrypted with it.
 *  - The data key is wrapped twice: with the password (PBKDF2-SHA256) and with a one-time recovery code.
 *  - A wrong password simply fails to unwrap (AES-GCM authentication) — no password hash is stored.
 *  - Every install gets a random Browser/Device ID; sign-ins are logged with it.
 */
const AUTH_KEY = 'finplan.auth.v1';
const DEVICE_KEY = 'finplan.device.v1';
const LEGACY_DATA_KEY = 'finplan.data.v1';
const VAULT = (uid: string) => `finplan.vault.${uid}`;
export interface UserRec {
  id: string; name: string; email?: string; color: string;
  salt: string; rcSalt: string; iter: number;
  wrapPw: Box; wrapRc: Box;
  createdAt: string; lastLogin?: string; failed: number; lockedUntil?: number;
}
export interface LoginEvent { at: string; userId: string; userName: string; deviceId: string; device: string; ok: boolean; method: 'password' | 'recovery' | 'created' | 'locked-out' }
interface AuthStore { users: UserRec[]; history: LoginEvent[]; autoLockMin: number }
export interface DeviceInfo { id: string; short: string; name: string; createdAt: string; platform: string; browser: string; os: string; fingerprint: string }
export interface Session { user: UserRec; key: CryptoKey }

/* ---------- storage helpers (in-memory fallback if storage is blocked) ---------- */
const mem: Record<string, string> = {};
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { mem[k] = v; } };
const lsDel = (k: string) => { try { localStorage.removeItem(k); } catch { delete mem[k]; } };

function readStore(): AuthStore {
  try { const s = JSON.parse(lsGet(AUTH_KEY) || ''); return { users: [], history: [], autoLockMin: 15, ...s }; }
  catch { return { users: [], history: [], autoLockMin: 15 }; }
}
const writeStore = (s: AuthStore) => lsSet(AUTH_KEY, JSON.stringify(s));

/* ---------- crypto (see cryptoBox.ts) ---------- */
// Wrapped keys are bound to their user + purpose with AES-GCM associated data, so a blob can't be swapped between users.
async function wrapRaw(raw: Uint8Array<ArrayBuffer>, secret: string, salt: string, iter: number, aad: string) { return seal(await deriveKey(secret, salt, iter), raw, aad); }
async function unwrapRaw(box: Box, secret: string, salt: string, iter: number, aad: string) { return open(await deriveKey(secret, salt, iter), box, aad); }
const normRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
function makeRecoveryCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const r = rand(24); let s = '';
  for (let i = 0; i < 24; i++) s += A[r[i] % A.length] + ((i % 4 === 3 && i < 23) ? '-' : '');
  return s;
}

/* ---------- device / browser ID ---------- */
function parseUA() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return { browser, os };
}
async function fingerprint() {
  const parts = [navigator.userAgent, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone, `${screen.width}x${screen.height}x${screen.colorDepth}`, String(navigator.hardwareConcurrency || ''), String((navigator as any).deviceMemory || '')];
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(parts.join('|'))));
  return [...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function getDevice(): Promise<DeviceInfo> {
  let d: Partial<DeviceInfo> = {};
  try { d = JSON.parse(lsGet(DEVICE_KEY) || '{}'); } catch { /* new */ }
  const { browser, os } = parseUA();
  const p = platform();
  const plat = p === 'desktop' ? 'FinPlan desktop app' : p === 'mobile' ? 'FinPlan mobile app' : 'Web browser';
  if (!d.id) {
    d.id = crypto.randomUUID();
    d.createdAt = new Date().toISOString();
    d.name = `${p === 'web' ? browser : 'FinPlan'} on ${os}`;
  }
  const hex = d.id.replace(/-/g, '').toUpperCase();
  const info: DeviceInfo = { id: d.id, short: `FP-${hex.slice(0, 4)}-${hex.slice(4, 8)}`, name: d.name!, createdAt: d.createdAt!, platform: plat, browser, os, fingerprint: await fingerprint() };
  lsSet(DEVICE_KEY, JSON.stringify({ id: info.id, name: info.name, createdAt: info.createdAt }));
  return info;
}
export function renameDevice(name: string) {
  try { const d = JSON.parse(lsGet(DEVICE_KEY) || '{}'); d.name = name.slice(0, 60); lsSet(DEVICE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

/* ---------- users ---------- */
const COLORS = ['#0f766e', '#6366f1', '#ec4899', '#f59e0b', '#0ea5e9', '#84cc16', '#a855f7'];
export const listUsers = () => readStore().users;
export const autoLockMinutes = () => readStore().autoLockMin;
export function setAutoLock(min: number) { const s = readStore(); s.autoLockMin = min; writeStore(s); }
export const loginHistory = () => readStore().history;
export const hasLegacyData = () => !!lsGet(LEGACY_DATA_KEY);

async function logEvent(user: UserRec, ok: boolean, method: LoginEvent['method']) {
  const dev = await getDevice();
  const s = readStore();
  s.history = [{ at: new Date().toISOString(), userId: user.id, userName: user.name, deviceId: dev.short, device: dev.name, ok, method }, ...s.history].slice(0, 200);
  writeStore(s);
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters (a short sentence works well)';
  if (!/[A-Za-z]/.test(pw) || !/[0-9\W_]/.test(pw)) return 'Add a number or symbol';
  if (/(password|passw0rd|qwerty|asdf|123456|111111|abc123|iloveyou|admin|letmein|welcome|rahasia|sayang|indonesia|bismillah)/i.test(pw)) return 'Too easy to guess';
  if (/^(.)\1+$/.test(pw) || new Set(pw).size < 5) return 'Too repetitive';
  return null;
}

/** `opts.id`: open an existing account (same id as on your other devices, from its cloud copy) instead of a brand-new one. */
export async function createUser(name: string, email: string, password: string, opts: { id?: string } = {}): Promise<{ session: Session; recoveryCode: string; migrated: AppData | null }> {
  const err = passwordProblems(password); if (err) throw new Error(err);
  const s = readStore();
  if (opts.id && s.users.some((u) => u.id === opts.id)) throw new Error('This account is already on this device: sign in to it');
  if (s.users.some((u) => u.name.toLowerCase() === name.trim().toLowerCase())) throw new Error('A user with this name already exists on this device');
  const raw = rand(32); // 256-bit data key (per device; the cloud copy has its own key from the sync password)
  const salt = b64(rand(16)), rcSalt = b64(rand(16)), recoveryCode = makeRecoveryCode();
  const id = opts.id && /^[A-Za-z0-9-]{8,64}$/.test(opts.id) ? opts.id : crypto.randomUUID();
  const user: UserRec = {
    id, name: name.trim(), email: email.trim() || undefined, color: COLORS[s.users.length % COLORS.length],
    salt, rcSalt, iter: KDF_ITER,
    wrapPw: await wrapRaw(raw, password, salt, KDF_ITER, `pw:${id}`), wrapRc: await wrapRaw(raw, normRecovery(recoveryCode), rcSalt, KDF_ITER, `rc:${id}`),
    createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(), failed: 0,
  };
  const key = await importDataKey(raw); wipe(raw);
  s.users.push(user); writeStore(s);
  const session = { user, key };
  // First account on a device that already has (unencrypted) FinPlan data: move it into the vault.
  let migrated: AppData | null = null;
  if (s.users.length === 1 && !opts.id && lsGet(LEGACY_DATA_KEY)) {
    try { migrated = JSON.parse(lsGet(LEGACY_DATA_KEY)!); await saveVault(session, migrated!); lsDel(LEGACY_DATA_KEY); } catch { migrated = null; }
  }
  await logEvent(user, true, 'created');
  return { session, recoveryCode, migrated };
}

function lockState(u: UserRec) { return u.lockedUntil && u.lockedUntil > Date.now() ? Math.ceil((u.lockedUntil - Date.now()) / 1000) : 0; }
export const secondsLocked = (userId: string) => { const u = listUsers().find((x) => x.id === userId); return u ? lockState(u) : 0; };

function recordFailure(userId: string) {
  const s = readStore(); const u = s.users.find((x) => x.id === userId); if (!u) return;
  u.failed = (u.failed || 0) + 1;
  if (u.failed >= 5) u.lockedUntil = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (u.failed - 5));
  writeStore(s);
}
function recordSuccess(userId: string) {
  const s = readStore(); const u = s.users.find((x) => x.id === userId); if (!u) return u;
  u.failed = 0; u.lockedUntil = undefined; u.lastLogin = new Date().toISOString(); writeStore(s); return u;
}

export async function login(userId: string, password: string): Promise<Session> {
  const u = listUsers().find((x) => x.id === userId); if (!u) throw new Error('Unknown user');
  const wait = lockState(u); if (wait) throw new Error(`Too many attempts. Try again in ${wait}s`);
  try {
    const raw = await unwrapRaw(u.wrapPw, password, u.salt, u.iter, `pw:${u.id}`);
    if (u.iter < KDF_ITER) { // transparently upgrade older/weaker key derivation
      const st = readStore(); const x = st.users.find((y) => y.id === u.id)!;
      x.salt = b64(rand(16)); x.wrapPw = await wrapRaw(raw, password, x.salt, KDF_ITER, `pw:${u.id}`); x.iter = KDF_ITER; writeStore(st);
    }
    const key = await importDataKey(raw); wipe(raw);
    const fresh = recordSuccess(userId)!; await logEvent(fresh, true, 'password');
    return { user: fresh, key };
  } catch {
    recordFailure(userId);
    const after = listUsers().find((x) => x.id === userId)!;
    await logEvent(after, false, lockState(after) ? 'locked-out' : 'password');
    const left = Math.max(0, 5 - after.failed);
    throw new Error(lockState(after) ? `Wrong password. Locked for ${lockState(after)}s` : `Wrong password${left ? ` (${left} tries before a temporary lock)` : ''}`);
  }
}

/** Forgot password: unlock with the recovery code, set a new password, and issue a NEW recovery code. */
export async function recoverWithCode(userId: string, code: string, newPassword: string): Promise<{ session: Session; recoveryCode: string }> {
  const err = passwordProblems(newPassword); if (err) throw new Error(err);
  const s = readStore(); const u = s.users.find((x) => x.id === userId); if (!u) throw new Error('Unknown user');
  // No lockout check here: the 120-bit recovery code can't be brute-forced, and it's the way out of a lockout.
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = await unwrapRaw(u.wrapRc, normRecovery(code), u.rcSalt, u.iter, `rc:${u.id}`); }
  catch { recordFailure(userId); await logEvent(u, false, 'recovery'); throw new Error('Recovery code is not correct'); }
  const newCode = makeRecoveryCode();
  const st = readStore(); const x = st.users.find((y) => y.id === userId)!;
  x.salt = b64(rand(16)); x.rcSalt = b64(rand(16)); x.iter = KDF_ITER;
  x.wrapPw = await wrapRaw(raw, newPassword, x.salt, KDF_ITER, `pw:${x.id}`);
  x.wrapRc = await wrapRaw(raw, normRecovery(newCode), x.rcSalt, KDF_ITER, `rc:${x.id}`);
  x.failed = 0; x.lockedUntil = undefined; x.lastLogin = new Date().toISOString();
  const key = await importDataKey(raw); wipe(raw);
  writeStore(st); await logEvent(x, true, 'recovery');
  return { session: { user: x, key }, recoveryCode: newCode };
}

export async function changePassword(session: Session, oldPw: string, newPw: string) {
  const err = passwordProblems(newPw); if (err) throw new Error(err);
  const s = readStore(); const u = s.users.find((x) => x.id === session.user.id)!;
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = await unwrapRaw(u.wrapPw, oldPw, u.salt, u.iter, `pw:${u.id}`); } catch { throw new Error('Current password is not correct'); }
  u.salt = b64(rand(16)); u.iter = KDF_ITER; u.wrapPw = await wrapRaw(raw, newPw, u.salt, KDF_ITER, `pw:${u.id}`); wipe(raw);
  writeStore(s);
}

export async function newRecoveryCode(session: Session, password: string) {
  const s = readStore(); const u = s.users.find((x) => x.id === session.user.id)!;
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = await unwrapRaw(u.wrapPw, password, u.salt, u.iter, `pw:${u.id}`); } catch { throw new Error('Password is not correct'); }
  const code = makeRecoveryCode();
  u.rcSalt = b64(rand(16)); u.wrapRc = await wrapRaw(raw, normRecovery(code), u.rcSalt, u.iter, `rc:${u.id}`); wipe(raw);
  writeStore(s); return code;
}

export function updateProfile(userId: string, p: { name?: string; email?: string }) {
  const s = readStore(); const u = s.users.find((x) => x.id === userId); if (!u) return;
  if (p.name?.trim()) u.name = p.name.trim(); if (p.email !== undefined) u.email = p.email.trim() || undefined;
  writeStore(s);
}

export async function deleteUser(session: Session, password: string) {
  const s = readStore(); const u = s.users.find((x) => x.id === session.user.id)!;
  try { wipe(await unwrapRaw(u.wrapPw, password, u.salt, u.iter, `pw:${u.id}`)); } catch { throw new Error('Password is not correct'); }
  s.users = s.users.filter((x) => x.id !== u.id);
  s.history = s.history.filter((h) => h.userId !== u.id);
  writeStore(s); lsDel(VAULT(u.id));
}

/** Remove a user and its data from THIS device only (no password: used when the account removed this device). */
export function removeLocalUser(userId: string) {
  const s = readStore();
  s.users = s.users.filter((x) => x.id !== userId);
  s.history = s.history.filter((h) => h.userId !== userId);
  writeStore(s); lsDel(VAULT(userId));
  try { for (const k of Object.keys(localStorage)) if (k.includes(userId)) localStorage.removeItem(k); } catch { /* */ }
}

/* ---------- vault ---------- */
export async function loadVault(session: Session): Promise<AppData | null> {
  const raw = lsGet(VAULT(session.user.id)); if (!raw) return null;
  return JSON.parse(dec.decode(await open(session.key, JSON.parse(raw), `vault:${session.user.id}`)));
}
export async function saveVault(session: Session, data: AppData) {
  lsSet(VAULT(session.user.id), JSON.stringify(await seal(session.key, enc.encode(JSON.stringify(data)), `vault:${session.user.id}`)));
}
export const clearVault = (session: Session) => lsDel(VAULT(session.user.id));
