import { createServer } from 'node:http';
import { createYxxSelfServiceNativeHttp } from '../../src/yxx-self-service-native-http.mjs';

export const SS007_FLAGS = Object.freeze({
  YIXIAOXIU_SELF_SERVICE_ENABLED: true,
  YIXIAOXIU_MY_REPORTS_ENABLED: true,
});

export const SS007_REFS = Object.freeze({
  FIRST: 'C'.repeat(32),
  SECOND: 'D'.repeat(32),
});

const csrf = 'ss007-acceptance-csrf-012345678901234567890123';
const recoveryBindingSecret = 'ss007-acceptance-recovery-secret-0123456789';
const accepted = (requestRef, clientCommandId, acceptedRevision = '1') => ({
  replayed: false,
  receipt: { client_command_id: clientCommandId, request_ref: requestRef, status: 'ACCEPTED',
    intake_no: 'INT-20260917-0001', accepted_revision: acceptedRevision,
    accepted_at: '2026-09-17 09:00:00', accepted_epoch_ms: '1789606800000' },
});

function httpError(status, code) {
  const value = new Error(code);
  value.status = status;
  value.code = code;
  return value;
}

function adaptSyntheticSession(request, response, url) {
  request.headers.cookie = (request.headers.cookie ?? '').split(';').map(part => part.trim())
    .map(part => part.startsWith('yxx_session=') ? `__Host-wecom_session=${part.slice('yxx_session='.length)}` : part).filter(Boolean).join('; ');
  if (request.method === 'POST' && url.pathname === '/wecom/yixiaoxiu/logout') {
    const writeHead = response.writeHead.bind(response);
    response.writeHead = (status, headers = {}) => {
      const existing = headers['set-cookie'] ?? [];
      const cookies = Array.isArray(existing) ? existing : [existing];
      return writeHead(status, { ...headers, 'set-cookie': [...cookies, 'yxx_session=; Path=/; SameSite=Lax; Max-Age=0'] });
    };
  }
}

export async function startSs007AcceptanceFixture() {
  let native;
  const state = {
    authExpired: false,
    commandCalls: [],
    commandStatusCalls: [],
    commandStatusResponses: [],
    detailCalls: [],
    supplementCalls: [],
    logoutCalls: 0,
    byRef: new Map([
      [SS007_REFS.FIRST, { description: '标签页一故障', revision: '1' }],
      [SS007_REFS.SECOND, { description: '标签页二故障', revision: '1' }],
    ]),
    supplementConflict: false,
    timelineFailureOnce: false,
  };
  const server = createServer(async (request, response) => {
    if (!native) { response.writeHead(503); response.end(); return; }
    const url = new URL(request.url, origin);
    adaptSyntheticSession(request, response, url);
    const handled = await native.handler({ request, response, url });
    if (!handled && !response.writableEnded) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const oauth = {
    authenticate(token) {
      if (state.authExpired || token !== 'member-a') throw httpError(401, 'WECOM_AUTH_REQUIRED');
      return { userid: 'synthetic-member-a' };
    },
    logout() { state.logoutCalls += 1; },
    begin() {
      return { location: `${origin}/wecom/yixiaoxiu/login?state=synthetic`, browserToken: 'synthetic-browser-token' };
    },
  };
  const query = {
    async list() {
      return {
        schema_version: 1,
        items: [...state.byRef.entries()].map(([ref, value]) => ({
          kind: 'WEB_REQUEST', ref, intake_no: `YXX-${ref.slice(0, 4)}`,
          display_status: 'WAITING_FOR_DETAILS', created_at: '2026-09-17 08:00:00', ticket: null,
          safe_description: value.description,
        })),
        next_cursor: null,
      };
    },
    async detailWithEtag({ requestRef, ifNoneMatch }) {
      state.detailCalls.push({ requestRef, ifNoneMatch });
      const value = state.byRef.get(requestRef);
      if (!value) throw httpError(404, 'YXX_NOT_FOUND');
      const etag = `"${requestRef}-${value.revision}"`;
      if (ifNoneMatch === etag) return { status: 304, body: null, etag };
      return {
        status: 200,
        etag,
        body: {
          source_kind: 'WEB_REQUEST', request_ref: requestRef, intake_no: `YXX-${requestRef.slice(0, 4)}`,
          display_status: 'WAITING_FOR_DETAILS', input_revision: value.revision, processed_revision: '0',
          needs_action: '请补充可观察事实', safe_description: value.description, safe_location: '护士站',
          created_at: '2026-09-17 08:00:00', created_epoch_ms: '1789603200000',
          updated_at: '2026-09-17 08:00:00', updated_epoch_ms: '1789603200000',
          supplements: [], ticket: null, safe_clarification: null, can_supplement: true,
        },
      };
    },
    async timeline() {
      if (state.timelineFailureOnce) {
        state.timelineFailureOnce = false;
        throw httpError(503, 'YXX_TIMELINE_UNAVAILABLE');
      }
      return {
        schema_version: 1,
        items: [{ event_type: 'intake.accepted', summary: '已收到报修', occurred_at: '2026-09-17 08:00:00' }],
        next_cursor: null,
      };
    },
    async commandStatus({ clientCommandId }) {
      state.commandStatusCalls.push(clientCommandId);
      if (state.commandStatusResponses.length) return state.commandStatusResponses.shift();
      throw httpError(404, `YXX_COMMAND_NOT_FOUND_${clientCommandId}`);
    },
  };
  const command = {
    async accept({ input }) {
      state.commandCalls.push(structuredClone(input));
      if (input.description === '触发429') throw httpError(429, 'YXX_QUOTA_EXCEEDED');
      if (input.description === '触发409') throw httpError(409, 'YXX_COMMAND_CONFLICT');
      if (input.description === '触发503') throw httpError(503, 'YXX_UNAVAILABLE');
      const requestRef = input.description.includes('标签页二') ? SS007_REFS.SECOND : SS007_REFS.FIRST;
      state.byRef.set(requestRef, { description: input.description, revision: '1' });
      return accepted(requestRef, input.client_command_id);
    },
  };
  const supplement = {
    async accept({ requestRef, input }) {
      state.supplementCalls.push({ requestRef, input: structuredClone(input) });
      if (state.supplementConflict) {
        const value = state.byRef.get(requestRef);
        state.byRef.set(requestRef, { ...value, revision: '2' });
        throw httpError(409, 'YXX_VERSION_CONFLICT');
      }
      return accepted(requestRef, input.client_command_id, String(Number(input.expected_input_revision) + 1));
    },
  };
  const oauthHttp = async ({ response }) => {
    response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<main><p>旧认证提示</p></main>');
    return true;
  };
  native = createYxxSelfServiceNativeHttp({
    publicOrigin: origin,
    oauth,
    oauthHttp,
    command,
    supplement,
    query,
    authenticateMember: async () => ({
      profile: 'MEMBER_SELF_SERVICE', flags: SS007_FLAGS, csrf_token: csrf,
      canonical_reporter_binding: 'c'.repeat(64), source_corp_scope: 'corp-acceptance', source_app_scope: 'app-acceptance',
    }),
    featureFlags: SS007_FLAGS,
    recoveryBindingSecret,
  });
  return { origin, server, state };
}

export async function closeSs007AcceptanceFixture(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function waitForSs007State(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('YXX_SS007_ACCEPTANCE_STATE_TIMEOUT');
}
