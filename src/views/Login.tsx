import { useEffect, useState } from 'react';
import { Lock, Plus, KeyRound, ArrowLeft, Copy, ShieldCheck, Monitor, Eye, EyeOff, Cloud } from 'lucide-react';
import { createUser, getDevice, hasLegacyData, listUsers, loadVault, login, passwordProblems, recoverWithCode, saveVault, secondsLocked, type DeviceInfo, type Session, type UserRec } from '../lib/auth';
import * as G from '../lib/gdrive';
import { onClaudeStore } from '../lib/claudeCloud';
import { signOut as signOutCloud } from '../lib/serverCloud';
import { CloudSignIn } from '../components/CloudSignIn';
import * as S from '../lib/sync';
import { setSecretNamespace } from '../lib/secure';
import { Logo } from '../components/ui';
import type { AppData } from '../lib/types';

type Mode = 'pick' | 'password' | 'create' | 'recover' | 'showCode' | 'cloud';

export function Avatar({ u, size = 40 }: { u: Pick<UserRec, 'name' | 'color'>; size?: number }) {
  const ini = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <div style={{ width: size, height: size, borderRadius: '50%', background: u.color, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0 }}>{ini}</div>;
}

function PwInput({ value, onChange, placeholder, autoFocus, onEnter }: { value: string; onChange: (s: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoFocus={autoFocus} autoComplete="current-password"
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} style={{ paddingRight: 40 }} />
      <button type="button" className="btn ghost sm" style={{ position: 'absolute', right: 4, top: 4 }} onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
}

export default function Login({ onSession, lockedUser }: { onSession: (s: Session, migrated: AppData | null) => void; lockedUser?: string }) {
  const [users, setUsers] = useState(listUsers());
  const [mode, setMode] = useState<Mode>(users.length ? (lockedUser || users.length === 1 ? 'password' : 'pick') : 'create');
  const [sel, setSel] = useState<UserRec | undefined>(users.find((u) => u.id === lockedUser) || (users.length === 1 ? users[0] : undefined));
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [pending, setPending] = useState<{ session: Session; migrated: AppData | null; code: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [lock, setLock] = useState(0);
  const [notice] = useState(() => { try { const n = sessionStorage.getItem('finplan.removedNotice'); if (n) sessionStorage.removeItem('finplan.removedNotice'); return n; } catch { return null; } });
  const [, bumpCloud] = useState(0);
  useEffect(() => { getDevice().then(setDevice); const off = onClaudeStore(() => bumpCloud((n) => n + 1)); return () => { off(); }; }, []);
  // ---- use an account from another device (its cloud copy) ----
  const cloudOk = G.driveSyncSupported();
  const [tok, setTok] = useState<G.Token | null>(null);
  const [cloudList, setCloudList] = useState<G.RemoteMeta[] | null>(null);
  const [pickC, setPickC] = useState<G.RemoteMeta | null>(null);
  const [devPw, setDevPw] = useState('');
  const [, rerender] = useState(0);
  const signedIn = !!G.currentToken();
  useEffect(() => { if (!sel) return; const t = setInterval(() => setLock(secondsLocked(sel.id)), 1000); setLock(secondsLocked(sel.id)); return () => clearInterval(t); }, [sel]);

  const go = (m: Mode) => { setMode(m); setErr(''); setPw(''); setPw2(''); setCode(''); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e.message || String(e)); } setBusy(false); };

  const signIn = () => run(async () => { const s = await login(sel!.id, pw); onSession(s, null); });
  const create = () => run(async () => {
    if (!name.trim()) throw new Error('Enter your name');
    if (pw !== pw2) throw new Error('Passwords do not match');
    const r = await createUser(name, email, pw);
    setUsers(listUsers()); setPending({ session: r.session, migrated: r.migrated, code: r.recoveryCode }); go('showCode');
  });
  const recover = () => run(async () => {
    if (pw !== pw2) throw new Error('Passwords do not match');
    const r = await recoverWithCode(sel!.id, code, pw);
    setPending({ session: r.session, migrated: null, code: r.recoveryCode }); go('showCode');
  });
  const strength = pw ? passwordProblems(pw) : null;

  const findAccounts = () => run(async () => {
    let tt: G.Token; try { tt = await G.getToken(true); } catch (e) { rerender((n) => n + 1); throw e; } setTok(tt);
    const all = (await G.listSyncFiles(tt));
    if (!all.length) throw new Error(`No FinPlan account found in ${tt.email || 'this cloud account'}. On the device that has your data: Settings → Sync between devices → turn on, then try again.`);
    setCloudList(all); if (all.length === 1) setPickC(all[0]);
  });
  const cloudName = (m: G.RemoteMeta) => m.accountName || 'FinPlan (older copy)';
  const weakPw = !!pw && !!passwordProblems(pw);
  /** Open the picked account here: same account id and name as on the other device, its data, sync on. */
  const useCloud = () => run(async () => {
    const m = pickC!; const name = m.accountName || (sel?.name ?? 'FinPlan');
    const u = await S.unlockCloud(tok!, m, pw);           // throws on a wrong password
    const local = listUsers().find((x) => (m.user && x.id === m.user)) || listUsers().find((x) => x.name.toLowerCase() === name.toLowerCase());
    let session: Session; let code = '';
    if (local) {
      try { session = await login(local.id, pw); }
      catch { u.raw.fill(0); throw new Error(`This device already has a user “${local.name}” with a different password. Sign in to it here with that password, then Settings → Sync → connect; or delete it first.`); }
    } else {
      const r = await createUser(name, '', weakPw ? devPw : pw, { id: m.user }); session = r.session; code = r.recoveryCode;
    }
    setSecretNamespace(session.user.id, session.key);
    const had = local ? await loadVault(session).catch(() => null) : null;
    if (!had) await saveVault(session, { ...u.data, settings: { ...u.data.settings, name: u.data.settings.name || name } });
    await S.linkCloud(session.user.id, tok!, m, u.file, u.raw, { inSync: !had }); // existing local data → combine on first sync
    setUsers(listUsers());
    if (code) { setPending({ session, migrated: null, code }); go('showCode'); } else onSession(session, null);
  });

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ width: 'min(440px, 100%)', padding: 26 }}>
        <div className="row" style={{ marginBottom: 18 }}><Logo size={36} /><div><div style={{ fontWeight: 800, fontSize: 20 }}>FinPlan</div><div className="small muted">Private, encrypted on this device</div></div></div>
        {notice && <div className="banner small" style={{ padding: 10 }}><ShieldCheck size={18} /><div className="grow">{notice}</div></div>}

        {mode === 'pick' && (<>
          <h2>Who's signing in?</h2>
          {users.map((u) => (
            <button key={u.id} className="item btn ghost" style={{ width: '100%', justifyContent: 'flex-start', border: '1px solid var(--line)', marginBottom: 8, padding: 10 }} onClick={() => { setSel(u); go('password'); }}>
              <Avatar u={u} /><div style={{ textAlign: 'left' }}><div style={{ fontWeight: 700 }}>{u.name}</div><div className="small muted">{u.email || (u.lastLogin ? `Last sign-in ${new Date(u.lastLogin).toLocaleDateString()}` : '')}</div></div>
            </button>
          ))}
          <button className="btn" style={{ width: '100%' }} onClick={() => go('create')}><Plus size={16} /> Add another user</button>
          {cloudOk && <button className="btn ghost mt-s" style={{ width: '100%' }} onClick={() => go('cloud')}><Cloud size={16} /> Use my account from another device</button>}
        </>)}

        {mode === 'password' && sel && (<>
          <div className="row" style={{ marginBottom: 14 }}><Avatar u={sel} size={46} /><div><div style={{ fontWeight: 700, fontSize: 17 }}>{sel.name}</div><div className="small muted">{lockedUser ? 'FinPlan locked. Enter your password' : 'Enter your password'}</div></div></div>
          <PwInput value={pw} onChange={setPw} placeholder="Password" autoFocus onEnter={() => !busy && !lock && pw && signIn()} />
          {err && <div className="small neg mt-s">{err}</div>}
          <button className="btn primary mt" style={{ width: '100%' }} disabled={busy || !pw || lock > 0} onClick={signIn}><Lock size={16} /> {busy ? 'Unlocking…' : lock ? `Locked (${lock}s)` : 'Sign in'}</button>
          <div className="row between mt small">
            <a href="#" onClick={(e) => { e.preventDefault(); go('recover'); }}>Forgot password?</a>
            {users.length > 1 ? <a href="#" onClick={(e) => { e.preventDefault(); go('pick'); }}>Switch user</a> : <a href="#" onClick={(e) => { e.preventDefault(); go('pick'); }}>Other account</a>}
          </div>
        </>)}

        {mode === 'create' && (<>
          <h2>{users.length ? 'Add a user' : 'Create your account'}</h2>
          {!users.length && hasLegacyData() && <div className="banner small" style={{ padding: 10 }}><ShieldCheck size={18} color="var(--brand)" /><div>Your existing FinPlan data on this device will be moved into this account and encrypted.</div></div>}
          <div className="form" style={{ gridTemplateColumns: '1fr' }}>
            <label className="field">Name<input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anthony" /></label>
            <label className="field">Email (optional, label only)<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">Password<PwInput value={pw} onChange={setPw} placeholder="10+ characters, e.g. a short sentence" /></label>
            {pw && <div className={`small ${strength ? 'neg' : 'pos'}`} style={{ marginTop: -6 }}>{strength || 'Strong enough ✓'}</div>}
            <label className="field">Confirm password<PwInput value={pw2} onChange={setPw2} onEnter={() => !busy && create()} /></label>
          </div>
          {err && <div className="small neg mt-s">{err}</div>}
          <button className="btn primary mt" style={{ width: '100%' }} disabled={busy} onClick={create}>{busy ? 'Creating & encrypting…' : 'Create account'}</button>
          {users.length > 0 && <button className="btn ghost mt-s" style={{ width: '100%' }} onClick={() => go(users.length > 1 ? 'pick' : 'password')}><ArrowLeft size={16} /> Back to sign in</button>}
          <p className="small muted mt">Your password encrypts your data. FinPlan has no server, so nobody can reset it for you. You'll get a <b>recovery code</b> next; keep it safe.</p>
          {cloudOk && <div className="banner small mt" style={{ padding: 10, marginBottom: 0 }}><Cloud size={18} color="var(--brand)" /><div className="grow">Already use FinPlan on your computer? Don't create a new account here.</div><button className="btn sm" onClick={() => go('cloud')}>Use my account</button></div>}
        </>)}

        {mode === 'cloud' && (<>
          <h2>Use my account from another device</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Opens the same FinPlan account (e.g. the one on your computer) with its data, and keeps both in sync through {G.cloudLabel()}. Each account only sees its own data. Needs sync turned on there first (Settings → Sync between devices).{G.usingClaude() ? ' Both devices must use FinPlan in Claude, signed in to the same Claude account.' : ''}</p>
          {!G.usingClaude() && !signedIn ? (
            <CloudSignIn intro={<p className="small" style={{ marginTop: 0 }}>Sign in with the <b>FinPlan Cloud</b> email and password you used on your computer.</p>} onDone={() => { rerender((n) => n + 1); findAccounts(); }} />
          ) : !cloudList ? (<>
            {!G.usingClaude() && <div className="small muted" style={{ marginBottom: 6 }}>Signed in to FinPlan Cloud as <b>{G.currentToken()?.email}</b> · <a href="#" onClick={async (e) => { e.preventDefault(); await signOutCloud(); rerender((n) => n + 1); }}>use another email</a></div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={findAccounts}><Cloud size={16} /> {busy ? 'Looking…' : 'Find my accounts'}</button>
          </>) : (<>
            <div className="small muted" style={{ marginBottom: 6 }}>Accounts in {tok?.email || 'your cloud'}:</div>
            {cloudList.map((c) => (
              <button key={c.id} className={`item btn ghost ${pickC?.id === c.id ? 'active' : ''}`} style={{ width: '100%', justifyContent: 'flex-start', border: `1px solid ${pickC?.id === c.id ? 'var(--brand)' : 'var(--line)'}`, marginBottom: 8, padding: 10 }} onClick={() => { setPickC(c); setErr(''); }}>
                <Avatar u={{ name: cloudName(c), color: '#0f766e' }} /><div style={{ textAlign: 'left' }}><div style={{ fontWeight: 700 }}>{cloudName(c)}</div><div className="small muted">last saved by {c.device || 'another device'} · {new Date(c.modifiedTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
              </button>))}
            {pickC && (<>
              <label className="field">Password of {cloudName(pickC)}<PwInput value={pw} onChange={setPw} placeholder="The sync password you chose on your computer" autoFocus onEnter={() => !busy && pw && !weakPw && useCloud()} /></label>
              {weakPw && <label className="field">Choose a sign-in password for this device<PwInput value={devPw} onChange={setDevPw} placeholder="10+ characters" /></label>}
              {weakPw && devPw && passwordProblems(devPw) && <div className="small neg">{passwordProblems(devPw)}</div>}
              <button className="btn primary mt" style={{ width: '100%' }} disabled={busy || !pw || (weakPw && (!devPw || !!passwordProblems(devPw)))} onClick={useCloud}><Lock size={16} /> {busy ? 'Opening your account…' : `Open ${cloudName(pickC)} here`}</button>
            </>)}
          </>)}
          {err && <div className="small neg mt-s">{err}</div>}
          <button className="btn ghost mt-s" style={{ width: '100%' }} onClick={() => { setCloudList(null); setPickC(null); go(users.length ? (users.length > 1 ? 'pick' : 'password') : 'create'); }}><ArrowLeft size={16} /> Back</button>
          {(G.usingClaude() || signedIn) && <p className="small muted mt">Your password never leaves this device; {G.cloudLabel()} only stores the encrypted copy.</p>}
        </>)}

        {mode === 'recover' && sel && (<>
          <h2>Reset password</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Enter the recovery code you saved when <b>{sel.name}</b>'s account was created.</p>
          <div className="form" style={{ gridTemplateColumns: '1fr' }}>
            <label className="field">Recovery code<input className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" style={{ fontFamily: 'monospace' }} /></label>
            <label className="field">New password<PwInput value={pw} onChange={setPw} /></label>
            {pw && strength && <div className="small neg" style={{ marginTop: -6 }}>{strength}</div>}
            <label className="field">Confirm new password<PwInput value={pw2} onChange={setPw2} onEnter={() => !busy && recover()} /></label>
          </div>
          {err && <div className="small neg mt-s">{err}</div>}
          <button className="btn primary mt" style={{ width: '100%' }} disabled={busy || !code || !pw} onClick={recover}><KeyRound size={16} /> {busy ? 'Checking…' : 'Reset password'}</button>
          <button className="btn ghost mt-s" style={{ width: '100%' }} onClick={() => go('password')}><ArrowLeft size={16} /> Back</button>
        </>)}

        {mode === 'showCode' && pending && (<>
          <h2>Save your recovery code</h2>
          <p className="small muted" style={{ marginTop: 0 }}>This is the <b>only</b> way back in if you forget your password. Write it down or store it in a password manager. It won't be shown again.</p>
          <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, letterSpacing: 1, textAlign: 'center', padding: 16, background: 'var(--bg)', borderRadius: 10, border: '1px dashed var(--line)', wordBreak: 'break-all' }}>{pending.code}</div>
          <button className="btn mt-s" style={{ width: '100%' }} onClick={() => { navigator.clipboard?.writeText(pending.code).catch(() => {}); }}><Copy size={16} /> Copy</button>
          <label className="row small mt"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery code somewhere safe</label>
          <button className="btn primary mt" style={{ width: '100%' }} disabled={!saved} onClick={() => onSession(pending.session, pending.migrated)}>Continue to FinPlan</button>
        </>)}

        {device && (
          <div className="small muted mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Monitor size={14} /> <span>Browser ID <b style={{ fontFamily: 'monospace' }}>{device.short}</b> · {device.platform === 'Web browser' ? `${device.browser} on ${device.os}` : `${device.platform} · ${device.os}`}</span>
          </div>
        )}
      </div>
    </div>
  );
}
