import { useEffect, useState } from 'react';
import { KeyRound, LogOut, Trash2, Copy, Monitor, ShieldCheck } from 'lucide-react';
import { autoLockMinutes, changePassword, deleteUser, getDevice, listUsers, loginHistory, newRecoveryCode, renameDevice, setAutoLock, updateProfile, type DeviceInfo, type Session } from '../lib/auth';
import { setSecret } from '../lib/secure';
import { Card, Field, Modal, toast } from '../components/ui';
import { Avatar } from './Login';

export default function AccountSettings({ session, onSignOut, onDeleted }: { session: Session; onSignOut: () => void; onDeleted: () => void }) {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [name, setName] = useState(session.user.name);
  const [email, setEmail] = useState(session.user.email || '');
  const [lockMin, setLockMin] = useState(autoLockMinutes());
  const [modal, setModal] = useState<null | 'password' | 'recovery' | 'delete'>(null);
  const [devName, setDevName] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { getDevice().then((d) => { setDevice(d); setDevName(d.name); }); }, []);
  const history = loginHistory();
  const users = listUsers();

  return (
    <>
      <div className="grid g2">
        <Card title="Account" action={<button className="btn sm" onClick={onSignOut}><LogOut size={14} /> Sign out</button>}>
          <div className="row" style={{ marginBottom: 12 }}><Avatar u={session.user} size={48} />
            <div><div style={{ fontWeight: 700 }}>{session.user.name}</div><div className="small muted">Member since {new Date(session.user.createdAt).toLocaleDateString()} · {users.length} user{users.length > 1 ? 's' : ''} on this device</div></div></div>
          <div className="form">
            <Field label="Display name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { updateProfile(session.user.id, { name }); }} /></Field>
            <Field label="Email (label only)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => updateProfile(session.user.id, { email })} /></Field>
            <Field label="Auto-lock when idle" full><select className="input" value={lockMin} onChange={(e) => { const m = Number(e.target.value); setLockMin(m); setAutoLock(m); toast('Auto-lock updated. It takes effect next sign-in'); }}>
              {[[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour'], [0, 'Never (not recommended)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
          <div className="row mt">
            <button className="btn sm" onClick={() => setModal('password')}><KeyRound size={14} /> Change password</button>
            <button className="btn sm" onClick={() => setModal('recovery')}><ShieldCheck size={14} /> New recovery code</button>
            <button className="btn sm danger" onClick={() => setModal('delete')}><Trash2 size={14} /> Delete account</button>
          </div>
          <p className="small muted mt">Your data is encrypted with AES-256-GCM using a key protected by your password (PBKDF2-SHA256, 600,000 rounds; the key itself can't be read out of memory). It never leaves this device unless you export a backup.</p>
        </Card>

        <Card title={<span><Monitor size={16} style={{ verticalAlign: -3 }} /> This device</span>}>
          {device && (<>
            <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{device.short}</div>
            <div className="small muted" style={{ marginBottom: 10 }}>Browser / Device ID</div>
            <div className="kv"><span>Device name</span><input className="input" style={{ maxWidth: 220 }} value={devName} onChange={(e) => setDevName(e.target.value)} onBlur={() => renameDevice(devName)} /></div>
            <div className="kv"><span>Running as</span><b>{device.platform}</b></div>
            <div className="kv"><span>Browser · OS</span><b>{device.browser} · {device.os}</b></div>
            <div className="kv"><span>Fingerprint</span><b style={{ fontFamily: 'monospace' }}>{device.fingerprint}</b></div>
            <div className="kv"><span>First seen</span><b>{new Date(device.createdAt).toLocaleString()}</b></div>
            <div className="kv"><span>Full ID</span><b style={{ fontFamily: 'monospace', fontSize: 11 }}>{device.id}</b></div>
            <button className="btn sm mt-s" onClick={() => { navigator.clipboard?.writeText(device.id).then(() => toast('Device ID copied')).catch(() => {}); }}><Copy size={14} /> Copy ID</button>
            <p className="small muted mt-s">The ID is random and created once per browser/app install. The fingerprint changes if the browser, screen or language changes, which helps you notice a copied profile.</p>
          </>)}
        </Card>
      </div>

      <Card className="mt" title="Sign-in history" action={<span className="small muted">{history.filter((h) => !h.ok).length} failed attempts recorded</span>}>
        <div className="scroll-x"><table>
          <thead><tr><th>When</th><th>User</th><th>Browser ID</th><th className="hide-m">Device</th><th>Method</th><th>Result</th></tr></thead>
          <tbody>{history.slice(0, showAll ? 200 : 10).map((h, i) => (
            <tr key={i}><td>{new Date(h.at).toLocaleString()}</td><td>{h.userName}</td><td style={{ fontFamily: 'monospace' }}>{h.deviceId}</td><td className="hide-m small muted">{h.device}</td>
              <td className="small">{h.method}</td><td><span className={`pill ${h.ok ? 'good' : 'bad'}`}>{h.ok ? 'Success' : 'Failed'}</span></td></tr>
          ))}</tbody>
        </table></div>
        {history.length > 10 && <button className="btn sm mt-s" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all ${history.length}`}</button>}
      </Card>

      {modal === 'password' && <PasswordModal session={session} onClose={() => setModal(null)} />}
      {modal === 'recovery' && <RecoveryModal session={session} onClose={() => setModal(null)} />}
      {modal === 'delete' && <DeleteModal session={session} onClose={() => setModal(null)} onDeleted={onDeleted} />}
    </>
  );
}

function PasswordModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [c, setC] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal title="Change password" onClose={onClose}>
      <div className="form" style={{ gridTemplateColumns: '1fr' }}>
        <Field label="Current password"><input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="New password"><input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        <Field label="Confirm new password"><input className="input" type="password" value={c} onChange={(e) => setC(e.target.value)} /></Field>
      </div>
      {err && <div className="small neg mt-s">{err}</div>}
      <div className="row between mt"><span className="small muted">Your recovery code stays valid.</span>
        <button className="btn primary" disabled={busy || !a || !b} onClick={async () => {
          if (b !== c) return setErr('Passwords do not match');
          setBusy(true); try { await changePassword(session, a, b); toast('Password changed'); onClose(); } catch (e: any) { setErr(e.message); } setBusy(false);
        }}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </Modal>
  );
}

function RecoveryModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal title="New recovery code" onClose={onClose}>
      {!code ? (<>
        <p className="small muted" style={{ marginTop: 0 }}>Creating a new code makes the old one stop working.</p>
        <Field label="Your password"><input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <div className="small neg mt-s">{err}</div>}
        <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy || !pw} onClick={async () => { setBusy(true); try { setCode(await newRecoveryCode(session, pw)); } catch (e: any) { setErr(e.message); } setBusy(false); }}>{busy ? 'Working…' : 'Create code'}</button></div>
      </>) : (<>
        <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, textAlign: 'center', padding: 16, background: 'var(--bg)', borderRadius: 10, border: '1px dashed var(--line)', wordBreak: 'break-all' }}>{code}</div>
        <div className="row between mt"><button className="btn" onClick={() => navigator.clipboard?.writeText(code).catch(() => {})}><Copy size={16} /> Copy</button><button className="btn primary" onClick={onClose}>I've saved it</button></div>
      </>)}
    </Modal>
  );
}

function DeleteModal({ session, onClose, onDeleted }: { session: Session; onClose: () => void; onDeleted: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  return (
    <Modal title={`Delete ${session.user.name}'s account?`} onClose={onClose}>
      <p className="small" style={{ marginTop: 0 }}>This permanently deletes this user's encrypted data, API keys and sign-in history <b>on this device</b>. Export a backup first if you might need it.</p>
      <Field label="Type your password to confirm"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {err && <div className="small neg mt-s">{err}</div>}
      <div className="row between mt"><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={!pw} onClick={async () => {
          try { await deleteUser(session, pw); for (const k of ['bitget', 'bittime', 'alpaca', 'pluang-mcp']) await setSecret(k, null); onDeleted(); } catch (e: any) { setErr(e.message); }
        }}><Trash2 size={16} /> Delete permanently</button></div>
    </Modal>
  );
}
