import { useMemo, useState } from 'react';
import { Check, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type { Account, AccountKind, AppData, AssetClass } from '../lib/types';
import { ASSUMPTIONS } from '../lib/risk';
import { money, today } from '../lib/format';
import { uid } from '../lib/store';
import { normYear } from '../lib/wealthYears';
import { groupOf, knownGroups } from '../lib/institutions';
import { cleanNo, fmtNo, refOf } from '../lib/accountNo';
import { fmtTenor, parseTenor } from '../lib/tenor';
import { CURRENCIES, toIdr } from '../lib/fx';
import { toast } from './ui';

const KINDS: [AccountKind, string][] = [['bank', 'Bank'], ['ewallet', 'E-wallet'], ['cash', 'Cash'], ['investment', 'Investment'], ['asset', 'Asset'], ['debt', 'Debt']];
const CLASSES = Object.keys(ASSUMPTIONS) as AssetClass[];
const short = (c: AssetClass) => ASSUMPTIONS[c].label.split(' (')[0].split(' / ')[0];

/** One editable row. `orig` is the saved account (undefined for a new row). */
interface Row { key: string; orig?: Account; name: string; group: string; accountNo: string; kind: AccountKind; assetClass?: AssetClass; balance: string; rate: string; tenor: string; currency: string; payment: string; opened: string; del: boolean }
type Col = 'name' | 'group' | 'accountNo' | 'balance' | 'rate' | 'tenor' | 'payment' | 'opened';

const toRow = (a: Account): Row => ({
  key: a.id, orig: a, name: a.name, group: groupOf(a) === 'Other' && !a.group ? '' : a.group || groupOf(a), accountNo: a.accountNo ? fmtNo(a.accountNo) : '', kind: a.kind, assetClass: a.assetClass,
  balance: a.needsBalance && !a.balance ? '' : String(a.currency && a.currency !== 'IDR' ? a.fxBalance ?? 0 : a.balance), currency: a.currency || 'IDR', rate: a.interestRate != null ? String(a.interestRate) : '', tenor: a.tenorMonths ? fmtTenor(a.tenorMonths) : '', payment: a.monthlyPayment != null ? String(a.monthlyPayment) : '', opened: a.opened ?? '', del: false,
});
/** "15.250.000", "15,250,000", "15250000", "15.2jt", "250rb" → number; '' → null */
export function parseAmount(s: string): number | null {
  let t = s.trim().toLowerCase().replace(/^rp\.?\s*/, '').replace(/\s/g, '');
  if (!t) return null;
  let mult = 1;
  const suf = t.match(/(jt|juta|m|rb|ribu|k)$/); if (suf) { mult = /jt|juta|m/.test(suf[1]) ? 1e6 : 1e3; t = t.slice(0, -suf[1].length); }
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return isFinite(n) ? Math.round(n * mult * 100) / 100 : null;
}

/** Spreadsheet-style editor for all manual accounts: edit cells, paste a column from Excel, apply changes to many rows, then save once. */
export default function BulkEditAccounts({ data, update, onClose }: { data: AppData; update: (fn: (d: AppData) => AppData) => void; onClose: () => void }) {
  const manual = useMemo(() => data.accounts.filter((a) => !a.synced).sort((a, z) => groupOf(a).localeCompare(groupOf(z)) || a.name.localeCompare(z.name)), [data.accounts]);
  const synced = data.accounts.filter((a) => a.synced).length;
  const [rows, setRows] = useState<Row[]>(() => manual.map(toRow));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState({ group: '', kind: '' as '' | AccountKind, opened: '', rate: '', balance: '', tenor: '', currency: '' });

  const ql = q.trim().toLowerCase();
  // several terms separated by commas match ANY of them ("mayapada, seabank, other"); "other" = accounts with no bank / app group
  const terms = ql.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = (r: Row, t: string) => { const n = cleanNo(t), sq = squash(t);
    return r.name.toLowerCase().includes(t) || r.group.toLowerCase().includes(t) || (!!sq && (squash(r.name).includes(sq) || squash(r.group).includes(sq))) || r.kind === t
      || (/^others?$/.test(t) && !r.group.trim()) || (n.length >= 3 && /\d/.test(n) && cleanNo(r.accountNo).includes(n)); };
  const visible = rows.filter((r) => !terms.length || !r.orig || terms.some((t) => hit(r, t)));
  const set = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setKind = (r: Row, kind: AccountKind) => set(r.key, { kind, assetClass: kind === 'investment' ? r.assetClass && r.assetClass !== 'property' ? r.assetClass : 'mutualfund' : kind === 'asset' ? r.assetClass || 'property' : undefined });

  const changed = (r: Row) => {
    if (!r.orig) return !!r.name.trim();
    if (r.del) return true;
    const o = toRow(r.orig);
    return (['name', 'group', 'kind', 'assetClass', 'currency', 'balance', 'rate', 'tenor', 'payment', 'opened'] as const).some((k) => (r[k] ?? '') !== (o[k] ?? '')) || cleanNo(r.accountNo) !== cleanNo(o.accountNo);
  };
  const nChanged = rows.filter(changed).length;
  const problems = rows.filter((r) => !r.del && (r.orig || r.name.trim())).flatMap((r) => {
    const out: string[] = [];
    if (!r.name.trim()) out.push('a row has no name');
    if (r.balance.trim() && parseAmount(r.balance) == null) out.push(`“${r.name}”: balance “${r.balance}” is not a number`);
    if (r.opened.trim() && !normYear(r.opened)) out.push(`“${r.name}”: since “${r.opened}” is not a year`);
    if (r.rate.trim() && parseAmount(r.rate) == null) out.push(`“${r.name}”: interest “${r.rate}” is not a number`);
    if (r.tenor.trim() && !parseTenor(r.tenor)) out.push(`“${r.name}”: duration “${r.tenor}” not understood (try 3, 3 bulan, 1 tahun)`);
    return out;
  });

  /** Paste several lines (a column copied from Excel) → fill this column downwards from this row (visible rows). */
  const onPaste = (r: Row, col: Col) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const lines = text.replace(/\r/g, '').split('\n'); if (lines.at(-1) === '') lines.pop();
    if (lines.length < 2) return;
    e.preventDefault();
    const start = visible.findIndex((x) => x.key === r.key);
    const targets = visible.slice(start, start + lines.length);
    setRows((rs) => rs.map((x) => { const i = targets.findIndex((t) => t.key === x.key); return i < 0 ? x : { ...x, [col]: lines[i].split('\t')[0].trim() }; }));
    toast(`Pasted ${targets.length} value${targets.length === 1 ? '' : 's'}${lines.length > targets.length ? ` (${lines.length - targets.length} more than rows)` : ''}`);
  };
  const cell = (r: Row, col: Col, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input be-in" value={r[col]} onChange={(e) => set(r.key, { [col]: e.target.value } as Partial<Row>)} onPaste={onPaste(r, col)} aria-label={col} {...props} />
  );

  const allSel = visible.length > 0 && visible.every((r) => sel.has(r.key));
  const toggleAll = () => setSel((s) => { const n = new Set(s); visible.forEach((r) => (allSel ? n.delete(r.key) : n.add(r.key))); return n; });
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const applyBulk = (p: (r: Row) => Partial<Row>, what: string) => { setRows((rs) => rs.map((r) => (sel.has(r.key) ? { ...r, ...p(r) } : r))); toast(`${what}: ${sel.size} row${sel.size === 1 ? '' : 's'} (not saved yet)`); };

  const addRow = () => { const k = 'new-' + uid(); setRows((rs) => [{ key: k, name: '', group: '', accountNo: '', kind: 'bank', balance: '', currency: 'IDR', rate: '', tenor: '', payment: '', opened: '', del: false }, ...rs]); setQ(''); };
  const close = () => { if (nChanged && !confirm(`Discard ${nChanged} unsaved change${nChanged === 1 ? '' : 's'}?`)) return; onClose(); };

  const save = () => {
    if (problems.length) { toast(problems[0]); return; }
    const t = today(); let upd = 0, add = 0, del = 0;
    const byId = new Map(rows.filter((r) => r.orig).map((r) => [r.orig!.id, r]));
    const build = (r: Row, base: Partial<Account>): Account => {
      const bal = parseAmount(r.balance); const no = cleanNo(r.accountNo); const rate = parseAmount(r.rate); const pay = parseAmount(r.payment);
      const origNative = r.orig ? (r.orig.currency && r.orig.currency !== 'IDR' ? r.orig.fxBalance ?? 0 : r.orig.balance) : 0;
      const balChanged = !r.orig || (r.orig.needsBalance && !r.orig.balance ? bal != null : bal !== origNative);
      const ccy = r.currency || 'IDR', fx = ccy !== 'IDR';
      const ccyChanged = (r.orig?.currency || 'IDR') !== ccy;
      const native = bal == null ? (fx ? r.orig?.fxBalance ?? 0 : r.orig?.balance ?? 0) : Math.abs(bal);
      const a: Account = { ...(base as Account), name: r.name.trim(), kind: r.kind, balance: fx ? toIdr(data.settings, ccy, native) : native, updatedAt: balChanged || ccyChanged ? t : r.orig?.updatedAt ?? t };
      a.currency = fx ? ccy : undefined; a.fxBalance = fx ? native : undefined;
      a.assetClass = r.kind === 'investment' || r.kind === 'asset' ? r.assetClass || (r.kind === 'asset' ? 'property' : 'mutualfund') : undefined;
      a.group = r.group.trim() || undefined;
      a.accountNo = no.length > 4 ? no : undefined; a.ref = no ? refOf(no) : r.orig?.accountNo ? undefined : r.orig?.ref;
      a.interestRate = rate ?? undefined; a.tenorMonths = parseTenor(r.tenor); a.monthlyPayment = pay ?? undefined; a.opened = normYear(r.opened);
      if (bal != null && balChanged) delete a.needsBalance; else if (r.orig?.needsBalance && bal == null) a.needsBalance = true;
      for (const k of Object.keys(a) as (keyof Account)[]) if (a[k] === undefined) delete a[k];
      return a;
    };
    update((d) => {
      const accounts: Account[] = [];
      for (const a of d.accounts) {
        const r = byId.get(a.id);
        if (!r || a.synced) { accounts.push(a); continue; }
        if (r.del) { del++; continue; }
        if (changed(r)) { accounts.push(build(r, a)); upd++; } else accounts.push(a);
      }
      for (const r of rows) if (!r.orig && !r.del && r.name.trim()) { accounts.push(build(r, { id: uid() })); add++; }
      return { ...d, accounts };
    });
    setTimeout(() => toast(`Saved: ${upd} updated${add ? `, ${add} added` : ''}${del ? `, ${del} deleted` : ''} ✓`), 0);
    onClose();
  };

  const total = rows.filter((r) => !r.del).reduce((s, r) => s + toIdr(data.settings, r.currency, parseAmount(r.balance) ?? 0) * (r.kind === 'debt' ? -1 : 1), 0);
  const groups = knownGroups([...rows.map((r) => r.group), ...data.accounts.map((a) => groupOf(a))].filter((g) => g && g !== 'Other'));

  return (
    <div className="card mt bulk-edit">
      <div className="row between" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>Bulk edit accounts</h3>
          <div className="small muted">Edit any cell, or paste a column from Excel into the first cell to fill down. Tick rows to change many at once. Nothing is saved until <b>Save changes</b>.{synced ? ` ${synced} synced app account${synced === 1 ? '' : 's'} (Connections) not shown.` : ''}</div></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={close}><X size={15} /> Cancel</button>
          <button className="btn primary" disabled={!nChanged} onClick={save}><Check size={15} /> Save changes{nChanged ? ` (${nChanged})` : ''}</button>
        </div>
      </div>

      <div className="row mt-s" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="row" style={{ gap: 4, alignItems: 'center' }}><Search size={14} className="muted" /><input className="input" style={{ width: 220 }} placeholder="Filter: name, bank, number… (a, b, c = any)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn sm" onClick={addRow}><Plus size={14} /> Add row</button>
        <span className="small muted">{rows.filter((r) => !r.del).length} accounts · net {money(total)}</span>
      </div>

      {sel.size > 0 && (
        <div className="bulk-bar mt-s">
          <b className="small">{sel.size} selected</b>
          <span className="row" style={{ gap: 4 }}><input className="input be-in" list="be-groups" placeholder="Bank / app" value={bulk.group} onChange={(e) => setBulk({ ...bulk, group: e.target.value })} style={{ width: 130 }} />
            <button className="btn sm" onClick={() => applyBulk(() => ({ group: bulk.group.trim() }), bulk.group.trim() ? `Group “${bulk.group.trim()}”` : 'Group cleared')}>Set group</button></span>
          <span className="row" style={{ gap: 4 }}><select className="input be-in" value={bulk.kind} onChange={(e) => setBulk({ ...bulk, kind: e.target.value as AccountKind })}><option value="">Type…</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="btn sm" disabled={!bulk.kind} onClick={() => applyBulk((r) => ({ kind: bulk.kind as AccountKind, assetClass: bulk.kind === 'investment' ? r.assetClass && r.assetClass !== 'property' ? r.assetClass : 'mutualfund' : bulk.kind === 'asset' ? r.assetClass || 'property' : undefined }), 'Type changed')}>Set type</button></span>
          <span className="row" style={{ gap: 4 }}><input className="input be-in" placeholder="Year" inputMode="numeric" value={bulk.opened} onChange={(e) => setBulk({ ...bulk, opened: e.target.value })} style={{ width: 70 }} />
            <button className="btn sm" disabled={!!bulk.opened && !normYear(bulk.opened)} onClick={() => applyBulk(() => ({ opened: bulk.opened.trim() }), 'Since set')}>Set since</button></span>
          <span className="row" style={{ gap: 4 }}><input className="input be-in" placeholder="%" inputMode="decimal" value={bulk.rate} onChange={(e) => setBulk({ ...bulk, rate: e.target.value })} style={{ width: 60 }} />
            <button className="btn sm" onClick={() => applyBulk(() => ({ rate: bulk.rate.trim() }), 'Interest set')}>Set interest</button></span>
          <span className="row" style={{ gap: 4 }}><select className="input be-in" aria-label="bulk currency" value={bulk.currency} onChange={(e) => setBulk({ ...bulk, currency: e.target.value })}><option value="">Currency…</option>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</select>
            <button className="btn sm" disabled={!bulk.currency} onClick={() => applyBulk(() => ({ currency: bulk.currency }), `Currency ${bulk.currency}`)}>Set currency</button></span>
          <span className="row" style={{ gap: 4 }}><input className="input be-in" placeholder="e.g. 3 bulan" value={bulk.tenor} onChange={(e) => setBulk({ ...bulk, tenor: e.target.value })} style={{ width: 90 }} />
            <button className="btn sm" disabled={!!bulk.tenor.trim() && !parseTenor(bulk.tenor)} onClick={() => applyBulk(() => ({ tenor: bulk.tenor.trim() ? fmtTenor(parseTenor(bulk.tenor)) : '' }), bulk.tenor.trim() ? `Duration ${fmtTenor(parseTenor(bulk.tenor))}` : 'Duration cleared')}>Set duration</button></span>
          <span className="row" style={{ gap: 4 }}><input className="input be-in" placeholder="Balance" inputMode="decimal" value={bulk.balance} onChange={(e) => setBulk({ ...bulk, balance: e.target.value })} style={{ width: 110, textAlign: 'right' }} />
            <button className="btn sm" disabled={parseAmount(bulk.balance) == null} onClick={() => applyBulk(() => ({ balance: String(parseAmount(bulk.balance)) }), `Balance set to ${money(parseAmount(bulk.balance) ?? 0)}`)}>Set balance</button></span>
          <button className="btn sm danger" onClick={() => applyBulk(() => ({ del: true }), 'Marked for deletion')}><Trash2 size={14} /> Delete</button>
          <button className="btn sm ghost" onClick={() => applyBulk(() => ({ del: false }), 'Restored')}><RotateCcw size={14} /> Restore</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}
      <datalist id="be-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>

      <div className="scroll-x mt-s">
        <table className="table be-table cardify">
          <thead><tr>
            <th><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /></th>
            <th>Account</th><th>Bank / app</th><th>Account no.</th><th>Type</th><th>Class</th><th>Currency</th><th className="r">Balance</th><th>Interest %</th><th>Duration</th><th>Monthly pay</th><th>Since</th><th></th>
          </tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key} className={`${r.del ? 'be-del' : changed(r) ? 'be-changed' : ''}`}>
                <td data-l=""><input type="checkbox" checked={sel.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.name}`} /></td>
                <td data-l="Account">{cell(r, 'name', { style: { width: 240 }, placeholder: 'Account name', autoFocus: !r.orig && !r.name })}</td>
                <td data-l="Bank / app">{cell(r, 'group', { list: 'be-groups', style: { width: 140 }, placeholder: 'auto' })}</td>
                <td data-l="Account no.">{cell(r, 'accountNo', { style: { width: 150 }, className: 'input be-in acct-no', inputMode: 'text', placeholder: r.orig?.ref && !r.orig.accountNo ? `…${r.orig.ref.replace(/^···/, '')}` : '' })}</td>
                <td data-l="Type"><select className="input be-in" style={{ minWidth: 112 }} value={r.kind} onChange={(e) => setKind(r, e.target.value as AccountKind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td data-l="Class">{r.kind === 'investment' || r.kind === 'asset'
                  ? <select className="input be-in" style={{ minWidth: 130 }} value={r.assetClass} onChange={(e) => set(r.key, { assetClass: e.target.value as AssetClass })}>{CLASSES.map((c) => <option key={c} value={c}>{short(c)}</option>)}</select>
                  : <span className="small muted">—</span>}</td>
                <td data-l="Currency"><select className="input be-in" aria-label="currency" value={r.currency} onChange={(e) => set(r.key, { currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</select></td>
                <td data-l="Balance">{cell(r, 'balance', { style: { width: 130, textAlign: 'right' }, inputMode: 'decimal', placeholder: r.orig?.needsBalance ? 'not entered' : '0' })}</td>
                <td data-l="Interest %">{cell(r, 'rate', { style: { width: 64 }, inputMode: 'decimal' })}</td>
                <td data-l="Duration">{cell(r, 'tenor', { style: { width: 80 }, placeholder: '—', title: '3, 3 bulan, 12 bln, 1 tahun' })}</td>
                <td data-l="Monthly pay">{r.kind === 'debt' ? cell(r, 'payment', { style: { width: 110 }, inputMode: 'decimal' }) : <span className="small muted">—</span>}</td>
                <td data-l="Since">{cell(r, 'opened', { style: { width: 64 }, inputMode: 'numeric', placeholder: 'year' })}</td>
                <td data-l="">{r.del
                  ? <button className="btn sm ghost" title="Restore" aria-label={`Restore ${r.name}`} onClick={() => set(r.key, { del: false })}><RotateCcw size={14} /></button>
                  : <button className="btn sm ghost" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => (r.orig ? set(r.key, { del: true }) : setRows((rs) => rs.filter((x) => x.key !== r.key)))}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={13} className="small muted">No accounts match “{q}”.</td></tr>}
          </tbody>
        </table>
      </div>
      {problems.length > 0 && <div className="small warn-text mt-s">{problems.slice(0, 3).join(' · ')}{problems.length > 3 ? ` · +${problems.length - 3} more` : ''}</div>}
      <div className="row between mt-s" style={{ alignItems: 'center' }}>
        <span className="small muted">{nChanged ? `${nChanged} row${nChanged === 1 ? '' : 's'} changed (highlighted)` : 'No changes yet'} · balances are in each row's currency (USD 12,500.50) · rupiah accepts 15.250.000, 15,2jt, 250rb</span>
        <button className="btn primary" disabled={!nChanged} onClick={save}><Check size={15} /> Save changes{nChanged ? ` (${nChanged})` : ''}</button>
      </div>
    </div>
  );
}
