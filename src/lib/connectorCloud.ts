/**
 * Inside Claude: sync through the website's FinPlan Cloud, reached as a Claude connector
 * (claude.ai → Settings → Connectors → Add custom connector → "FinPlan Cloud", https://finplan.bimabearing.cloud/mcp).
 * Same encrypted copies as the website (server/server.mjs), so FinPlan in Claude and on the website share one account.
 * Copies move in parts of ≤150 000 characters per tool call.
 */
import type { CloudFile, CloudStore } from './claudeCloud';
import { connectorAvailable } from './market';

export const CONNECTOR = 'FinPlan Cloud';
export const CONNECTOR_URL = 'https://finplan.bimabearing.cloud/mcp';
const PART = 150_000;
const K_BACKEND = 'finplan.cloud.backend';
const fresh = { cache: { staleTime: 0, gcTime: 0 } };

/** Where FinPlan inside Claude keeps its encrypted copy on this device: Claude's own storage, or the website's FinPlan Cloud. */
export type Backend = 'claude' | 'website';
export const backend = (): Backend => { try { return localStorage.getItem(K_BACKEND) === 'website' ? 'website' : 'claude'; } catch { return 'claude'; } };
export const setBackend = (b: Backend) => { try { localStorage.setItem(K_BACKEND, b); } catch { /* */ } };

export class ConnectorMissing extends Error {
  constructor(m = `Add the ${CONNECTOR} connector in Claude (Settings → Connectors → Add custom connector, URL ${CONNECTOR_URL}) and allow FinPlan to use it.`) { super(m); this.name = 'ConnectorMissing'; }
}
const MISSING = /server_not_connected|not_granted|unauthori[sz]ed|auth|consent|revoked|not_connected|forbidden/i;

async function call(tool: string, input: Record<string, unknown>): Promise<any> {
  const mcp = await connectorAvailable();
  if (!mcp) throw new ConnectorMissing();
  try {
    const r = await mcp.callTool(CONNECTOR, tool, input, fresh);
    let p = r?.payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { /* */ } }
    if (p?.content && !p.files && !p.data && !p.file && !p.upload_id) { // raw MCP result
      const t = p.content?.[0]?.text; if (p.isError) throw new Error(t || 'FinPlan Cloud error');
      try { p = JSON.parse(t); } catch { /* */ }
    }
    return p;
  } catch (e: any) {
    if (e instanceof ConnectorMissing) throw e;
    if (MISSING.test(String(e?.code || '')) || MISSING.test(String(e?.message || '')) && !/Wrong/.test(String(e?.message))) throw new ConnectorMissing();
    throw new Error(e?.message || 'FinPlan Cloud connector error');
  }
}

export const connectorStore: CloudStore = {
  async list(): Promise<CloudFile[]> { return ((await call('list_sync_copies', {}))?.files || []) as CloudFile[]; },
  async download(id) {
    let out = '', off = 0, size = Infinity;
    while (off < size) {
      const r = await call('read_sync_copy', { id, offset: off, length: PART });
      size = Number(r?.size) || 0; const d = String(r?.data ?? '');
      if (!d && off < size) throw new Error('FinPlan Cloud returned an empty part');
      out += d; off += d.length;
    }
    return out;
  },
  async upload(body, meta, id) {
    let upload_id: string | undefined; let last: any;
    const n = Math.max(1, Math.ceil(body.length / PART));
    for (let i = 0; i < n; i++) {
      const done = i === n - 1;
      last = await call('write_sync_copy', { ...(upload_id ? { upload_id } : {}), data: body.slice(i * PART, (i + 1) * PART), done, ...(done ? { ...(id ? { id } : {}), ...(meta.name ? { name: meta.name } : {}), appProperties: meta.appProperties } : {}) });
      upload_id = last?.upload_id;
    }
    if (!last?.file?.id) throw new Error('FinPlan Cloud did not confirm the save');
    return last.file as CloudFile;
  },
  async remove(id) { await call('delete_sync_copy', { id }); },
};

export async function connectorWho(): Promise<string | undefined> { try { return (await call('whoami', {}))?.email; } catch { return undefined; } }
