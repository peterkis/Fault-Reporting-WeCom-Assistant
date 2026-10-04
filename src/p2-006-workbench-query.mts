import type { LocalDateTime } from '../contracts/time_contracts.js';
import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WorkbenchAuthorizationAdapter, WorkbenchPrincipal } from './p2-006-workbench-authorization.mjs';

export type WorkbenchListState = 'open' | 'waiting_human' | 'mine' | 'unassigned' | 'waiting_user' | 'failed_delivery' | 'ended';
export interface WorkbenchAuthContext {
  principal_id: string;
  auth_method?: string;
  expires_at?: string;
  expires_epoch_ms?: string;
  csrf_token?: string | null | undefined;
}
interface AuthInput { authContext?: WorkbenchAuthContext }
export interface WorkbenchListInput extends AuthInput { state?: WorkbenchListState; cursor?: string | null; limit?: string | number | null }
export interface WorkbenchDetailInput { authContext: WorkbenchAuthContext; sessionId: string }
export interface WorkbenchItemsInput extends AuthInput { sessionId?: string; before_sequence?: string | number | bigint; after_sequence?: string | number | bigint; limit?: string | number | null }
type QueryAuthorizer = Pick<WorkbenchAuthorizationAdapter, 'resolvePrincipal' | 'safePrincipal' | 'actionsFor' | 'sessionAccessPredicate' | 'authorizeSession' | 'isAdmin' | 'listEligiblePrincipals'>;
export interface WorkbenchQueryOptions { pool?: PostgresTransaction; enabled?: boolean; authorize?: QueryAuthorizer; nowEpochMs?: (() => unknown) | null; now?: () => Date; featureStatus?: Readonly<Record<string, boolean>> | null }
interface ItemRow { id: string; sequence_no: string | number; item_type: string; sender_kind: string; visibility: string; text: string | null; safe_content: unknown; occurred_at: unknown }
interface WorkbenchBaseRow {
  session_id: string; thread_id: string; status: string; control_mode: string; generation_version: string; row_version: string;
  last_activity_at: string; last_activity_epoch_ms: unknown; chat_type: string; unread_count: number;
  assignment_status: string | null; assigned_principal_id: string | null; assignment_version: string | null; assigned_at: unknown; assigned_display_name: string | null;
  handoff_id: string | null; handoff_status: string | null; handoff_reason_code: string | null; handoff_row_version: string | null; handoff_requested_at: unknown;
  ticket_id: string | null; ticket_no: string | null; ticket_title: string | null; ticket_status: string | null; ticket_priority: string | null; ticket_version: string | null;
  delivery_id: string | null; delivery_status: string | null; delivery_provider: string | null; delivery_attempt_count: number | null; delivery_last_error_code: string | null; delivery_side_effect_state: string | null; delivery_sent_at: unknown;
}
type WorkbenchRow = WorkbenchBaseRow & ({ last_item_id: null; last_item_sequence: null; last_item_type: null; last_item_sender_kind: null; last_item_visibility: null; last_item_text: null; last_item_safe_content: unknown; last_item_occurred_at: unknown } | { last_item_id: string; last_item_sequence: string; last_item_type: string; last_item_sender_kind: string; last_item_visibility: string; last_item_text: string | null; last_item_safe_content: unknown; last_item_occurred_at: unknown });
interface DeliveryRow { delivery_id: string; status: string; channel: string; attempt_count: number; last_error_code: string | null; side_effect_state: string; sent_at: unknown }

import { assertEpochMsString, assertLocalDateTime } from './platform/time-contract.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,1024}$/u;
const FILTERS = new Set<WorkbenchListState>(['open', 'waiting_human', 'mine', 'unassigned', 'waiting_user', 'failed_delivery', 'ended']);
const AUDIENCES = new Set(['WORKBENCH', 'RESTRICTED_ADMIN']);

export const WORKBENCH_ERROR_CODES = Object.freeze({
  disabled: 'WORKBENCH_DISABLED', unauthenticated: 'WORKBENCH_UNAUTHENTICATED', authExpired: 'WORKBENCH_AUTH_EXPIRED',
  forbidden: 'WORKBENCH_FORBIDDEN', notFound: 'WORKBENCH_NOT_FOUND', csrfInvalid: 'WORKBENCH_CSRF_INVALID',
  authStateInvalid: 'WORKBENCH_AUTH_STATE_INVALID', authFailed: 'WORKBENCH_AUTH_FAILED', authNotReady: 'WORKBENCH_AUTH_NOT_READY',
  authBusy: 'WORKBENCH_AUTH_BUSY',
  authRateLimited: 'WORKBENCH_AUTH_RATE_LIMITED',
  originInvalid: 'WORKBENCH_ORIGIN_INVALID', contentTypeInvalid: 'WORKBENCH_CONTENT_TYPE_INVALID',
  requestTooLarge: 'WORKBENCH_REQUEST_TOO_LARGE', requestInvalid: 'WORKBENCH_REQUEST_INVALID',
  cursorInvalid: 'WORKBENCH_CURSOR_INVALID', pageLimitInvalid: 'WORKBENCH_PAGE_LIMIT_INVALID',
  versionConflict: 'WORKBENCH_VERSION_CONFLICT', idempotencyMismatch: 'WORKBENCH_IDEMPOTENCY_MISMATCH',
  attachmentNotAvailable: 'WORKBENCH_ATTACHMENT_NOT_AVAILABLE', incidentNotAvailable: 'WORKBENCH_INCIDENT_NOT_AVAILABLE',
  externalSendDisabled: 'WORKBENCH_EXTERNAL_SEND_DISABLED',
  deliveryRetryForbidden: 'WORKBENCH_DELIVERY_RETRY_FORBIDDEN',
  deliveryReconciliationRequired: 'WORKBENCH_DELIVERY_RECONCILIATION_REQUIRED',
  sseUnavailable: 'WORKBENCH_SSE_UNAVAILABLE', storageFailed: 'WORKBENCH_STORAGE_FAILED',
  readIndexGap: 'P2_006_READ_INDEX_GAP',
});

export class WorkbenchError extends Error {
  declare code: string;
  declare status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = 'WorkbenchError';
    this.code = code;
    this.status = status;
  }
}

function fail(code: string = WORKBENCH_ERROR_CODES.requestInvalid, status = 400): never { throw new WorkbenchError(code, status); }
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(); return value.toLowerCase(); }
function integer(value: string | number | null | undefined, fallback: number, maximum: number): number {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) fail(WORKBENCH_ERROR_CODES.pageLimitInvalid);
  return parsed;
}
function bigintString(value: unknown, { allowZero = true }: { allowZero?: boolean } = {}): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') fail();
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(text) || (!allowZero && text === '0')) fail();
  return text;
}
function localDateTime(value: unknown): LocalDateTime {
  try { return assertLocalDateTime(value); }
  catch { fail(WORKBENCH_ERROR_CODES.storageFailed, 500); }
}

function elapsedSeconds(nowEpochMs: unknown, anchorEpochMs: unknown): number {
  const now = BigInt(assertEpochMsString(nowEpochMs));
  const anchor = BigInt(assertEpochMsString(anchorEpochMs));
  if (now <= anchor) return 0;
  const seconds = (now - anchor) / 1000n;
  return Number(seconds > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : seconds);
}

export function encodeConversationCursor({ last_activity_at, session_id }: { last_activity_at: string; session_id: string }) {
  const payload = JSON.stringify({ v: 1, t: localDateTime(last_activity_at), s: uuid(session_id) });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeConversationCursor(value: unknown) {
  if (typeof value !== 'string' || !CURSOR_PATTERN.test(value)) fail(WORKBENCH_ERROR_CODES.cursorInvalid);
  try {
    // The existing version/key and field validators below reject malformed JSON.
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { v?: unknown; t?: unknown; s?: unknown } | null;
    if (!parsed || parsed.v !== 1 || Object.keys(parsed).sort().join(',') !== 's,t,v') fail(WORKBENCH_ERROR_CODES.cursorInvalid);
    return Object.freeze({ last_activity_at: localDateTime(parsed.t), session_id: uuid(parsed.s) });
  } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    fail(WORKBENCH_ERROR_CODES.cursorInvalid);
  }
}

function publicItem(row: ItemRow) {
  return Object.freeze({
    item_id: row.id,
    sequence_no: String(row.sequence_no),
    item_type: row.item_type,
    sender_kind: row.sender_kind,
    visibility: row.visibility,
    text: row.text,
    safe_content: row.safe_content ?? {},
    occurred_at: localDateTime(row.occurred_at),
  });
}

function assignmentView(row: WorkbenchRow, principalId: string) {
  return Object.freeze({
    status: row.assignment_status ?? 'UNASSIGNED',
    version: Number(row.assignment_version ?? 0),
    assigned_to_me: row.assigned_principal_id === principalId,
    assigned_display_name: row.assigned_display_name ?? null,
    assigned_at: row.assigned_at ? localDateTime(row.assigned_at) : null,
  });
}

function handoffView(row: WorkbenchRow) {
  return row.handoff_id ? Object.freeze({
    handoff_id: row.handoff_id,
    status: row.handoff_status,
    reason_code: row.handoff_reason_code,
    row_version: Number(row.handoff_row_version),
    requested_at: localDateTime(row.handoff_requested_at),
  }) : null;
}

function ticketView(row: WorkbenchRow) {
  return row.ticket_id ? Object.freeze({
    ticket_id: row.ticket_id,
    ticket_no: row.ticket_no,
    title: row.ticket_title,
    status: row.ticket_status,
    priority: row.ticket_priority,
    version: Number(row.ticket_version),
  }) : null;
}

function deliveryView(row: WorkbenchRow) {
  return row.delivery_id ? Object.freeze({
    delivery_id: row.delivery_id,
    status: row.delivery_status,
    channel: row.delivery_provider,
    attempt_count: Number(row.delivery_attempt_count),
    last_error_code: row.delivery_last_error_code,
    side_effect_state: row.delivery_side_effect_state,
    sent_at: row.delivery_sent_at ? localDateTime(row.delivery_sent_at) : null,
  }) : null;
}

function capabilities(authorize: QueryAuthorizer, principal: WorkbenchPrincipal, row: WorkbenchRow) {
  return authorize.actionsFor(principal, {
    assignedToMe: row.assigned_principal_id === principal.principal_id,
    canTakeover: row.assignment_status !== 'ASSIGNED',
  });
}

function baseSelect() {
  return `SELECT s.id::text AS session_id, s.thread_id::text, s.status, s.control_mode,
                 s.generation_version::text, s.row_version::text, s.last_activity_at, s.last_activity_epoch_ms::text,
                 th.chat_type, a.assignment_status, a.assigned_principal_id::text,
                 a.assignment_version::text, a.assigned_at, ap.display_name AS assigned_display_name,
                 h.id::text AS handoff_id, h.status AS handoff_status, h.reason_code AS handoff_reason_code,
                 h.row_version::text AS handoff_row_version, h.requested_at AS handoff_requested_at,
                 tk.id::text AS ticket_id, tk.ticket_no, tk.title AS ticket_title, tk.status AS ticket_status,
                 tk.priority AS ticket_priority, tk.version AS ticket_version, tk.resolver_team_id,
                 li.id::text AS last_item_id, li.sequence_no::text AS last_item_sequence,
                 li.item_type AS last_item_type, li.sender_kind AS last_item_sender_kind,
                 li.visibility AS last_item_visibility, li.text AS last_item_text, li.safe_content AS last_item_safe_content,
                 li.occurred_at AS last_item_occurred_at,
                 COALESCE(uc.unread_count, 0)::integer AS unread_count,
                 ld.id::text AS delivery_id, ld.status AS delivery_status, ld.provider AS delivery_provider,
                 ld.attempt_count AS delivery_attempt_count, ld.last_error_code AS delivery_last_error_code,
                 ld.side_effect_state AS delivery_side_effect_state, ld.sent_at AS delivery_sent_at
            FROM conversation.session AS s
            JOIN conversation.thread AS th ON th.id = s.thread_id
            LEFT JOIN conversation.assignment AS a ON a.session_id = s.id
            LEFT JOIN pilot_ticket.pilot_principal AS ap ON ap.id = a.assigned_principal_id
            LEFT JOIN pilot_ticket.ticket AS tk ON tk.source_intake_id = s.service_intake_id
            LEFT JOIN LATERAL (
              SELECT i.id, i.sequence_no, i.item_type, i.sender_kind, i.visibility, i.text, i.safe_content, i.occurred_at
                FROM conversation.item AS i WHERE i.session_id = s.id AND i.visibility IN ('EXTERNAL','INTERNAL')
               ORDER BY i.sequence_no DESC LIMIT 1
            ) AS li ON TRUE
            LEFT JOIN LATERAL (
              SELECT count(*) AS unread_count FROM conversation.item AS ui
              LEFT JOIN conversation.read_cursor AS rc ON rc.session_id = ui.session_id AND rc.principal_id = $1::uuid
              WHERE ui.session_id = s.id AND ui.visibility IN ('EXTERNAL','INTERNAL')
                AND ui.sequence_no > COALESCE(rc.last_read_sequence, 0)
            ) AS uc ON TRUE
            LEFT JOIN LATERAL (
              SELECT d.id, d.status, d.provider, d.attempt_count, d.last_error_code, d.side_effect_state, d.sent_at
                FROM communication.message AS cm
                JOIN communication.outbox AS co ON co.message_id = cm.id
                JOIN communication.delivery AS d ON d.outbox_id = co.id
               WHERE cm.session_id = s.id ORDER BY d.updated_at DESC, d.id DESC LIMIT 1
            ) AS ld ON TRUE
            LEFT JOIN LATERAL (
              SELECT ch.id, ch.status, ch.reason_code, ch.row_version, ch.requested_at
                FROM conversation.handoff AS ch WHERE ch.session_id = s.id
               ORDER BY ch.requested_at DESC, ch.id DESC LIMIT 1
            ) AS h ON TRUE`;
}

function listStateSql(state: WorkbenchListState, index: number, principalIdIndex: number) {
  switch (state) {
    case 'waiting_human': return { sql: `(h.status = 'REQUESTED' OR (s.control_mode = 'HUMAN' AND COALESCE(a.assignment_status,'UNASSIGNED') = 'UNASSIGNED'))`, values: [] };
    case 'mine': return { sql: `a.assignment_status = 'ASSIGNED' AND a.assigned_principal_id = $${principalIdIndex}::uuid`, values: [] };
    case 'unassigned': return { sql: `COALESCE(a.assignment_status,'UNASSIGNED') = 'UNASSIGNED' AND s.status <> 'ENDED'`, values: [] };
    case 'waiting_user': return { sql: `s.status = 'WAITING_USER'`, values: [] };
    case 'failed_delivery': return { sql: `ld.status IN ('DEAD_LETTER','RECONCILIATION_REQUIRED')`, values: [] };
    case 'ended': return { sql: `s.status = 'ENDED'`, values: [] };
    case 'open': return { sql: `s.status <> 'ENDED'`, values: [] };
    default: fail(WORKBENCH_ERROR_CODES.requestInvalid);
  }
}

export function createConversationWorkbenchQueryService({
  pool,
  enabled = false,
  authorize,
  nowEpochMs = null,
  now = () => new Date(),
  featureStatus = null,
}: WorkbenchQueryOptions = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof enabled !== 'boolean' || !authorize
    || (nowEpochMs !== null && typeof nowEpochMs !== 'function') || typeof now !== 'function') {
    throw new TypeError('Workbench query service configuration is invalid.');
  }
  // Constructor guards prove these captured ports exist. Guard-proven type assertions
  // erase to the original access expressions without adding runtime aliases.
  function currentEpochMs() {
    if (nowEpochMs !== null) return assertEpochMsString(nowEpochMs());
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0) fail();
    return String(value.getTime());
  }
  function guard() { if (!enabled) fail(WORKBENCH_ERROR_CODES.disabled, 503); }
  async function principalFrom(authContext: WorkbenchAuthContext | undefined) {
    const principal = await (authorize as QueryAuthorizer).resolvePrincipal(authContext);
    if (principal === null) fail(WORKBENCH_ERROR_CODES.forbidden, 403);
    return principal;
  }

  async function getBootstrap({ authContext }: { authContext: WorkbenchAuthContext }) {
    guard();
    const principal = await principalFrom(authContext);
    return Object.freeze({
      authenticated: true,
      principal: (authorize as QueryAuthorizer).safePrincipal(principal),
      expires_at: authContext.expires_at,
      expires_epoch_ms: authContext.expires_epoch_ms,
      csrf_token: authContext.auth_method === 'COOKIE' ? authContext.csrf_token : undefined,
      capabilities: (authorize as QueryAuthorizer).actionsFor(principal),
      feature_status: Object.freeze(featureStatus ?? { workbench_enabled: true, realtime_sse_enabled: false, ai_enabled: false, incident_enabled: false, attachments_enabled: false }),
      polling_interval_ms: 5000,
      sse_endpoint: '/api/realtime/events?scope=workbench',
      max_page_sizes: Object.freeze({ conversations: 100, timeline: 200 }),
    });
  }

  async function listConversations({ authContext, state = 'open', cursor = null, limit }: WorkbenchListInput = {}) {
    guard();
    if (!FILTERS.has(state)) fail();
    const principal = await principalFrom(authContext);
    const pageSize = integer(limit, 30, 100);
    const values: unknown[] = [principal.principal_id];
    const predicate = (authorize as QueryAuthorizer).sessionAccessPredicate(principal, { start: 2, ticketAlias: 'tk' });
    values.push(...predicate.values);
    const clauses = [predicate.sql];
    const stateClause = listStateSql(state, values.length + 1, 1);
    clauses.push(stateClause.sql);
    if (cursor !== null && cursor !== undefined && cursor !== '') {
      const decoded = decodeConversationCursor(cursor);
      values.push(decoded.last_activity_at, decoded.session_id);
      clauses.push(`(s.last_activity_at, s.id) < ($${values.length - 1}::timestamp without time zone, $${values.length}::uuid)`);
    }
    values.push(pageSize + 1);
    let result;
    try {
      result = await (pool as PostgresTransaction).query<WorkbenchRow>(`${baseSelect()} WHERE ${clauses.join(' AND ')} ORDER BY s.last_activity_at DESC, s.id DESC LIMIT $${values.length}`, values);
    } catch { fail(WORKBENCH_ERROR_CODES.storageFailed, 500); }
    const hasMore = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);
    const items = rows.map((row) => Object.freeze({
      session: Object.freeze({ session_id: row.session_id, status: row.status, control_mode: row.control_mode,
        generation_version: Number(row.generation_version), row_version: Number(row.row_version), last_activity_at: localDateTime(row.last_activity_at) }),
      queue_state: row.status === 'ENDED' ? 'ended' : row.handoff_status === 'REQUESTED' ? 'waiting_human'
        : row.delivery_status === 'DEAD_LETTER' || row.delivery_status === 'RECONCILIATION_REQUIRED' ? 'failed_delivery'
          : row.status === 'WAITING_USER' ? 'waiting_user' : row.assignment_status === 'ASSIGNED' ? 'assigned' : 'unassigned',
      channel_label: row.chat_type === 'group' ? '群聊会话' : '单聊会话',
      unread_count: row.unread_count,
      last_item: row.last_item_id ? publicItem({ id: row.last_item_id, sequence_no: row.last_item_sequence,
        item_type: row.last_item_type, sender_kind: row.last_item_sender_kind, visibility: row.last_item_visibility,
        text: row.last_item_text, safe_content: row.last_item_safe_content, occurred_at: row.last_item_occurred_at }) : null,
      assignment: assignmentView(row, principal.principal_id),
      handoff: handoffView(row), ticket: ticketView(row), latest_delivery: deliveryView(row),
      waiting_duration_seconds: elapsedSeconds(currentEpochMs(), row.last_activity_epoch_ms),
      capabilities: capabilities(authorize as QueryAuthorizer, principal, row),
    }));
    // The existing length guard proves both accesses to the last dense PG row.
    return Object.freeze({ items: Object.freeze(items), next_cursor: hasMore && rows.length > 0
      ? encodeConversationCursor({ last_activity_at: (rows.at(-1) as WorkbenchRow).last_activity_at, session_id: (rows.at(-1) as WorkbenchRow).session_id }) : null });
  }

  async function detailContext(authContext: WorkbenchAuthContext | undefined, sessionId: unknown) {
    const principal = await principalFrom(authContext);
    const id = uuid(sessionId);
    if (!await (authorize as QueryAuthorizer).authorizeSession({ principal, sessionId: id, action: 'VIEW' })) fail(WORKBENCH_ERROR_CODES.notFound, 404);
    const result = await (pool as PostgresTransaction).query<WorkbenchRow>(`${baseSelect()} WHERE s.id = $2::uuid`, [principal.principal_id, id]);
    // PostgreSQL SELECT rowCount=1 proves the first row is present.
    if (result.rowCount !== 1) fail(WORKBENCH_ERROR_CODES.notFound, 404);
    return { principal, row: result.rows[0] as WorkbenchRow, sessionId: id };
  }

  async function getConversationDetail({ authContext, sessionId }: WorkbenchDetailInput) {
    guard();
    const { principal, row } = await detailContext(authContext, sessionId);
    const cursor = await (pool as PostgresTransaction).query<{ last_read_sequence: string; row_version: string }>('SELECT last_read_sequence::text,row_version::text FROM conversation.read_cursor WHERE principal_id=$1::uuid AND session_id=$2::uuid', [principal.principal_id, row.session_id]);
    return Object.freeze({
      session: Object.freeze({ session_id: row.session_id, status: row.status, control_mode: row.control_mode,
        generation_version: Number(row.generation_version), row_version: Number(row.row_version), last_activity_at: localDateTime(row.last_activity_at) }),
      assignment: assignmentView(row, principal.principal_id), handoff: handoffView(row),
      read_cursor: Object.freeze({ last_read_sequence: String(cursor.rows[0]?.last_read_sequence ?? '0'), row_version: Number(cursor.rows[0]?.row_version ?? 0) }),
      unread_count: row.unread_count, ticket: ticketView(row), incident: Object.freeze({ available: false, reason: 'INCIDENT_NOT_IMPLEMENTED' }),
      attachments: Object.freeze({ available: false, reason: 'ATTACHMENT_NOT_IMPLEMENTED' }),
      delivery_summary: deliveryView(row), capabilities: capabilities(authorize as QueryAuthorizer, principal, row), etag: `"${row.row_version}"`,
    });
  }

  async function listConversationItems({ authContext, sessionId, before_sequence, after_sequence, limit }: WorkbenchItemsInput = {}) {
    guard();
    const { principal, sessionId: id } = await detailContext(authContext, sessionId);
    if (before_sequence !== undefined && after_sequence !== undefined) fail();
    const pageSize = integer(limit, 50, 200);
    const audience = (authorize as QueryAuthorizer).isAdmin(principal) ? 'RESTRICTED_ADMIN' : 'WORKBENCH';
    if (!AUDIENCES.has(audience)) fail();
    const visibility = audience === 'RESTRICTED_ADMIN' ? ['EXTERNAL', 'INTERNAL', 'RESTRICTED'] : ['EXTERNAL', 'INTERNAL'];
    const values: unknown[] = [id, visibility];
    let boundary = '';
    let direction = 'DESC';
    if (before_sequence !== undefined) { values.push(bigintString(before_sequence)); boundary = `AND sequence_no < $3::bigint`; }
    if (after_sequence !== undefined) { values.push(bigintString(after_sequence)); boundary = `AND sequence_no > $3::bigint`; direction = 'ASC'; }
    values.push(pageSize + 1);
    const result = await (pool as PostgresTransaction).query<ItemRow>(
      `SELECT id::text, sequence_no::text, item_type, sender_kind, visibility, text, safe_content, occurred_at
         FROM conversation.item
        WHERE session_id=$1::uuid AND visibility=ANY($2::text[]) ${boundary}
        ORDER BY occurred_at ${direction}, sequence_no ${direction} LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > pageSize;
    let rows = result.rows.slice(0, pageSize);
    if (direction === 'DESC') rows = rows.reverse();
    const items = rows.map(publicItem);
    return Object.freeze({
      session_id: id, items: Object.freeze(items),
      // The original length guards prove the first and last dense mapped items.
      before_sequence: items.length ? (items[0] as ReturnType<typeof publicItem>).sequence_no : null,
      after_sequence: items.length ? (items.at(-1) as ReturnType<typeof publicItem>).sequence_no : null,
      has_more: hasMore,
    });
  }

  async function listEligiblePrincipals(input: WorkbenchDetailInput) {
    guard();
    const { principal, sessionId } = await detailContext(input.authContext, input.sessionId);
    const items = await (authorize as QueryAuthorizer).listEligiblePrincipals({ principal, sessionId });
    if (items === null) fail(WORKBENCH_ERROR_CODES.notFound, 404);
    return Object.freeze({ items });
  }

  async function listConversationDeliveries(input: WorkbenchDetailInput) {
    guard();
    const { sessionId } = await detailContext(input.authContext, input.sessionId);
    const result = await (pool as PostgresTransaction).query<DeliveryRow>(
      `SELECT d.id::text AS delivery_id,d.status,d.provider AS channel,d.attempt_count,d.last_error_code,d.side_effect_state,d.sent_at
         FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
        WHERE m.session_id=$1::uuid ORDER BY d.updated_at DESC,d.id DESC LIMIT 100`, [sessionId]);
    return Object.freeze({ items: Object.freeze(result.rows.map((row) => Object.freeze({
      delivery_id: row.delivery_id, status: row.status, channel: row.channel, attempt_count: row.attempt_count,
      last_error_code: row.last_error_code, side_effect_state: row.side_effect_state,
      sent_at: row.sent_at ? localDateTime(row.sent_at) : null,
      actions: Object.freeze(row.status === 'PENDING' ? ['RETRY'] : row.status === 'DEAD_LETTER' && row.side_effect_state === 'NOT_ATTEMPTED'
        ? ['RETRY'] : row.status === 'RECONCILIATION_REQUIRED' ? ['RECONCILE'] : []),
    }))) });
  }

  return Object.freeze({ getBootstrap, listConversations, getConversationDetail, listConversationItems,
    listEligiblePrincipals, listConversationDeliveries });
}
