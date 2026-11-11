import { useMemo, useState } from 'react';
import { Plus, Trash2, Upload, FolderTree, Pencil, Search, Eye, EyeOff, Landmark, Smartphone, Banknote, TrendingUp, Home, CreditCard, CalendarDays, ChevronRight, MoreHorizontal, Link2, List, LayoutGrid, Rows3 } from 'lucide-react';
import type { ViewProps } from '../App';
import type { Account, AccountKind, AssetClass, Holding } from '../lib/types';
import { balances, isLiquid } from '../lib/analytics';
import { ASSUMPTIONS } from '../lib/risk';
import { fmtDate, money, today } from '../lib/format';
import { uid } from '../lib/store';
import { Card, Field, Modal, MoneyInput, Seg, Stat, toast } from '../components/ui';
import { ageLabel, normYear, wealthByYear } from '../lib/wealthYears';
import { costIDR, SOURCE_LABEL, syncAccounts, valueIDR } from '../lib/holdings';
import { detectInstitution, groupOf, knownGroups } from '../lib/institutions';
import { cleanNo, fmtNo, refOf, showNo } from '../lib/accountNo';
import BulkEditAccounts from '../components/BulkEditAccounts';
import { DemoBanner } from '../components/DemoBanner';
import { InsuranceSection } from '../components/Insurance';
import { bondInfo, maturityLabel } from '../lib/bonds';
import { fmtTenor, parseTenor } from '../lib/tenor';
import { ccyInfo, CURRENCIES, exposure, fetchRates, fmtFx, fmtRate, isFx, parseFxAmount, rateInfo, rateOf, usdOf, usedCurrencies, withRate } from '../lib/fx';
const Ccy = ({ a }: { a: Account }) => <span className={`ccy-tag ${isFx(a) ? 'fx' : ''}`}>{a.currency || 'IDR'}</span>;

/** Balance as the bank shows it: "US$ 12,500.00 ≈ Rp 206 jt" for foreign-currency accounts. */
function Bal({ a, block }: { a: Account; block?: boolean }) {
  if (a.needsBalance) return <NoBal />;
  const sign = a.kind === 'debt' ? '−' : '';
  if (!isFx(a)) return <>{sign}{money(a.balance)}</>;
  return <span title={`${a.currency}/IDR rate used for net worth`}>{sign}{fmtFx(a.fxBalance ?? 0, a.currency)}{block ? <br /> : ' '}<span className="small muted">≈ {sign}{money(a.balance)}</span></span>;
}

/** Wealth by currency, with the total in rupiah and US dollars. */
function CurrencyCard({ data }: { data: ViewProps['data'] }) {
  const rows = useMemo(() => exposure(data, valueIDR), [data]);
  if (!rows.length) return null;
  const net = rows.reduce((s, r) => s + r.netIdr, 0);
  return (
    <Card title="Wealth by currency" className="mt" action={<span className="small"><b>{money(net)}</b> · ≈ <b>{usdOf(data.settings, net)}</b></span>}>
      <div className="scroll-x"><table className="table">
        <thead><tr><th>Currency</th><th className="r">Amount</th><th className="r">In rupiah</th><th className="r">In US$</th><th className="r hide-m">Share of assets</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.code}>
            <td><span className={`ccy-tag ${r.code !== 'IDR' ? 'fx' : ''}`}>{r.code}</span> <span className="small muted">{ccyInfo(r.code)?.label || ''} · {r.count}</span></td>
            <td className="r" style={{ whiteSpace: 'nowrap' }}>{r.code === 'IDR' ? '—' : fmtFx(r.native, r.code)}</td>
            <td className={`r ${r.netIdr < 0 ? 'neg' : ''}`} style={{ whiteSpace: 'nowrap' }}>{money(r.netIdr)}</td>
            <td className="r" style={{ whiteSpace: 'nowrap' }}>{usdOf(data.settings, r.netIdr)}</td>
            <td className="r small hide-m">{Math.round(r.share * 100)}%</td>
          </tr>))}</tbody>
      </table></div>
      <div className="small muted mt-s">Includes app positions in their own currency (US stocks in USD). US$ at USD/IDR {fmtRate(rateOf(data.settings, 'USD'))}.</div>
    </Card>
  );
}

/** Exchange rates used for foreign-currency accounts: live where reachable, or typed in. */
function RatesCard({ data, update }: { data: ViewProps['data']; update: ViewProps['update'] }) {
  const used = usedCurrencies(data);
  const [busy, setBusy] = useState(false);
  if (!used.length) return null;
  const refresh = async () => {
    setBusy(true);
    const r = await fetchRates(used);
    const got = Object.keys(r);
    if (got.length) update((d) => { let st = d.settings; for (const c of got) st = withRate(st, c, r[c], 'live'); return { ...d, settings: st }; });
    toast(got.length ? `Rates updated: ${got.map((c) => `${c} ${fmtRate(r[c])}`).join(' · ')}` : 'Live rates are not reachable here (e.g. inside Claude). Type the rate from your bank app.');
    setBusy(false);
  };
  return (
    <Card title="Exchange rates" className="mt" action={<button className="btn sm" disabled={busy} onClick={refresh}>{busy ? 'Updating…' : 'Update rates'}</button>}>
      <div className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>Foreign-currency accounts are counted in rupiah at these rates. Type your bank's rate to override.</div>
      <div className="rates-row">
        {used.map((c) => { const ri = rateInfo(data.settings, c); const n = data.accounts.filter((a) => a.currency === c);
          return (
            <label key={c} className="rate-box">
              <span className="small"><b>{c}/IDR</b> · {n.length} account{n.length === 1 ? '' : 's'}</span>
              <input className="input" inputMode="decimal" aria-label={`${c}/IDR rate`} key={ri.rate} defaultValue={String(ri.rate)} onBlur={(e) => { const v = Number(e.target.value.replace(/\./g, '').replace(',', '.')); if (v > 0 && v !== ri.rate) { update((d) => ({ ...d, settings: withRate(d.settings, c, v, 'manual') })); toast(`${c}/IDR set to ${fmtRate(v)}`); } }} />
              <span className={`small ${ri.src === 'default' ? 'warn-text' : 'muted'}`}>{ri.src === 'default' ? 'approximate: update or type it' : `${ri.src === 'live' ? 'live' : 'typed'}${ri.at ? ' · ' + fmtDate(ri.at.slice(0, 10)) : ''}`}</span>
            </label>); })}
      </div>
    </Card>
  );
}
import { Table2 } from 'lucide-react';
export { groupOf };
const signed = (a: Account) => (a.kind === 'debt' ? -a.balance : a.balance);
export function groupAccounts(accts: Account[]) {
  const m = new Map<string, Account[]>();
  for (const a of accts) { const g = groupOf(a); m.set(g, [...(m.get(g) || []), a]); }
  return [...m.entries()].map(([name, list]) => ({ name, list: list.sort((a, z) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(z.kind) || z.balance - a.balance), total: list.reduce((s, a) => s + signed(a), 0) }))
    .sort((a, z) => (a.name === 'Other' ? 1 : z.name === 'Other' ? -1 : z.total - a.total || a.name.localeCompare(z.name)));
}
type GroupBy = 'type' | 'bank' | 'currency';
type Section = { name: string; list: Account[]; total: number; code?: string; native?: number };
/** Accounts grouped by type, bank / app or currency, each group with its net rupiah total. */
function sectionsOf(by: GroupBy, accts: Account[]): Section[] {
  if (by === 'bank') return groupAccounts(accts);
  if (by === 'currency') return groupByCurrency(accts);
  return KIND_ORDER.map((k) => { const list = accts.filter((a) => a.kind === k).sort((a, z) => z.balance - a.balance); return { name: KIND_LABEL[k], list, total: list.reduce((s, a) => s + signed(a), 0) }; }).filter((g) => g.list.length);
}
const isEmptyAcct = (a: Account) => !!a.needsBalance || (!a.balance && !(a.fxBalance ?? 0));

/** Compact list: one line per group (tap to open), one line per account. Fits a phone screen. */
function CompactList({ data, by, reveal, onOpen, missing, onEnter }: { data: ViewProps['data']; by: GroupBy; reveal: boolean; onOpen: (a: Account) => void; missing: number; onEnter: () => void }) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const filled = hideEmpty ? data.accounts.filter((a) => !isEmptyAcct(a)) : data.accounts;
  const empty = hideEmpty ? data.accounts.filter(isEmptyAcct) : [];
  const secs = useMemo(() => sectionsOf(by, filled), [by, filled]);
  const [openSet, setOpen] = useState<Set<string>>(() => new Set());
  const all = [...secs.map((g) => g.name), ...(empty.length ? ['__empty'] : [])];
  const toggle = (n: string) => setOpen((o) => { const x = new Set(o); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const Row = ({ a }: { a: Account }) => (
    <button className="cl-acct" onClick={() => onOpen(a)}>
      <span className="cl-name">{a.name}{isFx(a) && <> <span className="ccy-tag fx">{a.currency}</span></>}<span className="cl-sub">{[by !== 'bank' && groupOf(a) !== 'Other' && groupOf(a) !== a.name ? groupOf(a) : '', by !== 'type' ? KIND_LABEL[a.kind] : '', showNo(a, reveal), a.interestRate ? `${a.interestRate}%` : '', a.tenorMonths ? fmtTenor(a.tenorMonths) : '', a.maturity ? maturityLabel(a.maturity).split(' · ')[0] : ''].filter(Boolean).join(' · ')}</span></span>
      <span className={`cl-amt ${a.kind === 'debt' ? 'neg' : ''}`}>{a.needsBalance ? <span className="muted small">not entered</span> : isFx(a) ? <>{a.kind === 'debt' ? '−' : ''}{fmtFx(a.fxBalance ?? 0, a.currency)}<span className="cl-sub r">≈ {money(a.balance, true)}</span></> : <>{a.kind === 'debt' ? '−' : ''}{money(a.balance, true)}</>}</span>
    </button>
  );
  return (
    <div className="card mt cl">
      <div className="cl-tools">
        <label className="small row" style={{ gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty</label>
        <span className="grow" />
        {missing > 0 && <button className="btn sm warn-btn" onClick={onEnter} title="Accounts without a balance">Enter {missing} balance{missing === 1 ? '' : 's'}</button>}
        <button className="btn ghost sm" onClick={() => setOpen(openSet.size ? new Set() : new Set(all))}>{openSet.size ? 'Collapse' : 'Expand'} all</button>
      </div>
      {secs.map((g) => (
        <div key={g.name} className={`cl-group ${openSet.has(g.name) ? 'open' : ''}`}>
          <button className="cl-head" onClick={() => toggle(g.name)} aria-expanded={openSet.has(g.name)}>
            <ChevronRight size={16} className="cl-chev" />
            <span className="cl-name"><b>{g.name}</b> <span className="muted small">{g.list.length}</span>{g.native != null && g.code !== 'IDR' ? <span className="cl-sub">{fmtFx(g.native, g.code)}</span> : null}</span>
            <span className={`cl-amt ${g.total < 0 ? 'neg' : ''}`}><b>{money(g.total, true)}</b>{g.code !== 'USD' && <span className="cl-sub r">≈ {usdOf(data.settings, g.total)}</span>}</span>
          </button>
          {openSet.has(g.name) && <div className="cl-body">{g.list.map((a) => <Row key={a.id} a={a} />)}</div>}
        </div>
      ))}
      {empty.length > 0 && (
        <div className={`cl-group ${openSet.has('__empty') ? 'open' : ''}`}>
          <button className="cl-head" onClick={() => toggle('__empty')} aria-expanded={openSet.has('__empty')}>
            <ChevronRight size={16} className="cl-chev" /><span className="cl-name"><b>Empty or not entered</b> <span className="muted small">{empty.length}</span></span><span className="cl-amt muted small">Rp 0</span>
          </button>
          {openSet.has('__empty') && <div className="cl-body">{empty.map((a) => <Row key={a.id} a={a} />)}</div>}
        </div>
      )}
      {!data.accounts.length && <div className="empty small">No accounts yet. Tap + to add one, or Import data.</div>}
    </div>
  );
}

/** How net worth is made: every amount added, every debt subtracted, and what is NOT counted (and why). */
function NetWorthBreakdown({ data, onClose, onOpen }: { data: ViewProps['data']; onClose: () => void; onOpen: (a: Account) => void }) {
  const b = balances(data.accounts);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const counted = data.accounts.filter((a) => !a.needsBalance && a.balance);
  const rows = ([
    { key: 'cash', label: 'Cash & bank', list: counted.filter((a) => !a.synced && isLiquid(a)), sign: 1, note: 'bank, e-wallet, cash, RDN, deposito' },
    { key: 'inv', label: 'Investments', note: 'funds, bonds, gold, crypto you track by hand', list: counted.filter((a) => !a.synced && a.kind === 'investment' && !isLiquid(a)), sign: 1 },
    { key: 'apps', label: 'Connected apps', list: counted.filter((a) => a.synced), sign: 1, note: 'positions + their cash (e.g. Pluang USD Cash, USDT)' },
    { key: 'other', label: 'Other assets', list: counted.filter((a) => !a.synced && a.kind === 'asset'), sign: 1 },
    { key: 'debt', label: 'Debts', list: counted.filter((a) => a.kind === 'debt'), sign: -1 },
  ] as { key: string; label: string; list: Account[]; sign: 1 | -1; note?: string }[]).filter((r) => r.list.length);
  const notEntered = data.accounts.filter((a) => a.needsBalance);
  const zero = data.accounts.filter((a) => !a.needsBalance && !a.balance && !a.synced);
  const excluded = data.holdings.filter((h) => h.excluded);
  const sum = (l: Account[]) => l.reduce((s, a) => s + a.balance, 0);
  const AcctLine = ({ a }: { a: Account }) => (
    <button className="cl-acct" onClick={() => { onClose(); onOpen(a); }}>
      <span className="cl-name">{a.name}{isFx(a) && <> <span className="ccy-tag fx">{a.currency}</span></>}<span className="cl-sub">{KIND_LABEL[a.kind]}{a.assetClass && a.kind !== 'debt' ? ` · ${ASSUMPTIONS[a.assetClass].label.split(' (')[0]}` : ''}{a.synced ? ' · synced' : ''}</span></span>
      <span className="cl-amt">{isFx(a) ? <>{fmtFx(a.fxBalance ?? 0, a.currency)}<span className="cl-sub r">≈ {money(a.balance)}</span></> : money(a.balance)}</span>
    </button>
  );
  return (
    <Modal title="How your net worth is calculated" onClose={onClose} wide>
      <div className="nw-calc">
        {rows.map((r) => (
          <div key={r.key} className="cl-group">
            <button className="cl-head" onClick={() => setOpenRow(openRow === r.key ? null : r.key)} aria-expanded={openRow === r.key}>
              <ChevronRight size={16} className="cl-chev" style={openRow === r.key ? { transform: 'rotate(90deg)' } : undefined} />
              <span className="cl-name"><b>{r.sign > 0 ? '+' : '−'} {r.label}</b> <span className="muted small">{r.list.length}</span>{r.note && <span className="cl-sub">{r.note}</span>}</span>
              <span className={`cl-amt ${r.sign < 0 ? 'neg' : ''}`}><b>{r.sign < 0 ? '−' : ''}{money(sum(r.list))}</b></span>
            </button>
            {openRow === r.key && <div className="cl-body">{r.list.sort((x, y) => y.balance - x.balance).map((a) => <AcctLine key={a.id} a={a} />)}</div>}
          </div>
        ))}
        <div className="nw-total"><span>= <b>Net worth</b></span><span><b>{money(b.netWorth)}</b><span className="cl-sub r">≈ {usdOf(data.settings, b.netWorth)}</span></span></div>
      </div>
      {(notEntered.length > 0 || zero.length > 0 || excluded.length > 0 || (data.policies || []).length > 0) && <>
        <h4 style={{ margin: '14px 0 4px' }}>Not counted</h4>
        {[{ key: 'ne', label: 'Balance not entered yet', list: notEntered, why: 'Imported without an amount: enter it (tap an account) and it counts.' },
          { key: 'zero', label: 'Balance is Rp 0', list: zero, why: 'Set to 0 (e.g. closed or emptied). Enter the amount if there is money in it.' }].filter((r) => r.list.length).map((r) => (
          <div key={r.key} className="cl-group">
            <button className="cl-head" onClick={() => setOpenRow(openRow === r.key ? null : r.key)}><ChevronRight size={16} className="cl-chev" style={openRow === r.key ? { transform: 'rotate(90deg)' } : undefined} />
              <span className="cl-name"><b>{r.label}</b> <span className="muted small">{r.list.length}</span><span className="cl-sub">{r.why}</span></span><span className="cl-amt muted">Rp 0</span></button>
            {openRow === r.key && <div className="cl-body">{r.list.map((a) => <AcctLine key={a.id} a={a} />)}</div>}
          </div>))}
        {(data.policies || []).length > 0 && <div className="small muted mt-s">{(data.policies || []).length} insurance polic{(data.policies || []).length === 1 ? 'y' : 'ies'}: protection, not wealth (Insurance section).</div>}
        {excluded.length > 0 && <div className="small muted mt-s">{excluded.length} position{excluded.length === 1 ? '' : 's'} excluded on purpose (e.g. Alpaca paper trading).</div>}
      </>}
      <p className="small muted" style={{ marginBottom: 0 }}>Net worth = everything you own − everything you owe. Cash is one part of what you own, so it is counted once. Tap any account to edit it.</p>
    </Modal>
  );
}

/** Extra sections as tabs, so the page stays one screen. */
function MoreTabs({ data, update }: { data: ViewProps['data']; update: ViewProps['update'] }) {
  const fx = usedCurrencies(data).length > 0;
  const tabs = [{ v: 'currency', l: 'By currency' }, ...(fx ? [{ v: 'rates', l: 'Rates' }] : []), { v: 'year', l: 'By year' }];
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('finplan.wealthTab') || 'none'; } catch { return 'none'; } });
  const pick = (v: string) => { const n = tab === v ? 'none' : v; setTab(n); try { localStorage.setItem('finplan.wealthTab', n); } catch { /* */ } };
  return (
    <div className="mt">
      <div className="tabs-row">{tabs.map((t) => <button key={t.v} className={`chip ${tab === t.v ? 'on' : ''}`} onClick={() => pick(t.v)}>{t.l}</button>)}</div>
      {tab === 'currency' && <CurrencyCard data={data} />}
      {tab === 'rates' && fx && <RatesCard data={data} update={update} />}
      {tab === 'year' && data.accounts.length > 0 && <ByYear data={data} />}
    </div>
  );
}
/** One section per currency: "USD · US dollar", net total in rupiah, plus the amount in that currency. */
export function groupByCurrency(accts: Account[]) {
  const m = new Map<string, Account[]>();
  for (const a of accts) { const c = (a.currency || 'IDR').toUpperCase(); m.set(c, [...(m.get(c) || []), a]); }
  return [...m.entries()].map(([c, list]) => ({ name: `${c} · ${ccyInfo(c)?.label || c}`, code: c, list: list.sort((a, z) => z.balance - a.balance), total: list.reduce((s, a) => s + signed(a), 0), native: c === 'IDR' ? undefined : list.reduce((s, a) => s + (a.kind === 'debt' ? -1 : 1) * (a.fxBalance ?? 0), 0) }))
    .sort((a, z) => (a.code === 'IDR' ? -1 : z.code === 'IDR' ? 1 : z.total - a.total));
}
const KIND_ORDER: AccountKind[] = ['bank', 'ewallet', 'cash', 'investment', 'asset', 'debt'];
const NoBal = () => <span className="pill warn">balance not entered</span>;
/** Account number: masked (···9990) or, when revealed, the full number; click to copy. */
function AcctNo({ a, reveal }: { a: Account; reveal: boolean }) {
  const t = showNo(a, reveal); if (!t) return null;
  if (!reveal || !a.accountNo) return <span className="acct-no" title="Account number (Show numbers to see it)">{t}</span>;
  return <button className="acct-no btnlike" title="Copy account number" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(cleanNo(a.accountNo!)).then(() => toast('Account number copied')).catch(() => {}); }}>{t}</button>;
}

export const KIND_LABEL: Record<AccountKind, string> = { bank: 'Bank account', ewallet: 'E-wallet', cash: 'Cash', investment: 'Investment', asset: 'Other asset', debt: 'Debt / loan' };
const KIND_ICON = { bank: Landmark, ewallet: Smartphone, cash: Banknote, investment: TrendingUp, asset: Home, debt: CreditCard };

export default function Wealth({ data, update, go, openImport, enterBalances }: ViewProps) {
  const b = balances(data.accounts);
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const groups = KIND_ORDER;
  type View = 'compact' | 'cards' | 'table';
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('finplan.wealthView2') as View) || 'compact'; } catch { return 'compact'; } });
  const pickView = (v: View) => { setView(v); try { localStorage.setItem('finplan.wealthView2', v); } catch { /* */ } };
  const [menu, setMenu] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [by, setBy] = useState<GroupBy>(() => { try { return (localStorage.getItem('finplan.wealthGroup') as GroupBy) || 'type'; } catch { return 'type'; } });
  const pickBy = (v: GroupBy) => { setBy(v); try { localStorage.setItem('finplan.wealthGroup', v); } catch { /* */ } };
  const missing = data.accounts.filter((a) => a.needsBalance && !a.synced);
  const banks = useMemo(() => groupAccounts(data.accounts), [data.accounts]);
  const cards = useMemo(() => (by === 'currency' ? groupByCurrency(data.accounts) : banks), [by, banks, data.accounts]);
  const [groupEdit, setGroupEdit] = useState<string | null>(null);
  // account numbers are shown in full (the app is protected at sign-in); "Hide numbers" masks them, e.g. when sharing your screen
  const [reveal, setRevealS] = useState(() => { try { return localStorage.getItem('finplan.hideNumbers') !== '1'; } catch { return true; } });
  const setReveal = (f: (v: boolean) => boolean) => setRevealS((v) => { const n = f(v); try { localStorage.setItem('finplan.hideNumbers', n ? '0' : '1'); } catch { /* */ } return n; });
  const [bulkEdit, setBulkEdit] = useState(false);
  const open = (a: Account) => (a.synced ? go('connections') : setEdit(a));
  const setAccountYear = (id: string, y?: string) => update((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, opened: y } : a)) }));
  const setHoldingYear = (id: string, y?: string) => update((d) => syncAccounts({ ...d, holdings: d.holdings.map((h) => (h.id === id ? { ...h, opened: y } : h)) }));
  return (
    <>
      <div className="page-head wealth-head">
        <div><h1>Wealth</h1><div className="sub hide-m">Accounts, investments and debts — update balances weekly</div></div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary" onClick={() => setEdit('new')}><Plus size={16} /> <span className="hide-m">Add account</span></button>
          <div className="menu-wrap">
            <button className="btn" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></button>
            {menu && <div className="menu-backdrop" onClick={() => setMenu(false)} />}
            {menu && <div className="menu" onClick={() => setMenu(false)}>
              <button onClick={() => openImport?.('auto')}><Upload size={15} /> Import data</button>
              <button onClick={() => setBulkEdit(true)}><Table2 size={15} /> Bulk edit</button>
              <button onClick={() => setGroupEdit('')}><FolderTree size={15} /> Groups</button>
              <button onClick={() => setReveal((v) => !v)}>{reveal ? <EyeOff size={15} /> : <Eye size={15} />} {reveal ? 'Hide account numbers' : 'Show account numbers'}</button>
              <button onClick={() => go('connections')}><Link2 size={15} /> Connect apps</button>
            </div>}
          </div>
        </div>
      </div>
      <DemoBanner data={data} update={update} />
      {view === 'compact' ? (
        <div className="card w-sum clickable" role="button" tabIndex={0} title="Tap to see how net worth is calculated" onClick={() => setShowCalc(true)} onKeyDown={(e) => { if (e.key === 'Enter') setShowCalc(true); }}>
          <div className="w-nw"><span className="small muted">Net worth</span><b>{money(b.netWorth, true)}</b><span className="small muted">≈ {usdOf(data.settings, b.netWorth)}</span></div>
          <div className="w-mini"><span className="small muted">Assets</span><b>{money(b.assets, true)}</b></div>
          <div className="w-mini"><span className="small muted">− Debt</span><b className="neg">{money(b.liabilities, true)}</b></div>
          <div className="w-mini"><span className="small muted">Cash <span className="hide-m">(in assets)</span></span><b>{money(b.liquid, true)}</b></div>
          <div className="w-eq small muted">Net worth = assets − debt (cash is part of assets). <span className="linklike">Tap to see the calculation{data.accounts.some((a) => a.needsBalance || (!a.balance && !a.synced)) ? ' and what is not counted' : ''} ›</span></div>
        </div>
      ) : <div className="grid g4 keep">
        <div onClick={() => setShowCalc(true)} className="clickable" title="Tap to see how net worth is calculated"><Stat label="Net worth" value={money(b.netWorth, true)} delta={`≈ ${usdOf(data.settings, b.netWorth)} · how? ›`} /></div>
        <Stat label="Total assets" value={money(b.assets, true)} delta={`≈ ${usdOf(data.settings, b.assets)}`} />
        <Stat label="Liquid cash" value={money(b.liquid, true)} delta={`≈ ${usdOf(data.settings, b.liquid)}`} />
        <Stat label="Debt" value={money(b.liabilities, true)} delta={b.debtPayments ? `${money(b.debtPayments)}/mo payments` : undefined} />
      </div>}
      <div className="w-tools mt-s">
        <Seg value={by} onChange={pickBy} options={[{ v: 'type', l: 'Type' }, { v: 'bank', l: 'Bank' }, { v: 'currency', l: 'Currency' }]} />
        <div className="seg seg-icons" role="group" aria-label="View">
          {([['compact', List, 'Compact'], ['cards', LayoutGrid, 'Cards'], ['table', Rows3, 'Table']] as const).map(([v, I, l]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => pickView(v)} aria-label={l} title={l}><I size={16} /><span className="hide-m"> {l}</span></button>))}
        </div>
      </div>
      {missing.length > 0 && view !== 'compact' && (
        <div className="w-missing mt-s"><span className="small"><b>{missing.length}</b> without a balance</span>
          <button className="btn sm primary" onClick={() => enterBalances?.(missing.map((a) => a.id))}>Enter balances</button></div>
      )}
      {bulkEdit ? <BulkEditAccounts data={data} update={update} onClose={() => setBulkEdit(false)} /> : view === 'compact' ? <CompactList data={data} by={by} reveal={reveal} onOpen={open} missing={missing.length} onEnter={() => enterBalances?.(missing.map((a) => a.id))} /> : view === 'table' ? <WealthTable data={data} by={by} reveal={reveal} onEdit={open} setAccountYear={setAccountYear} setHoldingYear={setHoldingYear} /> : by !== 'type' ? (
      <div className="grid g2 mt">
        {cards.map((g) => (
          <Card key={g.name} title={<span className="row" style={{ gap: 6, alignItems: 'center' }}>{g.name}{by === 'bank' && <button className="btn ghost sm icon-only" title={`Edit group ${g.name}`} aria-label={`Edit group ${g.name}`} onClick={() => setGroupEdit(g.name)}><Pencil size={13} /></button>}</span>} action={<b className={g.total < 0 ? 'neg' : ''}>{money(g.total)}</b>}>
            <div className="small muted" style={{ marginTop: -6, marginBottom: 6 }}>{(g as any).native != null ? <><b>{fmtFx((g as any).native, (g as any).code)}</b> · </> : ''}{(g as any).code !== 'USD' ? <>≈ {usdOf(data.settings, g.total)} · </> : ''}{g.list.length} account{g.list.length === 1 ? '' : 's'}{(() => { const n = g.list.filter((a) => a.needsBalance).length; return n ? ` · ${n} without balance` : ''; })()}</div>
            {g.list.map((a) => { const I = KIND_ICON[a.kind]; return (
              <div key={a.id} className="item" style={{ cursor: 'pointer' }} onClick={() => open(a)}>
                <div className="ico"><I size={18} /></div>
                <div className="grow"><div className="title">{a.name} <Ccy a={a} /></div>
                  <div className="small muted">{a.assetClass && a.kind !== 'debt' ? ASSUMPTIONS[a.assetClass].label.split(' (')[0] : KIND_LABEL[a.kind]}{showNo(a, reveal) ? <> · <AcctNo a={a} reveal={reveal} /></> : ''}{a.interestRate ? ` · ${a.interestRate}%/yr` : ''}{a.tenorMonths ? ` · ${fmtTenor(a.tenorMonths)}` : ''}{a.maturity ? ` · ${maturityLabel(a.maturity)}` : ''}{a.opened ? ` · since ${a.opened.slice(0, 4)}` : ''}{a.synced ? ' · auto-synced' : ''}</div></div>
                <div className={`amt ${a.kind === 'debt' ? 'neg' : ''}`}><Bal a={a} block /></div>
              </div>); })}
          </Card>
        ))}
      </div>
      ) : (
      <div className="grid g2 mt">
        {groups.map((k) => {
          const list = data.accounts.filter((a) => a.kind === k);
          if (!list.length) return null;
          const I = KIND_ICON[k];
          return (
            <Card key={k} title={KIND_LABEL[k]} action={<b>{money(list.reduce((s, a) => s + a.balance, 0))}</b>}>
              {list.map((a) => (
                <div key={a.id} className="item" style={{ cursor: 'pointer' }} onClick={() => (a.synced ? go('connections') : setEdit(a))}>
                  <div className="ico"><I size={18} /></div>
                  <div className="grow"><div className="title">{a.name} <Ccy a={a} /></div>
                    <div className="small muted">
                      {a.assetClass && k !== 'debt' ? ASSUMPTIONS[a.assetClass].label + ' · ' : ''}
                      {groupOf(a) !== 'Other' && groupOf(a) !== a.name ? `${groupOf(a)} · ` : ''}{showNo(a, reveal) ? <><AcctNo a={a} reveal={reveal} /> · </> : ''}{a.synced ? 'auto-synced · ' : ''}{a.interestRate ? `${a.interestRate}%/yr · ` : ''}{a.tenorMonths ? `${fmtTenor(a.tenorMonths)} · ` : ''}{a.maturity ? `${maturityLabel(a.maturity)} · ` : ''}{a.monthlyPayment ? `${money(a.monthlyPayment)}/mo · ` : ''}{a.updatedAt ? `updated ${fmtDate(a.updatedAt)}` : 'not updated yet'}{a.opened ? ` · since ${a.opened.slice(0, 4)}` : ''}
                    </div></div>
                  <div className={`amt ${k === 'debt' ? 'neg' : ''}`}><Bal a={a} block /></div>
                </div>
              ))}
            </Card>
          );
        })}
      </div>
      )}
      {!bulkEdit && <InsuranceSection data={data} update={update} />}
      <MoreTabs data={data} update={update} />
      {!data.accounts.length && <Card className="mt"><div className="empty">Add your bank accounts, e-wallets (GoPay, OVO, DANA…), investments (stocks, mutual funds, SBN, gold, crypto) and debts (KPR, car loan, credit cards, paylater).</div></Card>}
      {showCalc && <NetWorthBreakdown data={data} onClose={() => setShowCalc(false)} onOpen={open} />}
      {groupEdit !== null && <GroupsModal data={data} update={update} start={groupEdit} onClose={() => setGroupEdit(null)} />}
      {edit && <AccountModal settings={data.settings} a={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} update={update} groups={knownGroups([...banks.map((g) => g.name).filter((n) => n !== 'Other')])} />}
    </>
  );
}

/** Create a group (e.g. "Mandiri") and choose which accounts are in it; rename or merge groups. */
function GroupsModal({ data, update, start, onClose }: { data: ViewProps['data']; update: ViewProps['update']; start: string; onClose: () => void }) {
  const all = useMemo(() => groupAccounts(data.accounts), [data.accounts]);
  const [orig, setOrig] = useState(start);
  const [name, setName] = useState(start);
  const [q, setQ] = useState('');
  const memberIds = (g: string) => new Set(data.accounts.filter((a) => g && groupOf(a) === g).map((a) => a.id));
  const [sel, setSel] = useState<Set<string>>(() => memberIds(start));
  const load = (g: string) => { setOrig(g); setName(g); setSel(memberIds(g)); };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clean = name.trim();
  const merging = clean && clean !== orig && all.some((g) => g.name.toLowerCase() === clean.toLowerCase());
  const ql = q.toLowerCase();
  const save = () => {
    if (!clean) { toast('Type a group name, e.g. Mandiri'); return; }
    const before = memberIds(orig);
    update((d) => ({ ...d, accounts: d.accounts.map((a) => (sel.has(a.id) ? { ...a, group: clean } : before.has(a.id) ? { ...a, group: 'Other' } : a)) }));
    toast(`Group “${clean}”: ${sel.size} account${sel.size === 1 ? '' : 's'} ✓`);
    load(clean);
  };
  return (
    <Modal title="Manage groups" onClose={onClose} wide>
      <p className="small muted" style={{ marginTop: 0 }}>Pick a group or type a new name, tick the accounts that belong to it, then save. Rename a group by changing its name; type an existing name to merge two groups. Groups are your own labels, so “Mandiri” can hold the RDN, USD and SGD accounts together.</p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={`pill ${orig === '' ? 'good' : ''}`} onClick={() => load('')}>＋ New group</button>
        {all.map((g) => <button key={g.name} className={`pill ${orig === g.name ? 'good' : ''}`} onClick={() => load(g.name)}>{g.name} · {g.list.length}</button>)}
      </div>
      <div className="row mt" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field label={orig ? `Group name (was “${orig}”)` : 'New group name'}><input className="input" value={name} placeholder="e.g. Mandiri" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Find account"><div className="row" style={{ gap: 4, alignItems: 'center' }}><Search size={14} className="muted" /><input className="input" value={q} placeholder="name or ···1234" onChange={(e) => setQ(e.target.value)} /></div></Field>
      </div>
      {merging && <div className="small warn-text mt-s">“{clean}” already exists: saving merges the ticked accounts into it.</div>}
      <div className="mt" style={{ maxHeight: '48vh', overflow: 'auto' }}>
        {all.map((g) => {
          const list = g.list.filter((a) => !ql || a.name.toLowerCase().includes(ql) || (a.ref ?? '').includes(ql) || (!!q && cleanNo(a.accountNo ?? '').includes(cleanNo(q)) && cleanNo(q).length >= 3) || g.name.toLowerCase().includes(ql));
          if (!list.length) return null;
          return (
            <div key={g.name} className="mu-group">
              <div className="small" style={{ fontWeight: 700, margin: '10px 0 4px' }}>{g.name}</div>
              {list.map((a) => (
                <label key={a.id} className="mu-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} />
                  <div className="grow" style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div className="small muted">{KIND_LABEL[a.kind]}{showNo(a, true) ? ` · ${showNo(a, true)}` : ''}{a.synced ? ' · synced' : ''}</div></div>
                  <div className="small">{a.needsBalance ? <NoBal /> : money(signed(a))}</div>
                </label>))}
            </div>
          );
        })}
      </div>
      <div className="row between mt" style={{ alignItems: 'center' }}>
        <span className="small muted">{sel.size} ticked{sel.size ? ` · ${money(data.accounts.filter((a) => sel.has(a.id)).reduce((s, a) => s + signed(a), 0))}` : ''}</span>
        <div className="row" style={{ gap: 8 }}><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={!clean || !sel.size} onClick={save}>Save group</button></div>
      </div>
    </Modal>
  );
}

function AccountModal({ a, onClose, update, groups, settings }: { a?: Account; onClose: () => void; update: ViewProps['update']; groups: string[]; settings: ViewProps['data']['settings'] }) {
  const [x, setX] = useState<Account>(a ?? { id: uid(), name: '', kind: 'bank', balance: 0, updatedAt: today() });
  const set = (p: Partial<Account>) => setX((y) => ({ ...y, ...p }));
  const [balTouched, setBalTouched] = useState(false);
  const guess = detectInstitution(x.name);
  const [rate, setRate] = useState(() => rateOf(settings, x.currency)); // the rate typed here is saved for that currency
  return (
    <Modal title={a ? 'Edit account' : 'Add account'} onClose={onClose}>
      <div className="form">
        <Field label="Name" full><input className="input" autoFocus value={x.name} onChange={(e) => {
          const name = e.target.value; const bi = bondInfo(name);
          // a government bond series in the name (FR0090, PBS032, ORI025…): it is a bond; fill coupon and maturity when known
          set({ name, ...(bi ? { kind: 'investment' as AccountKind, assetClass: 'bond' as const, ...(bi.coupon && x.interestRate == null ? { interestRate: bi.coupon } : {}), ...(bi.maturity && !x.maturity ? { maturity: bi.maturity } : {}) } : {}) });
        }} placeholder="e.g. BCA, GoPay, Bibit, KPR BTN, FR0090 (DBS)" />{bondInfo(x.name) && <div className="small muted mt-xs">Government bond {bondInfo(x.name)!.code}{bondInfo(x.name)!.coupon ? ` · coupon ${bondInfo(x.name)!.coupon}% · matures ${new Date(bondInfo(x.name)!.maturity + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (KSEI)` : ': enter its coupon and maturity'}</div>}</Field>
        <Field label="Type"><select className="input" value={x.kind} onChange={(e) => { const kind = e.target.value as AccountKind; set({ kind, assetClass: kind === 'investment' ? 'mutualfund' : kind === 'asset' ? 'property' : undefined }); }}>
          {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        <Field label="Currency"><select className="input" value={x.currency || 'IDR'} onChange={(e) => { const c = e.target.value; if (c === 'IDR') set({ currency: undefined, fxBalance: undefined }); else { const r = rateOf(settings, c); setRate(r); set({ currency: c, fxBalance: isFx(x) ? x.fxBalance : Math.round((x.balance / r) * 100) / 100 }); } }}>
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</select></Field>
        {isFx(x) ? <>
          <Field label={`${x.kind === 'debt' ? 'Outstanding balance' : 'Balance'} in ${x.currency}`}><input className="input" inputMode="decimal" aria-label="Balance in currency" placeholder="e.g. 12500.50" defaultValue={x.fxBalance ?? ''} key={x.currency} onChange={(e) => { setBalTouched(true); set({ fxBalance: parseFxAmount(e.target.value) }); }} />
            <div className="small muted mt-xs">≈ {money(Math.round((x.fxBalance ?? 0) * rate))} at {fmtRate(rate)}</div>{x.needsBalance && !balTouched && <div className="small muted mt-s"><NoBal /> imported without an amount</div>}</Field>
          <Field label={`${x.currency}/IDR rate`}><input className="input" inputMode="decimal" aria-label="Rate" defaultValue={rate || ''} key={'r' + x.currency} onChange={(e) => setRate(parseFxAmount(e.target.value))} />
            <div className="small muted mt-xs">Used for all {x.currency} accounts. {rateInfo(settings, x.currency!).src === 'live' ? 'Live rate.' : 'Type your bank’s rate, or use Update rates in Wealth.'}</div></Field>
        </> : <Field label={x.kind === 'debt' ? 'Outstanding balance' : 'Current balance / value'}><MoneyInput value={x.balance} onChange={(balance) => { setBalTouched(true); set({ balance }); }} />{x.needsBalance && !balTouched && <div className="small muted mt-s"><NoBal /> imported without an amount</div>}</Field>}
        <Field label="Bank / app (group)"><input className="input" list="acct-groups" value={x.group ?? ''} placeholder={guess ? `${guess} (auto)` : 'e.g. Mayapada'} onChange={(e) => set({ group: e.target.value || undefined })} />
          <datalist id="acct-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></Field>
        <Field label="Account number"><input className="input acct-no" inputMode="text" autoComplete="off" placeholder={x.ref && !x.accountNo ? `ends in ${x.ref.replace(/^···/, '')}: type the full number` : 'e.g. 2582289990'} value={x.accountNo ? fmtNo(x.accountNo) : ''}
          onChange={(e) => { const c = cleanNo(e.target.value); set({ accountNo: c || undefined, ref: c ? refOf(c) : x.accountNo ? undefined : x.ref }); }} />
          <div className="small muted mt-xs">Kept encrypted on your devices; masked in lists; never sent to Claude.</div></Field>
        {(x.kind === 'investment' || x.kind === 'asset') && (
          <Field label="Asset class" full><select className="input" value={x.assetClass} onChange={(e) => set({ assetClass: e.target.value as AssetClass })}>
            {(Object.keys(ASSUMPTIONS) as AssetClass[]).map((c) => <option key={c} value={c}>{ASSUMPTIONS[c].label}</option>)}</select></Field>
        )}
        <Field label={x.kind === 'debt' ? 'Year taken' : x.kind === 'investment' || x.kind === 'asset' ? 'Year bought / started' : 'Year opened'}>
          <input className="input" inputMode="numeric" placeholder="e.g. 2019" value={x.opened ?? ''} onChange={(e) => set({ opened: e.target.value.replace(/[^0-9-]/g, '').slice(0, 7) || undefined })} /></Field>
        <Field label="Interest rate (% per year)"><input className="input" inputMode="decimal" placeholder="e.g. 6.5" defaultValue={x.interestRate ?? ''} onChange={(e) => { const v = e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''); set({ interestRate: v === '' ? undefined : (Number(v) as number) }); }} /></Field>
        {(x.assetClass === 'bond' || x.assetClass === 'deposit' || x.kind === 'debt') && <Field label={x.kind === 'debt' ? 'Final payment date' : 'Maturity date'}><input className="input" type="date" value={x.maturity ?? ''} onChange={(e) => set({ maturity: e.target.value || undefined })} />{x.maturity && <div className="small muted mt-xs">{maturityLabel(x.maturity)}</div>}</Field>}
        <Field label={x.kind === 'debt' ? 'Loan term' : 'Duration / term'}><input className="input" placeholder="e.g. 3 bulan, 12, 1 tahun" defaultValue={x.tenorMonths ? fmtTenor(x.tenorMonths) : ''} onChange={(e) => set({ tenorMonths: parseTenor(e.target.value) })} /></Field>
        {x.kind === 'debt' && <>
          <Field label="Monthly installment"><MoneyInput value={x.monthlyPayment || 0} onChange={(monthlyPayment) => set({ monthlyPayment })} /></Field>
        </>}
      </div>
      <div className="row between mt">
        {a ? <button className="btn danger" onClick={() => { update((d) => ({ ...d, accounts: d.accounts.filter((y) => y.id !== a.id) })); onClose(); }}><Trash2 size={16} />Delete</button> : <span />}
        <button className="btn primary" disabled={!x.name} onClick={() => { const { needsBalance, ...rest } = x; const fx = isFx(x); const y: Account = { ...rest, ...(fx ? { balance: Math.round((x.fxBalance ?? 0) * rate) } : { currency: undefined, fxBalance: undefined }), group: x.group?.trim() || undefined, opened: normYear(x.opened), updatedAt: today(), ...(needsBalance && !balTouched && !(fx ? x.fxBalance : x.balance) ? { needsBalance: true } : {}) }; update((d) => ({ ...d, settings: fx && rate > 0 && rate !== rateOf(d.settings, x.currency) ? withRate(d.settings, x.currency!, rate, 'manual') : d.settings, accounts: a ? d.accounts.map((z) => (z.id === y.id ? y : z)) : [...d.accounts, y] })); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

/** Editable year cell: type a year (blank clears). */
function YearCell({ value, onSave, readOnly, title }: { value?: string; onSave?: (y?: string) => void; readOnly?: boolean; title?: string }) {
  const [v, setV] = useState(value?.slice(0, 4) ?? '');
  const [focus, setFocus] = useState(false);
  if (readOnly) return <span className="muted" title={title}>{value ? value.slice(0, 4) : '—'}</span>;
  const commit = () => {
    setFocus(false);
    const old = value?.slice(0, 4) ?? '';
    if (v.trim() === '') { if (old) onSave?.(undefined); return; }          // empty box clears
    const y = normYear(v);
    if (!y || v.length !== 4) { setV(old); toast(`Use a 4-digit year between 1950 and ${new Date().getFullYear()}`); return; } // invalid: keep the old year
    if (y !== old) onSave?.(y);
  };
  return <input className={`input year-in ${!v && !focus ? 'empty' : ''}`} inputMode="numeric" maxLength={4} placeholder="add" value={focus ? v : value?.slice(0, 4) ?? ''}
    onFocus={() => { setFocus(true); setV(value?.slice(0, 4) ?? ''); }} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value?.slice(0, 4) ?? ''); (e.target as HTMLInputElement).blur(); } }} aria-label="Year opened" title="Year opened / first bought" />;
}

function WealthTable({ data, by, reveal, onEdit, setAccountYear, setHoldingYear }: { data: ViewProps['data']; by: GroupBy; reveal: boolean; onEdit: (a: Account) => void; setAccountYear: (id: string, y?: string) => void; setHoldingYear: (id: string, y?: string) => void }) {
  const sections = sectionsOf(by, data.accounts);
  const rate = data.settings.usdIdr;
  const hs: { h: Holding; v: number; pl: number | null }[] = data.holdings.map((h) => { const v = valueIDR(h, rate), c = costIDR(h, rate); return { h, v, pl: c > 0 ? (v - c) / c : null }; }).sort((a, z) => z.v - a.v);
  return (
    <>
      <Card title="Accounts" className="mt">
        <div className="scroll-x"><table className="table wealth-table">
          <thead><tr><th>Account</th><th className="hide-m">{by === 'bank' ? 'Type' : 'Bank / app'}</th><th className="hide-m">Account no.</th><th>Currency</th><th>Since</th><th className="hide-m">Age</th><th className="r">Interest</th><th className="hide-m">Duration</th><th className="r">Balance</th><th className="hide-m">Updated</th></tr></thead>
          <tbody>{sections.map((g) => [
            <tr key={'g-' + g.name} className="group-row"><td colSpan={8}><b>{g.name}</b> <span className="small muted">· {g.list.length}{(g as any).native != null ? ` · ${fmtFx((g as any).native, (g as any).code)}` : ''}{(g as any).code !== 'USD' ? ` · ≈ ${usdOf(data.settings, g.total)}` : ''}</span></td><td className={`r ${g.total < 0 ? 'neg' : ''}`} style={{ whiteSpace: 'nowrap' }}><b>{money(g.total)}</b></td><td className="hide-m" /></tr>,
            ...g.list.map((a) => (
            <tr key={a.id}>
              <td><button className="linklike" onClick={() => onEdit(a)}>{a.name}</button>{a.synced && <span className="small muted"> · synced</span>}</td>
              <td className="small hide-m">{by === 'bank' ? <>{KIND_LABEL[a.kind]}{a.assetClass && a.kind !== 'debt' ? ` · ${ASSUMPTIONS[a.assetClass].label.split(' (')[0]}` : ''}</> : groupOf(a)}</td>
              <td className="small muted hide-m" style={{ whiteSpace: 'nowrap' }}><AcctNo a={a} reveal={reveal} /></td>
              <td><Ccy a={a} /></td>
              <td>{a.synced ? <YearCell value={a.opened} readOnly title="Oldest position of this app (set years on the positions below)" /> : <YearCell value={a.opened} onSave={(y) => setAccountYear(a.id, y)} />}</td>
              <td className="small muted hide-m">{ageLabel(a.opened)}</td>
              <td className="r small" style={{ whiteSpace: 'nowrap' }}>{a.interestRate != null ? `${a.interestRate}%` : <span className="muted">—</span>}</td>
              <td className="small hide-m" style={{ whiteSpace: 'nowrap' }}>{a.tenorMonths || a.maturity ? <>{a.tenorMonths ? fmtTenor(a.tenorMonths) : ''}{a.maturity && <span className="muted"> {a.tenorMonths ? '· ' : ''}{maturityLabel(a.maturity).split(' · ')[0]}</span>}</> : <span className="muted">—</span>}</td>
              <td className={`r ${a.kind === 'debt' ? 'neg' : ''}`} style={{ whiteSpace: 'nowrap' }}><Bal a={a} block /></td>
              <td className="small muted hide-m" style={{ whiteSpace: 'nowrap' }}>{a.updatedAt ? fmtDate(a.updatedAt) : '—'}</td>
            </tr>))])}</tbody>
        </table></div>
      </Card>
      {hs.length > 0 && (
        <Card title="Portfolio positions" className="mt">
          <div className="scroll-x"><table className="table wealth-table">
            <thead><tr><th>Symbol</th><th className="hide-m">Name</th><th className="hide-m">Broker</th><th>Since</th><th className="hide-m">Age</th><th className="r">Value</th><th className="r">P/L</th></tr></thead>
            <tbody>{hs.map(({ h, v, pl }) => (
              <tr key={h.id} className={h.excluded ? 'muted' : ''}>
                <td><b>{h.symbol}</b></td>
                <td className="small hide-m" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</td>
                <td className="small hide-m">{SOURCE_LABEL[h.source]}</td>
                <td><YearCell value={h.opened} onSave={(y) => setHoldingYear(h.id, y)} /></td>
                <td className="small muted hide-m">{ageLabel(h.opened)}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>{money(v)}</td>
                <td className={`r ${pl == null ? 'muted' : pl >= 0 ? 'pos' : 'neg'}`}>{pl == null ? '—' : `${pl >= 0 ? '+' : ''}${(pl * 100).toFixed(1)}%`}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}

function ByYear({ data }: { data: ViewProps['data'] }) {
  const rows = useMemo(() => wealthByYear(data), [data]);
  const known = rows.filter((r) => r.year !== 'unknown');
  const unknown = rows.find((r) => r.year === 'unknown');
  const totalAssets = rows.reduce((s, r) => s + r.assets, 0) || 1;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.assets, r.debt)));
  return (
    <Card title={<><CalendarDays size={17} style={{ verticalAlign: -3 }} /> Wealth by year opened</>} className="mt">
      {!known.length ? <div className="small muted">No years yet. Switch to <b>Table</b> and type the year each account was opened or each position first bought (or include a <i>Since</i> column when you import data).</div> : (
        <div className="scroll-x"><table className="table year-table">
          <thead><tr><th>Year</th><th className="hide-m">Items</th><th style={{ width: '40%' }}></th><th className="r">Assets today</th><th className="r">Share</th><th className="r">Debt</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={String(r.year)} className={r.year === 'unknown' ? 'muted' : ''}>
              <td><b>{r.year === 'unknown' ? 'No year' : r.year}</b></td>
              <td className="small hide-m" title={r.names.join(', ')}>{r.count} <span className="muted">· {r.names.slice(0, 3).join(', ')}{r.count > 3 ? '…' : ''}</span></td>
              <td><div className="ybar"><span style={{ width: `${(r.assets / max) * 100}%` }} />{r.debt > 0 && <span className="debt" style={{ width: `${(r.debt / max) * 100}%` }} />}</div></td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>{money(r.assets)}</td>
              <td className="r small">{((r.assets / totalAssets) * 100).toFixed(0)}%</td>
              <td className="r neg" style={{ whiteSpace: 'nowrap' }}>{r.debt ? `−${money(r.debt)}` : ''}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {known.length > 0 && unknown && <div className="small muted mt-s">{unknown.count} item{unknown.count === 1 ? '' : 's'} without a year. Add them in the table view.</div>}
      <div className="small muted mt-s">Current value of what you opened or bought in each year. Synced app accounts are counted per position.</div>
    </Card>
  );
}
