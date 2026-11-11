import { groupOf } from './institutions';
/**
 * A compact, numbers-first snapshot of the user's finances for Claude to analyse.
 * Built from FinPlan's own calculations so Claude's answers match what the app shows.
 */
import type { AppData } from './types';
import { balances, monthly, byCategory, monthRange, budgetStatus, anomalies } from './analytics';
import { healthMetrics, portfolioStats, goalMonteCarlo, riskProfile, stressTests } from './risk';
import { generateAdvice } from './advice';
import { valueIDR, costIDR } from './holdings';
import { today } from './format';
import { reminderState } from './reminders';
import { wealthByYear } from './wealthYears';

const r0 = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 1000) / 10;

export interface ContextOptions { includeNames: boolean; includeTxns: boolean }

export function buildContext(d: AppData, o: ContextOptions = { includeNames: true, includeTxns: true }) {
  const b = balances(d.accounts);
  const h = healthMetrics(d);
  const p = portfolioStats(d.accounts);
  const cur = monthRange(0), prev = monthRange(-1);
  const rate = d.settings.usdIdr;
  const name = (s: string, i: number, kind: string) => (o.includeNames ? s : `${kind} #${i + 1}`);
  const holdings = d.holdings.filter((x) => !x.excluded).map((x) => ({ x, v: valueIDR(x, rate), c: costIDR(x, rate) })).sort((a, z) => z.v - a.v);
  const months = monthly(d.txns, 6);
  const goals = d.goals.slice(0, 10).map((g, i) => {
    const mc = goalMonteCarlo(g, 600);
    return { name: name(g.name, i, 'Goal'), target: r0(g.target), saved: r0(g.current), targetDate: g.targetDate, monthlyContribution: r0(g.monthlyContribution), investedIn: g.assetClass, successProbabilityPct: pct(mc.probability), monthlyNeededAtExpectedReturn: r0(mc.required) };
  });
  const rp = d.settings.risk ? riskProfile(d.settings.risk) : null;
  const rem = reminderState(d);
  return {
    asOf: today(), currency: 'IDR', usdIdr: rate, user: o.includeNames ? d.settings.name || undefined : undefined,
    balanceSheet: { netWorth: r0(b.netWorth), assets: r0(b.assets), liabilities: r0(b.liabilities), liquidCash: r0(b.liquid), invested: r0(b.invested), monthlyDebtPayments: r0(b.debtPayments) },
    insurance: (d.policies || []).map((p, i) => ({ name: o.includeNames ? p.name : `Policy ${i + 1}`, type: p.type, insurer: o.includeNames ? p.insurer : undefined, coverage: p.coverage, currency: p.currency || 'IDR', premium: p.premium, premiumFreq: p.premiumFreq, endDate: p.endDate, status: p.status, note: 'protection, not counted in net worth' })),
    accounts: d.accounts.map((a, i) => ({ name: name(a.name, i, a.kind), kind: a.kind, assetClass: a.assetClass, balance: r0(a.balance), interestRatePct: a.interestRate, monthlyPayment: a.monthlyPayment, updated: a.updatedAt, openedYear: a.opened, termMonths: a.tenorMonths, maturity: a.maturity, syncedFrom: a.synced, bankOrApp: o.includeNames ? groupOf(a) : undefined, currency: a.currency || 'IDR', amountInCurrency: a.currency && a.currency !== 'IDR' ? a.fxBalance : undefined, balanceNotEntered: a.needsBalance || undefined })),
    portfolio: {
      positions: holdings.length,
      totalValueIDR: r0(holdings.reduce((s, y) => s + y.v, 0)),
      top: holdings.slice(0, 40).map(({ x, v, c }) => ({ symbol: x.symbol, name: x.name, class: x.assetClass, market: x.market, broker: x.source, qty: x.qty, avgPrice: x.avgPrice, lastPrice: x.price, currency: x.currency, valueIDR: r0(v), unrealisedPLpct: c > 0 ? pct((v - c) / c) : null, firstBoughtYear: x.opened })),
    },
    allocationByClass: p.rows.map((x) => ({ class: x.label, valueIDR: r0(x.value), weightPct: pct(x.weight) })),
    riskModel: { expectedReturnPct: pct(p.mu), volatilityPct: pct(p.sigma), VaR95_1yIDR: r0(p.var95), VaR99_1yIDR: r0(p.var99), CVaR95_1yIDR: r0(p.cvar95), crashScenarioLossIDR: r0(p.crashLoss), sharpe: Math.round(p.sharpe * 100) / 100, concentrationHHI: Math.round(p.hhi * 1000) / 1000, largestClass: `${p.largest.label} ${pct(p.largest.weight)}%`, assumptions: 'long-run class assumptions in FinPlan (not market forecasts)' },
    stressTests: stressTests(d).map((s) => ({ scenario: s.name, impactIDR: r0(s.impact), pctOfNetWorth: pct(s.pctOfNetWorth), coveredByLiquidCash: s.survivable, note: s.note })),
    health: { score: h.score, parts: h.parts.map((x) => ({ metric: x.name, value: x.value, target: x.target, scorePct: pct(x.score) })), emergencyFundMonths: Math.round(h.efMonths * 10) / 10, avgMonthlyIncome: r0(h.avg.income), avgMonthlyExpense: r0(h.avg.expense), savingsRatePct: pct(h.avg.savingsRate) },
    riskProfile: rp ? { profile: rp.profile, targetAllocationPct: Object.fromEntries(Object.entries(rp.target).map(([k, v]) => [k, pct(v || 0)])), maxVolatilityPct: pct(rp.maxVol) } : 'not taken (Risk → quiz)',
    cashflowLast6Months: months.map((m) => ({ month: m.month, income: r0(m.income), expense: r0(m.expense), net: r0(m.net), needs: r0(m.needs), wants: r0(m.wants) })),
    spendingThisMonth: byCategory(d.txns, cur.from, cur.to).slice(0, 12).map((c) => ({ category: c.category, amount: r0(c.value) })),
    spendingLastMonth: byCategory(d.txns, prev.from, prev.to).slice(0, 12).map((c) => ({ category: c.category, amount: r0(c.value) })),
    budgets: budgetStatus(d).map((x) => ({ category: x.category, limit: r0(x.limit), spent: r0(x.spent), projectedMonthEnd: r0(x.projected) })),
    goals,
    unusualSpending: anomalies(d.txns).slice(0, 6).map((a) => ({ category: a.category, thisMonthSoFar: r0(a.current), avgPrev3Months: r0(a.average), projectedVsAvg: Math.round(a.ratio * 100) / 100 })),
    recentTransactions: o.includeTxns ? [...d.txns].sort((a, z) => z.date.localeCompare(a.date)).slice(0, 60).map((t) => ({ date: t.date, type: t.type, amount: r0(t.amount), category: t.category, note: t.note.slice(0, 60) })) : undefined,
    appAdvice: generateAdvice(d).slice(0, 8).map((a) => ({ level: a.level, title: a.title })),
    monthlyUpdateReminder: { status: rem.status, nextDate: rem.nextDate },
    wealthByYearOpened: wealthByYear(d).map((r) => ({ year: r.year, assetsToday: r0(r.assets), debtToday: r0(r.debt), items: r.count })),
  };
}

export const SYSTEM = `You are the analyst built into FinPlan, a personal finance app used in Indonesia.
You get a JSON snapshot of the user's own finances (amounts in IDR unless a field says USD). Use it to answer.
- Lead with the answer, then the 2-4 numbers that support it (format rupiah like Rp 15.250.000 or Rp 15,3 jt).
- Be specific and practical: name accounts, categories, positions and amounts from the data. Do the arithmetic.
- If the data can't answer something, say what is missing and how to add it in FinPlan (Wealth, Transactions, Import data, Connections, Plan & Goals, Risk quiz).
- Risk figures are FinPlan's model estimates from long-run assumptions; say so when you use them.
- You give educational analysis, not licensed financial advice; don't tell the user to buy or sell a specific security as a certainty. Mention this briefly only when you discuss investment choices.
- Reply in the user's language (Indonesian or English). Use short paragraphs, bullet lists and small tables when they help. No preamble.`;

export const SUGGESTIONS = [
  'How healthy are my finances right now? What are the top 3 things to fix?',
  'Where can I cut spending this month? Compare with last month.',
  'Is my portfolio too concentrated? How would you rebalance toward my risk profile?',
  'Make a plan to pay off my debts faster (avalanche vs snowball) with my numbers.',
  'Will I reach my goals on time? What monthly amount do I need?',
  'Explain my VaR and stress-test results in simple terms.',
  'Berapa dana darurat yang saya punya dan berapa idealnya?',
];
