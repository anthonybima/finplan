import type { Holding } from './types';
import { request } from './net';
import { uid } from './store';
import { bitgetTickers } from './holdings';

/**
 * Bitget REST API (read-only key).
 * Signature = Base64( HMAC_SHA256( timestamp + METHOD + requestPath[?query] + body, secret ) )
 * Headers: ACCESS-KEY, ACCESS-SIGN, ACCESS-TIMESTAMP, ACCESS-PASSPHRASE.
 */
export interface BitgetCreds { apiKey: string; secret: string; passphrase: string }
const BASE = 'https://api.bitget.com';

export async function sign(secret: string, prehash: string): Promise<string> {
  if (!crypto?.subtle) throw new Error('Secure crypto unavailable in this environment');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(prehash)));
  let bin = ''; for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function privateGet(c: BitgetCreds, path: string, query: Record<string, string> = {}) {
  const qs = Object.keys(query).sort().map((k) => `${k}=${encodeURIComponent(query[k])}`).join('&');
  const ts = Date.now().toString();
  const signature = await sign(c.secret, ts + 'GET' + path + (qs ? '?' + qs : ''));
  const r = await request(BASE + path + (qs ? '?' + qs : ''), {
    headers: {
      'ACCESS-KEY': c.apiKey, 'ACCESS-SIGN': signature, 'ACCESS-TIMESTAMP': ts,
      'ACCESS-PASSPHRASE': c.passphrase, 'Content-Type': 'application/json', locale: 'en-US',
    },
  });
  let j: any;
  try { j = JSON.parse(r.text); } catch { throw new Error(`Bitget HTTP ${r.status}`); }
  if (j.code !== '00000') throw Object.assign(new Error(`Bitget: ${j.msg || 'error'} (${j.code})`), { code: j.code });
  return j.data;
}

const ACCOUNT_LABEL: Record<string, string> = {
  futures: 'Futures account', funding: 'Funding account', earn: 'Earn', bots: 'Trading bots', margin: 'Margin account', copy: 'Copy trading', overview: 'Other',
};

/** Pull spot coins (priced in USDT) + USDT totals of every other account type. */
export async function syncBitget(c: BitgetCreds): Promise<{ holdings: Holding[]; totalUsd: number; note: string }> {
  const out: Holding[] = [];
  let note = '';
  try {
    const [spot, all, tick] = await Promise.all([
      privateGet(c, '/api/v2/spot/account/assets'),
      privateGet(c, '/api/v2/account/all-account-balance').catch(() => []),
      bitgetTickers().catch(() => new Map<string, number>()),
    ]);
    for (const a of spot || []) {
      const qty = Number(a.available || 0) + Number(a.frozen || 0) + Number(a.locked || 0);
      if (qty <= 0) continue;
      const coin = String(a.coin).toUpperCase();
      const price = coin === 'USDT' || coin === 'USDC' ? 1 : tick.get(`${coin}USDT`) || 0;
      if (price * qty < 0.5) continue; // ignore dust
      out.push({ id: uid(), source: 'bitget', symbol: coin, name: coin, assetClass: coin === 'USDT' || coin === 'USDC' ? 'cash' : 'crypto', qty, avgPrice: price, price, currency: 'USD', market: 'CRYPTO' });
    }
    for (const acc of all || []) {
      const t = String(acc.accountType || '').toLowerCase();
      const usdt = Number(acc.usdtBalance || 0);
      if (t === 'spot' || usdt < 0.5) continue;
      out.push({ id: uid(), source: 'bitget', symbol: `${t.toUpperCase()}`, name: ACCOUNT_LABEL[t] || t, assetClass: 'crypto', qty: usdt, avgPrice: 1, price: 1, currency: 'USD', market: 'OTHER' });
    }
  } catch (e: any) {
    // Unified Trading Account (UTA) users: v2 classic endpoints are rejected → use v3
    if (!/40084|40085|unified|uta/i.test(String(e.message) + e.code)) throw e;
    const d = await privateGet(c, '/api/v3/account/assets');
    const assets = d?.assets || d?.list || [];
    for (const a of assets) {
      const coin = String(a.coin || a.coinName).toUpperCase();
      const qty = Number(a.equity ?? a.balance ?? 0), usd = Number(a.usdValue ?? 0);
      if (qty <= 0 || usd < 0.5) continue;
      out.push({ id: uid(), source: 'bitget', symbol: coin, name: coin, assetClass: coin === 'USDT' || coin === 'USDC' ? 'cash' : 'crypto', qty, avgPrice: usd / qty, price: usd / qty, currency: 'USD', market: 'CRYPTO' });
    }
    note = 'Unified Trading Account';
  }
  const totalUsd = out.reduce((s, h) => s + h.qty * h.price, 0);
  return { holdings: out, totalUsd, note };
}
