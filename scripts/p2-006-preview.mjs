import { readFile } from 'node:fs/promises';
import { createConversationWorkbenchHttpServer, listenConversationWorkbenchServer, closeConversationWorkbenchServer } from '../src/p2-006-workbench-http.mjs';

const mode = process.argv[2] ?? '--check';
const files = [
  new URL('../web/p2-workbench/index.html', import.meta.url),
  new URL('../web/p2-workbench/workbench.css', import.meta.url),
  new URL('../web/p2-workbench/workbench.js', import.meta.url),
  new URL('../web/p2-workbench/workbench-state.mjs', import.meta.url),
];

async function check() {
  const values = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  const joined = values.join('\n');
  if (!joined.includes('INTERNAL ALPHA') || /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/iu.test(joined)) {
    throw new Error('P2_006_PREVIEW_STATIC_CHECK_FAILED');
  }
  console.log('P2-006 preview check passed (4 static assets, safe DOM baseline).');
}

if (mode === '--check') await check();
else if (mode === '--serve') {
  if (process.env.P2_006_PREVIEW_APPROVED !== 'true') throw new Error('P2_006_PREVIEW_APPROVAL_REQUIRED');
  await check();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const principal = Object.freeze({ principal_id: '00000000-0000-4000-8000-000000000001', display_name: '合成坐席', capabilities: Object.freeze(['VIEW']) });
  const queryService = Object.freeze({
    getBootstrap: async () => ({ authenticated: true, principal, expires_at: expiresAt, csrf_token: 'synthetic-preview-csrf-token', capabilities: ['VIEW'], feature_status: { workbench_enabled: true }, polling_interval_ms: 5000, sse_endpoint: '/api/realtime/events?scope=workbench', max_page_sizes: { conversations: 100, timeline: 200 } }),
    listConversations: async () => ({ items: [], next_cursor: null }),
    getConversationDetail: async () => { throw new Error('WORKBENCH_NOT_FOUND'); },
    listConversationItems: async () => ({ items: [], before_sequence: null, after_sequence: null, has_more: false }),
    listEligiblePrincipals: async () => ({ items: [] }), listConversationDeliveries: async () => ({ items: [] }),
  });
  const commandFacade = new Proxy({}, { get: () => async () => ({ ok: true }) });
  const server = createConversationWorkbenchHttpServer({ enabled: true, queryService, commandFacade,
    publicOrigin: 'http://127.0.0.1:43126', authenticate: async () => ({ principal_id: principal.principal_id, auth_method: 'COOKIE', expires_at: expiresAt, csrf_token: 'synthetic-preview-csrf-token' }) });
  const address = await listenConversationWorkbenchServer(server, { host: '127.0.0.1', port: 43126 });
  console.log(`P2-006 synthetic preview listening on http://${address.address}:${address.port}/workbench`);
  const stop = async () => { await closeConversationWorkbenchServer(server); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} else throw new Error('Usage: node scripts/p2-006-preview.mjs --check|--serve');
