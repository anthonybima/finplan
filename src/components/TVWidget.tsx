import { useEffect, useRef, useState } from 'react';

/**
 * Official TradingView embeddable widgets (free, no account needed).
 * type: 'advanced-chart' | 'ticker-tape' | 'symbol-overview' | 'technical-analysis' | 'market-overview'
 */
export default function TVWidget({ type, config, height = 420 }: { type: string; config: Record<string, unknown>; height?: number | string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(config);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const s = document.createElement('script');
    s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${type}.js`;
    s.async = true;
    s.type = 'text/javascript';
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    s.innerHTML = JSON.stringify({ locale: 'en', colorTheme: dark ? 'dark' : 'light', theme: dark ? 'dark' : 'light', isTransparent: true, ...config });
    s.onerror = () => setFailed(true);
    el.appendChild(s);
    return () => { el.innerHTML = ''; };
  }, [type, key]);
  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <div ref={ref} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />
      {failed && <div className="empty" style={{ position: 'absolute', inset: 0 }}>TradingView charts need an internet connection (they load in the desktop & mobile apps).</div>}
    </div>
  );
}
