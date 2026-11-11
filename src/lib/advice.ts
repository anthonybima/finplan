import type { AppData } from './types';
import { anomalies, budgetStatus } from './analytics';
import { goalMonteCarlo, healthMetrics, portfolioStats, riskProfile, ASSUMPTIONS } from './risk';
import { money, pct } from './format';

export type Level = 'critical' | 'warning' | 'tip' | 'good';
export interface Advice { level: Level; area: string; title: string; detail: string; action?: string }

/** Rule-based advisor. Order: critical → warning → tip → good. */
export function generateAdvice(d: AppData): Advice[] {
  const out: Advice[] = [];
  const h = healthMetrics(d);
  const { avg, b } = h;
  const p = portfolioStats(d.accounts);
  const prof = riskProfile(d.settings.risk);

  if (!d.txns.length) out.push({ level: 'tip', area: 'Data', title: 'Add your first transactions', detail: 'Import a CSV/Excel export from your bank or e-wallet app, or add entries manually. Advice gets sharper with 2–3 months of history.', action: 'Go to Transactions → Import' });
  if (!d.accounts.length) out.push({ level: 'tip', area: 'Data', title: 'Add your accounts', detail: 'List bank accounts, e-wallets, investments and debts so net worth and risk can be calculated.', action: 'Go to Wealth → Add account' });

  // Cash flow
  if (avg.income > 0 && avg.savings < 0) out.push({ level: 'critical', area: 'Cash flow', title: 'You are spending more than you earn', detail: `Average deficit of ${money(-avg.savings)} per month over the last ${avg.monthsUsed} month(s).`, action: 'Set budgets on your top 3 categories and cut wants first.' });
  else if (avg.income > 0 && avg.savingsRate < 0.1) out.push({ level: 'warning', area: 'Cash flow', title: `Savings rate is low (${pct(avg.savingsRate, 0)})`, detail: 'Aim for at least 20% of income. Even 10% builds a cushion quickly.', action: `Automate a transfer of ${money(avg.income * 0.1)} on payday.` });
  else if (avg.savingsRate >= 0.2) out.push({ level: 'good', area: 'Cash flow', title: `Strong savings rate: ${pct(avg.savingsRate, 0)}`, detail: 'You keep at least a fifth of your income. Keep investing the surplus.' });

  // 50/30/20
  if (avg.income > 0 && avg.wants / avg.income > 0.35) out.push({ level: 'warning', area: 'Spending', title: 'Lifestyle spending is above 30% of income', detail: `"Wants" average ${money(avg.wants)} (${pct(avg.wants / avg.income, 0)} of income). 50/30/20 suggests ≤ 30%.`, action: 'Review Shopping, Food & Dining and Entertainment.' });

  // Emergency fund
  const efTarget = avg.expense * 6;
  if (avg.expense > 0) {
    if (h.efMonths < 1) out.push({ level: 'critical', area: 'Risk', title: 'Emergency fund under 1 month', detail: `Liquid cash covers only ${h.efMonths.toFixed(1)} months of expenses. One surprise bill could push you into debt.`, action: `Build ${money(avg.expense * 3)} first (3 months), then grow to ${money(efTarget)}.` });
    else if (h.efMonths < 3) out.push({ level: 'warning', area: 'Risk', title: `Emergency fund: ${h.efMonths.toFixed(1)} months`, detail: 'Target 3 months minimum, 6 months ideal (12 if self-employed or sole earner).', action: `Gap to 6 months: ${money(Math.max(0, efTarget - b.liquid))}. Park it in a money-market fund or high-yield savings.` });
    else if (h.efMonths > 12 && avg.income > 0) out.push({ level: 'tip', area: 'Investing', title: 'Too much idle cash', detail: `You hold ${h.efMonths.toFixed(0)} months of expenses in liquid accounts. Inflation erodes cash; consider investing the excess above 6 months.`, action: `About ${money(b.liquid - efTarget)} could be invested per your risk profile.` });
    else out.push({ level: 'good', area: 'Risk', title: `Emergency fund healthy (${h.efMonths.toFixed(1)} months)`, detail: 'You can absorb a shock without selling investments or borrowing.' });
  }

  // Debt
  if (h.dti > 0.35) out.push({ level: 'critical', area: 'Debt', title: `Debt payments take ${pct(h.dti, 0)} of income`, detail: 'Above 35% is a danger zone (OJK / bank lending guidance is usually ≤ 30–35%). Avoid any new credit.', action: 'Use the avalanche method: pay extra on the highest-interest debt first.' });
  else if (h.dti > 0.2) out.push({ level: 'warning', area: 'Debt', title: `Debt-to-income at ${pct(h.dti, 0)}`, detail: 'Manageable, but limits your ability to save and invest.' });
  const highRate = d.accounts.filter((a) => a.kind === 'debt' && (a.interestRate || 0) >= 15).sort((x, y) => (y.interestRate || 0) - (x.interestRate || 0));
  if (highRate.length) out.push({ level: 'warning', area: 'Debt', title: `High-interest debt: ${highRate[0].name} (${highRate[0].interestRate}%/yr)`, detail: `Paying this off is a guaranteed ${highRate[0].interestRate}% "return", better than nearly any investment.`, action: 'Put any surplus here before investing in risky assets.' });

  // Protection
  if (!h.hasInsurance && avg.income > 0) out.push({ level: 'tip', area: 'Protection', title: 'No insurance premiums recorded', detail: 'Make sure you have health cover (BPJS Kesehatan at minimum). If others depend on you, consider term life cover of about 10× annual income.' });

  // Budgets
  for (const s of budgetStatus(d)) {
    if (s.pct >= 1) out.push({ level: 'warning', area: 'Budget', title: `${s.category} over budget`, detail: `Spent ${money(s.spent)} of ${money(s.limit)} (${pct(s.pct, 0)}).` });
    else if (s.projected > s.limit * 1.1) out.push({ level: 'tip', area: 'Budget', title: `${s.category} heading over budget`, detail: `At this pace you'll spend ~${money(s.projected)} vs ${money(s.limit)} this month.` });
  }
  if (d.txns.length && !d.budgets.length) out.push({ level: 'tip', area: 'Budget', title: 'Set monthly budgets', detail: 'Use Plan → "Auto-suggest budgets" to create budgets from your last 3 months, trimmed 10% on wants.' });
  for (const a of anomalies(d.txns).slice(0, 3)) out.push({ level: 'tip', area: 'Spending', title: `Unusual ${a.category} spending`, detail: `On pace for ${pct(a.ratio - 1, 0)} above your 3-month average (${money(a.average)}).` });

  // Portfolio
  if (p.total > 0) {
    if (p.largest.weight > 0.6 && p.largest.cls !== 'cash') out.push({ level: 'warning', area: 'Investing', title: `Concentration: ${pct(p.largest.weight, 0)} in ${p.largest.label}`, detail: 'A single asset class dominates your wealth. Diversify across bonds, equities and gold.' });
    const crypto = p.rows.find((r) => r.cls === 'crypto');
    if (crypto && crypto.weight > 0.15) out.push({ level: 'warning', area: 'Investing', title: `Crypto is ${pct(crypto.weight, 0)} of assets`, detail: `Crypto can fall 70%+ (${ASSUMPTIONS.crypto.label}). Most planners cap it at 5–10% of a portfolio.` });
    if (prof && p.sigma > prof.maxVol * 1.25) out.push({ level: 'warning', area: 'Risk', title: 'Portfolio riskier than your profile', detail: `Estimated volatility ${pct(p.sigma)} vs ~${pct(prof.maxVol)} suitable for a ${prof.profile} investor.`, action: 'See Risk → Target allocation for a rebalance plan.' });
    if (prof && p.sigma < prof.maxVol * 0.4 && h.efMonths >= 6) out.push({ level: 'tip', area: 'Investing', title: 'Portfolio may be too conservative', detail: `For a ${prof.profile} profile, low-risk holdings may not beat inflation (~2.5–3.5% in Indonesia) after tax.` });
  }
  if (!prof) out.push({ level: 'tip', area: 'Risk', title: 'Take the risk-profile quiz', detail: '5 questions to find your risk tolerance and a suitable target allocation.', action: 'Go to Risk → Risk profile' });

  // Goals
  for (const g of d.goals) {
    const mc = goalMonteCarlo(g, 800);
    if (mc.probability < 0.5) out.push({ level: 'warning', area: 'Goals', title: `"${g.name}" is off track (${pct(mc.probability, 0)} chance)`, detail: `Needs about ${money(mc.required)}/month vs ${money(g.monthlyContribution)} planned.`, action: 'Increase contributions, extend the date, or lower the target.' });
    else if (mc.probability >= 0.8) out.push({ level: 'good', area: 'Goals', title: `"${g.name}" on track (${pct(mc.probability, 0)})`, detail: `Median outcome ${money(mc.p50)} vs target ${money(g.target)}.` });
  }

  // Weekly discipline
  const last = d.settings.lastWeeklyReview;
  if (!last || (Date.now() - new Date(last).getTime()) / 864e5 > 8) out.push({ level: 'tip', area: 'Routine', title: 'Weekly review is due', detail: 'Update balances, import new transactions and check your budgets (≈ 10 minutes).', action: 'Open Weekly review' });

  const order: Record<Level, number> = { critical: 0, warning: 1, tip: 2, good: 3 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}
