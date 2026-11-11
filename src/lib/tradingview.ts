import Papa from 'papaparse';
import type { AssetClass, Holding } from './types';
import { parseAmount, today } from './format';
import { uid } from './store';
import { tvSymbol } from './holdings';

/**
 * TradingView Portfolios: import/export the transactions CSV
 * (columns: Symbol, Side, Qty, Fill Price, Commission, Closing Time; symbols like IDX:BBCA, NASDAQ:AAPL, BITGET:BTCUSDT).
 */
const CRYPTO_EX = /^(BINANCE|BITGET|BYBIT|COINBASE|KRAKEN|OKX|KUCOIN|BITSTAMP|GATEIO|MEXC|CRYPTO|INDODAX|TOKOCRYPTO)$/i;

function classify(sym: string): { symbol: string; cls: AssetClass; currency: 'IDR' | 'USD'; market: Holding['market'] } {
  const [ex, raw] = sym.includes(':') ? sym.split(':') : ['', sym];
  if (CRYPTO_EX.test(ex)) return { symbol: raw.replace(/(USDT|USDC|USD|IDR)$/i, ''), cls: 'crypto', currency: raw.endsWith('IDR') ? 'IDR' : 'USD', market: 'CRYPTO' };
  if (/^IDX$/i.test(ex)) return { symbol: raw, cls: 'stock', currency: 'IDR', market: 'IDX' };
  if (/^(TVC|COMEX|OANDA)$/i.test(ex) && /XAU|GOLD|GC/i.test(raw)) return { symbol: raw, cls: 'gold', currency: 'USD', market: 'OTHER' };
  return { symbol: raw, cls: 'stock', currency: 'USD', market: ex ? 'US' : 'OTHER' };
}

export function parseTradingViewCSV(text: string, portfolioCurrency: 'IDR' | 'USD' = 'IDR'): Holding[] {
  const rows = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data;
  if (!rows.length || !('Symbol' in rows[0]) || !('Side' in rows[0])) throw new Error('Not a TradingView transactions file (needs Symbol, Side, Qty, Fill Price…)');
  const pos = new Map<string, { qty: number; cost: number; last: number; sym: string }>();
  let cash = 0;
  const sorted = [...rows].sort((a, b) => String(a['Closing Time'] || '').localeCompare(String(b['Closing Time'] || '')));
  for (const r of sorted) {
    if (r.Status && r.Status !== 'Filled') continue;
    const side = (r.Side || '').toLowerCase(), qty = parseAmount(r.Qty), px = parseAmount(r['Fill Price']), fee = parseAmount(r.Commission) || 0;
    if (r.Symbol === '$CASH') {
      if (side === 'deposit') cash += qty; else if (side === 'withdrawal' || side.startsWith('taxes')) cash -= qty;
      continue;
    }
    if (!isFinite(qty)) continue;
    const p = pos.get(r.Symbol) || { qty: 0, cost: 0, last: 0, sym: r.Symbol };
    if (side === 'buy') { p.cost += qty * (px || 0) + fee; p.qty += qty; cash -= qty * (px || 0) + fee; }
    else if (side === 'sell') { const avg = p.qty ? p.cost / p.qty : 0; p.qty -= qty; p.cost -= avg * qty; cash += qty * (px || 0) - fee; }
    if (isFinite(px)) p.last = px;
    pos.set(r.Symbol, p);
  }
  const out: Holding[] = [];
  for (const p of pos.values()) {
    if (p.qty <= 1e-9) continue;
    const c = classify(p.sym);
    out.push({ id: uid(), source: 'tradingview', symbol: c.symbol, name: c.symbol, assetClass: c.cls, qty: p.qty, avgPrice: p.cost / p.qty, price: p.last || p.cost / p.qty, currency: c.currency, market: c.market, tv: p.sym });
  }
  if (cash > 0.5) out.push({ id: uid(), source: 'tradingview', symbol: 'CASH', name: 'Portfolio cash', assetClass: 'cash', qty: cash, avgPrice: 1, price: 1, currency: portfolioCurrency, market: 'OTHER' });
  return out;
}

/** Export holdings as a TradingView-importable transactions CSV (one buy per position at average price). */
export function toTradingViewCSV(holdings: Holding[], date = today()) {
  const rows = holdings.filter((h) => h.assetClass !== 'cash' && h.market !== 'OTHER' && h.qty > 0).map((h) => ({
    Symbol: tvSymbol(h), Side: 'Buy', Qty: +h.qty.toFixed(8), 'Fill Price': +h.avgPrice.toFixed(6), Commission: 0, 'Closing Time': `${date} 00:00:00`,
  }));
  return Papa.unparse(rows);
}
