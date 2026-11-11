import type { Holding } from './types';
import { request } from './net';
import { uid } from './store';

/**
 * Alpaca Markets Trading API v2 (US stocks, ETFs, options, crypto).
 * Live:  https://api.alpaca.markets      Paper: https://paper-api.alpaca.markets
 * Auth headers: APCA-API-KEY-ID, APCA-API-SECRET-KEY. FinPlan only calls GET /v2/account and GET /v2/positions.
 */
export interface AlpacaCreds { apiKey: string; secret: string; paper?: boolean }
const base = (paper?: boolean) => (paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets');

async function get(c: AlpacaCreds, path: string) {
  const r = await request(base(c.paper) + path, { headers: { 'APCA-API-KEY-ID': c.apiKey, 'APCA-API-SECRET-KEY': c.secret, Accept: 'application/json' } });
  let j: any; try { j = JSON.parse(r.text); } catch { j = {}; }
  if (r.status === 401 || r.status === 403) throw new Error(`Alpaca: key rejected (${r.status}). ${c.paper ? 'Paper keys only work with Paper mode.' : 'Live keys only work with Live mode.'}`);
  if (r.status >= 400) throw new Error(`Alpaca: ${j.message || 'HTTP ' + r.status}`);
  return j;
}

export async function syncAlpaca(c: AlpacaCreds): Promise<{ holdings: Holding[]; equity: number; cash: number; paper: boolean; status: string }> {
  const [acct, positions] = await Promise.all([get(c, '/v2/account'), get(c, '/v2/positions')]);
  const paper = !!c.paper;
  const tag = paper ? ' (paper)' : '';
  const out: Holding[] = [];
  for (const p of positions || []) {
    const qty = Number(p.qty), mv = Number(p.market_value), avg = Number(p.avg_entry_price);
    if (!qty || !isFinite(mv)) continue;
    const ac = String(p.asset_class || 'us_equity');
    const isCrypto = ac === 'crypto', isOption = ac === 'us_option';
    const symbol = isCrypto ? String(p.symbol).replace('/', '').replace(/(USD|USDT|USDC)$/, '') : String(p.symbol);
    const price = Number(p.current_price) || mv / qty;
    out.push({
      id: uid(), source: 'alpaca', symbol, name: (isOption ? 'Option ' : '') + p.symbol + tag,
      assetClass: isCrypto ? 'crypto' : 'stock', qty: isOption ? qty * 100 : qty, // option contracts × 100 shares
      price: isOption ? mv / (qty * 100) : price, // option premiums are quoted per share
      avgPrice: avg, currency: 'USD',
      market: isCrypto ? 'CRYPTO' : isOption ? 'OTHER' : 'US', excluded: paper, category: isCrypto ? 'Crypto' : isOption ? 'Options' : 'US Stocks',
    });
  }
  const cash = Number(acct.cash || 0);
  if (cash > 0.5) out.push({ id: uid(), source: 'alpaca', symbol: 'USD', name: `Alpaca cash${tag}`, assetClass: 'cash', qty: cash, avgPrice: 1, price: 1, currency: 'USD', market: 'OTHER', excluded: paper, category: 'Cash' });
  return { holdings: out, equity: Number(acct.equity || acct.portfolio_value || 0), cash, paper, status: String(acct.status || '') };
}
