/**
 * Live data: refresh position prices and exchange rates, then rebuild app accounts, so net worth,
 * allocation, risk and Wealth follow the market. Runs when FinPlan opens, every 15 minutes while it's visible,
 * and on "Refresh prices". Prices come through the same routes as Markets (Pluang, FinPlan's server, the connector).
 */
import type { AppData } from './types';
import { fetchUsdIdr, refreshPrices, syncAccounts } from './holdings';
import { fetchRates, usedCurrencies, withRate } from './fx';

export const LIVE_EVERY = 15 * 60e3;
export interface LiveResult { prices: Map<string, { price: number; at: string }>; usd: number | null; rates: Record<string, number>; failed: string[]; at: string }

let running: Promise<LiveResult> | null = null;
/** Fetch everything (one run at a time). */
export function fetchLive(d: AppData): Promise<LiveResult> {
  if (running) return running;
  running = (async () => {
    const usd = await fetchUsdIdr();
    const rate = usd || d.settings.usdIdr;
    const priced = d.holdings.filter((h) => !h.excluded);
    const [r, rates] = await Promise.all([refreshPrices(priced, rate), fetchRates(usedCurrencies(d).filter((c) => c !== 'USD'))]);
    const old = new Map(priced.map((h) => [h.id, h.price]));
    const sane = (id: string, p: number) => { const o = old.get(id); return !o || (p / o > 0.2 && p / o < 5); }; // a wrong symbol/unit would jump 5×+: keep the old price
    const prices = new Map(r.holdings.filter((h) => h.priceAt && h.priceAt !== priced.find((x) => x.id === h.id)?.priceAt && sane(h.id, h.price)).map((h) => [h.id, { price: h.price, at: h.priceAt! }]));
    return { prices, usd, rates, failed: r.failed, at: new Date().toISOString() };
  })().finally(() => { running = null; });
  return running;
}

/** Apply a fetch to the latest data (keeps edits made meanwhile). */
export function applyLive(d: AppData, r: LiveResult): AppData {
  let settings: AppData['settings'] = { ...d.settings, liveAt: r.at };
  if (r.usd) settings = withRate(settings, 'USD', r.usd, 'live');
  for (const [c, v] of Object.entries(r.rates)) settings = withRate(settings, c, v, 'live');
  const holdings = d.holdings.map((h) => { const p = r.prices.get(h.id); return p ? { ...h, price: p.price, priceAt: p.at } : h; });
  return syncAccounts({ ...d, holdings, settings });
}

export async function refreshLive(data: AppData, update: (fn: (d: AppData) => AppData) => void): Promise<LiveResult> {
  const r = await fetchLive(data);
  update((d) => applyLive(d, r));
  return r;
}
export const liveStale = (d: AppData) => !d.settings.liveAt || Date.now() - Date.parse(d.settings.liveAt) > LIVE_EVERY;
