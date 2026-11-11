import { Sparkles, ShieldCheck, Newspaper, CalendarCheck, LineChart, Target } from 'lucide-react';
import type { AppData } from '../lib/types';
import { emptyData } from '../lib/store';
import { RestoreBackupButton } from '../components/Backup';
import { demoData } from '../lib/demo';
import { Logo } from '../components/ui';

export default function Welcome({ onStart, extra }: { onStart: (d: AppData) => void; extra?: React.ReactNode }) {
  const feats = [
    { i: Target, t: 'Plan', d: 'Budgets, 50/30/20, goals with success odds' },
    { i: LineChart, t: 'Analyst', d: 'Trends, forecasts, unusual spending' },
    { i: ShieldCheck, t: 'Risk', d: 'Health score, VaR, stress tests, risk profile' },
    { i: Sparkles, t: 'Advice', d: 'Personal, rule-based recommendations' },
    { i: Newspaper, t: 'News', d: 'Market & economy headlines, tagged by impact' },
    { i: CalendarCheck, t: 'Weekly', d: '10-minute guided weekly update' },
  ];
  return (
    <div className="welcome" style={{ padding: 16 }}>
      <Logo size={64} />
      <h1 style={{ fontSize: 30, marginTop: 14 }}>FinPlan</h1>
      <p className="muted">Your personal financial planner, analyst and risk manager. Data stays on this device.</p>
      <div className="feat">
        {feats.map((f) => (
          <div key={f.t} className="card" style={{ padding: 14 }}>
            <f.i size={20} color="var(--brand)" />
            <div style={{ fontWeight: 700, marginTop: 6 }}>{f.t}</div>
            <div className="small muted">{f.d}</div>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => onStart(emptyData())}>Start fresh</button>
        <button className="btn" onClick={() => onStart(demoData())}><Sparkles size={16} /> Explore with demo data</button>
        <RestoreBackupButton onRestore={onStart} />
        {extra}
      </div>
    </div>
  );
}
