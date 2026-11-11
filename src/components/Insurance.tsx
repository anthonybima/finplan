import { useState } from 'react';
import { ChevronRight, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { AppData } from '../lib/types';
import { FREQ, insuranceLikeAccounts, moveToInsurance, perYear, POLICY_TYPES, typeLabel, type Policy, type PolicyType, type PremiumFreq } from '../lib/insurance';
import { CURRENCIES, fmtFx, parseFxAmount, toIdr } from '../lib/fx';
import { knownGroups } from '../lib/institutions';
import { fmtDate, money, today } from '../lib/format';
import { uid } from '../lib/store';
import { normYear } from '../lib/wealthYears';
import { maturityLabel } from '../lib/bonds';
import { Field, Modal, toast } from './ui';

type Upd = (fn: (d: AppData) => AppData) => void;
const amt = (p: Policy, n?: number) => (n == null ? '' : p.currency && p.currency !== 'IDR' ? fmtFx(n, p.currency) : money(n, true));

/** Wealth → Insurance: policies with coverage and premiums. Never added to net worth. */
export function InsuranceSection({ data, update }: { data: AppData; update: Upd }) {
  const list = (data.policies || []).slice().sort((a, z) => (a.status === 'active' ? 0 : 1) - (z.status === 'active' ? 0 : 1) || (z.coverage || 0) - (a.coverage || 0));
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('finplan.insOpen') !== '0'; } catch { return true; } });
  const [edit, setEdit] = useState<Policy | 'new' | null>(null);
  const toggle = () => setOpen((o) => { try { localStorage.setItem('finplan.insOpen', o ? '0' : '1'); } catch { /* */ } return !o; });
  const active = list.filter((p) => (p.status || 'active') === 'active');
  const coverIdr = active.reduce((s, p) => s + toIdr(data.settings, p.currency, p.coverage || 0), 0);
  const premYr = active.reduce((s, p) => s + toIdr(data.settings, p.currency, perYear(p)), 0);
  const candidates = insuranceLikeAccounts(data);
  return (
    <div className="card mt cl ins">
      <button className="cl-head" onClick={toggle} aria-expanded={open}>
        <ChevronRight size={16} className="cl-chev" style={open ? { transform: 'rotate(90deg)' } : undefined} />
        <span className="cl-name"><b><ShieldCheck size={15} style={{ verticalAlign: -2 }} /> Insurance</b> <span className="muted small">{list.length}</span><span className="cl-sub">Not counted in net worth</span></span>
        <span className="cl-amt"><span className="small">cover <b>{money(coverIdr, true)}</b></span><span className="cl-sub r">premiums {money(premYr, true)}/yr</span></span>
      </button>
      {open && <div className="cl-body">
        {candidates.length > 0 && (
          <div className="ins-move small">
            <span className="grow">{candidates.length} account{candidates.length === 1 ? ' looks' : 's look'} like insurance: {candidates.slice(0, 3).map((a) => a.name).join(', ')}{candidates.length > 3 ? '…' : ''}</span>
            <button className="btn sm" onClick={() => { update((d) => moveToInsurance(d, candidates.map((a) => a.id), uid, today())); toast(`Moved ${candidates.length} to Insurance (not in net worth)`); }}>Move to Insurance</button>
          </div>
        )}
        {list.map((p) => (
          <button key={p.id} className={`cl-acct ${p.status && p.status !== 'active' ? 'ins-off' : ''}`} onClick={() => setEdit(p)}>
            <span className="cl-name">{p.name}<span className="cl-sub">{[typeLabel(p.type), p.insurer, p.policyNo, p.insured, p.endDate ? maturityLabel(p.endDate).replace('matures', 'ends').replace('matured', 'ended') : '', p.status && p.status !== 'active' ? p.status : ''].filter(Boolean).join(' · ')}</span></span>
            <span className="cl-amt">{p.coverage ? amt(p, p.coverage) : <span className="muted small">cover —</span>}<span className="cl-sub r">{p.premium ? `${amt(p, p.premium)} ${FREQ.find(([f]) => f === (p.premiumFreq || 'monthly'))?.[1]}` : ''}</span></span>
          </button>
        ))}
        {!list.length && !candidates.length && <div className="small muted" style={{ padding: '8px 14px' }}>Add your life, health, vehicle or property policies to keep their coverage, premiums and policy numbers in one place.</div>}
        <div style={{ padding: '6px 12px' }}><button className="btn sm" onClick={() => setEdit('new')}><Plus size={14} /> Add policy</button></div>
      </div>}
      {edit && <PolicyModal p={edit === 'new' ? undefined : edit} data={data} update={update} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PolicyModal({ p, data, update, onClose }: { p?: Policy; data: AppData; update: Upd; onClose: () => void }) {
  const [x, setX] = useState<Policy>(p || { id: uid(), name: '', type: 'life', premiumFreq: 'monthly', status: 'active', updatedAt: today() });
  const set = (v: Partial<Policy>) => setX((y) => ({ ...y, ...v }));
  const [arm, setArm] = useState(false);
  const insurers = knownGroups([...(data.policies || []).map((q) => q.insurer || ''), 'Allianz', 'Chubb', 'MSIG', 'Prudential', 'Manulife', 'AXA', 'AIA', 'FWD', 'Sequis', 'BPJS'].filter(Boolean));
  const ccy = x.currency || 'IDR';
  const num = (s: string) => { const v = ccy === 'IDR' ? Number(s.replace(/[^\d]/g, '')) : parseFxAmount(s); return v || undefined; };
  const save = () => {
    if (!x.name.trim()) { toast('Give the policy a name'); return; }
    const y: Policy = { ...x, name: x.name.trim(), opened: normYear(x.opened || ''), updatedAt: today() };
    update((d) => ({ ...d, policies: p ? (d.policies || []).map((q) => (q.id === y.id ? y : q)) : [...(d.policies || []), y] }));
    toast('Policy saved (not counted in net worth)'); onClose();
  };
  return (
    <Modal title={p ? 'Edit policy' : 'Add insurance policy'} onClose={onClose}>
      <div className="form">
        <Field label="Name" full><input className="input" autoFocus value={x.name} placeholder="e.g. Chubb Life, MSIG Vega Tradisional" onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Insurer"><input className="input" list="ins-list" value={x.insurer ?? ''} onChange={(e) => set({ insurer: e.target.value || undefined })} /><datalist id="ins-list">{insurers.map((i) => <option key={i} value={i} />)}</datalist></Field>
        <Field label="Type"><select className="input" value={x.type} onChange={(e) => set({ type: e.target.value as PolicyType })}>{POLICY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Policy number"><input className="input acct-no" value={x.policyNo ?? ''} onChange={(e) => set({ policyNo: e.target.value || undefined })} /></Field>
        <Field label="Insured person"><input className="input" value={x.insured ?? ''} placeholder="e.g. Anthony" onChange={(e) => set({ insured: e.target.value || undefined })} /></Field>
        <Field label="Currency"><select className="input" value={ccy} onChange={(e) => set({ currency: e.target.value === 'IDR' ? undefined : e.target.value })}>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</select></Field>
        <Field label="Coverage (sum assured)"><input className="input" inputMode="decimal" defaultValue={x.coverage ?? ''} key={'c' + ccy} placeholder={ccy === 'IDR' ? 'e.g. 1000000000' : 'e.g. 100000'} onChange={(e) => set({ coverage: num(e.target.value) })} />{x.coverage ? <div className="small muted mt-xs">{amt(x, x.coverage)}</div> : null}</Field>
        <Field label="Premium"><input className="input" inputMode="decimal" defaultValue={x.premium ?? ''} key={'p' + ccy} onChange={(e) => set({ premium: num(e.target.value) })} />{x.premium ? <div className="small muted mt-xs">{amt(x, x.premium)} · {money(toIdr(data.settings, x.currency, perYear(x)), true)}/yr</div> : null}</Field>
        <Field label="Paid"><select className="input" value={x.premiumFreq || 'monthly'} onChange={(e) => set({ premiumFreq: e.target.value as PremiumFreq })}>{FREQ.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select></Field>
        <Field label="Since (year)"><input className="input" inputMode="numeric" maxLength={4} value={x.opened ?? ''} onChange={(e) => set({ opened: e.target.value })} /></Field>
        <Field label="Policy ends"><input className="input" type="date" value={x.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || undefined })} /></Field>
        <Field label="Next premium due"><input className="input" type="date" value={x.nextDue ?? ''} onChange={(e) => set({ nextDue: e.target.value || undefined })} />{x.nextDue && <div className="small muted mt-xs">{fmtDate(x.nextDue)}</div>}</Field>
        <Field label="Status"><select className="input" value={x.status || 'active'} onChange={(e) => set({ status: e.target.value as Policy['status'] })}><option value="active">Active</option><option value="lapsed">Lapsed</option><option value="ended">Ended</option></select></Field>
        <Field label="Notes" full><input className="input" value={x.notes ?? ''} placeholder="e.g. rider, hospital plan, agent contact" onChange={(e) => set({ notes: e.target.value || undefined })} /></Field>
      </div>
      <p className="small muted">Insurance is protection, not wealth: it is not added to net worth. If a unit-link has an investment value you want counted, track that value as a fund account in Wealth.</p>
      <div className="row between mt">
        {p ? <button className="btn danger" onClick={() => { if (!arm) { setArm(true); setTimeout(() => setArm(false), 4000); return; } update((d) => ({ ...d, policies: (d.policies || []).filter((q) => q.id !== p.id) })); toast('Policy deleted'); onClose(); }}><Trash2 size={15} /> {arm ? 'Tap again to delete' : 'Delete'}</button> : <span />}
        <div className="row" style={{ gap: 8 }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}
