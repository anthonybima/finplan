import { DemoBanner } from '../components/DemoBanner';
import { usdOf } from '../lib/fx';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarCheck, TrendingUp, Wallet, PiggyBank, HeartPulse, Bot } from 'lucide-react';
import type { ViewProps } from '../App';
import { balances, budgetStatus, byCategory, monthly, monthRange } from '../lib/analytics';
import { healthMetrics } from '../lib/risk';
import { generateAdvice } from '../lib/advice';
import { fmtDate, money, monthLabel, pct, today } from '../lib/format';
import { loadCachedNews, refreshNews } from '../lib/news';
import type { NewsItem } from '../lib/types';
import { AdviceList, Card, COLORS, Progress, ScoreRing, Stat } from '../components/ui';

export default function Dashboard({ data, update, go, weeklyDue, askClaude }: ViewProps & { weeklyDue: boolean }) {
  const b = balances(data.accounts);
  const rows = monthly(data.txns, 6);
  const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
  const h = useMemo(() => healthMetrics(data), [data]);
  const advice = useMemo(() => generateAdvice(data).filter((a) => a.level !== 'good').slice(0, 4), [data]);
  const { from, to } = monthRange(0);
  const cats = byCategory(data.txns, from, to).slice(0, 7);
  const budgets = budgetStatus(data).slice(0, 5);
  const nwSeries = [...data.snapshots.slice(-12).map((s) => ({ date: s.date, nw: s.netWorth })), { date: 'Now', nw: b.netWorth }];
  const [news, setNews] = useState<NewsItem[]>(() => loadCachedNews()?.items.slice(0, 5) || []);
  useEffect(() => {
    const c = loadCachedNews();
    if (!c || Date.now() - c.at > 3600_000) refreshNews(data.settings.feeds).then((r) => r.items.length && setNews(r.items.slice(0, 5))).catch(() => {});
  }, []);
  const hello = new Date().getHours() < 11 ? 'Good morning' : new Date().getHours() < 15 ? 'Good afternoon' : 'Good evening';
  const nwPrev = data.snapshots.length ? data.snapshots[data.snapshots.length - 1].netWorth : null;

  return (
    <>
      <div className="page-head">
        <div><h1>{hello}{data.settings.name ? `, ${data.settings.name}` : ''}</h1><div className="sub">{fmtDate(today())} · here's your financial picture</div></div>
        <button className="btn" onClick={() => askClaude?.('Give me a short monthly check-up of my finances: what is going well, what needs attention, and the next 3 actions with amounts.')}><Bot size={15} /> Ask Claude</button>
      </div>
      {weeklyDue && (
        <div className="banner"><CalendarCheck color="var(--brand)" />
          <div className="grow"><b>Weekly review is due.</b> <span className="muted small">Update balances & import this week's transactions (~10 min).</span></div>
          <button className="btn primary sm" onClick={() => go('weekly')}>Start</button>
        </div>
      )}
      <DemoBanner data={data} update={update} />
      <div className="grid g4 keep">
        <Stat icon={<Wallet size={15} />} label="Net worth" value={<>{money(b.netWorth, true)}<div className="small muted" style={{ fontWeight: 500 }}>≈ {usdOf(data.settings, b.netWorth)}</div></>} delta={nwPrev != null ? `${b.netWorth >= nwPrev ? '▲' : '▼'} ${money(Math.abs(b.netWorth - nwPrev), true)} since last review` : `${money(b.assets, true)} assets · ${money(b.liabilities, true)} debt`} tone={nwPrev != null ? (b.netWorth >= nwPrev ? 'pos' : 'neg') : undefined} />
        <Stat icon={<TrendingUp size={15} />} label="Income this month" value={money(cur.income, true)} delta={prev.income ? `vs ${money(prev.income, true)} last month` : undefined} />
        <Stat icon={<PiggyBank size={15} />} label="Spent this month" value={money(cur.expense, true)} delta={prev.expense ? `${cur.expense > prev.expense ? '▲' : '▼'} vs ${money(prev.expense, true)} last month` : undefined} tone={cur.expense > prev.expense ? 'neg' : 'pos'} />
        <Stat icon={<HeartPulse size={15} />} label="Avg savings rate" value={pct(h.avg.savingsRate, 0)} delta={`Emergency fund ${h.efMonths >= 99 ? '∞' : h.efMonths.toFixed(1)} mo`} tone={h.avg.savingsRate >= 0.2 ? 'pos' : 'neg'} />
      </div>

      <div className="grid g3 mt">
        <Card title="Cash flow (6 months)" className="span2">
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={rows.map((r) => ({ ...r, m: monthLabel(r.month) }))} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="m" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(v) => money(v, true)} width={70} tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 10 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill="#14b8a6" radius={[5, 5, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="#f59e0b" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Financial health" action={<button className="btn sm" onClick={() => go('risk')}>Details</button>}>
          <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}>
            <ScoreRing score={h.score} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {h.parts.slice(0, 4).map((p) => (
                <div key={p.name} style={{ marginBottom: 8 }}>
                  <div className="row between small"><span>{p.name}</span><span className="muted">{p.value}</span></div>
                  <Progress value={p.score} tone={p.score < 0.4 ? 'bad' : p.score < 0.75 ? 'warn' : 'none'} />
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g3 mt">
        <Card title="Spending this month">
          {cats.length ? (
            <>
              <div style={{ height: 170 }}>
                <ResponsiveContainer>
                  <PieChart><Pie isAnimationActive={false} data={cats} dataKey="value" nameKey="category" innerRadius={48} outerRadius={78} paddingAngle={2}>
                    {cats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie><Tooltip formatter={(v) => money(Number(v))} /></PieChart>
                </ResponsiveContainer>
              </div>
              {cats.slice(0, 5).map((c, i) => (
                <div key={c.category} className="kv"><span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: COLORS[i], marginRight: 7 }} />{c.category}</span><b>{money(c.value)}</b></div>
              ))}
            </>
          ) : <div className="empty">No expenses yet this month.</div>}
        </Card>
        <Card title="Budgets" action={<button className="btn sm" onClick={() => go('plan')}>Manage</button>}>
          {budgets.length ? budgets.map((s) => (
            <div key={s.category} style={{ marginBottom: 12 }}>
              <div className="row between small"><b>{s.category}</b><span className="muted">{money(s.spent, true)} / {money(s.limit, true)}</span></div>
              <Progress value={s.pct} />
            </div>
          )) : <div className="empty">No budgets yet. <a href="#" onClick={(e) => { e.preventDefault(); go('plan'); }}>Create one</a></div>}
        </Card>
        <Card title="Net worth trend">
          {nwSeries.length > 1 ? (
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <LineChart data={nwSeries}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={(d) => (d === 'Now' ? 'Now' : d.slice(5))} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => money(v, true)} width={64} fontSize={11} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Line dataKey="nw" name="Net worth" stroke="#0f766e" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty">Complete weekly reviews to build your net-worth history.</div>}
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card title="Top advice" action={<button className="btn sm" onClick={() => go('advice')}>All advice</button>}>
          <AdviceList items={advice} />
        </Card>
        <Card title="Financial news" action={<button className="btn sm" onClick={() => go('news')}>More</button>}>
          {news.length ? news.map((n, i) => (
            <a key={i} className="news-item" href={n.link} target="_blank" rel="noreferrer">
              <div className="nt">{n.title}</div>
              <div className="meta"><span>{n.source}</span>{n.date && <span>· {fmtDate(n.date)}</span>}</div>
            </a>
          )) : <div className="empty">Loading headlines… (open News to refresh)</div>}
        </Card>
      </div>
    </>
  );
}
