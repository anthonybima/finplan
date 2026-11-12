import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, ArrowLeftRight, Target, Wallet, LineChart, ShieldAlert, Sparkles, Newspaper, CalendarCheck, Settings as Cog, Plus, Menu, Plug, Lock, LogOut, CandlestickChart, Monitor, Bot,
  Activity,
} from 'lucide-react';
import { useAppData } from './lib/store';
import type { Session } from './lib/auth';
import { Avatar } from './views/Login';
import { setLocale } from './lib/format';
import { setProxyAllowed } from './lib/net';
import type { AppData } from './lib/types';
import { Logo, ToastHost, toast } from './components/ui';
import { replaceSource } from './lib/holdings';
import { pluangConnectorAvailable, syncPluangConnector } from './lib/pluangConnector';
import { MonthlyBanner, MonthlyUpdateModal } from './components/MonthlyUpdate';
import SmartScan from './components/SmartScan';
import ImportData from './components/ImportData';
import AskClaude from './views/AskClaude';
import { SyncProvider, SyncChip, WelcomeSyncButton } from './components/Sync';
import { DevicePending, PendingDevicesBanner } from './components/Devices';
import { myDevice, registerDevice, type ThisDevice } from './lib/devices';
import { getDevice, removeLocalUser } from './lib/auth';
import { revalueFx } from './lib/fx';
import { monthlyOf, reminderLabel, reminderState, showReminderNotification } from './lib/reminders';
import Welcome from './views/Welcome';
import Dashboard from './views/Dashboard';
import Transactions, { TxnModal } from './views/Transactions';
import Plan from './views/Plan';
import Wealth from './views/Wealth';
import Analyst from './views/Analyst';
import Risk from './views/Risk';
import AdviceView from './views/AdviceView';
import News from './views/News';
import Weekly from './views/Weekly';
import SettingsView from './views/SettingsView';
import Connections from './views/Connections';
import Markets from './views/Markets';
import Recap from './views/Recap';
import { useViewMode } from './lib/viewMode';

export type Page = 'home' | 'markets' | 'recap' | 'txns' | 'plan' | 'wealth' | 'connections' | 'analyst' | 'risk' | 'advice' | 'ask' | 'news' | 'weekly' | 'settings';
export interface ViewProps { data: AppData; update: (fn: (d: AppData) => AppData) => void; go: (p: Page) => void; openImport?: (what?: 'auto' | 'accounts' | 'portfolio') => void; askClaude?: (question: string) => void; enterBalances?: (ids: string[]) => void }

const NAV: { id: Page; label: string; short?: string; icon: typeof LayoutDashboard }[] = [
  { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'markets', label: 'Markets', icon: CandlestickChart },
  { id: 'recap', label: 'Market recap', short: 'Recap', icon: Activity },
  { id: 'txns', label: 'Transactions', icon: ArrowLeftRight },
  { id: 'plan', label: 'Plan & Goals', icon: Target },
  { id: 'wealth', label: 'Wealth', icon: Wallet },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'analyst', label: 'Analyst', icon: LineChart },
  { id: 'risk', label: 'Risk', icon: ShieldAlert },
  { id: 'advice', label: 'Advice', icon: Sparkles },
  { id: 'ask', label: 'Ask Claude', icon: Bot },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'weekly', label: 'Weekly review', icon: CalendarCheck },
  { id: 'settings', label: 'Settings', icon: Cog },
];
const MOBILE: Page[] = ['home', 'markets', 'recap', 'wealth'];

export interface AppProps { session: Session; initial: AppData | null; persist: (d: AppData | null) => void; onLock: () => void; onSignOut: () => void }

export default function App({ session, initial, persist, onLock, onSignOut }: AppProps) {
  const { data, setData, update } = useAppData(initial, persist);
  const [page, setPage] = useState<Page>('home');
  const [sheet, setSheet] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);

  useEffect(() => { if (data) setLocale(data.settings.locale, data.settings.currency); }, [data?.settings.locale, data?.settings.currency]);
  useEffect(() => { window.scrollTo(0, 0); document.querySelector('.phone-scroll')?.scrollTo(0, 0); }, [page]);
  const [viewMode, setViewMode] = useViewMode();
  // ---- this device in the account's device list (Browser ID); removed devices erase the account from themselves ----
  const [thisDev, setThisDev] = useState<ThisDevice | null>(null);
  useEffect(() => { getDevice().then((i) => setThisDev({ id: i.id, short: i.short, browser: i.browser, os: i.os, platform: i.platform })).catch(() => {}); }, []);
  useEffect(() => { if (data && thisDev && registerDevice(data, thisDev)) update((d) => registerDevice(d, thisDev) ?? d); }, [!!data, thisDev, data?.devices]);
  // foreign-currency accounts: keep their rupiah value in step with the rates (USD/IDR, SGD/IDR…)
  useEffect(() => { if (data && revalueFx(data) !== data) update((d) => revalueFx(d)); }, [data?.settings.usdIdr, data?.settings.fxRates, data?.accounts]);
  const meRec = myDevice(data, thisDev?.id);
  useEffect(() => {
    if (meRec?.status !== 'removed') return;
    removeLocalUser(session.user.id);
    try { sessionStorage.setItem('finplan.removedNotice', `This device (${meRec.short}) was removed from “${session.user.name}” by ${meRec.statusBy || 'another device'}. FinPlan erased this account from it.`); } catch { /* */ }
    onSignOut();
  }, [meRec?.status]);
  useEffect(() => { setProxyAllowed(!data?.settings.privacyNoProxy); }, [data?.settings.privacyNoProxy]);

  // Inside Claude: pull the Pluang portfolio through Claude's Pluang connector when FinPlan opens (at most every 2 h).
  const pluangAuto = useRef(false);
  const hasData = !!data;
  useEffect(() => {
    if (!hasData || pluangAuto.current) return;
    pluangAuto.current = true;
    const c = data!.settings.connections.pluang, fresh = c?.lastSync && Date.now() - Date.parse(c.lastSync) < 2 * 3600_000 && c.status !== 'error';
    if (fresh && data!.holdings.some((h) => h.source === 'pluang')) return;
    (async () => {
      if (!(await pluangConnectorAvailable())) return;
      try {
        const r = await syncPluangConnector(data!.settings.usdIdr);
        update((d) => replaceSource(d, 'pluang', r.holdings, { via: 'mcp', summary: r.summary, message: `Live via Claude's Pluang connector · ${r.summary.positions} positions` }));
        toast(`Pluang portfolio synced: ${r.summary.positions} positions`);
      } catch (e: any) {
        update((d) => ({ ...d, settings: { ...d.settings, connections: { ...d.settings.connections, pluang: { ...d.settings.connections.pluang, status: 'error', message: e?.message || String(e) } } } }));
      }
    })();
  }, [hasData]);

  // Clock for reminders: re-evaluated every minute and when the app comes back to the foreground.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60_000);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const weeklyDue = useMemo(() => {
    const l = data?.settings.lastWeeklyReview;
    return !l || (now.getTime() - new Date(l).getTime()) / 864e5 > 7;
  }, [data?.settings.lastWeeklyReview, now]);

  // Monthly account update (default: 1st Sunday of the month)
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [needBal, setNeedBal] = useState<string[] | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [askPreset, setAskPreset] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState<null | 'auto' | 'accounts' | 'portfolio'>(null);
  const remDate = now.toDateString();
  const rem = useMemo(() => (data ? reminderState(data, now) : null), [data?.accounts, data?.settings.monthlyUpdate, remDate]);
  const monthlyDue = rem?.status === 'due' || rem?.status === 'overdue';
  const toldToday = useRef('');
  const notifying = useRef(false);
  useEffect(() => { // in-app toast, once a day while due
    if (!monthlyDue || toldToday.current === remDate) return;
    toldToday.current = remDate;
    toast(rem!.status === 'due' ? 'Today is your monthly account update' : 'Your monthly account update is waiting');
  }, [monthlyDue, remDate]);
  useEffect(() => { // device notification, once a month, from the set time on
    if (!data || !rem || !monthlyDue || notifying.current) return;
    const r = monthlyOf(data.settings);
    if (!r.notify || r.notifiedMonth === rem.month) return;
    const [hh, mm] = (r.time || '09:00').split(':').map(Number);
    if (rem.status === 'due' && now.getHours() * 60 + now.getMinutes() < (hh || 0) * 60 + (mm || 0)) return;
    notifying.current = true;
    showReminderNotification(`Time to update your accounts (${reminderLabel(r)}).`, () => setMonthlyOpen(true)).then((shown) => {
      if (shown) update((d) => ({ ...d, settings: { ...d.settings, monthlyUpdate: { ...monthlyOf(d.settings), notifiedMonth: rem.month } } }));
    }).finally(() => { notifying.current = false; });
  }, [monthlyDue, rem?.month, now, data?.settings.monthlyUpdate]);

  if (!data) return <SyncProvider uid={session.user.id} name={session.user.name} data={data} setData={setData}><Welcome extra={<WelcomeSyncButton />} onStart={(d) => setData({ ...d, settings: { ...d.settings, name: d.settings.name || session.user.name } })} /><ToastHost /></SyncProvider>;

  const go = (p: Page) => { setPage(p); setSheet(false); };
  const props: ViewProps = { data, update, go, openImport: (w = 'auto') => setImportOpen(w), askClaude: (q) => { setAskPreset(q); go('ask'); }, enterBalances: (ids) => setNeedBal(ids) };
  const views: Record<Page, JSX.Element> = {
    home: <Dashboard {...props} weeklyDue={weeklyDue} />, markets: <Markets {...props} />, recap: <Recap {...props} />, txns: <Transactions {...props} />, plan: <Plan {...props} />,
    wealth: <Wealth {...props} />, connections: <Connections {...props} />, analyst: <Analyst {...props} />, risk: <Risk {...props} />, advice: <AdviceView {...props} />, ask: <AskClaude {...props} preset={askPreset} onPresetUsed={() => setAskPreset(null)} />,
    news: <News {...props} />, weekly: <Weekly {...props} />, settings: <SettingsView {...props} onReset={() => setData(null)} session={session} onSignOut={onSignOut} thisDevice={thisDev} />,
  };

  if (meRec?.status === 'pending') return <SyncProvider uid={session.user.id} name={session.user.name} data={data} setData={setData}><DevicePending rec={meRec} onSignOut={onSignOut} /><ToastHost /></SyncProvider>;
  if (meRec?.status === 'removed') return null;

  return (
    <SyncProvider uid={session.user.id} name={session.user.name} data={data} setData={setData}>
    <div className="app">
      <aside className="sidebar">
        <div className="logo"><Logo />FinPlan</div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-btn ${page === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
            <n.icon size={18} />{n.label}{n.id === 'weekly' && weeklyDue && <span className="dot" title="Weekly review due" />}{(n.id === 'home' || n.id === 'wealth') && monthlyDue && <span className="dot" title="Monthly account update due" />}
          </button>
        ))}
        <div style={{ marginTop: 18, padding: '0 10px' }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => setQuickAdd(true)}><Plus size={16} /> Add transaction</button>
        </div>
        <div className="user-chip">
          <Avatar u={session.user} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.name}</div><div className="uc-sub">🔒 Encrypted</div></div>
          <button className="btn ghost sm" title="Lock" onClick={onLock}><Lock size={16} /></button>
          <button className="btn ghost sm" title="Sign out" onClick={onSignOut}><LogOut size={16} /></button>
        </div>
        <div style={{ padding: '6px 10px 0' }}><SyncChip /></div>
      </aside>

      <main>
        <div className="sync-mobile"><SyncChip /></div>
        <PendingDevicesBanner data={data} update={update} me={thisDev} />
        {rem && (page === 'home' || page === 'wealth') && <MonthlyBanner state={rem} data={data} update={update} onOpen={() => setMonthlyOpen(true)} />}
        {views[page]}
      </main>

      {page !== 'ask' && <button className="fab" onClick={() => setQuickAdd(true)} aria-label="Add transaction"><Plus size={26} /></button>}
      <nav className="bottom-nav">
        {MOBILE.map((id) => { const n = NAV.find((x) => x.id === id)!; return (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)}><span className="ico-wrap"><n.icon size={21} />{id === 'home' && monthlyDue && <span className="dot" />}</span>{n.short || n.label.split(' ')[0]}</button>
        ); })}
        <button className={!MOBILE.includes(page) ? 'active' : ''} onClick={() => setSheet(true)}><Menu size={21} />More</button>
      </nav>
      {sheet && (
        <div className="sheet-bg" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !MOBILE.includes(n.id)).map((n) => (
              <button key={n.id} onClick={() => go(n.id)}><n.icon size={22} />{n.label}</button>
            ))}
            <button onClick={onLock}><Lock size={22} />Lock</button>
            {viewMode === 'phone' && <button onClick={() => { setViewMode('auto'); setSheet(false); }}><Monitor size={22} />Desktop view</button>}
            <button onClick={onSignOut}><LogOut size={22} />Sign out</button>
          </div>
        </div>
      )}
      {quickAdd && <TxnModal data={data} update={update} onClose={() => setQuickAdd(false)} />}
      {monthlyOpen && <MonthlyUpdateModal data={data} update={update} go={go} onClose={() => setMonthlyOpen(false)} onScan={() => setScanOpen(true)} onImport={() => setImportOpen('accounts')} />}
      {needBal && <MonthlyUpdateModal data={data} update={update} go={go} focusIds={needBal} onClose={() => setNeedBal(null)} onScan={() => setScanOpen(true)} onImport={() => setImportOpen('accounts')} />}
      {scanOpen && <SmartScan data={data} update={update} onClose={() => setScanOpen(false)} />}
      {importOpen && <ImportData data={data} update={update} go={go} what={importOpen} onClose={() => setImportOpen(null)} onNeedBalances={(ids) => { go('wealth'); setNeedBal(ids); }} />}
      <ToastHost />
    </div>
    </SyncProvider>
  );
}
