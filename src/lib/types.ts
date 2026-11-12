export type TxnType = 'income' | 'expense' | 'transfer';

export interface Txn {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // always positive
  type: TxnType;
  category: string;
  account: string; // account id
  note: string;
  source: 'manual' | 'import';
}

export type AccountKind = 'cash' | 'bank' | 'ewallet' | 'investment' | 'asset' | 'debt';
export type AssetClass = 'cash' | 'deposit' | 'bond' | 'stock' | 'mutualfund' | 'crypto' | 'gold' | 'property';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  balance: number; // for debt: outstanding amount (positive)
  assetClass?: AssetClass; // investment / asset
  interestRate?: number; // debt APR %, or deposit rate %
  monthlyPayment?: number; // debt installment
  updatedAt: string;
  synced?: Source; // managed automatically by a connection
  opened?: string; // year the account was opened / asset bought: "2019" (or "2019-03")
  group?: string;  // bank / app / insurer, e.g. "Mayapada": accounts are grouped by it in Wealth
  currency?: string;    // account currency (ISO, e.g. USD, SGD); absent / IDR = rupiah
  fxBalance?: number;   // amount in that currency; `balance` is its rupiah value at the current rate (lib/fx.ts)
  maturity?: string;    // maturity date (bonds, time deposits), YYYY-MM-DD
  tenorMonths?: number; // duration / term (jangka waktu) of a deposit, bond or loan, in months
  accountNo?: string; // full account number (encrypted on the device and in sync; never sent to Claude)
  ref?: string;    // masked label from the last 4 characters, e.g. "···9990"
  needsBalance?: boolean; // imported without a balance: enter it in the monthly update
}

export type Source = 'bitget' | 'bittime' | 'alpaca' | 'pluang' | 'stockbit' | 'tradingview' | 'manual';

/** One investment position (from a connected app or entered by hand). */
export interface Holding {
  id: string;
  source: Source;
  symbol: string; // BBCA, AAPL, BTC
  name: string;
  assetClass: AssetClass;
  qty: number; // units (shares, coins). IDX: shares, not lots
  avgPrice: number; // per unit, in `currency`
  price: number; // last price per unit, in `currency`
  currency: 'IDR' | 'USD';
  market?: 'IDX' | 'US' | 'CRYPTO' | 'OTHER';
  tv?: string; // TradingView symbol override, e.g. IDX:BBCA
  excluded?: boolean; // e.g. paper-trading money: shown, but not counted in net worth
  category?: string; // source's own grouping, e.g. 'US Stocks'
  priceAt?: string;
  opened?: string; // year of first purchase: "2021" (or "2021-06")
}

export interface ConnectionState { lastSync?: string; status?: 'ok' | 'error'; message?: string; via?: 'mcp' | 'file' | 'api'; summary?: Record<string, number> }

export interface Budget { category: string; limit: number }

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  targetDate: string; // YYYY-MM-DD
  monthlyContribution: number;
  assetClass: AssetClass; // where the money is invested
}

export interface Snapshot {
  date: string;
  netWorth: number;
  assets: number;
  liabilities: number;
  liquid: number;
  weekIncome: number;
  weekExpense: number;
  note: string;
}

export interface CategoryRule { keyword: string; category: string }

export interface RiskAnswers { horizon: number; reaction: number; experience: number; income: number; goal: number }

export type WidgetType = 'quote' | 'ratio' | 'list' | 'compare';
export interface Widget {
  id: string; type: WidgetType; title: string; symbols: string[];
  range: '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';
  chart: 'area' | 'line' | 'candle'; size: 's' | 'm' | 'l';
  source?: 'auto' | 'yahoo' | 'alpaca'; // where FinPlan gets the numbers
  view?: 'native' | 'tradingview' | 'investing'; // draw with FinPlan, or embed TradingView / Investing.com's live chart
  invPair?: number; // Investing.com pair_ID override
}
export interface MarketDashboard { id: string; name: string; refreshSec: number; widgets: Widget[] }

export interface MonthlyReminder {
  enabled: boolean;
  week: 1 | 2 | 3 | 4 | 5;   // 5 = last
  day: number;               // 0 = Sunday … 6 = Saturday
  time: string;              // "09:00", for notifications and the calendar event
  notify: boolean;           // device notification when FinPlan is open on/after the day
  doneMonth?: string;        // "YYYY-MM" completed
  snoozeUntil?: string;      // ISO date: hide the banner until this day
  notifiedMonth?: string;    // "YYYY-MM" a device notification was already shown
}

export interface Settings {
  currency: string;
  locale: string;
  name: string;
  weeklyDay: number; // 0 = Sunday
  lastWeeklyReview?: string;
  risk?: RiskAnswers;
  feeds: string[];
  rules: CategoryRule[];
  monthlyIncomeTarget?: number;
  usdIdr: number;
  usdIdrAt?: string;
  fxRates?: Record<string, { rate: number; at: string; src: 'live' | 'manual' | 'default' }>; // rupiah per unit, other than USD
  connections: Partial<Record<Source, ConnectionState>>;
  privacyNoProxy?: boolean;
  newsV2?: boolean;
  dashboards?: MarketDashboard[];
  marketsLayout?: number; // sample-layout version applied to saved dashboards
  activeDashboard?: string;
  lastBackupAt?: string;
  monthlyUpdate?: MonthlyReminder;
  devicesNeedApproval?: boolean; // new devices wait until an allowed device approves them
  keepDemo?: boolean;            // user chose to keep the sample data (hides the 'remove sample data' banner)
}

export interface NewsItem { title: string; link: string; date: string; source: string; summary: string; section?: string }

export interface AppData {
  version: 1;
  accounts: Account[];
  txns: Txn[];
  budgets: Budget[];
  goals: Goal[];
  snapshots: Snapshot[];
  holdings: Holding[];
  settings: Settings;
  /** Devices that opened this account (phones, computers), by Browser ID: see lib/devices.ts */
  devices?: import('./devices').DeviceRec[];
  /** Insurance policies: never counted in net worth (lib/insurance.ts) */
  policies?: import('./insurance').Policy[];
}

export const EXPENSE_CATEGORIES = [
  'Food & Dining', 'Groceries', 'Transport', 'Housing', 'Utilities', 'Health', 'Education',
  'Shopping', 'Entertainment', 'Family & Gifts', 'Insurance', 'Debt Payment', 'Charity / Zakat', 'Fees & Admin', 'Other',
];
export const INCOME_CATEGORIES = ['Salary', 'Business', 'Bonus', 'Investment Return', 'Other Income'];

// Needs / wants / savings mapping for 50/30/20 analysis
export const NEEDS = new Set(['Groceries', 'Transport', 'Housing', 'Utilities', 'Health', 'Education', 'Insurance', 'Debt Payment', 'Fees & Admin']);
