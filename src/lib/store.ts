import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppData, Settings } from './types';
import { NEWS_SOURCES } from './news';
import { today } from './format';


export const DEFAULT_FEEDS = NEWS_SOURCES.filter((n) => n.on).map((n) => n.url);

export const DEFAULT_RULES = [
  { keyword: 'gaji', category: 'Salary' }, { keyword: 'salary', category: 'Salary' }, { keyword: 'payroll', category: 'Salary' },
  { keyword: 'bonus', category: 'Bonus' }, { keyword: 'thr', category: 'Bonus' }, { keyword: 'dividen', category: 'Investment Return' },
  { keyword: 'bunga', category: 'Investment Return' },
  { keyword: 'gojek', category: 'Transport' }, { keyword: 'grab', category: 'Transport' }, { keyword: 'pertamina', category: 'Transport' },
  { keyword: 'shell', category: 'Transport' }, { keyword: 'toll', category: 'Transport' }, { keyword: 'tol ', category: 'Transport' },
  { keyword: 'krl', category: 'Transport' }, { keyword: 'parkir', category: 'Transport' },
  { keyword: 'gofood', category: 'Food & Dining' }, { keyword: 'grabfood', category: 'Food & Dining' }, { keyword: 'shopeefood', category: 'Food & Dining' },
  { keyword: 'resto', category: 'Food & Dining' }, { keyword: 'kopi', category: 'Food & Dining' }, { keyword: 'starbucks', category: 'Food & Dining' },
  { keyword: 'indomaret', category: 'Groceries' }, { keyword: 'alfamart', category: 'Groceries' }, { keyword: 'superindo', category: 'Groceries' },
  { keyword: 'hypermart', category: 'Groceries' }, { keyword: 'transmart', category: 'Groceries' },
  { keyword: 'pln', category: 'Utilities' }, { keyword: 'token listrik', category: 'Utilities' }, { keyword: 'pdam', category: 'Utilities' },
  { keyword: 'indihome', category: 'Utilities' }, { keyword: 'telkomsel', category: 'Utilities' }, { keyword: 'pulsa', category: 'Utilities' },
  { keyword: 'xl ', category: 'Utilities' }, { keyword: 'biznet', category: 'Utilities' },
  { keyword: 'shopee', category: 'Shopping' }, { keyword: 'tokopedia', category: 'Shopping' }, { keyword: 'lazada', category: 'Shopping' },
  { keyword: 'tiktok shop', category: 'Shopping' },
  { keyword: 'netflix', category: 'Entertainment' }, { keyword: 'spotify', category: 'Entertainment' }, { keyword: 'cgv', category: 'Entertainment' },
  { keyword: 'xxi', category: 'Entertainment' },
  { keyword: 'bpjs', category: 'Insurance' }, { keyword: 'asuransi', category: 'Insurance' }, { keyword: 'prudential', category: 'Insurance' },
  { keyword: 'apotek', category: 'Health' }, { keyword: 'kimia farma', category: 'Health' }, { keyword: 'rumah sakit', category: 'Health' },
  { keyword: 'klinik', category: 'Health' },
  { keyword: 'cicilan', category: 'Debt Payment' }, { keyword: 'kpr', category: 'Debt Payment' }, { keyword: 'kartu kredit', category: 'Debt Payment' },
  { keyword: 'angsuran', category: 'Debt Payment' },
  { keyword: 'sewa', category: 'Housing' }, { keyword: 'kost', category: 'Housing' }, { keyword: 'ipl', category: 'Housing' },
  { keyword: 'sekolah', category: 'Education' }, { keyword: 'kursus', category: 'Education' }, { keyword: 'spp', category: 'Education' },
  { keyword: 'zakat', category: 'Charity / Zakat' }, { keyword: 'donasi', category: 'Charity / Zakat' }, { keyword: 'infaq', category: 'Charity / Zakat' },
  { keyword: 'biaya adm', category: 'Fees & Admin' }, { keyword: 'admin', category: 'Fees & Admin' }, { keyword: 'pajak', category: 'Fees & Admin' },
];

export const defaultSettings = (): Settings => ({
  currency: 'IDR', locale: 'id-ID', name: '', weeklyDay: 0, feeds: DEFAULT_FEEDS, newsV2: true, rules: DEFAULT_RULES, usdIdr: 16500, connections: {},
});

export const emptyData = (): AppData => ({
  version: 1, accounts: [], txns: [], budgets: [], goals: [], snapshots: [], holdings: [], settings: defaultSettings(),
});

export function migrate(d: AppData): AppData {
  d.settings = { ...defaultSettings(), ...d.settings, connections: d.settings?.connections || {} };
  d.holdings = d.holdings || [];
  if (!d.settings.newsV2) { // add WSJ / NYT / Bloomberg / Investing.com once for existing users
    d.settings.feeds = [...new Set([...(d.settings.feeds || []), ...DEFAULT_FEEDS])];
    d.settings.newsV2 = true;
  }
  return d;
}

/** App state, persisted by the caller (encrypted per-user vault). */
export function useAppData(initial: AppData | null, persist: (d: AppData | null) => void) {
  const [data, setData] = useState<AppData | null>(() => (initial ? migrate(initial) : null));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } persist(data); }, [data]);
  const update = useCallback((fn: (d: AppData) => AppData) => setData((d) => (d ? fn(d) : d)), []);
  return { data, setData, update };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function exportBackup(d: AppData) {
  import('./holdings').then((m) => m.downloadText(`finplan-backup-${today()}.json`, JSON.stringify(d, null, 2), 'application/json'));
}
