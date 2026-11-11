import type { Account, AppData, Txn } from './types';
import { NEEDS } from './types';
import { addDays, monthKey, today } from './format';

export const isLiquid = (a: Account) => a.kind === 'cash' || a.kind === 'bank' || a.kind === 'ewallet' ||
  (a.kind === 'investment' && (a.assetClass === 'cash' || a.assetClass === 'deposit'));

export function balances(accounts: Account[]) {
  let assets = 0, liabilities = 0, liquid = 0, invested = 0, debtPayments = 0;
  for (const a of accounts) {
    if (a.kind === 'debt') { liabilities += a.balance; debtPayments += a.monthlyPayment || 0; continue; }
    assets += a.balance;
    if (isLiquid(a)) liquid += a.balance;
    if (a.kind === 'investment' || a.kind === 'asset') invested += a.balance;
  }
  return { assets, liabilities, netWorth: assets - liabilities, liquid, invested, debtPayments };
}

export interface MonthRow { month: string; income: number; expense: number; net: number; needs: number; wants: number }

export function monthly(txns: Txn[], months = 12): MonthRow[] {
  const map = new Map<string, MonthRow>();
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(k, { month: k, income: 0, expense: 0, net: 0, needs: 0, wants: 0 });
  }
  for (const t of txns) {
    const row = map.get(monthKey(t.date));
    if (!row || t.type === 'transfer') continue;
    if (t.type === 'income') row.income += t.amount;
    else { row.expense += t.amount; if (NEEDS.has(t.category)) row.needs += t.amount; else row.wants += t.amount; }
  }
  for (const r of map.values()) r.net = r.income - r.expense;
  return [...map.values()];
}

/** Average of the last N *complete* months that have data (falls back to the current month). */
export function averages(txns: Txn[], n = 3) {
  const rows = monthly(txns, n + 1);
  const complete = rows.slice(0, -1).filter((r) => r.income || r.expense);
  const use = complete.length ? complete : rows.slice(-1);
  const k = use.length || 1;
  const income = use.reduce((s, r) => s + r.income, 0) / k;
  const expense = use.reduce((s, r) => s + r.expense, 0) / k;
  const needs = use.reduce((s, r) => s + r.needs, 0) / k;
  const wants = use.reduce((s, r) => s + r.wants, 0) / k;
  return { income, expense, needs, wants, savings: income - expense, savingsRate: income > 0 ? (income - expense) / income : 0, monthsUsed: use.length };
}

export function byCategory(txns: Txn[], from: string, to: string, type: 'expense' | 'income' = 'expense') {
  const m = new Map<string, number>();
  for (const t of txns) if (t.type === type && t.date >= from && t.date <= to) m.set(t.category, (m.get(t.category) || 0) + t.amount);
  return [...m.entries()].map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value);
}

export function monthRange(offset = 0) {
  const n = new Date();
  const s = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const e = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(s), to: f(e), daysInMonth: e.getDate(), dayOfMonth: offset === 0 ? n.getDate() : e.getDate() };
}

export function budgetStatus(d: AppData) {
  const { from, to, daysInMonth, dayOfMonth } = monthRange(0);
  const spent = new Map(byCategory(d.txns, from, to).map((c) => [c.category, c.value]));
  return d.budgets.map((b) => {
    const s = spent.get(b.category) || 0;
    const projected = dayOfMonth > 0 ? (s / dayOfMonth) * daysInMonth : s;
    return { ...b, spent: s, pct: b.limit ? s / b.limit : 0, projected, remaining: b.limit - s };
  }).sort((a, b) => b.pct - a.pct);
}

export function lastNDays(txns: Txn[], days: number) {
  const from = addDays(today(), -days + 1);
  let income = 0, expense = 0;
  for (const t of txns) if (t.date >= from) { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; }
  return { income, expense, from };
}

/** Simple linear-trend forecast for the next k months of expense. */
export function forecast(rows: MonthRow[], k = 3) {
  const pts = rows.filter((r) => r.income || r.expense).slice(-6);
  if (pts.length < 2) return [];
  const xs = pts.map((_, i) => i), n = pts.length;
  const fit = (ys: number[]) => {
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1;
    const b = num / den; return (x: number) => Math.max(0, my + b * (x - mx));
  };
  const fe = fit(pts.map((p) => p.expense)), fi = fit(pts.map((p) => p.income));
  const last = pts[pts.length - 1].month;
  const out = [];
  for (let i = 1; i <= k; i++) {
    const [y, m] = last.split('-').map(Number);
    const d = new Date(y, m - 1 + i, 1);
    out.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, income: fi(n - 1 + i), expense: fe(n - 1 + i) });
  }
  return out;
}

/** Detect spending anomalies: categories this month far above their 3-month average. */
export function anomalies(txns: Txn[]) {
  const cur = monthRange(0), prev = [monthRange(-1), monthRange(-2), monthRange(-3)];
  const now = new Map(byCategory(txns, cur.from, cur.to).map((c) => [c.category, c.value]));
  const avg = new Map<string, number>();
  for (const p of prev) for (const c of byCategory(txns, p.from, p.to)) avg.set(c.category, (avg.get(c.category) || 0) + c.value / 3);
  const res: { category: string; current: number; average: number; ratio: number }[] = [];
  const scale = cur.daysInMonth / Math.max(1, cur.dayOfMonth);
  for (const [c, v] of now) {
    const a = avg.get(c) || 0;
    const projected = v * scale;
    if (a > 0 && projected > a * 1.3 && projected - a > 100000) res.push({ category: c, current: v, average: a, ratio: projected / a });
  }
  return res.sort((a, b) => b.ratio - a.ratio);
}
