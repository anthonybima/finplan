/**
 * Network layer that works the same on every platform:
 *  - Desktop (Electron): requests run in the main process → no CORS, custom headers allowed.
 *  - Mobile (Capacitor): CapacitorHttp patches window.fetch natively → no CORS.
 *  - Web/PWA: normal fetch; *public* GETs may fall back to CORS proxies.
 *    Authenticated requests (API keys) are NEVER sent through a proxy.
 */
export interface NetResponse { status: number; text: string; headers?: Record<string, string> }
export interface NetOptions { method?: string; headers?: Record<string, string>; body?: string; publicProxy?: boolean; timeoutMs?: number }

declare global {
  interface Window {
    finplanNative?: {
      platform: string;
      fetchText: (url: string) => Promise<string>;
      request?: (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => Promise<NetResponse>;
      secretGet?: (key: string) => Promise<string | null>;
      secretSet?: (key: string, value: string | null) => Promise<void>;
      oauthRedirectUri?: () => Promise<string>;
      oauthAuthorize?: (url: string) => Promise<{ code: string; state: string | null }>;
    };
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }
}

export const platform = () =>
  window.finplanNative?.platform === 'electron' ? 'desktop' : window.Capacitor?.isNativePlatform?.() ? 'mobile' : 'web';

let proxyAllowed = true;
/** Privacy mode: never route anything through third-party CORS proxies. */
export function setProxyAllowed(v: boolean) { proxyAllowed = v; }

const PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

async function timed(url: string, init: RequestInit, ms: number): Promise<NetResponse> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...init, signal: ctl.signal }); const headers: Record<string, string> = {}; r.headers.forEach((v, k) => { headers[k] = v; }); return { status: r.status, text: await r.text(), headers }; }
  finally { clearTimeout(t); }
}

export async function request(url: string, o: NetOptions = {}): Promise<NetResponse> {
  const method = o.method || 'GET', headers = o.headers || {};
  const n = window.finplanNative;
  if (n?.request) return n.request(url, { method, headers, body: o.body });
  try {
    return await timed(url, { method, headers, body: o.body }, o.timeoutMs || 12000);
  } catch (e) {
    if (!proxyAllowed || !o.publicProxy || method !== 'GET' || Object.keys(headers).length) {
      if (platform() === 'web') throw new Error('Blocked by the browser (CORS). Use the desktop or mobile app for this connection.');
      throw e;
    }
    for (const p of PROXIES) {
      try { const r = await timed(p(url), {}, o.timeoutMs || 12000); if (r.status < 400) return r; } catch { /* next */ }
    }
    throw e;
  }
}

export async function getJSON<T = any>(url: string, o: NetOptions = {}): Promise<T> {
  const r = await request(url, { publicProxy: true, ...o });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.text);
}

/** Text fetch used by the news reader (public feeds). */
export async function fetchText(url: string): Promise<string> {
  if (window.finplanNative) return window.finplanNative.fetchText(url);
  const r = await request(url, { publicProxy: true, timeoutMs: 9000 });
  if (r.status >= 400 || !(r.text.includes('<item') || r.text.includes('<entry'))) {
    if (!proxyAllowed) throw new Error('Feed unreachable (privacy mode blocks proxies)');
    for (const p of PROXIES) {
      try { const x = await timed(p(url), {}, 9000); if (x.text.includes('<item') || x.text.includes('<entry')) return x.text; } catch { /* next */ }
    }
    throw new Error('Feed unreachable');
  }
  return r.text;
}
