import { mergeDevices } from './devices';
/**
 * End-to-end encrypted sync of FinPlan accounts through Google Drive's hidden app folder.
 *
 *  - One cloud file PER FINPLAN ACCOUNT (`finplan-account-<id>.json`): each account only ever sees its own data.
 *    The same account can be opened on any device (login screen → "Use my account from another device").
 *
 *  - Data is encrypted on the device with a key derived from the SYNC PASSWORD
 *    (PBKDF2-SHA256 600k → AES-256-GCM, AAD "finplan-sync-v1"). Google only stores ciphertext.
 *  - The derived key is kept on each device inside the user's encrypted vault secrets, so it is
 *    typed once per device. API keys are never synced.
 *  - Revisions: the file carries `rev` (appProperties). Each device remembers the rev it last
 *    synced (`baseRev`) and whether it has local changes (`dirty`).
 */
import type { AppData } from './types';
import { b64, unb64, rand, seal, open, enc, dec, KDF_ITER, importDataKey, type Box } from './cryptoBox';
import { getSecret, setSecret } from './secure';
import { migrate } from './store';
import * as G from './gdrive';

const AAD = 'finplan-sync-v1';
export interface SyncFile { format: 'finplan-sync'; version: 1; kdf: { alg: 'PBKDF2-SHA256'; iter: number; salt: string }; cipher: 'AES-256-GCM'; iv: string; ct: string; meta: { rev: number; updatedAt: string; device: string } }
export interface SyncState { enabled: boolean; fileId?: string; baseRev: number; dirty: boolean; lastSyncAt?: string; email?: string; lastError?: string; salt?: string; account?: string; accountName?: string }

const K_STATE = (uid: string) => `finplan.sync.${uid}`;
export function loadState(uid: string): SyncState {
  try { return { enabled: false, baseRev: 0, dirty: false, ...JSON.parse(localStorage.getItem(K_STATE(uid)) || '{}') }; } catch { return { enabled: false, baseRev: 0, dirty: false }; }
}
export function saveState(uid: string, s: SyncState) { try { localStorage.setItem(K_STATE(uid), JSON.stringify(s)); } catch { /* */ } }
export function clearState(uid: string) { try { localStorage.removeItem(K_STATE(uid)); } catch { /* */ } }

/* ------------------------------------------------------------------ keys */

async function deriveRaw(password: string, salt: string, iter = KDF_ITER): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter }, base, 256)) as Uint8Array<ArrayBuffer>;
}
/** Remember the derived key for this user on this device (encrypted with the vault key). */
async function rememberKey(raw: Uint8Array<ArrayBuffer>, salt: string) { await setSecret('sync.key', JSON.stringify({ k: b64(raw), salt })); }
async function loadKey(): Promise<{ key: CryptoKey; salt: string } | null> {
  const v = await getSecret('sync.key'); if (!v) return null;
  try { const j = JSON.parse(v); return { key: await importDataKey(unb64(j.k)), salt: j.salt }; } catch { return null; }
}
export async function forgetKey() { await setSecret('sync.key', null); }
export async function hasKey() { return !!(await getSecret('sync.key')); }

/* ------------------------------------------------------------------ encode / decode */

/** What is synced: everything in AppData. Device-only things (API keys, sync state, phone view) live elsewhere. */
async function encode(d: AppData, key: CryptoKey, salt: string, rev: number, device: string): Promise<string> {
  const box: Box = await seal(key, enc.encode(JSON.stringify(d)) as Uint8Array<ArrayBuffer>, AAD);
  const f: SyncFile = { format: 'finplan-sync', version: 1, kdf: { alg: 'PBKDF2-SHA256', iter: KDF_ITER, salt }, cipher: 'AES-256-GCM', iv: box.iv, ct: box.ct, meta: { rev, updatedAt: new Date().toISOString(), device } };
  return JSON.stringify(f);
}
async function decode(text: string, key: CryptoKey): Promise<{ data: AppData; file: SyncFile }> {
  const f = JSON.parse(text) as SyncFile;
  if (f.format !== 'finplan-sync') throw new Error('Not a FinPlan sync file');
  const bytes = await open(key, { iv: f.iv, ct: f.ct }, AAD).catch(() => { throw new Error('Wrong sync password (or the cloud file was changed)'); });
  return { data: migrate(JSON.parse(dec.decode(bytes))), file: f };
}

/* ------------------------------------------------------------------ setup on a device */

export interface RemoteInfo { exists: boolean; meta?: G.RemoteMeta; file?: SyncFile; others: G.RemoteMeta[] }
/** This account's cloud copy (or an older shared copy), plus other FinPlan accounts stored in the same Google Drive. */
export async function inspectRemote(tok: G.Token, uid?: string): Promise<RemoteInfo> {
  const all = await G.listSyncFiles(tok);
  const meta = all.find((f) => uid && f.user === uid) || all.find((f) => f.legacy);
  const others = all.filter((f) => f !== meta);
  if (!meta) return { exists: false, others };
  return { exists: true, meta, file: await readFile(tok, meta), others };
}
export async function readFile(tok: G.Token, meta: G.RemoteMeta): Promise<SyncFile> { return JSON.parse(await G.downloadFile(tok, meta.id)) as SyncFile; }

/** Sign in on a new device: open an account's cloud copy with its password. Nothing is stored yet. */
export async function unlockCloud(tok: G.Token, meta: G.RemoteMeta, password: string): Promise<{ data: AppData; file: SyncFile; raw: Uint8Array<ArrayBuffer> }> {
  const file = await readFile(tok, meta);
  const raw = await deriveRaw(password, file.kdf.salt, file.kdf.iter);
  try { const { data } = await decode(JSON.stringify(file), await importDataKey(raw)); return { data, file, raw }; }
  catch (e) { raw.fill(0); throw new Error('Wrong password for this account'); }
}
/** After `unlockCloud` and signing in locally (vault namespace set): remember the key and turn sync on for this account. */
export async function linkCloud(uid: string, tok: G.Token, meta: G.RemoteMeta, file: SyncFile, raw: Uint8Array<ArrayBuffer>, opts: { inSync: boolean }): Promise<SyncState> {
  await rememberKey(raw, file.kdf.salt); raw.fill(0);
  const st: SyncState = { enabled: true, fileId: meta.id, baseRev: opts.inSync ? meta.rev : 0, dirty: !opts.inSync, lastSyncAt: new Date().toISOString(), email: tok.email, salt: file.kdf.salt, account: meta.user || uid, accountName: meta.accountName };
  saveState(uid, st); return st;
}

/** First device: create the cloud copy with a new sync password. */
export async function createCloud(uid: string, tok: G.Token, d: AppData, password: string, device: string, name = 'FinPlan'): Promise<SyncState> {
  const salt = b64(rand(16));
  const raw = await deriveRaw(password, salt);
  const key = await importDataKey(raw);
  await rememberKey(raw, salt); raw.fill(0);
  const m = await G.uploadFile(tok, await encode(d, key, salt, 1, device), 1, device, undefined, { user: uid, name });
  const st: SyncState = { enabled: true, fileId: m.id, baseRev: 1, dirty: false, lastSyncAt: new Date().toISOString(), email: tok.email, salt, account: uid, accountName: name };
  saveState(uid, st); return st;
}

/** Another device: unlock the existing cloud copy with the sync password. Returns the cloud data (not applied yet). */
export async function joinCloud(uid: string, tok: G.Token, info: RemoteInfo, password: string): Promise<{ data: AppData; state: SyncState }> {
  if (!info.file || !info.meta) throw new Error('No cloud copy found');
  const raw = await deriveRaw(password, info.file.kdf.salt, info.file.kdf.iter);
  const key = await importDataKey(raw);
  const { data } = await decode(JSON.stringify(info.file), key); // throws on a wrong password
  await rememberKey(raw, info.file.kdf.salt); raw.fill(0);
  const st: SyncState = { enabled: true, fileId: info.meta.id, baseRev: info.meta.rev, dirty: false, lastSyncAt: new Date().toISOString(), email: tok.email, salt: info.file.kdf.salt, account: info.meta.user || uid, accountName: info.meta.accountName };
  saveState(uid, st);
  return { data, state: st };
}

/* ------------------------------------------------------------------ merge */

/** Combine two copies: items are matched by id (or category for budgets); this device wins on the same item,
 *  except accounts, where the most recently updated balance wins. Nothing is deleted. */
export function mergeData(local: AppData, remote: AppData): AppData {
  const byId = <T extends { id: string }>(a: T[], b: T[], pick?: (l: T, r: T) => T) => {
    const m = new Map<string, T>(); for (const x of b) m.set(x.id, x);
    for (const x of a) { const r = m.get(x.id); m.set(x.id, r && pick ? pick(x, r) : x); }
    return [...m.values()];
  };
  const budgets = new Map(remote.budgets.map((b) => [b.category, b])); for (const b of local.budgets) budgets.set(b.category, b);
  return {
    ...local,
    accounts: byId(local.accounts, remote.accounts, (l, r) => ((r.updatedAt || '') > (l.updatedAt || '') ? r : l)),
    txns: byId(local.txns, remote.txns),
    goals: byId(local.goals, remote.goals),
    holdings: byId(local.holdings, remote.holdings),
    snapshots: byId(local.snapshots as any, remote.snapshots as any) as any,
    devices: mergeDevices(local.devices, remote.devices),
    policies: byId((local.policies || []) as any, (remote.policies || []) as any) as any,
    budgets: [...budgets.values()],
    settings: { ...remote.settings, ...local.settings },
  };
}

/* ------------------------------------------------------------------ the sync step */

export type Conflict = (info: { remoteDevice: string; remoteAt: string }) => Promise<'cloud' | 'device' | 'merge'>;
export interface SyncResult { action: 'none' | 'pushed' | 'pulled' | 'merged' | 'created'; data?: AppData; state: SyncState }

/**
 * One sync round. `local` = this device's data; `apply(d)` replaces it (pull/merge).
 * interactive: may open Google sign-in (call from a tap).
 */
export async function syncOnce(uid: string, local: AppData, device: string, interactive: boolean, onConflict: Conflict, name?: string): Promise<SyncResult> {
  let st = loadState(uid);
  if (!st.enabled) return { action: 'none', state: st };
  const k = await loadKey(); if (!k) throw new Error('Sync password needed on this device (Settings → Sync).');
  const tok = await G.getToken(interactive, st.email);
  let acct: G.AccountRef = { user: st.account || uid, name: st.accountName || name || 'FinPlan' };
  const upload = (body: string, rev: number, id?: string) => G.uploadFile(tok, body, rev, device, id, acct);
  const meta = await G.findSyncFile(tok, acct.user, st.fileId, !!st.fileId);
  if (meta?.user && meta.user !== acct.user) { // another device already moved our shared copy to its account id: follow it
    acct = { user: meta.user, name: meta.accountName || acct.name }; st = { ...st, account: acct.user, accountName: acct.name }; saveState(uid, st);
  }
  const now = () => new Date().toISOString();
  if (!meta) { // cloud copy deleted elsewhere → recreate from this device
    const m = await upload(await encode(local, k.key, k.salt, st.baseRev + 1, device), st.baseRev + 1);
    st = { ...st, fileId: m.id, baseRev: m.rev, dirty: false, lastSyncAt: now(), lastError: undefined }; saveState(uid, st);
    return { action: 'created', state: st };
  }
  if (meta.rev > st.baseRev) {
    const { data: remote, file } = await decode(await G.downloadFile(tok, meta.id), k.key);
    let choice: 'cloud' | 'device' | 'merge' = 'cloud';
    if (st.dirty) choice = await onConflict({ remoteDevice: file.meta.device, remoteAt: file.meta.updatedAt });
    if (choice === 'cloud') {
      st = { ...st, fileId: meta.id, baseRev: meta.rev, dirty: false, lastSyncAt: now(), lastError: undefined }; saveState(uid, st);
      return { action: 'pulled', data: remote, state: st };
    }
    const out = choice === 'merge' ? mergeData(local, remote) : local;
    const rev = meta.rev + 1;
    await upload(await encode(out, k.key, k.salt, rev, device), rev, meta.id);
    st = { ...st, fileId: meta.id, baseRev: rev, dirty: false, lastSyncAt: now(), lastError: undefined }; saveState(uid, st);
    return { action: choice === 'merge' ? 'merged' : 'pushed', data: choice === 'merge' ? out : undefined, state: st };
  }
  if (st.dirty || meta.legacy) { // local changes, or an older shared file to move to this account's own file
    const rev = Math.max(meta.rev, st.baseRev) + 1;
    await upload(await encode(local, k.key, k.salt, rev, device), rev, meta.id);
    st = { ...st, fileId: meta.id, baseRev: rev, dirty: false, lastSyncAt: now(), lastError: undefined }; saveState(uid, st);
    return { action: 'pushed', state: st };
  }
  st = { ...st, lastSyncAt: now(), lastError: undefined }; saveState(uid, st);
  return { action: 'none', state: st };
}

export function markDirty(uid: string) { const s = loadState(uid); if (s.enabled && !s.dirty) saveState(uid, { ...s, dirty: true }); }
