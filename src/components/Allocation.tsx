import { useMemo, useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { AppData, AssetClass } from '../lib/types';
import { allocation, ASSUMPTIONS, classOf, riskProfile } from '../lib/risk';
import { valueIDR } from '../lib/holdings';
import { refreshLive } from '../lib/live';
import { money, pct } from '../lib/format';
import { Card, COLORS, toast } from './ui';

type Rows = ReturnType<typeof allocation>['rows'];
const ago = (iso?: string) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };

/** Donut of asset classes (shared by Wealth and Risk). */
export function AllocationDonut({ rows, height = 180 }: { rows: Rows; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer><PieChart>
        <Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="label" innerRadius={height / 4} outerRadius={height / 2.3} paddingAngle={2}>
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie>
        <Tooltip formatter={(v) => money(Number(v))} /></PieChart></ResponsiveContainer>
    </div>
  );
}

/** Wealth: current allocation by asset class, what's in each class, vs the risk-profile target, with live refresh. */
export function AllocationCard({ data, update }: { data: AppData; update: (fn: (d: AppData) => AppData) => void }) {
  const { total, rows } = useMemo(() => allocation(data.accounts), [data.accounts]);
  const target = riskProfile(data.settings.risk);
  const [open, setOpen] = useState<AssetClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [how, setHow] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await refreshLive(data, update);
      toast(`Updated ${r.prices.size} price${r.prices.size === 1 ? '' : 's'}${r.usd ? ` · USD/IDR ${Math.round(r.usd).toLocaleString('id-ID')}` : ''}${r.failed.length ? ` · not available: ${r.failed.slice(0, 5).join(', ')}` : ''}`);
    } catch { toast('Prices are not reachable right now'); }
    setBusy(false);
  };
  const members = (c: AssetClass) => data.accounts.filter((a) => classOf(a) === c && a.balance > 0).sort((a, b) => b.balance - a.balance);
  const positions = (src: string, c: AssetClass) => data.holdings.filter((h) => !h.excluded && h.source === src && h.assetClass === c)
    .map((h) => ({ h, v: valueIDR(h, data.settings.usdIdr) })).sort((a, b) => b.v - a.v);

  return (
    <Card title="Allocation" className="mt" action={<span className="row" style={{ gap: 8 }}><span className="small muted">prices {ago(data.settings.liveAt)}</span><button className="btn sm" disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? 'spin' : ''} /> Refresh prices</button></span>}>
      {!rows.length ? <div className="empty">No assets yet.</div> : (
        <div className="grid g-2" style={{ alignItems: 'start' }}>
          <div>
            <AllocationDonut rows={rows} height={200} />
            <div className="small muted" style={{ textAlign: 'center' }}>Total assets {money(total)}{target ? ` · target: ${target.profile}` : ''}</div>
          </div>
          <div>
            <table className="table">
              <thead><tr><th>Asset class</th><th className="r">Value</th><th className="r">Now</th>{target && <th className="r">Target</th>}</tr></thead>
              <tbody>{rows.map((r, i) => {
                const t = target?.target[r.cls] ?? 0; const isOpen = open === r.cls;
                return [
                  <tr key={r.cls} style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : r.cls)}>
                    <td>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: COLORS[i % COLORS.length], marginRight: 6 }} />{r.label}</td>
                    <td className="r">{money(r.value, true)}</td>
                    <td className="r"><b>{pct(r.weight, 0)}</b></td>
                    {target && <td className="r"><span className={Math.abs(r.weight - t) > 0.05 ? (r.weight > t ? 'warn-text' : 'muted') : 'muted'}>{pct(t, 0)}{Math.abs(r.weight - t) > 0.05 ? (r.weight > t ? ' ▼' : ' ▲') : ''}</span></td>}
                  </tr>,
                  isOpen && <tr key={r.cls + '-d'}><td colSpan={target ? 4 : 3} style={{ background: 'var(--bg)' }}>
                    {members(r.cls).map((a) => (
                      <div key={a.id} style={{ padding: '3px 0' }}>
                        <div className="row between small"><span>{a.name}{a.currency && a.currency !== 'IDR' ? <span className="muted"> · {a.currency}</span> : null}</span><span>{money(a.balance, true)} · {pct(a.balance / r.value, 0)}</span></div>
                        {a.synced && <div className="small muted" style={{ paddingLeft: 12 }}>{positions(a.synced, r.cls).slice(0, 6).map(({ h, v }) => `${h.symbol} ${money(v, true)}`).join(' · ')}{positions(a.synced, r.cls).length > 6 ? ' …' : ''}</div>}
                      </div>))}
                  </td></tr>,
                ];
              })}</tbody>
            </table>
            {target && <div className="small muted">▲ below target · ▼ above target (more than 5 points off). Full rebalancing plan in Risk.</div>}
          </div>
        </div>
      )}
      <button className="btn ghost sm mt-s" onClick={() => setHow(!how)}>{how ? <ChevronDown size={13} /> : <ChevronRight size={13} />} How this is calculated</button>
      {how && <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
        <li><b>What counts:</b> everything you own: bank, e-wallet and cash accounts are <i>{ASSUMPTIONS.cash.label}</i>; deposits, bonds, funds, stocks, gold, property and crypto by their asset class. Debts are not part of allocation (they are in net worth), and insurance is never counted.</li>
        <li><b>App positions</b> (Pluang, Stockbit, Bitget, Bittime, Alpaca…) are valued at quantity × latest price; US positions × USD/IDR.</li>
        <li><b>Foreign-currency accounts</b> (USD, SGD…) are converted at the current rate.</li>
        <li><b>Always up to date:</b> prices and exchange rates refresh when FinPlan opens and every 15 minutes while it's open (Pluang, then Yahoo Finance through FinPlan's server, or inside Claude through the FinPlan Cloud connector), and whenever you tap Refresh prices. Manual balances change when you edit them or do the monthly update.</li>
        <li><b>Target</b> comes from your risk-profile quiz (Risk). Click a row to see which accounts and positions make up that class.</li>
      </ul>}
    </Card>
  );
}
