/**
 * Insurance policies: kept apart from accounts so they are NEVER added to net worth, totals, risk or allocation.
 * (A unit-link's investment part, if you want it counted, is tracked as a fund account.)
 */
import type { Account, AppData } from './types';
import { detectInstitution } from './institutions';

export type PolicyType = 'life' | 'health' | 'unitlink' | 'critical' | 'accident' | 'vehicle' | 'property' | 'travel' | 'other';
export type PremiumFreq = 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'single';
export interface Policy {
  id: string;
  name: string;            // "Chubb Life", "MSIG Vega Tradisional"
  insurer?: string;        // Chubb, MSIG, Allianz…
  type: PolicyType;
  policyNo?: string;
  insured?: string;        // who is covered
  coverage?: number;       // sum assured / uang pertanggungan (in `currency`)
  currency?: string;       // IDR default
  premium?: number;        // per `premiumFreq`
  premiumFreq?: PremiumFreq;
  opened?: string;         // year started
  endDate?: string;        // YYYY-MM-DD, policy end / maturity
  nextDue?: string;        // YYYY-MM-DD, next premium due
  notes?: string;
  status?: 'active' | 'lapsed' | 'ended';
  updatedAt: string;
}

export const POLICY_TYPES: [PolicyType, string][] = [['life', 'Life (jiwa)'], ['health', 'Health (kesehatan)'], ['unitlink', 'Unit-link'], ['critical', 'Critical illness'], ['accident', 'Accident'], ['vehicle', 'Vehicle'], ['property', 'Property / home'], ['travel', 'Travel'], ['other', 'Other']];
export const typeLabel = (t: PolicyType) => POLICY_TYPES.find(([k]) => k === t)?.[1] || 'Other';
export const FREQ: [PremiumFreq, string, number][] = [['monthly', 'per month', 12], ['quarterly', 'per quarter', 4], ['semiannual', 'per 6 months', 2], ['yearly', 'per year', 1], ['single', 'single premium', 0]];
export const perYear = (p: Policy) => (p.premium && p.premiumFreq !== 'single' ? p.premium * (FREQ.find(([f]) => f === (p.premiumFreq || 'monthly'))?.[2] ?? 12) : 0);

export const INSURANCE_RE = /asuransi|insurance|polis|\bbpjs\b|allianz|chubb|prudential|manulife|\baxa\b|msig|sequis|avrist|\bfwd\b|\baia\b|zurich|generali|cigna|bni life|sinarmas (msig )?life|equity life|jiwasraya|lippo insurance|tokio marine|great eastern/i;
export function guessPolicyType(name: string): PolicyType {
  const n = name.toLowerCase();
  if (/unit ?link|smart ?link|link\b/.test(n)) return 'unitlink';
  if (/kesehatan|health|medical|rawat|hospital|medika/.test(n)) return 'health';
  if (/kritis|critical/.test(n)) return 'critical';
  if (/kecelakaan|accident|\bpa\b/.test(n)) return 'accident';
  if (/kendaraan|mobil|motor|vehicle|\bcar\b|otomotif/.test(n)) return 'vehicle';
  if (/rumah|properti|property|kebakaran|fire|home/.test(n)) return 'property';
  if (/perjalanan|travel/.test(n)) return 'travel';
  if (/jiwa|life|tradisional|term/.test(n)) return 'life';
  return 'other';
}
/** A policy from an account-like row (import, or "move to Insurance"). */
export function policyFrom(a: { name: string; accountNo?: string; ref?: string; opened?: string; group?: string; monthlyPayment?: number; maturity?: string; currency?: string }, at: string): Omit<Policy, 'id'> {
  return {
    name: a.name, insurer: a.group || detectInstitution(a.name) || undefined, type: guessPolicyType(a.name),
    ...(a.accountNo || a.ref ? { policyNo: a.accountNo || a.ref } : {}), ...(a.opened ? { opened: a.opened } : {}),
    ...(a.monthlyPayment ? { premium: a.monthlyPayment, premiumFreq: 'monthly' as const } : {}), ...(a.maturity ? { endDate: a.maturity } : {}),
    ...(a.currency && a.currency !== 'IDR' ? { currency: a.currency } : {}), status: 'active', updatedAt: at,
  };
}
/** Accounts that look like pure insurance (no investment part) and hold no money: candidates to move to Insurance. */
export const insuranceLikeAccounts = (d: AppData) => d.accounts.filter((a) => !a.synced && INSURANCE_RE.test(a.name) && a.kind !== 'investment' && !a.balance); // unit-link funds stay counted
export function moveToInsurance(d: AppData, ids: string[], mkId: () => string, at: string): AppData {
  const move = d.accounts.filter((a) => ids.includes(a.id));
  const existing = d.policies || [];
  const add = move.filter((a) => !existing.some((p) => p.name === a.name || (p.policyNo && (p.policyNo === a.accountNo || p.policyNo === a.ref)))).map((a: Account) => ({ id: mkId(), ...policyFrom(a, at) }));
  return { ...d, accounts: d.accounts.filter((a) => !ids.includes(a.id)), policies: [...existing, ...add] };
}
