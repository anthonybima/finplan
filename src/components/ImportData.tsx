import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, FileSpreadsheet, Trash2, Plus, Upload, Sparkles, ArrowRight, Check } from 'lucide-react';
import { Modal, Seg, toast } from './ui';
import type { AccountKind, AppData, Source } from '../lib/types';
import { downloadText } from '../lib/holdings';
import { money } from '../lib/format';
import { PortfolioReview, NumIn } from './SmartScan';
import { availableEngines, askVision, runScan, scanPrompt, normaliseAI, type Engines, type ScanResult } from '../lib/smartScan';
import { knownGroups } from '../lib/institutions';
import { cleanNo, refOf } from '../lib/accountNo';
import { CURRENCIES, toIdr } from '../lib/fx';
import {
  accountsPrompt, accountsSheet, aiToAccounts, applyAccounts, detectKind, gridToAccounts, gridToPortfolio, guessAccountMap, guessPortfolioMap,
  jsonToTables, portfolioSheet, readGrids, sourceFromGrid, textToGrids, toCSV, workbook, type AccountMap, type AccountRow, type Grid, type PortfolioMap, type TableKind,
} from '../lib/dataImport';
import type { Page } from '../App';

type What = 'auto' | 'accounts' | 'portfolio';
const KINDS: { v: AccountKind; l: string }[] = [{ v: 'bank', l: 'Bank' }, { v: 'ewallet', l: 'E-wallet' }, { v: 'cash', l: 'Cash' }, { v: 'investment', l: 'Investment' }, { v: 'asset', l: 'Asset' }, { v: 'debt', l: 'Debt' }];

interface Table { id: string; grid: Grid; kind: TableKind; amap: AccountMap; pmap: PortfolioMap }
interface Props { data: AppData; update: (fn: (d: AppData) => AppData) => void; onClose: () => void; go?: (p: Page) => void; what?: What; onNeedBalances?: (ids: string[]) => void }

export default function ImportData({ data, update, onClose, go, what: what0 = 'auto', onNeedBalances }: Props) {
  const [what, setWhat] = useState<What>(what0);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [acct, setAcct] = useState<AccountRow[]>([]);
  const [port, setPort] = useState<ScanResult | null>(null);
  const [portSource, setPortSource] = useState<Source>('manual');
  const [step, setStep] = useState<'input' | 'accounts' | 'portfolio'>('input');
  const [eng, setEng] = useState<Engines | null>(null);
  const [savedAccts, setSavedAccts] = useState<string | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => { availableEngines().then(setEng); }, []);

  const images = files.filter((f) => /^image\//.test(f.type) || f.type === 'application/pdf');
  const dataFiles = files.filter((f) => !images.includes(f));
  const visionEngine = eng?.claude && (eng.claudeImages || !images.length) ? 'claude' : eng?.api ? 'api' : null;

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => /\.(csv|tsv|txt|xlsx|xls|ods|json)$/i.test(f.name) || /^image\//.test(f.type) || f.type === 'application/pdf');
    if (ok.length < [...list].length) toast('Use CSV, Excel, JSON, images or PDF');
    setFiles((c) => [...c, ...ok].slice(0, 10));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => /^image\//.test(f.type));
    if (imgs.length) { e.preventDefault(); addFiles(imgs.map((f, i) => new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }))); }
  };

  /** Read everything into tables, then build account rows and portfolio rows. */
  const read = async () => {
    if (!files.length && !text.trim()) { toast('Add a file or paste a table first'); return; }
    setBusy('Reading…'); ctl.current = new AbortController();
    try {
      const ts: Table[] = []; let accts: AccountRow[] = []; let portRows: ScanResult['rows'] = []; let src: Source | null = null; const warns: string[] = [];
      const push = (grid: Grid) => {
        let kind = detectKind(grid);
        if (what !== 'auto' && kind === 'unknown') kind = what;
        if (what === 'accounts' && kind === 'portfolio') kind = 'portfolio'; // a portfolio sheet stays a portfolio
        ts.push({ id: `${grid.name}-${ts.length}`, grid, kind, amap: guessAccountMap(grid.headers), pmap: guessPortfolioMap(grid.headers) });
      };
      for (const f of dataFiles) {
        const r = await readGrids(f);
        if (r.json) {
          const j = jsonToTables(r.json, data);
          if (j.accounts) accts = accts.concat(j.accounts);
          if (j.portfolio) { portRows = portRows.concat(j.portfolio); src = src || (j.source ?? null); }
        }
        r.grids.forEach((g) => push({ ...g, name: r.grids.length > 1 ? `${f.name} · ${g.name}` : f.name }));
      }
      if (text.trim()) textToGrids(text, 'Pasted text').forEach(push);
      for (const t of ts) {
        if (t.kind === 'accounts') accts = accts.concat(gridToAccounts(t.grid, t.amap, data));
        if (t.kind === 'portfolio') { portRows = portRows.concat(gridToPortfolio(t.grid, t.pmap)); src = src || sourceFromGrid(t.grid, t.pmap); }
      }
      // screenshots / PDFs: Claude reads them
      if (images.length) {
        if (!visionEngine) throw new Error('Reading screenshots needs Claude: open FinPlan inside Claude, or add your Claude API key in Smart scan. Files and pasted tables work without it.');
        const kind = what === 'auto' ? 'both' : what;
        if (kind === 'portfolio') {
          const r = await runScan({ files: images, text: '', hint: '', engine: visionEngine, signal: ctl.current.signal, onProgress: setBusy });
          portRows = portRows.concat(r.rows); src = src || r.broker; warns.push(...r.warnings.filter((w) => !/No positions/.test(w)));
        } else {
          const prompt = kind === 'accounts' ? accountsPrompt('') : bothPrompt();
          const raw = await askVision(prompt, images, visionEngine, ctl.current.signal, setBusy, 'your screenshots');
          accts = accts.concat(aiToAccounts(raw, data));
          if (kind === 'both') { const n = normaliseAI(raw); portRows = portRows.concat(n.rows); src = src || n.broker; }
        }
      }
      setTables(ts);
      // de-duplicate account rows by name (last one wins)
      const byName = new Map<string, AccountRow>(); for (const a of accts) byName.set(a.name.toLowerCase(), a);
      setAcct([...byName.values()]);
      setPort(portRows.length ? { engine: 'file', broker: src, rows: portRows, warnings: warns } : null);
      setPortSource(src || 'manual');
      const txn = ts.filter((t) => t.kind === 'transactions').length;
      if (!byName.size && !portRows.length) {
        toast(txn ? 'This looks like bank transactions: use Transactions → Import' : 'No accounts or positions found. Check the columns, or download a template.');
        setBusy(null); return;
      }
      setStep(byName.size ? 'accounts' : 'portfolio');
    } catch (e: any) { toast(e?.message || 'Could not read that'); }
    setBusy(null);
  };

  const remap = (t: Table, patch: Partial<AccountMap>) => {
    const amap = { ...t.amap, ...patch };
    const others = (tables || []).filter((x) => x.id !== t.id && x.kind === 'accounts');
    setTables((ts) => ts!.map((x) => (x.id === t.id ? { ...x, amap } : x)));
    setAcct([...others.flatMap((o) => gridToAccounts(o.grid, o.amap, data)), ...gridToAccounts(t.grid, amap, data)]);
  };

  const saveAccounts = () => {
    const rows = acct.filter((a) => a.include);
    if (!rows.length) { toast('Tick at least one account'); return; }
    let msg = ''; let need: string[] = [];
    update((d) => { const r = applyAccounts(d, rows); need = r.needBalance; msg = `${r.updated} updated, ${r.added} added${r.insured ? `, ${r.insured} to Insurance` : ''}`; return r.data; });
    setTimeout(() => {
      toast(`Accounts saved: ${msg}${need.length ? ` · ${need.length} need a balance` : ''}`);
      if (port) { setSavedAccts(msg); setStep('portfolio'); } else { onClose(); if (need.length) onNeedBalances?.(need); }
    }, 0);
  };

  const manual = data.accounts.filter((a) => !a.synced);
  const sumIDR = useMemo(() => acct.filter((a) => a.include).reduce((s, a) => s + (a.kind === 'debt' ? -1 : 1) * toIdr(data.settings, a.currency, a.balance), 0), [acct, data.settings.usdIdr]);
  const setRow = (k: string, p: Partial<AccountRow>) => setAcct((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const acctTables = (tables || []).filter((t) => t.kind === 'accounts');

  return (
    <Modal title={step === 'portfolio' ? 'Import data · portfolio' : step === 'accounts' ? 'Import data · accounts' : 'Import data'} onClose={() => { ctl.current?.abort(); onClose(); }} wide>
      <div onPaste={onPaste}>
        {step === 'input' && (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>Bring in your <b>account balances</b> (banks, e-wallets, cash, investments, loans) and your <b>portfolio</b> (stocks, funds, crypto) from a spreadsheet, CSV, JSON, a copied table or screenshots. You review every row before it's saved.</p>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="small" style={{ fontWeight: 700 }}>What's in it?</span>
              <Seg value={what} onChange={setWhat} options={[{ v: 'auto', l: 'Detect' }, { v: 'accounts', l: 'Accounts' }, { v: 'portfolio', l: 'Portfolio' }]} />
            </div>

            <div className={`drop ${files.length ? 'has' : ''}`} onClick={() => fileIn.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
              <FileUp size={22} />
              <div><b>Add files</b> · drop, click, or paste a screenshot (Ctrl/⌘+V)
                <div className="small muted">Excel (.xlsx, every sheet), CSV, JSON · screenshots / PDF of bank, e-wallet or broker apps{visionEngine ? '' : ' (screenshots need Claude)'}</div></div>
              <input ref={fileIn} type="file" hidden multiple accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json,image/*,application/pdf" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {files.length > 0 && (
              <div className="file-chips">
                {files.map((f, i) => (
                  <span key={i} className="pill">{/^image\//.test(f.type) ? '🖼' : f.type === 'application/pdf' ? 'PDF' : <FileSpreadsheet size={12} style={{ verticalAlign: -2 }} />} {f.name}
                    <button className="x" aria-label="Remove" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}>×</button></span>
                ))}
              </div>
            )}

            <div className="small" style={{ fontWeight: 600, margin: '12px 0 5px' }}>Or paste a table</div>
            <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
              placeholder={'Copy cells from Excel / Google Sheets, or type one per line:\nBCA Tahapan    15.250.000\nGoPay          1.200.000\nKartu Kredit   3.450.000'} />

            <div className="row mt-s" style={{ alignItems: 'center' }}>
              <div className="small muted grow">
                <b>Templates:</b>{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); downloadText('finplan-import-template.xlsx', workbook(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }}>Excel (accounts + portfolio)</a> ·{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); downloadText('finplan-accounts-template.csv', toCSV(accountsSheet())); }}>Accounts CSV</a> ·{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); downloadText('finplan-portfolio-template.csv', toCSV(portfolioSheet())); }}>Portfolio CSV</a> ·{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); downloadText('finplan-my-data.xlsx', workbook(data), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Edit it in Excel and import it back'); }}>My current data (Excel)</a>
              </div>
              <button className="btn primary" disabled={!!busy} onClick={read}>{busy ? <Sparkles size={15} className="spin" /> : <ArrowRight size={15} />} {busy || 'Read'}</button>
            </div>
            <div className="small muted mt-s">Bank transaction history (mutasi) goes to <a href="#" onClick={(e) => { e.preventDefault(); onClose(); go?.('txns'); }}>Transactions → Import</a>. Files are read on this device{images.length ? '; screenshots are read by Claude' : ''}.</div>
          </>
        )}

        {step === 'accounts' && (
          <>
            <div className="row small muted" style={{ marginBottom: 8 }}>
              <span>{acct.length} account{acct.length === 1 ? '' : 's'} found{port ? ` · ${port.rows.length} portfolio positions next` : ''}</span>
              <span className="grow" />
              <button className="btn sm ghost" onClick={() => setStep('input')}>← Back</button>
            </div>
            {acctTables.map((t) => (
              <details key={t.id} className="map-box">
                <summary className="small">Columns in <b>{t.grid.name}</b>: name = “{t.grid.headers[t.amap.name] ?? '—'}”, balance = “{t.grid.headers[t.amap.balance] ?? 'last number'}”{t.amap.kind >= 0 ? `, type = “${t.grid.headers[t.amap.kind]}”` : ''} · change</summary>
                <div className="row mt-s">
                  {(['name', 'balance', 'kind', 'currency', 'rate', 'payment', 'opened', 'acctNo', 'owner', 'status', 'group'] as const).map((k) => (
                    <label key={k} className="small">{k === 'kind' ? 'Type' : k === 'rate' ? 'Interest %' : k === 'payment' ? 'Monthly payment' : k === 'opened' ? 'Since (year)' : k === 'acctNo' ? 'Account no.' : k === 'group' ? 'Bank / app' : k === 'owner' ? 'Owner' : k[0].toUpperCase() + k.slice(1)}<br />
                      <select className="input" value={t.amap[k]} onChange={(e) => remap(t, { [k]: Number(e.target.value) })}>
                        <option value={-1}>{k === 'balance' ? '(last amount in row, or none)' : '—'}</option>
                        {t.grid.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select></label>
                  ))}
                </div>
              </details>
            ))}
            <div className="scroll-x">
              <table className="scan-table cardify">
                <thead><tr><th></th><th>Account</th><th>Type</th><th>Balance</th><th>Cur</th><th>Save as</th><th>Interest %</th><th>Monthly pay</th><th>Since</th><th>Bank / app</th><th></th></tr></thead>
                <tbody>
                  {acct.map((r) => {
                    const ex = manual.find((a) => a.id === r.match);
                    return (
                      <tr key={r.key} className={r.include ? '' : 'off'}>
                        <td data-l=""><input type="checkbox" checked={r.include} onChange={(e) => setRow(r.key, { include: e.target.checked })} aria-label="Include" /></td>
                        <td data-l="Account"><input className="input" value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} style={{ width: 190 }} />
                          <input className="input sm-input mt-xs" inputMode="numeric" placeholder="Account no. (optional)" aria-label="Account number" value={r.accountNo ?? (r.ref ? r.ref : '')} style={{ width: 190, display: 'block' }}
                            onChange={(e) => { const v = e.target.value.startsWith('···') ? e.target.value.slice(3) : e.target.value; const c = cleanNo(v); setRow(r.key, { accountNo: c.length > 4 ? c : undefined, ref: refOf(c) }); }} />
                          {r.notes?.length ? <div className="small muted" style={{ maxWidth: 240 }}>{r.notes?.filter((n) => !/^No balance/.test(n)).map((n, i) => <div key={i} className={r.include ? '' : 'warn-text'}>{n}</div>)}</div> : null}</td>
                        <td data-l="Type"><select className="input" style={{ minWidth: 120 }} value={r.kind} onChange={(e) => setRow(r.key, { kind: e.target.value as AccountKind })}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}</select></td>
                        <td data-l="Balance"><NumIn v={r.balance} on={(v) => setRow(r.key, { balance: Math.abs(v), needsBalance: v ? undefined : r.needsBalance })} />{r.needsBalance && !r.balance && <div className="small muted">not in file: enter now or after import</div>}{ex && ex.balance !== r.balance && <div className="small muted">was {money(ex.balance)}</div>}</td>
                        <td data-l="Currency"><select className="input" value={r.currency} onChange={(e) => setRow(r.key, { currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</select></td>
                        <td data-l="Save as">{r.insurance ? <span className="pill">Insurance · not in net worth</span> : <select className="input" value={r.match} onChange={(e) => setRow(r.key, { match: e.target.value })} style={{ minWidth: 150 }}>
                          <option value="new">＋ New account</option>
                          {manual.map((a) => <option key={a.id} value={a.id}>Update “{a.name}”</option>)}</select>}</td>
                        <td data-l="Interest %">{r.kind === 'debt' || r.kind === 'investment' ? <NumIn v={r.rate ?? 0} on={(v) => setRow(r.key, { rate: v || undefined })} /> : <span className="muted">—</span>}</td>
                        <td data-l="Monthly pay">{r.kind === 'debt' ? <NumIn v={r.payment ?? 0} on={(v) => setRow(r.key, { payment: v || undefined })} /> : <span className="muted">—</span>}</td>
                        <td data-l="Since"><input className="input" inputMode="numeric" maxLength={4} placeholder="year" value={r.opened ?? ''} onChange={(e) => setRow(r.key, { opened: e.target.value.replace(/\D/g, '').slice(0, 4) || undefined })} style={{ width: 70 }} /></td>
                        <td data-l="Bank / app"><input className="input" list="imp-groups" value={r.group ?? ''} placeholder="e.g. Mayapada" onChange={(e) => setRow(r.key, { group: e.target.value || undefined })} style={{ width: 120 }} /></td>
                        <td data-l=""><button className="btn ghost sm" title="Remove" onClick={() => setAcct((rs) => rs.filter((y) => y.key !== r.key))}><Trash2 size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="imp-groups">{knownGroups([...acct.map((a) => a.group || ''), ...data.accounts.map((a) => a.group || '')]).map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            <button className="btn sm mt-s" onClick={() => setAcct((rs) => [...rs, { key: crypto.randomUUID(), include: true, name: '', kind: 'bank', balance: 0, currency: 'IDR', match: 'new' }])}><Plus size={14} /> Add row</button>
            <div className="scan-save mt">
              <div className="row" style={{ alignItems: 'center' }}>
                <div className="small grow">
                  <b>{acct.filter((a) => a.include && a.match !== 'new').length}</b> to update · <b>{acct.filter((a) => a.include && a.match === 'new').length}</b> new · net {money(sumIDR)}
                  <div className="muted">Matched by account number, then name. Debts are saved as amounts owed. Foreign currencies (USD, SGD…) are kept in their currency and counted at the live rate; USD is converted at Rp {data.settings.usdIdr.toLocaleString('id-ID')}. Synced app accounts (Bitget, Pluang…) are never overwritten.</div>
                </div>
                {port && <button className="btn" onClick={() => setStep('portfolio')}>Skip <ArrowRight size={14} /></button>}
                <button className="btn primary" onClick={saveAccounts}><Check size={15} /> Save accounts{port ? ' & continue' : ''}</button>
              </div>
            </div>
          </>
        )}

        {step === 'portfolio' && port && (
          <>
            {savedAccts && <div className="banner small" style={{ marginBottom: 8 }}><Check size={15} color="var(--good)" /> Accounts saved ({savedAccts}). Now check the portfolio.</div>}
            <PortfolioReview data={data} update={update} result={port} target0={portSource} onBack={acct.length && !savedAccts ? () => setStep('accounts') : () => setStep('input')} onSaved={onClose} />
          </>
        )}
      </div>
    </Modal>
  );
}

function bothPrompt() {
  return `${scanPrompt('', '').split('Reply with ONLY')[0]}
ALSO list every account balance you see (bank, e-wallet, cash, loans, credit cards) in "accounts" (kind bank|ewallet|cash|investment|asset|debt; debts as positive amounts owed).
Reply with ONLY this JSON, no prose:
{"broker": string|null, "asOf": "YYYY-MM-DD"|null, "rows": [{"symbol":"BBCA","name":"…","assetClass":"stock","market":"IDX","qty":10,"qtyUnit":"lots","avgPrice":8950,"price":9100,"value":9100000,"pnl":null,"currency":"IDR"}], "accounts": [{"name":"BCA Tahapan","kind":"bank","balance":15000000,"currency":"IDR"}]}`;
}

/** Small entry button used on several pages. */
export function ImportButton({ onClick, label = 'Import data' }: { onClick: () => void; label?: string }) {
  return <button className="btn" onClick={onClick}><Upload size={15} /> {label}</button>;
}
