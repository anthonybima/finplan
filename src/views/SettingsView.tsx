import { DemoBanner } from '../components/DemoBanner';
import { useState } from 'react';
import { Download, Trash2, Plus, BellRing, CalendarPlus } from 'lucide-react';
import { askNotificationPermission, DAY_NAMES, monthlyOf, notificationsSupported, reminderICS, reminderLabel, reminderState, WEEK_NAMES } from '../lib/reminders';
import { downloadText } from '../lib/holdings';
import { fmtDate } from '../lib/format';
import type { ViewProps } from '../App';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/types';
import { ExportBackupModal, RestoreBackupButton } from '../components/Backup';
import { SyncCard } from '../components/Sync';
import { DevicesCard } from '../components/Devices';
import type { ThisDevice } from '../lib/devices';
import { Card, Field, toast } from '../components/ui';
import type { Session } from '../lib/auth';
import AccountSettings from './AccountSettings';
import SecurityCenter from './SecurityCenter';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CURRENCIES = [['IDR', 'id-ID'], ['USD', 'en-US'], ['SGD', 'en-SG'], ['MYR', 'ms-MY'], ['EUR', 'de-DE'], ['AUD', 'en-AU'], ['JPY', 'ja-JP']];

export default function SettingsView({ data, update, onReset, session, onSignOut, thisDevice = null }: ViewProps & { onReset: () => void; session: Session; onSignOut: () => void; thisDevice?: ThisDevice | null }) {
  const s = data.settings;
  const [exporting, setExporting] = useState(false);
  const [arm, setArm] = useState(false);
  const [kw, setKw] = useState(''); const [kc, setKc] = useState('Food & Dining');
  const set = (p: Partial<typeof s>) => update((d) => ({ ...d, settings: { ...d.settings, ...p } }));
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Account, device, preferences, rules and backups</div></div></div>
      <SecurityCenter data={data} session={session} onPrivacy={(v) => set({ privacyNoProxy: v })} onBackup={() => setExporting(true)} />
      <div className="mt" />
      <AccountSettings session={session} onSignOut={onSignOut} onDeleted={onSignOut} />
      <div className="mt" />
      <div className="grid g2">
        <Card title="Preferences">
          <div className="form">
            <Field label="Your name"><input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Currency"><select className="input" value={s.currency} onChange={(e) => { const c = CURRENCIES.find((x) => x[0] === e.target.value)!; set({ currency: c[0], locale: c[1] }); }}>
              {CURRENCIES.map(([c]) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Weekly review day"><select className="input" value={s.weeklyDay} onChange={(e) => set({ weeklyDay: Number(e.target.value) })}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
          </div>
        </Card>
        <ReminderCard data={data} update={update} />
        <SyncCard />
        <DevicesCard data={data} update={update} me={thisDevice} />
        <DemoBanner data={data} update={update} force />
        <Card title="Backup & sync">
          <p className="small muted" style={{ marginTop: 0 }}>Your data is encrypted and stored only on this device. Export a backup regularly, and use it to move data between your phone and computer.</p>
          <div className="row">
            <button className="btn primary" onClick={() => setExporting(true)}><Download size={16} /> Export encrypted backup</button>
            <RestoreBackupButton onRestore={(d) => update(() => d)} />
          </div>
          {exporting && <ExportBackupModal data={data} onClose={() => setExporting(false)} onDone={() => set({ lastBackupAt: new Date().toISOString() })} />}
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <button className="btn danger" onClick={() => { if (!arm) { setArm(true); setTimeout(() => setArm(false), 4000); return; } onReset(); }}><Trash2 size={16} /> {arm ? 'Tap again to erase your data' : 'Erase my FinPlan data'}</button>
        </Card>
      </div>
      <Card title={`Auto-categorisation rules (${s.rules.length})`} className="mt">
        <p className="small muted" style={{ marginTop: 0 }}>When importing, a description containing the keyword gets the category. First match wins.</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="input" style={{ flex: '1 1 160px' }} placeholder="Keyword, e.g. 'kopi kenangan'" value={kw} onChange={(e) => setKw(e.target.value)} />
          <select className="input" style={{ width: 'auto' }} value={kc} onChange={(e) => setKc(e.target.value)}>{[...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn primary" disabled={!kw.trim()} onClick={() => { set({ rules: [{ keyword: kw.trim().toLowerCase(), category: kc }, ...s.rules] }); setKw(''); }}><Plus size={16} /> Add rule</button>
          <button className="btn" onClick={() => {
            const match = (note: string) => s.rules.find((r) => (' ' + note.toLowerCase() + ' ').includes(r.keyword));
            const isUncat = (c: string) => c === 'Other' || c === 'Other Income';
            const n = data.txns.filter((t) => isUncat(t.category) && match(t.note)).length;
            update((d) => ({ ...d, txns: d.txns.map((t) => { const r = isUncat(t.category) ? match(t.note) : undefined; return r ? { ...t, category: r.category } : t; }) }));
            toast(`Re-categorised ${n} transactions`);
          }}>Apply to uncategorised</button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {s.rules.map((r, i) => (
            <span key={i} className="pill" style={{ padding: '4px 6px 4px 10px' }}>{r.keyword} → {r.category}
              <button className="btn ghost sm" style={{ padding: '0 4px' }} onClick={() => set({ rules: s.rules.filter((_, j) => j !== i) })} aria-label="Remove">×</button></span>
          ))}
        </div>
      </Card>
      <p className="small muted mt">FinPlan v1.0 · runs as a web app (PWA), desktop app (Electron) and mobile app (Capacitor) from one codebase.</p>
    </>
  );
}

function ReminderCard({ data, update }: { data: ViewProps['data']; update: ViewProps['update'] }) {
  const r = monthlyOf(data.settings);
  const st = reminderState(data);
  const [perm, setPerm] = useState<string>(() => (notificationsSupported() ? Notification.permission : 'unsupported'));
  const set = (patch: Partial<typeof r>) => update((d) => ({ ...d, settings: { ...d.settings, monthlyUpdate: { ...monthlyOf(d.settings), ...patch } } }));
  return (
    <Card title={<><BellRing size={17} style={{ verticalAlign: -3 }} /> Reminders</>}>
      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <b>Monthly account update</b>
      </label>
      <p className="small muted" style={{ margin: '4px 0 10px' }}>Reminds you to enter your bank, e-wallet, cash, investment and debt balances. Shows on the dashboard from that day until you save the update.</p>
      <div className="form">
        <Field label="Week"><select className="input" value={r.week} disabled={!r.enabled} onChange={(e) => set({ week: Number(e.target.value) as typeof r.week })}>
          {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>{WEEK_NAMES[w]}</option>)}</select></Field>
        <Field label="Day"><select className="input" value={r.day} disabled={!r.enabled} onChange={(e) => set({ day: Number(e.target.value) })}>
          {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
        <Field label="Time"><input className="input" type="time" value={r.time} disabled={!r.enabled} onChange={(e) => set({ time: e.target.value || '09:00' })} /></Field>
        <Field label="Status"><div className="input" style={{ border: 0, paddingLeft: 0 }}>{!r.enabled ? 'Off' : st.status === 'done' ? `Done for this month ✓ · next ${fmtDate(st.nextDate)}` : st.status === 'upcoming' ? `Next: ${fmtDate(st.nextDate)}` : st.status === 'snoozed' ? 'Snoozed until tomorrow' : `Due since ${fmtDate(st.dueDate)}`}</div></Field>
      </div>
      <div className="small muted" style={{ margin: '2px 0 10px' }}>{r.enabled ? `${reminderLabel(r)} at ${r.time}.` : ''}</div>
      <label className="row small" style={{ gap: 8, cursor: 'pointer', marginBottom: 10 }}>
        <input type="checkbox" checked={r.notify} disabled={!r.enabled} onChange={(e) => set({ notify: e.target.checked })} /> Device notification when FinPlan is open
        {r.notify && perm !== 'granted' && perm !== 'unsupported' && <button className="btn sm" onClick={async () => setPerm(await askNotificationPermission())}>Allow notifications</button>}
        {r.notify && perm === 'granted' && <span className="pill good">allowed</span>}
        {perm === 'denied' && <span className="pill bad">blocked in browser settings</span>}
      </label>
      <button className="btn sm" disabled={!r.enabled} onClick={() => { downloadText('finplan-monthly-update.ics', reminderICS(r, new Date(), /^https:/.test(location.href) ? location.origin + location.pathname : ''), 'text/calendar'); toast('Open the file to add the repeating reminder to your calendar'); }}>
        <CalendarPlus size={14} /> Add to my calendar (.ics)
      </button>
      <div className="small muted mt-s">The calendar reminder works even when FinPlan is closed (Google Calendar, iPhone, Outlook).</div>
    </Card>
  );
}
