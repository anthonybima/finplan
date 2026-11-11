/**
 * Smart scan: turn a screenshot / PDF / pasted text of a broker portfolio into FinPlan holdings.
 *
 * Readers (best available first):
 *  1. "claude"  – inside Claude, the artifact asks Claude (vision) through the `sample` capability. No key needed.
 *  2. "api"     – desktop / mobile / hosted web: the user's own Anthropic API key (encrypted in the vault).
 *  3. "text"    – fully on-device parser for text copied out of a broker app or statement. No network.
 * Every reader produces ScanRow[]; the user reviews and edits them before anything is saved.
 */
import type { Holding, Source } from './types';
import { getSecret, setSecret } from './secure';
import { keepOpened } from './holdings';
import { normYear } from './wealthYears';
import { request } from './net';
import { uid } from './store';

export type ScanEngine = 'claude' | 'api' | 'text' | 'file';
export interface ScanRow {
  key: string;
  include: boolean;
  symbol: string;
  name: string;
  assetClass: Holding['assetClass'];
  market: NonNullable<Holding['market']>;
  qty: number;               // as shown on the source
  qtyUnit: 'shares' | 'lots' | 'units';
  avgPrice: number;          // per share/unit, 0 = unknown
  price: number;             // per share/unit, 0 = unknown
  value: number;             // market value, 0 = unknown
  pnl: number | null;        // unrealised P/L in `currency`
  currency: 'IDR' | 'USD';
  opened?: string;           // year first bought
}
export interface ScanResult { engine: ScanEngine; broker: Source | null; brokerName?: string; asOf?: string; rows: ScanRow[]; warnings: string[] }

const ASSET: Record<string, Holding['assetClass']> = { stock: 'stock', etf: 'stock', crypto: 'crypto', gold: 'gold', mutual_fund: 'mutualfund', mutualfund: 'mutualfund', fund: 'mutualfund', bond: 'bond', deposit: 'deposit', cash: 'cash', other: 'stock' };
const BROKERS: Record<string, Source> = { stockbit: 'stockbit', pluang: 'pluang', bitget: 'bitget', bittime: 'bittime', alpaca: 'alpaca', tradingview: 'tradingview' };
const CRYPTO = new Set('BTC ETH USDT USDC BNB SOL XRP ADA DOGE TRX TON DOT AVAX LINK MATIC POL SHIB LTC BCH UNI ATOM XLM NEAR APT ARB OP SUI PEPE WIF FET RNDR INJ TIA SEI HBAR ETC FIL ICP AAVE MKR GRT SAND MANA AXS IMX LDO CRV'.split(' '));

/* ------------------------------------------------------------------ engines */

let sampleP: Promise<any> | null = null;
function claudeSample(): Promise<any> {
  if (!sampleP) {
    const c = (window as any).claude;
    sampleP = c?.use ? Promise.race([c.use('sample').catch(() => null), new Promise((r) => setTimeout(() => r(null), 11000))]) : Promise.resolve(null);
  }
  return sampleP;
}

export interface Engines { claude: boolean; claudeImages: boolean; api: boolean; apiModel: string }
export async function availableEngines(): Promise<Engines> {
  const s = await claudeSample();
  const lim = s ? await s.limits().catch(() => null) : null;
  const key = await getSecret('anthropic').catch(() => null);
  const cfg = parseKey(key);
  return { claude: !!s, claudeImages: !!lim?.images, api: !!cfg, apiModel: cfg?.model || DEFAULT_MODEL };
}

/* --------------------------------------------- own Anthropic key (apps) */

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
interface KeyCfg { apiKey: string; model: string }
function parseKey(raw: string | null): KeyCfg | null {
  if (!raw) return null;
  try { const j = JSON.parse(raw); return j.apiKey ? { apiKey: j.apiKey, model: j.model || DEFAULT_MODEL } : null; } catch { return null; }
}
export async function saveApiKey(apiKey: string | null, model = DEFAULT_MODEL) {
  await setSecret('anthropic', apiKey ? JSON.stringify({ apiKey: apiKey.trim(), model }) : null);
}

/* ------------------------------------------------------------------ prompt */

export function scanPrompt(hint: string, text: string) {
  return `You read a screenshot, statement or copied text from an investment / brokerage / crypto app and extract the portfolio holdings.
${hint ? `The user says this is from: ${hint}.\n` : ''}Rules:
- One entry per position the user OWNS (ignore watchlists, order books, news, charts, ads, buy/sell buttons).
- Copy numbers exactly as shown; convert Indonesian formatting (1.234.567,5) to plain numbers (1234567.5). Expand "jt"/"rb"/"M"/"K"/"B"/"T" suffixes into full numbers.
- Indonesian stocks (IDX, 4-letter codes like BBCA) are usually shown in LOTS (1 lot = 100 shares): set qtyUnit "lots" when the screen says lot/lots, otherwise "shares".
- avgPrice and price are PER SHARE / PER COIN (not per lot). If a field is not visible use 0 (pnl: null). Do not guess values that are not on screen.
- currency is the currency the row's money values are shown in ("IDR" or "USD").
- Cash / wallet / RDN / buying-power balances go in as assetClass "cash" with value = the balance and qty = the balance.
- broker: the app or institution if you can tell (stockbit, pluang, bitget, bittime, alpaca, tradingview, or another name), else null.
Reply with ONLY this JSON, no prose:
{"broker": string|null, "asOf": "YYYY-MM-DD"|null, "rows": [{"symbol": "BBCA", "name": "Bank Central Asia", "assetClass": "stock|etf|crypto|gold|mutual_fund|bond|cash|other", "market": "IDX|US|CRYPTO|OTHER", "qty": 10, "qtyUnit": "lots|shares|units", "avgPrice": 8950, "price": 9100, "value": 9100000, "pnl": 150000, "currency": "IDR", "opened": "2021 or null (only if a first-buy / since date is shown)"}], "notes": "anything unreadable"}
${text ? `\nText provided by the user:\n"""\n${text.slice(0, 60000)}\n"""` : ''}`;
}

/* ------------------------------------------------------------------ run */

export interface ScanInput { files: File[]; text: string; hint: string; engine: ScanEngine; signal?: AbortSignal; onProgress?: (s: string) => void }

export async function runScan(inp: ScanInput): Promise<ScanResult> {
  if (inp.engine === 'text') {
    if (!inp.text.trim()) throw new Error('The on-device reader needs text: paste the rows copied from your broker app or statement.');
    return { engine: 'text', ...parsePortfolioText(inp.text, inp.hint) };
  }
  if (!inp.files.length && !inp.text.trim()) throw new Error('Add a screenshot / PDF, or paste text first.');
  if (inp.engine === 'file') throw new Error('Use Import data for files');
  const raw = await askVision(scanPrompt(inp.hint, inp.text), inp.files, inp.engine, inp.signal, inp.onProgress, 'your portfolio');
  return { engine: inp.engine, ...normaliseAI(raw, inp.hint) };
}

/** Ask Claude (in-artifact `sample`, or the user's own API key) to read files + prompt and return JSON. */
export async function askVision(prompt: string, files: File[], engine: 'claude' | 'api', signal?: AbortSignal, onProgress?: (s: string) => void, what = 'your files'): Promise<any> {
  if (engine === 'claude') {
    const s = await claudeSample();
    if (!s) throw new Error('Claude is not available in this view.');
    if (files.some((f) => f.type === 'application/pdf')) throw new Error('Inside Claude, Smart scan reads images. Take a screenshot of the PDF page (or paste its text) instead.');
    onProgress?.(`Claude is reading ${what}…`);
    try { return await s.json(prompt, { images: files.length ? files : undefined, signal, modelTier: 'default', cache: false }); }
    catch (e: any) { throw new Error(sampleError(e)); }
  }
  return callAnthropic(prompt, files, onProgress);
}

function sampleError(e: any): string {
  switch (e?.code) {
    case 'not_granted': return 'Claude access was not allowed for FinPlan. Allow it when asked, or use the on-device text reader.';
    case 'images_unavailable': return 'This view cannot send images to Claude. Paste the text instead.';
    case 'image_rejected': return 'That image could not be read (type or size). Try a PNG or JPG screenshot.';
    case 'rate_limited': return 'Claude is busy or your usage limit was reached. Try again in a little while.';
    case 'invalid_json': return 'Claude could not read that. Try a clearer screenshot of the list.';
    case 'refused': return 'Claude declined to read that file.';
    case 'cancelled': return 'Scan stopped.';
    default: return e?.message || 'Scan failed';
  }
}

async function fileToBlock(f: File): Promise<any> {
  if (f.type === 'application/pdf') {
    if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name} is larger than 20 MB`);
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await b64(f) } };
  }
  const img = await downscale(f);
  return { type: 'image', source: { type: 'base64', media_type: img.type, data: await b64(img) } };
}
async function b64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Keep screenshots readable but small: long side ≤ 1800 px, JPEG. */
async function downscale(f: File): Promise<Blob> {
  if (!/^image\//.test(f.type)) throw new Error(`${f.name}: use PNG, JPG, WebP or PDF`);
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (k === 1 && f.size < 3.5e6 && /png|jpeg|webp|gif/.test(f.type)) return f;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read image'))), 'image/jpeg', 0.88));
  } catch { if (f.size < 4.5e6) return f; throw new Error(`${f.name} could not be read`); }
}

async function callAnthropic(prompt: string, files: File[], onProgress?: (s: string) => void): Promise<any> {
  const cfg = parseKey(await getSecret('anthropic'));
  if (!cfg) throw new Error('Add your Claude API key first (Smart scan → Settings), or use the on-device text reader.');
  if (files.length > 8) throw new Error('Scan up to 8 files at a time.');
  onProgress?.('Preparing files…');
  const blocks = await Promise.all(files.map(fileToBlock));
  onProgress?.('Claude is reading your portfolio…');
  const r = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST', timeoutMs: 120000,
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: cfg.model, max_tokens: 8000, messages: [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }] }),
  });
  let j: any; try { j = JSON.parse(r.text); } catch { throw new Error(`Claude API: HTTP ${r.status}`); }
  if (r.status >= 400) {
    const m = j?.error?.message || `HTTP ${r.status}`;
    throw new Error(r.status === 401 ? 'Claude API key was rejected. Check it in Smart scan → Settings.' : `Claude API: ${m}`);
  }
  const text = (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  return extractJSON(text);
}

/** Chat through the user's own key: system + alternating turns → reply text. */
export async function anthropicChat(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens = 3000): Promise<string> {
  const cfg = parseKey(await getSecret('anthropic'));
  if (!cfg) throw new Error('Add your Claude API key first (Ask Claude → Settings).');
  const r = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST', timeoutMs: 180000,
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages }),
  });
  let j: any; try { j = JSON.parse(r.text); } catch { throw new Error(`Claude API: HTTP ${r.status}`); }
  if (r.status >= 400) throw new Error(r.status === 401 ? 'Claude API key was rejected. Check it in Ask Claude → Settings.' : `Claude API: ${j?.error?.message || r.status}`);
  return (j.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
}

/** Chat with Claude inside the artifact (streams through onText). */
export async function claudeChat(turns: { role: 'user' | 'assistant'; content: string }[], onText?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const s = await claudeSample();
  if (!s) throw new Error('Claude is not available in this view.');
  try { const r = await s(turns, { onText: onText ? ({ text }: { text: string }) => onText(text) : undefined, signal, cache: false, modelTier: 'default' }); return r.text; }
  catch (e: any) { if (e?.text) onText?.(e.text); throw new Error(e?.code === 'invalid_json' ? 'Claude could not answer' : sampleError(e)); }
}

export function extractJSON(text: string): any {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch { /* */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Could not read a portfolio from the reply. Try a clearer screenshot.');
}

/* ------------------------------------------------------------------ normalise */

const num = (v: any): number => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = parseNumber(String(v)); return n ?? 0;
};

function inferMarket(sym: string, cls: string, cur: string, m?: string): ScanRow['market'] {
  if (m === 'IDX' || m === 'US' || m === 'CRYPTO' || m === 'OTHER') return m;
  if (cls === 'crypto' || CRYPTO.has(sym)) return 'CRYPTO';
  if (cls === 'cash' || cls === 'mutualfund' || cls === 'gold' || cls === 'bond' || cls === 'deposit') return 'OTHER';
  if (/^[A-Z]{4}$/.test(sym) && cur === 'IDR') return 'IDX';
  if (cur === 'USD') return 'US';
  return 'OTHER';
}

export function brokerFrom(name: any, hint: string): Source | null {
  const s = `${name || ''} ${hint || ''}`.toLowerCase();
  for (const k of Object.keys(BROKERS)) if (s.includes(k)) return BROKERS[k];
  return null;
}

export function normaliseAI(raw: any, hint = ''): Omit<ScanResult, 'engine'> {
  const list: any[] = Array.isArray(raw) ? raw : raw?.rows || raw?.holdings || [];
  const warnings: string[] = [];
  const rows: ScanRow[] = [];
  for (const r of list) {
    const symbol = String(r.symbol || r.ticker || r.code || '').trim().toUpperCase().replace(/\.JK$/, '');
    const cls0 = String(r.assetClass || '').toLowerCase();
    const assetClass: Holding['assetClass'] = ASSET[cls0] || 'stock';
    const currency: 'IDR' | 'USD' = String(r.currency || '').toUpperCase() === 'USD' ? 'USD' : 'IDR';
    const qty = num(r.qty), value = num(r.value), price = num(r.price), avg = num(r.avgPrice);
    if (!symbol && assetClass !== 'cash') continue;
    if (!qty && !value) continue;
    const unit = r.qtyUnit === 'lots' ? 'lots' : r.qtyUnit === 'units' ? 'units' : 'shares';
    rows.push({
      key: uid(), include: true, symbol: symbol || 'CASH', name: String(r.name || symbol || 'Cash'), assetClass,
      market: inferMarket(symbol, assetClass, currency, cls0 === 'other' && !r.market ? 'OTHER' : r.market), qty: assetClass === 'cash' ? (value || qty) : qty, qtyUnit: assetClass === 'cash' ? 'units' : unit,
      avgPrice: avg, price, value, pnl: r.pnl == null || r.pnl === '' ? null : num(r.pnl), currency, opened: normYear(r.opened),
    });
  }
  if (raw?.notes) warnings.push(String(raw.notes));
  if (!rows.length) warnings.push('No positions found. Try a screenshot that shows the holdings list (symbol, quantity and value).');
  return { broker: brokerFrom(raw?.broker, hint), brokerName: raw?.broker || undefined, asOf: raw?.asOf || undefined, rows, warnings };
}

/** Per-share quantity and prices, filling gaps from value and P/L. */
export function resolveRow(r: ScanRow) {
  const shares = r.qtyUnit === 'lots' ? r.qty * 100 : r.qty;
  if (r.assetClass === 'cash') { const amt = r.value || r.qty; return { shares: amt, price: 1, avg: 1, value: amt }; }
  let price = r.price || (r.value && shares ? r.value / shares : 0);
  let avg = r.avgPrice;
  if (!avg && r.pnl != null && shares && (r.value || price)) avg = ((r.value || price * shares) - r.pnl) / shares;
  if (!price) price = avg;
  if (!avg) avg = price;
  return { shares, price, avg, value: r.value || shares * price };
}

export function rowsToHoldings(rows: ScanRow[], source: Source): Holding[] {
  return rows.filter((r) => r.include).map((r) => {
    const x = resolveRow(r);
    const h: Holding = {
      id: uid(), source, symbol: r.symbol, name: r.name || r.symbol, assetClass: r.assetClass, qty: x.shares, avgPrice: x.avg, price: x.price,
      currency: r.currency, market: r.market, priceAt: new Date().toISOString(), ...(r.opened ? { opened: r.opened } : {}),
    };
    if (r.market === 'IDX') h.tv = `IDX:${r.symbol}`;
    return h;
  }).filter((h) => h.qty > 0);
}

/** Replace a broker's positions, or merge (same symbol is overwritten, others kept). */
export function mergeHoldings(existing: Holding[], incoming: Holding[], source: Source, mode: 'replace' | 'merge'): Holding[] {
  if (mode === 'replace') return [...existing.filter((h) => h.source !== source), ...keepOpened(existing.filter((h) => h.source === source), incoming)];
  const key = (h: Holding) => `${h.source}|${h.symbol}|${h.assetClass === 'cash' ? h.name : ''}`;
  const inc = new Map(incoming.map((h) => [key(h), h]));
  const kept = existing.map((h) => { const n = inc.get(key(h)); if (n) { inc.delete(key(h)); return { ...n, id: h.id, tv: h.tv || n.tv, opened: n.opened || h.opened }; } return h; });
  return [...kept, ...inc.values()];
}

/* ------------------------------------------------------------------ on-device text reader */

/** Parse 1.234.567,89 / 1,234,567.89 / 12,5 / 9.100 / 1,2jt / 3.4K / (12.000) / -5% into a number. */
export function parseNumber(s0: string): number | null {
  let s = s0.trim().replace(/^rp\.?\s*/i, '').replace(/^\$|^usd\s*|^idr\s*/i, '').replace(/\s/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[−–-]/.test(s)) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const m = s.match(/^([\d.,]+)(jt|juta|rb|ribu|m|mn|k|b|bn|t)?$/i);
  if (!m) return null;
  let d = m[1];
  const lastDot = d.lastIndexOf('.'), lastCom = d.lastIndexOf(',');
  if (lastDot >= 0 && lastCom >= 0) {
    const dec = lastDot > lastCom ? '.' : ',';
    d = d.split(dec === '.' ? ',' : '.').join(''); if (dec === ',') d = d.replace(',', '.');
  } else if (lastCom >= 0) {
    d = /^\d{1,3}(,\d{3})+$/.test(d) ? d.replace(/,/g, '') : d.replace(',', '.');
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(d)) d = d.replace(/\./g, '');
  }
  let n = Number(d); if (!isFinite(n)) return null;
  const suf = (m[2] || '').toLowerCase();
  n *= suf === 'jt' || suf === 'juta' ? 1e6 : suf === 'rb' || suf === 'ribu' || suf === 'k' ? 1e3 : suf === 'm' || suf === 'mn' ? 1e6 : suf === 'b' || suf === 'bn' ? 1e9 : suf === 't' ? 1e12 : 1;
  return neg ? -n : n;
}

const STOP = new Set(['TOTAL', 'SALDO', 'CASH', 'LAST', 'LOTS', 'HOLD', 'SELL', 'BUY', 'JUAL', 'BELI', 'AVG', 'PRICE', 'HARGA', 'NILAI', 'VALUE', 'RUGI', 'LABA', 'GAIN', 'LOSS', 'SAHAM', 'KAS', 'DANA', 'POIN', 'BIDS', 'ASKS', 'DONE', 'OPEN', 'HIGH', 'CLOSE', 'PREV', 'LIMIT', 'ORDER', 'TODAY', 'HARI', 'INVEST', 'MODAL', 'RETURN', 'EQUITY', 'TRADE', 'IHSG', 'LQ45', 'IDR', 'USD', 'PNL', 'ROI', 'NAV', 'QTY', 'UNIT', 'LOT', 'MKT', 'P/L', 'RDN', 'ETF']);
const LABELS: { re: RegExp; f: 'qty' | 'avg' | 'price' | 'value' | 'pnl' }[] = [
  { re: /^(lot|lots|shares?|qty|quantity|jumlah|jml|unit|units|vol|amount|lembar|available|tersedia|balance)$/i, f: 'qty' },
  { re: /^(avg|average|rata|rata-rata|avgprice|avg\.|cost|modal|harga\s*rata|buy\s*price|entry)$/i, f: 'avg' },
  { re: /^(last|price|harga|close|current|mkt|market\s*price|now)$/i, f: 'price' },
  { re: /^(value|nilai|market\s*value|mkt\s*val|total|valuation|saldo|equity|est\.?value)$/i, f: 'value' },
  { re: /^(p\/l|pnl|gain|loss|unrealized|unrealised|profit|untung|rugi|laba|return)$/i, f: 'pnl' },
];

type Tok = { k: 'sym'; v: string; idx: boolean } | { k: 'num'; v: number; label?: string; lot?: boolean; pct?: boolean; usd?: boolean } | { k: 'lbl'; v: string };

/** On-device parser for text copied out of Stockbit, Pluang, exchange apps, statements or spreadsheets. */
export function parsePortfolioText(text: string, hint = ''): Omit<ScanResult, 'engine'> {
  const warnings: string[] = [];
  const isUsdDoc = /\$|\bUSD\b/.test(text) && !/\bRp\b|\bIDR\b|\blot\b/i.test(text);
  const toks: Tok[] = [];
  const norm = text.replace(/\t|\|/g, '  ').replace(/[“”]/g, '"');
  const re = /(\(?[−–+-]?(?:rp\.? ?|\$|usd ?|idr ?)?\d[\d.,]*(?: ?(?:jt|juta|rb|ribu|k|m|mn|b|bn|t)(?![A-Za-z]))?\)?)( ?%)?( ?lots?\b)?|([A-Za-z][A-Za-z0-9/.-]{0,11})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    if (m[1]) {
      const raw = m[1].trim();
      const n = parseNumber(raw.replace(/\s/g, ''));
      if (n == null) continue;
      toks.push({ k: 'num', v: n, pct: !!m[2], lot: !!m[3], usd: /\$|usd/i.test(raw) });
    } else if (m[4]) {
      const w = m[4];
      const up = w.toUpperCase().replace(/\.JK$/, '').replace(/[/-](IDR|USDT|USD)$/, '');
      if (/^lots?$/i.test(w)) { const last = toks[toks.length - 1]; if (last?.k === 'num') last.lot = true; continue; }
      const lab = LABELS.find((l) => l.re.test(w));
      if (lab) { toks.push({ k: 'lbl', v: lab.f }); continue; }
      const isSym = (w === w.toUpperCase() || /\.JK$/i.test(w)) && /^[A-Z][A-Z0-9]{1,9}$/.test(up) && !STOP.has(up);
      if (isSym) toks.push({ k: 'sym', v: up, idx: /^[A-Z]{4}$/.test(up) && !CRYPTO.has(up) && !isUsdDoc });
    }
  }
  // group: symbol followed by numbers (and labels) until the next symbol
  const groups: { sym: string; idx: boolean; nums: { v: number; label?: string; lot?: boolean; pct?: boolean; usd?: boolean }[] }[] = [];
  let pendingLabel: string | undefined;
  for (const t of toks) {
    if (t.k === 'sym') { groups.push({ sym: t.v, idx: t.idx, nums: [] }); pendingLabel = undefined; continue; }
    const g = groups[groups.length - 1]; if (!g) continue;
    if (t.k === 'lbl') { pendingLabel = t.v; continue; }
    g.nums.push({ v: t.v, label: pendingLabel, lot: t.lot, pct: t.pct, usd: t.usd }); pendingLabel = undefined;
  }
  const rows: ScanRow[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    const nums = g.nums.filter((n) => !n.pct);
    if (!nums.length) continue;
    const take = (f: string) => { const i = nums.findIndex((n) => n.label === f || (f === 'qty' && n.lot)); return i >= 0 ? nums.splice(i, 1)[0] : undefined; };
    const q = take('qty'), a = take('avg'), p = take('price'), v = take('value'), pl = take('pnl');
    const rest = nums.filter((n) => !n.label);
    const qty = q?.v ?? rest.shift()?.v ?? 0;
    const lots = !!q?.lot || (g.idx && /\blot/i.test(text) && !q?.label);
    let avg = a?.v ?? 0, price = p?.v ?? 0, value = v?.v ?? 0, pnl: number | null = pl?.v ?? null;
    // unlabeled positions: avg, price, value (common column order); a value is much larger than a price
    const unl = rest.filter((n) => n.v !== 0);
    const perShare = (x: number) => !qty || x < (Math.abs(qty) * (lots ? 100 : 1)) * 50 || x < 1e6;
    for (const n of unl) {
      if (!avg && perShare(n.v) && !value) avg = n.v;
      else if (!price && perShare(n.v) && !value) price = n.v;
      else if (!value && n.v > 0) value = n.v;
      else if (pnl == null) pnl = n.v;
    }
    if (!qty || qty <= 0) continue;
    if (seen.has(g.sym)) continue; seen.add(g.sym);
    const currency: 'IDR' | 'USD' = g.idx ? 'IDR' : (isUsdDoc || g.nums.some((n) => n.usd)) ? 'USD' : CRYPTO.has(g.sym) ? (isUsdDoc ? 'USD' : 'IDR') : 'IDR';
    const assetClass: Holding['assetClass'] = CRYPTO.has(g.sym) ? 'crypto' : 'stock';
    rows.push({
      key: uid(), include: true, symbol: g.sym, name: g.sym, assetClass, market: inferMarket(g.sym, assetClass, currency, g.idx ? 'IDX' : undefined),
      qty, qtyUnit: lots ? 'lots' : assetClass === 'crypto' ? 'units' : 'shares', avgPrice: avg, price, value, pnl, currency,
    });
  }
  if (!rows.length) warnings.push('No positions recognised. Paste rows that contain the code (e.g. BBCA) and the quantity, or use a screenshot with Claude.');
  else warnings.push('Read on this device without AI. Check every row: columns are guessed from their order (quantity, average, last price, value).');
  return { broker: brokerFrom('', hint), rows, warnings };
}
