import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { ViewProps } from '../App';
import { clearMarketCache, getSeries, type Pt } from '../lib/market';
import { buildRecap, lastSessions, leadLag, pct, PERIODS, recapSymbols, REGIONS, trendOf, type Period, type Trend } from '../lib/recap';
import { findInstrument } from '../lib/marketCatalog';
import { Card, Seg } from '../components/ui';

const tone = (r: number | null | undefined) => (r == null ? '' : r > 0.0005 ? 'up' : r < -0.0005 ? 'down' : 'flat');
const heat = (r: number) => { const a = Math.min(1, Math.abs(r) / 0.02); return r >= 0 ? `rgba(22,163,74,${0.12 + a * 0.55})` : `rgba(220,38,38,${0.12 + a * 0.55})`; };
const TrendTag = ({ t }: { t: Trend }) => (
  <span className={`pill ${t === 'Uptrend' ? 'good' : t === 'Downtrend' ? 'bad' : ''}`} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
    {t === 'Uptrend' ? <TrendingUp size={11} /> : t === 'Downtrend' ? <TrendingDown size={11} /> : <Minus size={11} />} {t}
  </span>);
const P = ({ r }: { r: number | null | undefined }) => <span className={`chg ${tone(r)}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(r)}</span>;

/** Market recap: key changes across Asia Pacific, Europe and global markets, index vs MSCI, leaders/laggards, trends, last 5 sessions. */
export default function Recap(_: ViewProps) {
  const [period, setPeriod] = useState<Period>('1D');
  const [series, setSeries] = useState<Record<string, Pt[]>>({});
  const [offs, setOffs] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(0);
  const [stamp, setStamp] = useState(0);
  const syms = useMemo(recapSymbols, []);

  useEffect(() => {
    let alive = true; setLoading(syms.length);
    for (const s of syms) getSeries(s, '1Y', stamp > 0)
      .then((d) => { if (alive) { setSeries((x) => ({ ...x, [s]: d.points })); setOffs((x) => ({ ...x, [s]: d.gmtoffset ?? 0 })); } })
      .catch(() => {})
      .finally(() => alive && setLoading((n) => n - 1));
    return () => { alive = false; };
  }, [stamp]);

  const rc = useMemo(() => buildRecap(series, period), [series, period]);
  const ll = useMemo(() => REGIONS.map((g) => ({ name: g.name, rows: g.pairs.filter(([, i, e]) => series[i]?.length && series[e]?.length).map(([m, i, e]) => leadLag(m, i, e, series[i], offs[i] ?? 0, series[e], offs[e] ?? 0)) })), [series, offs]);
  const have = syms.length - rc.missing.length;
  const leaders = ll.flatMap((g) => g.rows).filter((r) => (r.nextDay ?? 0) >= 0.3).sort((x, y) => y.nextDay! - x.nextDay!);
  const leadNote = leaders.length ? `MSCI funds lead the next local session most in ${leaders.slice(0, 4).map((r) => `${r.market} (${r.nextDay!.toFixed(2)}, +1% → ${pct((r.beta ?? 0) / 100, 2)})`).join(', ')}; see Lead–lag below.` : ll.some((g) => g.rows.length) ? 'No market shows a meaningful next-session lead from its MSCI fund over the last year.' : '';
  const top = rc.movers.slice(0, 6), bottom = rc.movers.slice(-6).reverse();
  const maxAbs = Math.max(0.0001, ...rc.movers.map((m) => Math.abs(m.r)));
  const heatRows = REGIONS.flatMap((g) => g.pairs.map(([market, idx]) => ({ market, sym: idx, s: series[idx] ? lastSessions(series[idx], 5) : [] }))).filter((r) => r.s.length);
  const days = heatRows[0]?.s.map((x) => new Date(x.t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })) || [];

  return (
    <>
      <div className="page-head">
        <div><h1>Market recap</h1><div className="sub">What moved, who led and lagged, local index vs MSCI · {have}/{syms.length} markets loaded{loading > 0 ? ' · loading…' : ''}</div></div>
        <div className="row"><Seg value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ v: p, l: p }))} />
          <button className="btn" onClick={() => { clearMarketCache(); setStamp(Date.now()); }}><RefreshCw size={15} className={loading > 0 ? 'spin' : ''} /> Refresh</button></div>
      </div>

      {have === 0 && loading === 0 && <Card><div className="empty">Market data isn't reachable here. On the website it comes from FinPlan's server; inside Claude add the FinPlan Cloud connector (Settings → Sync between devices).</div></Card>}

      <div className="grid g-2">
        <Card title={`Key takeaways · ${period}`}>
          {rc.takeaways.length ? <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{rc.takeaways.map((t, i) => <li key={i}>{t}</li>)}{leadNote && <li>{leadNote}</li>}</ul> : <div className="small muted">Loading market data…</div>}
        </Card>
        <Card title="Global benchmarks: US vs MSCI">
          <table className="table"><tbody>
            {rc.global.map((g) => <tr key={g.sym}><td>{g.name}<div className="small muted">{g.sym}</div></td><td style={{ textAlign: 'right' }}><P r={g.r} /></td><td style={{ textAlign: 'right' }}>{series[g.sym] && <TrendTag t={trendOf(series[g.sym]).trend} />}</td></tr>)}
            <tr><td colSpan={3} className="small muted" style={{ paddingTop: 10 }}>Macro</td></tr>
            {rc.macro.map((g) => <tr key={g.sym}><td>{g.name}</td><td style={{ textAlign: 'right' }}><P r={g.r} /></td><td style={{ textAlign: 'right' }}>{series[g.sym] && <TrendTag t={trendOf(series[g.sym]).trend} />}</td></tr>)}
          </tbody></table>
        </Card>
      </div>

      <Card title={`Leaders & laggards · ${period}`}>
        <div className="grid g-2">
          {[['Leaders', top], ['Laggards', bottom]].map(([label, list]) => (
            <div key={label as string}><div className="small muted" style={{ marginBottom: 6 }}>{label as string}</div>
              {(list as typeof top).map((m) => (
                <div key={m.sym} className="row" style={{ flexWrap: 'nowrap', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 170, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }} title={findInstrument(m.sym).name}>{m.name}</div>
                  <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 4, height: 14 }}><div style={{ width: `${(Math.abs(m.r) / maxAbs) * 100}%`, height: '100%', borderRadius: 4, background: m.r >= 0 ? 'var(--good)' : 'var(--bad)' }} /></div>
                  <div style={{ width: 64, textAlign: 'right' }}><P r={m.r} /></div>
                </div>))}
            </div>))}
        </div>
      </Card>

      {rc.regions.map((g) => (
        <Card key={g.id} title={`${g.name}: local index vs MSCI fund · ${period}`} action={<span className="small muted">avg index {pct(g.avgIdx)} · avg MSCI {pct(g.avgEtf)}</span>}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Market</th><th style={{ textAlign: 'right' }}>Index (local)</th><th style={{ textAlign: 'right' }}>Currency vs USD</th><th style={{ textAlign: 'right' }}>Expected in USD</th><th style={{ textAlign: 'right' }}>MSCI fund (USD)</th><th style={{ textAlign: 'right' }}>Gap fund − index</th><th style={{ textAlign: 'right' }}>Other (holdings)</th><th>Index trend</th><th>Fund trend</th></tr></thead>
              <tbody>{g.rows.map((r) => (
                <tr key={r.market}>
                  <td><b>{r.market}</b><div className="small muted">{findInstrument(r.index).name.replace(/ \(.*\)$/, '')} · {r.etf}</div></td>
                  <td style={{ textAlign: 'right' }}><P r={r.idx} /></td>
                  <td style={{ textAlign: 'right' }}><P r={r.fx} /> <span className="small muted">{r.ccy}</span></td>
                  <td style={{ textAlign: 'right' }}><P r={r.expected} /></td>
                  <td style={{ textAlign: 'right' }}><P r={r.etfR} /></td>
                  <td style={{ textAlign: 'right' }}><b><P r={r.gap} /></b></td>
                  <td style={{ textAlign: 'right' }}><P r={r.residual} /></td>
                  <td><TrendTag t={r.trendIdx} /></td><td><TrendTag t={r.trendEtf} /></td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="small muted mt-s">How to read it: an MSCI fund is the market in US dollars, so fund ≈ (1 + index) × (1 + currency) − 1. <b>Other</b> is what's left: the fund's holdings differ from the local index (large and mid caps only, sector weights, foreign-ownership limits), plus fees and different closing times.</div>
        </Card>
      ))}

      <Card title="Lead–lag: does the MSCI fund move before the local index?">
        <div className="small muted" style={{ marginBottom: 8 }}>The MSCI fund trades in New York, after Asian markets close (and partly after Europe), so its move can show up in the local index on the <b>next</b> session. Last 12 months of daily closes, matched by each market's own date.</div>
        {ll.map((g) => g.rows.length > 0 && (
          <div key={g.name} style={{ overflowX: 'auto', marginBottom: 10 }}>
            <table className="table">
              <thead><tr><th>{g.name}</th><th style={{ textAlign: 'right' }} title="Correlation of the index and the fund on the same date">Same day</th><th style={{ textAlign: 'right' }} title="Correlation of the fund's move with the index's next session">Next session</th><th style={{ textAlign: 'right' }}>MSCI +1% → index next</th><th style={{ textAlign: 'right' }}>Followed on ≥1% days</th><th style={{ textAlign: 'right' }}>Next-session signal</th></tr></thead>
              <tbody>{g.rows.map((r) => {
                const strong = (r.nextDay ?? 0) >= 0.3;
                return <tr key={r.market}>
                  <td><b>{r.market}</b><div className="small muted">{r.etf} → {findInstrument(r.index).name.replace(/ \(.*\)$/, '')} · {r.n} sessions</div></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.sameDay == null ? '–' : r.sameDay.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><span className={strong ? 'pill good' : ''}>{r.nextDay == null ? '–' : r.nextDay.toFixed(2)}</span></td>
                  <td style={{ textAlign: 'right' }}>{r.beta == null ? '–' : <P r={r.beta / 100} />}</td>
                  <td style={{ textAlign: 'right' }}>{r.hit == null ? '–' : `${Math.round(r.hit * 100)}% of ${r.bigDays}`}</td>
                  <td style={{ textAlign: 'right' }}>{r.signal && strong ? <span title={`MSCI ${pct(r.signal.etf)} on ${r.signal.date}`}>MSCI <P r={r.signal.etf} /> → index ≈ <b><P r={r.signal.expected} /></b></span> : <span className="small muted">–</span>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>))}
        <div className="small muted">How to read it: <b>Next session</b> near 0 = no lead; 0.3+ = the MSCI move tends to carry into the index the next session (highlighted). <b>MSCI +1% → index next</b> is the average follow-through (e.g. +0.40% means a +1% MSCI day is followed by about +0.4% in the index). The signal is shown only where the lead is meaningful, and it's a statistical tendency, not a forecast.</div>
      </Card>

      <Card title="Day by day: last 5 sessions (local index, daily % change)">
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 520 }}>
            <thead><tr><th>Market</th>{days.map((d, i) => <th key={i} style={{ textAlign: 'center' }}>{d}</th>)}<th style={{ textAlign: 'right' }}>5 sessions</th></tr></thead>
            <tbody>{heatRows.map((row) => {
              const tot = row.s.reduce((a, x) => a * (1 + x.r), 1) - 1;
              return <tr key={row.sym}><td style={{ whiteSpace: 'nowrap' }}>{row.market}</td>
                {row.s.map((x, i) => <td key={i} style={{ textAlign: 'center', background: heat(x.r), fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }} title={new Date(x.t).toDateString()}>{pct(x.r)}</td>)}
                <td style={{ textAlign: 'right' }}><b><P r={tot} /></b></td></tr>;
            })}</tbody>
          </table>
        </div>
        <div className="small muted mt-s">Markets close on different days (holidays), so a column is each market's own session in that slot.</div>
      </Card>
      <div className="small muted" style={{ margin: '8px 2px 20px' }}>Data: Yahoo Finance daily closes (indexes in local currency, MSCI iShares funds in USD). Educational analysis, not investment advice.</div>
    </>
  );
}
