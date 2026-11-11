import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Link2, Unlink, Trash2, KeyRound, ExternalLink } from 'lucide-react';
import type { AppData } from '../lib/types';
import { Card, Modal, Field, toast } from './ui';
import * as G from '../lib/gdrive';
import { onClaudeStore } from '../lib/claudeCloud';
import * as S from '../lib/sync';
import { getDevice } from '../lib/auth';

type Phase = 'unsupported' | 'off' | 'idle' | 'syncing' | 'needs-auth' | 'error';
interface Ctl {
  phase: Phase; state: S.SyncState; device: string;
  syncNow: (interactive: boolean) => Promise<void>;
  openSetup: () => void;
  disconnect: (deleteCloud: boolean) => Promise<void>;
}
const SyncCtx = createContext<Ctl | null>(null);
export const useSync = () => useContext(SyncCtx);

const ago = (iso?: string) => {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

/** App-level sync controller: pulls on open/foreground, pushes ~4 s after changes, asks on conflicts. */
export function SyncProvider({ uid, name = 'FinPlan', data, setData, children }: { uid: string; name?: string; data: AppData | null; setData: (d: AppData) => void; children: React.ReactNode }) {
  const [, bumpCloud] = useState(0);
  useEffect(() => { const off = onClaudeStore(() => bumpCloud((n) => n + 1)); return () => { off(); }; }, []);
  const supported = G.driveSyncSupported();
  const [state, setState] = useState<S.SyncState>(() => S.loadState(uid));
  const [phase, setPhase] = useState<Phase>(() => (!supported ? 'unsupported' : S.loadState(uid).enabled ? 'idle' : 'off'));
  const [device, setDevice] = useState('This device');
  const [setup, setSetup] = useState(false);
  const [conflict, setConflict] = useState<null | { remoteDevice: string; remoteAt: string; resolve: (c: 'cloud' | 'device' | 'merge') => void }>(null);
  const dataRef = useRef(data); dataRef.current = data;
  const applying = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<number>();
  const lastCheck = useRef(0);
  const prevData = useRef<AppData | null>(data);
  const changedWhileRunning = useRef(false); // a local change made during a sync round must still be pushed afterwards

  useEffect(() => { getDevice().then((d) => setDevice(d.name || `${d.browser} on ${d.os}`)).catch(() => {}); G.consumeRedirectResult(); }, []);

  const onConflict: S.Conflict = (info) => new Promise((resolve) => setConflict({ ...info, resolve: (c) => { setConflict(null); resolve(c); } }));

  const syncNow = useCallback(async (interactive: boolean) => {
    if (!supported || !S.loadState(uid).enabled || !dataRef.current) return;
    if (running.current) return running.current;
    const run = (async () => {
      setPhase('syncing'); lastCheck.current = Date.now();
      try {
        const r = await S.syncOnce(uid, dataRef.current!, device, interactive, onConflict, name);
        if (r.data) { applying.current = true; setData(r.data); if (r.action === 'pulled') toast('Updated from your other device'); }
        setState(r.state); setPhase('idle');
      } catch (e: any) {
        const st = { ...S.loadState(uid), lastError: e?.message || String(e) }; S.saveState(uid, st); setState(st);
        setPhase(e instanceof G.NeedsSignIn ? 'needs-auth' : 'error');
      } finally {
        running.current = null;
        if (changedWhileRunning.current) { // the round saved its state as clean: mark the newer local change and push it
          changedWhileRunning.current = false; S.markDirty(uid); setState(S.loadState(uid));
          clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (G.currentToken()) syncNow(false); }, 1500);
        }
      }
    })();
    running.current = run; return run;
  }, [uid, name, device, supported]);

  // inside Claude, storage becomes available a moment after start: leave the 'unsupported' state then
  useEffect(() => { if (supported && phase === 'unsupported') setPhase(S.loadState(uid).enabled ? 'idle' : 'off'); }, [supported]);

  // pull when opened (silently, if a Google token is still valid) and when the app comes back to the foreground
  useEffect(() => {
    if (!supported || !state.enabled || !data) return;
    if (G.currentToken()) syncNow(false); else setPhase('needs-auth');
    const vis = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 60_000 && G.currentToken()) syncNow(false); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [state.enabled, !!data, supported]);

  // local change → dirty → push a few seconds later
  useEffect(() => {
    const prev = prevData.current; prevData.current = data;
    if (prev === data) return;
    if (applying.current) { applying.current = false; return; } // this change came from sync
    if (!supported || !data || !prev) return;
    if (!S.loadState(uid).enabled) return;
    S.markDirty(uid); setState(S.loadState(uid));
    if (running.current) changedWhileRunning.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (G.currentToken()) syncNow(false); else setPhase('needs-auth'); }, 4000);
  }, [data]);

  const disconnect = async (deleteCloud: boolean) => {
    try {
      if (deleteCloud) { const tok = await G.getToken(true, state.email); const m = await G.findSyncFile(tok, state.account || uid, state.fileId, false); if (m) await G.deleteFile(tok, m.id); }
    } catch (e: any) { toast(e?.message || 'Could not delete the cloud copy'); return; }
    await S.forgetKey(); S.clearState(uid); G.forgetToken();
    setState(S.loadState(uid)); setPhase('off');
    toast(deleteCloud ? 'Sync turned off and cloud copy deleted' : 'This device stopped syncing');
  };

  const ctl: Ctl = { phase, state, device, syncNow, openSetup: () => setSetup(true), disconnect };
  return (
    <SyncCtx.Provider value={ctl}>
      {children}
      {setup && <SetupModal uid={uid} name={name} data={data} device={device} onClose={() => setSetup(false)} onDone={(st, d) => { setSetup(false); setState(st); setPhase('idle'); if (d) { applying.current = true; setData(d); } }} />}
      {conflict && (
        <Modal title="Both devices changed" onClose={() => conflict.resolve('merge')}>
          <p style={{ marginTop: 0 }}>Your data changed here and on <b>{conflict.remoteDevice}</b> ({ago(conflict.remoteAt)}) since the last sync. What should FinPlan keep?</p>
          <div className="grid" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => conflict.resolve('merge')}>Combine both (recommended)</button>
            <button className="btn" onClick={() => conflict.resolve('device')}>Keep this device's data</button>
            <button className="btn" onClick={() => conflict.resolve('cloud')}>Use the other device's data</button>
          </div>
          <p className="small muted">Combine keeps every account, transaction, holding and goal from both; for the same item this device wins, and the newest account balance wins.</p>
        </Modal>
      )}
    </SyncCtx.Provider>
  );
}

/** Connect this device: create the cloud copy (first device) or join it (other devices). */
function SetupModal({ uid, name, data, device, onClose, onDone }: { uid: string; name: string; data: AppData | null; device: string; onClose: () => void; onDone: (st: S.SyncState, d?: AppData) => void }) {
  const [cid, setCid] = useState(G.clientId());
  const [step, setStep] = useState<'client' | 'connect' | 'create' | 'join' | 'apply' | 'choose'>(G.needsClientId() ? 'client' : 'connect');
  const [busy, setBusy] = useState(false);
  const [tok, setTok] = useState<G.Token | null>(null);
  const [info, setInfo] = useState<S.RemoteInfo | null>(null);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [joined, setJoined] = useState<{ data: AppData; state: S.SyncState } | null>(null);

  const connect = async () => {
    setBusy(true);
    try {
      const t = await G.getToken(true); const email = await G.whoAmI(t); const tt = { ...t, email };
      setTok(tt);
      let i = await S.inspectRemote(tt, uid);
      const same = !i.exists && i.others.filter((o) => (o.accountName || '').toLowerCase() === name.toLowerCase());
      if (same && same.length === 1) i = { ...i, exists: true, meta: same[0], file: await S.readFile(tt, same[0]) }; // same account name → offer it directly
      setInfo(i);
      setStep(i.exists ? 'join' : i.others.length ? 'choose' : 'create');
    } catch (e: any) { toast(e?.message || 'Google sign-in failed'); }
    setBusy(false);
  };
  const create = async () => {
    if (pw.length < 10) { toast('Use at least 10 characters for the sync password'); return; }
    if (pw !== pw2) { toast('The two passwords are different'); return; }
    if (!data) { toast('Start FinPlan first (Start fresh or demo), then turn on sync'); return; }
    setBusy(true);
    try { const st = await S.createCloud(uid, tok!, data, pw, device, name); toast('Sync is on. Use the same sync password on your other devices.'); onDone(st); }
    catch (e: any) { toast(e?.message || 'Could not create the cloud copy'); }
    setBusy(false);
  };
  const join = async () => {
    setBusy(true);
    try {
      const r = await S.joinCloud(uid, tok!, info!, pw);
      if (!data) { toast(`Synced from ${G.cloudLabel()}`); onDone(r.state, r.data); }
      else { setJoined(r); setStep('apply'); }
    } catch (e: any) { toast(e?.message || 'Could not open the cloud copy'); }
    setBusy(false);
  };
  const apply = async (how: 'cloud' | 'merge') => {
    if (!joined || !data) return;
    if (how === 'cloud') { onDone(joined.state, joined.data); toast('This device now uses the synced data'); return; }
    const merged = S.mergeData(data, joined.data);
    S.saveState(uid, { ...joined.state, dirty: true });
    onDone({ ...joined.state, dirty: true }, merged); toast('Combined. Uploading…');
  };

  return (
    <Modal title={`Sync with ${G.usingClaude() ? 'your Claude account' : 'Google Drive'}`} onClose={onClose}>
      {step === 'client' && (
        <>
          <p className="small" style={{ marginTop: 0 }}>FinPlan needs your own Google <b>OAuth client ID</b> (free, one-time setup in Google Cloud — see the guide in the README / upload guide, section “Sync”). Authorized JavaScript origin and redirect URI:</p>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--bg)', padding: 8, borderRadius: 8 }}>{location.origin}{'\n'}{G.redirectUri()}</pre>
          <Field label="OAuth client ID" full><input className="input" value={cid} onChange={(e) => setCid(e.target.value)} placeholder="1234567890-abc123.apps.googleusercontent.com" /></Field>
          <div className="row mt-s" style={{ justifyContent: 'flex-end' }}>
            <a className="btn ghost" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Google Cloud</a>
            <button className="btn primary" disabled={!G.validClientId(cid)} onClick={() => { G.setClientId(cid); setStep('connect'); }}>Save</button>
          </div>
        </>
      )}
      {step === 'connect' && (
        <>
          {G.usingClaude()
            ? <p style={{ marginTop: 0 }}>FinPlan keeps an encrypted copy in <b>your Claude account's private storage</b> for FinPlan (nobody else can read it). Open FinPlan in Claude on your phone or another computer, signed in to the same Claude account, to get the same data.</p>
            : <p style={{ marginTop: 0 }}>Sign in with the Google account whose Drive should hold your encrypted FinPlan copy. FinPlan only gets its own hidden app folder; it can't see your other files.</p>}
          <ul className="small muted">
            <li>Everything is encrypted on this device with a <b>sync password</b> before upload.</li>
            <li>Your Bitget/Bittime/Alpaca/Claude API keys are never synced.</li>
            {!G.usingClaude() && <li>Allow pop-ups for this site if the Google window doesn't open.</li>}
          </ul>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {!G.usingClaude() ? <button className="btn ghost sm" onClick={() => setStep('client')}>Change client ID</button> : <span />}
            <button className="btn primary" disabled={busy} onClick={connect}><Link2 size={15} /> {busy ? (G.usingClaude() ? 'Checking…' : 'Waiting for Google…') : G.usingClaude() ? 'Continue' : 'Connect Google Drive'}</button>
          </div>
        </>
      )}
      {step === 'choose' && info && (
        <>
          <p style={{ marginTop: 0 }}>{G.usingClaude() ? 'Your Claude account' : <>This Google Drive{tok?.email ? <> (<b>{tok.email}</b>)</> : ''}</>} holds other FinPlan accounts. Each account syncs its own data only.</p>
          {info.others.map((o) => (
            <button key={o.id} className="item btn ghost" style={{ width: '100%', justifyContent: 'flex-start', border: '1px solid var(--line)', marginBottom: 8, padding: 10 }}
              onClick={async () => { setBusy(true); try { setInfo({ ...info, exists: true, meta: o, file: await S.readFile(tok!, o) }); setStep('join'); } catch (e: any) { toast(e?.message || 'Could not read it'); } setBusy(false); }}>
              <div style={{ textAlign: 'left' }}><div style={{ fontWeight: 700 }}>Use “{o.accountName || 'FinPlan (older copy)'}” on this user</div><div className="small muted">last saved by {o.device || 'another device'} · {ago(o.modifiedTime)}</div></div>
            </button>))}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={() => setStep('create')}>Create a separate copy for “{name}”</button>
        </>
      )}
      {step === 'create' && (
        <>
          <p style={{ marginTop: 0 }}>Signed in{tok?.email ? <> as <b>{tok.email}</b></> : ''}. No copy of <b>{name}</b> yet, so this device becomes the first one. Choose a <b>sync password</b>: tip, use your FinPlan sign-in password, so on your phone you sign in to <b>{name}</b> with one password (login screen → <i>Use my account from another device</i>). It can't be recovered: keep it in your password manager.</p>
          <Field label="Sync password" full><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Repeat" full><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <div className="row mt-s" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={create}><KeyRound size={15} /> {busy ? 'Encrypting & uploading…' : 'Turn on sync'}</button></div>
        </>
      )}
      {step === 'join' && info?.file && (
        <>
          <p style={{ marginTop: 0 }}>Found {info.meta?.accountName ? <>the account <b>{info.meta.accountName}</b></> : 'your FinPlan copy'}{tok?.email ? <> in <b>{tok.email}</b></> : ''}, last saved by <b>{info.file.meta.device}</b> ({ago(info.file.meta.updatedAt)}). Enter the sync password you chose there.</p>
          <Field label="Sync password" full><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} /></Field>
          <div className="row mt-s" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || !pw} onClick={join}>{busy ? 'Decrypting…' : 'Unlock & sync'}</button></div>
        </>
      )}
      {step === 'apply' && joined && data && (
        <>
          <p style={{ marginTop: 0 }}>This device already has FinPlan data. How should it join?</p>
          <div className="grid" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => apply('cloud')}>Use the synced data (replace this device's)</button>
            <button className="btn" onClick={() => apply('merge')}>Combine both</button>
          </div>
          <p className="small muted">Cloud: {joined.data.accounts.length} accounts, {joined.data.txns.length} transactions, {joined.data.holdings.length} holdings · This device: {data.accounts.length} / {data.txns.length} / {data.holdings.length}.</p>
        </>
      )}
    </Modal>
  );
}

/** Settings card. */
export function SyncCard() {
  const s = useSync(); const [arm, setArm] = useState(false);
  if (!s) return null;
  const head = <><Cloud size={17} style={{ verticalAlign: -3 }} /> Sync between devices</>;
  if (s.phase === 'unsupported') return (
    <Card title={head}>
      <p className="small muted">Sync runs inside Claude (your Claude account) and on the FinPlan website (Google Drive). In the desktop/phone app build, move data with an encrypted backup (below).</p></Card>
  );
  if (s.phase === 'off') return (
    <Card title={head}>
      <p className="small muted" style={{ marginTop: 0 }}>Use this same user on your phone and laptop. FinPlan keeps an <b>end-to-end encrypted</b> copy {G.usingClaude() ? <>in your Claude account's private FinPlan storage (open FinPlan in Claude on each device)</> : <>in a hidden app folder of your Google Drive</>}; only your sync password can open it.</p>
      <button className="btn primary" onClick={s.openSetup}><Link2 size={15} /> {G.usingClaude() ? 'Turn on sync' : 'Set up Google Drive sync'}</button></Card>
  );
  return (
    <Card title={head}>
      <div className="row small" style={{ marginBottom: 8 }}>
        <span className={`pill ${s.phase === 'idle' ? 'good' : s.phase === 'error' ? 'bad' : ''}`}>{s.phase === 'syncing' ? 'Syncing…' : s.phase === 'needs-auth' ? 'Paused' : s.phase === 'error' ? 'Error' : 'On'}</span>
        <span className="muted">{G.usingClaude() ? 'Claude account' : s.state.email || 'Google Drive'} · last sync {ago(s.state.lastSyncAt)}{s.state.dirty ? ' · changes waiting' : ''}</span>
      </div>
      {s.state.lastError && s.phase !== 'idle' && <div className="small" style={{ color: 'var(--bad)', marginBottom: 8 }}>{s.state.lastError}</div>}
      <div className="row">
        <button className="btn primary sm" disabled={s.phase === 'syncing'} onClick={() => s.syncNow(true)}><RefreshCw size={14} className={s.phase === 'syncing' ? 'spin' : ''} /> {s.phase === 'needs-auth' ? 'Reconnect & sync' : 'Sync now'}</button>
        <button className="btn sm" onClick={() => s.disconnect(false)}><Unlink size={14} /> Stop on this device</button>
        <button className="btn sm danger" onClick={() => { if (!arm) { setArm(true); setTimeout(() => setArm(false), 4000); return; } s.disconnect(true); }}><Trash2 size={14} /> {arm ? 'Tap again to delete cloud copy' : 'Delete cloud copy'}</button>
      </div>
      <div className="small muted mt-s">This device: {s.device}.{G.usingClaude() ? ' Syncs automatically while FinPlan is open in Claude.' : ' Google sign-in lasts about an hour; after that FinPlan asks you to tap Reconnect.'}</div>
    </Card>
  );
}

/** Compact status in the sidebar / mobile header. */
export function SyncChip() {
  const s = useSync();
  if (!s || s.phase === 'unsupported' || s.phase === 'off') return null;
  const paused = s.phase === 'needs-auth' || s.phase === 'error';
  return (
    <button className={`sync-chip ${paused ? 'warn' : ''}`} onClick={() => s.syncNow(true)} title={s.state.lastError || 'Sync now'}>
      {paused ? <CloudOff size={14} /> : <Cloud size={14} />}
      {s.phase === 'syncing' ? 'Syncing…' : paused ? (s.state.dirty ? 'Changes not synced · tap' : 'Sync paused · tap') : `Synced ${ago(s.state.lastSyncAt)}`}
    </button>
  );
}

/** Welcome screen (new device, no data yet): join the synced copy. */
export function WelcomeSyncButton() {
  const s = useSync();
  if (!s || s.phase === 'unsupported') return null;
  return <button className="btn" onClick={s.openSetup}><Cloud size={16} /> {G.usingClaude() ? 'Get my data from another device' : 'Sync from Google Drive'}</button>;
}
