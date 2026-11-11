import { useEffect, useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import * as Srv from '../lib/serverCloud';
import { toast } from './ui';

/** Email + password sign-in to FinPlan Cloud (the website's sync server). */
export function CloudSignIn({ onDone, intro }: { onDone: (email: string) => void; intro?: React.ReactNode }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState(Srv.session()?.email || Srv.lastEmail());
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [canSignUp, setCanSignUp] = useState<boolean | null>(null);
  useEffect(() => { Srv.health().then((h) => setCanSignUp(h ? !!h.signup : null)); }, []);

  const go = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { toast('Enter your email address'); return; }
    if (mode === 'up') {
      if (pw.length < 10) { toast('Use at least 10 characters for the password'); return; }
      if (pw !== pw2) { toast('The two passwords are different'); return; }
    } else if (!pw) return;
    setBusy(true);
    try { const e = await Srv.signIn(email, pw, mode === 'up'); toast(mode === 'up' ? 'FinPlan Cloud account created' : 'Signed in'); onDone(e); }
    catch (e: any) { toast(e?.message || 'Sign-in failed'); }
    setBusy(false);
  };

  return (
    <div>
      {intro}
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
        <button className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
      </div>
      <label className="field">Email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label className="field">Password<input className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mode === 'in' && go()} /></label>
      {mode === 'up' && <label className="field">Repeat password<input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>}
      {mode === 'up' && canSignUp === false && <p className="small" style={{ color: 'var(--warn, #b45309)' }}>New accounts are closed on this server (the owner already signed up). Sign in instead.</p>}
      <button className="btn primary mt-s" style={{ width: '100%' }} disabled={busy || !email || !pw} onClick={go}>
        {mode === 'up' ? <UserPlus size={16} /> : <LogIn size={16} />} {busy ? 'Please wait…' : mode === 'up' ? 'Create account' : 'Sign in'}
      </button>
      <p className="small muted" style={{ marginBottom: 0 }}>Your password never leaves this device in readable form, and your FinPlan data is encrypted on this device before upload: FinPlan Cloud only stores ciphertext.</p>
    </div>
  );
}
