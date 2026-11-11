import type { Account, AppData, Holding, Txn } from './types';
import { syncAccounts } from './holdings';
import { emptyData, uid } from './store';
import { addDays, addMonths, today, toISO } from './format';

/** Realistic sample data (6 months) so every screen can be explored before importing real data. */
export function demoData(): AppData {
  const d = emptyData();
  const t = today();
  d.settings.name = 'Demo';
  d.accounts = [
    { id: 'bca', name: 'BCA Payroll', kind: 'bank', balance: 18_500_000, updatedAt: t },
    { id: 'gopay', name: 'GoPay', kind: 'ewallet', balance: 650_000, updatedAt: t },
    { id: 'cash', name: 'Cash wallet', kind: 'cash', balance: 400_000, updatedAt: t },
    { id: 'rdpu', name: 'Money market fund', kind: 'investment', assetClass: 'deposit', balance: 12_000_000, interestRate: 4.5, updatedAt: t },
    { id: 'sbn', name: 'ORI / SR bonds', kind: 'investment', assetClass: 'bond', balance: 25_000_000, interestRate: 6.3, updatedAt: t },
    { id: 'gold', name: 'Gold (Antam)', kind: 'investment', assetClass: 'gold', balance: 9_500_000, updatedAt: t },
    { id: 'car', name: 'Car loan', kind: 'debt', balance: 42_000_000, interestRate: 7.5, monthlyPayment: 2_850_000, updatedAt: t },
    { id: 'cc', name: 'Credit card', kind: 'debt', balance: 3_200_000, interestRate: 21, monthlyPayment: 1_000_000, updatedAt: t },
  ];
  const txns: Txn[] = [];
  const add = (date: string, amount: number, type: Txn['type'], category: string, note: string, account = 'bca') =>
    txns.push({ id: uid(), date, amount: Math.round(amount / 1000) * 1000, type, category, note, account, source: 'manual' });
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const now = new Date();
  for (let m = 5; m >= 0; m--) {
    const first = toISO(new Date(now.getFullYear(), now.getMonth() - m, 1));
    const lastDay = m === 0 ? now.getDate() : new Date(now.getFullYear(), now.getMonth() - m + 1, 0).getDate();
    const day = (n: number) => (n <= lastDay ? addDays(first, n - 1) : null);
    const on = (n: number, f: (date: string) => void) => { const x = day(n); if (x) f(x); };
    on(25, (x) => add(x, 24_000_000, 'income', 'Salary', 'GAJI PT MAJU JAYA'));
    if (m === 3) on(10, (x) => add(x, 4_000_000, 'income', 'Business', 'Freelance design project'));
    on(1, (x) => add(x, 3_500_000, 'expense', 'Housing', 'Sewa apartemen'));
    on(5, (x) => add(x, 2_850_000, 'expense', 'Debt Payment', 'Cicilan mobil'));
    on(12, (x) => add(x, 1_000_000, 'expense', 'Debt Payment', 'Pembayaran kartu kredit'));
    on(3, (x) => add(x, rnd(450_000, 750_000), 'expense', 'Utilities', 'PLN token listrik'));
    on(4, (x) => add(x, 385_000, 'expense', 'Utilities', 'Indihome'));
    on(6, (x) => add(x, 450_000, 'expense', 'Insurance', 'BPJS Kesehatan keluarga'));
    on(26, (x) => add(x, 1_650_000, 'expense', 'Charity / Zakat', 'Zakat & infaq'));
    on(15, (x) => add(x, 186_000, 'expense', 'Entertainment', 'Netflix + Spotify'));
    for (let w = 0; w < 4; w++) {
      on(2 + w * 7, (x) => add(x, rnd(600_000, 950_000), 'expense', 'Groceries', 'Superindo belanja mingguan'));
      on(4 + w * 7, (x) => add(x, rnd(200_000, 380_000), 'expense', 'Transport', 'Pertamina BBM'));
      on(5 + w * 7, (x) => add(x, rnd(120_000, 260_000), 'expense', 'Transport', 'Gojek / Grab', 'gopay'));
      on(6 + w * 7, (x) => add(x, rnd(250_000, 600_000), 'expense', 'Food & Dining', 'GoFood / restoran', 'gopay'));
      on(7 + w * 7, (x) => add(x, rnd(150_000, 900_000) * (m === 1 ? 2.2 : 1), 'expense', 'Shopping', 'Shopee / Tokopedia'));
    }
    if (m === 2) on(18, (x) => add(x, 1_200_000, 'expense', 'Health', 'Klinik & apotek'));
    if (m === 1) on(20, (x) => add(x, 2_500_000, 'expense', 'Family & Gifts', 'Kado pernikahan & keluarga'));
  }
  d.txns = txns.sort((a, b) => b.date.localeCompare(a.date));
  d.budgets = [
    { category: 'Groceries', limit: 3_200_000 }, { category: 'Food & Dining', limit: 1_600_000 },
    { category: 'Transport', limit: 2_000_000 }, { category: 'Shopping', limit: 1_500_000 },
    { category: 'Utilities', limit: 1_100_000 }, { category: 'Entertainment', limit: 300_000 },
  ];
  d.goals = [
    { id: uid(), name: 'Emergency fund (6 mo)', target: 120_000_000, current: 31_550_000, targetDate: addMonths(t, 18), monthlyContribution: 3_000_000, assetClass: 'deposit' },
    { id: uid(), name: 'House down payment', target: 250_000_000, current: 38_000_000, targetDate: addMonths(t, 48), monthlyContribution: 2_500_000, assetClass: 'mutualfund' },
    { id: uid(), name: 'Hajj / Umrah', target: 60_000_000, current: 9_500_000, targetDate: addMonths(t, 36), monthlyContribution: 1_000_000, assetClass: 'gold' },
  ];
  // Weekly snapshots history
  for (let i = 12; i >= 1; i--) {
    const nw = 64_850_000 - i * 750_000 + rnd(-900_000, 900_000);
    d.snapshots.push({ date: addDays(t, -i * 7), netWorth: nw, assets: nw + 47_000_000, liabilities: 47_000_000, liquid: 30_000_000, weekIncome: 0, weekExpense: 0, note: '' });
  }
  // Sample connected positions (Stockbit stocks, Bitget crypto)
  const H = (source: Holding['source'], symbol: string, name: string, assetClass: Holding['assetClass'], qty: number, avgPrice: number, price: number, currency: 'IDR' | 'USD', market: Holding['market']): Holding =>
    ({ id: uid(), source, symbol, name, assetClass, qty, avgPrice, price, currency, market });
  d.holdings = [
    H('stockbit', 'BBCA', 'Bank Central Asia', 'stock', 2000, 9_150, 9_400, 'IDR', 'IDX'),
    H('stockbit', 'TLKM', 'Telkom Indonesia', 'stock', 3000, 3_250, 3_000, 'IDR', 'IDX'),
    H('stockbit', 'ASII', 'Astra International', 'stock', 2000, 4_800, 5_000, 'IDR', 'IDX'),
    H('bitget', 'BTC', 'Bitcoin', 'crypto', 0.0035, 88_000, 95_000, 'USD', 'CRYPTO'),
    H('bitget', 'USDT', 'Tether', 'cash', 30, 1, 1, 'USD', 'CRYPTO'),
  ];
  d.settings.connections = { stockbit: { lastSync: new Date().toISOString(), status: 'ok' }, bitget: { lastSync: new Date().toISOString(), status: 'ok', message: 'Demo data' } };
  d.settings.risk = { horizon: 4, reaction: 3, experience: 3, income: 4, goal: 3 };
  d.settings.lastWeeklyReview = addDays(t, -9);
  return syncAccounts(d);
}

/* ---- sample data: recognise it (even in data created before it was flagged) and remove it ---- */
const DEMO_ACCTS: Record<string, string> = { bca: 'BCA Payroll', gopay: 'GoPay', cash: 'Cash wallet', rdpu: 'Money market fund', sbn: 'ORI / SR bonds', gold: 'Gold (Antam)', car: 'Car loan', cc: 'Credit card' };
const DEMO_NOTES = new Set(['GAJI PT MAJU JAYA', 'Freelance design project', 'Sewa apartemen', 'Cicilan mobil', 'Pembayaran kartu kredit', 'PLN token listrik', 'Indihome', 'BPJS Kesehatan keluarga', 'Zakat & infaq', 'Netflix + Spotify', 'Superindo belanja mingguan', 'Pertamina BBM', 'Gojek / Grab', 'GoFood / restoran', 'Shopee / Tokopedia', 'Klinik & apotek', 'Kado pernikahan & keluarga']);
const DEMO_GOALS: Record<string, number> = { 'Emergency fund (6 mo)': 120_000_000, 'House down payment': 250_000_000, 'Hajj / Umrah': 60_000_000 };
const DEMO_HOLD = ['stockbit:BBCA:2000:9150', 'stockbit:TLKM:3000:3250', 'stockbit:ASII:2000:4800', 'bitget:BTC:0.0035:88000', 'bitget:USDT:30:1'];
const DEMO_BUDGETS = 'Groceries:3200000|Food & Dining:1600000|Transport:2000000|Shopping:1500000|Utilities:1100000|Entertainment:300000';

const isDemoAcct = (a: Account) => !a.synced && DEMO_ACCTS[a.id] === a.name;
const isDemoTxn = (t: Txn) => t.source === 'manual' && DEMO_NOTES.has(t.note || '') && (!t.account || ['bca', 'gopay'].includes(t.account));
const isDemoHold = (h: Holding) => DEMO_HOLD.includes(`${h.source}:${h.symbol}:${h.qty}:${h.avgPrice}`);
const isDemoGoal = (g: any) => DEMO_GOALS[g.name] === g.target;
const isDemoSnap = (s: any) => Math.round(s.assets - s.netWorth) === 47_000_000 && s.liquid === 30_000_000;

export interface DemoFound { accounts: Account[]; holdings: number; txns: number; goals: number; snapshots: number; total: number }
export function findDemo(d: AppData): DemoFound {
  const accounts = d.accounts.filter(isDemoAcct);
  const holdings = d.holdings.filter(isDemoHold).length, txns = d.txns.filter(isDemoTxn).length, goals = (d.goals || []).filter(isDemoGoal).length, snapshots = (d.snapshots || []).filter(isDemoSnap).length;
  return { accounts, holdings, txns, goals, snapshots, total: accounts.length + holdings + txns + goals + snapshots };
}
/** Remove the sample accounts, positions, transactions, goals, net-worth history and budgets; keep everything of yours. */
export function removeDemo(d: AppData): AppData {
  const holdings = d.holdings.filter((h) => !isDemoHold(h));
  const budgets = (d.budgets || []).map((b) => `${b.category}:${b.limit}`).join('|') === DEMO_BUDGETS ? [] : d.budgets;
  const conns = { ...(d.settings.connections || {}) } as any;
  for (const src of ['stockbit', 'bitget']) if (!holdings.some((h) => h.source === src) && (conns[src]?.message === 'Demo data' || src === 'stockbit')) delete conns[src];
  return syncAccounts({
    ...d,
    accounts: d.accounts.filter((a) => !isDemoAcct(a)),
    holdings, txns: d.txns.filter((t) => !isDemoTxn(t)), goals: (d.goals || []).filter((g) => !isDemoGoal(g)), snapshots: (d.snapshots || []).filter((s) => !isDemoSnap(s)), budgets,
    settings: { ...d.settings, connections: conns, keepDemo: undefined },
  });
}
