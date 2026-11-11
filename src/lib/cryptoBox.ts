/** Small, audited-by-design crypto helpers on top of WebCrypto (no custom primitives). */
export interface Box { iv: string; ct: string }

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export const b64 = (u: ArrayBuffer | Uint8Array) => {
  const a = new Uint8Array(u); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
export const rand = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

/** OWASP (2023+) recommendation for PBKDF2-HMAC-SHA256. */
export const KDF_ITER = 600_000;

export async function deriveKey(secret: string, salt: string, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM with a fresh 96-bit IV per message; optional associated data binds the ciphertext to its purpose. */
export async function seal(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, aad?: string): Promise<Box> {
  const iv = rand(12);
  const p: AesGcmParams = { name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) };
  return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt(p, key, bytes)) };
}
export async function open(key: CryptoKey, box: Box, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  const p: AesGcmParams = { name: 'AES-GCM', iv: unb64(box.iv), ...(aad ? { additionalData: enc.encode(aad) } : {}) };
  return new Uint8Array(await crypto.subtle.decrypt(p, key, unb64(box.ct)));
}

/** Import raw key bytes as a NON-extractable key, then wipe the bytes. */
export async function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return k;
}
export const wipe = (a?: Uint8Array) => { if (a) a.fill(0); };

/* ---------- Password-protected backup files ---------- */
export interface EncryptedBackup { format: 'finplan-backup-enc'; version: 1; kdf: { alg: 'PBKDF2-SHA256'; iter: number; salt: string }; cipher: 'AES-256-GCM'; iv: string; ct: string; createdAt: string; device?: string }

export async function encryptBackup(obj: unknown, password: string, device?: string): Promise<EncryptedBackup> {
  const salt = b64(rand(16));
  const key = await deriveKey(password, salt, KDF_ITER);
  const box = await seal(key, enc.encode(JSON.stringify(obj)), 'finplan-backup-v1');
  return { format: 'finplan-backup-enc', version: 1, kdf: { alg: 'PBKDF2-SHA256', iter: KDF_ITER, salt }, cipher: 'AES-256-GCM', ...box, createdAt: new Date().toISOString(), device };
}
export async function decryptBackup<T>(b: EncryptedBackup, password: string): Promise<T> {
  const key = await deriveKey(password, b.kdf.salt, b.kdf.iter);
  try { return JSON.parse(dec.decode(await open(key, b, 'finplan-backup-v1'))); }
  catch { throw new Error('Wrong backup password or damaged file'); }
}
export const isEncryptedBackup = (x: any): x is EncryptedBackup => x?.format === 'finplan-backup-enc';
