import type { Holding } from './types';
import { request, getJSON } from './net';
import { uid } from './store';
import { bitgetTickers } from './holdings';

/**
 * Bittime Open API (Indonesian exchange, Binance-style).
 * Base https://openapi.bittime.com · header X-MBX-APIKEY
 * signature = hex( HMAC_SHA256( secretKey, queryString + body ) ), sent as `signature` query param.
 * Balances: GET /api/v1/account (USER_DATA) → balances[{ asset, free, locked }]
 */
export interface BittimeCreds { apiKey: string; secret: string }
const BASE = 'https://openapi.bittime.com';

export async function signHex(secret: string, payload: string): Promise<string> {
  if (!crypto?.subtle) throw new Error('Secure crypto unavailable in this environment');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function serverOffset(): Promise<number> {
  try { const j = await getJSON<{ serverTime: number }>(BASE + '/api/v1/time', { publicProxy: false }); return j.serverTime - Date.now(); } catch { return 0; }
}

async function signedGet(c: BittimeCreds, path: string, params: Record<string, string> = {}) {
  const ts = Date.now() + (await serverOffset());
  const qs = new URLSearchParams({ ...params, recvWindow: '5000', timestamp: String(ts) }).toString();
  const signature = await signHex(c.secret, qs);
  const r = await request(`${BASE}${path}?${qs}&signature=${signature}`, { headers: { 'X-MBX-APIKEY': c.apiKey } });
  let j: any;
  try { j = JSON.parse(r.text); } catch { throw new Error(`Bittime HTTP ${r.status}`); }
  if (r.status >= 400 || (typeof j.code === 'number' && j.code < 0)) throw new Error(`Bittime: ${j.msg || 'error'}${j.code ? ` (${j.code})` : ''}`);
  return j;
}

async function bittimePrice(symbol: string): Promise<number | null> {
  try { const j = await getJSON<{ price: string }>(`${BASE}/api/v1/ticker/price?symbol=${symbol}`); const p = Number(j.price); return p > 0 ? p : null; } catch { return null; }
}

const STABLE = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI']);

/** Coins priced in USD (Bitget public tickers, then Bittime's own ticker); IDR balance kept as rupiah cash. */
export async function syncBittime(c: BittimeCreds): Promise<{ holdings: Holding[]; totalIdr: number; totalUsd: number }> {
  const acc = await signedGet(c, '/api/v1/account');
  const tick = await bitgetTickers().catch(() => new Map<string, number>());
  const out: Holding[] = [];
  for (const b of acc.balances || []) {
    const asset = String(b.asset || '').toUpperCase();
    const qty = Number(b.free || 0) + Number(b.locked || 0);
    if (!asset || qty <= 0) continue;
    if (asset === 'IDR') {
      if (qty >= 1000) out.push({ id: uid(), source: 'bittime', symbol: 'IDR', name: 'Rupiah balance', assetClass: 'cash', qty, avgPrice: 1, price: 1, currency: 'IDR', market: 'OTHER' });
      continue;
    }
    let price = STABLE.has(asset) ? 1 : tick.get(`${asset}USDT`) ?? null;
    if (price == null) price = await bittimePrice(`${asset}USDT`);
    if (price == null) { const idr = await bittimePrice(`${asset}IDR`); if (idr) { out.push({ id: uid(), source: 'bittime', symbol: asset, name: asset, assetClass: 'crypto', qty, avgPrice: idr, price: idr, currency: 'IDR', market: 'CRYPTO' }); continue; } }
    if (!price || price * qty < 0.5) continue; // unpriced or dust
    out.push({ id: uid(), source: 'bittime', symbol: asset, name: asset, assetClass: STABLE.has(asset) ? 'cash' : 'crypto', qty, avgPrice: price, price, currency: 'USD', market: 'CRYPTO' });
  }
  const totalUsd = out.filter((h) => h.currency === 'USD').reduce((s, h) => s + h.qty * h.price, 0);
  const totalIdr = out.filter((h) => h.currency === 'IDR').reduce((s, h) => s + h.qty * h.price, 0);
  return { holdings: out, totalUsd, totalIdr };
}
