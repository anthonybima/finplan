import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Upload, Download, Plus, KeyRound, ExternalLink, Trash2, LineChart as ChartIcon, ShieldCheck, Unplug, ScanLine } from 'lucide-react';
import type { ViewProps } from '../App';
import type { AppData, AssetClass, Holding, Source } from '../lib/types';
import { costIDR, downloadText, fetchUsdIdr, holdingsTemplateCSV, parseHoldingsFile, refreshPrices, replaceSource, SOURCE_LABEL, syncAccounts, tvSymbol, valueIDR } from '../lib/holdings';
import { syncBitget, type BitgetCreds } from '../lib/bitget';
import { syncBittime, type BittimeCreds } from '../lib/bittime';
import { syncAlpaca, type AlpacaCreds } from '../lib/alpaca';
import { resetPluangAvailability } from '../lib/market';
import { stockbitUrl } from '../lib/marketCatalog';
import SmartScan from '../components/SmartScan';
import { normYear } from '../lib/wealthYears';
import { pluangConnectorAvailable, syncPluangConnector } from '../lib/pluangConnector';
import { connectPluang, disconnectPluang, pluangMcpConnected, pluangMcpSupported, syncPluangMcp } from '../lib/pluangMcp';
import { parseTradingViewCSV, toTradingViewCSV } from '../lib/tradingview';
import { getJSONSecret, setSecret } from '../lib/secure';
import { platform } from '../lib/net';
import { ASSUMPTIONS } from '../lib/risk';
import { fmtDate, money, pct, today } from '../lib/format';
import { uid } from '../lib/store';
import { Card, Field, Modal, MoneyInput, Seg, Stat, toast } from '../components/ui';
import TVWidget from '../components/TVWidget';

const BRAND: Record<Exclude<Source, 'manual'>, { color: string; letter: string; how: string }> = {
  bitget: { color: '#00c8c8', letter: 'B', how: 'Live sync with a read-only API key' },
  bittime: { color: '#f5a623', letter: 'Bt', how: 'Live sync with an API key (no trade/withdraw)' },
  alpaca: { color: '#fcd72b', letter: 'A', how: 'Live sync of US stocks, options & crypto (live or paper)' },
  pluang: { color: '#1a73e8', letter: 'P', how: 'Direct MCP sign-in (read-only) or snapshot import' },
  stockbit: { color: '#05a84f', letter: 'S', how: 'Your holdings + live IDX prices' },
  tradingview: { color: '#2962ff', letter: 'TV', how: 'Charts + portfolio CSV import/export' },
};

const fmtQty = (n: number) => (n >= 1000 ? n.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : n.toLocaleString('id-ID', { maximumFractionDigits: n < 1 ? 8 : 4 }));
const px = (n: number, c: 'IDR' | 'USD') => (c === 'USD' ? `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 })}` : `Rp${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`);

export default function Connections({ data, update, openImport }: ViewProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Source>('all');
  const [edit, setEdit] = useState<Holding | { source: Source } | null>(null);
  const [keyModal, setKeyModal] = useState<KeyExchange | null>(null);
  const [hasKey, setHasKey] = useState<Record<KeyExchange, boolean>>({ bitget: false, bittime: false, alpaca: false });
  const [pluangLive, setPluangLive] = useState(false);
  const [scan, setScan] = useState<Source | 'any' | null>(null);
  const [pluangClaude, setPluangClaude] = useState(false); // Claude's own Pluang connector (artifact)
  const hasBitget = hasKey.bitget;
  const [chart, setChart] = useState<string>('IDX:COMPOSITE');
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingImport = useRef<Source>('pluang');
  const rate = data.settings.usdIdr;
  const conn = data.settings.connections;

  useEffect(() => {
    Promise.all([getJSONSecret<BitgetCreds>('bitget'), getJSONSecret<BittimeCreds>('bittime'), getJSONSecret<AlpacaCreds>('alpaca')])
      .then(([a, b, c]) => setHasKey({ bitget: !!a?.apiKey, bittime: !!b?.apiKey, alpaca: !!c?.apiKey }));
    pluangMcpConnected().then(setPluangLive);
  }, [keyModal]);
  useEffect(() => { pluangConnectorAvailable().then(setPluangClaude); }, []);

  const rows = useMemo(() => data.holdings.filter((h) => filter === 'all' || h.source === filter)
    .sort((a, b) => valueIDR(b, rate) - valueIDR(a, rate)), [data.holdings, filter, rate]);
  const counted = data.holdings.filter((h) => !h.excluded);
  const total = counted.reduce((s, h) => s + valueIDR(h, rate), 0);
  const cost = counted.filter((h) => h.assetClass !== 'cash').reduce((s, h) => s + costIDR(h, rate), 0);
  const invested = counted.filter((h) => h.assetClass !== 'cash').reduce((s, h) => s + valueIDR(h, rate), 0);
  const bySource = (s: Source) => counted.filter((h) => h.source === s).reduce((t, h) => t + valueIDR(h, rate), 0);
  const tickerSymbols = useMemo(() => [...new Set(data.holdings.filter((h) => h.market && h.market !== 'OTHER' && h.assetClass !== 'cash').sort((a, b) => valueIDR(b, rate) - valueIDR(a, rate)).slice(0, 15).map(tvSymbol))], [data.holdings, rate]);

  const setStatus = (s: Source, status: 'ok' | 'error', message?: string) =>
    update((d) => ({ ...d, settings: { ...d.settings, connections: { ...d.settings.connections, [s]: { ...d.settings.connections[s], status, message, ...(status === 'ok' ? { lastSync: new Date().toISOString() } : {}) } } } }));

  const doBitget = async () => {
    const c = await getJSONSecret<BitgetCreds>('bitget');
    if (!c) { setKeyModal('bitget'); return; }
    setBusy('bitget');
    try {
      const r = await syncBitget(c);
      update((d) => replaceSource(d, 'bitget', r.holdings, { message: `${r.holdings.length} positions · $${r.totalUsd.toFixed(0)}${r.note ? ' · ' + r.note : ''}` }));
      toast(`Bitget synced: ${r.holdings.length} positions`);
    } catch (e: any) { setStatus('bitget', 'error', e.message); toast(e.message); }
    setBusy(null);
  };

  const doBittime = async () => {
    const c = await getJSONSecret<BittimeCreds>('bittime');
    if (!c) { setKeyModal('bittime'); return; }
    setBusy('bittime');
    try {
      const r = await syncBittime(c);
      update((d) => replaceSource(d, 'bittime', r.holdings, { message: `${r.holdings.length} assets · $${r.totalUsd.toFixed(0)}${r.totalIdr ? ` + Rp${Math.round(r.totalIdr).toLocaleString('id-ID')}` : ''}` }));
      toast(`Bittime synced: ${r.holdings.length} assets`);
    } catch (e: any) { setStatus('bittime', 'error', e.message); toast(e.message); }
    setBusy(null);
  };

  const doAlpaca = async () => {
    const c = await getJSONSecret<AlpacaCreds>('alpaca');
    if (!c) { setKeyModal('alpaca'); return; }
    setBusy('alpaca');
    try {
      const r = await syncAlpaca(c);
      update((d) => replaceSource(d, 'alpaca', r.holdings, { via: 'api', message: `${r.paper ? 'PAPER account (not counted in net worth)' : 'Live account'} · equity $${r.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })} · ${r.holdings.length} positions` }));
      toast(`Alpaca synced${r.paper ? ' (paper)' : ''}: ${r.holdings.length} positions`);
    } catch (e: any) { setStatus('alpaca', 'error', e.message); toast(e.message); }
    setBusy(null);
  };

  const doPluang = async () => {
    setBusy('pluang');
    try {
      let r;
      if (await pluangConnectorAvailable()) {
        r = await syncPluangConnector(rate);
        update((d) => replaceSource(d, 'pluang', r!.holdings, { via: 'mcp', summary: r!.summary, message: `Live via Claude's Pluang connector · ${r!.summary.positions} positions` }));
      } else {
        if (!(await pluangMcpConnected())) { toast('Opening Pluang sign-in in your browser…'); await connectPluang(); setPluangLive(true); resetPluangAvailability(); }
        r = await syncPluangMcp(rate);
        update((d) => replaceSource(d, 'pluang', r!.holdings, { via: 'mcp', summary: r!.summary, message: `Live via Pluang MCP · ${r!.summary.positions} positions` }));
      }
      toast(`Pluang synced: ${r.summary.positions} positions`);
    } catch (e: any) {
      if (e.needsLogin) setPluangLive(false);
      setStatus('pluang', 'error', e.message); toast(e.message);
    }
    setBusy(null);
  };

  const doPrices = async (quiet = false) => {
    setBusy('prices');
    const fx = await fetchUsdIdr();
    const live = new Set<Source>(['bitget', 'bittime', 'alpaca', ...(conn.pluang?.via === 'mcp' ? (['pluang'] as Source[]) : [])]);
    const targets = data.holdings.filter((h) => !live.has(h.source));
    const r = await refreshPrices(targets, fx || rate);
    const map = new Map(r.holdings.map((h) => [h.id, h]));
    update((d) => syncAccounts({ ...d, holdings: d.holdings.map((h) => map.get(h.id) || h), settings: { ...d.settings, ...(fx ? { usdIdr: Math.round(fx), usdIdrAt: new Date().toISOString() } : {}) } }));
    if (!quiet) toast(`Prices updated: ${r.updated}${r.failed.length ? ` · not found: ${r.failed.slice(0, 4).join(', ')}` : ''}${fx ? ` · USD/IDR ${Math.round(fx)}` : ''}`);
    setBusy(null);
  };

  const syncAll = async () => { if (hasKey.bitget) await doBitget(); if (hasKey.bittime) await doBittime(); if (hasKey.alpaca) await doAlpaca(); if (pluangLive || pluangClaude) await doPluang(); await doPrices(); };

  const importFile = async (f?: File) => {
    if (!f) return;
    const src = pendingImport.current;
    try {
      if (src === 'tradingview') {
        const hs = parseTradingViewCSV(await f.text(), 'IDR');
        update((d) => replaceSource(d, 'tradingview', hs, { message: `${hs.length} positions from ${f.name}` }));
        toast(`Imported ${hs.length} TradingView positions`);
      } else {
        const r = await parseHoldingsFile(f, src);
        update((d) => replaceSource({ ...d, settings: { ...d.settings, ...(r.usdIdr ? { usdIdr: r.usdIdr } : {}) } }, r.source, r.holdings, { via: 'file', summary: r.summary, message: `${r.holdings.length} positions from ${f.name}` }));
        toast(`Imported ${r.holdings.length} ${SOURCE_LABEL[r.source]} positions`);
      }
    } catch (e: any) { toast(e.message || 'Import failed'); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const pick = (s: Source) => { pendingImport.current = s; fileRef.current?.click(); };

  const status = (s: Source) => {
    const c = conn[s];
    if (c?.status === 'error') return <span className="pill bad" title={c.message}>Error</span>;
    if (!c?.lastSync && !data.holdings.some((h) => h.source === s)) return <span className="pill">Not connected</span>;
    return <span className="pill good">Synced {c?.lastSync ? fmtDate(c.lastSync.slice(0, 10)) : ''}</span>;
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Connections</h1><div className="sub">Bring in your investments from Bitget, Bittime, Alpaca, Pluang, Stockbit and TradingView</div></div>
        <div className="row">
          <button className="btn" onClick={() => openImport?.('portfolio')}><Upload size={15} /> Import data</button>
          <button className="btn primary" onClick={() => setScan('any')}><ScanLine size={15} /> Smart scan</button>
          <label className="row small muted" style={{ gap: 6 }}>USD/IDR
            <input className="input" style={{ width: 96 }} type="number" value={rate} onChange={(e) => update((d) => syncAccounts({ ...d, settings: { ...d.settings, usdIdr: Number(e.target.value) || d.settings.usdIdr } }))} />
          </label>
          <button className="btn primary" disabled={!!busy} onClick={syncAll}><RefreshCw size={16} className={busy ? 'spin' : ''} /> {busy ? 'Syncing…' : 'Sync all'}</button>
        </div>
      </div>
      {platform() === 'web' && (
        <div className="banner" style={{ background: 'var(--tip-soft)' }}><ShieldCheck color="var(--tip)" />
          <div className="grow small"><b>Tip:</b> live sync (Bitget, Bittime, Alpaca) and price updates work best in the <b>desktop or mobile app</b>, and Pluang sign-in runs in the <b>desktop app</b>{pluangClaude ? ' (here in Claude, Pluang syncs through Claude\'s connector)' : ''}. <b>Smart scan</b> works everywhere. Web browsers block direct calls to exchange APIs (CORS), and API keys are never sent through a proxy.</div></div>
      )}

      <div className="grid g4 keep">
        <Stat label="Connected investments" value={money(total, true)} delta={`${data.holdings.length} positions`} />
        <Stat label="Unrealised P/L" value={money(invested - cost, true)} delta={cost ? pct((invested - cost) / cost) : undefined} tone={invested >= cost ? 'pos' : 'neg'} />
        <Stat label="USD exposure" value={pct(total ? data.holdings.filter((h) => h.currency === 'USD').reduce((s, h) => s + valueIDR(h, rate), 0) / total : 0, 0)} delta={`@ Rp${rate.toLocaleString('id-ID')}/USD`} />
        <Stat label="Last price update" value={data.settings.usdIdrAt ? fmtDate(data.settings.usdIdrAt.slice(0, 10)) : '–'} delta="Sync weekly in your review" />
      </div>

      <div className="grid g2 mt">
        {/* ---------- Bitget ---------- */}
        <ConnCard id="bitget" status={status('bitget')} value={bySource('bitget')} message={conn.bitget?.message}>
          <p className="small muted" style={{ margin: '0 0 10px' }}>Spot coins, futures, earn and bot balances via Bitget's official API. Use a <b>read-only</b> key: FinPlan never trades or withdraws.</p>
          <div className="row">
            <button className="btn sm primary" disabled={!!busy} onClick={doBitget}><RefreshCw size={14} className={busy === 'bitget' ? 'spin' : ''} /> {hasBitget ? 'Sync now' : 'Connect'}</button>
            <button className="btn sm" onClick={() => setKeyModal('bitget')}><KeyRound size={14} /> API key</button>
            <button className="btn sm" onClick={() => setScan('bitget')}><ScanLine size={14} /> Smart scan</button>
            {hasBitget && <button className="btn sm danger" onClick={async () => { await setSecret('bitget', null); setHasKey((k) => ({ ...k, bitget: false })); update((d) => replaceSource(d, 'bitget', [])); toast('Bitget disconnected'); }}><Unplug size={14} /> Disconnect</button>}
          </div>
        </ConnCard>

        {/* ---------- Bittime ---------- */}
        <ConnCard id="bittime" status={status('bittime')} value={bySource('bittime')} message={conn.bittime?.message}>
          <p className="small muted" style={{ margin: '0 0 10px' }}>Your coin and rupiah balances via Bittime's Open API, valued live in USD/IDR. Create the key with <b>Trade and Withdraw switched off</b> and IP-restricted. FinPlan only reads balances.</p>
          <div className="row">
            <button className="btn sm primary" disabled={!!busy} onClick={doBittime}><RefreshCw size={14} className={busy === 'bittime' ? 'spin' : ''} /> {hasKey.bittime ? 'Sync now' : 'Connect'}</button>
            <button className="btn sm" onClick={() => setKeyModal('bittime')}><KeyRound size={14} /> API key</button>
            <button className="btn sm" onClick={() => setScan('bittime')}><ScanLine size={14} /> Smart scan</button>
            {hasKey.bittime && <button className="btn sm danger" onClick={async () => { await setSecret('bittime', null); setHasKey((k) => ({ ...k, bittime: false })); update((d) => replaceSource(d, 'bittime', [])); toast('Bittime disconnected'); }}><Unplug size={14} /> Disconnect</button>}
          </div>
        </ConnCard>

        {/* ---------- Pluang ---------- */}
        <ConnCard id="pluang" status={status('pluang')} value={bySource('pluang')} message={conn.pluang?.message}>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            Connects straight to Pluang's official MCP server (<code>mcp.pluang.com</code>). Sign in once on Pluang's own login page. FinPlan asks <b>only for read access</b> (portfolio + market data), never <i>trade:write</i>, so it cannot place orders.
            {pluangClaude ? <> Inside Claude, FinPlan reads your portfolio and cash wallets through <b>Claude's Pluang connector</b> (it syncs automatically when you open FinPlan).</>
              : !pluangMcpSupported() && <> Direct sign-in runs in the <b>desktop app</b>; here you can import a snapshot file, or use <b>Smart scan</b> on a screenshot of your Pluang portfolio.</>}
          </p>
          <div className="row">
            {(pluangMcpSupported() || pluangClaude) && <button className="btn sm primary" disabled={!!busy} onClick={doPluang}><RefreshCw size={14} className={busy === 'pluang' ? 'spin' : ''} /> {pluangClaude ? 'Sync portfolio' : pluangLive ? 'Sync now' : 'Sign in with Pluang'}</button>}
            <button className={`btn sm ${pluangMcpSupported() || pluangClaude ? '' : 'primary'}`} onClick={() => pick('pluang')}><Upload size={14} /> Import snapshot</button>
            <button className="btn sm" onClick={() => setScan('pluang')}><ScanLine size={14} /> Smart scan</button>
            {pluangLive && <button className="btn sm danger" onClick={async () => { await disconnectPluang(); setPluangLive(false); resetPluangAvailability(); toast('Pluang disconnected and access revoked'); }}><Unplug size={14} /> Disconnect</button>}
            <a className="btn sm" href="https://pluang.com/en/fitur/agentic-trading" target="_blank" rel="noreferrer"><ExternalLink size={14} /> About</a>
          </div>
        </ConnCard>

        {/* ---------- Alpaca ---------- */}
        <ConnCard id="alpaca" status={status('alpaca')} value={bySource('alpaca')} message={conn.alpaca?.message}>
          <p className="small muted" style={{ margin: '0 0 10px' }}>US stocks, ETFs, options and crypto through Alpaca's Trading API. FinPlan only reads your account and positions. Paper-trading accounts are shown but <b>not counted</b> in your net worth.</p>
          <div className="row">
            <button className="btn sm primary" disabled={!!busy} onClick={doAlpaca}><RefreshCw size={14} className={busy === 'alpaca' ? 'spin' : ''} /> {hasKey.alpaca ? 'Sync now' : 'Connect'}</button>
            <button className="btn sm" onClick={() => setKeyModal('alpaca')}><KeyRound size={14} /> API key</button>
            <button className="btn sm" onClick={() => setScan('alpaca')}><ScanLine size={14} /> Smart scan</button>
            {hasKey.alpaca && <button className="btn sm danger" onClick={async () => { await setSecret('alpaca', null); setHasKey((k) => ({ ...k, alpaca: false })); update((d) => replaceSource(d, 'alpaca', [])); toast('Alpaca disconnected'); }}><Unplug size={14} /> Disconnect</button>}
          </div>
        </ConnCard>

        {/* ---------- Stockbit ---------- */}
        <ConnCard id="stockbit" status={status('stockbit')} value={bySource('stockbit')} message={conn.stockbit?.message}>
          <p className="small muted" style={{ margin: '0 0 10px' }}>Stockbit has no public API. <b>Smart scan</b> a screenshot of your Stockbit portfolio, add positions in lots, or import a CSV. FinPlan then updates IDX prices automatically.</p>
          <div className="row">
            <button className="btn sm primary" onClick={() => setScan('stockbit')}><ScanLine size={14} /> Smart scan</button>
            <button className="btn sm" onClick={() => setEdit({ source: 'stockbit' })}><Plus size={14} /> Add stock</button>
            <button className="btn sm" onClick={() => pick('stockbit')}><Upload size={14} /> Import CSV</button>
            <button className="btn sm" onClick={() => downloadText('stockbit-template.csv', holdingsTemplateCSV('stockbit'))}><Download size={14} /> Template</button>
            <a className="btn sm" href="https://stockbit.com" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
          </div>
        </ConnCard>

        {/* ---------- TradingView ---------- */}
        <ConnCard id="tradingview" status={status('tradingview')} value={bySource('tradingview')} message={conn.tradingview?.message}>
          <p className="small muted" style={{ margin: '0 0 10px' }}>Live charts for every holding. Import a TradingView Portfolio export, or export all your FinPlan holdings to track them in TradingView.</p>
          <div className="row">
            <button className="btn sm primary" onClick={() => pick('tradingview')}><Upload size={14} /> Import TV portfolio</button>
            <button className="btn sm" disabled={!data.holdings.length} onClick={() => { downloadText(`finplan-to-tradingview-${today()}.csv`, toTradingViewCSV(data.holdings.filter((h) => h.source !== 'tradingview'))); toast('CSV ready. In TradingView: Portfolios → Import CSV file'); }}><Download size={14} /> Export to TV</button>
            <a className="btn sm" href="https://www.tradingview.com/portfolios/" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Portfolios</a>
          </div>
        </ConnCard>
      </div>
      {data.holdings.some((h) => h.source === 'pluang') && <PluangPanel holdings={data.holdings.filter((h) => h.source === 'pluang')} summary={conn.pluang?.summary} rate={rate} lastSync={conn.pluang?.lastSync} via={conn.pluang?.via} onChart={(sym) => { setChart(sym); document.getElementById('tv-chart')?.scrollIntoView({ behavior: 'smooth' }); }} />}
      <input ref={fileRef} type="file" accept=".json,.csv,.txt" hidden onChange={(e) => importFile(e.target.files?.[0])} />

      <Card className="mt" title="All positions" action={
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="all">All sources</option>{(Object.keys(SOURCE_LABEL) as Source[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
          <button className="btn sm" disabled={!!busy || !data.holdings.length} onClick={() => doPrices()}><RefreshCw size={14} className={busy === 'prices' ? 'spin' : ''} /> Prices</button>
          <button className="btn sm" onClick={() => setEdit({ source: 'manual' })}><Plus size={14} /> Add</button>
        </div>}>
        {rows.length ? (
          <div className="scroll-x"><table>
            <thead><tr><th>Asset</th><th className="hide-m">Source</th><th className="r">Qty</th><th className="r hide-m">Avg</th><th className="r">Price</th><th className="r">Value (IDR)</th><th className="r">P/L</th><th /></tr></thead>
            <tbody>{rows.map((h) => {
              const v = valueIDR(h, rate), c = costIDR(h, rate), pl = h.assetClass === 'cash' ? 0 : v - c;
              return (
                <tr key={h.id}>
                  <td style={{ cursor: 'pointer' }} onClick={() => setEdit(h)}><b>{h.symbol}</b><div className="small muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name !== h.symbol ? h.name : ASSUMPTIONS[h.assetClass].label.split(' (')[0]}</div></td>
                  <td className="hide-m"><span className="pill">{SOURCE_LABEL[h.source]}</span>{h.excluded && <span className="pill warn" style={{ marginLeft: 4 }}>Paper · not counted</span>}</td>
                  <td className="r">{fmtQty(h.qty)}{h.market === 'IDX' && <div className="small muted">{fmtQty(h.qty / 100)} lot</div>}</td>
                  <td className="r hide-m">{px(h.avgPrice, h.currency)}</td>
                  <td className="r">{px(h.price, h.currency)}</td>
                  <td className="r"><b>{money(v)}</b></td>
                  <td className={`r ${pl >= 0 ? 'pos' : 'neg'}`}>{h.assetClass === 'cash' ? '–' : <>{pl >= 0 ? '+' : ''}{c ? pct(pl / c) : '–'}<div className="small">{money(pl, true)}</div></>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{h.market && h.market !== 'OTHER' && h.assetClass !== 'cash' && <button className="btn ghost sm" title="Chart" onClick={() => { setChart(tvSymbol(h)); document.getElementById('tv-chart')?.scrollIntoView({ behavior: 'smooth' }); }}><ChartIcon size={15} /></button>}
                    {h.market === 'IDX' && <a className="btn ghost sm" title="Open in Stockbit" href={stockbitUrl(h.symbol)} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="empty">No positions yet. Connect Bitget or Bittime, import your Pluang snapshot, or add Stockbit stocks above.</div>}
      </Card>

      {tickerSymbols.length > 0 && (
        <Card className="mt" title="Your holdings live (TradingView)">
          <TVWidget type="ticker-tape" height={78} config={{ symbols: tickerSymbols.map((s) => ({ proName: s })), displayMode: 'adaptive', showSymbolLogo: true }} />
        </Card>
      )}
      <Card className="mt" title={<span id="tv-chart">Chart · {chart}</span>} action={
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={chart} onChange={(e) => setChart(e.target.value)}>
            {['IDX:COMPOSITE', 'IDX:LQ45', 'FX_IDC:USDIDR', 'TVC:GOLD', 'BITGET:BTCUSDT', 'SP:SPX', ...tickerSymbols].filter((v, i, a) => a.indexOf(v) === i).map((s) => <option key={s}>{s}</option>)}
          </select>
          <a className="btn sm" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(chart)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open in TradingView</a>
        </div>}>
        <TVWidget type="advanced-chart" height={480} config={{ symbol: chart, interval: 'D', timezone: 'Asia/Jakarta', style: '1', allow_symbol_change: true, hide_side_toolbar: false, autosize: true, support_host: 'https://www.tradingview.com' }} />
      </Card>

      {edit && <HoldingModal h={'id' in edit ? edit : undefined} source={edit.source} onClose={() => setEdit(null)} update={update} />}
      {keyModal && <KeyModal ex={keyModal} onClose={() => setKeyModal(null)} onSaved={() => { const ex = keyModal; setKeyModal(null); setHasKey((k) => ({ ...k, [ex]: true })); setTimeout(ex === 'bitget' ? doBitget : ex === 'bittime' ? doBittime : doAlpaca, 50); }} />}
      {scan && <SmartScan data={data} update={update} onClose={() => setScan(null)} source={scan === 'any' ? undefined : scan} />}
    </>
  );
}

function PluangPanel({ holdings, summary, rate, lastSync, via, onChart }: { holdings: Holding[]; summary?: Record<string, number>; rate: number; lastSync?: string; via?: string; onChart: (s: string) => void }) {
  const fx = summary?.usdIdr || rate;
  const v = (h: Holding) => h.qty * h.price * (h.currency === 'USD' ? fx : 1);
  const c = (h: Holding) => h.qty * h.avgPrice * (h.currency === 'USD' ? fx : 1);
  const inv = holdings.filter((h) => h.assetClass !== 'cash');
  const groups = new Map<string, { value: number; cost: number; n: number }>();
  for (const h of holdings) {
    const k = h.category || (h.assetClass === 'cash' ? 'Cash wallets' : h.market === 'US' ? 'US Stocks' : h.market === 'IDX' ? 'ID Stocks' : h.market === 'CRYPTO' ? 'Crypto' : 'Other');
    const g = groups.get(k) || { value: 0, cost: 0, n: 0 };
    g.value += v(h); g.cost += h.assetClass === 'cash' ? v(h) : c(h); g.n++; groups.set(k, g);
  }
  const total = [...groups.values()].reduce((s, g) => s + g.value, 0);
  const pnl = inv.reduce((s, h) => s + v(h) - c(h), 0), costSum = inv.reduce((s, h) => s + c(h), 0);
  const ranked = inv.filter((h) => h.avgPrice > 0).map((h) => ({ h, pct: h.price / h.avgPrice - 1, pl: v(h) - c(h) })).sort((a, b) => b.pct - a.pct);
  const colors = ['#1a73e8', '#14b8a6', '#f59e0b', '#a855f7', '#64748b'];
  return (
    <Card className="mt" title={<span>Pluang portfolio <span className="pill tip" style={{ marginLeft: 6 }}>{via === 'mcp' ? 'Live · MCP' : 'Snapshot'}</span></span>}
      action={<span className="small muted">{lastSync ? `Updated ${new Date(lastSync).toLocaleString()}` : ''} · USD/IDR {Math.round(fx).toLocaleString('id-ID')}</span>}>
      <div className="grid g4 keep">
        <div><div className="small muted">Total (incl. cash)</div><div style={{ fontSize: 22, fontWeight: 800 }}>{money(total, true)}</div></div>
        <div><div className="small muted">Unrealised P/L</div><div style={{ fontSize: 22, fontWeight: 800 }} className={pnl >= 0 ? 'pos' : 'neg'}>{money(pnl, true)}</div><div className={`small ${pnl >= 0 ? 'pos' : 'neg'}`}>{costSum ? pct(pnl / costSum) : '–'}</div></div>
        <div><div className="small muted">Pluang-reported NAV*</div><div style={{ fontSize: 22, fontWeight: 800 }}>{summary?.navIdr ? money(summary.navIdr, true) : '–'}</div></div>
        <div><div className="small muted">Positions</div><div style={{ fontSize: 22, fontWeight: 800 }}>{inv.length}</div></div>
      </div>
      <div className="bar mt" style={{ height: 12, display: 'flex' }}>
        {[...groups.entries()].map(([k, g], i) => <div key={k} title={`${k}: ${money(g.value)}`} style={{ width: `${total ? (g.value / total) * 100 : 0}%`, background: colors[i % colors.length], borderRadius: 0 }} />)}
      </div>
      <div className="row mt-s small" style={{ gap: 14 }}>
        {[...groups.entries()].map(([k, g], i) => (
          <span key={k}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: colors[i % colors.length], marginRight: 5 }} />{k} <b>{money(g.value, true)}</b> {k !== 'Cash wallets' && g.cost ? <span className={g.value >= g.cost ? 'pos' : 'neg'}>({pct(g.value / g.cost - 1, 0)})</span> : null}</span>
        ))}
      </div>
      {ranked.length > 1 && (
        <div className="grid g2 mt">
          {[{ t: 'Best performers', list: ranked.slice(0, 4) }, { t: 'Worst performers', list: [...ranked].reverse().slice(0, 4) }].map((col) => (
            <div key={col.t}><h3>{col.t}</h3>
              {col.list.map(({ h, pct: p, pl }) => (
                <div key={h.id} className="kv" style={{ cursor: h.market !== 'OTHER' ? 'pointer' : undefined }} onClick={() => h.market !== 'OTHER' && onChart(tvSymbol(h))}>
                  <span><b>{h.symbol}</b> <span className="muted small">{h.name !== h.symbol ? h.name : ''}</span></span>
                  <b className={p >= 0 ? 'pos' : 'neg'}>{p >= 0 ? '+' : ''}{pct(p)} · {money(pl, true)}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="small muted mt-s">*Pluang's NAV covers crypto, US and ID stocks only. Gold, funds, options, leveraged/CFD and cash wallets are excluded by Pluang, so it is not your Pluang net worth.</div>
    </Card>
  );
}

function ConnCard({ id, status, value, message, children }: { id: Exclude<Source, 'manual'>; status: JSX.Element; value: number; message?: string; children: React.ReactNode }) {
  const b = BRAND[id];
  return (
    <section className="card">
      <div className="row between" style={{ marginBottom: 10, flexWrap: 'nowrap' }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: b.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: b.letter.length > 1 ? 13 : 18 }}>{b.letter}</div>
          <div><div style={{ fontWeight: 700 }}>{SOURCE_LABEL[id]}</div><div className="small muted">{b.how}</div></div>
        </div>
        <div style={{ textAlign: 'right' }}>{status}{value > 0 && <div className="small" style={{ marginTop: 4 }}><b>{money(value, true)}</b></div>}</div>
      </div>
      {children}
      {message && <div className="small muted mt-s">{message}</div>}
    </section>
  );
}

type KeyExchange = 'bitget' | 'bittime' | 'alpaca';
const KEY_GUIDE: Record<KeyExchange, { title: string; steps: JSX.Element[]; link: string; passphrase: boolean; paper?: boolean; name: string; keyLabel?: string }> = {
  bitget: {
    title: 'Connect Bitget (read-only)', name: 'Bitget', passphrase: true, link: 'https://www.bitget.com/account/newapi',
    steps: [<>Bitget → Profile → <b>API Management</b> → Create API → <b>System-generated</b>.</>,
      <>Permissions: tick <b>Read-only</b> only. Do <b>not</b> enable Trade or Withdraw.</>,
      <>Set your own passphrase, then copy the API key, secret and passphrase here.</>],
  },
  bittime: {
    title: 'Connect Bittime', name: 'Bittime', passphrase: false, link: 'https://www.bittime.com',
    steps: [<>Bittime web → Account → <b>API Management</b> → Create API key.</>,
      <>Leave <b>Trade and Withdraw switched off</b>. Bittime has no separate read-only type, so FinPlan only calls the balance endpoint.</>,
      <>Restrict the key to your IP address if offered, then paste the API key and secret key here.</>],
  },
  alpaca: {
    title: 'Connect Alpaca Markets', name: 'Alpaca', passphrase: false, paper: true, keyLabel: 'API Key ID', link: 'https://app.alpaca.markets/',
    steps: [<>Log in to <b>app.alpaca.markets</b> and choose your <b>Live</b> or <b>Paper</b> account (top-left switcher).</>,
      <>On the Home page, find <b>API Keys</b> → <b>Generate New Keys</b>. The secret is shown only once.</>,
      <>Paste the Key ID and Secret Key, and pick the same account type below. Live and paper keys are different.</>],
  },
};

function KeyModal({ ex, onClose, onSaved }: { ex: KeyExchange; onClose: () => void; onSaved: () => void }) {
  const g = KEY_GUIDE[ex];
  const [c, setC] = useState({ apiKey: '', secret: '', passphrase: '', paper: false });
  useEffect(() => { getJSONSecret<typeof c>(ex).then((x) => x && setC({ apiKey: x.apiKey || '', secret: x.secret || '', passphrase: x.passphrase || '', paper: !!x.paper })); }, [ex]);
  const ok = c.apiKey && c.secret && (!g.passphrase || c.passphrase);
  return (
    <Modal title={g.title} onClose={onClose}>
      <ol className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>{g.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
      <div className="form">
        {g.paper && <div className="full"><Seg value={c.paper ? 'paper' : 'live'} onChange={(v) => setC({ ...c, paper: v === 'paper' })} options={[{ v: 'live', l: 'Live account' }, { v: 'paper', l: 'Paper (practice)' }]} /></div>}
        <Field label={g.keyLabel || 'API key'} full><input className="input" autoComplete="off" value={c.apiKey} onChange={(e) => setC({ ...c, apiKey: e.target.value.trim() })} /></Field>
        <Field label="Secret key" full><input className="input" type="password" autoComplete="off" value={c.secret} onChange={(e) => setC({ ...c, secret: e.target.value.trim() })} /></Field>
        {g.passphrase && <Field label="Passphrase" full><input className="input" type="password" autoComplete="off" value={c.passphrase} onChange={(e) => setC({ ...c, passphrase: e.target.value })} /></Field>}
      </div>
      <div className="small muted mt-s"><ShieldCheck size={13} style={{ verticalAlign: -2 }} /> {platform() === 'desktop' ? 'Stored encrypted with your OS keychain.' : 'Stored only on this device.'} Never included in backups or sent through a proxy.</div>
      <div className="row between mt"><a className="small" href={g.link} target="_blank" rel="noreferrer">Open {g.name} ↗</a>
        <button className="btn primary" disabled={!ok} onClick={async () => {
          try { await setSecret(ex, JSON.stringify(g.passphrase ? { apiKey: c.apiKey, secret: c.secret, passphrase: c.passphrase } : g.paper ? { apiKey: c.apiKey, secret: c.secret, paper: c.paper } : { apiKey: c.apiKey, secret: c.secret })); onSaved(); } catch (e: any) { toast(e.message); }
        }}>Save & sync</button></div>
    </Modal>
  );
}

const CLASSES: AssetClass[] = ['stock', 'crypto', 'mutualfund', 'bond', 'gold', 'cash', 'deposit', 'property'];

function HoldingModal({ h, source, onClose, update }: { h?: Holding; source: Source; onClose: () => void; update: ViewProps['update'] }) {
  const isIdx = (x: Partial<Holding>) => x.currency === 'IDR' && x.assetClass === 'stock';
  const [x, setX] = useState<Holding>(h ?? {
    id: uid(), source, symbol: '', name: '', qty: 0, avgPrice: 0, price: 0,
    assetClass: source === 'bitget' ? 'crypto' : 'stock', currency: source === 'stockbit' ? 'IDR' : 'USD',
    market: source === 'stockbit' ? 'IDX' : undefined,
  });
  const [lots, setLots] = useState(isIdx(x));
  const set = (p: Partial<Holding>) => setX((y) => ({ ...y, ...p }));
  const save = () => {
    const y: Holding = { ...x, opened: normYear(x.opened), symbol: x.symbol.toUpperCase().trim(), name: x.name || x.symbol.toUpperCase(), price: x.price || x.avgPrice, market: x.assetClass === 'crypto' ? 'CRYPTO' : x.currency === 'IDR' && x.assetClass === 'stock' ? 'IDX' : x.currency === 'USD' && x.assetClass === 'stock' ? 'US' : x.market };
    update((d: AppData) => syncAccounts({ ...d, holdings: h ? d.holdings.map((z) => (z.id === y.id ? y : z)) : [...d.holdings, y] }));
    onClose();
  };
  return (
    <Modal title={`${h ? 'Edit' : 'Add'} position · ${SOURCE_LABEL[x.source]}`} onClose={onClose}>
      <div className="form">
        <Field label="Symbol / ticker"><input className="input" autoFocus value={x.symbol} placeholder={x.currency === 'IDR' ? 'BBCA' : 'AAPL / BTC'} onChange={(e) => set({ symbol: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name (optional)"><input className="input" value={x.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Asset class"><select className="input" value={x.assetClass} onChange={(e) => set({ assetClass: e.target.value as AssetClass })}>
          {CLASSES.map((c) => <option key={c} value={c}>{ASSUMPTIONS[c].label}</option>)}</select></Field>
        <Field label="Currency"><select className="input" value={x.currency} onChange={(e) => set({ currency: e.target.value as 'IDR' | 'USD' })}><option>IDR</option><option>USD</option></select></Field>
        <Field label={lots ? 'Lots (1 lot = 100 shares)' : 'Quantity (units)'}>
          <input className="input" type="number" step="any" value={x.qty ? (lots ? x.qty / 100 : x.qty) : ''} onChange={(e) => set({ qty: Number(e.target.value) * (lots ? 100 : 1) })} />
          {isIdx(x) && <label className="small"><input type="checkbox" checked={lots} onChange={(e) => setLots(e.target.checked)} /> enter in lots</label>}
        </Field>
        <Field label={`Average buy price (${x.currency})`}>{x.currency === 'IDR' ? <MoneyInput value={x.avgPrice} onChange={(avgPrice) => set({ avgPrice })} /> : <input className="input" type="number" step="any" value={x.avgPrice || ''} onChange={(e) => set({ avgPrice: Number(e.target.value) })} />}</Field>
        <Field label="Year first bought"><input className="input" inputMode="numeric" maxLength={4} placeholder="e.g. 2021" value={x.opened ?? ''} onChange={(e) => set({ opened: e.target.value.replace(/\D/g, '').slice(0, 4) || undefined })} /></Field>
        <Field label={`Last price (${x.currency}) — auto-updated`} full>{x.currency === 'IDR' ? <MoneyInput value={x.price} onChange={(price) => set({ price })} /> : <input className="input" type="number" step="any" value={x.price || ''} onChange={(e) => set({ price: Number(e.target.value) })} />}</Field>
      </div>
      <div className="row between mt">
        {h ? <button className="btn danger" onClick={() => { update((d) => syncAccounts({ ...d, holdings: d.holdings.filter((z) => z.id !== h.id) })); onClose(); }}><Trash2 size={16} /> Delete</button> : <span />}
        <button className="btn primary" disabled={!x.symbol || !x.qty} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
