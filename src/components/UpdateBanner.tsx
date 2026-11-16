import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { newVersionAvailable, reloadToLatest } from '../lib/version';

/** Signed in: when a newer FinPlan is live, offer a one-tap reload (data is already saved and synced). */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const check = () => { if (!document.hidden) newVersionAvailable(5 * 60e3).then((v) => v && setReady(true)); };
    check(); const t = setInterval(check, 30 * 60e3); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!ready) return null;
  return (
    <div className="banner" role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span><b>FinPlan was updated.</b> Reload to get the new version; your data is saved.</span>
      <button className="btn primary sm" onClick={() => { reloadToLatest(); }}><RefreshCw size={14} /> Reload now</button>
    </div>
  );
}
