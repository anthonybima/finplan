import { serverAvailable } from './serverCloud';
import { getJSON, request } from './net';
import { getJSONSecret } from './secure';
import type { AlpacaCreds } from './alpaca';

/**
 * Market data for the dashboard maker.
 *  - Apps & hosted web: Yahoo Finance chart API (all symbols; via the native bridge or, on the web, public relays).
 *  - Inside Claude (published artifact): the viewer's Pluang connector (US stocks/ETFs, crypto, USD/IDR via USDT).
 */
export type RangeKey = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';
export const RANGES: RangeKey[] = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y'];
export interface Pt { t: number; o?: number; h?: number; l?: number; c: number }
export interface Series {
  sym: string; price: number; prevClose: number | null; change: number | null; changePct: number | null;
  rangeChangePct: number | null; points: Pt[]; currency?: string; dayHigh?: number; dayLow?: number; open?: number;
  updatedAt: number; source: 'Yahoo Finance' | 'Pluang' | 'Alpaca' | 'computed'; note?: string; marketOpen?: boolean;
  gmtoffset?: number; // seconds east of UTC for the market's own date (daily bars)
  stats?: { volume?: string; lots?: string; turnover?: string; avg?: string; marketCap?: string };
}
export type DataSource = 'auto' | 'yahoo' | 'alpaca' | 'pluang';

const YR: Record<RangeKey, { range: string; interval: string }> = {
  '1D': { range: '1d', interval: '5m' }, '5D': { range: '5d', interval: '30m' }, '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' }, '6M': { range: '6mo', interval: '1d' }, YTD: { range: 'ytd', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' }, '5Y': { range: '5y', interval: '1wk' },
};
const TTL: Record<RangeKey, number> = { '1D': 30_000, '5D': 120_000, '1M': 600_000, '3M': 900_000, '6M': 900_000, YTD: 900_000, '1Y': 1_800_000, '5Y': 3_600_000 };

/* ---------- small concurrency limiter + cache ---------- */
const cache = new Map<string, { at: number; p: Promise<Series> }>();
let active = 0; const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 6) await new Promise<void>((r) => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}
export function clearMarketCache() { cache.clear(); }

/* ---------- Yahoo ---------- */
async function yahoo(sym: string, rk: RangeKey): Promise<Series> {
  const { range, interval } = YR[rk];
  const qs = `${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;
  const j = await limited(() => (serverAvailable() // website: FinPlan's own server fetches Yahoo (no CORS proxy)
    ? fetch(`/api/market/chart/${qs}`, { cache: 'no-store' }).then((r) => r.json())
    : (window as any).claude // inside Claude: the same server through the FinPlan Cloud connector
    ? connectorChart(sym, range, interval)
    : getJSON<any>(`https://query1.finance.yahoo.com/v8/finance/chart/${qs}&includePrePost=false`, { timeoutMs: 10000 })));
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'No data');
  const m = r.meta || {}, q = r.indicators?.quote?.[0] || {}, ts: number[] = r.timestamp || [];
  const points: Pt[] = [];
  ts.forEach((t, i) => { const c = q.close?.[i]; if (c != null && isFinite(c)) points.push({ t: t * 1000, o: q.open?.[i] ?? undefined, h: q.high?.[i] ?? undefined, l: q.low?.[i] ?? undefined, c }); });
  const price = m.regularMarketPrice ?? points.at(-1)?.c;
  if (price == null) throw new Error('No price');
  const prevClose = m.previousClose ?? (rk === '1D' ? m.chartPreviousClose : null) ?? null;
  const first = rk === '1D' ? (m.chartPreviousClose ?? points[0]?.c) : points[0]?.c;
  return {
    sym, price, prevClose, change: prevClose ? price - prevClose : null, changePct: prevClose ? price / prevClose - 1 : null,
    rangeChangePct: first ? price / first - 1 : null, points, currency: m.currency,
    gmtoffset: typeof m.gmtoffset === 'number' ? m.gmtoffset : undefined,
    dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow, updatedAt: (m.regularMarketTime || Date.now() / 1000) * 1000, source: 'Yahoo Finance',
  };
}

/** Latest price for a Yahoo symbol through the best route here (Pluang, FinPlan's server, the Claude connector, or Yahoo directly). */
export async function livePrice(sym: string): Promise<number | null> {
  for (const src of ['auto', 'yahoo'] as DataSource[]) {
    try { const s = await getSeries(sym, '5D', true, src); if (s.price > 0) return s.price; } catch { /* next route */ }
  }
  return null;
}

/* ---------- Yahoo data through the FinPlan Cloud connector (inside Claude) ---------- */
let connectorMarketOff = false; // connector not added: stop asking until reload
async function connectorChart(sym: string, range: string, interval: string) {
  if (connectorMarketOff) throw new Error(USE_TV);
  const mcp = await connectorAvailable(); if (!mcp) { connectorMarketOff = true; throw new Error(USE_TV); }
  try {
    const r = await mcp.callTool('FinPlan Cloud', 'market_chart', { symbol: sym, range, interval }, { cache: { staleTime: range === '1d' ? 60_000 : 900_000, gcTime: 1_800_000 } });
    const p = typeof r?.payload === 'string' ? JSON.parse(r.payload) : r?.payload;
    if (!p?.chart) throw new Error('No data');
    return p;
  } catch (e: any) {
    if (/server_not_connected|not_granted|auth|revoked|consent/i.test(String(e?.code || e?.message || ''))) connectorMarketOff = true;
    throw e;
  }
}

/* ---------- Pluang via Claude connector (published artifact only) ---------- */
const PLUANG = 'Pluang MCP';
type Mcp = { callTool: (s: string, t: string, i?: unknown, o?: unknown) => Promise<{ payload?: any; cache?: { storedAt: number } }> };
let mcpP: Promise<Mcp | null> | null = null;
let sessionP: Promise<string> | null = null;
const UQ = 'FinPlan markets dashboard (read-only quotes)';
export function connectorAvailable(): Promise<Mcp | null> {
  if (!mcpP) {
    const c = (window as any).claude;
    mcpP = c?.use ? Promise.race([c.use('mcp').catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 11000))]) : Promise.resolve(null);
  }
  return mcpP;
}
async function pluang(tool: string, input: Record<string, unknown>, staleMs: number) {
  const mcp = await connectorAvailable();
  if (!mcp) { // desktop app: use FinPlan's own Pluang sign-in (Connections → Pluang)
    const m = await import('./pluangMcp');
    if (!(await m.pluangMcpConnected())) throw new Error('Sign in to Pluang in Connections to use Pluang data');
    const p = await m.callPluangTool(tool, input);
    if (p?.success === false) throw new Error(p.message || 'Pluang error');
    return p;
  }
  if (!sessionP) sessionP = mcp.callTool(PLUANG, 'generate_new_session_id', { user_query: UQ }, { cache: { staleTime: 3_600_000, gcTime: 3_600_000 } })
    .then((r) => r.payload?.data?.chatSessionId || crypto.randomUUID()).catch(() => crypto.randomUUID());
  const res = await mcp.callTool(PLUANG, tool, { ...input, user_query: UQ, chat_session_id: await sessionP }, { cache: { staleTime: staleMs, gcTime: Math.max(staleMs, 300_000) } });
  if (res.payload?.success === false) throw new Error(res.payload.message || 'Pluang error');
  return res.payload;
}
let desktopPluang: Promise<boolean> | null = null;
/** Pluang is usable inside Claude (connector) or in the desktop app after "Sign in with Pluang". */
export async function pluangAvailable(): Promise<boolean> {
  if (await connectorAvailable()) return true;
  if (!desktopPluang) desktopPluang = import('./pluangMcp').then((m) => m.pluangMcpSupported() && m.pluangMcpConnected()).catch(() => false);
  return desktopPluang;
}
export function resetPluangAvailability() { desktopPluang = null; }
/** Thrown when FinPlan should hand the chart to TradingView's live widget. */
/** Trading date in New York (US sessions incl. pre/after-hours never straddle it). */
const nyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const nyDay = (t: number) => nyFmt.format(t);

export const USE_TV = 'use-tradingview';
const PLUANG_US = /^[A-Z]{1,5}$/;
const PLUANG_CRYPTO: Record<string, string> = { 'BTC-USD': 'BTC', 'ETH-USD': 'ETH', 'SOL-USD': 'SOL', 'BNB-USD': 'BNB', 'XRP-USD': 'XRP' };
export const isIdx = (sym: string) => /^[A-Z0-9]{4}\.JK$/.test(sym);
export const pluangCan = (sym: string) => PLUANG_US.test(sym) || sym in PLUANG_CRYPTO || sym === 'USDIDR=X' || isIdx(sym);

function ohlcWindow(rk: RangeKey, crypto: boolean, idx = false) {
  const now = Date.now(), d = 864e5;
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (rk) {
    case '1D': return { interval: crypto ? 'FIFTEEN_MINUTES' : 'FIVE_MINUTES', start: iso(now - (crypto ? 1 : idx ? 5 : 4) * d) };
    case '5D': return { interval: 'HOURLY', start: iso(now - (crypto ? 5 : 8) * d) };
    case '1M': return { interval: 'DAILY', start: iso(now - 31 * d) };
    case '3M': return { interval: 'DAILY', start: iso(now - 92 * d) };
    case '6M': return { interval: 'DAILY', start: iso(now - 183 * d) };
    case 'YTD': return { interval: 'DAILY', start: `${new Date().getFullYear()}-01-01` };
    case '1Y': return { interval: 'DAILY', start: iso(now - 366 * d) };
    case '5Y': return { interval: 'WEEKLY', start: iso(now - 5 * 366 * d) };
  }
}
const candles = (p: any): Pt[] => (Array.isArray(p?.data) ? p.data : p?.candles || []).map((k: any) => ({ t: Date.parse(k.st || k.t || k.time), o: +k.o, h: +k.h, l: +k.l, c: +k.c })).filter((x: Pt) => isFinite(x.c) && isFinite(x.t));

async function pluangSeries(sym: string, rk: RangeKey): Promise<Series> {
  const ttl = TTL[rk];
  if (isIdx(sym)) { // Indonesian stocks (Stockbit-style stats: lots, value, average, market cap)
    const code = sym.slice(0, 4);
    const [px, oh] = await Promise.all([pluang('indo_stocks_get_price', { symbols: [code] }, 15_000), pluang('indo_stocks_get_ohlc', { symbol: code, ...ohlcWindow(rk, false, true) }, ttl)]);
    const row = px?.data?.find((r: any) => r.symbol === code);
    if (!row) throw new Error(`${code} is not available on Pluang`);
    let pts = candles(oh);
    if (rk === '1D' && pts.length) { const lastDay = new Date(pts[pts.length - 1].t + 7 * 3600e3).toISOString().slice(0, 10); pts = pts.filter((p) => new Date(p.t + 7 * 3600e3).toISOString().slice(0, 10) === lastDay); }
    const price = row.lastPrice, prev = row.prevClosePrice || null, st = row.stats || {};
    return { sym, price, prevClose: prev, change: prev ? price - prev : null, changePct: prev ? price / prev - 1 : null, rangeChangePct: pts[0] ? price / pts[0].c - 1 : null,
      points: pts, currency: 'IDR', open: row.openPrice, dayHigh: row.highPrice, dayLow: row.lowPrice, updatedAt: Date.now(), source: 'Pluang',
      stats: { volume: st.vol, lots: st.lot, turnover: st.turnover, avg: st.avg, marketCap: st.market_cap } };
  }
  if (sym === 'USDIDR=X' || sym in PLUANG_CRYPTO) {
    const coin = sym === 'USDIDR=X' ? 'USDT' : PLUANG_CRYPTO[sym];
    const w = ohlcWindow(rk, true);
    const [px, oh, usdt] = await Promise.all([
      pluang('crypto_get_price', { symbols: [coin, 'USDT'] }, 30_000),
      pluang('crypto_get_ohlc', { symbol: coin, ...w }, ttl),
      coin === 'USDT' ? Promise.resolve(null) : pluang('crypto_get_ohlc', { symbol: 'USDT', ...w }, ttl).catch(() => null),
    ]);
    const rows = px?.data || [];
    const idr = rows.find((r: any) => r.symbol === coin)?.midPrice, usdtIdr = rows.find((r: any) => r.symbol === 'USDT')?.midPrice;
    let pts = candles(oh);
    const toUsd = coin !== 'USDT';
    if (toUsd && usdtIdr) { // convert IDR candles to USD with the USDT/IDR rate at each point
      const u = usdt ? candles(usdt) : [];
      pts = pts.map((p) => { const r = nearest(u, p.t)?.c || usdtIdr; return { t: p.t, o: p.o && p.o / r, h: p.h && p.h / r, l: p.l && p.l / r, c: p.c / r }; });
    }
    if (!idr) throw new Error('No price');
    const price = toUsd ? idr / usdtIdr : idr;
    if (rk === '1D' && pts.length && pts[pts.length - 1].t < Date.now() - 2 * 864e5) pts = [];
    const dayAgo = nearest(pts, Date.now() - 864e5);
    const prev = rk === '1D' ? pts[0]?.c ?? null : dayAgo?.c ?? null;
    return { sym, price, prevClose: prev, change: prev ? price - prev : null, changePct: prev ? price / prev - 1 : null, rangeChangePct: pts[0] ? price / pts[0].c - 1 : null,
      points: pts.length ? [...pts.slice(0, -1), { ...pts[pts.length - 1], c: price }] : [], currency: toUsd ? 'USD' : 'IDR', updatedAt: Date.now(), source: 'Pluang',
      note: sym === 'USDIDR=X' ? 'Approximated by USDT/IDR on Pluang' : 'Pluang price (IDR) converted with USDT/IDR' };
  }
  const w = ohlcWindow(rk, false);
  const [px, oh] = await Promise.all([pluang('us_stocks_get_price', { symbols: [sym] }, 30_000), pluang('us_stocks_get_ohlc', { symbol: sym, ...w }, ttl)]);
  const row = px?.data?.find((r: any) => r.symbol === sym);
  if (!row) throw new Error(`${sym} is not available on Pluang`);
  let pts = candles(oh);
  if (rk === '1D' && pts.length) { const lastDay = nyDay(pts[pts.length - 1].t); pts = pts.filter((p) => nyDay(p.t) === lastDay); }
  const price = row.midPrice, prev = row.prevClosePrice || null;
  return { sym, price, prevClose: prev, change: prev ? price - prev : null, changePct: prev ? price / prev - 1 : null, rangeChangePct: pts[0] ? price / pts[0].c - 1 : null,
    points: pts, currency: 'USD', open: row.openPrice, dayHigh: row.highPrice, dayLow: row.lowPrice, updatedAt: Date.now(), source: 'Pluang', marketOpen: px?.marketStatus?.isMarketOpen };
}

/* ---------- Alpaca Market Data (data.alpaca.markets) ---------- */
const ALP = 'https://data.alpaca.markets';
const ALP_TF: Record<RangeKey, { tf: string; days: number }> = {
  '1D': { tf: '5Min', days: 4 }, '5D': { tf: '30Min', days: 8 }, '1M': { tf: '1Day', days: 31 }, '3M': { tf: '1Day', days: 92 },
  '6M': { tf: '1Day', days: 183 }, YTD: { tf: '1Day', days: 0 }, '1Y': { tf: '1Day', days: 366 }, '5Y': { tf: '1Week', days: 5 * 366 },
};
export const alpacaCan = (sym: string) => /^[A-Z]{1,5}$/.test(sym) || /^[A-Z]{2,6}-USD$/.test(sym);
async function alpacaGet(path: string, creds: AlpacaCreds | null) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (creds) { headers['APCA-API-KEY-ID'] = creds.apiKey; headers['APCA-API-SECRET-KEY'] = creds.secret; }
  const r = await limited(() => request(ALP + path, { headers, timeoutMs: 12000 }));
  if (r.status === 401 || r.status === 403) throw new Error('Alpaca rejected the key (Connections → Alpaca)');
  if (r.status >= 400) throw new Error(`Alpaca HTTP ${r.status}`);
  return JSON.parse(r.text);
}
async function alpacaSeries(sym: string, rk: RangeKey): Promise<Series> {
  if (!alpacaCan(sym)) throw new Error(`${sym} isn't on Alpaca (US stocks/ETFs and crypto only)`);
  const creds = await getJSONSecret<AlpacaCreds>('alpaca').catch(() => null);
  const { tf, days } = ALP_TF[rk];
  const start = rk === 'YTD' ? `${new Date().getFullYear()}-01-01T00:00:00Z` : new Date(Date.now() - days * 864e5).toISOString();
  const isCrypto = sym.endsWith('-USD');
  const a = isCrypto ? sym.replace('-', '/') : sym;
  let bars: any[] = [], snap: any;
  if (isCrypto) { // crypto market data needs no key
    const [b, s] = await Promise.all([
      alpacaGet(`/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(a)}&timeframe=${tf}&start=${encodeURIComponent(start)}&limit=10000`, creds),
      alpacaGet(`/v1beta3/crypto/us/snapshots?symbols=${encodeURIComponent(a)}`, creds),
    ]);
    bars = b?.bars?.[a] || []; snap = s?.snapshots?.[a];
  } else {
    if (!creds) throw new Error('Add your Alpaca key in Connections to chart US stocks from Alpaca');
    const [b, s] = await Promise.all([
      alpacaGet(`/v2/stocks/${encodeURIComponent(a)}/bars?timeframe=${tf}&start=${encodeURIComponent(start)}&limit=10000&feed=iex&adjustment=split`, creds),
      alpacaGet(`/v2/stocks/${encodeURIComponent(a)}/snapshot?feed=iex`, creds),
    ]);
    bars = b?.bars || []; snap = s;
  }
  let points: Pt[] = bars.map((x: any) => ({ t: Date.parse(x.t), o: x.o, h: x.h, l: x.l, c: x.c })).filter((p: Pt) => isFinite(p.c));
  if (rk === '1D' && points.length && !isCrypto) { const day = nyDay(points[points.length - 1].t); points = points.filter((p) => nyDay(p.t) === day); }
  if (rk === '1D' && isCrypto) points = points.filter((p) => p.t > Date.now() - 864e5);
  const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? points.at(-1)?.c;
  if (price == null) throw new Error('No price from Alpaca');
  const prev = snap?.prevDailyBar?.c ?? null;
  return { sym, price, prevClose: prev, change: prev ? price - prev : null, changePct: prev ? price / prev - 1 : null,
    rangeChangePct: points[0] ? price / points[0].c - 1 : null, points, currency: 'USD', open: snap?.dailyBar?.o, dayHigh: snap?.dailyBar?.h, dayLow: snap?.dailyBar?.l,
    updatedAt: snap?.latestTrade?.t ? Date.parse(snap.latestTrade.t) : Date.now(), source: 'Alpaca', note: isCrypto ? undefined : 'IEX feed' };
}

function nearest(pts: Pt[], t: number) { let best: Pt | undefined; let d = Infinity; for (const p of pts) { const x = Math.abs(p.t - t); if (x < d) { d = x; best = p; } } return best; }

/** One instrument, with caching. Inside Claude, Pluang is tried first for symbols it covers. */
export function getSeries(sym: string, rk: RangeKey, force = false, source: DataSource = 'auto'): Promise<Series> {
  const key = `${sym}|${rk}|${source}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL[rk]) return hit.p;
  const p = (async () => {
    if (source === 'alpaca') return alpacaSeries(sym, rk);
    if (source === 'pluang') { if (!pluangCan(sym)) throw new Error(`${sym} isn't on Pluang`); return pluangSeries(sym, rk); }
    if (source === 'yahoo') return yahoo(sym, rk);
    // Auto: Pluang first, then (website) Yahoo Finance through FinPlan's server, then TradingView's live chart (USE_TV)
    if (pluangCan(sym) && (await pluangAvailable())) {
      try { return await pluangSeries(sym, rk); } catch { /* next */ }
    }
    if (serverAvailable() || ((window as any).claude && !connectorMarketOff)) { try { return await yahoo(sym, rk); } catch { /* next */ } }
    throw new Error(USE_TV);
  })();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/** Ratio of two instruments (e.g. RSP/SPY), aligned by time. */
export async function getRatio(a: string, b: string, rk: RangeKey, force = false, source: DataSource = 'auto'): Promise<Series> {
  const [A, B] = await Promise.all([getSeries(a, rk, force, source), getSeries(b, rk, force, source)]);
  const points: Pt[] = [];
  for (const p of A.points) { const q = nearest(B.points, p.t); if (q && Math.abs(q.t - p.t) < 3 * 864e5 && q.c) points.push({ t: p.t, c: p.c / q.c }); }
  const price = A.price / B.price;
  const prev = A.prevClose && B.prevClose ? A.prevClose / B.prevClose : null;
  return { sym: `${a}/${b}`, price, prevClose: prev, change: prev ? price - prev : null, changePct: prev ? price / prev - 1 : null,
    rangeChangePct: points[0] ? price / points[0].c - 1 : null, points, updatedAt: Math.min(A.updatedAt, B.updatedAt), source: 'computed', note: `${a} ÷ ${b}` };
}
