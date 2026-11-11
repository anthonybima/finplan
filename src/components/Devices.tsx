import { useEffect, useState } from 'react';
import { Check, Clock, Laptop, Monitor, ShieldAlert, Smartphone, Tablet, Trash2, X } from 'lucide-react';
import type { AppData } from '../lib/types';
import { kindLabel, renameDeviceRec, setDeviceStatus, forgetDevice, type DeviceRec, type ThisDevice } from '../lib/devices';
import { Card, toast } from './ui';
import { useSync } from './Sync';
import * as G from '../lib/gdrive';

const KIND_ICON = { phone: Smartphone, tablet: Tablet, computer: Laptop } as const;
const when = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const STATUS: Record<DeviceRec['status'], [string, string]> = { allowed: ['good', 'Allowed'], pending: ['warn', 'Waiting for approval'], removed: ['bad', 'Removed'] };

/** Settings → Devices: every phone / computer that opened this account, with its Browser ID. */
export function DevicesCard({ data, update, me }: { data: AppData; update: (fn: (d: AppData) => AppData) => void; me: ThisDevice | null }) {
  const s = useSync();
  const list = data.devices || [];
  const [edit, setEdit] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [arm, setArm] = useState<string | null>(null);
  const meRec = list.find((x) => x.id === me?.id);
  const canManage = meRec?.status === 'allowed';
  const by = me?.short || '';
  const syncing = !!s && s.phase !== 'off' && s.phase !== 'unsupported';
  const act = (id: string, status: DeviceRec['status'], msg: string) => { update((d) => setDeviceStatus(d, id, status, by)); toast(msg); };
  return (
    <Card title={<><Monitor size={17} style={{ verticalAlign: -3 }} /> Devices for this account</>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Every phone and computer that opens <b>this account</b>, by its Browser ID. {syncing ? <>They share the same data through {G.cloudLabel()}.</> : <><b>Sync is off</b>: turn it on (above) so your other devices get the same data and appear here.</>}
      </p>
      {!list.length && <div className="small muted">This device will appear here in a moment.</div>}
      <div className="device-list">
        {list.map((d) => {
          const I = KIND_ICON[d.kind] || Monitor; const mine = d.id === me?.id; const [cls, label] = STATUS[d.status];
          return (
            <div key={d.id} className={`device-row ${d.status}`}>
              <div className="ico"><I size={20} /></div>
              <div className="grow" style={{ minWidth: 0 }}>
                {edit === d.id
                  ? <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); update((x) => renameDeviceRec(x, d.id, name, by)); setEdit(null); }}>
                      <input className="input be-in" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={{ width: 160 }} />
                      <button className="btn sm primary" type="submit"><Check size={14} /></button><button className="btn sm ghost" type="button" onClick={() => setEdit(null)}><X size={14} /></button></form>
                  : <div style={{ fontWeight: 700 }}>
                      <button className="linklike" title="Rename" onClick={() => { setEdit(d.id); setName(d.name); }}>{d.name}</button>
                      {mine && <span className="pill good" style={{ marginLeft: 6 }}>this device</span>}
                      <span className={`pill ${cls}`} style={{ marginLeft: 6 }}>{label}</span>
                    </div>}
                <div className="small muted"><span className="acct-no">{d.short}</span> · {kindLabel(d.kind)} · {d.platform}</div>
                <div className="small muted">Added {when(d.firstSeen)} · last active {when(d.lastSeen)}{d.statusBy && d.status !== 'allowed' ? ` · by ${d.statusBy}` : ''}</div>
              </div>
              {canManage && !mine && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {d.status !== 'allowed' && <button className="btn sm primary" onClick={() => act(d.id, 'allowed', `${d.name} allowed`)}><Check size={14} /> Allow</button>}
                  {d.status !== 'removed' && <button className="btn sm danger" onClick={() => { if (arm !== d.id) { setArm(d.id); setTimeout(() => setArm(null), 4000); return; } act(d.id, 'removed', `${d.name} removed: it erases this account on its next sync`); setArm(null); }}><ShieldAlert size={14} /> {arm === d.id ? 'Tap again to remove' : 'Remove'}</button>}
                  {d.status === 'removed' && <button className="btn sm ghost" title="Delete from the list" onClick={() => update((x) => forgetDevice(x, d.id))}><Trash2 size={14} /></button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label className="row small mt" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" disabled={!canManage} checked={!!data.settings.devicesNeedApproval} onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, devicesNeedApproval: e.target.checked } }))} />
        <span>New devices need approval from an allowed device (they wait on a “waiting for approval” screen)</span>
      </label>
      <p className="small muted" style={{ marginBottom: 0 }}><b>Remove</b> a lost or old device: on its next sync it erases this account from itself and signs out. Opening the account on a device still needs the password.</p>
    </Card>
  );
}

/** Banner on every page when a device is waiting for approval. */
export function PendingDevicesBanner({ data, update, me }: { data: AppData; update: (fn: (d: AppData) => AppData) => void; me: ThisDevice | null }) {
  const meRec = (data.devices || []).find((x) => x.id === me?.id);
  const pending = (data.devices || []).filter((x) => x.status === 'pending');
  if (!pending.length || meRec?.status !== 'allowed') return null;
  return (
    <>{pending.map((d) => (
      <div key={d.id} className="banner mb">
        <ShieldAlert size={20} color="var(--warn)" />
        <div className="grow"><b>New device wants to open this account:</b> {d.name} · <span className="acct-no">{d.short}</span> · {d.platform}</div>
        <button className="btn sm primary" onClick={() => { update((x) => setDeviceStatus(x, d.id, 'allowed', me!.short)); toast(`${d.name} allowed`); }}><Check size={14} /> Allow</button>
        <button className="btn sm danger" onClick={() => { update((x) => setDeviceStatus(x, d.id, 'removed', me!.short)); toast(`${d.name} blocked`); }}><X size={14} /> Block</button>
      </div>))}</>
  );
}

/** Full-screen: this device waits until an allowed device approves it (checks every 15 s). */
export function DevicePending({ rec, onSignOut }: { rec: DeviceRec; onSignOut: () => void }) {
  const s = useSync();
  useEffect(() => { const t = setInterval(() => s?.syncNow(false), 15_000); s?.syncNow(false); return () => clearInterval(t); }, []);
  return (
    <div className="center-screen"><div className="card" style={{ maxWidth: 440, textAlign: 'center' }}>
      <Clock size={40} color="var(--brand)" />
      <h2>Waiting for approval</h2>
      <p>This account allows new devices only after approval. On a phone or computer that already uses it, tap <b>Allow</b> on the banner (or Settings → Devices).</p>
      <div className="small muted">This device: <b>{rec.name}</b> · Browser ID <span className="acct-no">{rec.short}</span></div>
      <div className="small muted mt-s">{s?.phase === 'syncing' ? 'Checking…' : 'Checks every 15 seconds.'}</div>
      <button className="btn mt" onClick={onSignOut}>Sign out</button>
    </div></div>
  );
}
