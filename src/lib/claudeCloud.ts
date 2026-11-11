/**
 * Sync storage inside Claude: the artifact's `db`, in the viewer's PRIVATE area `data/users/<claude user id>/`
 * (nobody else can read it, not even the artifact's owner). Same Claude account on phone and computer = same store.
 *
 * What is stored is exactly the Google Drive file: the end-to-end encrypted FinPlan copy (AES-256-GCM, sync password),
 * split into ≤180 KB pieces because a document holds at most 256 KiB.
 *   data/users/<me>/<fileId>                      meta: kind, name, appProperties {rev, device, user, accountName}, gen, chunks, size, modifiedTime
 *   data/users/<me>/<fileId>/chunks/<gen>-<i>     { d: "<piece i>" }
 * Each save writes a NEW generation of pieces, then the meta, then deletes the old pieces, so a reader never mixes versions.
 */
export interface CloudFile { id: string; name?: string; modifiedTime: string; size?: number; appProperties: Record<string, string> }
export interface CloudStore {
  list(): Promise<CloudFile[]>;
  download(id: string): Promise<string>;
  upload(body: string, meta: { name?: string; appProperties: Record<string, string> }, id?: string): Promise<CloudFile>;
  remove(id: string): Promise<void>;
}

const CHUNK = 180_000;
const KIND = 'finplan-sync';
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);

/** Retry once on a transient platform error, as the store asks. */
async function once<T = any>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e: any) {
    if (e?.code !== 'unavailable') throw friendly(e);
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    try { return await f(); } catch (e2) { throw friendly(e2); }
  }
}
function friendly(e: any): Error {
  const code = e?.code;
  if (code === 'quota_exceeded') return new Error('Claude storage for FinPlan is full. Delete old transactions or snapshots, then sync again.');
  if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled') return new Error('Claude storage is not available in this view. Reload FinPlan.');
  if (code === 'resource_exhausted') return new Error('Claude storage is busy. Try again in a minute.');
  return e instanceof Error ? e : new Error(e?.message || 'Claude storage error');
}

export function makeStore(db: any, me: string): CloudStore {
  const col = () => db.collection(`data/users/${me}`);
  const pieces = (id: string) => col().doc(id).collection('chunks');
  const toFile = (snap: any): CloudFile | null => {
    const v = snap.exists ? snap.data() : undefined;
    if (!v || v.kind !== KIND) return null;
    return { id: snap.id, name: v.name, modifiedTime: v.modifiedTime, size: v.size, appProperties: { ...(v.appProperties || {}) } };
  };
  return {
    async list() {
      const q: any = await once(() => col().get());
      return (q.docs as any[]).map(toFile).filter(Boolean) as CloudFile[];
    },
    async download(id) {
      const m: any = await once(() => col().doc(id).get());
      const v = m.exists ? m.data() : undefined;
      if (!v || v.kind !== KIND) throw new Error('This FinPlan copy no longer exists in Claude storage');
      const parts = await Promise.all(Array.from({ length: v.chunks }, (_, i) => once(() => pieces(id).doc(`${v.gen}-${i}`).get())));
      if (parts.some((p: any) => !p.exists)) throw new Error('The copy in Claude storage is being saved by another device. Sync again in a moment.');
      return parts.map((p: any) => p.data().d as string).join('');
    },
    async upload(body, meta, id) {
      const fileId = id || 'fp-' + rid();
      let old: any;
      if (id) { const m: any = await once(() => col().doc(id).get()); old = m.exists ? m.data() : undefined; }
      const gen = rid(); const n = Math.max(1, Math.ceil(body.length / CHUNK));
      for (let i = 0; i < n; i++) { const piece = body.slice(i * CHUNK, (i + 1) * CHUNK); await once(() => pieces(fileId).doc(`${gen}-${i}`).set({ d: piece })); }
      const modifiedTime = new Date().toISOString();
      const appProperties = { ...(old?.appProperties || {}), ...meta.appProperties };
      const name = meta.name || old?.name;
      await once(() => col().doc(fileId).set({ kind: KIND, name: name ?? null, appProperties, gen, chunks: n, size: body.length, modifiedTime }));
      if (old?.gen && old.gen !== gen) for (let i = 0; i < (old.chunks || 0); i++) { try { await pieces(fileId).doc(`${old.gen}-${i}`).delete(); } catch { /* left-over piece, harmless */ } }
      return { id: fileId, name, modifiedTime, size: body.length, appProperties };
    },
    async remove(id) {
      const m: any = await once(() => col().doc(id).get()); const v = m.exists ? m.data() : undefined;
      await once(() => col().doc(id).delete());
      if (v?.gen) for (let i = 0; i < (v.chunks || 0); i++) { try { await pieces(id).doc(`${v.gen}-${i}`).delete(); } catch { /* */ } }
    },
  };
}

/* ---- availability (inside Claude only; resolves once) ---- */
let store: CloudStore | null = null;
let ready: Promise<CloudStore | null> | null = null;
const listeners = new Set<() => void>();
export const claudeStore = () => store;
export function onClaudeStore(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); }
export function initClaudeStore(): Promise<CloudStore | null> {
  if (ready) return ready;
  ready = (async () => {
    try {
      const c = (window as any).claude; if (!c?.use) return null;
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user?.id) return null;
      const me = await user.id(); if (!me) return null;
      store = makeStore(db, String(me));
      listeners.forEach((f) => f());
      return store;
    } catch { return null; }
  })();
  return ready;
}
