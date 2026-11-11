import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, ImagePlus, X, Trash2, Plus, Square, KeyRound, ShieldCheck, Sparkles, Cpu } from 'lucide-react';
import { Modal, Seg, Field, toast } from './ui';
import type { AppData, Holding, Source } from '../lib/types';
import { SOURCE_LABEL, syncAccounts } from '../lib/holdings';
import { availableEngines, DEFAULT_MODEL, mergeHoldings, resolveRow, rowsToHoldings, runScan, saveApiKey, type Engines, type ScanEngine, type ScanResult, type ScanRow } from '../lib/smartScan';
import { platform } from '../lib/net';
import { uid } from '../lib/store';

const SOURCES: Source[] = ['stockbit', 'pluang', 'bitget', 'bittime', 'alpaca', 'tradingview', 'manual'];
const CLASSES: { v: Holding['assetClass']; l: string }[] = [
  { v: 'stock', l: 'Stock / ETF' }, { v: 'crypto', l: 'Crypto' }, { v: 'gold', l: 'Gold' }, { v: 'mutualfund', l: 'Fund' }, { v: 'bond', l: 'Bond' }, { v: 'deposit', l: 'Deposit' }, { v: 'cash', l: 'Cash' },
];
const MARKETS: NonNullable<Holding['market']>[] = ['IDX', 'US', 'CRYPTO', 'OTHER'];
const fmt = (n: number, c: 'IDR' | 'USD') => (c === 'USD' ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'Rp' + Math.round(n).toLocaleString('id-ID'));

interface Props { data: AppData; update: (fn: (d: AppData) => AppData) => void; onClose: () => void; source?: Source }

export default function SmartScan({ data, update, onClose, source }: Props) {
  const [eng, setEng] = useState<Engines | null>(null);
  const [engine, setEngine] = useState<ScanEngine>('text');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<Source | ''>(source || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  const refreshEngines = () => availableEngines().then((e) => {
    setEng(e);
    setEngine((cur) => (cur !== 'text' && ((cur === 'claude' && e.claude) || (cur === 'api' && e.api)) ? cur : e.claude ? 'claude' : e.api ? 'api' : 'text'));
  });
  useEffect(() => { refreshEngines(); }, []);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => /^image\//.test(f.type) || f.type === 'application/pdf');
    if (ok.length < [...list].length) toast('Only images (PNG, JPG, WebP) and PDF files can be scanned');
    setFiles((cur) => [...cur, ...ok].slice(0, 8));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => /^image\//.test(f.type));
    if (imgs.length) { e.preventDefault(); addFiles(imgs.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type }))); }
  };

  const scan = async () => {
    if (engine === 'text' && files.length && !text.trim()) { toast('The on-device reader reads pasted text only. Pick Claude to read screenshots.'); return; }
    ctl.current = new AbortController();
    setBusy('Starting…');
    try {
      const r = await runScan({ files: engine === 'text' ? [] : files, text, hint: hint ? SOURCE_LABEL[hint] : '', engine, signal: ctl.current.signal, onProgress: setBusy });
      setRes(r);
      if (!r.rows.length) toast('No positions found');
    } catch (e: any) { toast(e.message || 'Scan failed'); }
    setBusy(null);
  };

  return (
    <Modal title="Smart scan portfolio" onClose={() => { ctl.current?.abort(); onClose(); }} wide>
      <div onPaste={onPaste}>
        {!res ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>Scan a screenshot or statement of your holdings from any app (Stockbit, Pluang, Bitget, Bittime, Ajaib, IPOT, Bibit, a bank…). You check every row before it is saved.</p>

            <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Reader</div>
            <div className="scan-engines">
              <button className={`scan-eng ${engine === 'claude' ? 'on' : ''}`} disabled={!eng?.claude} onClick={() => setEngine('claude')}>
                <Sparkles size={16} /><b>Claude</b><span>{eng?.claude ? (eng.claudeImages ? 'Reads screenshots and text, here in Claude' : 'Reads pasted text, here in Claude') : 'Available when FinPlan runs inside Claude'}</span>
              </button>
              <button className={`scan-eng ${engine === 'api' ? 'on' : ''}`} onClick={() => { setEngine('api'); if (!eng?.api) setShowKey(true); }}>
                <KeyRound size={16} /><b>Claude API</b><span>{eng?.api ? `Your key · ${eng.apiModel} · screenshots, PDF, text` : 'Use your own Claude API key (apps)'}</span>
              </button>
              <button className={`scan-eng ${engine === 'text' ? 'on' : ''}`} onClick={() => setEngine('text')}>
                <Cpu size={16} /><b>On-device</b><span>Pasted text only, no AI, nothing leaves this device</span>
              </button>
            </div>

            {(showKey || (engine === 'api' && !eng?.api)) && <KeySetup onSaved={() => { setShowKey(false); refreshEngines(); }} hasKey={!!eng?.api} model={eng?.apiModel || DEFAULT_MODEL} />}

            {engine !== 'text' && (
              <div className={`drop mt-s ${files.length ? 'has' : ''}`} onClick={() => fileIn.current?.click()}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
                <ImagePlus size={22} />
                <div><b>Add screenshots or PDF</b> · drop, click, or paste (Ctrl/⌘+V)<div className="small muted">Up to 8 files. Crop to the holdings list for best results.{engine === 'claude' ? ' Inside Claude: images only.' : ''}</div></div>
                <input ref={fileIn} type="file" hidden multiple accept={engine === 'claude' ? 'image/*' : 'image/*,application/pdf'} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>
            )}
            {files.length > 0 && engine !== 'text' && (
              <div className="thumbs">
                {files.map((f, i) => <Thumb key={i} f={f} onRemove={() => setFiles((c) => c.filter((_, j) => j !== i))} />)}
              </div>
            )}

            <Field label={engine === 'text' ? 'Paste text copied from your broker app, statement or spreadsheet' : 'Or paste text (optional)'} full>
              <textarea className="input" rows={engine === 'text' ? 8 : 3} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={'BBCA  10 lot  avg 8.950  last 9.100\nTLKM  25 lot  avg 3.120  last 1.980\nBTC 0.0125  avg $61,000'} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
            </Field>

            <div className="row mt-s" style={{ alignItems: 'flex-end' }}>
              <Field label="From which app?">
                <select className="input" value={hint} onChange={(e) => setHint(e.target.value as Source | '')}>
                  <option value="">Detect automatically</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{s === 'manual' ? 'Other / bank / manual' : SOURCE_LABEL[s]}</option>)}
                </select>
              </Field>
              <div className="grow" />
              {busy ? <button className="btn" onClick={() => ctl.current?.abort()}><Square size={14} /> Stop</button> : null}
              <button className="btn primary" disabled={!!busy || (engine === 'api' && !eng?.api) || (engine === 'claude' && !eng?.claude)} onClick={scan}>
                <ScanLine size={16} className={busy ? 'spin' : ''} /> {busy || 'Scan'}
              </button>
            </div>
            <div className="small muted mt-s"><ShieldCheck size={13} style={{ verticalAlign: -2 }} /> {engine === 'claude' ? 'The files go to Claude on your own account; FinPlan keeps only the rows you save.' : engine === 'api' ? 'Files are sent only to api.anthropic.com with your key. Your key is stored encrypted in your vault.' : 'Parsed on this device. Nothing is uploaded.'}</div>
          </>
        ) : (
          <>
            <PortfolioReview data={data} update={update} result={res} target0={(hint || res.broker || source || 'manual') as Source} onBack={() => setRes(null)} onSaved={onClose} />
          </>
        )}
      </div>
    </Modal>
  );
}

/** Editable review of portfolio rows (from Smart scan or a file), then save to a broker. */
export function PortfolioReview({ data, update, result: res, target0, onBack, onSaved }: { data: AppData; update: (fn: (d: AppData) => AppData) => void; result: ScanResult; target0: Source; onBack?: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<ScanRow[]>(res.rows);
  const [target, setTarget] = useState<Source>(target0);
  const [mode, setMode] = useState<'replace' | 'merge'>(() => (data.holdings.some((h) => h.source === target0) ? 'merge' : 'replace'));
  const usdIdr = data.settings.usdIdr;
  const set = (k: string, patch: Partial<ScanRow>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const totals = useMemo(() => {
    let idr = 0; for (const r of rows) if (r.include) { const x = resolveRow(r); idr += x.value * (r.currency === 'USD' ? usdIdr : 1); }
    return { idr, n: rows.filter((r) => r.include).length };
  }, [rows, usdIdr]);
  const existing = data.holdings.filter((h) => h.source === target).length;

  const save = () => {
    const hs = rowsToHoldings(rows, target);
    if (!hs.length) { toast('Nothing to save: tick at least one row with a quantity'); return; }
    update((d) => syncAccounts({
      ...d, holdings: mergeHoldings(d.holdings, hs, target, mode),
      settings: { ...d.settings, connections: { ...d.settings.connections, [target]: { ...d.settings.connections[target], lastSync: new Date().toISOString(), status: 'ok', via: 'file', message: `${res.engine === 'file' ? 'Import' : 'Smart scan'} · ${hs.length} positions${res?.asOf ? ' as of ' + res.asOf : ''}` } } },
    }));
    toast(`Saved ${hs.length} ${SOURCE_LABEL[target]} positions`);
    onSaved();
  };

  const live = target === 'pluang' || target === 'bitget' || target === 'bittime' || target === 'alpaca';


  return (
    <>
            {res.warnings.map((w, i) => <div key={i} className="banner small" style={{ marginBottom: 8 }}>{w}</div>)}
            <div className="row small muted" style={{ marginBottom: 8 }}>
              <span>Read by <b>{res.engine === 'claude' ? 'Claude' : res.engine === 'api' ? 'Claude API' : res.engine === 'file' ? 'file import' : 'on-device reader'}</b></span>
              {res.brokerName && <span>· looks like <b>{res.brokerName}</b></span>}
              {res.asOf && <span>· as of {res.asOf}</span>}
              <span className="grow" />
              {onBack && <button className="btn sm ghost" onClick={onBack}>← Back</button>}
            </div>
            <div className="scroll-x">
              <table className="scan-table cardify">
                <thead><tr><th></th><th>Symbol</th><th>Name</th><th>Type</th><th>Market</th><th>Qty</th><th>Unit</th><th>Avg price</th><th>Last price</th><th>Value</th><th>Cur</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const x = resolveRow(r);
                    return (
                      <tr key={r.key} className={r.include ? '' : 'off'}>
                        <td data-l=""><input type="checkbox" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} aria-label="Include" /></td>
                        <td data-l="Symbol"><input className="input" value={r.symbol} onChange={(e) => set(r.key, { symbol: e.target.value.toUpperCase().trim() })} style={{ width: 82 }} /></td>
                        <td data-l="Name"><input className="input" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} style={{ width: 140 }} /></td>
                        <td data-l="Type"><select className="input" value={r.assetClass} onChange={(e) => set(r.key, { assetClass: e.target.value as Holding['assetClass'] })}>{CLASSES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}</select></td>
                        <td data-l="Market"><select className="input" value={r.market} onChange={(e) => set(r.key, { market: e.target.value as ScanRow['market'] })}>{MARKETS.map((m) => <option key={m}>{m}</option>)}</select></td>
                        <td data-l="Qty"><NumIn v={r.qty} on={(v) => set(r.key, { qty: v })} /></td>
                        <td data-l="Unit"><select className="input" value={r.qtyUnit} onChange={(e) => set(r.key, { qtyUnit: e.target.value as ScanRow['qtyUnit'] })}><option value="lots">lots</option><option value="shares">shares</option><option value="units">units</option></select></td>
                        <td data-l="Avg price"><NumIn v={r.avgPrice} on={(v) => set(r.key, { avgPrice: v })} ph={x.avg ? String(+x.avg.toFixed(4)) : ''} /></td>
                        <td data-l="Last price"><NumIn v={r.price} on={(v) => set(r.key, { price: v })} ph={x.price ? String(+x.price.toFixed(4)) : ''} /></td>
                        <td data-l="Value" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{fmt(x.value, r.currency)}{r.qtyUnit === 'lots' && <div className="small muted">{x.shares.toLocaleString('id-ID')} sh</div>}</td>
                        <td data-l="Currency"><select className="input" value={r.currency} onChange={(e) => set(r.key, { currency: e.target.value as 'IDR' | 'USD' })}><option>IDR</option><option>USD</option></select></td>
                        <td data-l=""><button className="btn ghost sm" title="Remove" onClick={() => setRows((rs) => rs.filter((y) => y.key !== r.key))}><Trash2 size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="btn sm mt-s" onClick={() => setRows((rs) => [...rs, { key: uid(), include: true, symbol: '', name: '', assetClass: 'stock', market: 'IDX', qty: 0, qtyUnit: 'lots', avgPrice: 0, price: 0, value: 0, pnl: null, currency: 'IDR' }])}><Plus size={14} /> Add row</button>

            <div className="scan-save mt">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Save to">
                  <select className="input" value={target} onChange={(e) => { const t = e.target.value as Source; setTarget(t); setMode(data.holdings.some((h) => h.source === t) ? 'merge' : 'replace'); }}>
                    {SOURCES.map((s) => <option key={s} value={s}>{s === 'manual' ? 'Manual / other' : SOURCE_LABEL[s]}</option>)}
                  </select>
                </Field>
                <div>
                  <div className="small" style={{ fontWeight: 600, marginBottom: 5 }}>How</div>
                  <Seg value={mode} onChange={setMode} options={[{ v: 'merge', l: 'Update & add' }, { v: 'replace', l: `Replace all ${SOURCE_LABEL[target]}` }]} />
                </div>
                <div className="grow" />
                <div style={{ textAlign: 'right' }}><div className="small muted">{totals.n} positions</div><div style={{ fontWeight: 800, fontSize: 18 }}>{fmt(totals.idr, 'IDR')}</div></div>
                <button className="btn primary" onClick={save}><ScanLine size={15} /> Save positions</button>
              </div>
              <div className="small muted mt-s">
                {mode === 'replace' ? `Removes the ${existing} current ${SOURCE_LABEL[target]} position${existing === 1 ? '' : 's'} and saves these instead.` : `Same symbols are updated; other ${SOURCE_LABEL[target]} positions are kept.`}
                {live && ` A live ${SOURCE_LABEL[target]} sync will replace these with the app's own data.`}
                {' '}IDX lots are saved as shares (1 lot = 100). Prices update with “Update prices”.
              </div>
            </div>
    </>
  );
}

export function NumIn({ v, on, ph }: { v: number; on: (n: number) => void; ph?: string }) {
  const [s, setS] = useState(v ? String(v) : '');
  useEffect(() => { if (Number(s.replace(',', '.')) !== v) setS(v ? String(v) : ''); }, [v]);
  return <input className="input" inputMode="decimal" value={s} placeholder={ph} style={{ width: 96, textAlign: 'right' }}
    onChange={(e) => { setS(e.target.value); const n = Number(e.target.value.replace(/\s/g, '').replace(',', '.')); on(isFinite(n) ? n : 0); }} />;
}

function Thumb({ f, onRemove }: { f: File; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!/^image\//.test(f.type)) return; const u = URL.createObjectURL(f); setUrl(u); return () => URL.revokeObjectURL(u); }, [f]);
  return (
    <div className="thumb" title={f.name}>
      {url ? <img src={url} alt="" /> : <div className="pdf">PDF</div>}
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove"><X size={12} /></button>
    </div>
  );
}

export function KeySetup({ onSaved, hasKey, model }: { onSaved: () => void; hasKey: boolean; model: string }) {
  const [k, setK] = useState(''); const [m, setM] = useState(model);
  return (
    <div className="card mt-s" style={{ padding: 14, background: 'var(--bg)' }}>
      <div className="small" style={{ fontWeight: 700 }}><KeyRound size={14} style={{ verticalAlign: -2 }} /> Claude API key {hasKey && <span className="pill good">saved</span>}</div>
      <div className="small muted" style={{ margin: '4px 0 8px' }}>
        For the desktop, phone and web apps. Create a key at console.anthropic.com (pay-as-you-go, about a cent per screenshot). It is encrypted in your vault and sent only to api.anthropic.com.
        {platform() === 'web' && ' On a public computer prefer the on-device reader.'}
      </div>
      <div className="row">
        <input className="input grow" type="password" autoComplete="off" placeholder={hasKey ? '•••••••• (saved, enter a new one to replace)' : 'sk-ant-…'} value={k} onChange={(e) => setK(e.target.value)} />
        <input className="input" style={{ width: 170 }} value={m} onChange={(e) => setM(e.target.value)} title="Model" />
        <button className="btn sm primary" disabled={!k.trim().startsWith('sk-')} onClick={async () => { await saveApiKey(k, m.trim() || DEFAULT_MODEL); setK(''); toast('Claude API key saved (encrypted)'); onSaved(); }}>Save</button>
        {hasKey && <button className="btn sm danger" onClick={async () => { await saveApiKey(null); toast('Key removed'); onSaved(); }}>Remove</button>}
      </div>
    </div>
  );
}
