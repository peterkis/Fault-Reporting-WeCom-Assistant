import type { PostgresTransaction } from './platform/postgres-pool.mjs';

export interface WorkbenchPrincipal {
  readonly principal_id: string;
  readonly display_name: string;
  readonly is_active: boolean;
  readonly roles: readonly string[];
  readonly team_ids: readonly string[];
}
export interface WorkbenchActionContext { assignedToMe?: boolean; canTakeover?: boolean }
interface PrincipalRow { id: string; display_name: string; is_active: boolean; roles: string[]; team_ids: string[] }
interface SessionAccessRow { session_id: string; thread_id: string; assignment_status: string | null; assigned_principal_id: string | null; resolver_team_id: string | null }
interface EligiblePrincipalRow { principal_id: string; display_name: string; is_admin: boolean; is_dispatcher: boolean; is_handler: boolean }
export type WorkbenchAuthorizationAdapter = ReturnType<typeof createPilotWorkbenchAuthorizationAdapter>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTERNAL_ROLES = Object.freeze(['ADMIN', 'DISPATCHER', 'HANDLER']);

export const WORKBENCH_AUTHORIZATION_ACTIONS = Object.freeze([
  'VIEW', 'TAKEOVER', 'REQUEST_HANDOFF', 'CANCEL_HANDOFF', 'TRANSFER', 'FORCE_TRANSFER',
  'RELEASE', 'REPLY', 'INTERNAL_NOTE', 'READ_CURSOR', 'DELIVERY_RETRY', 'RECONCILE',
] as const);
export type WorkbenchAction = typeof WORKBENCH_AUTHORIZATION_ACTIONS[number];

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError('Invalid principal or resource identifier.');
  return value.toLowerCase();
}

function freezeArray<T extends string>(value: Iterable<T>): readonly T[] {
  return Object.freeze([...new Set(value)].sort());
}

function hasRole(principal: WorkbenchPrincipal | null | undefined, role: string): boolean {
  return principal?.roles?.includes(role) === true;
}

function isWorker(principal: WorkbenchPrincipal | null | undefined): principal is WorkbenchPrincipal {
  return principal?.is_active === true && principal.roles.some((role) => INTERNAL_ROLES.includes(role));
}

function actionsFor(principal: WorkbenchPrincipal | null | undefined, { assignedToMe = false, canTakeover = false }: WorkbenchActionContext = {}): readonly WorkbenchAction[] {
  if (!isWorker(principal)) return Object.freeze([]);
  const actions: WorkbenchAction[] = ['VIEW', 'READ_CURSOR'];
  if (hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER') || canTakeover) {
    actions.push('TAKEOVER', 'REQUEST_HANDOFF', 'CANCEL_HANDOFF', 'TRANSFER', 'DELIVERY_RETRY');
  }
  if (hasRole(principal, 'ADMIN')) actions.push('FORCE_TRANSFER', 'RECONCILE');
  if (assignedToMe || hasRole(principal, 'ADMIN')) actions.push('RELEASE', 'REPLY', 'INTERNAL_NOTE');
  return freezeArray(actions);
}

async function loadPrincipal(queryable: PostgresTransaction, principalId: unknown): Promise<WorkbenchPrincipal | null> {
  const result = await queryable.query<PrincipalRow>(
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
  // PostgreSQL SELECT rowCount=1 proves the first row; preserve the original guard.
  if (result.rowCount !== 1 || result.rows[0]!.is_active !== true) return null;
  const row = result.rows[0]!;
  const principal = Object.freeze({
    principal_id: row.id,
    display_name: row.display_name,
    is_active: true,
    roles: freezeArray(row.roles),
    team_ids: freezeArray(row.team_ids),
  });
  return isWorker(principal) ? principal : null;
}

function safePrincipal(principal: WorkbenchPrincipal, context: WorkbenchActionContext = {}) {
  return Object.freeze({
    principal_id: principal.principal_id,
    display_name: principal.display_name,
    capabilities: actionsFor(principal, context),
  });
}

export function createPilotWorkbenchAuthorizationAdapter({ pool }: { pool?: PostgresTransaction } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  // The constructor guard proves the captured pool exists; assertions erase only.

  async function resolvePrincipal(authContext: unknown, { queryable = pool! }: { queryable?: PostgresTransaction } = {}) {
    if (!authContext || typeof authContext !== 'object') return null;
    // UUID validation in loadPrincipal rejects an absent or malformed identifier.
    try { return await loadPrincipal(queryable, (authContext as { principal_id?: unknown }).principal_id); } catch { return null; }
  }

  async function getSessionAccess({ principal, sessionId, queryable = pool! }: { principal: WorkbenchPrincipal; sessionId: string; queryable?: PostgresTransaction }) {
    if (!isWorker(principal)) return null;
    const result = await queryable.query<SessionAccessRow>(
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
    const row = result.rows[0]!;
    return Object.freeze({
      session_id: row.session_id,
      thread_id: row.thread_id,
      assigned_to_me: row.assignment_status === 'ASSIGNED' && row.assigned_principal_id === principal.principal_id,
      can_takeover: row.assignment_status !== 'ASSIGNED' && (hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER')
        || (hasRole(principal, 'HANDLER') && row.resolver_team_id !== null && principal.team_ids.includes(row.resolver_team_id))),
    });
  }

  async function authorizeSession({ principal, sessionId, action = 'VIEW', queryable = pool! }: { principal: WorkbenchPrincipal; sessionId: string; action?: WorkbenchAction; queryable?: PostgresTransaction }) {
    const access = await getSessionAccess({ principal, sessionId, queryable });
    if (access === null) return false;
    if (action === 'FORCE_TRANSFER' || action === 'RECONCILE') return hasRole(principal, 'ADMIN');
    if (action === 'TRANSFER') return hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER') || access.assigned_to_me;
    if (['REPLY', 'INTERNAL_NOTE', 'RELEASE'].includes(action)) return access.assigned_to_me || hasRole(principal, 'ADMIN');
    if (action === 'TAKEOVER') return access.can_takeover || access.assigned_to_me;
    return true;
  }

  function sessionAccessPredicate(principal: WorkbenchPrincipal | null | undefined, { alias = 's', assignmentAlias = 'a', ticketAlias = 't', start = 1 }: { alias?: string; assignmentAlias?: string; ticketAlias?: string; start?: number } = {}) {
    if (!isWorker(principal)) return Object.freeze({ sql: 'FALSE', values: Object.freeze([]) });
    const broad = hasRole(principal, 'ADMIN') || hasRole(principal, 'DISPATCHER');
    return Object.freeze({
      sql: `($${start}::boolean OR ${assignmentAlias}.assigned_principal_id = $${start + 1}::uuid OR (`
        + `$${start + 2}::boolean AND ${ticketAlias}.resolver_team_id IS NOT NULL AND ${ticketAlias}.resolver_team_id = ANY($${start + 3}::text[])))`,
      values: Object.freeze([broad, principal.principal_id, hasRole(principal, 'HANDLER'), principal.team_ids]),
      alias,
    });
  }

  async function listEligiblePrincipals({ principal, sessionId }: { principal: WorkbenchPrincipal; sessionId: string }) {
    const access = await getSessionAccess({ principal, sessionId });
    if (access === null) return null;
    const result = await pool!.query<EligiblePrincipalRow>(
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

  async function resolveRealtimeAuthorization(principal: WorkbenchPrincipal | null | undefined, { limit = 5000 }: { limit?: number } = {}) {
    if (!isWorker(principal)) return null;
    if(!Number.isInteger(limit)||limit<1||limit>5000)throw new TypeError('Invalid realtime scope limit.');
    const predicate = sessionAccessPredicate(principal, { start: 1 });
    const result = await pool!.query<{ session_id: string; thread_id: string }>(
      `SELECT s.id::text AS session_id, s.thread_id::text
         FROM conversation.session AS s
         LEFT JOIN conversation.assignment AS a ON a.session_id = s.id
         LEFT JOIN pilot_ticket.ticket AS t ON t.source_intake_id = s.service_intake_id
        WHERE ${predicate.sql}
        ORDER BY s.id
        LIMIT $${predicate.values.length+1}`,
      [...predicate.values,limit],
    );
    const sessions=freezeArray(result.rows.map(row=>row.session_id)),threads=freezeArray(result.rows.map(row=>row.thread_id));
    const remaining=Math.max(0,256-sessions.length-threads.length);
    const broad=hasRole(principal,'ADMIN')||hasRole(principal,'DISPATCHER');
    const tickets=!broad&&remaining>0?await pool!.query<{ id: string }>(`SELECT t.id::text FROM pilot_ticket.ticket t
      JOIN intake.service_intake i ON i.id=t.source_intake_id
      WHERE i.source_provider='YIXIAOXIU_WEB'
        AND (t.assignee_id=$1::uuid OR t.resolver_team_id=ANY($2::text[]))
      ORDER BY t.id LIMIT $3`,[principal.principal_id,hasRole(principal,'HANDLER')?principal.team_ids:[],remaining]):{rows:[]};
    return Object.freeze({
      allowed_session_ids: sessions,
      allowed_thread_ids: threads,
      ...(tickets.rows.length?{allowed_system_ticket_ids:freezeArray(tickets.rows.map(row=>row.id))}:{}),
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
    isAdmin: (principal: WorkbenchPrincipal | null | undefined) => hasRole(principal, 'ADMIN'),
    isDispatcher: (principal: WorkbenchPrincipal | null | undefined) => hasRole(principal, 'DISPATCHER'),
  });
}
