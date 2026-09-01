import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createWorkbenchStaticHandler } from './p2-006-workbench-static.mjs';
import { WORKBENCH_ERROR_CODES, WorkbenchError } from './p2-006-workbench-query.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_URL_BYTES = 2048;
const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'";

function securityHeaders(api = true) {
  return {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(api ? { 'cache-control': 'no-store' } : {}),
  };
}

function json(response, status, body, extra = {}) {
  response.writeHead(status, { ...securityHeaders(), 'content-type': 'application/json; charset=utf-8', ...extra });
  response.end(JSON.stringify(body));
}

function publicError(response, error) {
  const code = error instanceof WorkbenchError ? error.code : WORKBENCH_ERROR_CODES.storageFailed;
  const status = error instanceof WorkbenchError ? error.status : 500;
  json(response, status, { error: { code, retryable: status >= 500 } });
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8'); const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request) {
  if ((request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.contentTypeInvalid, 415);
  }
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestTooLarge, 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value;
  } catch { throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400); }
}

function exactKeys(body, allowed, required) {
  if (Object.keys(body).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(body, key))) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400);
  }
}

function validateWriteRequest(request, authContext, body, { sessionMutation = true } = {}) {
  const commandId = request.headers['idempotency-key'];
  if (typeof commandId !== 'string' || !UUID_PATTERN.test(commandId) || commandId.toLowerCase() !== body.client_command_id?.toLowerCase()) {
    throw new WorkbenchError(WORKBENCH_ERROR_CODES.idempotencyMismatch, 400);
  }
  if (sessionMutation) {
    const ifMatch = request.headers['if-match'];
    const normalized = typeof ifMatch === 'string' ? ifMatch.replace(/^W\//u, '').replace(/^"|"$/gu, '') : '';
    if (!/^[1-9][0-9]*$/u.test(normalized) || Number(normalized) !== body.expected_row_version) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.versionConflict, 409);
    }
  }
  if (authContext.auth_method === 'COOKIE') {
    if (request.headers.origin !== authContext.public_origin) throw new WorkbenchError(WORKBENCH_ERROR_CODES.originInvalid, 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new WorkbenchError(WORKBENCH_ERROR_CODES.originInvalid, 403);
    if (!secureEqual(request.headers['x-csrf-token'], authContext.csrf_token)) throw new WorkbenchError(WORKBENCH_ERROR_CODES.csrfInvalid, 403);
  } else if (authContext.auth_method === 'BEARER') {
    if (typeof request.headers.authorization !== 'string' || !request.headers.authorization.startsWith('Bearer ')) {
      throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated, 401);
    }
  } else throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated, 401);
}

function authExpired(authContext) {
  const expires = new Date(authContext?.expires_at);
  return !Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now();
}

export function createWorkbenchAuthenticationPort({ authenticate } = {}) {
  if (typeof authenticate !== 'function') throw new TypeError('WorkbenchAuthenticationPort authenticate is required.');
  return Object.freeze({ authenticate });
}

export function createConversationWorkbenchHttpServer({ enabled = false, queryService, commandFacade, authenticate,
  sseHandler = null, publicOrigin = 'http://127.0.0.1', staticHandler = createWorkbenchStaticHandler({ enabled }) } = {}) {
  if (typeof authenticate !== 'function') throw new TypeError('WorkbenchAuthenticationPort authenticate is required.');
  if (!queryService || !commandFacade || typeof enabled !== 'boolean' || (sseHandler !== null && typeof sseHandler !== 'function')) {
    throw new TypeError('Workbench HTTP server configuration is invalid.');
  }

  return createServer(async (request, response) => {
    for (const [name, value] of Object.entries(securityHeaders(false))) response.setHeader(name, value);
    try {
      if (Buffer.byteLength(request.url ?? '', 'utf8') > MAX_URL_BYTES) throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 414);
      const url = new URL(request.url ?? '/', publicOrigin);
      if (await staticHandler(url.pathname, response)) return;
      if (!url.pathname.startsWith('/api/')) { json(response, 404, { error: { code: WORKBENCH_ERROR_CODES.notFound, retryable: false } }); return; }
      if (!enabled) throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled, 503);
      if (url.searchParams.has('access_token') || url.searchParams.has('token') || url.searchParams.has('authorization')) {
        throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated, 401);
      }
      let authContext;
      try { authContext = await authenticate(request); } catch { authContext = null; }
      if (!authContext) throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated, 401);
      if (authExpired(authContext)) throw new WorkbenchError(WORKBENCH_ERROR_CODES.authExpired, 401);
      authContext = Object.freeze({ ...authContext, public_origin: publicOrigin });

      if (request.method === 'GET' && url.pathname === '/api/realtime/events') {
        if (sseHandler === null) throw new WorkbenchError(WORKBENCH_ERROR_CODES.sseUnavailable, 503);
        const delay = Math.max(1, new Date(authContext.expires_at).getTime() - Date.now());
        const timer = setTimeout(() => { if (!response.destroyed) response.destroy(); }, delay);
        timer.unref?.(); response.once('close', () => clearTimeout(timer));
        await sseHandler(request, response, url); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/workbench/bootstrap') {
        json(response, 200, await queryService.getBootstrap({ authContext })); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/conversations') {
        const allowed = new Set(['state', 'cursor', 'limit']);
        if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new WorkbenchError(WORKBENCH_ERROR_CODES.requestInvalid, 400);
        json(response, 200, await queryService.listConversations({ authContext, state: url.searchParams.get('state') ?? 'open',
          cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit') ?? undefined })); return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]+)(?:\/(items|eligible-principals|deliveries))?$/iu);
      if (request.method === 'GET' && sessionMatch) {
        const sessionId = sessionMatch[1]; const child = sessionMatch[2];
        if (!child) { const detail = await queryService.getConversationDetail({ authContext, sessionId }); json(response, 200, detail, { etag: detail.etag }); return; }
        if (child === 'items') { json(response, 200, await queryService.listConversationItems({ authContext, sessionId,
          before_sequence: url.searchParams.get('before_sequence') ?? undefined, after_sequence: url.searchParams.get('after_sequence') ?? undefined,
          limit: url.searchParams.get('limit') ?? undefined })); return; }
        if (child === 'eligible-principals') { json(response, 200, await queryService.listEligiblePrincipals({ authContext, sessionId })); return; }
        if (child === 'deliveries') { json(response, 200, await queryService.listConversationDeliveries({ authContext, sessionId })); return; }
      }
      const actionMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]+)\/(handoff\/request|handoff\/cancel|takeover|transfer|release|read-cursor|messages|internal-notes)$/iu);
      if (request.method === 'POST' && actionMatch) {
        const body = await readJson(request); const sessionId = actionMatch[1]; const action = actionMatch[2].toLowerCase();
        const common = ['client_command_id', 'expected_row_version', 'reason_code'];
        if (action === 'handoff/request') exactKeys(body, [...common], ['client_command_id', 'expected_row_version']);
        else if (action === 'handoff/cancel') exactKeys(body, [...common, 'handoff_id'], ['client_command_id', 'expected_row_version']);
        else if (action === 'takeover') exactKeys(body, [...common, 'target_principal_id', 'handoff_id'], ['client_command_id', 'expected_row_version']);
        else if (action === 'transfer') exactKeys(body, [...common, 'target_principal_id', 'force'], ['client_command_id', 'expected_row_version', 'target_principal_id']);
        else if (action === 'release') exactKeys(body, [...common], ['client_command_id', 'expected_row_version']);
        else if (action === 'read-cursor') exactKeys(body, ['client_command_id', 'expected_cursor_row_version', 'last_read_sequence', 'reason_code'], ['client_command_id', 'expected_cursor_row_version', 'last_read_sequence']);
        else if (action === 'messages') exactKeys(body, [...common, 'message_type', 'text', 'reply_to_item_id'], ['client_command_id', 'expected_row_version', 'text']);
        else exactKeys(body, [...common, 'text'], ['client_command_id', 'expected_row_version', 'text']);
        validateWriteRequest(request, authContext, body, { sessionMutation: action !== 'read-cursor' });
        const method = action === 'handoff/request' ? 'requestHandoff' : action === 'handoff/cancel' ? 'cancelHandoff'
          : action === 'read-cursor' ? 'advanceReadCursor' : action === 'messages' ? 'reply'
            : action === 'internal-notes' ? 'internalNote' : action;
        const result = await commandFacade[method]({ authContext, sessionId, body });
        json(response, action === 'messages' ? 202 : action === 'internal-notes' ? 201 : 200, result); return;
      }
      const deliveryMatch = url.pathname.match(/^\/api\/deliveries\/([0-9a-f-]+)\/(retry|reconcile)$/iu);
      if (request.method === 'POST' && deliveryMatch) {
        const body = await readJson(request);
        if (deliveryMatch[2].toLowerCase() === 'retry') exactKeys(body, ['client_command_id', 'reason_code'], ['client_command_id']);
        else exactKeys(body, ['client_command_id', 'resolution', 'reason_code'], ['client_command_id', 'resolution', 'reason_code']);
        validateWriteRequest(request, authContext, body, { sessionMutation: false });
        const result = deliveryMatch[2].toLowerCase() === 'retry'
          ? await commandFacade.retryDelivery({ authContext, deliveryId: deliveryMatch[1], reason_code: body.reason_code })
          : await commandFacade.reconcileDelivery({ authContext, deliveryId: deliveryMatch[1], resolution: body.resolution, reason_code: body.reason_code });
        json(response, 200, result); return;
      }
      if (request.method === 'GET' && /^\/api\/attachments\//u.test(url.pathname)) {
        throw new WorkbenchError(WORKBENCH_ERROR_CODES.attachmentNotAvailable, 404);
      }
      json(response, 404, { error: { code: WORKBENCH_ERROR_CODES.notFound, retryable: false } });
    } catch (error) { if (!response.headersSent) publicError(response, error); else response.destroy(); }
  });
}

export function listenConversationWorkbenchServer(server, { host = '127.0.0.1', port = 0 } = {}) {
  if (!server || typeof server.listen !== 'function' || host !== '127.0.0.1') throw new TypeError('Workbench server must bind to loopback.');
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(server.address()); };
    server.once('error', onError); server.once('listening', onListening); server.listen(port, host);
  });
}

export function closeConversationWorkbenchServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
