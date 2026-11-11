/**
 * Pluang portfolio through Claude's own Pluang connector (when FinPlan runs as an artifact inside Claude).
 * Read-only: only portfolio_get_holdings + portfolio_get_wallet_balance are declared for the artifact.
 */
import { connectorAvailable } from './market';
import { mapPluang, type PluangPortfolio } from './pluangMcp';

const SERVER = 'Pluang MCP';
const UQ = 'FinPlan portfolio sync (read-only)';

/** True when Claude's Pluang connector is reachable from this page. */
export async function pluangConnectorAvailable(): Promise<boolean> {
  return !!(await connectorAvailable());
}

export async function syncPluangConnector(fallbackUsdIdr: number): Promise<PluangPortfolio> {
  const mcp = await connectorAvailable();
  if (!mcp) throw new Error('Pluang connector is not available here');
  const sess = await mcp.callTool(SERVER, 'generate_new_session_id', { user_query: UQ }).catch(() => null);
  const chat_session_id = sess?.payload?.data?.chatSessionId || crypto.randomUUID();
  const args = { user_query: UQ, chat_session_id };
  const nocache = { cache: { staleTime: 0, gcTime: 60_000 } }; // always fresh: this is the user's own money
  const [h, w] = await Promise.all([
    mcp.callTool(SERVER, 'portfolio_get_holdings', { ...args, category: 'all', limit: 200, sort_by: 'value_desc' }, nocache),
    mcp.callTool(SERVER, 'portfolio_get_wallet_balance', args, nocache).catch(() => null),
  ]);
  const hp = h?.payload;
  if (!hp || hp.success === false) throw new Error(hp?.message || 'Pluang did not return your portfolio. Check the Pluang connector in Claude settings.');
  return mapPluang(hp, w?.payload ?? null, fallbackUsdIdr);
}
