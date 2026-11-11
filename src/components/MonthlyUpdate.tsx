import { isFx, parseFxAmount, toIdr } from '../lib/fx';
import { fmtNo } from '../lib/accountNo';
import { useMemo, useState } from 'react';
import { CalendarClock, Check, RefreshCw, ScanLine, Plus, Upload } from 'lucide-react';
import type { AppData, AccountKind } from '../lib/types';
import { Modal, MoneyInput, toast } from './ui';
import { fmtDate, money, today, addDays } from '../lib/format';
import { manualAccounts, monthlyOf, reminderLabel, type ReminderState } from '../lib/reminders';
import { balances } from '../lib/analytics';
import type { Page } from '../App';

const KIND_ORDER: AccountKind[] = ['bank', 'ewallet', 'cash', 'investment', 'asset', 'debt'];
const KIND_TITLE: Record<AccountKind, string> = { bank: 'Bank accounts', ewallet: 'E-wallets', cash: 'Cash', investment: 'Investments (manual)', asset: 'Other assets', debt: 'Debts & loans' };

type Upd = (fn: (d: AppData) => AppData) => void;
const setReminder = (update: Upd, patch: Partial<NonNullable<AppData['settings']['monthlyUpdate']>>) =>
  update((d) => ({ ...d, settings: { ...d.settings, monthlyUpdate: { ...monthlyOf(d.settings), ...patch } } }));

/** Banner shown on/after the reminder day until the month's update is done. */
export function MonthlyBanner({ state, data, update, onOpen, compact }: { state: ReminderState; data: AppData; update: Upd; onOpen: () => void; compact?: boolean }) {
  if (state.status !== 'due' && state.status !== 'overdue') return null;
  const r = monthlyOf(data.settings);
  return (
    <div className="banner monthly-banner" role="status">
      <CalendarClock color="var(--brand)" />
      <div className="grow">
        <b className="hide-m">{state.status === 'due' ? 'Today: monthly account update' : `Monthly account update is ${state.daysLate} day${state.daysLate === 1 ? '' : 's'} late`}</b>
        <b className="show-m">{state.status === 'due' ? 'Monthly update today' : `Monthly update · ${state.daysLate}d late`}</b>
        {!compact && <span className="muted small hide-m"> · {reminderLabel(r)}. {state.staleAccounts ? `${state.staleAccounts} account${state.staleAccounts === 1 ? '' : 's'} to check.` : 'Check your balances.'} About 5 minutes.</span>}
      </div>
      <button className="btn primary sm" onClick={onOpen}>Update<span className="hide-m"> now</span></button>
      <button className="btn ghost sm hide-m" title="Remind me tomorrow" onClick={() => { setReminder(update, { snoozeUntil: addDays(today(), 1) }); toast('OK, I\'ll remind you tomorrow'); }}>Tomorrow</button>
      <button className="btn ghost sm" title="Mark this month as done" onClick={() => { setReminder(update, { doneMonth: state.month, snoozeUntil: undefined }); toast('Marked done for this month'); }}><Check size={14} /></button>
    </div>
  );
}

/** One screen to update every manual account balance; saving marks the month done. */
export function MonthlyUpdateModal({ data, update, onClose, go, onScan, onImport, focusIds }: { data: AppData; update: Upd; onClose: () => void; go: (p: Page) => void; onScan: () => void; onImport: () => void; focusIds?: string[] }) {
  const focus = !!focusIds?.length;
  const all = manualAccounts(data);
  const accts = focus ? all.filter((a) => focusIds!.includes(a.id)) : all;
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [bal, setBal] = useState<Record<string, number>>(() => Object.fromEntries(accts.map((a) => [a.id, a.balance])));
  const [fxv, setFxv] = useState<Record<string, number>>(() => Object.fromEntries(accts.filter(isFx).map((a) => [a.id, a.fxBalance ?? 0]))); // foreign-currency amounts
  const changed = accts.filter((a) => bal[a.id] !== a.balance || touched.has(a.id)).length;
  const groups = useMemo(() => {
    if (focus) { const names = [...new Set(accts.map((a) => a.group || 'Other'))]; return names.map((n) => ({ k: n, title: n, list: accts.filter((a) => (a.group || 'Other') === n) })); }
    return KIND_ORDER.map((k) => ({ k: k as string, title: KIND_TITLE[k], list: accts.filter((a) => a.kind === k) })).filter((g) => g.list.length);
  }, [accts, focus]);
  const synced = data.accounts.filter((a) => a.synced);
  const before = balances(data.accounts).netWorth;
  const after = balances(data.accounts.map((a) => (bal[a.id] !== undefined ? { ...a, balance: bal[a.id] } : a))).netWorth;

  const save = () => {
    const t = today(), month = t.slice(0, 7);
    update((d) => ({
      ...d,
      accounts: d.accounts.map((a) => {
        if (bal[a.id] === undefined || a.synced) return a;
        if (a.needsBalance && !touched.has(a.id) && !bal[a.id]) return a; // still not entered
        if (focus && !touched.has(a.id) && bal[a.id] === a.balance) return a;
        const { needsBalance: _n, ...rest } = a;
        return { ...rest, balance: bal[a.id], ...(isFx(a) && fxv[a.id] !== undefined ? { fxBalance: fxv[a.id] } : {}), updatedAt: t };
      }),
      settings: focus ? d.settings : { ...d.settings, monthlyUpdate: { ...monthlyOf(d.settings), doneMonth: month, snoozeUntil: undefined } },
    }));
    toast(focus ? `Balances saved for ${touched.size} account${touched.size === 1 ? '' : 's'} ✓` : `Accounts updated for ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} ✓`);
    onClose();
  };

  return (
    <Modal title={focus ? 'Enter balances for imported accounts' : 'Monthly account update'} onClose={onClose} wide>
      <p className="small muted" style={{ marginTop: 0 }}>{focus ? `Your file had no balances. Enter today's balance for each account (grouped by bank / app). Accounts you leave empty stay marked “balance not entered”; you can fill them later here or in Wealth.` : `Enter today's balance for each account (from your banking and e-wallet apps). Unchanged balances are confirmed as checked today.`}</p>
      {!accts.length && <div className="empty">No manual accounts yet. <button className="btn sm" onClick={() => { onClose(); go('wealth'); }}><Plus size={14} /> Add accounts</button></div>}
      {groups.map((g) => (
        <div key={g.k} className="mu-group">
          <div className="small" style={{ fontWeight: 700, margin: '10px 0 6px' }}>{g.title}</div>
          {g.list.map((a) => (
            <div key={a.id} className="mu-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}{(a.accountNo || a.ref) && <span className="muted small acct-no"> · {a.accountNo ? fmtNo(a.accountNo) : a.ref}</span>}</div>
                <div className="small muted">{a.needsBalance && !touched.has(a.id) ? <span className="pill warn">balance not entered</span> : <>Last updated {a.updatedAt ? fmtDate(a.updatedAt) : 'never'}{bal[a.id] !== a.balance ? ` · was ${money(a.balance)}` : ''}</>}</div>
              </div>
              <div style={{ width: 190 }}>{isFx(a)
                ? <><div className="row" style={{ gap: 4, alignItems: 'center' }}><span className="ccy-tag">{a.currency}</span><input className="input" inputMode="decimal" aria-label={`${a.name} in ${a.currency}`} defaultValue={a.fxBalance ?? ''} placeholder="0.00" onChange={(e) => { const v = parseFxAmount(e.target.value); setFxv((f) => ({ ...f, [a.id]: v })); setBal((b) => ({ ...b, [a.id]: toIdr(data.settings, a.currency, v) })); setTouched((s) => new Set(s).add(a.id)); }} /></div>
                    <div className="small muted" style={{ textAlign: 'right' }}>≈ {money(bal[a.id] ?? 0)}</div></>
                : <MoneyInput value={bal[a.id] ?? 0} onChange={(n) => { setBal((b) => ({ ...b, [a.id]: n })); setTouched((s) => new Set(s).add(a.id)); }} />}</div>
            </div>
          ))}
        </div>
      ))}
      {synced.length > 0 && <div className="small muted mt-s">{synced.length} synced investment account{synced.length === 1 ? '' : 's'} (Bitget, Pluang…) update from Connections.</div>}
      <div className="row mt-s">
        <button className="btn sm" onClick={() => { onClose(); go('connections'); }}><RefreshCw size={14} /> Sync connected apps</button>
        <button className="btn sm" onClick={() => { onClose(); onScan(); }}><ScanLine size={14} /> Smart scan portfolio</button>
        <button className="btn sm" onClick={() => { onClose(); onImport(); }}><Upload size={14} /> Import from file / screenshot</button>
      </div>
      <div className="row between mt" style={{ alignItems: 'center' }}>
        <div className="small">Net worth {money(before)} → <b>{money(after)}</b>{changed ? <span className="muted"> · {changed} changed</span> : null}</div>
        <div className="row"><button className="btn" onClick={onClose}>Later</button><button className="btn primary" onClick={save} disabled={!accts.length}><Check size={15} /> Save &amp; mark done</button></div>
      </div>
    </Modal>
  );
}
