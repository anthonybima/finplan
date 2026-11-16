/**
 * Keep the website's app current: compare this build with /version.json on the server.
 * Checked on the sign-in screen (a newer version loads before you sign in) and when an open app comes back
 * to the foreground (a banner offers to reload; your data is already saved).
 */
declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

let last = 0; let latest = '';
export async function newVersionAvailable(minGapMs = 0): Promise<boolean> {
  if (location.protocol !== 'https:' && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return false; // Claude preview, file://, apps
  if ((window as any).claude || (window as any).finplanNative) return false;
  if (Date.now() - last < minGapMs) return false;
  last = Date.now();
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return false;
    const v = await r.json();
    latest = v?.build || '';
    return !!latest && latest !== BUILD;
  } catch { return false; }
}
/** Reload onto the newest version (drops cached files of the old one first). */
export async function reloadToLatest(): Promise<boolean> {
  try { if (sessionStorage.getItem('finplan.reloadedFor') === latest) return false; sessionStorage.setItem('finplan.reloadedFor', latest); } catch { /* */ } // never loop
  try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch { /* */ }
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* */ }
  location.reload();
  return true;
}
