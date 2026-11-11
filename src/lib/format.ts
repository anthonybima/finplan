let LOCALE = 'id-ID';
let CURRENCY = 'IDR';
export function setLocale(locale: string, currency: string) { LOCALE = locale; CURRENCY = currency; }

export function money(n: number, compact = false): string {
  if (!isFinite(n)) return '–';
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency', currency: CURRENCY, maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? 'compact' : 'standard',
    }).format(n);
  } catch { return n.toFixed(0); }
}
export const pct = (n: number, d = 1) => (isFinite(n) ? `${(n * 100).toFixed(d)}%` : '–');
export const num = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : '–');

export const today = () => toISO(new Date());
export function toISO(d: Date) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export const monthKey = (iso: string) => iso.slice(0, 7);
export function addDays(iso: string, n: number) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return toISO(d); }
export function addMonths(iso: string, n: number) { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + n); return toISO(d); }
export function monthsBetween(a: string, b: string) {
  const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth()) + (db.getDate() - da.getDate()) / 30;
}
export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'short', year: '2-digit' });
}
export function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Parse numbers in "1.234.567,89", "1,234,567.89", "Rp 50.000", "(1.000)", "50,000.00 DB" etc. */
export function parseAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bDB\b|\bD\b$|debit/i.test(s);
  s = s.replace(/[^\d.,-]/g, '');
  s = s.replace(/-/g, '');
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else s = s.replace(/,/g, ''); // 1,234.56
  } else if (lastComma >= 0) {
    const dec = s.length - lastComma - 1;
    s = (s.match(/,/g)!.length === 1 && dec <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const dec = s.length - lastDot - 1;
    if (s.match(/\./g)!.length > 1 || dec === 3) s = s.replace(/\./g, ''); // 50.000 => thousands
  }
  const v = parseFloat(s);
  return isNaN(v) ? NaN : neg ? -v : v;
}

/** Parse dates: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YY, DD MMM YYYY (id/en), Excel serial. */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};
export function parseDate(raw: unknown, preferDayFirst = true): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return toISO(raw);
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) { // Excel serial
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/);
  if (m) {
    let a = +m[1], b = +m[2];
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    let day = preferDayFirst ? a : b, mon = preferDayFirst ? b : a;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    return iso(y, mon, day);
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, MONTHS[m[2].toLowerCase()], +m[1]); }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : toISO(d);
}
function iso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
