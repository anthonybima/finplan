import Papa from 'papaparse';
import type { Account, AppData, AssetClass, Holding, Source } from './types';
import { ASSUMPTIONS } from './risk';
import { getJSON } from './net';
import { parseAmount, today } from './format';
import { uid } from './store';

export const SOURCE_LABEL: Record<Source, string> = { bitget: 'Bitget', bittime: 'Bittime', alpaca: 'Alpaca', pluang: 'Pluang', stockbit: 'Stockbit', tradingview: 'TradingView', manual: 'Manual' };

export const valueIDR = (h: Holding, usdIdr: number) => h.qty * h.price * (h.currency === 'USD' ? usdIdr : 1);
export const costIDR = (h: Holding, usdIdr: number) => h.qty * h.avgPrice * (h.currency === 'USD' ? usdIdr : 1);

export function marketOf(h: Holding): NonNullable<Holding['market']> {
  if (h.market) return h.market;
  if (h.assetClass === 'crypto') return 'CRYPTO';
  if (h.currency === 'IDR' && (h.assetClass === 'stock' || h.assetClass === 'mutualfund')) return 'IDX';
  if (h.currency === 'USD' && (h.assetClass === 'stock' || h.assetClass === 'gold')) return 'US';
  return 'OTHER';
}

/** TradingView symbol for charts / portfolio export. */
export function tvSymbol(h: Holding) {
  if (h.tv) return h.tv;
  const m = marketOf(h);
  if (m === 'IDX') return `IDX:${h.symbol}`;
  if (m === 'CRYPTO') return `BITGET:${h.symbol}USDT`;
  return h.symbol;
}

/**
 * Connected holdings become investment accounts (one per source × asset class),
 * so net worth, allocation, VaR and advice all include them automatically.
 */
export function syncAccounts(d: AppData): AppData {
  const manual = d.accounts.filter((a) => !a.synced);
  const keepGroup = new Map(d.accounts.filter((a) => a.synced && a.group).map((a) => [a.id, a.group!])); // groups you set survive re-syncs
  const groups = new Map<string, { source: Source; cls: AssetClass; value: number; opened?: string }>();
  for (const h of d.holdings) {
    if (h.excluded) continue;
    const k = `${h.source}-${h.assetClass}`;
    const g = groups.get(k) || { source: h.source, cls: h.assetClass, value: 0 };
    g.value += valueIDR(h, d.settings.usdIdr);
    if (h.opened && (!g.opened || h.opened < g.opened)) g.opened = h.opened;
    groups.set(k, g);
  }
  const synced: Account[] = [...groups.entries()].map(([k, g]) => ({
    id: `conn-${k}`, name: `${SOURCE_LABEL[g.source]} · ${ASSUMPTIONS[g.cls].label.split(' (')[0]}`,
    kind: 'investment', assetClass: g.cls, balance: Math.round(g.value), updatedAt: today(), synced: g.source, ...(g.opened ? { opened: g.opened } : {}), ...(keepGroup.has(`conn-${k}`) ? { group: keepGroup.get(`conn-${k}`) } : {}),
  }));
  return { ...d, accounts: [...manual, ...synced] };
}

/** A re-sync / re-import replaces positions; keep the year each one was first bought. */
export function keepOpened(prev: Holding[], next: Holding[]): Holding[] {
  const m = new Map(prev.filter((h) => h.opened).map((h) => [`${h.symbol}|${h.assetClass}`, h.opened!]));
  return next.map((h) => (h.opened || !m.has(`${h.symbol}|${h.assetClass}`) ? h : { ...h, opened: m.get(`${h.symbol}|${h.assetClass}`) }));
}

export function replaceSource(d: AppData, source: Source, holdings: Holding[], status: { message?: string; via?: 'mcp' | 'file' | 'api'; summary?: Record<string, number> } = {}): AppData {
  const next = { ...d, holdings: [...d.holdings.filter((h) => h.source !== source), ...keepOpened(d.holdings.filter((h) => h.source === source), holdings)] };
  next.settings = { ...next.settings, connections: { ...next.settings.connections, [source]: { lastSync: new Date().toISOString(), status: 'ok', ...status } } };
  return syncAccounts(next);
}

/* ---------- Prices & FX ---------- */

async function yahooPrice(sym: string): Promise<number | null> {
  try {
    const j = await getJSON<any>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch { return null; }
}

export async function bitgetTickers(): Promise<Map<string, number>> {
  const j = await getJSON<any>('https://api.bitget.com/api/v2/spot/market/tickers');
  const m = new Map<string, number>();
  for (const t of j?.data || []) m.set(t.symbol, Number(t.lastPr));
  return m;
}

export async function fetchUsdIdr(): Promise<number | null> {
  const p = await yahooPrice('IDR=X');
  return p && p > 5000 && p < 50000 ? p : null;
}

/** Refresh last prices: IDX via Yahoo (.JK), US via Yahoo, crypto via Bitget public tickers. */
export async function refreshPrices(holdings: Holding[], usdIdr = 16500): Promise<{ holdings: Holding[]; updated: number; failed: string[] }> {
  let tickers: Map<string, number> | null = null;
  if (holdings.some((h) => marketOf(h) === 'CRYPTO')) { try { tickers = await bitgetTickers(); } catch { tickers = null; } }
  const failed: string[] = [];
  let updated = 0;
  const out = await Promise.all(holdings.map(async (h) => {
    if (h.assetClass === 'cash' || h.assetClass === 'deposit' || h.assetClass === 'property') return h;
    const m = marketOf(h);
    let p: number | null = null;
    if (m === 'CRYPTO') { const usd = h.symbol === 'USDT' ? 1 : tickers?.get(`${h.symbol}USDT`) ?? null; p = usd == null ? null : h.currency === 'IDR' ? usd * usdIdr : usd; }
    else if (m === 'IDX') p = await yahooPrice(`${h.symbol}.JK`);
    else if (m === 'US') p = await yahooPrice(h.symbol.replace('.', '-'));
    if (p == null) { if (m !== 'OTHER') failed.push(h.symbol); return h; }
    updated++;
    return { ...h, price: p, priceAt: new Date().toISOString() };
  }));
  return { holdings: out, updated, failed };
}

/* ---------- File formats ---------- */

export interface HoldingsFile { format: 'finplan-holdings'; version: 1; source: Source; asOf: string; usdIdr?: number; summary?: Record<string, number>; holdings: Omit<Holding, 'id' | 'source'>[] }

const CLASS_ALIASES: Record<string, AssetClass> = {
  stock: 'stock', saham: 'stock', equity: 'stock', etf: 'stock', 'us stock': 'stock', crypto: 'crypto', kripto: 'crypto',
  gold: 'gold', emas: 'gold', bond: 'bond', obligasi: 'bond', sbn: 'bond', fund: 'mutualfund', 'mutual fund': 'mutualfund', reksadana: 'mutualfund',
  cash: 'cash', deposit: 'deposit', rdpu: 'deposit', property: 'property',
};

/** Import a FinPlan holdings JSON (e.g. a Pluang snapshot made by Claude) or a holdings CSV. */
export async function parseHoldingsFile(file: File, fallbackSource: Source): Promise<{ source: Source; holdings: Holding[]; usdIdr?: number; summary?: Record<string, number> }> {
  if (file.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB');
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
    const j = JSON.parse(text) as HoldingsFile;
    if (j.format !== 'finplan-holdings' || !Array.isArray(j.holdings)) throw new Error('Not a FinPlan holdings file');
    return { source: j.source || fallbackSource, usdIdr: j.usdIdr, summary: j.summary, holdings: j.holdings.map((h) => ({ ...h, id: uid(), source: j.source || fallbackSource })) };
  }
  const rows = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data;
  const pick = (r: Record<string, string>, ...names: string[]) => {
    const k = Object.keys(r).find((x) => names.some((n) => x.trim().toLowerCase() === n));
    return k ? r[k] : '';
  };
  const holdings: Holding[] = [];
  for (const r of rows) {
    const symbol = (pick(r, 'symbol', 'ticker', 'kode', 'kode saham', 'coin', 'aset') || '').toUpperCase().replace(/^IDX:/, '').trim();
    if (!symbol) continue;
    const lots = parseAmount(pick(r, 'lot', 'lots'));
    let qty = parseAmount(pick(r, 'qty', 'quantity', 'shares', 'jumlah', 'units', 'unit', 'amount'));
    if (!isFinite(qty) && isFinite(lots)) qty = lots * 100;
    const currency = (pick(r, 'currency', 'mata uang') || (fallbackSource === 'stockbit' ? 'IDR' : 'USD')).toUpperCase() === 'IDR' ? 'IDR' : 'USD';
    const cls = CLASS_ALIASES[(pick(r, 'asset class', 'class', 'type', 'jenis') || '').toLowerCase()] || (fallbackSource === 'stockbit' ? 'stock' : 'stock');
    const avg = parseAmount(pick(r, 'avg price', 'average price', 'avg', 'harga rata-rata', 'cost', 'avg cost'));
    const price = parseAmount(pick(r, 'price', 'last price', 'harga', 'last'));
    if (!isFinite(qty) || qty <= 0) continue;
    holdings.push({
      id: uid(), source: fallbackSource, symbol, name: pick(r, 'name', 'nama') || symbol, assetClass: cls, qty,
      avgPrice: isFinite(avg) ? avg : isFinite(price) ? price : 0, price: isFinite(price) ? price : isFinite(avg) ? avg : 0, currency,
    });
  }
  if (!holdings.length) throw new Error('No holdings found. Expected columns: Symbol, Qty (or Lot), Avg price, Price, Currency, Asset class');
  return { source: fallbackSource, holdings };
}

export function holdingsTemplateCSV(source: Source) {
  return source === 'stockbit'
    ? 'Symbol,Name,Lot,Avg price,Price,Currency,Asset class\nBBCA,Bank Central Asia,10,9250,9400,IDR,stock\nTLKM,Telkom Indonesia,25,3120,2980,IDR,stock\n'
    : 'Symbol,Name,Qty,Avg price,Price,Currency,Asset class\nAAPL,Apple Inc,2,210.5,228.1,USD,stock\nBTC,Bitcoin,0.01,61000,68000,USD,crypto\n';
}

export async function downloadText(name: string, text: string | Uint8Array, type = 'text/csv') {
  const c = (window as any).claude;
  if (c?.use) {
    try {
      const dl = await Promise.race([c.use('downloads'), new Promise((r) => setTimeout(() => r(null), 3000))]) as any;
      if (dl?.save) { await dl.save({ filename: name, data: new Blob([text as BlobPart], { type }) }); return; }
    } catch { /* viewer declined or unavailable → fall back */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
