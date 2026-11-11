/**
 * API secrets are kept OUT of the normal data store and OUT of backups.
 *  - Desktop: encrypted with the OS keychain via Electron safeStorage.
 *  - Mobile / web: device-local storage under a separate key (never exported).
 */
const PREFIX = 'finplan.secret.';

import { dec, enc, open, seal } from './cryptoBox';

// Each signed-in user has their own API keys (namespace = user id), encrypted with that user's
// vault key (AES-256-GCM). On desktop the ciphertext is additionally sealed by the OS keychain.
let ns = '';
let vaultKey: CryptoKey | null = null;
export function setSecretNamespace(userId: string, key: CryptoKey | null = null) { ns = userId ? userId + '.' : ''; vaultKey = userId ? key : null; }

async function rawGet(k: string): Promise<string | null> {
  const n = window.finplanNative;
  if (n?.secretGet) return n.secretGet(k);
  try { return localStorage.getItem(PREFIX + k); } catch { return mem[k] ?? null; }
}
async function rawSet(k: string, value: string | null) {
  const n = window.finplanNative;
  if (n?.secretSet) return n.secretSet(k, value);
  try { if (value == null) localStorage.removeItem(PREFIX + k); else localStorage.setItem(PREFIX + k, value); }
  catch { if (value == null) delete mem[k]; else mem[k] = value; }
}
export async function getSecret(key: string): Promise<string | null> {
  const v = await rawGet(ns + key);
  if (v == null) return null;
  if (!v.startsWith('enc1:')) return vaultKey ? null : v; // never hand out unencrypted secrets while signed in
  if (!vaultKey) return null;
  try { return dec.decode(await open(vaultKey, JSON.parse(v.slice(5)), `secret:${ns}${key}`)); } catch { return null; }
}
export async function setSecret(key: string, value: string | null) {
  if (value == null) return rawSet(ns + key, null);
  if (!vaultKey) throw new Error('Sign in to save API keys');
  const box = await seal(vaultKey, enc.encode(value), `secret:${ns}${key}`);
  return rawSet(ns + key, 'enc1:' + JSON.stringify(box));
}

/** Move keys saved before accounts existed into the first user's namespace. */
export async function adoptLegacySecrets(_userId: string) {
  for (const k of ['bitget', 'bittime', 'alpaca', 'pluang-mcp']) {
    const v = await rawGet(k);
    if (v != null && !v.startsWith('enc1:')) { await setSecret(k, v); await rawSet(k, null); }
  }
}
const mem: Record<string, string> = {};

export async function getJSONSecret<T>(key: string): Promise<T | null> {
  const s = await getSecret(key);
  try { return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
