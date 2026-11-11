import { useMemo, useRef, useState } from 'react';
import type { Pt } from '../lib/market';

/** Lightweight SVG chart (area / line / candles) with hover crosshair. Colours follow up/down like broker apps. */
export default function PriceChart({ points, kind: kindIn = 'area', height = 120, up, prevClose, interactive = false, fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }), timeFmt }: {
  points: Pt[]; kind?: 'area' | 'line' | 'candle'; height?: number; up: boolean; prevClose?: number | null; interactive?: boolean;
  fmt?: (n: number) => string; timeFmt?: (t: number) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const kind = kindIn === 'candle' && !points.some((p) => p.o != null) ? 'line' : kindIn; // no OHLC (e.g. ratios) → line
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, padY = 6;
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const lo = Math.min(...points.map((p) => (kind === 'candle' ? p.l ?? p.c : p.c)), prevClose ?? Infinity);
    const hi = Math.max(...points.map((p) => (kind === 'candle' ? p.h ?? p.c : p.c)), prevClose ?? -Infinity);
    const span = hi - lo || hi * 0.01 || 1;
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => padY + (1 - (v - lo) / span) * (H - 2 * padY);
    return { x, y, lo, hi };
  }, [points, kind, H, prevClose]);
  if (!geo) return <div className="small muted" style={{ height, display: 'grid', placeItems: 'center' }}>No chart data</div>;
  const color = up ? 'var(--good)' : 'var(--bad)';
  const gid = `g${up ? 'u' : 'd'}${H}`;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${geo.x(i).toFixed(1)},${geo.y(p.c).toFixed(1)}`).join('');
  const cw = Math.max(1, (W / points.length) * 0.6);
  const onMove = (e: React.PointerEvent) => {
    if (!interactive || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
  };
  const hp = hover != null ? points[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: interactive ? 'none' : undefined }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={up ? '#16a34a' : '#dc2626'} stopOpacity="0.28" /><stop offset="100%" stopColor={up ? '#16a34a' : '#dc2626'} stopOpacity="0" /></linearGradient></defs>
        {prevClose != null && <line x1="0" x2={W} y1={geo.y(prevClose)} y2={geo.y(prevClose)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6" />}
        {kind === 'candle' ? points.map((p, i) => {
          const o = p.o ?? p.c, h = p.h ?? Math.max(o, p.c), l = p.l ?? Math.min(o, p.c), upC = p.c >= o, x = geo.x(i);
          const col = upC ? '#16a34a' : '#dc2626';
          return <g key={i}><line x1={x} x2={x} y1={geo.y(h)} y2={geo.y(l)} stroke={col} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <rect x={x - cw / 2} width={cw} y={geo.y(Math.max(o, p.c))} height={Math.max(1, Math.abs(geo.y(o) - geo.y(p.c)))} fill={col} /></g>;
        }) : <>
          {kind === 'area' && <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${gid})`} />}
          <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </>}
        {hp && <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1="0" y2={H} stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hp && <div className="chart-tip" style={{ left: `${Math.min(80, Math.max(0, (hover! / (points.length - 1)) * 100 - 10))}%` }}>
        <b>{fmt(hp.c)}</b>{hp.o != null && kind === 'candle' && <span> O {fmt(hp.o)} H {fmt(hp.h ?? hp.c)} L {fmt(hp.l ?? hp.c)}</span>}<div>{timeFmt ? timeFmt(hp.t) : new Date(hp.t).toLocaleString()}</div></div>}
    </div>
  );
}
