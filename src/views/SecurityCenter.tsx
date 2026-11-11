import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import type { AppData } from '../lib/types';
import { autoLockMinutes, KDF_ITER, loginHistory, type Session } from '../lib/auth';
import { platform } from '../lib/net';
import { Card, ScoreRing, toast } from '../components/ui';

type Check = { label: string; ok: boolean | null; detail: string; action?: { label: string; run: () => void } };

export default function SecurityCenter({ data, session, onPrivacy, onBackup }: { data: AppData; session: Session; onPrivacy: (v: boolean) => void; onBackup: () => void }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage || 0) / 1e6).toFixed(1)} MB used`)).catch(() => {});
  }, []);
  const plat = platform();
  const secure = plat !== 'web' || (window.isSecureContext && location.protocol === 'https:');
  const cspMeta = !!document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
  const lock = autoLockMinutes();
  const lastBackup = data.settings.lastBackupAt ? (Date.now() - new Date(data.settings.lastBackupAt).getTime()) / 864e5 : Infinity;
  const recentFails = loginHistory().filter((h) => h.userId === session.user.id && !h.ok && Date.now() - new Date(h.at).getTime() < 7 * 864e5).length;

  const checks: Check[] = [
    { label: 'Data encrypted at rest', ok: true, detail: `AES-256-GCM vault · key from your password via PBKDF2-SHA256 × ${(session.user.iter || KDF_ITER).toLocaleString()} · key is non-extractable in memory` },
    { label: 'API keys & tokens encrypted', ok: true, detail: plat === 'desktop' ? 'Encrypted with your vault key and the OS keychain' : 'Encrypted with your vault key; never in backups, never sent via proxies' },
    { label: 'Secure connection (HTTPS)', ok: secure, detail: secure ? (plat === 'web' ? 'Served over HTTPS' : 'Running as an installed app') : 'Host FinPlan on HTTPS only. Web crypto and installs require it' },
    { label: 'Content Security Policy', ok: plat !== 'web' ? true : cspMeta ? true : null, detail: plat !== 'web' ? 'App shell is sandboxed' : cspMeta ? 'Strict CSP active: only FinPlan code and approved APIs can run' : 'Use the web build (npm run build:web), which adds a strict CSP' },
    { label: 'Not embedded in another site', ok: !framed, detail: framed ? 'Running inside a frame (fine for previews; your hosted copy blocks framing)' : 'Clickjacking protection OK' },
    { label: 'Auto-lock', ok: lock > 0 && lock <= 15, detail: lock ? `Locks after ${lock} min idle or in the background` : 'Disabled. Turn it on in Account below' },
    { label: 'Storage protected from eviction', ok: plat !== 'web' ? true : persisted, detail: plat !== 'web' ? 'App storage' : persisted ? `Browser won't auto-delete your data${usage ? ' · ' + usage : ''}` : 'The browser may clear site data when disk is low',
      action: plat === 'web' && !persisted ? { label: 'Protect storage', run: () => navigator.storage?.persist?.().then((v) => { setPersisted(v); toast(v ? 'Storage protected' : 'Browser declined. Install the app (PWA) or bookmark it to qualify'); }) } : undefined },
    { label: 'Recent encrypted backup', ok: lastBackup <= 30, detail: isFinite(lastBackup) ? `Last backup ${Math.floor(lastBackup)} day(s) ago` : 'No backup yet. If this browser is wiped, data is gone', action: lastBackup > 30 ? { label: 'Back up now', run: onBackup } : undefined },
    { label: 'Privacy mode (no public proxies)', ok: !!data.settings.privacyNoProxy, detail: data.settings.privacyNoProxy ? 'News/prices never go through third-party relays (some web news feeds may not load)' : 'On the web, public news feeds may be fetched via CORS relays (no personal data or keys)',
      action: { label: data.settings.privacyNoProxy ? 'Turn off' : 'Turn on', run: () => onPrivacy(!data.settings.privacyNoProxy) } },
    { label: 'Sign-in attempts', ok: recentFails === 0, detail: recentFails ? `${recentFails} failed sign-in attempt(s) in the last 7 days. Check the history below` : 'No failed attempts in the last 7 days' },
  ];
  const scored = checks.filter((c) => c.ok !== null);
  const score = Math.round((scored.filter((c) => c.ok).length / scored.length) * 100);

  return (
    <Card title={<span><Shield size={16} style={{ verticalAlign: -3 }} /> Security center</span>} action={<span className="small muted">Read-only connections · no trade or withdraw permissions requested</span>}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <ScoreRing score={score} />
        <div style={{ flex: 1, minWidth: 260 }}>
          {checks.map((c) => (
            <div key={c.label} className="kv" style={{ alignItems: 'center' }}>
              <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                {c.ok ? <ShieldCheck size={16} color="var(--good)" /> : c.ok === false ? <ShieldAlert size={16} color="var(--warn)" /> : <Shield size={16} color="var(--muted)" />}
                <span><b style={{ fontWeight: 600 }}>{c.label}</b><div className="small muted">{c.detail}</div></span>
              </span>
              {c.action && <button className="btn sm" onClick={c.action.run}>{c.action.label}</button>}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
