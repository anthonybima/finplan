/**
 * Where FinPlan's end-to-end encrypted sync copies live (the file keeps its old name; Google Drive is no longer used):
 *  - inside Claude: the artifact's private storage for your Claude account (claudeCloud.ts), no sign-in;
 *  - on the website: FinPlan Cloud, the site's own server, signed in with email + password (serverCloud.ts).
 * Both stores hold the same thing: one encrypted file per FinPlan account, with {rev, device, user, accountName}.
 */
import { claudeStore, type CloudFile, type CloudStore } from './claudeCloud';
import * as Srv from './serverCloud';

export const SYNC_FILE = 'finplan-sync.json'; // older single-file sync; migrated to per-account files
export const ACCOUNT_FILE = (user: string) => `finplan-account-${user.replace(/[^A-Za-z0-9-]/g, '')}.json`;

export interface Token { access_token: string; exp: number; email?: string }
const CLAUDE_TOKEN: Token = { access_token: 'claude-storage', exp: Number.MAX_SAFE_INTEGER, email: 'your Claude account' };
export const usingClaude = () => !!claudeStore();
/** Where the encrypted copies live, for labels. */
export const cloudLabel = () => (usingClaude() ? 'your Claude account' : 'FinPlan Cloud');
export class NeedsSignIn extends Error { constructor(m = 'Sign in to FinPlan Cloud to sync') { super(m); this.name = 'NeedsSignIn'; } }

/** Sync runs inside Claude and on the FinPlan website. */
export function driveSyncSupported(): boolean { return usingClaude() || Srv.serverAvailable(); }

export function currentToken(): Token | null {
  if (usingClaude()) return CLAUDE_TOKEN;
  const s = Srv.session();
  return s ? { access_token: 'finplan-cloud', exp: Number.MAX_SAFE_INTEGER, email: s.email } : null;
}
export function forgetToken() { /* the cloud session is ended with Srv.signOut() */ }

/** A signed-in store, or NeedsSignIn (the UI then shows the email + password form). */
export async function getToken(_interactive?: boolean, _hint?: string): Promise<Token> {
  const t = currentToken(); if (t) return t;
  throw new NeedsSignIn();
}
function store(): CloudStore {
  const cs = claudeStore(); if (cs) return cs;
  if (!Srv.session()) throw new NeedsSignIn();
  return Srv.serverStoreImpl;
}
const wrap = async <T,>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e) { if (e instanceof Srv.CloudAuthError) throw new NeedsSignIn(e.message); throw e; } };

/** One FinPlan account's encrypted copy. `user` / `accountName` identify the account (the name is the only readable label). */
export interface RemoteMeta { id: string; rev: number; modifiedTime: string; size?: number; device?: string; user?: string; accountName?: string; legacy?: boolean }
export interface AccountRef { user: string; name: string }

export async function whoAmI(tok: Token): Promise<string | undefined> { return tok.email; }

const fromCloud = (f: CloudFile): RemoteMeta => ({ id: f.id, rev: Number(f.appProperties?.rev) || 0, modifiedTime: f.modifiedTime, size: f.size, device: f.appProperties?.device, user: f.appProperties?.user || undefined, accountName: f.appProperties?.accountName || undefined, legacy: !f.appProperties?.user });
export async function listSyncFiles(_tok?: Token): Promise<RemoteMeta[]> {
  return wrap(async () => (await store().list()).sort((a, z) => (z.modifiedTime || '').localeCompare(a.modifiedTime || '')).map(fromCloud));
}

/** This account's copy: by file id, then by account id. With `allowLegacy`, an older shared file counts too. */
export async function findSyncFile(tok: Token, user?: string, fileId?: string, allowLegacy = true): Promise<RemoteMeta | null> {
  const all = await listSyncFiles(tok);
  return all.find((f) => fileId && f.id === fileId)
    || all.find((f) => user && f.user === user)
    || (allowLegacy ? all.find((f) => f.legacy) : undefined)
    || (!user && all[0]) || null;
}

export async function downloadFile(_tok: Token, id: string): Promise<string> { return wrap(() => store().download(id)); }

/** Create (no id) or overwrite a copy, recording the revision + device. */
export async function uploadFile(_tok: Token, body: string, rev: number, device: string, id?: string, acct?: AccountRef): Promise<RemoteMeta> {
  const appProperties: Record<string, string> = { rev: String(rev), device: device.slice(0, 100), ...(acct ? { user: acct.user, accountName: acct.name.slice(0, 60) } : {}) };
  const name = acct ? ACCOUNT_FILE(acct.user) : !id ? SYNC_FILE : undefined;
  return wrap(async () => { const f = await store().upload(body, { name, appProperties }, id); return { ...fromCloud(f), rev, user: acct?.user, accountName: acct?.name }; });
}

export async function deleteFile(_tok: Token, id: string) { return wrap(() => store().remove(id)); }
