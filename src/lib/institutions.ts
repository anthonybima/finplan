import type { Account } from './types';
import { SOURCE_LABEL } from './holdings';

/** Which bank / app / insurer an account belongs to, from its name: used to group accounts in Wealth. */

// Order matters: investment apps and insurers before banks ("RDN IPOT BCA" → IPOT, "RDN Stockbit BCA" → Stockbit).
const LIST: [RegExp, string][] = [
  [/stock ?bit/i, 'Stockbit'], [/pluang/i, 'Pluang'], [/\bbibit\b/i, 'Bibit'], [/ajaib/i, 'Ajaib'], [/\bipot\b|indo ?premier/i, 'IPOT'],
  [/makmur/i, 'Makmur'], [/growin|mandiri sekuritas|\bmost\b/i, 'Mandiri'], [/mirae|hots/i, 'Mirae Asset'], [/bareksa/i, 'Bareksa'], [/tanamduit/i, 'Tanamduit'],
  [/bittime/i, 'Bittime'], [/bitget/i, 'Bitget'], [/indodax/i, 'Indodax'], [/binance/i, 'Binance'], [/rekeningku/i, 'Rekeningku.com'], [/tokocrypto/i, 'Tokocrypto'], [/\bpintu\b/i, 'Pintu'],
  [/alpaca/i, 'Alpaca'], [/treasury/i, 'Treasury'], [/pegadaian/i, 'Pegadaian'], [/antam|logam mulia/i, 'Antam'],
  [/allianz/i, 'Allianz'], [/chubb/i, 'Chubb'], [/msig/i, 'MSIG'], [/prudential/i, 'Prudential'], [/manulife/i, 'Manulife'], [/\baxa\b/i, 'AXA'], [/\baia\b/i, 'AIA'], [/sequis/i, 'Sequis'], [/\bfwd\b/i, 'FWD'], [/avrist/i, 'Avrist'], [/bpjs/i, 'BPJS'],
  [/gopay/i, 'GoPay'], [/\bovo\b/i, 'OVO'], [/shopee ?pay/i, 'ShopeePay'], [/link ?aja/i, 'LinkAja'], [/paypal/i, 'PayPal'], [/^(dana|e-?wallet dana)\b|\bdana e-?wallet/i, 'DANA'],
  [/neo ?bank|\bbnc\b/i, 'Neobank'], [/\bjago\b/i, 'Bank Jago'], [/jenius|btpn/i, 'Jenius (SMBC)'], [/sea ?bank/i, 'SeaBank'], [/\bkrom\b/i, 'Krom'], [/\bblu\b/i, 'blu (BCA Digital)'], [/\ballo\b/i, 'Allo Bank'], [/superbank/i, 'Superbank'], [/raya\b/i, 'Bank Raya'],
  [/mayapada/i, 'Mayapada'], [/danamon/i, 'Danamon'], [/\bpanin/i, 'Panin'], [/maybank/i, 'Maybank'], [/\bmega\b/i, 'Bank Mega'], [/\bdbs\b/i, 'DBS'], [/\bocbc\b/i, 'OCBC'], [/\buob\b/i, 'UOB'], [/hsbc/i, 'HSBC'], [/citi/i, 'Citibank'],
  [/cimb/i, 'CIMB Niaga'], [/permata/i, 'Permata'], [/\bbtn\b/i, 'BTN'], [/\bbsi\b|syariah indonesia/i, 'BSI'], [/\bbni\b/i, 'BNI'], [/\bbri\b/i, 'BRI'], [/mandiri/i, 'Mandiri'], [/\bbca\b/i, 'BCA'],
  [/\bbtpn|\bsinarmas|\bbukopin|\bkb ?bank/i, 'Other bank'],
];

export function detectInstitution(name: string): string | undefined {
  for (const [re, label] of LIST) if (re.test(name)) return label === 'Other bank' ? undefined : label;
  return undefined;
}

/** Bank / app an account belongs to: the group you set, the connected app for synced accounts, or detected from the name. */
export function groupOf(a: Account): string {
  if (a.group) return a.group;
  if (a.synced && SOURCE_LABEL[a.synced]) return SOURCE_LABEL[a.synced];
  return detectInstitution(a.name) || 'Other';
}

/** Names of groups already used, for suggestions. */
export const knownGroups = (names: (string | undefined)[]) => [...new Set(names.filter(Boolean) as string[])].sort();
