/** Duration / term (jangka waktu) of a deposit, bond or loan, in months. */
export function parseTenor(s: string | number | undefined | null): number | undefined {
  if (s == null) return undefined;
  if (typeof s === 'number') return s > 0 && s <= 600 ? Math.round(s) : undefined;
  const t = s.toLowerCase().replace(',', '.').trim();
  if (!t) return undefined;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(bulan|bln|months?|mos?|mo\b|m\b|tahun|thn|th\b|years?|yrs?|y\b|minggu|weeks?|hari|days?)?/);
  if (!m) return undefined;
  const n = Number(m[1]); const u = m[2] || 'bulan';
  const months = /tahun|thn|th|year|yr|^y$/.test(u) ? n * 12 : /minggu|week/.test(u) ? n / 4.345 : /hari|day/.test(u) ? n / 30.44 : n;
  return months > 0 && months <= 600 ? Math.round(months * 100) / 100 : undefined;
}
/** Term written in an account name: "Deposito 3 bulan", "(12 bln)", "1 tahun". */
export function tenorFromName(name: string): number | undefined {
  const m = name.match(/(\d{1,3})\s*(bulan|bln|months?|tahun|thn|years?)\b/i);
  return m ? parseTenor(m[0]) : undefined;
}
/** 3 → "3 mo", 12 → "1 yr", 18 → "18 mo", 24 → "2 yrs", 0.25 → "1 wk" */
export function fmtTenor(m?: number): string {
  if (!m) return '';
  if (m < 1) { const w = Math.round(m * 4.345); return w >= 1 ? `${w} wk` : `${Math.round(m * 30.44)} d`; }
  if (m % 12 === 0) return m === 12 ? '1 yr' : `${m / 12} yrs`;
  return `${Math.round(m * 10) / 10} mo`;
}
