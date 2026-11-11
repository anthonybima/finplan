import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ViewProps } from '../App';
import { anomalies, averages, byCategory, forecast, monthly, monthRange } from '../lib/analytics';
import { money, monthLabel, pct } from '../lib/format';
import { Card, Seg, Stat } from '../components/ui';

export default function Analyst({ data, askClaude }: ViewProps) {
  const [span, setSpan] = useState<'6' | '12'>('6');
  const rows = useMemo(() => monthly(data.txns, Number(span)), [data.txns, span]);
  const fc = useMemo(() => forecast(rows, 3), [rows]);
  const avg = averages(data.txns, 3);
  const an = anomalies(data.txns);
  const cur = monthRange(0), prev = monthRange(-1);
  const curCats = byCategory(data.txns, cur.from, cur.to), prevCats = new Map(byCategory(data.txns, prev.from, prev.to).map((c) => [c.category, c.value]));
  const allCats = [...new Set([...curCats.map((c) => c.category), ...prevCats.keys()])];
  const mom = allCats.map((c) => { const a = curCats.find((x) => x.category === c)?.value || 0, b = prevCats.get(c) || 0; return { c, a, b, diff: a - b }; }).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  const from = rows[0].month + '-01';
  const incomeSrc = byCategory(data.txns, from, cur.to, 'income');
  const topCats = byCategory(data.txns, from, cur.to).slice(0, 5).map((c) => c.category);
  const catTrend = rows.map((r) => {
    const o: Record<string, number | string> = { m: monthLabel(r.month) };
    for (const c of topCats) o[c] = data.txns.filter((t) => t.type === 'expense' && t.category === c && t.date.startsWith(r.month)).reduce((s, t) => s + t.amount, 0);
    return o;
  });
  const combined = [...rows.map((r) => ({ m: monthLabel(r.month), income: r.income, expense: r.expense, net: r.net })),
    ...fc.map((f) => ({ m: monthLabel(f.month) + '*', fIncome: f.income, fExpense: f.expense }))];
  const cumul = rows.reduce<{ m: string; cum: number }[]>((acc, r) => [...acc, { m: monthLabel(r.month), cum: (acc.at(-1)?.cum || 0) + r.net }], []);
  const colors = ['#0f766e', '#f59e0b', '#6366f1', '#ec4899', '#84cc16'];
  const bestMonth = rows.filter((r) => r.income || r.expense).sort((a, b) => b.net - a.net)[0];
  const totalSpent = rows.reduce((s, r) => s + r.expense, 0);
  const daily = cur.dayOfMonth ? (curCats.reduce((s, c) => s + c.value, 0) / cur.dayOfMonth) : 0;

  return (
    <>
      <div className="page-head">
        <div><h1>Analyst</h1><div className="sub">Trends, forecasts and where your money really goes</div></div>
        <div className="row"><button className="btn" onClick={() => askClaude?.('Analyse my income and spending trends over the last months: what changed, which categories are rising, and what should I do about it?')}><Bot size={15} /> Ask Claude</button>
        <Seg value={span} onChange={setSpan} options={[{ v: '6', l: '6 months' }, { v: '12', l: '12 months' }]} /></div>
      </div>
      <div className="grid g4 keep">
        <Stat label="Avg monthly income" value={money(avg.income, true)} />
        <Stat label="Avg monthly spend" value={money(avg.expense, true)} />
        <Stat label="Daily spend (this month)" value={money(daily, true)} delta={`→ ${money(daily * cur.daysInMonth, true)} projected`} />
        <Stat label="Best month" value={bestMonth ? monthLabel(bestMonth.month) : '–'} delta={bestMonth ? `${money(bestMonth.net, true)} saved` : undefined} tone="pos" />
      </div>

      <Card title="Income vs expense, with 3-month forecast*" className="mt">
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={combined}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="m" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v) => money(v, true)} width={70} fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Bar dataKey="income" name="Income" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Expense" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="fIncome" name="Income (forecast)" fill="#14b8a6" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
              <Bar dataKey="fExpense" name="Expense (forecast)" fill="#f59e0b" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
              <Line dataKey="net" name="Net" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="small muted">*Forecast is a linear trend of your last 6 months. Use it as a direction, not a promise.</div>
      </Card>

      <div className="grid g2 mt">
        <Card title="Top categories over time">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={catTrend}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="m" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => money(v, true)} width={64} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                {topCats.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={colors[i]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Cumulative savings">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={cumul}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="m" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => money(v, true)} width={64} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} />
                <Area dataKey="cum" name="Cumulative net" stroke="#0f766e" fill="#14b8a6" fillOpacity={0.2} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid g3 mt">
        <Card title="This month vs last month" className="span2">
          <div className="scroll-x">
            <table><thead><tr><th>Category</th><th className="r">This month</th><th className="r">Last month</th><th className="r">Change</th><th className="r hide-m">Share of {span}-mo spend</th></tr></thead>
              <tbody>{mom.slice(0, 12).map((r) => {
                const total6 = data.txns.filter((t) => t.type === 'expense' && t.category === r.c && t.date >= from).reduce((s, t) => s + t.amount, 0);
                return (<tr key={r.c}><td>{r.c}</td><td className="r">{money(r.a)}</td><td className="r">{money(r.b)}</td>
                  <td className={`r ${r.diff > 0 ? 'neg' : 'pos'}`}>{r.diff > 0 ? '+' : ''}{money(r.diff)}</td><td className="r hide-m">{pct(totalSpent ? total6 / totalSpent : 0)}</td></tr>);
              })}</tbody></table>
          </div>
        </Card>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="Unusual spending">
            {an.length ? an.map((a) => (
              <div key={a.category} className="kv"><span>{a.category}</span><b className="neg">+{pct(a.ratio - 1, 0)} pace</b></div>
            )) : <div className="small muted">Nothing unusual this month.</div>}
          </Card>
          <Card title="Income sources">
            {incomeSrc.length ? incomeSrc.map((s) => <div key={s.category} className="kv"><span>{s.category}</span><b>{money(s.value, true)}</b></div>) : <div className="small muted">No income recorded.</div>}
            {incomeSrc.length === 1 && <div className="small muted mt-s">Single income source — consider building a second stream to reduce income risk.</div>}
          </Card>
        </div>
      </div>
    </>
  );
}
