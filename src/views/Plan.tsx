import { useMemo, useState } from 'react';
import { Plus, Wand2, Trash2, Target } from 'lucide-react';
import type { ViewProps } from '../App';
import type { AssetClass, Budget, Goal } from '../lib/types';
import { EXPENSE_CATEGORIES, NEEDS } from '../lib/types';
import { averages, budgetStatus, byCategory, monthRange } from '../lib/analytics';
import { ASSUMPTIONS, goalMonteCarlo } from '../lib/risk';
import { addMonths, fmtDate, money, pct, today } from '../lib/format';
import { uid } from '../lib/store';
import { Card, Field, Modal, MoneyInput, Progress, toast } from '../components/ui';

export default function Plan({ data, update }: ViewProps) {
  const status = budgetStatus(data);
  const avg = averages(data.txns);
  const [editB, setEditB] = useState<Budget | 'new' | null>(null);
  const [editG, setEditG] = useState<Goal | 'new' | null>(null);
  const totalBudget = data.budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = status.reduce((s, b) => s + b.spent, 0);
  const { dayOfMonth, daysInMonth } = monthRange(0);

  const suggest = () => {
    const m = new Map<string, number>();
    for (const off of [-1, -2, -3]) { const r = monthRange(off); for (const c of byCategory(data.txns, r.from, r.to)) m.set(c.category, (m.get(c.category) || 0) + c.value / 3); }
    if (!m.size) return toast('Need at least one past month of expenses');
    const budgets = [...m.entries()].filter(([c]) => c !== 'Debt Payment' && c !== 'Housing').map(([category, v]) => ({
      category, limit: Math.ceil((NEEDS.has(category) ? v : v * 0.9) / 50000) * 50000,
    })).filter((b) => b.limit > 0);
    update((d) => ({ ...d, budgets }));
    toast(`Created ${budgets.length} budgets (wants trimmed 10%)`);
  };

  const i = avg.income;
  const rule = [
    { name: 'Needs', target: 0.5, actual: i ? avg.needs / i : 0, amt: avg.needs, desc: 'Housing, groceries, transport, utilities, insurance, debt' },
    { name: 'Wants', target: 0.3, actual: i ? avg.wants / i : 0, amt: avg.wants, desc: 'Dining out, shopping, entertainment, gifts' },
    { name: 'Savings & investing', target: 0.2, actual: i ? Math.max(0, avg.savings) / i : 0, amt: Math.max(0, avg.savings), desc: 'Emergency fund, goals, investments' },
  ];

  return (
    <>
      <div className="page-head"><div><h1>Plan & Goals</h1><div className="sub">Monthly budgets, the 50/30/20 rule and your savings goals</div></div></div>

      <Card title="50 / 30 / 20 check" action={<span className="small muted">Avg income {money(i)}/mo · last {avg.monthsUsed} mo</span>}>
        <div className="grid g3">
          {rule.map((r) => {
            const ok = r.name === 'Savings & investing' ? r.actual >= r.target : r.actual <= r.target;
            return (
              <div key={r.name}>
                <div className="row between"><b>{r.name}</b><span className={`pill ${ok ? 'good' : 'warn'}`}>{pct(r.actual, 0)} / {pct(r.target, 0)}</span></div>
                <div className="mt-s"><Progress value={r.target ? r.actual / r.target / (r.name === 'Savings & investing' ? 1 : 1.0001) : 0} tone={ok ? 'none' : 'warn'} /></div>
                <div className="small muted mt-s">{money(r.amt)}/mo · ideal {money(i * r.target)}<br />{r.desc}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid g2 mt">
        <Card title="Monthly budgets" action={<div className="row">
          <button className="btn sm" onClick={suggest}><Wand2 size={14} /> Auto-suggest</button>
          <button className="btn sm primary" onClick={() => setEditB('new')}><Plus size={14} /> Add</button></div>}>
          {data.budgets.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="row between small"><b>Total</b><span>{money(totalSpent)} of {money(totalBudget)}</span></div>
              <Progress value={totalBudget ? totalSpent / totalBudget : 0} />
              <div className="small muted mt-s">Day {dayOfMonth} of {daysInMonth} · {pct(dayOfMonth / daysInMonth, 0)} of month elapsed</div>
            </div>
          )}
          {status.map((s) => (
            <div key={s.category} style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => setEditB(s)}>
              <div className="row between small"><b>{s.category}</b>
                <span className={s.remaining < 0 ? 'neg' : 'muted'}>{s.remaining >= 0 ? `${money(s.remaining)} left` : `${money(-s.remaining)} over`}</span></div>
              <Progress value={s.pct} />
              <div className="small muted" style={{ marginTop: 3 }}>{money(s.spent)} / {money(s.limit)} · projected {money(s.projected)}</div>
            </div>
          ))}
          {!data.budgets.length && <div className="empty">No budgets yet. Use <b>Auto-suggest</b> to create them from your spending history.</div>}
        </Card>

        <Card title="Goals" action={<button className="btn sm primary" onClick={() => setEditG('new')}><Plus size={14} /> New goal</button>}>
          {data.goals.map((g) => <GoalRow key={g.id} g={g} onClick={() => setEditG(g)} />)}
          {!data.goals.length && <div className="empty"><Target size={26} /><br />Add goals like an emergency fund, house down payment, education or Hajj.</div>}
        </Card>
      </div>
      {editB && <BudgetModal b={editB === 'new' ? undefined : editB} onClose={() => setEditB(null)} update={update} used={data.budgets.map((b) => b.category)} />}
      {editG && <GoalModal g={editG === 'new' ? undefined : editG} onClose={() => setEditG(null)} update={update} />}
    </>
  );
}

function GoalRow({ g, onClick }: { g: Goal; onClick: () => void }) {
  const mc = useMemo(() => goalMonteCarlo(g, 1500), [g]);
  const tone = mc.probability >= 0.8 ? 'good' : mc.probability >= 0.5 ? 'warn' : 'bad';
  return (
    <div className="item" style={{ cursor: 'pointer', alignItems: 'flex-start' }} onClick={onClick}>
      <div className="grow">
        <div className="row between"><span className="title">{g.name}</span><span className={`pill ${tone}`}>{pct(mc.probability, 0)} likely</span></div>
        <div className="mt-s"><Progress value={g.target ? g.current / g.target : 0} tone="none" /></div>
        <div className="small muted mt-s">
          {money(g.current, true)} of {money(g.target, true)} · by {fmtDate(g.targetDate)} ({mc.months} mo) · {ASSUMPTIONS[g.assetClass].label}<br />
          Saving {money(g.monthlyContribution)}/mo · needed ≈ <b style={{ color: mc.required > g.monthlyContribution ? 'var(--bad)' : 'var(--good)' }}>{money(mc.required)}/mo</b> ·
          range {money(mc.p10, true)} – {money(mc.p90, true)}
        </div>
      </div>
    </div>
  );
}

function BudgetModal({ b, onClose, update, used }: { b?: Budget; onClose: () => void; update: ViewProps['update']; used: string[] }) {
  const [x, setX] = useState<Budget>(b ?? { category: EXPENSE_CATEGORIES.find((c) => !used.includes(c)) || 'Other', limit: 0 });
  return (
    <Modal title={b ? 'Edit budget' : 'Add budget'} onClose={onClose}>
      <div className="form">
        <Field label="Category"><select className="input" value={x.category} disabled={!!b} onChange={(e) => setX({ ...x, category: e.target.value })}>
          {EXPENSE_CATEGORIES.filter((c) => c === x.category || !used.includes(c)).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Monthly limit"><MoneyInput value={x.limit} onChange={(limit) => setX({ ...x, limit })} autoFocus /></Field>
      </div>
      <div className="row between mt">
        {b ? <button className="btn danger" onClick={() => { update((d) => ({ ...d, budgets: d.budgets.filter((y) => y.category !== b.category) })); onClose(); }}><Trash2 size={16} />Delete</button> : <span />}
        <button className="btn primary" onClick={() => { update((d) => ({ ...d, budgets: [...d.budgets.filter((y) => y.category !== x.category), x] })); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

function GoalModal({ g, onClose, update }: { g?: Goal; onClose: () => void; update: ViewProps['update'] }) {
  const [x, setX] = useState<Goal>(g ?? { id: uid(), name: '', target: 0, current: 0, targetDate: addMonths(today(), 24), monthlyContribution: 0, assetClass: 'deposit' });
  const set = (p: Partial<Goal>) => setX((y) => ({ ...y, ...p }));
  const mc = useMemo(() => (x.target > 0 ? goalMonteCarlo(x, 1000) : null), [x]);
  return (
    <Modal title={g ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <div className="form">
        <Field label="Goal name" full><input className="input" value={x.name} autoFocus onChange={(e) => set({ name: e.target.value })} placeholder="e.g. House down payment" /></Field>
        <Field label="Target amount"><MoneyInput value={x.target} onChange={(target) => set({ target })} /></Field>
        <Field label="Saved so far"><MoneyInput value={x.current} onChange={(current) => set({ current })} /></Field>
        <Field label="Target date"><input className="input" type="date" value={x.targetDate} onChange={(e) => set({ targetDate: e.target.value })} /></Field>
        <Field label="Monthly contribution"><MoneyInput value={x.monthlyContribution} onChange={(monthlyContribution) => set({ monthlyContribution })} /></Field>
        <Field label="Invested in" full><select className="input" value={x.assetClass} onChange={(e) => set({ assetClass: e.target.value as AssetClass })}>
          {(Object.keys(ASSUMPTIONS) as AssetClass[]).map((c) => <option key={c} value={c}>{ASSUMPTIONS[c].label} (~{pct(ASSUMPTIONS[c].ret, 1)}/yr, vol {pct(ASSUMPTIONS[c].vol, 0)})</option>)}</select></Field>
      </div>
      {mc && (
        <div className="card mt" style={{ background: 'var(--bg)' }}>
          <div className="kv"><span>Chance of reaching target (Monte Carlo, 1,000 runs)</span><b>{pct(mc.probability, 0)}</b></div>
          <div className="kv"><span>Monthly saving needed (expected return)</span><b>{money(mc.required)}</b></div>
          <div className="kv"><span>Likely outcome (10th – 90th pct)</span><b>{money(mc.p10, true)} – {money(mc.p90, true)}</b></div>
        </div>
      )}
      <div className="row between mt">
        {g ? <button className="btn danger" onClick={() => { update((d) => ({ ...d, goals: d.goals.filter((y) => y.id !== g.id) })); onClose(); }}><Trash2 size={16} />Delete</button> : <span />}
        <button className="btn primary" disabled={!x.name || !x.target} onClick={() => { update((d) => ({ ...d, goals: g ? d.goals.map((y) => (y.id === x.id ? x : y)) : [...d.goals, x] })); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}
