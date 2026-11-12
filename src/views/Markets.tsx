import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, RefreshCw, ExternalLink, Check, X, Search, Settings2 } from 'lucide-react';
import type { ViewProps } from '../App';
import type { MarketDashboard, Widget } from '../lib/types';
import { alpacaCan, clearMarketCache, connectorAvailable, getRatio, getSeries, isIdx, pluangAvailable, pluangCan, RANGES, USE_TV, type DataSource, type RangeKey, type Series } from '../lib/market';
import { ALGOBARS_URL, ASIA_MSCI, CATALOG, findInstrument, GROUPS, idxCode, investingChartUrl, stockbitUrl } from '../lib/marketCatalog';
import { uid } from '../lib/store';
import { platform } from '../lib/net';
import { Field, Modal, Seg, toast } from '../components/ui';
import PriceChart from '../components/PriceChart';
import TVWidget from '../components/TVWidget';

const W = (type: Widget['type'], title: string, symbols: string[], range: RangeKey = '1D', size: Widget['size'] = 's', chart: Widget['chart'] = 'area'): Widget => ({ id: uid(), type, title, symbols, range, chart, size });

export const MARKETS_LAYOUT = 2;
const COMMODITIES: [string, string][] = [['Gold', 'GC=F'], ['Silver', 'SI=F'], ['Crude oil WTI', 'CL=F'], ['Brent crude', 'BZ=F'], ['Copper', 'HG=F'], ['Natural gas', 'NG=F'], ['Platinum', 'PL=F'], ['Wheat', 'ZW=F'], ['Coffee', 'KC=F']];
const commoditiesDash = (): MarketDashboard => ({ id: 'commodities', name: 'Global commodities', refreshSec: 60, widgets: COMMODITIES.map(([t, sym]) => W('quote', t, [sym], '1M', 'm')) });
const asiaDash = (): MarketDashboard => ({ id: 'asia', name: 'Asia Pacific vs MSCI', refreshSec: 60, widgets: [
  W('list', 'Asia Pacific indices', ASIA_MSCI.map(([, idx]) => idx), '1D', 'm'),
  W('list', 'MSCI equivalents (iShares, USD)', ASIA_MSCI.map(([, , etf]) => etf), '1D', 'm'),
  ...ASIA_MSCI.map(([country, idx, etf]) => W('compare', `${country}: ${findInstrument(idx).name.replace(/ \(.*\)$/, '')} vs ${etf}`, [idx, etf], '1Y', 'm', 'line')),
] });
export function defaultDashboards(): MarketDashboard[] {
  return [{
    id: 'main', name: 'Markets', refreshSec: 60, widgets: [
      W('quote', 'USD/IDR', ['USDIDR=X']), W('quote', 'SGD/IDR', ['SGDIDR=X']), W('quote', 'COMPOSITE IDX', ['^JKSE']), W('quote', 'EIDO', ['EIDO']), W('quote', 'QQQ', ['QQQ']),
      W('quote', 'S&P 500 (SPY)', ['SPY']), W('quote', 'SCHD', ['SCHD']), W('quote', 'BTC/USD', ['BTC-USD']), W('quote', 'ETH/USD', ['ETH-USD']),
      W('quote', 'RSP (Equal-weight S&P)', ['RSP'], '1M', 'm'), W('ratio', 'RSP / SPY (breadth)', ['RSP', 'SPY'], '1Y', 'm', 'line'),
      W('list', 'Indonesia blue chips', ['BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'BBNI.JK', 'TLKM.JK', 'ASII.JK', 'GOTO.JK', 'ADRO.JK', 'ANTM.JK', 'AMMN.JK'], '1D', 'm'),
    ],
  }, commoditiesDash(), asiaDash()];
}
/** Bring saved dashboards up to the current sample layout: IHSG → COMPOSITE IDX + EIDO; commodities and Asia Pacific get their own tabs. */
export function upgradeDashboards(ds: MarketDashboard[]): MarketDashboard[] {
  let out = ds.map((d) => {
    const widgets: Widget[] = [];
    for (const w of d.widgets) {
      if (w.type === 'quote' && w.symbols[0] === '^JKSE' && /^(IHSG|JCI|IHSG \(JCI\))$/i.test(w.title.trim())) {
        widgets.push({ ...w, title: 'COMPOSITE IDX' });
        if (!d.widgets.some((x) => x.type === 'quote' && x.symbols[0] === 'EIDO')) widgets.push({ ...W('quote', 'EIDO', ['EIDO'], w.range, w.size, w.chart) });
        continue;
      }
      if (d.id === 'main' && w.type === 'list' && /^(Global commodities|Asia Pacific indices)$/.test(w.title)) continue; // moved to their own tabs
      widgets.push(w);
    }
    return { ...d, widgets };
  });
  if (!out.some((d) => d.id === 'commodities')) out = [...out, commoditiesDash()];
  if (!out.some((d) => d.id === 'asia')) out = [...out, asiaDash()];
  return out;
}

const tvOf = (w: Widget) => w.type === 'ratio' ? `${findInstrument(w.symbols[0]).tv || w.symbols[0]}/${findInstrument(w.symbols[1]).tv || w.symbols[1]}` : findInstrument(w.symbols[0]).tv || w.symbols[0];
function fmtPrice(n: number, sym: string) {
  const inst = findInstrument(sym);
  const d = inst.decimals ?? (n >= 1000 ? 2 : n >= 1 ? 2 : 4);
  return n.toLocaleString('en-US', { minimumFractionDigits: sym.includes('/') ? 4 : Math.min(d, 2), maximumFractionDigits: sym.includes('/') ? 4 : d });
}
function fmtChange(ch: number, price: number, sym: string) {
  const d = sym.includes('/') && Math.abs(price) < 10 ? 4 : Math.abs(price) >= 1000 ? 0 : Math.abs(price) >= 1 ? 2 : 4;
  const dd = findInstrument(sym).decimals === 0 ? 0 : d;
  return `${ch >= 0 ? '+' : ''}${ch.toLocaleString('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd })}`;
}
const pctTxt = (p: number | null) => (p == null ? '–' : `${p >= 0 ? '+' : ''}${(p * 100).toFixed(2)}%`);
const dir = (p: number | null) => (p == null || Math.abs(p) < 1e-9 ? 'flat' : p > 0 ? 'up' : 'down');
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : new Date(t).toLocaleString(); };

/** Load one widget's data; refresh on a timer. */
function useSeries(w: Widget, tick: number) {
  const [data, setData] = useState<Record<string, Series>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const force = tick > 0;
    const src = (w.source || 'auto') as DataSource;
    const jobs = w.view && w.view !== 'native' && w.type === 'quote' ? [] // third-party embed draws itself
      : w.type === 'ratio' ? [{ key: w.symbols.join('/'), p: getRatio(w.symbols[0], w.symbols[1], w.range, force, src) }]
      : w.symbols.map((s) => ({ key: s, p: getSeries(s, w.range, force, src) }));
    for (const j of jobs) j.p.then((d) => { if (alive) { setData((x) => ({ ...x, [j.key]: d })); setErr((x) => { const y = { ...x }; delete y[j.key]; return y; }); } })
      .catch((e) => alive && setErr((x) => ({ ...x, [j.key]: String(e?.message || e) })));
    return () => { alive = false; };
  }, [w.type, w.range, w.symbols.join(','), w.source, w.view, tick]);
  return { data, err };
}

function errText(e: string, sym: string) {
  if (e === USE_TV) return 'TradingView';
  if (e === 'in-app-only') return 'Live in the FinPlan app';
  if (e === 'no-connector') return 'Data loads in the app';
  if (/not available on Pluang/.test(e)) return `${sym} isn't on Pluang. Live in the app`;
  return platform() === 'web' && /CORS|Failed to fetch|HTTP/i.test(e) ? 'Market feed unreachable (privacy mode or network)' : e.slice(0, 80);
}

const invPairOf = (w: Widget) => w.invPair || findInstrument(w.symbols[0]).inv;

export function InvestingChart({ pair, height }: { pair?: number; height: number }) {
  if (!pair) return <div className="small muted" style={{ height, display: 'grid', placeItems: 'center', textAlign: 'center' }}>Set the Investing.com pair ID in the widget settings<br />(Investing.com → Webmaster Tools → Technical Charts).</div>;
  return (
    <div>
      <iframe title="Investing.com chart" src={investingChartUrl(pair)} style={{ width: '100%', height, border: 0, borderRadius: 8 }} loading="lazy"
        referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
      <div className="small muted" style={{ fontSize: 11 }}>Chart by <a href="https://www.investing.com" target="_blank" rel="noreferrer">Investing.com</a></div>
    </div>
  );
}

const tvRange = (r: RangeKey) => ({ '1D': '1D', '5D': '5D', '1M': '1M', '3M': '3M', '6M': '6M', YTD: 'YTD', '1Y': '12M', '5Y': '60M' } as const)[r];
const IN_CLAUDE = () => !!(window as any).claude;

/** TradingView live chart used when Pluang doesn't cover a symbol (inside Claude TradingView can't load, so link out). */
function TvFallback({ w, height }: { w: Widget; height: number }) {
  const sym = tvOf(w);
  if (IN_CLAUDE()) return <div className="small muted" style={{ padding: '14px 0' }}>Not on Pluang. The TradingView chart loads in the FinPlan app.<div><a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open {sym} on TradingView ↗</a></div></div>;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      {w.type === 'ratio'
        ? <TVWidget type="advanced-chart" height={height + 70} config={{ symbol: sym, interval: 'D', range: tvRange(w.range), style: '2', hide_top_toolbar: true, hide_legend: false, allow_symbol_change: false, autosize: true, support_host: 'https://www.tradingview.com' }} />
        : <TVWidget type="mini-symbol-overview" height={height + 90} config={{ symbol: sym, width: '100%', height: '100%', dateRange: tvRange(w.range), chartOnly: false, trendLineColor: 'rgba(15,118,110,1)' }} />}
      <div className="small muted" style={{ fontSize: 11 }}>TradingView · live widget</div>
    </div>
  );
}

function QuoteTile({ w, tick, onOpen, editTools }: { w: Widget; tick: number; onOpen: () => void; editTools: JSX.Element | null }) {
  const { data, err } = useSeries(w, tick);
  const key = w.type === 'ratio' ? w.symbols.join('/') : w.symbols[0];
  const s = data[key], e = err[key];
  const inst = findInstrument(w.symbols[0]);
  const chg = w.range === '1D' ? s?.changePct ?? s?.rangeChangePct ?? null : s?.rangeChangePct ?? null;
  const h = w.size === 's' ? 70 : w.size === 'm' ? 110 : 150;
  return (
    <div className={`tile mk-${w.size}`} onClick={onOpen}>
      {editTools}
      <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}><div className="tname">{w.title}</div><div className="tsym">{w.type === 'ratio' ? `${w.symbols[0]} ÷ ${w.symbols[1]}` : inst.name !== w.title ? inst.name : w.symbols[0]}</div></div>
        <span className="pill" style={{ fontSize: 11 }}>{w.range}</span>
      </div>
      {w.view === 'investing' && w.type === 'quote' ? <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}><InvestingChart pair={invPairOf(w)} height={h + 120} /></div>
      : w.view === 'tradingview' && w.type === 'quote' ? <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}><TVWidget type="mini-symbol-overview" height={h + 120} config={{ symbol: tvOf(w), width: '100%', height: '100%', dateRange: w.range === '1D' ? '1D' : w.range === '5D' ? '5D' : w.range === '1M' ? '1M' : w.range === '3M' ? '3M' : w.range === '6M' ? '6M' : w.range === 'YTD' ? 'YTD' : w.range === '1Y' ? '12M' : '60M', chartOnly: false }} /></div>
      : e === USE_TV && !s ? <div style={{ marginTop: 8 }}><TvFallback w={w} height={h} /></div>
      : s ? (<>
        <div className="tprice">{fmtPrice(s.price, key)}{s.currency && s.currency !== 'USD' && w.type !== 'ratio' && !key.includes('IDR') && !key.startsWith('^') ? <span className="small muted"> {s.currency}</span> : null}</div>
        <div className={`chg ${dir(chg)}`}>{chg != null && (chg >= 0 ? '▲ ' : '▼ ')}{w.range === '1D' && s.change != null ? `${fmtChange(s.change, s.price, key)} ` : ''}({pctTxt(chg)}){w.range !== '1D' && <span className="muted" style={{ fontWeight: 500 }}> {w.range}</span>}</div>
        <div style={{ marginTop: 6 }}><PriceChart points={s.points} kind={w.chart} height={h} up={(chg ?? 0) >= 0} prevClose={w.range === '1D' ? s.prevClose : null} /></div>
        <div className="small muted" style={{ marginTop: 4, fontSize: 11 }}>{s.source === 'computed' ? 'Calculated' : s.source} · {ago(s.updatedAt)}{s.note ? ` · ${s.note}` : ''}</div>
      </>) : e ? <div className="small muted" style={{ padding: '18px 0' }}>{errText(e, key)}<div><a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvOf(w))}`} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>Open on TradingView ↗</a></div></div>
        : <div className="small muted" style={{ padding: '24px 0' }}>Loading…</div>}
    </div>
  );
}

/** Two instruments rebased to 0% at the start of the range (e.g. an index and its MSCI ETF). */
function CompareTile({ w, tick, onOpenSym, editTools }: { w: Widget; tick: number; onOpenSym: (sym: string) => void; editTools: JSX.Element | null }) {
  const { data, err } = useSeries(w, tick);
  const [a, b] = w.symbols; const A = data[a], B = data[b];
  const colors = ['#0f766e', '#d97706'];
  const tvFallback = (err[a] === USE_TV || err[b] === USE_TV) && !(A && B);
  const geo = useMemo(() => {
    if (!A || !B || A.points.length < 2 || B.points.length < 2) return null;
    const rb = (pts: { t: number; c: number }[]) => pts.map((p) => ({ t: p.t, v: p.c / pts[0].c - 1 }));
    const sa = rb(A.points), sb = rb(B.points);
    const t0 = Math.min(sa[0].t, sb[0].t), t1 = Math.max(sa[sa.length - 1].t, sb[sb.length - 1].t) || t0 + 1;
    const all = [...sa, ...sb].map((p) => p.v); const lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 0.01;
    const X = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 600, Y = (v: number) => 6 + (1 - (v - lo) / span) * 98;
    const path = (s: { t: number; v: number }[]) => s.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    return { pa: path(sa), pb: path(sb), y0: Y(0), ra: sa[sa.length - 1].v, rbv: sb[sb.length - 1].v };
  }, [A, B]);
  const tvSym = (s: string) => findInstrument(s).tv || s;
  return (
    <div className={`tile mk-${w.size}`} style={{ cursor: 'default' }}>
      {editTools}
      <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}><div className="tname">{w.title}</div><div className="tsym">{findInstrument(a).name} vs {findInstrument(b).name}</div></div>
        <span className="pill" style={{ fontSize: 11 }}>{w.range}</span>
      </div>
      {geo ? (<>
        <div className="row" style={{ gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
          {[[a, geo.ra, A!], [b, geo.rbv, B!]].map(([sym, r, S], i) => (
            <button key={String(sym)} className="btn ghost sm" style={{ padding: '2px 4px' }} onClick={() => onOpenSym(String(sym))}>
              <span style={{ display: 'inline-block', width: 10, height: 3, background: colors[i], borderRadius: 2, marginRight: 6, verticalAlign: 3 }} />
              <b>{String(sym).replace(/^\^/, '')}</b>&nbsp;<span className={`chg ${dir(r as number)}`} style={{ fontSize: 13 }}>{pctTxt(r as number)}</span>
              <span className="small muted">&nbsp;{fmtPrice((S as Series).price, String(sym))}</span>
            </button>))}
        </div>
        <svg viewBox="0 0 600 110" preserveAspectRatio="none" width="100%" height={110} style={{ display: 'block', marginTop: 4 }}>
          <line x1="0" x2="600" y1={geo.y0} y2={geo.y0} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6" />
          <path d={geo.pa} fill="none" stroke={colors[0]} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={geo.pb} fill="none" stroke={colors[1]} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="small muted" style={{ fontSize: 11, marginTop: 4 }}>Gap {pctTxt(geo.ra - geo.rbv)} over {w.range} · index in local currency, ETF in USD (the gap includes the currency move)</div>
      </>) : tvFallback ? (IN_CLAUDE()
        ? <div className="small muted" style={{ padding: '14px 0' }}>The comparison chart loads in the FinPlan app. <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym(a))}`} target="_blank" rel="noreferrer">{tvSym(a)}</a> · <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym(b))}`} target="_blank" rel="noreferrer">{tvSym(b)}</a> on TradingView ↗</div>
        : <div style={{ marginTop: 8 }}><TVWidget type="advanced-chart" height={300} config={{ symbol: tvSym(a), compareSymbols: [{ symbol: tvSym(b), position: 'SameScale' }], interval: 'D', range: tvRange(w.range), style: '2', hide_top_toolbar: true, hide_legend: false, allow_symbol_change: false, hide_volume: true, autosize: true, support_host: 'https://www.tradingview.com' }} />
            <div className="small muted" style={{ fontSize: 11 }}>TradingView · % change, same scale</div></div>)
      : (err[a] || err[b]) ? <div className="small muted" style={{ padding: '18px 0' }}>{errText(err[a] || err[b], a)}</div>
      : <div className="small muted" style={{ padding: '24px 0' }}>Loading…</div>}
    </div>
  );
}

function ListTile({ w, tick, onOpenSym, editTools }: { w: Widget; tick: number; onOpenSym: (sym: string) => void; editTools: JSX.Element | null }) {
  const { data, err } = useSeries(w, tick);
  return (
    <div className={`tile mk-${w.size}`} style={{ cursor: 'default' }}>
      {editTools}
      <div className="row between" style={{ marginBottom: 6 }}><div className="tname">{w.title}</div><span className="pill" style={{ fontSize: 11 }}>{w.range}</span></div>
      {w.symbols.filter((sym) => err[sym] !== USE_TV).map((sym) => {
        const s = data[sym], e = err[sym], inst = findInstrument(sym);
        const chg = w.range === '1D' ? s?.changePct ?? s?.rangeChangePct ?? null : s?.rangeChangePct ?? null;
        return (
          <div key={sym} className="wl-row" onClick={() => onOpenSym(sym)}>
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</div><div className="small muted" style={{ fontSize: 11 }}>{isIdx(sym) ? <>IDX · <a href={stockbitUrl(sym)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>Stockbit ↗</a></> : sym}</div></div>
            <div className="wl-spark">{s ? <PriceChart points={s.points} kind="line" height={30} up={(chg ?? 0) >= 0} /> : null}</div>
            <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s ? fmtPrice(s.price, sym) : <span className="small muted" style={{ fontWeight: 400 }}>{e ? errText(e, sym) : '…'}</span>}</div>
            <span className={`chg-pill ${dir(chg)}`}>{s ? pctTxt(chg) : '–'}</span>
          </div>
        );
      })}
      {(() => {
        const tv = w.symbols.filter((sym) => err[sym] === USE_TV);
        if (!tv.length) return null;
        if (IN_CLAUDE()) return <div className="small muted" style={{ paddingTop: 8 }}>Not on Pluang (TradingView loads in the app): {tv.map((sym, i) => <span key={sym}>{i ? ' · ' : ''}<a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(findInstrument(sym).tv || sym)}`} target="_blank" rel="noreferrer">{findInstrument(sym).name}</a></span>)}</div>;
        return <div style={{ marginTop: 6 }}><TVWidget type="market-quotes" height={Math.min(560, 70 + tv.length * 52)} config={{ width: '100%', height: '100%', showSymbolLogo: true,
          symbolsGroups: [{ name: w.title, symbols: tv.map((sym) => ({ name: findInstrument(sym).tv || sym, displayName: findInstrument(sym).name })) }] }} />
          <div className="small muted" style={{ fontSize: 11 }}>{tv.length < w.symbols.length ? 'Rows above: Pluang · below: ' : ''}TradingView live widget</div></div>;
      })()}
    </div>
  );
}

export default function Markets({ data, update }: ViewProps) {
  const dashboards = data.settings.dashboards?.length ? data.settings.dashboards : defaultDashboards();
  const active = dashboards.find((d) => d.id === data.settings.activeDashboard) || dashboards[0];
  const [edit, setEdit] = useState(false);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<Widget | 'new' | null>(null);
  const [detail, setDetail] = useState<Widget | null>(null);
  const [inClaude, setInClaude] = useState<boolean | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [hasPluang, setHasPluang] = useState(false);
  useEffect(() => { connectorAvailable().then((m) => setInClaude(!!m)); pluangAvailable().then(setHasPluang); }, []);

  useEffect(() => { // one-time upgrade of saved dashboards to the current sample layout
    if (!data.settings.dashboards?.length || (data.settings.marketsLayout ?? 1) >= MARKETS_LAYOUT) return;
    update((d) => ({ ...d, settings: { ...d.settings, dashboards: upgradeDashboards(d.settings.dashboards || []), marketsLayout: MARKETS_LAYOUT } }));
  }, [data.settings.marketsLayout]);
  const save = useCallback((ds: MarketDashboard[], activeId = active.id) => update((d) => ({ ...d, settings: { ...d.settings, dashboards: ds, activeDashboard: activeId } })), [update, active.id]);
  const saveActive = (fn: (d: MarketDashboard) => MarketDashboard) => save(dashboards.map((d) => (d.id === active.id ? fn(d) : d)));

  // Auto refresh (only while visible)
  const tickRef = useRef(0);
  useEffect(() => {
    if (!active.refreshSec) return;
    const t = setInterval(() => { if (!document.hidden) { tickRef.current++; setTick(tickRef.current); setLastRefresh(Date.now()); } }, active.refreshSec * 1000);
    return () => clearInterval(t);
  }, [active.refreshSec, active.id]);
  const refresh = () => { clearMarketCache(); tickRef.current++; setTick(tickRef.current); setLastRefresh(Date.now()); };

  const move = (i: number, d: number) => saveActive((x) => { const w = [...x.widgets]; const j = i + d; if (j < 0 || j >= w.length) return x; [w[i], w[j]] = [w[j], w[i]]; return { ...x, widgets: w }; });
  const tools = (w: Widget, i: number) => edit ? (
    <div className="tile-tools" onClick={(e) => e.stopPropagation()}>
      <button className="btn ghost sm" title="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
      <button className="btn ghost sm" title="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
      <button className="btn ghost sm" title="Edit" onClick={() => setEditing(w)}><Pencil size={14} /></button>
      <button className="btn ghost sm" title="Remove" onClick={() => saveActive((x) => ({ ...x, widgets: x.widgets.filter((y) => y.id !== w.id) }))}><Trash2 size={14} color="var(--bad)" /></button>
    </div>) : null;

  return (
    <>
      <div className="page-head">
        <div><h1>Markets</h1><div className="sub">Your custom dashboards · refreshes every {active.refreshSec ? `${active.refreshSec}s` : 'manual'} · updated {new Date(lastRefresh).toLocaleTimeString()}</div></div>
        <div className="row">
          <button className="btn" onClick={refresh}><RefreshCw size={16} /> Refresh</button>
          <button className={`btn ${edit ? 'primary' : ''}`} onClick={() => setEdit(!edit)}>{edit ? <><Check size={16} /> Done</> : <><Settings2 size={16} /> Customize</>}</button>
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="dash-tabs">
          {dashboards.map((d) => <button key={d.id} className={`btn sm ${d.id === active.id ? 'primary' : ''}`} onClick={() => save(dashboards, d.id)}>{d.name}</button>)}
          <button className="btn sm" onClick={() => { const d: MarketDashboard = { id: uid(), name: `Dashboard ${dashboards.length + 1}`, refreshSec: 60, widgets: [] }; save([...dashboards, d], d.id); setEdit(true); }}><Plus size={14} /> New</button>
        </div>
        {edit && (
          <div className="row">
            <input className="input" style={{ width: 170 }} value={active.name} onChange={(e) => saveActive((x) => ({ ...x, name: e.target.value }))} aria-label="Dashboard name" />
            <select className="input" style={{ width: 'auto' }} value={active.refreshSec} onChange={(e) => saveActive((x) => ({ ...x, refreshSec: Number(e.target.value) }))}>
              {[[15, 'Every 15s'], [30, 'Every 30s'], [60, 'Every 1 min'], [300, 'Every 5 min'], [0, 'Manual']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn sm" onClick={() => { { const def = defaultDashboards(); const pick = def.find((d) => d.id === active.id) || def[0]; save(dashboards.map((d) => (d.id === active.id ? { ...pick, id: active.id, name: active.name } : d)), active.id); } toast('Sample layout restored'); }}>Reset to sample</button>
            {dashboards.length > 1 && <button className="btn sm danger" onClick={() => { const rest = dashboards.filter((d) => d.id !== active.id); save(rest, rest[0].id); }}><Trash2 size={14} /> Delete dashboard</button>}
          </div>
        )}
      </div>

      {!hasPluang && !inClaude && (
        <div className="banner small" style={{ background: 'var(--tip-soft)' }}>
          <div className="grow">Charts use <b>Pluang first, then TradingView</b>. Sign in with Pluang (Connections → Pluang, desktop app) to chart IDX/US stocks and crypto from Pluang data; until then TradingView live charts are shown.</div>
        </div>
      )}
      {inClaude && (
        <div className="banner small" style={{ background: 'var(--tip-soft)' }}>
          <div className="grow">Charts use <b>Pluang first</b> (Indonesian stocks, US stocks/ETFs, crypto, USD/IDR via USDT), <b>then TradingView</b>. Inside Claude, TradingView charts can't load, so those tiles link to TradingView. They show live in the FinPlan app.</div>
        </div>
      )}

      <div className="mk-grid">
        {active.widgets.map((w, i) => w.type === 'compare'
          ? <CompareTile key={w.id} w={w} tick={tick} editTools={tools(w, i)} onOpenSym={(sym) => setDetail({ ...W('quote', findInstrument(sym).name, [sym], '1M', 'l'), id: 'tmp' })} />
          : w.type === 'list'
          ? <ListTile key={w.id} w={w} tick={tick} editTools={tools(w, i)} onOpenSym={(sym) => setDetail({ ...W('quote', findInstrument(sym).name, [sym], '1M', 'l'), id: 'tmp' })} />
          : <QuoteTile key={w.id} w={w} tick={tick} editTools={tools(w, i)} onOpen={() => !edit && setDetail(w)} />)}
        {edit && <button className="tile mk-s" style={{ borderStyle: 'dashed', display: 'grid', placeItems: 'center', minHeight: 140, color: 'var(--brand)', fontWeight: 700 }} onClick={() => setEditing('new')}><span><Plus size={20} style={{ verticalAlign: -4 }} /> Add widget</span></button>}
      </div>
      {!active.widgets.length && !edit && <div className="empty">This dashboard is empty. Tap <b>Customize → Add widget</b>.</div>}
      <p className="small muted mt">Quotes may be delayed (exchange rules, typically up to 15 min for indices). For trading, use your broker's live price.</p>

      {editing && <WidgetEditor w={editing === 'new' ? undefined : editing} inClaude={!!inClaude} onClose={() => setEditing(null)}
        onSave={(w) => { saveActive((x) => ({ ...x, widgets: x.widgets.some((y) => y.id === w.id) ? x.widgets.map((y) => (y.id === w.id ? w : y)) : [...x.widgets, w] })); setEditing(null); }} />}
      {detail && <DetailModal w={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function DetailModal({ w, onClose }: { w: Widget; onClose: () => void }) {
  const [range, setRange] = useState<RangeKey>(w.range === '1D' && w.type === 'quote' ? '1D' : w.range);
  const [kind, setKind] = useState<Widget['chart']>(w.chart);
  const [provider, setProvider] = useState<'native' | 'tradingview' | 'investing'>(w.view && w.view !== 'native' ? w.view : 'native');
  const [src, setSrc] = useState<DataSource>((w.source as DataSource) || 'auto');
  const [s, setS] = useState<Series | null>(null); const [e, setE] = useState('');
  const [y1, setY1] = useState<Series | null>(null);
  useEffect(() => {
    setS(null); setE('');
    const p = w.type === 'ratio' ? getRatio(w.symbols[0], w.symbols[1], range, false, src) : getSeries(w.symbols[0], range, false, src);
    p.then(setS).catch((x) => { const m = String(x?.message || x); setE(m); if (m === USE_TV && provider === 'native' && !IN_CLAUDE()) setProvider('tradingview'); });
  }, [range, w, src]);
  useEffect(() => { (w.type === 'ratio' ? getRatio(w.symbols[0], w.symbols[1], '1Y', false, src) : getSeries(w.symbols[0], '1Y', false, src)).then(setY1).catch(() => {}); }, [w, src]);
  const key = w.type === 'ratio' ? w.symbols.join('/') : w.symbols[0];
  const chg = range === '1D' ? s?.changePct ?? s?.rangeChangePct ?? null : s?.rangeChangePct ?? null;
  const hi52 = y1?.points.length ? Math.max(...y1.points.map((p) => p.h ?? p.c)) : null, lo52 = y1?.points.length ? Math.min(...y1.points.map((p) => p.l ?? p.c)) : null;
  const tvSym = tvOf(w);
  return (
    <Modal title={w.title} onClose={onClose} wide>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="small muted">{w.type === 'ratio' ? `${w.symbols[0]} ÷ ${w.symbols[1]}` : `${findInstrument(w.symbols[0]).name} · ${w.symbols[0]}`}</div>
          <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s ? fmtPrice(s.price, key) : '—'}</div>
          {s && <div className={`chg ${dir(chg)}`} style={{ fontSize: 15 }}>{chg != null && (chg >= 0 ? '▲ ' : '▼ ')}{pctTxt(chg)} <span className="muted" style={{ fontWeight: 500 }}>{range}</span></div>}
        </div>
        <div className="row">
          {provider === 'native' && <select className="input" style={{ width: 'auto' }} value={src} onChange={(e) => setSrc(e.target.value as DataSource)} aria-label="Data source">
            <option value="auto">Data: Auto (Pluang → TradingView)</option><option value="pluang" disabled={!w.symbols.every(pluangCan)}>Data: Pluang</option><option value="yahoo">Data: Yahoo Finance</option><option value="alpaca" disabled={!w.symbols.every(alpacaCan)}>Data: Alpaca</option></select>}
          {provider === 'native' && <Seg value={kind} onChange={setKind} options={[{ v: 'area', l: 'Area' }, { v: 'line', l: 'Line' }, { v: 'candle', l: 'Candles' }]} />}
        </div>
      </div>
      <div className="row mt-s" style={{ gap: 6 }}>
        <Seg value={provider} onChange={setProvider} options={[{ v: 'native', l: 'FinPlan chart' }, { v: 'tradingview', l: 'TradingView' }, { v: 'investing', l: 'Investing.com' }]} />
        {w.type === 'quote' && isIdx(w.symbols[0]) && <a className="btn sm" href={stockbitUrl(w.symbols[0])} target="_blank" rel="noreferrer" title="Stockbit has no public chart API; opens the stock in Stockbit"><ExternalLink size={14} /> Stockbit</a>}
        <a className="btn sm" href={ALGOBARS_URL} target="_blank" rel="noreferrer" title="AlgoBars has no public chart API; opens their platform"><ExternalLink size={14} /> AlgoBars</a>
      </div>
      {provider === 'tradingview' && <div className="mt-s"><TVWidget type="advanced-chart" height={460} config={{ symbol: tvSym, interval: 'D', timezone: 'Asia/Jakarta', style: '1', allow_symbol_change: true, autosize: true, support_host: 'https://www.tradingview.com' }} /></div>}
      {provider === 'investing' && <div className="mt-s">{w.type === 'ratio' ? <div className="empty">Investing.com charts show one instrument. Pick a single-symbol widget.</div> : <InvestingChart pair={invPairOf(w)} height={460} />}</div>}
      {provider === 'native' && <>
      <div className="range-chips mt-s">{RANGES.map((r) => <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}</div>
      <div className="mt-s">
        {s ? <PriceChart points={s.points} kind={kind} height={280} up={(chg ?? 0) >= 0} prevClose={range === '1D' ? s.prevClose : null} interactive fmt={(n) => fmtPrice(n, key)}
          timeFmt={(t) => (range === '1D' || range === '5D' ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString())} />
          : e ? <div className="empty">{errText(e, key)}</div> : <div className="empty">Loading chart…</div>}
      </div>
      {s && (
        <div className="grid g4 keep mt-s small">
          <div className="kv"><span>Prev close</span><b>{s.prevClose != null ? fmtPrice(s.prevClose, key) : '–'}</b></div>
          <div className="kv"><span>Day range</span><b>{s.dayLow != null && s.dayHigh != null ? `${fmtPrice(s.dayLow, key)} – ${fmtPrice(s.dayHigh, key)}` : '–'}</b></div>
          <div className="kv"><span>52-week range</span><b>{lo52 != null && hi52 != null ? `${fmtPrice(lo52, key)} – ${fmtPrice(hi52, key)}` : '–'}</b></div>
          <div className="kv"><span>Source</span><b>{s.source === 'computed' ? 'Calculated' : s.source}{s.currency ? ` · ${s.currency}` : ''}</b></div>
          {s.stats?.lots && <div className="kv"><span>Volume</span><b>{s.stats.lots} lot</b></div>}
          {s.stats?.turnover && <div className="kv"><span>Value</span><b>Rp{s.stats.turnover}</b></div>}
          {s.stats?.avg && <div className="kv"><span>Average</span><b>{s.stats.avg}</b></div>}
          {s.stats?.marketCap && <div className="kv"><span>Market cap</span><b>Rp{s.stats.marketCap}</b></div>}
        </div>
      )}
      </>}
      <div className="row between mt">
        <span className="small muted">{provider === 'native' ? 'Delayed quotes; for trading use your broker.' : provider === 'investing' ? 'Live chart from Investing.com (official widget).' : 'Live chart from TradingView (official widget).'}</span>
        <a className="btn sm" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open on TradingView</a>
      </div>
    </Modal>
  );
}

function WidgetEditor({ w, inClaude, onClose, onSave }: { w?: Widget; inClaude: boolean; onClose: () => void; onSave: (w: Widget) => void }) {
  const [x, setX] = useState<Widget>(w ?? W('quote', '', [], '1D', 's'));
  const [q, setQ] = useState(''); const [custom, setCustom] = useState(''); const [idx, setIdx] = useState('');
  const set = (p: Partial<Widget>) => setX((y) => ({ ...y, ...p }));
  const max = x.type === 'quote' ? 1 : x.type === 'ratio' || x.type === 'compare' ? 2 : 30;
  const toggle = (sym: string) => {
    const has = x.symbols.includes(sym);
    let symbols = has ? x.symbols.filter((s) => s !== sym) : [...x.symbols, sym];
    if (symbols.length > max) symbols = max === 1 ? [sym] : symbols.slice(-max);
    const title = x.title || (x.type === 'quote' && symbols[0] ? findInstrument(symbols[0]).name : x.title);
    set({ symbols, title: max === 1 && !has ? findInstrument(sym).name : title });
  };
  const list = useMemo(() => CATALOG.filter((i) => !q || (i.name + i.sym + i.group).toLowerCase().includes(q.toLowerCase())), [q]);
  const ok = x.symbols.length >= (x.type === 'ratio' || x.type === 'compare' ? 2 : 1);
  return (
    <Modal title={w ? 'Edit widget' : 'Add widget'} onClose={onClose} wide>
      <div className="form">
        <div className="full"><Seg value={x.type} onChange={(type) => set({ type, symbols: x.symbols.slice(0, type === 'quote' ? 1 : type === 'ratio' || type === 'compare' ? 2 : 30), size: type === 'list' ? 'm' : x.size })}
          options={[{ v: 'quote', l: 'Chart (1 symbol)' }, { v: 'compare', l: 'Compare A vs B' }, { v: 'ratio', l: 'Ratio A ÷ B' }, { v: 'list', l: 'Watchlist' }]} /></div>
        <Field label="Title"><input className="input" value={x.title} onChange={(e) => set({ title: e.target.value })} placeholder={x.type === 'ratio' ? 'e.g. RSP / SPY' : 'e.g. Gold'} /></Field>
        <Field label="Time range"><select className="input" value={x.range} onChange={(e) => set({ range: e.target.value as RangeKey })}>{RANGES.map((r) => <option key={r}>{r}</option>)}</select></Field>
        {x.type !== 'list' && <Field label="Chart style"><select className="input" value={x.chart} onChange={(e) => set({ chart: e.target.value as Widget['chart'] })}><option value="area">Area</option><option value="line">Line</option><option value="candle">Candles</option></select></Field>}
        <Field label="Size"><select className="input" value={x.size} onChange={(e) => set({ size: e.target.value as Widget['size'] })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select></Field>
        <Field label="Data source"><select className="input" value={x.source || 'auto'} onChange={(e) => set({ source: e.target.value as Widget['source'] })}>
          <option value="auto">Auto: Pluang first, then TradingView</option><option value="pluang">Pluang only</option><option value="yahoo">Yahoo Finance</option>
          <option value="alpaca">Alpaca Markets (US stocks/ETFs, crypto)</option></select></Field>
        {x.type === 'quote' && <Field label="Chart drawn by"><select className="input" value={x.view || 'native'} onChange={(e) => set({ view: e.target.value as Widget['view'] })}>
          <option value="native">FinPlan (uses the data source)</option><option value="tradingview">TradingView live widget</option><option value="investing">Investing.com live chart</option></select></Field>}
        {x.type === 'quote' && x.view === 'investing' && <Field label={`Investing.com pair ID${x.symbols[0] && findInstrument(x.symbols[0]).inv ? ` (default ${findInstrument(x.symbols[0]).inv})` : ''}`}>
          <input className="input" type="number" value={x.invPair ?? ''} placeholder={x.symbols[0] && findInstrument(x.symbols[0]).inv ? String(findInstrument(x.symbols[0]).inv) : 'e.g. 8830 for Gold'} onChange={(e) => set({ invPair: e.target.value ? Number(e.target.value) : undefined })} /></Field>}
      </div>
      {x.source === 'alpaca' && x.symbols.some((sy) => !alpacaCan(sy)) && <div className="small neg mt-s">Alpaca covers US stocks/ETFs and crypto only: {x.symbols.filter((sy) => !alpacaCan(sy)).join(', ')} won't load from Alpaca.</div>}
      <div className="mt"><b>{x.type === 'quote' ? 'Pick a symbol' : x.type === 'ratio' || x.type === 'compare' ? 'Pick 2 symbols (A, then B)' : 'Pick symbols'}</b> <span className="small muted">· selected: {x.symbols.join(x.type === 'ratio' ? ' ÷ ' : x.type === 'compare' ? ' vs ' : ', ') || 'none'}</span></div>
      <div className="row mt-s">
        <div style={{ position: 'relative', flex: '1 1 200px' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
          <input className="input" style={{ paddingLeft: 30 }} placeholder="Search: gold, nikkei, BTC, IDR…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <input className="input" style={{ flex: '0 1 130px' }} placeholder="IDX code, e.g. BBCA" value={idx} onChange={(e) => setIdx(e.target.value.toUpperCase().slice(0, 4))} />
        <button className="btn" disabled={idx.length !== 4} onClick={() => { toggle(`${idxCode(idx)}.JK`); setIdx(''); }}><Plus size={14} /> IDX</button>
        <input className="input" style={{ flex: '1 1 150px' }} placeholder="Other symbol, e.g. AAPL" value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} />
        <button className="btn" disabled={!custom} onClick={() => { toggle(custom.trim()); setCustom(''); }}><Plus size={14} /> Add</button>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
        {GROUPS.map((g) => {
          const items = list.filter((i) => i.group === g); if (!items.length) return null;
          return (<div key={g}><div className="small muted" style={{ fontWeight: 700, margin: '8px 0 4px' }}>{g}</div>
            <div className="row" style={{ gap: 6 }}>{items.map((i) => (
              <button key={i.sym} className={`chip ${x.symbols.includes(i.sym) ? 'on' : ''}`} onClick={() => toggle(i.sym)} title={i.sym}>
                {x.symbols.includes(i.sym) && <Check size={12} style={{ verticalAlign: -2 }} />} {i.name}{pluangCan(i.sym) ? ' ·P' : ' ·TV'}
              </button>))}</div></div>);
        })}
      </div>
      <div className="small muted mt-s">·P = charted from Pluang data · ·TV = TradingView live chart (Pluang doesn't list it){inClaude ? '; TradingView charts open from the app or tradingview.com' : ''}.</div>
      <div className="row between mt"><button className="btn" onClick={onClose}><X size={16} /> Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => onSave({ ...x, title: x.title || (x.type === 'ratio' ? `${x.symbols[0]} / ${x.symbols[1]}` : x.type === 'compare' ? `${x.symbols[0]} vs ${x.symbols[1]}` : findInstrument(x.symbols[0]).name) })}><Check size={16} /> Save widget</button></div>
    </Modal>
  );
}
