import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { AppData } from '../lib/types';
import { findDemo, removeDemo } from '../lib/demo';
import { money } from '../lib/format';
import { toast } from './ui';

/** Shown when the sample ("demo") data is mixed with real data: it changes net worth, so offer to remove it. */
export function DemoBanner({ data, update, force }: { data: AppData; update: (fn: (d: AppData) => AppData) => void; force?: boolean }) {
  const [arm, setArm] = useState(false);
  const f = findDemo(data);
  if (!f.total || (data.settings.keepDemo && !force)) return null;
  const debt = f.accounts.filter((a) => a.kind === 'debt').reduce((s, a) => s + a.balance, 0);
  const assets = f.accounts.filter((a) => a.kind !== 'debt').reduce((s, a) => s + a.balance, 0);
  const names = f.accounts.map((a) => a.name).slice(0, 5).join(', ');
  return (
    <div className="banner demo-banner mt-s" role="status">
      <FlaskConical size={20} color="var(--warn)" />
      <div className="grow small">
        <b>Sample data is mixed in with your accounts.</b> {names}{f.accounts.length > 5 ? '…' : ''}{f.holdings ? ` + ${f.holdings} sample positions` : ''}{f.txns ? `, ${f.txns} sample transactions` : ''}.{' '}
        <span className="muted">It adds {money(assets, true)} of assets and {money(debt, true)} of debt to your net worth.</span>
      </div>
      <button className="btn sm danger" onClick={() => { if (!arm) { setArm(true); setTimeout(() => setArm(false), 4000); return; } update(removeDemo); toast('Sample data removed: totals now show only your data'); }}>{arm ? 'Tap again to remove' : 'Remove sample data'}</button>
      {!force && <button className="btn sm ghost" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, keepDemo: true } }))}>Keep</button>}
    </div>
  );
}
