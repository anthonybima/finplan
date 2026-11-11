import React, { useCallback, useEffect, useRef, useState } from 'react';
import App from './App';
import Login from './views/Login';
import { autoLockMinutes, clearVault, listUsers, loadVault, saveVault, type Session } from './lib/auth';
import { adoptLegacySecrets, setSecretNamespace } from './lib/secure';
import type { AppData } from './lib/types';
import { ToastHost } from './components/ui';
import { useViewMode } from './lib/viewMode';
import { Monitor, Smartphone } from 'lucide-react';

/** Sign-in → decrypt the user's vault → app. Locks on idle and on demand; key lives only in memory. */
export default function AuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [initial, setInitial] = useState<AppData | null | undefined>(undefined);
  const [locked, setLocked] = useState<string | undefined>();
  const [error, setError] = useState('');
  const saveTimer = useRef<number>();
  const pending = useRef<AppData | null | undefined>(undefined);
  const latest = useRef<AppData | null | undefined>(undefined);

  const onSession = useCallback(async (s: Session, migrated: AppData | null) => {
    setSecretNamespace(s.user.id, s.key);
    try {
      if (migrated) await adoptLegacySecrets(s.user.id);
      const d = migrated ?? (await loadVault(s));
      latest.current = d; setInitial(d); setSession(s); setLocked(undefined); setError('');
    } catch { setError('Could not decrypt your data on this device.'); }
  }, []);

  const flush = useCallback(async () => {
    if (!session || pending.current === undefined) return;
    const d = pending.current; pending.current = undefined;
    if (!listUsers().some((u) => u.id === session.user.id)) return; // account was deleted
    if (d === null) clearVault(session); else await saveVault(session, d);
  }, [session]);

  // Debounced encrypted save
  const persist = useCallback((d: AppData | null) => {
    pending.current = d; latest.current = d;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 400);
  }, [flush]);

  const lock = useCallback(async (signOut = false) => {
    window.clearTimeout(saveTimer.current); await flush();
    setLocked(signOut ? undefined : session?.user.id);
    setSession(null); setInitial(undefined); latest.current = undefined; setSecretNamespace('');
  }, [flush, session]);

  // Save before the window closes
  useEffect(() => { const h = () => { flush(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [flush]);

  // Auto-lock after inactivity
  useEffect(() => {
    if (!session) return;
    const mins = autoLockMinutes(); if (!mins) return;
    let t = window.setTimeout(() => lock(), mins * 60_000);
    const reset = () => { window.clearTimeout(t); t = window.setTimeout(() => lock(), mins * 60_000); };
    const ev = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    // Background tabs throttle timers: also check elapsed time when the app comes back.
    let hiddenAt = 0;
    const vis = () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > mins * 60_000) lock(); else reset(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, reset)); document.removeEventListener('visibilitychange', vis); };
  }, [session, lock]);

  const content = !session || initial === undefined
    ? <>{error && <div className="banner" style={{ margin: 16, background: 'var(--bad-soft)' }}>{error}</div>}<Login onSession={onSession} lockedUser={locked} /><ToastHost /></>
    : <App key={session.user.id} session={session} initial={latest.current !== undefined ? latest.current : initial} persist={persist} onLock={() => lock()} onSignOut={() => lock(true)} />;
  return <PhoneFrame>{content}</PhoneFrame>;
}

/** Phone view: the whole app inside a 390×844 frame; container queries switch it to the mobile layout. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useViewMode();
  const [wide, setWide] = useState(() => window.innerWidth > 520);
  useEffect(() => { const r = () => setWide(window.innerWidth > 520); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  const on = mode === 'phone' && wide;
  // The element tree is IDENTICAL in both modes (only classes change), so React never remounts the app.
  return (
    <div className={on ? 'phone-stage' : 'pf-off'}>
      {wide && <button className={`view-toggle ${on ? 'static' : ''}`} onClick={() => setMode(on ? 'auto' : 'phone')} title={on ? 'Back to the full layout' : 'Show the mobile layout'}>
        {on ? <><Monitor size={15} /> Desktop view</> : <><Smartphone size={15} /> Phone view</>}</button>}
      <div className={on ? 'phone-frame' : 'pf-off'}>
        {on && <div className="phone-notch" />}
        <div className={on ? 'phone-scroll' : 'pf-off'}>{children}</div>
      </div>
    </div>
  );
}
