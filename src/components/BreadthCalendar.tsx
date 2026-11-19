import { useEffect, useMemo, useState } from 'react';
import { getSeries, type Pt } from '../lib/market';
import { BREADTH, breadthSymbols, buildCalendar, type Quadrant } from '../lib/breadth';
import { pct } from '../lib/recap';
import { Card, Seg } from './ui';

const heat = (r: number | null, scale = 0.02) => {
  if (r == null) return 'transparent';
  const a = Math.min(1, Math.abs(r) / scale);
  return r >= 0 ? `rgba(22,163,74,${0.08 + a * 0.62})` : `rgba(220,38,38,${0.08 + a * 0.62})`;
};
const breadthBg = (b: number | null) => (b == null ? 'transparent' : heat(b - 0.5, 0.35));
const Q_STYLE: Record<Quadrant, string> = { Leading: 'good', Improving: 'info', Weakening: 'warn', Lagging: 'bad' };

/** Breadth heat calendar: each sector's daily move (or move vs the index), market breadth, and rotation quadrant. */
export function BreadthCalendar() {
  const [mk, setMk] = useState<'id' | 'us'>('id');
  const [n, setN] = useState<20 | 40 | 60>(20);
  const [mode, setMode] = useState<'rel' | 'abs'>('rel');
  const [series, setSeries] = useState<Record<string, Pt[]>>({});
  const [offs, setOffs] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(0);
  const m = BREADTH.find((x) => x.id === mk)!;

  useEffect(() => {
    let alive = true; const syms = breadthSymbols(m).filter((s) => !series[s]);
    setPending(syms.length);
    for (const s of syms) getSeries(s, '3M').then((d) => { if (alive) { setSeries((x) => ({ ...x, [s]: d.points })); setOffs((x) => ({ ...x, [s]: d.gmtoffset ?? 0 })); } })
      .catch(() => {}).finally(() => alive && setPending((k) => k - 1));
    return () => { alive = false; };
  }, [mk]);

  const cal = useMemo(() => buildCalendar(m, series, offs, n), [m, series, offs, n]);
  const fmtD = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return x.getUTCDate() === 1 || d === cal.dates[0] ? x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : String(x.getUTCDate()); };
  const cell: React.CSSProperties = { padding: '3px 2px', textAlign: 'center', fontSize: 10.5, minWidth: 30, fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--line)' };
  const sticky: React.CSSProperties = { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, whiteSpace: 'nowrap', fontSize: 12.5, paddingRight: 8, borderBottom: '1px solid var(--line)' };

  return (
    <Card title="Breadth heat calendar · money rotation" action={<span className="small muted">{cal.loaded}/{cal.total} loaded{pending > 0 ? ' · loading…' : ''}</span>}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Seg value={mk} onChange={setMk} options={[{ v: 'id', l: 'Indonesia' }, { v: 'us', l: 'United States' }]} />
        <Seg value={String(n) as '20' | '40' | '60'} onChange={(v) => setN(Number(v) as 20 | 40 | 60)} options={[{ v: '20', l: '20 days' }, { v: '40', l: '40 days' }, { v: '60', l: '60 days' }]} />
        <Seg value={mode} onChange={setMode} options={[{ v: 'rel', l: `vs ${m.id === 'id' ? 'IHSG' : 'SPY'}` }, { v: 'abs', l: 'Daily %' }]} />
      </div>

      {(cal.into.length > 0 || cal.outOf.length > 0) && <div className="small" style={{ marginBottom: 8, lineHeight: 1.6 }}>
        <b style={{ color: 'var(--good)' }}>Money flowing in:</b> {cal.into.join(', ') || '—'} &nbsp;·&nbsp; <b style={{ color: 'var(--bad)' }}>Flowing out:</b> {cal.outOf.join(', ') || '—'}
      </div>}

      {!cal.dates.length ? <div className="empty">{pending > 0 ? 'Loading daily prices…' : 'Market data isn’t reachable here right now.'}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={{ ...sticky, textAlign: 'left', fontSize: 11 }} className="muted">{m.name}</th>
              {cal.dates.map((d) => <th key={d} style={{ ...cell, fontWeight: 500 }} className="muted" title={d}>{fmtD(d)}</th>)}
              <th style={{ ...cell, minWidth: 54 }} className="muted">5D vs idx</th><th style={{ ...cell, minWidth: 54 }} className="muted">20D vs idx</th><th style={{ ...cell, minWidth: 84 }} className="muted">Rotation</th>
            </tr></thead>
            <tbody>
              <tr>
                <td style={sticky} title={m.id === 'id' ? 'Share of the liquid stocks below that rose' : 'Share of sector and style funds that rose'}><b>Breadth</b> <span className="small muted">% up</span></td>
                {cal.breadth.map((b, i) => <td key={i} style={{ ...cell, background: breadthBg(b) }}>{b == null ? '' : Math.round(b * 100)}</td>)}
                <td colSpan={3} style={{ ...cell, textAlign: 'left' }} className="small muted">avg {cal.breadth.filter((x) => x != null).length ? Math.round(100 * (cal.breadth.filter((x): x is number => x != null).reduce((a, b) => a + b, 0) / cal.breadth.filter((x) => x != null).length)) : '–'}% up</td>
              </tr>
              <tr>
                <td style={sticky}><b>{m.benchName}</b></td>
                {cal.bench.map((r, i) => <td key={i} style={{ ...cell, background: heat(r) }}>{r == null ? '' : (r * 100).toFixed(1)}</td>)}
                <td colSpan={3} style={cell} />
              </tr>
              {cal.rows.map((r) => (
                <tr key={r.name}>
                  <td style={sticky}>{r.name}{r.size > 1 && <span className="small muted"> · {r.size}</span>}</td>
                  {(mode === 'rel' ? r.rel : r.cells).map((v, i) => <td key={i} style={{ ...cell, background: heat(v, mode === 'rel' ? 0.012 : 0.02) }} title={`${cal.dates[i]} · ${pct(r.cells[i], 2)} (vs index ${pct(r.rel[i], 2)})${r.size > 1 && r.up[i] != null ? ` · ${Math.round(r.up[i]! * 100)}% of stocks up` : ''}`}>{v == null ? '' : (v * 100).toFixed(1)}</td>)}
                  <td style={{ ...cell, background: heat(r.rel5, 0.03) }}>{pct(r.rel5)}</td>
                  <td style={{ ...cell, background: heat(r.rel20, 0.06) }}>{pct(r.rel20)}</td>
                  <td style={cell}>{r.quadrant && <span className={`pill ${Q_STYLE[r.quadrant]}`} style={{ fontSize: 10.5 }}>{r.quadrant}</span>}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
      <div className="small muted mt-s" style={{ lineHeight: 1.6 }}>
        Each cell is the day's % move {mode === 'rel' ? `minus ${m.benchName} (green = beat the index, so money favoured it)` : '(green up, red down)'}. Sectors are sorted by 20-day strength vs the index.
        {m.id === 'id' ? ' Indonesian sectors are equal-weight baskets of liquid leaders (number after the name).' : ' US sectors are the S&P 500 sector SPDR funds, plus size and style funds.'}
        {' '}<b>Rotation</b>: <i>Improving</i> (weak trend, momentum turning up: money arriving) → <i>Leading</i> (strong and still rising) → <i>Weakening</i> (strong but losing momentum: money leaving) → <i>Lagging</i>. Breadth above 60% = broad buying; below 40% = broad selling. Educational, not advice.
      </div>
    </Card>
  );
}
