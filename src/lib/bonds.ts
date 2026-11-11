/** Indonesian government bonds (SBN): FR / PBS (tradable), ORI / SR / ST / SBR (retail). */
export interface BondInfo { code: string; coupon?: number; maturity?: string; freq?: string }
/** Series confirmed from KSEI's register; others are recognised by name only (enter coupon / maturity yourself). */
const KNOWN: Record<string, Omit<BondInfo, 'code'>> = {
  FR0090: { coupon: 5.125, maturity: '2027-04-15', freq: 'semi-annual' }, // KSEI: OBLIGASI NEGARA RI SERI FR0090, fixed 5.125%, matures 15 Apr 2027
};
/** "FR090", "FR0090", "fr 90", "PBS 32", "ORI025", "SR021" → normalised series code. */
export function bondSeries(text: string): string | undefined {
  const m = text.toUpperCase().match(/\b(FR|PBS|ORI|SR|ST|SBR)\s?0*(\d{1,4})(T\d)?\b/);
  if (!m) return undefined;
  const n = m[2];
  const code = m[1] === 'FR' ? `FR${n.padStart(4, '0')}` : m[1] === 'PBS' ? `PBS${n.padStart(3, '0')}` : `${m[1]}${n.padStart(3, '0')}${m[3] || ''}`;
  return code;
}
export function bondInfo(text: string): BondInfo | undefined {
  const code = bondSeries(text); if (!code) return undefined;
  return { code, ...(KNOWN[code] || {}) };
}
/** "matures Apr 2027 · 5 mo left" */
export function maturityLabel(iso?: string, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const months = Math.round((d.getTime() - now.getTime()) / (30.44 * 864e5));
  const when = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  if (months < 0) return `matured ${when}`;
  return `matures ${when} · ${months >= 24 ? `${Math.floor(months / 12)} yrs` : `${months} mo`} left`;
}
