/**
 * Market recap: everything is computed on the device from one daily 1-year series per symbol.
 * Index vs MSCI: ETF return ≈ (1 + index return) × (1 + local currency vs USD) − 1; what is left is composition/tracking.
 */
import type { Pt } from './market';
import { ASIA_MSCI, EUROPE_MSCI, findInstrument, type MsciPair } from './marketCatalog';

export type Period = '1D' | '5D' | '1M' | '3M' | 'YTD' | '1Y';
export const PERIODS: Period[] = ['1D', '5D', '1M', '3M', 'YTD', '1Y'];

/** Local currency per index, and the Yahoo FX symbol giving it. inv = the symbol is USD→local (USDJPY), so USD per local = 1/x. */
const CCY: Record<string, [string, string, boolean]> = {
  '^JKSE': ['IDR', 'IDR=X', true], '^N225': ['JPY', 'JPY=X', true], '^HSI': ['HKD', 'HKD=X', true], '000001.SS': ['CNY', 'CNY=X', true],
  '^KS11': ['KRW', 'KRW=X', true], '^TWII': ['TWD', 'TWD=X', true], '^STI': ['SGD', 'SGD=X', true], '^AXJO': ['AUD', 'AUDUSD=X', false],
  '^NSEI': ['INR', 'INR=X', true], '^KLSE': ['MYR', 'MYR=X', true], '^SET.BK': ['THB', 'THB=X', true], 'PSEI.PS': ['PHP', 'PHP=X', true],
  '^STOXX': ['EUR', 'EURUSD=X', false], '^STOXX50E': ['EUR', 'EURUSD=X', false], '^GDAXI': ['EUR', 'EURUSD=X', false], '^FCHI': ['EUR', 'EURUSD=X', false],
  '^FTSE': ['GBP', 'GBPUSD=X', false], 'FTSEMIB.MI': ['EUR', 'EURUSD=X', false], '^IBEX': ['EUR', 'EURUSD=X', false], '^AEX': ['EUR', 'EURUSD=X', false],
  '^SSMI': ['CHF', 'CHF=X', true], '^OMX': ['SEK', 'SEK=X', true], '^BFX': ['EUR', 'EURUSD=X', false],
};
/** US benchmarks vs MSCI's global indexes (via iShares ETFs). */
export const GLOBAL: [string, string][] = [['S&P 500', '^GSPC'], ['Nasdaq', '^IXIC'], ['Dow Jones', '^DJI'], ['MSCI World', 'URTH'], ['MSCI ACWI', 'ACWI'], ['MSCI EAFE', 'EFA'], ['MSCI Emerging', 'EEM'], ['MSCI Emerging IMI', 'IEMG'], ['MSCI EM ex China', 'EMXC'], ['MSCI Frontier & Select EM', 'FM']];
export const MACRO: [string, string][] = [['Gold', 'GC=F'], ['Brent', 'BZ=F'], ['Copper', 'HG=F'], ['USD/IDR', 'USDIDR=X'], ['Dollar index', 'DX-Y.NYB'], ['Bitcoin', 'BTC-USD']];
export const REGIONS: { id: 'asia' | 'europe'; name: string; pairs: MsciPair[] }[] = [{ id: 'asia', name: 'Asia Pacific', pairs: ASIA_MSCI }, { id: 'europe', name: 'Europe', pairs: EUROPE_MSCI }];

/** Every symbol the recap needs. */
export function recapSymbols(): string[] {
  const s = new Set<string>();
  for (const r of REGIONS) for (const [, i, e] of r.pairs) { s.add(i); s.add(e); s.add(CCY[i][1]); }
  for (const [, x] of [...GLOBAL, ...MACRO]) s.add(x);
  return [...s];
}

const DAY = 864e5;
/** Return over a period from daily closes (last point = latest). null when the series is too short. */
export function periodReturn(pts: Pt[], p: Period, now = Date.now()): number | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1].c;
  let base: number | undefined;
  if (p === '1D') base = pts[pts.length - 2].c;
  else if (p === '5D') base = pts[Math.max(0, pts.length - 6)].c;
  else if (p === 'YTD') { const y0 = new Date(new Date(now).getFullYear(), 0, 1).getTime(); const before = pts.filter((x) => x.t < y0); base = before.length ? before[before.length - 1].c : pts[0].c; }
  else {
    const t0 = now - (p === '1M' ? 30 : p === '3M' ? 91 : 365) * DAY;
    base = (pts.find((x) => x.t >= t0) || pts[0]).c;
  }
  return base ? last / base - 1 : null;
}

const sma = (pts: Pt[], n: number) => (pts.length >= n ? pts.slice(-n).reduce((s, x) => s + x.c, 0) / n : null);
export type Trend = 'Uptrend' | 'Downtrend' | 'Mixed';
/** Price vs its 50- and 200-day averages. */
export function trendOf(pts: Pt[]): { trend: Trend; vs50: number | null; vs200: number | null } {
  const last = pts.at(-1)?.c; const a50 = sma(pts, 50), a200 = sma(pts, Math.min(200, pts.length >= 150 ? pts.length : 200));
  if (!last || !a50) return { trend: 'Mixed', vs50: null, vs200: null };
  const vs50 = last / a50 - 1, vs200 = a200 ? last / a200 - 1 : null;
  const trend: Trend = a200 && last > a50 && a50 > a200 ? 'Uptrend' : a200 && last < a50 && a50 < a200 ? 'Downtrend' : 'Mixed';
  return { trend, vs50, vs200 };
}
/** Daily % changes for the last n sessions, oldest first, with their dates. */
export function lastSessions(pts: Pt[], n = 5): { t: number; r: number }[] {
  const out: { t: number; r: number }[] = [];
  for (let i = Math.max(1, pts.length - n); i < pts.length; i++) out.push({ t: pts[i].t, r: pts[i].c / pts[i - 1].c - 1 });
  return out;
}

export interface PairRow {
  market: string; index: string; etf: string; ccy: string;
  idx: number | null; fx: number | null; etfR: number | null; expected: number | null; residual: number | null; gap: number | null;
  trendIdx: Trend; trendEtf: Trend;
}
export interface Mover { sym: string; name: string; r: number; kind: 'index' | 'msci' | 'global' | 'macro' }
export interface Recap { period: Period; regions: { id: string; name: string; rows: PairRow[]; avgIdx: number | null; avgEtf: number | null }[]; global: Mover[]; macro: Mover[]; movers: Mover[]; takeaways: string[]; missing: string[] }

const usdPerLocal = (fx: number | null, inv: boolean) => (fx == null ? null : inv ? 1 / (1 + fx) - 1 : fx); // fx = change of the Yahoo FX quote
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const pct = (x: number | null | undefined, d = 1) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const short = (sym: string) => findInstrument(sym).name.replace(/ \(.*\)$/, '').replace(/^iShares (Core )?MSCI /, 'MSCI ');

export function buildRecap(series: Record<string, Pt[]>, period: Period, now = Date.now()): Recap {
  const R = (sym: string) => (series[sym]?.length ? periodReturn(series[sym], period, now) : null);
  const T = (sym: string) => (series[sym]?.length ? trendOf(series[sym]).trend : 'Mixed');
  const missing = recapSymbols().filter((s) => !series[s]?.length);
  const regions = REGIONS.map((reg) => {
    const rows: PairRow[] = reg.pairs.map(([market, index, etf]) => {
      const [ccy, fxSym, inv] = CCY[index];
      const idx = R(index), etfR = R(etf), fx = usdPerLocal(R(fxSym), inv);
      const expected = idx != null && fx != null ? (1 + idx) * (1 + fx) - 1 : null;
      return { market, index, etf, ccy, idx, fx, etfR, expected, residual: etfR != null && expected != null ? etfR - expected : null, gap: etfR != null && idx != null ? etfR - idx : null, trendIdx: T(index), trendEtf: T(etf) };
    });
    return { id: reg.id, name: reg.name, rows, avgIdx: avg(rows.map((r) => r.idx)), avgEtf: avg(rows.map((r) => r.etfR)) };
  });
  const mk = (list: [string, string][], kind: Mover['kind']): Mover[] => list.map(([name, sym]) => ({ sym, name, r: R(sym) as number, kind })).filter((m) => m.r != null);
  const global = mk(GLOBAL, 'global'), macro = mk(MACRO, 'macro');
  const movers: Mover[] = [
    ...regions.flatMap((g) => g.rows.flatMap((r) => [r.idx != null ? { sym: r.index, name: `${short(r.index)} (${r.market})`, r: r.idx, kind: 'index' as const } : null, r.etfR != null ? { sym: r.etf, name: `${r.etf} · ${r.market}`, r: r.etfR, kind: 'msci' as const } : null]).filter(Boolean) as Mover[]),
    ...global,
  ].sort((a, b) => b.r - a.r);

  // ---- key takeaways (plain language, only from the numbers above) ----
  const t: string[] = [];
  const idxRows = regions.flatMap((g) => g.rows).filter((r) => r.idx != null).sort((a, b) => b.idx! - a.idx!);
  if (idxRows.length) {
    const up = idxRows.filter((r) => r.idx! > 0).length;
    t.push(`${up} of ${idxRows.length} Asia Pacific and European indexes rose over ${period}. Leader: ${idxRows[0].market} (${short(idxRows[0].index)} ${pct(idxRows[0].idx)}); laggard: ${idxRows.at(-1)!.market} (${short(idxRows.at(-1)!.index)} ${pct(idxRows.at(-1)!.idx)}).`);
  }
  const [a, e] = regions;
  if (a.avgIdx != null && e.avgIdx != null) t.push(`${Math.abs(a.avgIdx - e.avgIdx) < 0.001 ? 'Asia Pacific and Europe moved alike' : `${a.avgIdx > e.avgIdx ? 'Asia Pacific' : 'Europe'} outperformed`}: average index ${pct(a.avgIdx)} in Asia Pacific vs ${pct(e.avgIdx)} in Europe (in local currencies).`);
  const sp = global.find((g) => g.sym === '^GSPC'), w = global.find((g) => g.sym === 'URTH'), em = global.find((g) => g.sym === 'EEM');
  const fm = global.find((g) => g.sym === 'FM');
  if (em && fm) t.push(`Emerging vs frontier: MSCI Emerging ${pct(em.r)}, MSCI Frontier & Select EM ${pct(fm.r)}${w ? `, MSCI World ${pct(w.r)}` : ''}.`);
  if (sp && w) t.push(`US vs world: S&P 500 ${pct(sp.r)} vs MSCI World ${pct(w.r)}${em ? ` and MSCI Emerging ${pct(em.r)}` : ''}. ${Math.abs(sp.r - w.r) < 0.003 ? 'Moving together.' : sp.r > w.r ? 'The US led the rest of the world.' : 'Markets outside the US did better.'}`);
  const withFx = regions.flatMap((g) => g.rows).filter((r) => r.gap != null && r.fx != null);
  if (withFx.length) {
    const fxDriven = withFx.filter((r) => Math.abs(r.gap!) > 0.001 && Math.abs(r.fx!) >= Math.abs(r.residual ?? 0));
    const lag = withFx.filter((r) => r.gap! < 0).length;
    t.push(`MSCI funds (in USD) trailed their local index in ${lag} of ${withFx.length} markets. The currency explains most of the gap in ${fxDriven.length} of ${withFx.filter((r) => Math.abs(r.gap!) > 0.001).length} markets with a gap; the rest comes from what the fund holds (sector weights, large caps only, fees).`);
    const big = [...withFx].sort((x, y) => Math.abs(y.gap!) - Math.abs(x.gap!))[0];
    if (big && Math.abs(big.gap!) > 0.005) t.push(`Widest gap: ${big.market}, ${short(big.index)} ${pct(big.idx)} vs ${big.etf} ${pct(big.etfR)}; ${big.ccy} ${big.fx! >= 0 ? 'gained' : 'lost'} ${pct(Math.abs(big.fx!)).slice(1)} against the dollar.`);
  }
  const ups = idxRows.filter((r) => r.trendIdx === 'Uptrend').map((r) => r.market), downs = idxRows.filter((r) => r.trendIdx === 'Downtrend').map((r) => r.market);
  if (ups.length || downs.length) t.push(`Trend (price vs 50/200-day averages): uptrend in ${ups.length ? ups.join(', ') : 'none'}; downtrend in ${downs.length ? downs.join(', ') : 'none'}.`);
  const gold = macro.find((m) => m.sym === 'GC=F'), oil = macro.find((m) => m.sym === 'BZ=F'), idr = macro.find((m) => m.sym === 'USDIDR=X');
  const mac = [gold && `gold ${pct(gold.r)}`, oil && `Brent ${pct(oil.r)}`, idr && `USD/IDR ${pct(idr.r)}${idr.r > 0 ? ' (rupiah weaker)' : idr.r < 0 ? ' (rupiah stronger)' : ''}`].filter(Boolean);
  if (mac.length) t.push(`Macro: ${mac.join(', ')}.`);
  return { period, regions, global, macro, movers, takeaways: t, missing };
}

/* ---------- lead–lag: does the MSCI fund (US session) foreshadow the local index's next session? ---------- */
const dayKey = (t: number, off = 0) => new Date(t + off * 1000).toISOString().slice(0, 10);
/** Daily returns keyed by the market's own date. */
export function dailyByDate(pts: Pt[], off = 0): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < pts.length; i++) if (pts[i - 1].c) m.set(dayKey(pts[i].t, off), pts[i].c / pts[i - 1].c - 1);
  return m;
}
function corr(x: number[], y: number[]) {
  const n = x.length; if (n < 20) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? { r: sxy / Math.sqrt(sxx * syy), beta: sxy / sxx, n } : null;
}
export interface LeadLag {
  market: string; index: string; etf: string; n: number;
  sameDay: number | null;   // corr(index d, MSCI d): MSCI reacting to the index session that closed before it
  nextDay: number | null;   // corr(MSCI d, index next session): MSCI leading the index
  beta: number | null;      // index next session ≈ beta × MSCI move
  hit: number | null; bigDays: number; // on days MSCI moved ≥ 1%: share where the index followed in the same direction
  follow: number | null;    // average index next-session move per +1% MSCI move on those big days
  signal: { date: string; etf: number; expected: number } | null; // latest MSCI session the index hasn't traded after yet
}
export function leadLag(market: string, index: string, etf: string, idxPts: Pt[], idxOff: number, etfPts: Pt[], etfOff: number): LeadLag {
  const I = dailyByDate(idxPts, idxOff), E = dailyByDate(etfPts, etfOff);
  const idxDates = [...I.keys()].sort();
  const nextIdx = (d: string) => { for (const k of idxDates) if (k > d) return k; return null; };
  const same: [number, number][] = [], lead: [number, number][] = [];
  for (const [d, e] of E) {
    const i = I.get(d); if (i != null) same.push([i, e]);
    const k = nextIdx(d); if (k) lead.push([e, I.get(k)!]);
  }
  const cs = corr(same.map((x) => x[0]), same.map((x) => x[1])), cl = corr(lead.map((x) => x[0]), lead.map((x) => x[1]));
  const big = lead.filter(([e]) => Math.abs(e) >= 0.01);
  const hit = big.length ? big.filter(([e, i]) => Math.sign(e) === Math.sign(i)).length / big.length : null;
  const follow = big.length ? big.reduce((s, [e, i]) => s + i / e, 0) / big.length : null;
  const lastE = [...E.keys()].sort().at(-1), lastI = idxDates.at(-1);
  const signal = lastE && lastI && lastE >= lastI && cl ? { date: lastE, etf: E.get(lastE)!, expected: cl.beta * E.get(lastE)! } : null;
  return { market, index, etf, n: lead.length, sameDay: cs?.r ?? null, nextDay: cl?.r ?? null, beta: cl?.beta ?? null, hit, bigDays: big.length, follow, signal };
}
