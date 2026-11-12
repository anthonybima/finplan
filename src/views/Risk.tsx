import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AllocationDonut } from '../components/Allocation';
import type { ViewProps } from '../App';
import type { AssetClass, RiskAnswers } from '../lib/types';
import { ASSUMPTIONS, healthMetrics, portfolioStats, RISK_QUESTIONS, riskProfile, stressTests } from '../lib/risk';
import { money, num, pct } from '../lib/format';
import { Card, COLORS, Modal, MoneyInput, Field, Progress, ScoreRing, Seg } from '../components/ui';

export default function Risk({ data, update, askClaude }: ViewProps) {
  const h = useMemo(() => healthMetrics(data), [data]);
  const p = useMemo(() => portfolioStats(data.accounts), [data.accounts]);
  const prof = riskProfile(data.settings.risk);
  const stress = useMemo(() => stressTests(data), [data]);
  const [quiz, setQuiz] = useState(false);

  const classes = Object.keys(ASSUMPTIONS) as AssetClass[];
  const allocCompare = classes.map((c) => ({
    name: ASSUMPTIONS[c].label.split(' (')[0], actual: (p.rows.find((r) => r.cls === c)?.weight || 0) * 100, target: ((prof?.target[c] || 0) * 100),
  })).filter((r) => r.actual || r.target);
  // Rebalance: investable = all non-debt assets minus 6 months emergency cash
  const ef = h.avg.expense * 6;
  const investable = Math.max(0, p.total - ef);
  const rebalance = prof ? classes.map((c) => {
    const have = (p.rows.find((r) => r.cls === c)?.value || 0) - (c === 'cash' ? Math.min(ef, p.rows.find((r) => r.cls === 'cash')?.value || 0) : 0);
    const want = investable * (prof.target[c] || 0);
    return { c, label: ASSUMPTIONS[c].label, have: Math.max(0, have), want, diff: want - Math.max(0, have) };
  }).filter((r) => Math.abs(r.diff) > investable * 0.02) : [];

  return (
    <>
      <div className="page-head"><div><h1>Risk management</h1><div className="sub">Health score, portfolio risk, stress tests and debt strategy</div></div>
        <div className="row"><button className="btn" onClick={() => askClaude?.('Explain my risk in simple terms: health score, VaR, stress tests and concentration. What are the 3 most important things to change, with amounts?')}><Bot size={15} /> Explain with Claude</button>
        <button className="btn primary" onClick={() => setQuiz(true)}>{prof ? 'Retake' : 'Take'} risk-profile quiz</button></div></div>

      <div className="grid g3">
        <Card title="Financial health score" className="span2">
          <div className="row" style={{ gap: 20, alignItems: 'flex-start' }}>
            <ScoreRing score={h.score} />
            <div style={{ flex: 1, minWidth: 240 }}>
              {h.parts.map((x) => (
                <div key={x.name} style={{ marginBottom: 9 }}>
                  <div className="row between small"><span><b>{x.name}</b> <span className="muted">· weight {x.weight}</span></span><span>{x.value} <span className="muted">(target {x.target})</span></span></div>
                  <Progress value={x.score} tone={x.score < 0.4 ? 'bad' : x.score < 0.75 ? 'warn' : 'none'} />
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card title="Risk profile">
          {prof ? (<>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--brand)' }}>{prof.profile}</div>
            <div className="small muted">Score {prof.score} / 25 · suitable volatility ≈ {pct(prof.maxVol, 0)}</div>
            <div className="mt">
              <div className="kv"><span>Your portfolio volatility</span><b className={p.sigma > prof.maxVol * 1.25 ? 'neg' : 'pos'}>{pct(p.sigma)}</b></div>
              <div className="kv"><span>Fit</span><b>{p.sigma > prof.maxVol * 1.25 ? 'Too risky' : p.sigma < prof.maxVol * 0.4 ? 'Too cautious' : 'Within range'}</b></div>
            </div>
          </>) : <div className="empty">Answer 5 quick questions to get your risk profile and a target allocation.<br /><button className="btn primary mt" onClick={() => setQuiz(true)}>Start quiz</button></div>}
        </Card>
      </div>

      <div className="grid g3 mt">
        <Card title="Portfolio risk (1-year)">
          {p.total ? (<>
            <div className="kv"><span>Total (incl. cash)</span><b>{money(p.total)}</b></div>
            <div className="kv"><span>Expected return</span><b>{pct(p.mu)} ≈ {money(p.total * p.mu)}</b></div>
            <div className="kv"><span>Volatility (σ)</span><b>{pct(p.sigma)}</b></div>
            <div className="kv"><span>Value-at-Risk 95%</span><b className="neg">−{money(p.var95)}</b></div>
            <div className="kv"><span>Value-at-Risk 99%</span><b className="neg">−{money(p.var99)}</b></div>
            <div className="kv"><span>Expected shortfall (CVaR 95%)</span><b className="neg">−{money(p.cvar95)}</b></div>
            <div className="kv"><span>Sharpe ratio (vs 4.5% deposit)</span><b>{num(p.sharpe, 2)}</b></div>
            <div className="kv"><span>Concentration (HHI)</span><b>{num(p.hhi, 2)} {p.hhi > 0.4 ? '· high' : p.hhi > 0.25 ? '· moderate' : '· diversified'}</b></div>
            <div className="small muted mt-s">VaR 95%: in 1 year out of 20 you could lose at least this much. Based on long-run asset-class assumptions.</div>
          </>) : <div className="empty">Add accounts in Wealth to calculate.</div>}
        </Card>
        <Card title="Current allocation">
          {p.rows.length ? (<>
            <AllocationDonut rows={p.rows} />
            {p.rows.map((r, i) => <div key={r.cls} className="kv"><span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: COLORS[i], marginRight: 7 }} />{r.label}</span><b>{pct(r.weight, 0)}</b></div>)}
          </>) : <div className="empty">No assets yet.</div>}
        </Card>
        <Card title="Actual vs target allocation">
          {prof ? (<div style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={allocCompare} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid horizontal={false} stroke="var(--line)" />
                <XAxis type="number" unit="%" fontSize={11} />
                <YAxis type="category" dataKey="name" width={90} fontSize={11} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="actual" name="Actual" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                <Bar dataKey="target" name="Target" fill="#0f766e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>) : <div className="empty">Take the quiz to see a target.</div>}
        </Card>
      </div>

      {prof && investable <= 0 && p.total > 0 && (
        <div className="banner mt" style={{ background: 'var(--warn-soft)' }}><div className="grow"><b>Rebalancing plan:</b> build your 6-month emergency fund ({money(ef)}) first — after that, new savings are split according to your target allocation.</div></div>
      )}
      {prof && investable > 0 && rebalance.length > 0 && (
        <Card title="Rebalancing plan" className="mt" action={<span className="small muted">Keeps {money(ef, true)} (6 mo) as emergency cash</span>}>
          <div className="scroll-x"><table><thead><tr><th>Asset class</th><th className="r">Now</th><th className="r">Target</th><th className="r">Action</th></tr></thead>
            <tbody>{rebalance.map((r) => <tr key={r.c}><td>{r.label}</td><td className="r">{money(r.have)}</td><td className="r">{money(r.want)}</td>
              <td className={`r ${r.diff > 0 ? 'pos' : 'neg'}`}>{r.diff > 0 ? 'Add ' : 'Reduce '}{money(Math.abs(r.diff))}</td></tr>)}</tbody></table></div>
          <div className="small muted mt-s">Rebalance gradually (e.g. with new monthly savings) to avoid selling at a loss and to limit fees/taxes.</div>
        </Card>
      )}

      <Card title="Stress tests — can you survive these?" className="mt">
        <div className="scroll-x"><table><thead><tr><th>Scenario</th><th className="r">Impact</th><th className="r">% of net worth</th><th>Covered by liquid cash?</th><th className="hide-m">Assumption</th></tr></thead>
          <tbody>{stress.map((s) => <tr key={s.name}><td><b>{s.name}</b></td><td className="r neg">{money(s.impact)}</td><td className="r">{pct(Math.abs(s.pctOfNetWorth), 0)}</td>
            <td><span className={`pill ${s.survivable ? 'good' : 'bad'}`}>{s.survivable ? 'Yes' : 'No'}</span></td><td className="small muted hide-m">{s.note}</td></tr>)}</tbody></table></div>
      </Card>

      <div className="grid g2 mt">
        <DebtPlanner data={data} />
        <EmergencyCalc expense={h.avg.expense} liquid={h.b.liquid} />
      </div>
      {quiz && <Quiz initial={data.settings.risk} onClose={() => setQuiz(false)} onSave={(risk) => { update((d) => ({ ...d, settings: { ...d.settings, risk } })); setQuiz(false); }} />}
    </>
  );
}

function Quiz({ initial, onClose, onSave }: { initial?: RiskAnswers; onClose: () => void; onSave: (a: RiskAnswers) => void }) {
  const [a, setA] = useState<Partial<RiskAnswers>>(initial || {});
  const done = RISK_QUESTIONS.every((q) => a[q.key]);
  return (
    <Modal title="Risk-profile quiz" onClose={onClose}>
      {RISK_QUESTIONS.map((q) => (
        <div key={q.key} className="quiz-q"><b>{q.q}</b>
          <div className="opts">{q.options.map((o, i) => <button key={o} className={`chip ${a[q.key] === i + 1 ? 'on' : ''}`} onClick={() => setA({ ...a, [q.key]: i + 1 })}>{o}</button>)}</div>
        </div>
      ))}
      <div className="row between"><span className="small muted">{done ? `Result: ${riskProfile(a as RiskAnswers)!.profile}` : 'Answer all questions'}</span>
        <button className="btn primary" disabled={!done} onClick={() => onSave(a as RiskAnswers)}>Save profile</button></div>
    </Modal>
  );
}

/** Avalanche vs snowball payoff simulation */
function DebtPlanner({ data }: { data: ViewProps['data'] }) {
  const debts = data.accounts.filter((a) => a.kind === 'debt' && a.balance > 0);
  const [extra, setExtra] = useState(1_000_000);
  const [method, setMethod] = useState<'avalanche' | 'snowball'>('avalanche');
  // roll = freed-up installments of paid-off debts are redirected to the next target
  const sim = (m: 'avalanche' | 'snowball', extraPay: number, roll: boolean) => {
    const ds = debts.map((d) => ({ name: d.name, bal: d.balance, r: (d.interestRate || 0) / 1200, pay: d.monthlyPayment || Math.max(d.balance * 0.03, 100000) }));
    let month = 0, interest = 0; const order: string[] = [];
    while (ds.some((d) => d.bal > 0.5) && month < 600) {
      month++;
      let pool = extraPay + (roll ? ds.filter((d) => d.bal <= 0.5).reduce((s, d) => s + d.pay, 0) : 0);
      for (const d of ds) if (d.bal > 0.5) {
        const i = d.bal * d.r; interest += i; d.bal += i;
        const p = Math.min(d.pay, d.bal); d.bal -= p; if (roll) pool += d.pay - p;
      }
      const targets = ds.filter((d) => d.bal > 0.5).sort((x, y) => (m === 'avalanche' ? y.r - x.r : x.bal - y.bal));
      for (const d of targets) { if (pool <= 0) break; const p = Math.min(pool, d.bal); d.bal -= p; pool -= p; }
      for (const d of ds) if (d.bal <= 0.5 && !order.includes(d.name)) order.push(d.name);
    }
    return { month, interest, order };
  };
  const base = useMemo(() => sim(method, 0, false), [debts, method]);
  const plan = useMemo(() => sim(method, extra, true), [debts, method, extra]);
  return (
    <Card title="Debt payoff planner">
      {debts.length ? (<>
        <div className="row between"><Seg value={method} onChange={setMethod} options={[{ v: 'avalanche', l: 'Avalanche (highest rate)' }, { v: 'snowball', l: 'Snowball (smallest)' }]} /></div>
        <div className="form mt"><Field label="Extra payment per month"><MoneyInput value={extra} onChange={setExtra} /></Field></div>
        <div className="mt">
          <div className="kv"><span>Debt-free in (minimum payments)</span><b>{base.month} months · interest {money(base.interest, true)}</b></div>
          <div className="kv"><span>Debt-free in (with extra)</span><b className="pos">{plan.month} months · interest {money(plan.interest, true)}</b></div>
          <div className="kv"><span>You save</span><b className="pos">{base.month - plan.month} months · {money(base.interest - plan.interest)}</b></div>
          <div className="kv"><span>Payoff order</span><b>{plan.order.join(' → ')}</b></div>
        </div>
      </>) : <div className="empty">No debts recorded. 🎉</div>}
    </Card>
  );
}

function EmergencyCalc({ expense, liquid }: { expense: number; liquid: number }) {
  const [months, setMonths] = useState(6);
  const [monthly, setMonthly] = useState(2_000_000);
  const target = expense * months;
  const gap = Math.max(0, target - liquid);
  return (
    <Card title="Emergency fund calculator">
      <div className="form">
        <Field label="Months of cover"><select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} months{m === 6 ? ' (employee)' : m === 12 ? ' (self-employed / sole earner)' : ''}</option>)}</select></Field>
        <Field label="Can set aside per month"><MoneyInput value={monthly} onChange={setMonthly} /></Field>
      </div>
      <div className="mt">
        <div className="kv"><span>Avg monthly expenses</span><b>{money(expense)}</b></div>
        <div className="kv"><span>Target</span><b>{money(target)}</b></div>
        <div className="kv"><span>Liquid cash now</span><b>{money(liquid)}</b></div>
        <div className="kv"><span>Gap</span><b className={gap ? 'neg' : 'pos'}>{gap ? money(gap) : 'Fully funded ✓'}</b></div>
        {gap > 0 && <div className="kv"><span>Time to fill</span><b>{monthly ? `${Math.ceil(gap / monthly)} months` : '–'}</b></div>}
      </div>
      <div className="mt-s"><Progress value={target ? liquid / target : 0} tone="none" /></div>
      <div className="small muted mt-s">Keep it in instant-access places: savings, money-market funds (RDPU) or short deposits.</div>
    </Card>
  );
}
