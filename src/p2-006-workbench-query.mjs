const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,1024}$/u;
const FILTERS = new Set(['open', 'waiting_human', 'mine', 'unassigned', 'waiting_user', 'failed_delivery', 'ended']);
const AUDIENCES = new Set(['WORKBENCH', 'RESTRICTED_ADMIN']);

export const WORKBENCH_ERROR_CODES = Object.freeze({
  disabled: 'WORKBENCH_DISABLED', unauthenticated: 'WORKBENCH_UNAUTHENTICATED', authExpired: 'WORKBENCH_AUTH_EXPIRED',
  forbidden: 'WORKBENCH_FORBIDDEN', notFound: 'WORKBENCH_NOT_FOUND', csrfInvalid: 'WORKBENCH_CSRF_INVALID',
  originInvalid: 'WORKBENCH_ORIGIN_INVALID', contentTypeInvalid: 'WORKBENCH_CONTENT_TYPE_INVALID',
  requestTooLarge: 'WORKBENCH_REQUEST_TOO_LARGE', requestInvalid: 'WORKBENCH_REQUEST_INVALID',
  cursorInvalid: 'WORKBENCH_CURSOR_INVALID', pageLimitInvalid: 'WORKBENCH_PAGE_LIMIT_INVALID',
  versionConflict: 'WORKBENCH_VERSION_CONFLICT', idempotencyMismatch: 'WORKBENCH_IDEMPOTENCY_MISMATCH',
  attachmentNotAvailable: 'WORKBENCH_ATTACHMENT_NOT_AVAILABLE', incidentNotAvailable: 'WORKBENCH_INCIDENT_NOT_AVAILABLE',
  deliveryRetryForbidden: 'WORKBENCH_DELIVERY_RETRY_FORBIDDEN',
  deliveryReconciliationRequired: 'WORKBENCH_DELIVERY_RECONCILIATION_REQUIRED',
  sseUnavailable: 'WORKBENCH_SSE_UNAVAILABLE', storageFailed: 'WORKBENCH_STORAGE_FAILED',
  readIndexGap: 'P2_006_READ_INDEX_GAP',
});

export class WorkbenchError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'WorkbenchError';
    this.code = code;
    this.status = status;
  }
}

function fail(code = WORKBENCH_ERROR_CODES.requestInvalid, status = 400) { throw new WorkbenchError(code, status); }
function uuid(value) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(); return value.toLowerCase(); }
function integer(value, fallback, maximum) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) fail(WORKBENCH_ERROR_CODES.pageLimitInvalid);
  return parsed;
}
function bigintString(value, { allowZero = true } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') fail();
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(text) || (!allowZero && text === '0')) fail();
  return text;
}
function iso(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) fail(WORKBENCH_ERROR_CODES.storageFailed, 500); return date.toISOString(); }

export function encodeConversationCursor({ last_activity_at, session_id }) {
  const payload = JSON.stringify({ v: 1, t: iso(last_activity_at), s: uuid(session_id) });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeConversationCursor(value) {
  if (typeof value !== 'string' || !CURSOR_PATTERN.test(value)) fail(WORKBENCH_ERROR_CODES.cursorInvalid);
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || parsed.v !== 1 || Object.keys(parsed).sort().join(',') !== 's,t,v') fail(WORKBENCH_ERROR_CODES.cursorInvalid);
    return Object.freeze({ last_activity_at: iso(parsed.t), session_id: uuid(parsed.s) });
  } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    fail(WORKBENCH_ERROR_CODES.cursorInvalid);
  }
}

function publicItem(row) {
  return Object.freeze({
    item_id: row.id,
    sequence_no: String(row.sequence_no),
    item_type: row.item_type,
    sender_kind: row.sender_kind,
    visibility: row.visibility,
    text: row.text,
    safe_content: row.safe_content ?? {},
    occurred_at: iso(row.occurred_at),
  });
}

function assignmentView(row, principalId) {
  return Object.freeze({
    status: row.assignment_status ?? 'UNASSIGNED',
    version: Number(row.assignment_version ?? 0),
    assigned_to_me: row.assigned_principal_id === principalId,
    assigned_display_name: row.assigned_display_name ?? null,
    assigned_at: row.assigned_at ? iso(row.assigned_at) : null,
  });
}

function handoffView(row) {
  return row.handoff_id ? Object.freeze({
    handoff_id: row.handoff_id,
    status: row.handoff_status,
    reason_code: row.handoff_reason_code,
    row_version: Number(row.handoff_row_version),
    requested_at: iso(row.handoff_requested_at),
  }) : null;
}

function ticketView(row) {
  return row.ticket_id ? Object.freeze({
    ticket_id: row.ticket_id,
    ticket_no: row.ticket_no,
    title: row.ticket_title,
    status: row.ticket_status,
    priority: row.ticket_priority,
    version: Number(row.ticket_version),
  }) : null;
}

function deliveryView(row) {
  return row.delivery_id ? Object.freeze({
    delivery_id: row.delivery_id,
    status: row.delivery_status,
    channel: row.delivery_provider,
    attempt_count: Number(row.delivery_attempt_count),
    last_error_code: row.delivery_last_error_code,
    side_effect_state: row.delivery_side_effect_state,
    sent_at: row.delivery_sent_at ? iso(row.delivery_sent_at) : null,
  }) : null;
}

function capabilities(authorize, principal, row) {
  return authorize.actionsFor(principal, {
    assignedToMe: row.assigned_principal_id === principal.principal_id,
    canTakeover: row.assignment_status !== 'ASSIGNED',
  });
}

function baseSelect() {
  return `SELECT s.id::text AS session_id, s.thread_id::text, s.status, s.control_mode,
                 s.generation_version::text, s.row_version::text, s.last_activity_at,
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

function listStateSql(state, index, principalIdIndex) {
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

export function createConversationWorkbenchQueryService({ pool, enabled = false, authorize, now = () => new Date() } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof enabled !== 'boolean' || !authorize || typeof now !== 'function') {
    throw new TypeError('Workbench query service configuration is invalid.');
  }
  function guard() { if (!enabled) fail(WORKBENCH_ERROR_CODES.disabled, 503); }
  async function principalFrom(authContext) {
    const principal = await authorize.resolvePrincipal(authContext);
    if (principal === null) fail(WORKBENCH_ERROR_CODES.forbidden, 403);
    return principal;
  }

  async function getBootstrap({ authContext }) {
    guard();
    const principal = await principalFrom(authContext);
    return Object.freeze({
      authenticated: true,
      principal: authorize.safePrincipal(principal),
      expires_at: authContext.expires_at,
      csrf_token: authContext.auth_method === 'COOKIE' ? authContext.csrf_token : undefined,
      capabilities: authorize.actionsFor(principal),
      feature_status: Object.freeze({ workbench_enabled: true, realtime_sse_enabled: false, ai_enabled: false, incident_enabled: false, attachments_enabled: false }),
      polling_interval_ms: 5000,
      sse_endpoint: '/api/realtime/events?scope=workbench',
      max_page_sizes: Object.freeze({ conversations: 100, timeline: 200 }),
    });
  }

  async function listConversations({ authContext, state = 'open', cursor = null, limit } = {}) {
    guard();
    if (!FILTERS.has(state)) fail();
    const principal = await principalFrom(authContext);
    const pageSize = integer(limit, 30, 100);
    const values = [principal.principal_id];
    const predicate = authorize.sessionAccessPredicate(principal, { start: 2, ticketAlias: 'tk' });
    values.push(...predicate.values);
    const clauses = [predicate.sql];
    const stateClause = listStateSql(state, values.length + 1, 1);
    clauses.push(stateClause.sql);
    if (cursor !== null && cursor !== undefined && cursor !== '') {
      const decoded = decodeConversationCursor(cursor);
      values.push(decoded.last_activity_at, decoded.session_id);
      clauses.push(`(s.last_activity_at, s.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(pageSize + 1);
    let result;
    try {
      result = await pool.query(`${baseSelect()} WHERE ${clauses.join(' AND ')} ORDER BY s.last_activity_at DESC, s.id DESC LIMIT $${values.length}`, values);
    } catch { fail(WORKBENCH_ERROR_CODES.storageFailed, 500); }
    const hasMore = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);
    const items = rows.map((row) => Object.freeze({
      session: Object.freeze({ session_id: row.session_id, status: row.status, control_mode: row.control_mode,
        generation_version: Number(row.generation_version), row_version: Number(row.row_version), last_activity_at: iso(row.last_activity_at) }),
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
      waiting_duration_seconds: Math.max(0, Math.floor((now().getTime() - new Date(row.last_activity_at).getTime()) / 1000)),
      capabilities: capabilities(authorize, principal, row),
    }));
    return Object.freeze({ items: Object.freeze(items), next_cursor: hasMore && rows.length > 0
      ? encodeConversationCursor({ last_activity_at: rows.at(-1).last_activity_at, session_id: rows.at(-1).session_id }) : null });
  }

  async function detailContext(authContext, sessionId) {
    const principal = await principalFrom(authContext);
    const id = uuid(sessionId);
    if (!await authorize.authorizeSession({ principal, sessionId: id, action: 'VIEW' })) fail(WORKBENCH_ERROR_CODES.notFound, 404);
    const result = await pool.query(`${baseSelect()} WHERE s.id = $2::uuid`, [principal.principal_id, id]);
    if (result.rowCount !== 1) fail(WORKBENCH_ERROR_CODES.notFound, 404);
    return { principal, row: result.rows[0], sessionId: id };
  }

  async function getConversationDetail({ authContext, sessionId }) {
    guard();
    const { principal, row } = await detailContext(authContext, sessionId);
    const cursor = await pool.query('SELECT last_read_sequence::text,row_version::text FROM conversation.read_cursor WHERE principal_id=$1::uuid AND session_id=$2::uuid', [principal.principal_id, row.session_id]);
    return Object.freeze({
      session: Object.freeze({ session_id: row.session_id, status: row.status, control_mode: row.control_mode,
        generation_version: Number(row.generation_version), row_version: Number(row.row_version), last_activity_at: iso(row.last_activity_at) }),
      assignment: assignmentView(row, principal.principal_id), handoff: handoffView(row),
      read_cursor: Object.freeze({ last_read_sequence: String(cursor.rows[0]?.last_read_sequence ?? '0'), row_version: Number(cursor.rows[0]?.row_version ?? 0) }),
      unread_count: row.unread_count, ticket: ticketView(row), incident: Object.freeze({ available: false, reason: 'INCIDENT_NOT_IMPLEMENTED' }),
      attachments: Object.freeze({ available: false, reason: 'ATTACHMENT_NOT_IMPLEMENTED' }),
      delivery_summary: deliveryView(row), capabilities: capabilities(authorize, principal, row), etag: `"${row.row_version}"`,
    });
  }

  async function listConversationItems({ authContext, sessionId, before_sequence, after_sequence, limit } = {}) {
    guard();
    const { principal, sessionId: id } = await detailContext(authContext, sessionId);
    if (before_sequence !== undefined && after_sequence !== undefined) fail();
    const pageSize = integer(limit, 50, 200);
    const audience = authorize.isAdmin(principal) ? 'RESTRICTED_ADMIN' : 'WORKBENCH';
    if (!AUDIENCES.has(audience)) fail();
    const visibility = audience === 'RESTRICTED_ADMIN' ? ['EXTERNAL', 'INTERNAL', 'RESTRICTED'] : ['EXTERNAL', 'INTERNAL'];
    const values = [id, visibility];
    let boundary = '';
    let direction = 'DESC';
    if (before_sequence !== undefined) { values.push(bigintString(before_sequence)); boundary = `AND sequence_no < $3::bigint`; }
    if (after_sequence !== undefined) { values.push(bigintString(after_sequence)); boundary = `AND sequence_no > $3::bigint`; direction = 'ASC'; }
    values.push(pageSize + 1);
    const result = await pool.query(
      `SELECT id::text, sequence_no::text, item_type, sender_kind, visibility, text, safe_content, occurred_at
         FROM conversation.item
        WHERE session_id=$1::uuid AND visibility=ANY($2::text[]) ${boundary}
        ORDER BY sequence_no ${direction} LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > pageSize;
    let rows = result.rows.slice(0, pageSize);
    if (direction === 'DESC') rows = rows.reverse();
    const items = rows.map(publicItem);
    return Object.freeze({
      session_id: id, items: Object.freeze(items),
      before_sequence: items.length ? items[0].sequence_no : null,
      after_sequence: items.length ? items.at(-1).sequence_no : null,
      has_more: hasMore,
    });
  }

  async function listEligiblePrincipals(input) {
    guard();
    const { principal, sessionId } = await detailContext(input.authContext, input.sessionId);
    const items = await authorize.listEligiblePrincipals({ principal, sessionId });
    if (items === null) fail(WORKBENCH_ERROR_CODES.notFound, 404);
    return Object.freeze({ items });
  }

  async function listConversationDeliveries(input) {
    guard();
    const { sessionId } = await detailContext(input.authContext, input.sessionId);
    const result = await pool.query(
      `SELECT d.id::text AS delivery_id,d.status,d.provider AS channel,d.attempt_count,d.last_error_code,d.side_effect_state,d.sent_at
         FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
        WHERE m.session_id=$1::uuid ORDER BY d.updated_at DESC,d.id DESC LIMIT 100`, [sessionId]);
    return Object.freeze({ items: Object.freeze(result.rows.map((row) => Object.freeze({
      delivery_id: row.delivery_id, status: row.status, channel: row.channel, attempt_count: row.attempt_count,
      last_error_code: row.last_error_code, side_effect_state: row.side_effect_state,
      sent_at: row.sent_at ? iso(row.sent_at) : null,
      actions: Object.freeze(row.status === 'PENDING' ? ['RETRY'] : row.status === 'DEAD_LETTER' && row.side_effect_state === 'NOT_ATTEMPTED'
        ? ['RETRY'] : row.status === 'RECONCILIATION_REQUIRED' ? ['RECONCILE'] : []),
    }))) });
  }

  return Object.freeze({ getBootstrap, listConversations, getConversationDetail, listConversationItems,
    listEligiblePrincipals, listConversationDeliveries });
}
