import type { Account, AppData, AssetClass, Goal, RiskAnswers } from './types';
import { averages, balances } from './analytics';
import { monthsBetween, today } from './format';

/** Long-run annual assumptions (Indonesia context, IDR). Editable starting points, not forecasts. */
export const ASSUMPTIONS: Record<AssetClass, { label: string; ret: number; vol: number; crash: number }> = {
  cash:       { label: 'Cash / savings',       ret: 0.01,  vol: 0.00, crash: 0.00 },
  deposit:    { label: 'Time deposit / RDPU',  ret: 0.045, vol: 0.01, crash: 0.00 },
  bond:       { label: 'Bonds (SBN / ORI / SR)', ret: 0.065, vol: 0.05, crash: -0.08 },
  mutualfund: { label: 'Mixed mutual fund',    ret: 0.075, vol: 0.12, crash: -0.25 },
  stock:      { label: 'Stocks (IHSG / global)', ret: 0.10,  vol: 0.20, crash: -0.40 },
  gold:       { label: 'Gold',                 ret: 0.07,  vol: 0.15, crash: -0.10 },
  property:   { label: 'Property',             ret: 0.05,  vol: 0.08, crash: -0.15 },
  crypto:     { label: 'Crypto',               ret: 0.15,  vol: 0.70, crash: -0.70 },
};
const CLASSES = Object.keys(ASSUMPTIONS) as AssetClass[];

// Simplified correlation groups
function corr(a: AssetClass, b: AssetClass) {
  if (a === b) return 1;
  const risky = new Set<AssetClass>(['stock', 'mutualfund', 'crypto', 'property']);
  if (a === 'gold' || b === 'gold') return 0.05;
  if (risky.has(a) && risky.has(b)) return a === 'crypto' || b === 'crypto' ? 0.35 : 0.7;
  if ((a === 'bond' && risky.has(b)) || (b === 'bond' && risky.has(a))) return 0.2;
  return 0.1;
}

export function classOf(a: Account): AssetClass | null {
  if (a.kind === 'debt') return null;
  if (a.kind === 'investment' || a.kind === 'asset') return a.assetClass || 'stock';
  return 'cash';
}

export function allocation(accounts: Account[]) {
  const m = new Map<AssetClass, number>();
  for (const a of accounts) { const c = classOf(a); if (c && a.balance > 0) m.set(c, (m.get(c) || 0) + a.balance); }
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  return { total, rows: CLASSES.filter((c) => m.get(c)).map((c) => ({ cls: c, label: ASSUMPTIONS[c].label, value: m.get(c)!, weight: total ? m.get(c)! / total : 0 })) };
}

export function portfolioStats(accounts: Account[]) {
  const { total, rows } = allocation(accounts);
  let mu = 0, v = 0;
  for (const a of rows) mu += a.weight * ASSUMPTIONS[a.cls].ret;
  for (const a of rows) for (const b of rows)
    v += a.weight * b.weight * ASSUMPTIONS[a.cls].vol * ASSUMPTIONS[b.cls].vol * corr(a.cls, b.cls);
  const sigma = Math.sqrt(v);
  // Parametric 1-year VaR / CVaR (normal approx.)
  const var95 = Math.max(0, -(mu - 1.645 * sigma)) * total;
  const var99 = Math.max(0, -(mu - 2.326 * sigma)) * total;
  const cvar95 = Math.max(0, -(mu - sigma * (Math.exp(-(1.645 ** 2) / 2) / Math.sqrt(2 * Math.PI)) / 0.05)) * total;
  const crashLoss = -rows.reduce((s, a) => s + a.value * ASSUMPTIONS[a.cls].crash, 0);
  const hhi = rows.reduce((s, a) => s + a.weight ** 2, 0);
  const largest = rows.reduce((m, a) => (a.weight > m.weight ? a : m), { cls: 'cash' as AssetClass, label: '-', value: 0, weight: 0 });
  const sharpe = sigma > 0 ? (mu - 0.045) / sigma : 0;
  return { total, rows, mu, sigma, var95, var99, cvar95, crashLoss, hhi, largest, sharpe };
}

/** Interest-rate / inflation / currency shocks applied to the whole balance sheet. */
export function stressTests(d: AppData) {
  const b = balances(d.accounts);
  const alloc = allocation(d.accounts);
  const w = (c: AssetClass) => alloc.rows.find((r) => r.cls === c)?.value || 0;
  const avg = averages(d.txns);
  const floatingDebt = d.accounts.filter((a) => a.kind === 'debt').reduce((s, a) => s + a.balance, 0);
  return [
    { name: 'Market crash (2008-style)', impact: -portfolioStats(d.accounts).crashLoss, note: 'Stocks −40%, funds −25%, crypto −70%, property −15%' },
    { name: 'Crypto winter', impact: -w('crypto') * 0.75, note: 'Crypto −75%' },
    { name: 'Rates +2% (BI rate hike)', impact: -w('bond') * 0.1 - floatingDebt * 0.02, note: 'Bond prices −10%, +2%/yr on floating debt' },
    { name: 'Job loss for 6 months', impact: -avg.expense * 6, note: 'No income, expenses continue' },
    { name: 'Inflation 8% for a year', impact: -(avg.expense * 12 * 0.08) - b.liquid * 0.07, note: 'Costs rise, cash loses purchasing power' },
    { name: 'Medical emergency', impact: -Math.max(50_000_000, avg.expense * 3), note: 'Uninsured hospital bill' },
  ].map((s) => ({ ...s, pctOfNetWorth: b.netWorth > 0 ? s.impact / b.netWorth : 0, survivable: b.liquid + s.impact > 0 }));
}

/** Gaussian random via Box–Muller */
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** Monte Carlo: probability a goal is reached by its date with monthly contributions. */
export function goalMonteCarlo(g: Goal, sims = 2000) {
  const months = Math.max(1, Math.round(monthsBetween(today(), g.targetDate)));
  const { ret, vol } = ASSUMPTIONS[g.assetClass];
  const mu = Math.log(1 + ret) / 12 - (vol * vol) / 24, s = vol / Math.sqrt(12);
  const finals: number[] = [];
  let hit = 0;
  for (let i = 0; i < sims; i++) {
    let v = g.current;
    for (let m = 0; m < months; m++) v = v * Math.exp(mu + s * randn()) + g.monthlyContribution;
    finals.push(v); if (v >= g.target) hit++;
  }
  finals.sort((a, b) => a - b);
  const q = (p: number) => finals[Math.floor(p * (finals.length - 1))];
  // Required monthly contribution at expected return to hit the target
  const r = ret / 12;
  const fvCurrent = g.current * (1 + r) ** months;
  const factor = r > 0 ? ((1 + r) ** months - 1) / r : months;
  const required = Math.max(0, (g.target - fvCurrent) / factor);
  return { probability: hit / sims, p10: q(0.1), p50: q(0.5), p90: q(0.9), months, required };
}

/** Risk-profile questionnaire → score 5–25 */
export const RISK_QUESTIONS: { key: keyof RiskAnswers; q: string; options: string[] }[] = [
  { key: 'horizon', q: 'When will you need most of this money?', options: ['< 1 year', '1–3 years', '3–5 years', '5–10 years', '> 10 years'] },
  { key: 'reaction', q: 'Your investments drop 20% in a month. You…', options: ['Sell everything', 'Sell some', 'Do nothing', 'Buy a little more', 'Buy a lot more'] },
  { key: 'experience', q: 'Investing experience', options: ['None', 'Savings / deposits only', 'Mutual funds', 'Stocks / bonds', 'Active trader / multiple assets'] },
  { key: 'income', q: 'How stable is your income?', options: ['Very unstable', 'Irregular', 'Mostly stable', 'Stable', 'Very stable + multiple sources'] },
  { key: 'goal', q: 'Main investment goal', options: ['Protect capital', 'Income', 'Balanced', 'Growth', 'Maximum growth'] },
];

export function riskProfile(a?: RiskAnswers) {
  if (!a) return null;
  const score = a.horizon + a.reaction + a.experience + a.income + a.goal; // each 1..5
  const profile = score <= 10 ? 'Conservative' : score <= 15 ? 'Moderately conservative' : score <= 19 ? 'Moderate' : score <= 22 ? 'Growth' : 'Aggressive';
  const targets: Record<string, Partial<Record<AssetClass, number>>> = {
    'Conservative': { deposit: 0.4, bond: 0.4, mutualfund: 0.1, gold: 0.1 },
    'Moderately conservative': { deposit: 0.25, bond: 0.35, mutualfund: 0.15, stock: 0.15, gold: 0.1 },
    'Moderate': { deposit: 0.15, bond: 0.3, mutualfund: 0.15, stock: 0.3, gold: 0.1 },
    'Growth': { deposit: 0.1, bond: 0.2, mutualfund: 0.1, stock: 0.5, gold: 0.05, crypto: 0.05 },
    'Aggressive': { deposit: 0.05, bond: 0.1, stock: 0.65, gold: 0.05, crypto: 0.15 },
  };
  const maxVol = { 'Conservative': 0.05, 'Moderately conservative': 0.08, 'Moderate': 0.11, 'Growth': 0.15, 'Aggressive': 0.22 }[profile]!;
  return { score, profile, target: targets[profile], maxVol };
}

/** Key ratios + overall health score (0–100). */
export function healthMetrics(d: AppData) {
  const b = balances(d.accounts);
  const avg = averages(d.txns);
  const efMonths = avg.expense > 0 ? b.liquid / avg.expense : b.liquid > 0 ? 99 : 0;
  const dti = avg.income > 0 ? b.debtPayments / avg.income : b.debtPayments > 0 ? 1 : 0;
  const debtToAsset = b.assets > 0 ? b.liabilities / b.assets : b.liabilities > 0 ? 1 : 0;
  const investRatio = b.netWorth > 0 ? b.invested / b.netWorth : 0;
  const hasInsurance = d.txns.some((t) => t.category === 'Insurance');
  const p = portfolioStats(d.accounts);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const parts = [
    { name: 'Emergency fund', weight: 25, score: clamp(efMonths / 6), value: `${efMonths >= 99 ? '∞' : efMonths.toFixed(1)} months`, target: '≥ 6 months' },
    { name: 'Savings rate', weight: 20, score: clamp(avg.savingsRate / 0.2), value: `${(avg.savingsRate * 100).toFixed(0)}%`, target: '≥ 20%' },
    { name: 'Debt-to-income', weight: 20, score: clamp(1 - Math.max(0, dti - 0.1) / 0.3), value: `${(dti * 100).toFixed(0)}%`, target: '≤ 30% (ideal < 10%)' },
    { name: 'Debt-to-assets', weight: 10, score: clamp(1 - debtToAsset / 0.5), value: `${(debtToAsset * 100).toFixed(0)}%`, target: '≤ 50%' },
    { name: 'Investing', weight: 15, score: clamp(investRatio / 0.5), value: `${(investRatio * 100).toFixed(0)}% of net worth`, target: '≥ 50% over time' },
    { name: 'Diversification', weight: 5, score: p.total ? clamp((1 - p.hhi) / 0.6) : 0, value: p.total ? `${(p.largest.weight * 100).toFixed(0)}% in ${p.largest.label}` : '–', target: 'No class > 50%' },
    { name: 'Protection', weight: 5, score: hasInsurance ? 1 : 0, value: hasInsurance ? 'Premiums found' : 'None recorded', target: 'Health + life cover' },
  ];
  const score = Math.round(parts.reduce((s, x) => s + x.score * x.weight, 0));
  return { score, parts, efMonths, dti, debtToAsset, investRatio, avg, b, hasInsurance };
}
