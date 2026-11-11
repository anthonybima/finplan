/**
 * Foreign-currency accounts (Mandiri USD, Rekening SGD…): the account keeps its amount in its own currency
 * (`fxBalance`, `currency`) and `balance` holds the rupiah value at the current rate, so every total, chart and
 * risk number stays in IDR. When a rate changes, `revalueFx` recomputes the rupiah values.
 * USD uses the app's USD/IDR rate (settings.usdIdr); other currencies live in settings.fxRates.
 */
import type { Account, AppData, Settings } from './types';
import { getJSON } from './net';

export const CURRENCIES: { code: string; label: string; symbol: string; dec: number; fallback: number }[] = [
  { code: 'IDR', label: 'Rupiah', symbol: 'Rp', dec: 0, fallback: 1 },
  { code: 'USD', label: 'US dollar', symbol: 'US$', dec: 2, fallback: 16500 },
  { code: 'SGD', label: 'Singapore dollar', symbol: 'S$', dec: 2, fallback: 12600 },
  { code: 'EUR', label: 'Euro', symbol: '€', dec: 2, fallback: 18800 },
  { code: 'JPY', label: 'Japanese yen', symbol: '¥', dec: 0, fallback: 108 },
  { code: 'AUD', label: 'Australian dollar', symbol: 'A$', dec: 2, fallback: 10800 },
  { code: 'GBP', label: 'British pound', symbol: '£', dec: 2, fallback: 21800 },
  { code: 'CNY', label: 'Chinese yuan', symbol: 'CN¥', dec: 2, fallback: 2300 },
  { code: 'HKD', label: 'Hong Kong dollar', symbol: 'HK$', dec: 2, fallback: 2120 },
  { code: 'MYR', label: 'Malaysian ringgit', symbol: 'RM', dec: 2, fallback: 3750 },
  { code: 'SAR', label: 'Saudi riyal', symbol: 'SAR', dec: 2, fallback: 4400 },
];
export const ccyInfo = (c?: string) => CURRENCIES.find((x) => x.code === (c || 'IDR').toUpperCase());
export const isFx = (a: Pick<Account, 'currency'>) => !!a.currency && a.currency !== 'IDR';
export type RateSrc = 'live' | 'manual' | 'default';
export interface FxRate { rate: number; at: string; src: RateSrc }

/** Rupiah per 1 unit of `ccy`. */
export function rateOf(s: Settings, ccy?: string): number {
  const c = (ccy || 'IDR').toUpperCase();
  if (c === 'IDR') return 1;
  if (c === 'USD') return s.usdIdr || ccyInfo('USD')!.fallback;
  return s.fxRates?.[c]?.rate || ccyInfo(c)?.fallback || 0;
}
export function rateInfo(s: Settings, ccy: string): FxRate {
  const c = ccy.toUpperCase();
  if (c === 'USD') return { rate: rateOf(s, 'USD'), at: s.usdIdrAt || '', src: s.usdIdrAt ? 'live' : 'manual' };
  return s.fxRates?.[c] || { rate: ccyInfo(c)?.fallback || 0, at: '', src: 'default' };
}
/** Set a rate (USD → settings.usdIdr). */
export function withRate(s: Settings, ccy: string, rate: number, src: RateSrc): Settings {
  const c = ccy.toUpperCase(); const at = new Date().toISOString();
  if (!(rate > 0)) return s;
  if (c === 'USD') return { ...s, usdIdr: Math.round(rate), ...(src === 'live' ? { usdIdrAt: at } : {}) };
  return { ...s, fxRates: { ...(s.fxRates || {}), [c]: { rate: Math.round(rate * 100) / 100, at, src } } };
}

/** Amount in the account's own currency (what the bank shows). */
export const nativeAmount = (a: Account) => (isFx(a) ? a.fxBalance ?? 0 : a.balance);
export const toIdr = (s: Settings, ccy: string | undefined, amount: number) => Math.round(amount * rateOf(s, ccy));

/** Recompute the rupiah value of every foreign-currency account. Same object back when nothing changed. */
export function revalueFx(d: AppData): AppData {
  let changed = false;
  const accounts = d.accounts.map((a) => {
    if (!isFx(a) || a.fxBalance == null) return a;
    const idr = toIdr(d.settings, a.currency, a.fxBalance);
    if (idr === a.balance) return a;
    changed = true; return { ...a, balance: idr };
  });
  return changed ? { ...d, accounts } : d;
}

/** Currencies the user's accounts use (besides IDR). */
export const usedCurrencies = (d: AppData) => [...new Set(d.accounts.filter(isFx).map((a) => a.currency!.toUpperCase()))].sort((a, z) => (a === 'USD' ? -1 : z === 'USD' ? 1 : a.localeCompare(z)));

/** "US$ 12,500.00", "S$ 3,200.50", "Rp 15.250.000" */
export function fmtFx(amount: number, ccy?: string): string {
  const i = ccyInfo(ccy) || { symbol: (ccy || '').toUpperCase(), dec: 2 };
  const n = new Intl.NumberFormat(i.symbol === 'Rp' ? 'id-ID' : 'en-US', { minimumFractionDigits: i.dec, maximumFractionDigits: i.dec }).format(amount);
  return `${i.symbol} ${n}`;
}
export const fmtRate = (r: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: r < 1000 ? 2 : 0 }).format(r);

/** Currency written in an account name or currency cell: "Mandiri USD Tabungan", "Rekening SGD", "Binance (usd)". */
export function detectCurrency(text: string): string | undefined {
  const t = ` ${text} `.toUpperCase();
  if (/\bIDR\b|\bRUPIAH\b/.test(t)) return 'IDR';
  for (const c of CURRENCIES) if (c.code !== 'IDR' && new RegExp(`\\b${c.code}\\b`).test(t)) return c.code;
  if (/US\$|\bDOLLAR\b|\bDOLAR\b/.test(t)) return 'USD';
  if (/S\$|\bSING(APORE)?\s?DOLLAR/.test(t)) return 'SGD';
  if (/\bYEN\b/.test(t)) return 'JPY';
  if (/\bEURO\b/.test(t)) return 'EUR';
  if (/\bRINGGIT\b/.test(t)) return 'MYR';
  if (/\bYUAN\b|\bRMB\b/.test(t)) return 'CNY';
  return undefined;
}

/** Live rates (website / desktop / phone app). Inside Claude this source is not reachable: rates are then entered by hand
 *  (USD/IDR also comes from the Pluang connector when it syncs). */
export async function fetchRates(codes: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(codes.filter((c) => c !== 'IDR').map(async (c) => {
    try {
      const j = await getJSON<any>(`https://query1.finance.yahoo.com/v8/finance/chart/${c === 'USD' ? 'IDR%3DX' : `${c}IDR%3DX`}?range=1d&interval=1d`);
      const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      const lo = (ccyInfo(c)?.fallback || 1) / 3, hi = (ccyInfo(c)?.fallback || 1) * 3;
      if (typeof p === 'number' && p > lo && p < hi) out[c] = p;
    } catch { /* not reachable here */ }
  }));
  return out;
}
/** "12,500.50", "12.500,50", "12500.5", "1,234" → number (amounts in a foreign currency, with cents). */
export function parseFxAmount(s: string): number {
  let t = s.trim().replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lastComma >= 0) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t) && t.length > 5) t = t.replace(/\./g, '');
  const n = Number(t); return isFinite(n) ? n : 0;
}

/** Wealth by currency: manual accounts by their currency + app positions by theirs (US stocks USD, IDX IDR…). Nets debts. */
export interface Exposure { code: string; count: number; assetsIdr: number; debtIdr: number; netIdr: number; native: number; netUsd: number; share: number }
export function exposure(d: AppData, valueIDR: (h: any, usdIdr: number) => number): Exposure[] {
  const m = new Map<string, Exposure>();
  const row = (c: string) => { if (!m.has(c)) m.set(c, { code: c, count: 0, assetsIdr: 0, debtIdr: 0, netIdr: 0, native: 0, netUsd: 0, share: 0 }); return m.get(c)!; };
  for (const a of d.accounts) {
    if (a.synced) continue; // their positions are counted below in their own currency
    const r = row((a.currency || 'IDR').toUpperCase()); r.count++;
    const sign = a.kind === 'debt' ? -1 : 1;
    if (sign > 0) r.assetsIdr += a.balance; else r.debtIdr += a.balance;
    r.native += sign * (isFx(a) ? a.fxBalance ?? 0 : a.balance);
  }
  for (const h of d.holdings) {
    if ((h as any).excluded) continue;
    const c = (h.currency || 'IDR').toUpperCase(); const r = row(c); r.count++;
    const v = valueIDR(h, d.settings.usdIdr); r.assetsIdr += v; r.native += c === 'IDR' ? v : h.qty * h.price;
  }
  const rows = [...m.values()]; const usd = rateOf(d.settings, 'USD');
  const totalAssets = rows.reduce((s, r) => s + r.assetsIdr, 0) || 1;
  for (const r of rows) { r.netIdr = r.assetsIdr - r.debtIdr; r.netUsd = r.netIdr / usd; r.share = r.assetsIdr / totalAssets; }
  return rows.sort((a, z) => z.assetsIdr - a.assetsIdr);
}
/** "US$ 3,915" (no cents) for totals */
export const usdOf = (s: Settings, idr: number) => `US$ ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(idr / rateOf(s, 'USD'))}`;
