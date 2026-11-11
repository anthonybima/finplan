/**
 * Import data: portfolio (holdings) and accounts (balances) from CSV / Excel / JSON / pasted tables / screenshots.
 * Every path ends in rows the user reviews before anything is saved.
 */
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Account, AccountKind, AppData, AssetClass, Holding, Source } from './types';
import { uid } from './store';
import { today } from './format';
import { parseNumber, normaliseAI, brokerFrom, extractJSON, type ScanRow } from './smartScan';
import { syncAccounts } from './holdings';
import { normYear } from './wealthYears';
import { detectInstitution } from './institutions';
import { parseTenor, tenorFromName } from './tenor';
import { detectCurrency, toIdr } from './fx';
import { bondInfo } from './bonds';
import { policyFrom } from './insurance';

export type TableKind = 'portfolio' | 'accounts' | 'transactions' | 'unknown';
export interface Grid { name: string; headers: string[]; rows: string[][] }

const MAX_BYTES = 15 * 1024 * 1024;

/* ------------------------------------------------------------------ reading */

/** Read every table in a file: each Excel sheet, a CSV/TSV, or a JSON array/FinPlan file. */
export async function readGrids(file: File): Promise<{ grids: Grid[]; json?: any }> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 15 MB`);
  const n = file.name.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.ods')) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const grids = wb.SheetNames.map((sn) => {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }) as unknown[][];
      return toGrid(sn, raw.map((r) => r.map((c) => (c == null ? '' : String(c)))));
    }).filter((g): g is Grid => !!g);
    return { grids };
  }
  const text = (await file.text()).replace(/^﻿/, '');
  if (n.endsWith('.json') || /^\s*[[{]/.test(text)) {
    const j = JSON.parse(text);
    return { grids: [], json: j };
  }
  return { grids: textToGrids(text, file.name) };
}

/** Pasted text: a table copied from Excel/Sheets (tabs), CSV/semicolon text, or "name  amount" lines. */
export function textToGrids(text: string, name = 'Pasted'): Grid[] {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return [];
  const first = t.split(/\r?\n/)[0];
  const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : first.includes(',') && !/\d,\d{3}\b/.test(first) ? ',' : '');
  if (delim) {
    const res = Papa.parse<string[]>(t, { delimiter: delim, skipEmptyLines: true });
    const g = toGrid(name, res.data.map((r) => r.map((c) => (c ?? '').toString())));
    return g ? [g] : [];
  }
  // free lines: split on 2+ spaces, or "label  number" at the end of the line
  const rows = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/\s{2,}| \| /).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
    const m = l.match(/^(.*?)[\s:=]+(\(?[−–-]?(?:rp\.?\s?|\$|usd\s?|idr\s?)?[\d.,]+(?:\s?(?:jt|juta|rb|ribu|k|m|b|t))?\)?)$/i);
    return m ? [m[1].trim(), m[2]] : [l];
  });
  const g = toGrid(name, rows);
  return g ? [g] : [];
}

const HEADER_HINT = /(symbol|ticker|kode|coin|aset|asset|saham|qty|quantity|lot|shares|unit|avg|average|harga|price|last|account|akun|rekening|bank|wallet|dompet|saldo|balance|nama|name|nilai|value|amount|jumlah|type|jenis|kind|currency|mata uang|bunga|rate|cicilan|installment|outstanding|tanggal|date|keterangan|description)/i;

function toGrid(name: string, raw: string[][]): Grid | null {
  const grid = raw.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!grid.length) return null;
  let h = 0, best = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const textCells = grid[i].filter((c) => c.trim() && parseNumber(c) == null);
    const score = grid[i].filter((c) => HEADER_HINT.test(c)).length * 2 + (textCells.length === grid[i].filter((c) => c.trim()).length ? 1 : 0);
    if (score > best) { best = score; h = i; }
    if (score >= 6) break;
  }
  let headers = grid[h].map((c, i) => c.trim() || `Column ${i + 1}`);
  let rows = grid.slice(h + 1);
  // no recognisable header (e.g. pasted "BCA  15.000.000" lines) → synthesise one
  if (best < 2 && !grid[h].some((c) => HEADER_HINT.test(c))) {
    const w = Math.max(...grid.map((r) => r.length));
    headers = Array.from({ length: w }, (_, i) => `Column ${i + 1}`);
    rows = grid;
  }
  const w = headers.length;
  return { name, headers, rows: rows.map((r) => Array.from({ length: w }, (_, i) => (r[i] ?? '').toString().trim())) };
}

/* ------------------------------------------------------------------ detection & mapping */

const P = {
  symbol: /^(symbol|ticker|kode( saham| efek)?|code|stock|saham|coin|koin|aset kode|instrument|instrumen)$/i,
  name: /^(name|nama|nama (aset|saham|efek|produk)|description|deskripsi|asset|aset|product|produk)$/i,
  qty: /^(qty|quantity|shares|lembar|units?|amount|jumlah( lembar| unit)?|balance|holding|volume|vol|available|tersedia)$/i,
  lot: /^(lots?|jumlah lot|qty \(lot\)|lot qty)$/i,
  avg: /^(avg|average|avg\.? ?price|average price|avg\.? cost|cost|harga rata-?rata|harga beli|buy price|entry|modal per unit)$/i,
  price: /^(price|last|last price|harga|harga (terakhir|pasar|kini)|close|market price|current price|nav)$/i,
  value: /^(value|market value|nilai|nilai pasar|total value|total|valuation|est\.? value|saldo)$/i,
  currency: /^(currency|ccy|cur|mata uang|valas)$/i,
  cls: /^(asset class|class|type|jenis|kategori|category|tipe)$/i,
  market: /^(market|exchange|bursa|pasar)$/i,
  source: /^(broker|platform|app|aplikasi|sekuritas|source|sumber|exchange)$/i,
  // accounts
  account: /^(account|akun|account name|nama akun|nama rekening|rekening|bank|wallet|e-?wallet|dompet|nama|name|institution|institusi|nama investasi|investasi|nama produk|produk|nama aset|aset|asset)$/i,
  acctNo: /^(nomor rekening|no\.? ?rek(ening)?\.?|no\.? ?rekening|nomor akun|no\.? ?akun|account (no|number)\.?|acc(ount)?\.? ?no\.?|nomor (polis|kontrak|bilyet)|no\.? ?polis|cif|sid)( ?\(.*\))?$/i,
  owner: /^(nama pemilik|pemilik|owner|atas nama|a\/n|account holder|holder|nama nasabah)$/i,
  status: /^(status|keadaan)$/i,
  tenor: /^(duration|durasi|tenor|term|jangka waktu|jangka|jk\.? waktu|lama|period[e]?|duration \(months\)|tenor \(bulan\))( ?\(.*\))?$/i,
  group: /^(bank ?\/ ?app|group|grup|kelompok|bank \/ aplikasi)$/i,
  balance: /^(balance|saldo|saldo akhir|amount|jumlah|nilai|value|outstanding|sisa( pinjaman| hutang)?|total)$/i,
  kind: /^(type|jenis|kind|tipe|category|kategori|account type|jenis akun)$/i,
  rate: /^(interest|bunga|suku bunga|rate|apr)\b/i,
  payment: /^(installment|cicilan|monthly payment|angsuran|payment)\b/i,
  opened: /^(since|sejak|opened|open(ed)? (date|year|since)|year opened|tahun( buka| dibuka| beli| mulai| perolehan)?|perolehan|tanggal perolehan|dibuka|tanggal (buka|beli|mulai)|first buy|first bought|buy date|start(ed)?( year| date)?|year)$/i,
};
const find = (headers: string[], re: RegExp, taken: Set<number> = new Set()) => headers.findIndex((h, i) => !taken.has(i) && re.test(h.trim().replace(/\s+/g, ' ')));

export interface PortfolioMap { symbol: number; name: number; qty: number; lot: number; avg: number; price: number; value: number; currency: number; cls: number; market: number; source: number; opened: number }
export interface AccountMap { name: number; balance: number; kind: number; currency: number; rate: number; payment: number; opened: number; acctNo: number; owner: number; status: number; group: number; tenor: number }

export function detectKind(g: Grid): TableKind {
  const h = g.headers;
  const has = (re: RegExp) => h.some((x) => re.test(x.trim()));
  const port = [P.symbol, P.qty, P.lot, P.avg, P.price].filter(has).length + (has(P.symbol) ? 2 : 0);
  const acct = [P.account, P.balance, P.kind, P.rate, P.payment, P.owner].filter(has).length + (has(/^(saldo|balance|account|akun|rekening)$/i) || has(P.acctNo) ? 2 : 0);
  const txn = has(/^(tanggal|tgl|date|transaction date)$/i) && has(/(keterangan|description|debit|kredit|credit|mutasi)/i) ? 5 : 0;
  if (txn >= 5 && txn >= port && txn >= acct) return 'transactions';
  if (port >= 3 && port >= acct) return 'portfolio';
  if (acct >= 2) return 'accounts';
  // headerless pasted lines: "BCA  15.000.000" → accounts; "BBCA 10 9.100" → portfolio
  if (g.headers.every((x) => /^Column \d+$/.test(x)) && g.rows.length) {
    const r = g.rows[0];
    const nums = r.filter((c) => parseNumber(c) != null).length;
    if (nums === 1 && r.length === 2) return 'accounts';
    if (nums >= 2 && /^[A-Z]{2,6}$/.test(r[0])) return 'portfolio';
  }
  return 'unknown';
}

export function guessPortfolioMap(h: string[]): PortfolioMap {
  const t = new Set<number>(); const f = (re: RegExp) => { const i = find(h, re, t); if (i >= 0) t.add(i); return i; };
  const opened = f(P.opened), symbol = f(P.symbol), lot = f(P.lot), avg = f(P.avg), price = f(P.price), qty = f(P.qty), value = f(P.value), currency = f(P.currency), cls = f(P.cls), market = f(P.market), source = f(P.source), name = f(P.name);
  if (symbol < 0 && h.every((x) => /^Column \d+$/.test(x))) return { symbol: 0, name: -1, qty: 1, lot: -1, avg: h.length > 2 ? 2 : -1, price: h.length > 3 ? 3 : -1, value: h.length > 4 ? 4 : -1, currency: -1, cls: -1, market: -1, source: -1, opened: -1 };
  return { symbol, name, qty, lot, avg, price, value, currency, cls, market, source, opened };
}

export function guessAccountMap(h: string[]): AccountMap {
  const t = new Set<number>(); const f = (re: RegExp) => { const i = find(h, re, t); if (i >= 0) t.add(i); return i; };
  const tenor = f(P.tenor), group = f(P.group), acctNo = f(P.acctNo), owner = f(P.owner), status = f(P.status), opened = f(P.opened), kind = f(P.kind), currency = f(P.currency), rate = f(P.rate), payment = f(P.payment), balance = f(P.balance), name = f(P.account);
  if (name < 0 && balance < 0 && h.every((x) => /^Column \d+$/.test(x))) return { name: 0, balance: h.length - 1, kind: -1, currency: -1, rate: -1, payment: -1, opened: -1, acctNo: -1, owner: -1, status: -1, group: -1, tenor: -1 };
  return { name: name >= 0 ? name : 0, balance, kind, currency, rate, payment, opened, acctNo, owner, status, group, tenor };
}

/* ------------------------------------------------------------------ portfolio rows */

const CLS: Record<string, Holding['assetClass']> = {
  stock: 'stock', saham: 'stock', equity: 'stock', etf: 'stock', 'us stock': 'stock', 'us stocks': 'stock', 'global equity': 'stock', crypto: 'crypto', kripto: 'crypto', cryptocurrency: 'crypto',
  gold: 'gold', emas: 'gold', bond: 'bond', obligasi: 'bond', sbn: 'bond', sbr: 'bond', ori: 'bond', fund: 'mutualfund', 'mutual fund': 'mutualfund', reksadana: 'mutualfund', 'reksa dana': 'mutualfund',
  cash: 'cash', kas: 'cash', deposit: 'deposit', deposito: 'deposit', rdpu: 'deposit', property: 'property', properti: 'property',
};
const CRYPTO_RE = /^(BTC|ETH|USDT|USDC|BNB|SOL|XRP|ADA|DOGE|TRX|TON|DOT|AVAX|LINK|MATIC|POL|SHIB|LTC|BCH|UNI|ATOM|XLM|NEAR|APT|ARB|OP|SUI|PEPE)$/;

export function gridToPortfolio(g: Grid, m: PortfolioMap): ScanRow[] {
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const num = (r: string[], i: number) => (i >= 0 ? parseNumber(cell(r, i).replace(/\s/g, '')) ?? 0 : 0);
  const out: any[] = [];
  for (const r of g.rows) {
    const sym = cell(r, m.symbol).toUpperCase().replace(/^(IDX|NASDAQ|NYSE|AMEX|BINANCE|BITGET):/, '').replace(/\.JK$/, '').replace(/[/-](IDR|USDT|USD)$/, '').trim();
    if (!sym || /^(TOTAL|SUBTOTAL|JUMLAH|GRAND TOTAL)$/i.test(sym)) continue;
    const lots = num(r, m.lot), q = num(r, m.qty);
    const curRaw = cell(r, m.currency).toUpperCase();
    const priceTxt = `${cell(r, m.price)} ${cell(r, m.avg)} ${cell(r, m.value)}`;
    const currency = curRaw ? (curRaw.includes('USD') ? 'USD' : 'IDR') : /\$|usd/i.test(priceTxt) ? 'USD' : /^[A-Z]{4}$/.test(sym) && !CRYPTO_RE.test(sym) ? 'IDR' : /rp|idr/i.test(priceTxt) ? 'IDR' : CRYPTO_RE.test(sym) ? 'IDR' : 'USD';
    const clsTxt = cell(r, m.cls).toLowerCase();
    const assetClass = CLS[clsTxt] || (CRYPTO_RE.test(sym) || /crypto|kripto/.test(clsTxt) ? 'crypto' : /reksa|fund/.test(clsTxt) ? 'mutualfund' : /emas|gold/.test(clsTxt) ? 'gold' : /obligasi|bond|sbn/.test(clsTxt) ? 'bond' : 'stock');
    const mk = cell(r, m.market).toUpperCase();
    out.push({
      symbol: sym, name: cell(r, m.name) || sym, assetClass,
      market: /IDX|BEI|IDN|INDONESIA/.test(mk) ? 'IDX' : /NASDAQ|NYSE|US|AMEX/.test(mk) ? 'US' : /CRYPTO|KRIPTO/.test(mk) ? 'CRYPTO' : undefined,
      qty: lots && !q ? lots : q, qtyUnit: lots && !q ? 'lots' : assetClass === 'crypto' ? 'units' : 'shares',
      avgPrice: num(r, m.avg), price: num(r, m.price), value: num(r, m.value), pnl: null, currency, opened: normYear(cell(r, m.opened)),
    });
  }
  return normaliseAI({ rows: out }).rows;
}

/** The portfolio's broker/app when the file has a Broker/Platform column with one value. */
export function sourceFromGrid(g: Grid, m: PortfolioMap, hint = ''): Source | null {
  if (m.source >= 0) {
    const vals = new Set(g.rows.map((r) => (r[m.source] || '').toLowerCase()).filter(Boolean));
    if (vals.size === 1) return brokerFrom([...vals][0], hint);
  }
  return brokerFrom(g.name, hint);
}

/* ------------------------------------------------------------------ account rows */

export interface AccountRow {
  key: string; include: boolean;
  name: string; kind: AccountKind; assetClass?: AssetClass;
  balance: number; currency: string; // balance is in `currency` (USD, SGD…); converted to rupiah on save
  rate?: number; payment?: number; opened?: string;
  match: string; // existing account id, or 'new'
  tenor?: number;        // duration in months (deposits, bonds, loans)
  maturity?: string;     // bonds: maturity date (known series)
  accountNo?: string;    // full account number from the file (blank when the file only has the last 4)
  ref?: string;          // masked label: last 4 characters ("···9990")
  group?: string;        // bank / app / insurer, for grouping in Wealth
  needsBalance?: boolean; // the source had no balance: enter it later (monthly update)
  original?: string;     // the name as written in the file
  notes?: string[];      // why a row is unticked or needs attention
  insurance?: boolean;   // saved to Insurance (a policy), not as an account: never counted in net worth
}

type KindRule = [RegExp, AccountKind, AssetClass?, string?]; // [pattern, kind, class, reason to leave unticked]
const KIND_WORDS: KindRule[] = [
  [/(asuransi|insurance|allianz|chubb|prudential|manulife|\baxa\b|msig|sequis|avrist|\bfwd\b|\baia\b).*(unit ?link|smart ?link|link\b|fund|investa)|(unit ?link|smart ?link).*(asuransi|insurance)/i, 'investment', 'mutualfund'],
  [/asuransi|insurance|polis|bpjs/i, 'asset', 'property', '__insurance'],
  [/kartu kredit|credit card|\bcc\b|paylater|pay later|kredivo|akulaku|spaylater|gopaylater|pinjaman|loan|\bkpr\b|\bkta\b|cicilan|hutang|utang|debt|leasing|multifinance|mortgage/i, 'debt'],
  [/brankas|safe deposit|safe ?box|sdb\b/i, 'asset', 'gold', 'Safe deposit box: tick it and enter the value of what is inside to track it.'],
  [/deposito|time deposit|bilyet|\bdeposit\b/i, 'investment', 'deposit'],
  [/reksa ?dana|mutual fund|\brdpu\b|\brdpt\b|money market|\bbibit\b|makmur|bareksa|tanamduit/i, 'investment', 'mutualfund'],
  [/\bsbn\b|\bori\s?\d*\b|\bsr\s?\d*\b|\bsbr\s?\d*\b|\bst\s?\d+\b|\bfr\s?\d{2,4}\b|\bpbs\s?\d{2,3}\b|obligasi|bond|sukuk/i, 'investment', 'bond'],
  [/emas|gold|antam|logam mulia|treasury|pegadaian/i, 'investment', 'gold'],
  [/crypto|kripto|indodax|tokocrypto|pintu|bitget|bittime|binance|rekeningku/i, 'investment', 'crypto'],
  [/\brdn\b/i, 'investment', 'cash'],
  [/saham|stock|sekuritas|securities|ajaib|stockbit|ipot|indo ?premier|pluang|growin|mirae|\bhots\b/i, 'investment', 'stock'],
  [/rumah|apartemen|apartment|tanah|property|properti|mobil|motor|\bcar\b|kendaraan|vehicle/i, 'asset', 'property'],
  [/tabungan|giro|rekening|savings|checking|payroll|\bbank\b|\bbca\b|mandiri|\bbri\b|\bbni\b|\bbtn\b|\bbsi\b|cimb|danamon|permata|ocbc|maybank|panin|mayapada|\bmega\b|\bjago\b|jenius|sea ?bank|\bblu\b|neo ?bank|\ballo\b|superbank|\bkrom\b|\buob\b|hsbc|\bdbs\b|citibank/i, 'bank'],
  [/gopay|\bovo\b|\bdana\b|shopee ?pay|link ?aja|paypal|\bwise\b|e-?wallet|dompet digital|\bflip\b|astrapay|i\.saku|isaku|sakuku|doku/i, 'ewallet'],
  [/\bcash\b|tunai|uang tunai|dompet\b|\bkas\b|petty/i, 'cash'],
];
const KIND_ALIAS: Record<string, AccountKind> = { bank: 'bank', tabungan: 'bank', rekening: 'bank', ewallet: 'ewallet', 'e-wallet': 'ewallet', wallet: 'ewallet', cash: 'cash', tunai: 'cash', investment: 'investment', investasi: 'investment', asset: 'asset', aset: 'asset', harta: 'asset', debt: 'debt', hutang: 'debt', utang: 'debt', pinjaman: 'debt', loan: 'debt', liability: 'debt', kewajiban: 'debt' };

export function inferKind(name: string, typeText = ''): { kind: AccountKind; assetClass?: AssetClass; exclude?: string } {
  const t = typeText.toLowerCase().trim();
  if (KIND_ALIAS[t]) {
    const k = KIND_ALIAS[t];
    if (k === 'investment' || k === 'asset') { const hit = KIND_WORDS.find(([re, kk]) => (kk === 'investment' || kk === 'asset') && re.test(name)); return { kind: k, assetClass: hit?.[2] || (k === 'asset' ? 'property' : 'mutualfund') }; }
    return { kind: k };
  }
  const s = `${name} ${typeText}`;
  for (const [re, kind, cls, why] of KIND_WORDS) if (re.test(s)) return { kind, assetClass: cls, exclude: why };
  return { kind: 'bank' };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function matchAccount(name: string, accounts: Account[], ref?: string, group?: string): string {
  const manual = accounts.filter((a) => !a.synced);
  if (ref) { const byRef = manual.filter((a) => a.ref === ref && (!group || !a.group || a.group === group)); if (byRef.length === 1) return byRef[0].id; }
  const n = norm(name);
  if (!n) return 'new';
  const exact = manual.filter((a) => norm(a.name) === n && (!ref || !a.ref || a.ref === ref));
  if (exact.length === 1) return exact[0].id;
  const loose = manual.filter((a) => { const x = norm(a.name); return x.length >= 3 && (x.includes(n) || n.includes(x)) && (!ref || !a.ref || a.ref === ref); });
  return loose.length === 1 ? loose[0].id : 'new';
}

/* ---- name clean-up: "Tabungan BCA - Anthony Bima Wijaya" → "Tabungan BCA" ---- */
const ACRONYMS = new Set('BCA BRI BNI BTN BSI DBS UOB OCBC HSBC CIMB RDN RDPU USD SGD IDR JPY EUR MSIG IPOT AXA AIA FWD SBN ORI SBR KPR KTA BPJS ETF US IB II III SDB BNC'.split(' '));
const titleWord = (w: string) => (ACRONYMS.has(w.toUpperCase().replace(/[^A-Z]/g, '')) && w.length <= 5 ? w.toUpperCase() : w.length <= 1 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase());
export function cleanAccountName(raw: string, owner = ''): string {
  let s = ` ${raw} `;
  s = s.replace(/\s(a\/n|an\.|atas nama)\s+[^\s()]+/gi, ' ');
  const tokens = owner.trim().split(/\s+/).filter((x) => x.length > 1);
  if (tokens.length) {
    const seq = tokens.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const before = s;
    s = s.replace(new RegExp(`\\s${seq}(\\s+(?!bank\\b|tabungan\\b|deposito\\b|rdn\\b|investasi\\b)[A-Za-z]{3,})?(?=[\\s()/-]|$)`, 'gi'), ' ');
    if (s === before) s = s.replace(new RegExp(`\\s${tokens[0]}\\s*$`, 'i'), ' ');
  }
  s = s.replace(/^\s*investasi lainnya\s+/i, ' ').replace(/\(\s*(bunga|rate|interest)\s*[\d.,]+\s*%\s*\)/gi, ' ').replace(/\s\/\s/g, ' ');
  s = s.replace(/\s+[-–/]\s*(?=[-–/(]|$)/g, ' ').replace(/\s+[-–/]\s*$/, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim().replace(/^[-–/,\s]+|[-–/,\s]+$/g, '');
  if (!s) s = raw.trim();
  const words = s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  const caps = words.filter((w) => w === w.toUpperCase()).length;
  if (words.length && caps * 2 >= words.length) s = s.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : /[a-z]/.test(w) ? (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w) : titleWord(w))).join('');
  return s;
}

const looksLikeId = (c: string) => /^\s*[0-9]{8,}\s*$/.test(c) || /[A-Za-z].*\d|\d.*[A-Za-z]/.test(c) || /^\s*(19[5-9]\d|20\d\d)\s*$/.test(c);
const sigTokens = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !/^(tabungan|investasi|investment|bank|digital|rekening|account|deposito|bilyet|indonesia|the|dan|and|of|3|bulan|bunga|6|5|insurance|asuransi|life)$/.test(w)));
const BROKER_SOURCE: [RegExp, Source][] = [[/stock ?bit/i, 'stockbit'], [/pluang/i, 'pluang'], [/bittime/i, 'bittime'], [/bitget/i, 'bitget'], [/alpaca/i, 'alpaca']];

export function gridToAccounts(g: Grid, m: AccountMap, d: AppData): AccountRow[] {
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const listMode = m.acctNo >= 0 || m.owner >= 0 || m.status >= 0 || (m.opened >= 0 && m.balance < 0);
  const skipCols = new Set([m.tenor, m.group, m.name, m.acctNo, m.owner, m.status, m.opened, m.rate, m.payment, m.kind, m.currency].filter((i) => i >= 0));
  // main owner = the most common owner name in the file
  const owners = new Map<string, number>(); if (m.owner >= 0) for (const r of g.rows) { const o = cell(r, m.owner).toUpperCase(); if (o) owners.set(o, (owners.get(o) || 0) + 1); }
  const mainOwner = [...owners.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const out: (AccountRow & { _no: string })[] = [];
  for (const r of g.rows) {
    const original = cell(r, m.name);
    if (!original || /^(total|subtotal|jumlah|grand total|net worth|kekayaan bersih)$/i.test(original)) continue;
    const owner = cell(r, m.owner);
    const notes: string[] = [];
    let include = true;
    // balance: the Balance column, else the last amount-looking cell (never an account number, ID or year)
    let raw = m.balance >= 0 ? cell(r, m.balance) : '';
    if (!raw && m.balance < 0) raw = r.filter((c, i) => !skipCols.has(i) && c.trim() && !looksLikeId(c) && parseNumber(c.replace(/\s/g, '')) != null).pop() || '';
    const n = raw ? parseNumber(raw.replace(/\s/g, '')) : null;
    let needsBalance = false;
    if (n == null) { if (!listMode) continue; needsBalance = true; }
    const { kind, assetClass, exclude } = inferKind(original, cell(r, m.kind));
    const debtByType = /debt|hutang|utang|pinjaman|loan|liabil|kewajiban/i.test(cell(r, m.kind));
    const isDebt = kind === 'debt' || debtByType || (n != null && n < 0 && kind !== 'bank' && kind !== 'ewallet' && kind !== 'cash');
    let name = cleanAccountName(original, owner || mainOwner);
    if (owner && mainOwner && owner.toUpperCase() !== mainOwner) { name += ` (a/n ${cleanAccountName(owner)})`; include = false; notes.push(`Owner: ${cleanAccountName(owner)}, not ${cleanAccountName(mainOwner)}. Tick it if you manage this money.`); }
    const status = cell(r, m.status);
    if (status && (/^(non|tidak|in)aktif|tutup|closed|inactive|ditutup|cair|matured/i.test(status))) { include = false; notes.push(`Status: ${status}`); }
    const isIns = exclude === '__insurance';
    if (isIns) notes.push('Insurance: saved to the Insurance section (not counted in net worth).');
    else if (exclude) { include = false; notes.push(exclude); }
    const ccy = detectCurrency(cell(r, m.currency)) || detectCurrency(raw) || detectCurrency(original) || (/\$/.test(raw) ? 'USD' : 'IDR');
    if (ccy !== 'IDR') notes.push(`${ccy} account: balance in ${ccy}, counted in rupiah at the ${ccy}/IDR rate.`);
    const bond = bondInfo(original);
    const rateCol = m.rate >= 0 ? parseNumber(cell(r, m.rate).replace('%', '')) ?? undefined : undefined;
    const rateName = original.match(/(?:bunga|rate|interest)\s*([\d]+(?:[.,]\d+)?)\s*%/i) || original.match(/([\d]+(?:[.,]\d+)?)\s*%/);
    const rate = rateCol ?? (rateName ? Number(rateName[1].replace(',', '.')) : bond?.coupon);
    const pay = m.payment >= 0 ? parseNumber(cell(r, m.payment)) ?? undefined : undefined;
    const no = cell(r, m.acctNo).replace(/[^A-Za-z0-9]/g, '');
    const ref = no.length >= 4 ? `···${no.slice(-4)}` : undefined;
    const group = cell(r, m.group) || detectInstitution(original);
    const src = BROKER_SOURCE.find(([re]) => re.test(original))?.[1];
    if (src && !/\brdn\b/i.test(original) && d.holdings.some((h) => h.source === src)) { include = false; notes.push(`Already tracked in Connections (${src[0].toUpperCase() + src.slice(1)}); importing it would count it twice.`); }
    if (needsBalance) notes.push('No balance in the file: enter it after import.');
    out.push({
      key: uid(), include, name, original, kind: isDebt ? 'debt' : kind, assetClass: isDebt ? undefined : assetClass,
      balance: n == null ? 0 : Math.abs(n), currency: ccy, rate, payment: pay, opened: normYear(cell(r, m.opened)),
      ...(isIns ? { insurance: true } : {}), ref, tenor: parseTenor(cell(r, m.tenor)) ?? tenorFromName(original), maturity: bond?.maturity, accountNo: no.length > 4 ? no : undefined, group, needsBalance: needsBalance || undefined, notes: notes.length ? notes : undefined, match: matchAccount(name, d.accounts, ref, group), _no: no,
    });
  }
  // the same account listed twice (same number, similar name) → keep the first
  for (let i = 0; i < out.length; i++) for (let j = 0; j < i; j++) {
    const a = out[j], b = out[i];
    if (!b.include || !a._no || a._no !== b._no || a._no.length < 4 || /^(IDD|SID)/i.test(a._no)) continue; // a SID is shared by all brokers
    const ta = sigTokens(a.name), tb = sigTokens(b.name); // owner names already removed
    const common = [...ta].filter((x) => tb.has(x)).length;
    if (common >= 2) { b.include = false; b.notes = [...(b.notes || []), `Same account number as “${a.name}” (listed twice).`]; break; }
  }
  // same name used for different accounts → add the last 4 digits ("Tabungan BCA ···9990")
  const count = new Map<string, number>(); for (const r of out) count.set(r.name.toLowerCase(), (count.get(r.name.toLowerCase()) || 0) + 1);
  for (const r of out) if ((count.get(r.name.toLowerCase()) || 0) > 1 && r.ref) { r.name = `${r.name} ${r.ref}`; r.match = matchAccount(r.name, d.accounts, r.ref, r.group); }
  return out.map(({ _no, ...r }) => r);
}

/** Apply reviewed account rows: update matched accounts, add new ones. USD balances are converted at the app's USD/IDR rate. */
export function applyAccounts(d: AppData, rows: AccountRow[]): { data: AppData; updated: number; added: number; needBalance: string[]; insured: number } {
  const t = today(); let updated = 0, added = 0; const needBalance: string[] = [];
  const accounts = d.accounts.map((a) => ({ ...a }));
  const policies = [...(d.policies || [])]; let insured = 0;
  for (const r of rows.filter((x) => x.include && x.insurance)) { // insurance rows → policies (never in net worth)
    if (policies.some((p) => p.name === r.name || (!!r.accountNo && p.policyNo === r.accountNo))) continue;
    policies.push({ id: uid(), ...policyFrom(r, t) }); insured++;
  }
  rows = rows.filter((x) => !x.insurance);
  for (const r of rows.filter((x) => x.include)) {
    const ccy = (r.currency || 'IDR').toUpperCase(); const fx = ccy !== 'IDR';
    const bal = fx ? toIdr(d.settings, ccy, r.balance) : r.balance;
    const unknown = !!r.needsBalance && !r.balance;
    const ex = r.match !== 'new' ? accounts.find((a) => a.id === r.match && !a.synced) : undefined;
    const extra = { ...(r.rate != null ? { interestRate: r.rate } : {}), ...(r.payment != null ? { monthlyPayment: r.payment } : {}), ...(r.opened ? { opened: r.opened } : {}), ...(r.ref ? { ref: r.ref } : {}), ...(r.accountNo ? { accountNo: r.accountNo } : {}), ...(r.tenor ? { tenorMonths: r.tenor } : {}), ...(r.maturity ? { maturity: r.maturity } : {}), ...(r.group ? { group: r.group } : {}), ...(fx ? { currency: ccy } : {}) };
    if (ex) {
      Object.assign(ex, { kind: r.kind, ...(r.assetClass ? { assetClass: r.assetClass } : {}), ...extra }, fx ? {} : { currency: undefined, fxBalance: undefined }, unknown ? {} : { balance: bal, updatedAt: t, needsBalance: undefined, ...(fx ? { fxBalance: r.balance } : {}) });
      updated++; if (unknown && ex.needsBalance) needBalance.push(ex.id);
    } else {
      const id = uid();
      accounts.push({ id, name: r.name, kind: r.kind, balance: unknown ? 0 : bal, updatedAt: unknown ? '' : t, ...(unknown ? { needsBalance: true } : fx ? { fxBalance: r.balance } : {}), ...(r.kind === 'investment' || r.kind === 'asset' ? { assetClass: r.assetClass || (r.kind === 'asset' ? 'property' : 'mutualfund') } : {}), ...extra });
      added++; if (unknown) needBalance.push(id);
    }
  }
  return { data: syncAccounts({ ...d, accounts, ...(policies.length ? { policies } : {}) }), updated, added, needBalance, insured };
}

/* ------------------------------------------------------------------ JSON */

/** FinPlan holdings snapshot, or a plain JSON array of holdings / accounts objects. */
export function jsonToTables(j: any, d: AppData): { portfolio?: ScanRow[]; source?: Source | null; accounts?: AccountRow[] } {
  if (j?.format === 'finplan-holdings' && Array.isArray(j.holdings)) {
    const rows = normaliseAI({ rows: j.holdings.map((h: any) => ({ ...h, qtyUnit: 'shares', value: 0, pnl: null })) }).rows;
    return { portfolio: rows, source: j.source || null };
  }
  if (j?.format === 'finplan-backup' || j?.v === 1 && j?.salt) throw new Error('This is a FinPlan backup. Use Settings → Restore backup.');
  const arr: any[] = Array.isArray(j) ? j : Array.isArray(j?.holdings) ? j.holdings : Array.isArray(j?.accounts) ? j.accounts : Array.isArray(j?.rows) ? j.rows : [];
  if (!arr.length || typeof arr[0] !== 'object') throw new Error('No rows found in this JSON file.');
  const headers = [...new Set(arr.flatMap((o) => Object.keys(o)))];
  const g: Grid = { name: 'JSON', headers, rows: arr.map((o) => headers.map((h) => (o[h] == null ? '' : String(o[h])))) };
  const k = detectKind(g);
  if (k === 'portfolio') { const m = guessPortfolioMap(headers); return { portfolio: gridToPortfolio(g, m), source: sourceFromGrid(g, m) }; }
  if (k === 'accounts') return { accounts: gridToAccounts(g, guessAccountMap(headers), d) };
  throw new Error('Could not tell whether this JSON holds a portfolio or accounts.');
}

/* ------------------------------------------------------------------ screenshots of account balances */

export function accountsPrompt(text: string) {
  return `You read screenshots or statements from banking, e-wallet, investment or loan apps and list each ACCOUNT BALANCE.
Rules:
- One entry per account / wallet / card / loan. Ignore transactions, promos, menus.
- Copy numbers exactly; convert Indonesian formatting (1.234.567,5) to plain numbers. Expand jt/rb/K/M suffixes.
- kind: "bank" (savings/current), "ewallet" (GoPay, OVO, DANA, ShopeePay…), "cash", "investment" (funds, deposits, bonds, gold, RDN), "asset" (property, vehicle), "debt" (credit card bill, loan, paylater; balance = amount owed, positive).
- assetClass only for investment/asset: deposit|bond|stock|mutualfund|crypto|gold|property.
Reply with ONLY JSON: {"accounts":[{"name":"BCA Tahapan","kind":"bank","assetClass":null,"balance":15000000,"currency":"IDR","interestRate":null,"monthlyPayment":null,"opened":null}]} (opened = year the account was opened, only if shown)
${text ? `\nText provided by the user:\n"""\n${text.slice(0, 40000)}\n"""` : ''}`;
}
export function aiToAccounts(raw: any, d: AppData): AccountRow[] {
  const list: any[] = (typeof raw === 'string' ? extractJSON(raw) : raw)?.accounts || (Array.isArray(raw) ? raw : []);
  return list.filter((a) => a && a.name && a.balance != null).map((a) => {
    const n = typeof a.balance === 'number' ? a.balance : parseNumber(String(a.balance)) ?? 0;
    const kinds: AccountKind[] = ['bank', 'ewallet', 'cash', 'investment', 'asset', 'debt'];
    const kind: AccountKind = kinds.includes(a.kind) ? a.kind : inferKind(String(a.name)).kind;
    return { key: uid(), include: true, name: String(a.name), kind, assetClass: a.assetClass || undefined, balance: Math.abs(n), currency: detectCurrency(String(a.currency || '')) || 'IDR', rate: a.interestRate ?? undefined, payment: a.monthlyPayment ?? undefined, opened: normYear(a.opened), match: matchAccount(String(a.name), d.accounts) } as AccountRow;
  });
}

/* ------------------------------------------------------------------ templates & export */

const ACCOUNT_HEADERS = ['Account', 'Type', 'Balance', 'Currency', 'Interest %', 'Monthly payment', 'Since', 'Account no.', 'Bank / app', 'Duration (months)'];
const PORT_HEADERS = ['Symbol', 'Name', 'Qty', 'Lot', 'Avg price', 'Price', 'Currency', 'Asset class', 'Broker', 'Since'];
const KIND_OUT: Record<AccountKind, string> = { bank: 'bank', ewallet: 'ewallet', cash: 'cash', investment: 'investment', asset: 'asset', debt: 'debt' };

export function accountsSheet(d?: AppData): (string | number)[][] {
  const rows = d ? d.accounts.filter((a) => !a.synced).map((a) => [a.name, KIND_OUT[a.kind], a.currency && a.currency !== 'IDR' ? a.fxBalance ?? 0 : a.balance, a.currency || 'IDR', a.interestRate ?? '', a.monthlyPayment ?? '', a.opened ?? '', a.accountNo || (a.ref ?? ''), a.group ?? '', a.tenorMonths ?? ''])
    : [['BCA Tahapan', 'bank', 15000000, 'IDR', '', '', 2016, '', '', ''], ['GoPay', 'ewallet', 650000, 'IDR', '', '', 2019, '', '', ''], ['Cash wallet', 'cash', 400000, 'IDR', '', '', '', '', '', ''], ['Deposito BCA 3 bulan', 'investment', 25000000, 'IDR', 4.25, '', 2023, '', 'BCA', 3], ['Reksa dana pasar uang', 'investment', 12000000, 'IDR', '', '', 2021, '', '', ''], ['Car loan', 'debt', 42000000, 'IDR', 6.5, 2100000, 2024, '', '', ''], ['Credit card', 'debt', 3200000, 'IDR', 21, '', 2018, '', '', '']];
  return [ACCOUNT_HEADERS, ...rows];
}
export function portfolioSheet(d?: AppData): (string | number)[][] {
  const rows = d ? d.holdings.map((h) => [h.symbol, h.name, h.market === 'IDX' ? '' : h.qty, h.market === 'IDX' ? h.qty / 100 : '', h.avgPrice, h.price, h.currency, h.assetClass, h.source, h.opened ?? ''])
    : [['BBCA', 'Bank Central Asia', '', 10, 8950, 9100, 'IDR', 'stock', 'stockbit', 2020], ['TLKM', 'Telkom Indonesia', '', 25, 3120, 1980, 'IDR', 'stock', 'stockbit', 2022], ['QQQ', 'Invesco QQQ', 3.5, '', 480.2, 656.1, 'USD', 'stock', 'pluang', 2023], ['BTC', 'Bitcoin', 0.0125, '', 61000, 76050, 'USD', 'crypto', 'bitget', 2021]];
  return [PORT_HEADERS, ...rows];
}
export const toCSV = (rows: (string | number)[][]) => Papa.unparse(rows.map((r) => r.map((c) => (c === '' || c == null ? '' : c))));

/** Excel workbook with two sheets (Accounts, Portfolio): a blank template, or your current data to edit and re-import. */
export function workbook(d?: AppData): Uint8Array {
  const wb = XLSX.utils.book_new();
  const a = XLSX.utils.aoa_to_sheet(accountsSheet(d)); a['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 9 }, { wch: 11 }, { wch: 16 }, { wch: 8 }];
  const p = XLSX.utils.aoa_to_sheet(portfolioSheet(d)); p['!cols'] = [{ wch: 9 }, { wch: 26 }, { wch: 10 }, { wch: 7 }, { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 12 }];
  const help = XLSX.utils.aoa_to_sheet([
    ['FinPlan import template'], [''],
    ['Accounts sheet', 'Type = bank, ewallet, cash, investment, asset or debt. For debt, Balance = amount owed (positive).'],
    ['', 'Rows are matched to your accounts by name: same name = balance updated, new name = account added.'],
    ['Portfolio sheet', 'Fill Qty (shares/coins) OR Lot (Indonesian stocks, 1 lot = 100 shares). Prices per share/coin.'],
    ['', 'Broker = stockbit, pluang, bitget, bittime, alpaca, tradingview or manual.'],
    ['', 'Numbers can be 15000000, 15.000.000 or 15,000,000.'],
    ['Since', 'Year the account was opened or the position first bought (e.g. 2019). Optional; shown in Wealth → Table and Wealth by year.'],
  ]);
  XLSX.utils.book_append_sheet(wb, a, 'Accounts'); XLSX.utils.book_append_sheet(wb, p, 'Portfolio'); XLSX.utils.book_append_sheet(wb, help, 'How to');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}
