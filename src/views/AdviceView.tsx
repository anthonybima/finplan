import { useMemo, useState } from 'react';
import type { ViewProps, Page } from '../App';
import { generateAdvice, type Level } from '../lib/advice';
import { AdviceList, Card, Seg } from '../components/ui';

const ROUTE: Record<string, Page> = { Data: 'txns', Budget: 'plan', Goals: 'plan', Risk: 'risk', Investing: 'risk', Debt: 'risk', Routine: 'weekly', Spending: 'analyst', 'Cash flow': 'plan', Protection: 'risk' };

export default function AdviceView({ data, go }: ViewProps) {
  const all = useMemo(() => generateAdvice(data), [data]);
  const [f, setF] = useState<'all' | Level>('all');
  const list = f === 'all' ? all : all.filter((a) => a.level === f);
  const count = (l: Level) => all.filter((a) => a.level === l).length;
  return (
    <>
      <div className="page-head"><div><h1>Advice</h1><div className="sub">Personal recommendations recalculated from your latest data</div></div>
        <Seg value={f} onChange={setF} options={[{ v: 'all', l: `All ${all.length}` }, { v: 'critical', l: `Urgent ${count('critical')}` }, { v: 'warning', l: `Warnings ${count('warning')}` }, { v: 'tip', l: `Tips ${count('tip')}` }, { v: 'good', l: `Good ${count('good')}` }]} />
      </div>
      <Card><AdviceList items={list} onAction={(a) => ROUTE[a.area] && go(ROUTE[a.area])} /></Card>
      <p className="small muted mt">FinPlan's advice is educational and rule-based, built on common financial-planning guidelines. It is not a licensed financial advisor's recommendation; for major decisions (insurance, large investments, tax) consider a certified planner (e.g. CFP®).</p>
    </>
  );
}
