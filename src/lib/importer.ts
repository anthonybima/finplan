import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CategoryRule, Txn, TxnType } from './types';
import { parseAmount, parseDate, today } from './format';
import { uid } from './store';
import { downloadText } from './holdings';

export interface Sheet { headers: string[]; rows: string[][] }

export interface Mapping {
  date: number; description: number;
  amount: number; // signed or with DB/CR, -1 if not used
  debit: number; credit: number; // separate columns, -1 if not used
  typeCol: number; // column holding DB/CR / "Debit"/"Kredit" indicator, -1 if none
  dayFirst: boolean;
  invertSign: boolean; // some apps export expenses as positive
}

/** Read CSV / XLSX exported from banking, e-wallet or budgeting apps. */
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

export async function readFile(file: File): Promise<Sheet> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 15 MB');
  const name = file.name.toLowerCase();
  let grid: string[][];
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    grid = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }) as unknown[][])
      .map((r) => r.map((c) => (c == null ? '' : String(c))));
  } else {
    const text = await file.text();
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true });
    grid = res.data.map((r) => r.map((c) => (c ?? '').toString()));
  }
  return findTable(grid);
}

/** Bank statements usually start with account info lines: find the real header row. */
function findTable(grid: string[][]): Sheet {
  const hint = /(tanggal|tgl|date|keterangan|deskripsi|description|uraian|remark|jumlah|amount|nominal|debit|debet|kredit|credit|mutasi)/i;
  let h = 0, best = -1;
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const score = grid[i].filter((c) => hint.test(c)).length;
    if (score > best) { best = score; h = i; }
    if (score >= 3) break;
  }
  const headers = grid[h].map((c, i) => c.trim() || `Column ${i + 1}`);
  const rows = grid.slice(h + 1).filter((r) => r.some((c) => c.trim() !== ''));
  return { headers, rows };
}

export function guessMapping(headers: string[]): Mapping {
  const find = (re: RegExp, not?: RegExp) => headers.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const date = find(/tanggal|tgl|date|waktu|time/i);
  const description = find(/keterangan|deskripsi|description|uraian|remark|detail|note|catatan|merchant|nama/i);
  const debit = find(/^(debit|debet|db|keluar|pengeluaran|withdraw|money out)/i);
  const credit = find(/^(kredit|credit|cr|masuk|pemasukan|deposit|money in)/i);
  const amount = find(/jumlah|amount|nominal|mutasi|nilai|total/i, /saldo|balance/i);
  const typeCol = find(/^(db\/cr|d\/k|tipe|type|jenis|cr\/db)/i);
  return {
    date: date >= 0 ? date : 0,
    description: description >= 0 ? description : 1,
    amount: debit >= 0 && credit >= 0 ? -1 : amount,
    debit: debit >= 0 && credit >= 0 ? debit : -1,
    credit: debit >= 0 && credit >= 0 ? credit : -1,
    typeCol, dayFirst: true, invertSign: false,
  };
}

export function categorize(desc: string, type: TxnType, rules: CategoryRule[]): string {
  const d = ' ' + desc.toLowerCase() + ' ';
  for (const r of rules) if (r.keyword && d.includes(r.keyword.toLowerCase())) {
    return r.category;
  }
  return type === 'income' ? 'Other Income' : 'Other';
}

const isTransfer = (d: string) => /\b(trsf|transfer|tf |pindah buku|top ?up|topup|isi saldo)\b/i.test(d);

export function convert(sheet: Sheet, m: Mapping, accountId: string, rules: CategoryRule[]): { txns: Txn[]; skipped: number } {
  const out: Txn[] = [];
  let skipped = 0;
  for (const r of sheet.rows) {
    const date = parseDate(r[m.date], m.dayFirst);
    let signed = NaN;
    if (m.amount >= 0) {
      signed = parseAmount(r[m.amount]);
      if (m.typeCol >= 0) {
        const t = (r[m.typeCol] || '').toLowerCase();
        if (/^(db|d|debit|debet|keluar|out|expense)/.test(t)) signed = -Math.abs(signed);
        else if (/^(cr|k|kredit|credit|masuk|in|income)/.test(t)) signed = Math.abs(signed);
      }
    } else if (m.debit >= 0 || m.credit >= 0) {
      const db = Math.abs(parseAmount(r[m.debit]) || 0), cr = Math.abs(parseAmount(r[m.credit]) || 0);
      signed = cr - db;
    }
    if (m.invertSign) signed = -signed;
    if (!date || !isFinite(signed) || signed === 0) { skipped++; continue; }
    const note = (r[m.description] || '').replace(/\s+/g, ' ').trim();
    const type: TxnType = signed > 0 ? 'income' : 'expense';
    out.push({
      id: uid(), date, amount: Math.abs(signed), type, note, account: accountId, source: 'import',
      category: isTransfer(note) && !rules.some((ru) => note.toLowerCase().includes(ru.keyword)) ? (type === 'income' ? 'Other Income' : 'Other') : categorize(note, type, rules),
    });
  }
  return { txns: out, skipped };
}

export const txnKey = (t: Txn) => `${t.date}|${t.type}|${Math.round(t.amount)}|${t.note.toLowerCase().slice(0, 40)}`;

export function dedupe(existing: Txn[], incoming: Txn[]) {
  const seen = new Set(existing.map(txnKey));
  const fresh = incoming.filter((t) => { const k = txnKey(t); if (seen.has(k)) return false; seen.add(k); return true; });
  return { fresh, duplicates: incoming.length - fresh.length };
}

export function exportTxnsCSV(txns: Txn[], accountName: (id: string) => string) {
  const csv = Papa.unparse(txns.map((t) => ({
    Date: t.date, Type: t.type, Category: t.category, Amount: t.type === 'expense' ? -t.amount : t.amount,
    Account: accountName(t.account), Note: t.note,
  })));
  downloadText(`finplan-transactions-${today()}.csv`, csv);
}
