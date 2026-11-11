import type { Holding } from './types';
import { request } from './net';
import { getJSONSecret, setSecret } from './secure';
import { uid } from './store';

/**
 * Direct, read-only connection to Pluang's official MCP server (Agentic Trading).
 *   Server:  https://mcp.pluang.com/mcp   (Streamable HTTP, JSON-RPC 2.0)
 *   Auth:    OAuth 2.1 — dynamic client registration + authorization code + PKCE (S256) + refresh tokens
 *   Scopes:  market:read portfolio:read   ← FinPlan never requests trade:write, so it cannot place orders
 * Sign-in opens Pluang's own login page in the system browser; FinPlan never sees the Pluang password/PIN.
 */
const ISSUER = 'https://mcp.pluang.com';
const RESOURCE = 'https://mcp.pluang.com/mcp';
const SCOPE = 'market:read portfolio:read';
const SECRET_KEY = 'pluang-mcp';

interface Meta { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint?: string }
interface Session {
  clientId: string; clientSecret?: string; redirectUri: string;
  accessToken?: string; refreshToken?: string; expiresAt?: number;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function pkce() {
  const verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

async function metadata(): Promise<Meta> {
  try {
    const r = await request(`${ISSUER}/.well-known/oauth-authorization-server`);
    if (r.status < 400) return JSON.parse(r.text);
  } catch { /* fall back to published endpoints */ }
  return { authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, registration_endpoint: `${ISSUER}/register`, revocation_endpoint: `${ISSUER}/revoke` };
}

const form = (o: Record<string, string | undefined>) =>
  Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`).join('&');

async function tokenRequest(meta: Meta, body: Record<string, string | undefined>) {
  const r = await request(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form(body) });
  const j = JSON.parse(r.text || '{}');
  if (r.status >= 400 || !j.access_token) throw new Error(`Pluang sign-in: ${j.error_description || j.error || 'HTTP ' + r.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in?: number };
}

export const pluangMcpSupported = () => !!window.finplanNative?.oauthAuthorize;
export async function pluangMcpConnected() { return !!(await getJSONSecret<Session>(SECRET_KEY))?.refreshToken || !!(await getJSONSecret<Session>(SECRET_KEY))?.accessToken; }

/** Full sign-in: register FinPlan as an OAuth client (once), then authorize in the browser. */
export async function connectPluang(): Promise<void> {
  const n = window.finplanNative;
  if (!n?.oauthAuthorize || !n.oauthRedirectUri) throw new Error('Pluang sign-in runs in the FinPlan desktop app.');
  const meta = await metadata();
  const redirectUri = await n.oauthRedirectUri();
  let s = await getJSONSecret<Session>(SECRET_KEY);
  if (!s || s.redirectUri !== redirectUri) {
    const r = await request(meta.registration_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'FinPlan (personal finance, read-only)', redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post', scope: SCOPE,
      }),
    });
    const j = JSON.parse(r.text || '{}');
    if (r.status >= 400 || !j.client_id) throw new Error(`Pluang client registration failed: ${j.error_description || j.error || r.status}`);
    s = { clientId: j.client_id, clientSecret: j.client_secret, redirectUri };
  }
  const { verifier, challenge } = await pkce();
  const state = randomString(16);
  const url = `${meta.authorization_endpoint}?${form({
    response_type: 'code', client_id: s.clientId, redirect_uri: redirectUri, scope: SCOPE, state,
    code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE,
  })}`;
  const res = await n.oauthAuthorize(url);
  if (res.state !== state) throw new Error('Sign-in state mismatch, please try again');
  const t = await tokenRequest(meta, {
    grant_type: 'authorization_code', code: res.code, redirect_uri: redirectUri, client_id: s.clientId,
    client_secret: s.clientSecret, code_verifier: verifier, resource: RESOURCE,
  });
  await setSecret(SECRET_KEY, JSON.stringify({ ...s, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 }));
}

export async function disconnectPluang() {
  const s = await getJSONSecret<Session>(SECRET_KEY);
  if (s?.refreshToken || s?.accessToken) {
    try {
      const meta = await metadata();
      if (meta.revocation_endpoint) await request(meta.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: s.refreshToken || s.accessToken, client_id: s.clientId, client_secret: s.clientSecret }) });
    } catch { /* best effort */ }
  }
  await setSecret(SECRET_KEY, null);
}

async function accessToken(force = false): Promise<string> {
  const s = await getJSONSecret<Session>(SECRET_KEY);
  if (!s?.accessToken && !s?.refreshToken) throw Object.assign(new Error('Pluang is not connected'), { needsLogin: true });
  if (!force && s.accessToken && (s.expiresAt || 0) > Date.now() + 60_000) return s.accessToken;
  if (!s.refreshToken) throw Object.assign(new Error('Pluang session expired, sign in again'), { needsLogin: true });
  const t = await tokenRequest(await metadata(), { grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret, resource: RESOURCE })
    .catch((e) => { throw Object.assign(e, { needsLogin: true }); });
  await setSecret(SECRET_KEY, JSON.stringify({ ...s, accessToken: t.access_token, refreshToken: t.refresh_token || s.refreshToken, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 }));
  return t.access_token;
}

/* ---------------- MCP (Streamable HTTP) ---------------- */

function parseRpc(text: string, id: number) {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  // text/event-stream: take the JSON-RPC message with our id
  const msgs = t.split(/\n\n+/).map((ev) => ev.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')).filter(Boolean);
  for (const m of msgs.reverse()) { try { const j = JSON.parse(m); if (j.id === id || j.result || j.error) return j; } catch { /* skip */ } }
  throw new Error('Unexpected MCP response');
}

class McpClient {
  private sessionId?: string; private nextId = 1; private protocol = '2025-06-18';
  constructor(private token: string) {}
  private async post(msg: object, notify = false) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.token}` };
    if (this.sessionId) { headers['Mcp-Session-Id'] = this.sessionId; headers['MCP-Protocol-Version'] = this.protocol; }
    const r = await request(RESOURCE, { method: 'POST', headers, body: JSON.stringify(msg), timeoutMs: 30000 });
    if (r.status === 401) throw Object.assign(new Error('Pluang session expired'), { status: 401 });
    if (r.status >= 400) throw new Error(`Pluang MCP HTTP ${r.status}`);
    const sid = r.headers?.['mcp-session-id']; if (sid) this.sessionId = sid;
    return notify ? null : parseRpc(r.text, (msg as any).id);
  }
  async init() {
    const j = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'FinPlan', version: '1.0' } } });
    if (j.result?.protocolVersion) this.protocol = j.result.protocolVersion;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, true);
  }
  async call(name: string, args: Record<string, unknown>) {
    const j = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } });
    if (j.error) throw new Error(`Pluang ${name}: ${j.error.message}`);
    const r = j.result;
    if (r?.isError) throw new Error(`Pluang ${name}: ${r.content?.[0]?.text?.slice(0, 200) || 'error'}`);
    if (r?.structuredContent) return r.structuredContent;
    const txt = r?.content?.find((c: any) => c.type === 'text')?.text;
    return txt ? JSON.parse(txt) : r;
  }
}

/* ---------------- Portfolio mapping ---------------- */

export interface PluangPortfolio {
  holdings: Holding[];
  summary: { navIdr: number; pnlIdr: number; usdIdr: number; cashIdr: number; cashUsd: number; usStocksUsd: number; cryptoIdr: number; idxIdr: number; positions: number };
}

const CAT: Record<string, { cls: Holding['assetClass']; market: Holding['market']; label: string }> = {
  cryptocurrency: { cls: 'crypto', market: 'CRYPTO', label: 'Crypto' },
  global_equity: { cls: 'stock', market: 'US', label: 'US Stocks' },
  indo_stock: { cls: 'stock', market: 'IDX', label: 'ID Stocks' },
};

/** Find a numeric "USDT Total Value"-style block anywhere in the response (USDT has no row of its own). */
function findUsdtIdr(o: any): number {
  let found = 0;
  const walk = (x: any) => {
    if (!x || typeof x !== 'object' || found) return;
    const title = String(x.title ?? x.label ?? x.name ?? '');
    if (/usdt total value/i.test(title)) {
      const v = x.meta?.value ?? x.value?.amount ?? x.amount ?? x.value;
      const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''));
      if (n > 0) { found = n; return; }
    }
    for (const k of Object.keys(x)) walk(x[k]);
  };
  walk(o);
  return found;
}

/** Map Pluang's portfolio_get_holdings + portfolio_get_wallet_balance payloads to FinPlan holdings. Exported for tests. */
export function mapPluang(holdingsRes: any, walletsRes: any, fallbackUsdIdr: number): PluangPortfolio {
  const data = holdingsRes?.data ?? holdingsRes;
  const out: Holding[] = [];
  let usd = 0, idrNonUsd = 0;
  for (const cat of data?.assetCategories || []) {
    const c = CAT[cat.assetCategory] || { cls: 'stock' as const, market: 'OTHER' as const, label: cat.title || cat.assetCategory };
    for (const row of cat.assetCategoryData || []) {
      const ti = row.tileInfo || {}, vp = row.display?.valueAndProfit || {}, m = vp.meta || {};
      const qty = Number(vp.totalQuantity ?? vp.assetQuantity ?? 0), value = Number(m.value ?? 0);
      const currency: 'IDR' | 'USD' = m.currency === 'USD' ? 'USD' : 'IDR';
      if (!qty || value <= 0) continue;
      if (currency === 'USD') usd += value; else idrNonUsd += value;
      if ((currency === 'USD' && value < 1) || (currency === 'IDR' && value < 1000)) continue; // dust
      const price = value / qty;
      const cost = Number(m.weightedCost ?? 0);
      out.push({
        id: uid(), source: 'pluang', symbol: String(ti.displaySymbol || ti.symbol || '?').toUpperCase(), name: ti.name || ti.symbol,
        assetClass: ti.isMetal ? 'gold' : c.cls, qty, price, avgPrice: cost > 0 ? cost : price, currency, market: c.market, category: c.label,
      });
    }
  }
  const usdtIdr = findUsdtIdr(data);
  const nav = Number(data?.reportedTotals?.netAssetValueIdr ?? 0), pnl = Number(data?.reportedTotals?.unrealisedPnlIdr ?? 0);
  // Implied USD/IDR from Pluang's own IDR total (US rows are in USD, crypto/IDX rows in IDR)
  const usdIdr = usd > 0 && nav > idrNonUsd + usdtIdr ? (nav - idrNonUsd - usdtIdr) / usd : fallbackUsdIdr;
  if (usdtIdr > 0) out.push({ id: uid(), source: 'pluang', symbol: 'USDT', name: 'USDT (crypto tab)', assetClass: 'cash', qty: usdtIdr, avgPrice: 1, price: 1, currency: 'IDR', market: 'OTHER', category: 'Crypto' });
  let cashIdr = 0, cashUsd = 0;
  for (const w of walletsRes?.data?.wallets ?? walletsRes?.wallets ?? []) {
    const amt = Number(w.totalBalance?.amount ?? 0); if (amt <= 0) continue;
    const isUsd = w.currency === 'USD';
    if (isUsd) cashUsd += amt; else cashIdr += amt;
    if ((isUsd && amt < 1) || (!isUsd && amt < 1000)) continue;
    out.push({ id: uid(), source: 'pluang', symbol: String(w.cardType || 'CASH'), name: `Pluang ${w.title || 'wallet'}`, assetClass: 'cash', qty: amt, avgPrice: 1, price: 1, currency: isUsd ? 'USD' : 'IDR', market: 'OTHER', category: 'Cash wallets' });
  }
  const idx = out.filter((h) => h.market === 'IDX').reduce((s, h) => s + h.qty * h.price, 0);
  const crypto = out.filter((h) => h.market === 'CRYPTO').reduce((s, h) => s + h.qty * h.price, 0) + usdtIdr;
  return {
    holdings: out,
    summary: { navIdr: nav, pnlIdr: pnl, usdIdr: Math.round(usdIdr), cashIdr, cashUsd, usStocksUsd: usd, cryptoIdr: crypto, idxIdr: idx, positions: out.filter((h) => h.assetClass !== 'cash').length },
  };
}

/** Read the live Pluang portfolio (holdings + cash wallets). Retries once with a refreshed token. */
export async function syncPluangMcp(fallbackUsdIdr: number): Promise<PluangPortfolio> {
  const run = async (force: boolean) => {
    const mcp = new McpClient(await accessToken(force));
    await mcp.init();
    const userQuery = 'FinPlan weekly portfolio sync (read-only)';
    const sess = await mcp.call('generate_new_session_id', { user_query: userQuery }).catch(() => null);
    const chatSessionId = sess?.data?.chatSessionId || sess?.chatSessionId || crypto.randomUUID();
    const args = { user_query: userQuery, chat_session_id: chatSessionId };
    const [h, w] = await Promise.all([
      mcp.call('portfolio_get_holdings', { ...args, category: 'all', limit: 200, sort_by: 'value_desc' }),
      mcp.call('portfolio_get_wallet_balance', args).catch(() => null),
    ]);
    return mapPluang(h, w, fallbackUsdIdr);
  };
  try { return await run(false); }
  catch (e: any) { if (e.status === 401) return run(true); throw e; }
}

/** Read-only market-data call through the desktop app's own Pluang sign-in (used by Markets charts). */
let shared: { client: McpClient; session: string; at: number } | null = null;
export async function callPluangTool(tool: string, args: Record<string, unknown>): Promise<any> {
  const READ_ONLY = new Set(['indo_stocks_get_price', 'indo_stocks_get_ohlc', 'us_stocks_get_price', 'us_stocks_get_ohlc', 'crypto_get_price', 'crypto_get_ohlc']);
  if (!READ_ONLY.has(tool)) throw new Error('Not allowed');
  const run = async (force: boolean) => {
    if (!shared || force || Date.now() - shared.at > 20 * 60_000) {
      const client = new McpClient(await accessToken(force));
      await client.init();
      const s = await client.call('generate_new_session_id', { user_query: 'FinPlan markets dashboard (read-only quotes)' }).catch(() => null);
      shared = { client, session: s?.data?.chatSessionId || crypto.randomUUID(), at: Date.now() };
    }
    return shared.client.call(tool, { ...args, user_query: 'FinPlan markets dashboard (read-only quotes)', chat_session_id: shared.session });
  };
  try { return await run(false); } catch (e: any) { if (e.status === 401) return run(true); throw e; }
}
