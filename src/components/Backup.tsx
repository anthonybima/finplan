import { useRef, useState } from 'react';
import { today } from '../lib/format';
import { Download, Upload, Lock } from 'lucide-react';
import type { AppData } from '../lib/types';
import { decryptBackup, encryptBackup, isEncryptedBackup, type EncryptedBackup } from '../lib/cryptoBox';
import { exportBackup, migrate } from '../lib/store';
import { downloadText } from '../lib/holdings';
import { getDevice, passwordProblems } from '../lib/auth';
import { Field, Modal, toast } from './ui';

/** Export: password-protected by default (AES-256-GCM, PBKDF2 600k). Plain JSON only on explicit request. */
export function ExportBackupModal({ data, onClose, onDone }: { data: AppData; onClose: () => void; onDone?: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState(false);
  const go = async () => {
    if (plain) { exportBackup(data); onClose(); return; }
    const p = passwordProblems(pw); if (p) return setErr(p);
    if (pw !== pw2) return setErr('Passwords do not match');
    setBusy(true);
    try {
      const dev = await getDevice();
      const b = await encryptBackup(data, pw, dev.short);
      downloadText(`finplan-backup-${today()}.fpbak`, JSON.stringify(b), 'application/octet-stream');
      toast('Encrypted backup saved'); onDone?.(); onClose();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title="Export backup" onClose={onClose}>
      {!plain ? (<>
        <p className="small muted" style={{ marginTop: 0 }}>The backup file is encrypted with this password. You'll need it to restore on another device. It can be the same as your sign-in password.</p>
        <div className="form" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="Backup password"><input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Confirm"><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></Field>
        </div>
      </>) : <div className="banner" style={{ background: 'var(--warn-soft)' }}><div className="small"><b>Unencrypted export:</b> anyone who gets this file can read all your finances. Use only for moving data into a spreadsheet, and delete it afterwards.</div></div>}
      {err && <div className="small neg mt-s">{err}</div>}
      <div className="row between mt">
        <a href="#" className="small" onClick={(e) => { e.preventDefault(); setPlain(!plain); setErr(''); }}>{plain ? '← Encrypted export (recommended)' : 'Export unencrypted JSON instead'}</a>
        <button className={`btn ${plain ? 'danger' : 'primary'}`} disabled={busy} onClick={go}>{plain ? <><Download size={16} /> Export plain JSON</> : <><Lock size={16} /> {busy ? 'Encrypting…' : 'Export encrypted'}</>}</button>
      </div>
    </Modal>
  );
}

/** Restore button + password prompt for encrypted backups (.fpbak) or legacy plain JSON. */
export function RestoreBackupButton({ onRestore, className = 'btn' }: { onRestore: (d: AppData) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [enc, setEnc] = useState<EncryptedBackup | null>(null);
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const accept = (d: any) => { if (!d?.accounts || !d?.txns) throw new Error('Not a FinPlan backup'); onRestore(migrate(d)); toast('Backup restored'); };
  return (
    <>
      <button className={className} onClick={() => ref.current?.click()}><Upload size={16} /> Restore backup</button>
      <input ref={ref} type="file" accept=".fpbak,.json" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return; e.target.value = '';
        try { const j = JSON.parse(await f.text()); if (isEncryptedBackup(j)) { setEnc(j); setPw(''); setErr(''); } else accept(j); }
        catch (x: any) { toast(x.message || 'Invalid backup file'); }
      }} />
      {enc && (
        <Modal title="Encrypted backup" onClose={() => setEnc(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>Created {new Date(enc.createdAt).toLocaleString()}{enc.device ? ` on ${enc.device}` : ''}. Enter the backup password.</p>
          <Field label="Backup password"><input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {err && <div className="small neg mt-s">{err}</div>}
          <div className="row mt" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={!pw || busy} onClick={async () => {
              setBusy(true); try { accept(await decryptBackup(enc, pw)); setEnc(null); } catch (x: any) { setErr(x.message); } setBusy(false);
            }}>{busy ? 'Decrypting…' : 'Restore'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
