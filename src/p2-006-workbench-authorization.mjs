const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTERNAL_ROLES = Object.freeze(['ADMIN', 'DISPATCHER', 'HANDLER']);

export const WORKBENCH_AUTHORIZATION_ACTIONS = Object.freeze([
  'VIEW', 'TAKEOVER', 'REQUEST_HANDOFF', 'CANCEL_HANDOFF', 'TRANSFER', 'FORCE_TRANSFER',
  'RELEASE', 'REPLY', 'INTERNAL_NOTE', 'READ_CURSOR', 'DELIVERY_RETRY', 'RECONCILE',
]);

function uuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError('Invalid principal or resource identifier.');
  return value.toLowerCase();
}

function freezeArray(value) {
  return Object.freeze([...new Set(value)].sort());
}

function hasRole(principal, role) {
  return principal?.roles?.includes(role) === true;
}

function isWorker(principal) {
  return principal?.is_active === true && principal.roles.some((role) => INTERNAL_ROLES.includes(role));
}

function actionsFor(principal, { assignedToMe = false, canTakeover = false } = {}) {
  if (!isWorker(principal)) return Object.freeze([]);
  const actions = ['VIEW', 'READ_CURSOR'];
  if (hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER') || canTakeover) {
    actions.push('TAKEOVER', 'REQUEST_HANDOFF', 'CANCEL_HANDOFF', 'TRANSFER', 'DELIVERY_RETRY');
  }
  if (hasRole(principal, 'ADMIN')) actions.push('FORCE_TRANSFER', 'RECONCILE');
  if (assignedToMe || hasRole(principal, 'ADMIN')) actions.push('RELEASE', 'REPLY', 'INTERNAL_NOTE');
  return freezeArray(actions);
}

async function loadPrincipal(queryable, principalId) {
  const result = await queryable.query(
    `SELECT p.id::text, p.display_name, p.is_active,
            COALESCE(array_agg(DISTINCT r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT m.team_id) FILTER (WHERE m.team_id IS NOT NULL), '{}') AS team_ids
       FROM pilot_ticket.pilot_principal AS p
       LEFT JOIN pilot_ticket.pilot_principal_role AS r ON r.principal_id = p.id
       LEFT JOIN pilot_ticket.pilot_team_member AS m ON m.principal_id = p.id
      WHERE p.id = $1::uuid
      GROUP BY p.id, p.display_name, p.is_active`,
    [uuid(principalId)],
  );
  if (result.rowCount !== 1 || result.rows[0].is_active !== true) return null;
  const row = result.rows[0];
  const principal = Object.freeze({
    principal_id: row.id,
    display_name: row.display_name,
    is_active: true,
    roles: freezeArray(row.roles),
    team_ids: freezeArray(row.team_ids),
  });
  return isWorker(principal) ? principal : null;
}

function safePrincipal(principal, context = {}) {
  return Object.freeze({
    principal_id: principal.principal_id,
    display_name: principal.display_name,
    capabilities: actionsFor(principal, context),
  });
}

export function createPilotWorkbenchAuthorizationAdapter({ pool } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required.');

  async function resolvePrincipal(authContext, { queryable = pool } = {}) {
    if (!authContext || typeof authContext !== 'object') return null;
    try { return await loadPrincipal(queryable, authContext.principal_id); } catch { return null; }
  }

  async function getSessionAccess({ principal, sessionId, queryable = pool }) {
    if (!isWorker(principal)) return null;
    const result = await queryable.query(
      `SELECT s.id::text AS session_id, s.thread_id::text,
              a.assignment_status, a.assigned_principal_id::text,
              t.resolver_team_id
         FROM conversation.session AS s
         LEFT JOIN conversation.assignment AS a ON a.session_id = s.id
         LEFT JOIN pilot_ticket.ticket AS t ON t.source_intake_id = s.service_intake_id
        WHERE s.id = $1::uuid
          AND (
            $2::boolean
            OR a.assigned_principal_id = $3::uuid
            OR (
              $4::boolean
              AND t.resolver_team_id IS NOT NULL
              AND t.resolver_team_id = ANY($5::text[])
            )
          )`,
      [uuid(sessionId), hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER'),
        principal.principal_id, hasRole(principal, 'HANDLER'), principal.team_ids],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return Object.freeze({
      session_id: row.session_id,
      thread_id: row.thread_id,
      assigned_to_me: row.assignment_status === 'ASSIGNED' && row.assigned_principal_id === principal.principal_id,
      can_takeover: row.assignment_status !== 'ASSIGNED' && (hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER')
        || (hasRole(principal, 'HANDLER') && row.resolver_team_id !== null && principal.team_ids.includes(row.resolver_team_id))),
    });
  }

  async function authorizeSession({ principal, sessionId, action = 'VIEW', queryable = pool }) {
    const access = await getSessionAccess({ principal, sessionId, queryable });
    if (access === null) return false;
    if (action === 'FORCE_TRANSFER' || action === 'RECONCILE') return hasRole(principal, 'ADMIN');
    if (action === 'TRANSFER') return hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER') || access.assigned_to_me;
    if (['REPLY', 'INTERNAL_NOTE', 'RELEASE'].includes(action)) return access.assigned_to_me || hasRole(principal, 'ADMIN');
    if (action === 'TAKEOVER') return access.can_takeover || access.assigned_to_me;
    return true;
  }

  function sessionAccessPredicate(principal, { alias = 's', assignmentAlias = 'a', ticketAlias = 't', start = 1 } = {}) {
    if (!isWorker(principal)) return Object.freeze({ sql: 'FALSE', values: Object.freeze([]) });
    const broad = hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER');
    return Object.freeze({
      sql: `($${start}::boolean OR ${assignmentAlias}.assigned_principal_id = $${start + 1}::uuid OR (`
        + `$${start + 2}::boolean AND ${ticketAlias}.resolver_team_id IS NOT NULL AND ${ticketAlias}.resolver_team_id = ANY($${start + 3}::text[])))`,
      values: Object.freeze([broad, principal.principal_id, hasRole(principal, 'HANDLER'), principal.team_ids]),
      alias,
    });
  }

  async function listEligiblePrincipals({ principal, sessionId }) {
    const access = await getSessionAccess({ principal, sessionId });
    if (access === null) return null;
    const result = await pool.query(
      `SELECT p.id::text AS principal_id, p.display_name,
              COALESCE(bool_or(r.role = 'ADMIN'), false) AS is_admin,
              COALESCE(bool_or(r.role = 'DISPATCHER'), false) AS is_dispatcher,
              COALESCE(bool_or(r.role = 'HANDLER'), false) AS is_handler
         FROM pilot_ticket.pilot_principal AS p
         JOIN pilot_ticket.pilot_principal_role AS r ON r.principal_id = p.id
         LEFT JOIN pilot_ticket.pilot_team_member AS m ON m.principal_id = p.id
         LEFT JOIN conversation.session AS s ON s.id = $1::uuid
         LEFT JOIN pilot_ticket.ticket AS t ON t.source_intake_id = s.service_intake_id
        WHERE p.is_active = TRUE
          AND r.role IN ('ADMIN','DISPATCHER','HANDLER')
          AND (r.role IN ('ADMIN','DISPATCHER') OR (r.role = 'HANDLER' AND m.team_id = t.resolver_team_id))
        GROUP BY p.id, p.display_name
        ORDER BY p.display_name, p.id
        LIMIT 100`,
      [uuid(sessionId)],
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      principal_id: row.principal_id,
      display_name: row.display_name,
      actions: freezeArray([
        'TRANSFER_TARGET',
        ...(row.is_admin ? ['FORCE_TRANSFER_TARGET'] : []),
      ]),
    })));
  }

  async function resolveRealtimeAuthorization(principal) {
    if (!isWorker(principal)) return null;
    const predicate = sessionAccessPredicate(principal, { start: 1 });
    const result = await pool.query(
      `SELECT s.id::text AS session_id, s.thread_id::text
         FROM conversation.session AS s
         LEFT JOIN conversation.assignment AS a ON a.session_id = s.id
         LEFT JOIN pilot_ticket.ticket AS t ON t.source_intake_id = s.service_intake_id
        WHERE ${predicate.sql}
        ORDER BY s.id
        LIMIT 5000`,
      predicate.values,
    );
    return Object.freeze({
      allowed_session_ids: freezeArray(result.rows.map((row) => row.session_id)),
      allowed_thread_ids: freezeArray(result.rows.map((row) => row.thread_id)),
      allow_system_events: hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER'),
      allow_restricted_admin: hasRole(principal, 'ADMIN'),
    });
  }

  return Object.freeze({
    resolvePrincipal,
    safePrincipal,
    getSessionAccess,
    authorizeSession,
    sessionAccessPredicate,
    listEligiblePrincipals,
    resolveRealtimeAuthorization,
    actionsFor,
    isAdmin: (principal) => hasRole(principal, 'ADMIN'),
    isDispatcher: (principal) => hasRole(principal, 'DISPATCHER'),
  });
}
