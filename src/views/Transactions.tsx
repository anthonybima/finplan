import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, Plus, Search, Trash2, ArrowDownLeft, ArrowUpRight, Repeat } from 'lucide-react';
import type { ViewProps } from '../App';
import type { AppData, Txn, TxnType } from '../lib/types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/types';
import { fmtDate, money, today } from '../lib/format';
import { uid } from '../lib/store';
import { convert, dedupe, exportTxnsCSV, guessMapping, readFile, type Mapping, type Sheet } from '../lib/importer';
import { Card, Field, Modal, MoneyInput, Seg, toast } from '../components/ui';

export default function Transactions({ data, update }: ViewProps) {
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('all');
  const [type, setType] = useState<'all' | TxnType>('all');
  const [cat, setCat] = useState('all');
  const [edit, setEdit] = useState<Txn | null | 'new'>(null);
  const [importing, setImporting] = useState(false);
  const [limit, setLimit] = useState(100);

  const months = useMemo(() => [...new Set(data.txns.map((t) => t.date.slice(0, 7)))].sort().reverse(), [data.txns]);
  const cats = useMemo(() => [...new Set(data.txns.map((t) => t.category))].sort(), [data.txns]);
  const acct = (id: string) => data.accounts.find((a) => a.id === id)?.name || '—';
  const list = useMemo(() => data.txns
    .filter((t) => (month === 'all' || t.date.startsWith(month)) && (type === 'all' || t.type === type) && (cat === 'all' || t.category === cat)
      && (!q || (t.note + ' ' + t.category).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.date.localeCompare(a.date)), [data.txns, q, month, type, cat]);
  const totals = list.reduce((s, t) => { if (t.type === 'income') s.in += t.amount; else if (t.type === 'expense') s.out += t.amount; return s; }, { in: 0, out: 0 });

  return (
    <>
      <div className="page-head">
        <div><h1>Transactions</h1><div className="sub">{data.txns.length} records · import from bank / e-wallet apps or add manually</div></div>
        <div className="row">
          <button className="btn" onClick={() => setImporting(true)}><FileUp size={16} /> Import CSV / Excel</button>
          <button className="btn hide-m" onClick={() => exportTxnsCSV(list, acct)}><Download size={16} /> Export</button>
          <button className="btn primary" onClick={() => setEdit('new')}><Plus size={16} /> Add</button>
        </div>
      </div>
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search notes or category" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">All months</option>{months.map((m) => <option key={m}>{m}</option>)}
          </select>
          <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}
          </select>
          <Seg value={type} onChange={setType} options={[{ v: 'all', l: 'All' }, { v: 'income', l: 'In' }, { v: 'expense', l: 'Out' }]} />
        </div>
        <div className="row small" style={{ marginBottom: 6 }}>
          <span className="pill good">In {money(totals.in)}</span><span className="pill bad">Out {money(totals.out)}</span>
          <span className="pill">Net {money(totals.in - totals.out)}</span>
        </div>
        <div className="list">
          {list.slice(0, limit).map((t) => (
            <div key={t.id} className="item" style={{ cursor: 'pointer' }} onClick={() => setEdit(t)}>
              <div className="ico" style={t.type === 'income' ? { background: 'var(--good-soft)', color: 'var(--good)' } : undefined}>
                {t.type === 'income' ? <ArrowDownLeft size={18} /> : t.type === 'transfer' ? <Repeat size={16} /> : <ArrowUpRight size={18} />}
              </div>
              <div className="grow">
                <div className="title">{t.note || t.category}</div>
                <div className="small muted">{fmtDate(t.date)} · {t.category} · {acct(t.account)}{t.source === 'import' ? ' · imported' : ''}</div>
              </div>
              <div className={`amt ${t.type === 'income' ? 'pos' : ''}`}>{t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{money(t.amount)}</div>
            </div>
          ))}
          {!list.length && <div className="empty">No transactions match. Import a statement or add one.</div>}
          {list.length > limit && <button className="btn mt" onClick={() => setLimit(limit + 200)}>Show more ({list.length - limit})</button>}
        </div>
      </Card>
      {edit && <TxnModal data={data} update={update} txn={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {importing && <ImportModal data={data} update={update} onClose={() => setImporting(false)} />}
    </>
  );
}

export function TxnModal({ data, update, txn, onClose }: { data: AppData; update: ViewProps['update']; txn?: Txn; onClose: () => void }) {
  const [t, setT] = useState<Txn>(txn ?? { id: uid(), date: today(), amount: 0, type: 'expense', category: 'Food & Dining', account: data.accounts.find((a) => a.kind !== 'debt')?.id || '', note: '', source: 'manual' });
  const set = (p: Partial<Txn>) => setT((x) => ({ ...x, ...p }));
  const catList = t.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const save = () => {
    if (!t.amount) return toast('Enter an amount');
    update((d) => ({ ...d, txns: txn ? d.txns.map((x) => (x.id === t.id ? t : x)) : [t, ...d.txns] }));
    toast(txn ? 'Saved' : 'Transaction added'); onClose();
  };
  return (
    <Modal title={txn ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <div className="form">
        <div className="full"><Seg value={t.type} onChange={(v) => set({ type: v, category: v === 'income' ? 'Salary' : v === 'transfer' ? 'Other' : 'Food & Dining' })}
          options={[{ v: 'expense', l: 'Expense' }, { v: 'income', l: 'Income' }, { v: 'transfer', l: 'Transfer' }]} /></div>
        <Field label="Amount" full><MoneyInput value={t.amount} onChange={(amount) => set({ amount })} autoFocus /></Field>
        <Field label="Category"><select className="input" value={t.category} onChange={(e) => set({ category: e.target.value })}>
          {[...new Set([...catList, t.category])].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Date"><input className="input" type="date" value={t.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Account"><select className="input" value={t.account} onChange={(e) => set({ account: e.target.value })}>
          <option value="">—</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Note"><input className="input" value={t.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Lunch with team" /></Field>
      </div>
      <div className="row between mt">
        {txn ? <button className="btn danger" onClick={() => { update((d) => ({ ...d, txns: d.txns.filter((x) => x.id !== t.id) })); onClose(); }}><Trash2 size={16} /> Delete</button> : <span />}
        <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

export function ImportModal({ data, update, onClose, onDone }: { data: AppData; update: ViewProps['update']; onClose: () => void; onDone?: (n: number) => void }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState('');
  const [m, setM] = useState<Mapping | null>(null);
  const [account, setAccount] = useState(data.accounts.find((a) => a.kind === 'bank' || a.kind === 'ewallet')?.id || '');
  const ref = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (sheet && m ? convert(sheet, m, account, data.settings.rules) : null), [sheet, m, account, data.settings.rules]);
  const result = useMemo(() => (preview ? dedupe(data.txns, preview.txns) : null), [preview, data.txns]);

  const onFile = async (f?: File) => {
    if (!f) return;
    try { const s = await readFile(f); setSheet(s); setM(guessMapping(s.headers)); setFileName(f.name); }
    catch { toast('Could not read this file'); }
  };
  const col = (key: keyof Mapping, label: string, optional = false) => (
    <Field label={label}>
      <select className="input" value={m![key] as number} onChange={(e) => setM({ ...m!, [key]: Number(e.target.value) })}>
        {optional && <option value={-1}>— not used —</option>}
        {sheet!.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
      </select>
    </Field>
  );
  const doImport = () => {
    if (!result) return;
    update((d) => ({ ...d, txns: [...result.fresh, ...d.txns] }));
    toast(`Imported ${result.fresh.length} transactions`);
    onDone?.(result.fresh.length); onClose();
  };

  return (
    <Modal title="Import transactions" onClose={onClose} wide>
      {!sheet ? (
        <div>
          <div className="card" style={{ borderStyle: 'dashed', textAlign: 'center', padding: 30, cursor: 'pointer' }}
            onClick={() => ref.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
            <FileUp size={30} color="var(--brand)" />
            <div style={{ fontWeight: 700, marginTop: 8 }}>Drop a CSV or Excel file, or tap to choose</div>
            <div className="small muted mt-s">Works with exports from BCA, Mandiri, BRI, BNI, Jenius, Jago, GoPay, OVO, DANA, ShopeePay, Money Lover, Wallet, Spendee and spreadsheets.</div>
          </div>
          <input ref={ref} type="file" accept=".csv,.txt,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="small muted mt">
            <b>How to get the file:</b> in your m-banking or internet-banking app open <i>Mutasi Rekening / e-Statement</i> and download as CSV/Excel.
            E-wallets: <i>Riwayat Transaksi → Export</i> (or use the monthly email statement). Columns are detected automatically; duplicates are skipped.
          </div>
        </div>
      ) : (
        <div>
          <div className="row between"><div><b>{fileName}</b> <span className="muted small">· {sheet.rows.length} rows</span></div>
            <button className="btn sm" onClick={() => { setSheet(null); setM(null); }}>Choose another</button></div>
          <div className="form mt" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <Field label="Into account"><select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">—</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            {col('date', 'Date column')}
            {col('description', 'Description column')}
            {col('amount', 'Amount (signed / DB-CR)', true)}
            {col('debit', 'Debit / out column', true)}
            {col('credit', 'Credit / in column', true)}
            {col('typeCol', 'DB/CR indicator column', true)}
            <Field label="Date format"><select className="input" value={m!.dayFirst ? 'd' : 'm'} onChange={(e) => setM({ ...m!, dayFirst: e.target.value === 'd' })}>
              <option value="d">Day first (31/12/2026)</option><option value="m">Month first (12/31/2026)</option></select></Field>
            <Field label="Signs"><select className="input" value={m!.invertSign ? 'y' : 'n'} onChange={(e) => setM({ ...m!, invertSign: e.target.value === 'y' })}>
              <option value="n">Negative = expense</option><option value="y">Positive = expense (invert)</option></select></Field>
          </div>
          <h3 className="mt">Preview</h3>
          <div className="scroll-x" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="r">Amount</th></tr></thead>
              <tbody>{preview?.txns.slice(0, 30).map((t) => (
                <tr key={t.id}><td>{t.date}</td><td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.note}</td><td>{t.category}</td>
                  <td className={`r ${t.type === 'income' ? 'pos' : 'neg'}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</td></tr>
              ))}</tbody></table>
          </div>
          <div className="row between mt">
            <div className="small muted">{result?.fresh.length ?? 0} new · {result?.duplicates ?? 0} duplicates skipped · {preview?.skipped ?? 0} rows unreadable</div>
            <div className="row"><button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!result?.fresh.length} onClick={doImport}>Import {result?.fresh.length ?? 0}</button></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
