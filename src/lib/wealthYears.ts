/** Wealth by the year each account was opened / each position was first bought. */
import type { AppData } from './types';
import { valueIDR } from './holdings';

/** "2019", "2019-03", "2019-03-15", "15/03/2019" or 2019 → "2019" (or undefined). */
export function normYear(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const m = String(v).match(/(19[5-9]\d|20\d\d)/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y <= new Date().getFullYear() ? m[1] : undefined;
}
export const yearOf = (opened?: string) => (opened ? Number(opened.slice(0, 4)) : undefined);

/** "3 yrs", "8 mo", "new" */
export function ageLabel(opened?: string, now = new Date()): string {
  if (!opened) return '—';
  const y = Number(opened.slice(0, 4)), m = opened.length >= 7 ? Number(opened.slice(5, 7)) - 1 : 0;
  const months = (now.getFullYear() - y) * 12 + (now.getMonth() - m);
  if (months < 1) return 'new';
  if (months < 12 && opened.length >= 7) return `${months} mo`;
  const yrs = now.getFullYear() - y;
  return yrs < 1 ? '< 1 yr' : `${yrs} yr${yrs === 1 ? '' : 's'}`;
}

export interface YearRow { year: number | 'unknown'; assets: number; debt: number; count: number; names: string[] }

/** Current values grouped by year opened. Holdings are counted individually (their synced account totals are skipped). */
export function wealthByYear(d: AppData): YearRow[] {
  const m = new Map<number | 'unknown', YearRow>();
  const add = (yr: number | undefined, v: number, debt: boolean, name: string) => {
    const k = yr ?? 'unknown';
    const r = m.get(k) || { year: k, assets: 0, debt: 0, count: 0, names: [] };
    if (debt) r.debt += v; else r.assets += v;
    r.count++; if (r.names.length < 6) r.names.push(name);
    m.set(k, r);
  };
  for (const a of d.accounts) if (!a.synced) add(yearOf(a.opened), a.balance, a.kind === 'debt', a.name);
  for (const h of d.holdings) if (!h.excluded) add(yearOf(h.opened), valueIDR(h, d.settings.usdIdr), false, h.symbol);
  return [...m.values()].sort((a, b) => (a.year === 'unknown' ? 1 : b.year === 'unknown' ? -1 : a.year - b.year));
}
