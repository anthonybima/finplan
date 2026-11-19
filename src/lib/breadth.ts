/**
 * Breadth heat calendar + sector rotation (Indonesia, US). Pure functions over daily closes.
 * Rotation uses the relative-rotation idea: trend = 20-session return vs the index, momentum = 5-session return vs the index.
 *   Leading (both +) · Weakening (trend +, momentum −) · Lagging (both −) · Improving (trend −, momentum +)
 * Money typically rotates Improving → Leading → Weakening → Lagging.
 */
import type { Pt } from './market';

export interface Group { name: string; syms: string[] }
export interface BreadthMarket { id: 'id' | 'us'; name: string; bench: string; benchName: string; groups: Group[] }

export const BREADTH: BreadthMarket[] = [
  { id: 'id', name: 'Indonesia', bench: '^JKSE', benchName: 'IDX Composite', groups: [
    { name: 'Big banks', syms: ['BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'BBNI.JK', 'BRIS.JK'] },
    { name: 'Telco & tech', syms: ['TLKM.JK', 'ISAT.JK', 'EXCL.JK', 'GOTO.JK', 'BUKA.JK'] },
    { name: 'Consumer', syms: ['UNVR.JK', 'ICBP.JK', 'INDF.JK', 'MYOR.JK', 'AMRT.JK'] },
    { name: 'Coal & energy', syms: ['ADRO.JK', 'PTBA.JK', 'ITMG.JK', 'MEDC.JK', 'PGAS.JK'] },
    { name: 'Metals & mining', syms: ['ANTM.JK', 'INCO.JK', 'MDKA.JK', 'AMMN.JK', 'TINS.JK'] },
    { name: 'Basic materials', syms: ['TPIA.JK', 'BRPT.JK', 'INKP.JK', 'SMGR.JK', 'INTP.JK'] },
    { name: 'Property & infra', syms: ['BSDE.JK', 'CTRA.JK', 'PWON.JK', 'JSMR.JK', 'SMRA.JK'] },
    { name: 'Auto & industrials', syms: ['ASII.JK', 'UNTR.JK', 'AUTO.JK'] },
    { name: 'Healthcare', syms: ['KLBF.JK', 'SIDO.JK', 'MIKA.JK', 'HEAL.JK'] },
    { name: 'Plantation', syms: ['AALI.JK', 'LSIP.JK', 'TAPG.JK', 'DSNG.JK'] },
  ] },
  { id: 'us', name: 'United States', bench: 'SPY', benchName: 'S&P 500 (SPY)', groups: [
    { name: 'Technology', syms: ['XLK'] }, { name: 'Communication', syms: ['XLC'] }, { name: 'Cons. discretionary', syms: ['XLY'] },
    { name: 'Financials', syms: ['XLF'] }, { name: 'Industrials', syms: ['XLI'] }, { name: 'Materials', syms: ['XLB'] },
    { name: 'Energy', syms: ['XLE'] }, { name: 'Health care', syms: ['XLV'] }, { name: 'Cons. staples', syms: ['XLP'] },
    { name: 'Utilities', syms: ['XLU'] }, { name: 'Real estate', syms: ['XLRE'] },
    { name: 'Small caps (IWM)', syms: ['IWM'] }, { name: 'Equal weight (RSP)', syms: ['RSP'] }, { name: 'Nasdaq 100 (QQQ)', syms: ['QQQ'] },
  ] },
];
export const breadthSymbols = (m: BreadthMarket) => [m.bench, ...new Set(m.groups.flatMap((g) => g.syms))];

const dayKey = (t: number, off = 0) => new Date(t + off * 1000).toISOString().slice(0, 10);
/** date → daily return, by the market's own date. */
export function returnsByDate(pts: Pt[], off = 0): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < pts.length; i++) if (pts[i - 1].c > 0) m.set(dayKey(pts[i].t, off), pts[i].c / pts[i - 1].c - 1);
  return m;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const compound = (rs: (number | null)[]) => { const v = rs.filter((x): x is number => x != null); return v.length ? v.reduce((a, r) => a * (1 + r), 1) - 1 : null; };

export type Quadrant = 'Leading' | 'Weakening' | 'Lagging' | 'Improving';
export interface Row { name: string; size: number; cells: (number | null)[]; rel: (number | null)[]; up: (number | null)[]; r5: number | null; r20: number | null; rel5: number | null; rel20: number | null; quadrant: Quadrant | null }
export interface Calendar { dates: string[]; bench: (number | null)[]; breadth: (number | null)[]; rows: Row[]; into: string[]; outOf: string[]; loaded: number; total: number }

/** Build the calendar for the last `n` sessions of the benchmark. */
export function buildCalendar(m: BreadthMarket, series: Record<string, Pt[] | undefined>, offs: Record<string, number>, n = 20): Calendar {
  const R = (s: string) => (series[s]?.length ? returnsByDate(series[s]!, offs[s] ?? 0) : null);
  const B = R(m.bench);
  const dates = B ? [...B.keys()].sort().slice(-Math.max(n, 20)) : [];
  const show = dates.slice(-n);
  const bench = dates.map((d) => B?.get(d) ?? null);
  const stock = new Map<string, Map<string, number> | null>(breadthSymbols(m).map((s) => [s, R(s)]));
  const rows: Row[] = m.groups.map((g) => {
    const per = g.syms.map((s) => stock.get(s)).filter((x): x is Map<string, number> => !!x);
    const all = dates.map((d) => { const v = per.map((x) => x.get(d)).filter((x): x is number => x != null); return v.length ? (mean(v) as number) : null; });
    const up = dates.map((d) => { const v = per.map((x) => x.get(d)).filter((x): x is number => x != null); return v.length ? v.filter((x) => x > 0).length / v.length : null; });
    const rel = all.map((x, i) => (x != null && bench[i] != null ? x - bench[i]! : null));
    const r5 = compound(all.slice(-5)), r20 = compound(all.slice(-20)), b5 = compound(bench.slice(-5)), b20 = compound(bench.slice(-20));
    const rel5 = r5 != null && b5 != null ? r5 - b5 : null, rel20 = r20 != null && b20 != null ? r20 - b20 : null;
    const quadrant: Quadrant | null = rel5 == null || rel20 == null ? null : rel20 >= 0 ? (rel5 >= 0 ? 'Leading' : 'Weakening') : rel5 >= 0 ? 'Improving' : 'Lagging';
    const k = all.length - show.length;
    return { name: g.name, size: per.length, cells: all.slice(k), rel: rel.slice(k), up: up.slice(k), r5, r20, rel5, rel20, quadrant };
  });
  // breadth: share of all loaded members (stocks for Indonesia, sector funds for the US) that rose that day
  const members = [...new Set(m.groups.flatMap((g) => g.syms))].map((s) => stock.get(s)).filter((x): x is Map<string, number> => !!x);
  const breadth = show.map((d) => { const v = members.map((x) => x.get(d)).filter((x): x is number => x != null); return v.length ? v.filter((x) => x > 0).length / v.length : null; });
  const byMom = [...rows].filter((r) => r.rel5 != null).sort((a, b) => b.rel5! - a.rel5!);
  const into = byMom.filter((r) => r.quadrant === 'Improving' || (r.quadrant === 'Leading' && r.rel5! > (r.rel20 ?? 0) / 4)).slice(0, 4).map((r) => r.name);
  const outOf = [...byMom].reverse().filter((r) => r.quadrant === 'Weakening' || r.quadrant === 'Lagging').slice(0, 4).map((r) => r.name);
  rows.sort((a, b) => (b.rel20 ?? -9) - (a.rel20 ?? -9));
  return { dates: show, bench: bench.slice(-show.length), breadth, rows, into, outOf, loaded: members.length, total: breadthSymbols(m).length - 1 };
}
