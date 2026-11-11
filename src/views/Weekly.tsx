import { useMemo, useState } from 'react';
import { Check, FileUp, Plus, ScanLine, Upload } from 'lucide-react';
import type { ViewProps } from '../App';
import type { Account } from '../lib/types';
import { balances, budgetStatus, lastNDays } from '../lib/analytics';
import { generateAdvice } from '../lib/advice';
import { healthMetrics } from '../lib/risk';
import { fmtDate, money, pct, today } from '../lib/format';
import { AdviceList, Card, MoneyInput, Progress, toast } from '../components/ui';
import { ImportModal, TxnModal } from './Transactions';
import SmartScan from '../components/SmartScan';
import { KIND_LABEL } from './Wealth';

const STEPS = ['Update balances', 'Add transactions', 'Review budgets', 'Summary'];

export default function Weekly({ data, update, go, openImport }: ViewProps) {
  const [step, setStep] = useState(0);
  const [bal, setBal] = useState<Record<string, number>>(() => Object.fromEntries(data.accounts.map((a) => [a.id, a.balance])));
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const week = lastNDays(data.txns, 7);
  const weekTxns = data.txns.filter((t) => t.date >= week.from).sort((a, b) => b.date.localeCompare(a.date));

  const saveBalances = () => {
    update((d) => ({ ...d, accounts: d.accounts.map((a) => (bal[a.id] !== undefined && bal[a.id] !== a.balance ? { ...a, balance: bal[a.id], updatedAt: today() } : a)) }));
    setStep(1);
  };
  const finish = () => {
    update((d) => {
      const b = balances(d.accounts);
      const w = lastNDays(d.txns, 7);
      const snap = { date: today(), netWorth: b.netWorth, assets: b.assets, liabilities: b.liabilities, liquid: b.liquid, weekIncome: w.income, weekExpense: w.expense, note };
      return { ...d, snapshots: [...d.snapshots.filter((s) => s.date !== snap.date), snap], settings: { ...d.settings, lastWeeklyReview: new Date().toISOString() } };
    });
    toast('Weekly review saved ✓'); go('home');
  };

  const b = balances(data.accounts);
  const prevSnap = data.snapshots[data.snapshots.length - 1];
  const advice = useMemo(() => generateAdvice(data).filter((a) => a.level === 'critical' || a.level === 'warning').slice(0, 4), [data]);
  const h = useMemo(() => healthMetrics(data), [data]);

  return (
    <>
      <div className="page-head"><div><h1>Weekly review</h1>
        <div className="sub">Last review: {data.settings.lastWeeklyReview ? fmtDate(data.settings.lastWeeklyReview.slice(0, 10)) : 'never'} · about 10 minutes</div></div></div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`s ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)} style={{ cursor: i < step ? 'pointer' : undefined }}>
            <span className="num">{i < step ? <Check size={13} /> : i + 1}</span>{s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card title="1 · Update each balance from your banking & investment apps" action={<div className="row"><button className="btn sm" onClick={() => openImport?.('auto')}><Upload size={14} /> Import data</button><button className="btn sm" onClick={() => setScanning(true)}><ScanLine size={14} /> Smart scan portfolio</button>{data.holdings.length || Object.keys(data.settings.connections).length ? <button className="btn sm" onClick={() => go('connections')}>Sync connected apps →</button> : null}</div>}>
          {data.accounts.length ? data.accounts.filter((a) => !a.synced).map((a: Account) => (
            <div key={a.id} className="item">
              <div className="grow"><div className="title">{a.name}</div><div className="small muted">{KIND_LABEL[a.kind]} · was {money(a.balance)} on {fmtDate(a.updatedAt)}</div></div>
              <div style={{ width: 180 }}><MoneyInput value={bal[a.id] ?? 0} onChange={(n) => setBal({ ...bal, [a.id]: n })} /></div>
            </div>
          )) : <div className="empty">No accounts yet. <a href="#" onClick={(e) => { e.preventDefault(); go('wealth'); }}>Add accounts</a> first.</div>}
          <div className="row between mt"><span className="small muted">Open each app (m-banking, e-wallet, broker, fund app) and copy the current value.</span>
            <button className="btn primary" onClick={saveBalances}>Save & continue</button></div>
        </Card>
      )}

      {step === 1 && (
        <Card title="2 · Bring in this week's transactions" action={<div className="row">
          <button className="btn sm" onClick={() => setImporting(true)}><FileUp size={14} /> Import file</button>
          <button className="btn sm" onClick={() => setAdding(true)}><Plus size={14} /> Add manually</button></div>}>
          <div className="row small" style={{ marginBottom: 8 }}><span className="pill good">In {money(week.income)}</span><span className="pill bad">Out {money(week.expense)}</span><span className="muted">since {fmtDate(week.from)}</span></div>
          {weekTxns.slice(0, 25).map((t) => (
            <div key={t.id} className="item"><div className="grow"><div className="title">{t.note || t.category}</div><div className="small muted">{fmtDate(t.date)} · {t.category}</div></div>
              <div className={`amt ${t.type === 'income' ? 'pos' : ''}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</div></div>
          ))}
          {!weekTxns.length && <div className="empty">Nothing recorded in the last 7 days yet. Import your statement or add cash spending.</div>}
          <div className="row between mt"><button className="btn" onClick={() => setStep(0)}>Back</button><button className="btn primary" onClick={() => setStep(2)}>Continue</button></div>
        </Card>
      )}

      {step === 2 && (
        <Card title="3 · How are your budgets doing this month?">
          {budgetStatus(data).map((s) => (
            <div key={s.category} style={{ marginBottom: 12 }}>
              <div className="row between small"><b>{s.category}</b><span className={s.projected > s.limit ? 'neg' : 'muted'}>{money(s.spent)} / {money(s.limit)} · projected {money(s.projected)}</span></div>
              <Progress value={s.pct} />
            </div>
          ))}
          {!data.budgets.length && <div className="empty">No budgets set. You can create them in Plan & Goals.</div>}
          <h3 className="mt">Needs attention</h3>
          <AdviceList items={advice} />
          <div className="row between mt"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn primary" onClick={() => setStep(3)}>Continue</button></div>
        </Card>
      )}

      {step === 3 && (
        <Card title="4 · Weekly summary">
          <div className="grid g2">
            <div>
              <div className="kv"><span>Net worth</span><b>{money(b.netWorth)}</b></div>
              {prevSnap && <div className="kv"><span>Change since {fmtDate(prevSnap.date)}</span><b className={b.netWorth >= prevSnap.netWorth ? 'pos' : 'neg'}>{b.netWorth >= prevSnap.netWorth ? '+' : ''}{money(b.netWorth - prevSnap.netWorth)}</b></div>}
              <div className="kv"><span>This week in / out</span><b>{money(week.income)} / {money(week.expense)}</b></div>
              <div className="kv"><span>Liquid cash</span><b>{money(b.liquid)}</b></div>
              <div className="kv"><span>Health score</span><b>{h.score} / 100</b></div>
              <div className="kv"><span>Savings rate (3-mo avg)</span><b>{pct(h.avg.savingsRate, 0)}</b></div>
            </div>
            <div>
              <label className="field">Note for this week (optional)
                <textarea className="input" rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid insurance annual premium; plan to cut food delivery next week." /></label>
            </div>
          </div>
          <div className="row between mt"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn primary" onClick={finish}><Check size={16} /> Finish review</button></div>
        </Card>
      )}

      {data.snapshots.length > 0 && (
        <Card title="Review history" className="mt">
          <div className="scroll-x"><table><thead><tr><th>Date</th><th className="r">Net worth</th><th className="r">Liquid</th><th className="r">Debt</th><th>Note</th></tr></thead>
            <tbody>{[...data.snapshots].reverse().slice(0, 12).map((s) => <tr key={s.date}><td>{fmtDate(s.date)}</td><td className="r">{money(s.netWorth)}</td><td className="r">{money(s.liquid)}</td><td className="r">{money(s.liabilities)}</td><td className="small muted">{s.note}</td></tr>)}</tbody></table></div>
        </Card>
      )}
      {scanning && <SmartScan data={data} update={update} onClose={() => setScanning(false)} />}
      {importing && <ImportModal data={data} update={update} onClose={() => setImporting(false)} />}
      {adding && <TxnModal data={data} update={update} onClose={() => setAdding(false)} />}
    </>
  );
}
