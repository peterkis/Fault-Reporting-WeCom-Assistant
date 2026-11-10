import { randomUUID } from 'node:crypto';

// Moved unchanged in behaviour from the retired app/server/scripts/p2-g1-resource-observation.mjs: the bare G1 resource
// integration case still submits one internal note over the original HTTP API (bootstrap CSRF, open-conversation list,
// row_version If-Match, Idempotency-Key) and then checks that no outbox or delivery row is created.
type Cookie = { name: string; value: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export async function submitP2G1InternalNoteOverApi(origin: string, cookie: Cookie, text: string) {
  const headers = { cookie: `${cookie.name}=${cookie.value}` };
  const bootstrapResponse = await fetch(`${origin}/api/workbench/bootstrap`, { headers, signal: AbortSignal.timeout(5_000) });
  const bootstrap = record(await bootstrapResponse.json() as unknown);
  const listResponse = await fetch(`${origin}/api/conversations?state=open&limit=1`, { headers, signal: AbortSignal.timeout(5_000) });
  const list = record(await listResponse.json() as unknown);
  const items = Array.isArray(list.items) ? list.items as unknown[] : [];
  const sessionId = record(record(items[0]).session).session_id;
  if (!bootstrapResponse.ok || !listResponse.ok || typeof bootstrap.csrf_token !== 'string' || typeof sessionId !== 'string') {
    throw new Error('P2_G1_RESOURCE_WORKLOAD_CONTEXT_UNAVAILABLE');
  }
  const detailResponse = await fetch(`${origin}/api/conversations/${sessionId}`, { headers, signal: AbortSignal.timeout(5_000) });
  const rowVersion = record(record(await detailResponse.json() as unknown).session).row_version;
  if (!detailResponse.ok || typeof rowVersion !== 'number' || !Number.isSafeInteger(rowVersion) || rowVersion < 0) {
    throw new Error('P2_G1_RESOURCE_WORKLOAD_CONTEXT_UNAVAILABLE');
  }
  const commandId = randomUUID();
  const response = await fetch(`${origin}/api/conversations/${sessionId}/internal-notes`, {
    method: 'POST',
    headers: {
      ...headers,
      origin,
      'content-type': 'application/json',
      'x-csrf-token': bootstrap.csrf_token,
      'sec-fetch-site': 'same-origin',
      'idempotency-key': commandId,
      'if-match': `"${rowVersion}"`,
    },
    body: JSON.stringify({ expected_row_version: rowVersion, client_command_id: commandId, text }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 201) throw new Error('P2_G1_RESOURCE_WORKLOAD_SUBMIT_FAILED');
  return Object.freeze({ submitted: true });
}
