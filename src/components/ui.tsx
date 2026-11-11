import { ReactNode, useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Lightbulb, X } from 'lucide-react';
import type { Advice } from '../lib/advice';

export const COLORS = ['#0f766e', '#14b8a6', '#f59e0b', '#6366f1', '#ec4899', '#84cc16', '#0ea5e9', '#f97316', '#a855f7', '#64748b', '#ef4444', '#22c55e', '#eab308', '#06b6d4', '#8b5cf6'];

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && <div className="card-head">{title && <h2>{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, delta, tone, icon }: { label: string; value: ReactNode; delta?: ReactNode; tone?: 'pos' | 'neg'; icon?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{icon}{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${tone || 'muted'}`}>{delta}</div>}
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'warn' | 'bad' | 'none' }) {
  // default tone = spending-style (red when full); pass 'none' for score-style bars
  const t = tone ?? (value >= 1 ? 'bad' : value >= 0.85 ? 'warn' : undefined);
  return <div className={`bar ${t || ''}`}><div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={`field ${full ? 'full' : ''}`}>{label}{children}</label>;
}

/** Amount input with thousand separators (type 1500000 → shows 1.500.000). */
export function MoneyInput({ value, onChange, autoFocus }: { value: number; onChange: (n: number) => void; autoFocus?: boolean }) {
  const fmt = (n: number) => (n ? new Intl.NumberFormat('id-ID').format(n) : '');
  const [txt, setTxt] = useState(fmt(value));
  useEffect(() => { setTxt(fmt(value)); }, [value]);
  return (
    <input className="input" inputMode="decimal" autoFocus={autoFocus} value={txt} placeholder="0"
      onChange={(e) => { const digits = e.target.value.replace(/[^\d]/g, ''); const n = Number(digits || 0); setTxt(fmt(n)); onChange(n); }} />
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map((o) => <button key={o.v} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>)}</div>;
}

const ICON = { critical: AlertOctagon, warning: AlertTriangle, tip: Lightbulb, good: CheckCircle2 };
export function AdviceList({ items, onAction }: { items: Advice[]; onAction?: (a: Advice) => void }) {
  if (!items.length) return <div className="empty">No advice right now. Nice work.</div>;
  return (
    <div>
      {items.map((a, i) => {
        const I = ICON[a.level];
        return (
          <div key={i} className={`advice ${a.level}`}>
            <div className="ai"><I size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row between"><span className="t">{a.title}</span><span className={`pill ${a.level}`}>{a.area}</span></div>
              <div className="d">{a.detail}</div>
              {a.action && <div className="a" style={{ cursor: onAction ? 'pointer' : undefined }} onClick={() => onAction?.(a)}>→ {a.action}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const r = 52, c = 2 * Math.PI * r;
  const color = score >= 75 ? 'var(--good)' : score >= 50 ? '#f59e0b' : 'var(--bad)';
  return (
    <div className="score-ring">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="n" style={{ color }}>{score}</div>
    </div>
  );
}

let toastSet: ((s: string | null) => void) | null = null;
export function toast(msg: string) { toastSet?.(msg); setTimeout(() => toastSet?.(null), 2600); }
export function ToastHost() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => { toastSet = setM; return () => { toastSet = null; }; }, []);
  return m ? <div className="toast">{m}</div> : null;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <rect width="512" height="512" rx="112" fill="#0f766e" />
      <path d="M120 360 L210 260 L280 310 L392 170" fill="none" stroke="#fff" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="392" cy="170" r="30" fill="#fbbf24" />
    </svg>
  );
}
