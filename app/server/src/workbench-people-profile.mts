import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WorkbenchPeopleProfileResponse } from '../../../contracts/web01_workbench_contracts.js';
import { exactP2016, failP2016, publicP2016 } from './p2-016-domain-contracts.mjs';
import { WorkbenchError, WORKBENCH_ERROR_CODES } from './p2-006-workbench-query.mjs';

export const PEOPLE_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
export const PEOPLE_PROFILE_CACHE_MAX_ENTRIES = 512;
export const PEOPLE_PROFILE_DISPLAY_NAME_MAX_LENGTH = 128;

export interface PeopleProfilePrincipal {
  principal_id: string;
  display_name: string;
  roles: readonly string[];
  team_ids: readonly string[];
}

export interface PeopleProfileCacheEntry {
  department: string | null;
  expiresAt: number;
}

export interface PeopleProfileCache {
  get: (principalId: string) => { hit: true; department: string | null } | { hit: false };
  set: (principalId: string, department: string | null) => void;
  clear: () => void;
  size: () => number;
}

export interface WorkbenchPeopleProfileOptions {
  pool: PostgresTransaction;
  resolvePrincipal: (authContext: unknown) => Promise<PeopleProfilePrincipal>;
  resolveDepartment?: ((principalId: string) => Promise<string | null>) | undefined;
  currentSessionPredicate?: ((authContext: unknown, principalId: string, start?: number) => { sql: string; values: readonly unknown[] }) | undefined;
  now?: () => number;
  cache?: PeopleProfileCache;
}

interface CandidateRow {
  principal_id: string;
  display_name: string;
}

/** Validate and normalize `{ display_name }` strictly for read-only POST lookup. */
export function parsePeopleProfileBody(body: unknown): { display_name: string } {
  const input = exactP2016(body, ['display_name']);
  if (typeof input.display_name !== 'string') failP2016();
  const trimmed = input.display_name.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > PEOPLE_PROFILE_DISPLAY_NAME_MAX_LENGTH || /[\x00-\x1f\x7f]/u.test(trimmed)) failP2016();
  return { display_name: trimmed };
}

/** Bounded in-memory cache of successful department reads per colleague principal. */
export function createPeopleProfileCache({
  ttlMs = PEOPLE_PROFILE_CACHE_TTL_MS,
  maxEntries = PEOPLE_PROFILE_CACHE_MAX_ENTRIES,
  now = Date.now,
}: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
} = {}): PeopleProfileCache {
  const entries = new Map<string, PeopleProfileCacheEntry>();

  function get(principalId: string): { hit: true; department: string | null } | { hit: false } {
    const entry = entries.get(principalId);
    if (!entry) return { hit: false };
    if (entry.expiresAt <= now()) {
      entries.delete(principalId);
      return { hit: false };
    }
    return { hit: true, department: entry.department };
  }

  function set(principalId: string, department: string | null): void {
    if (maxEntries <= 0) return;
    entries.delete(principalId);
    entries.set(principalId, { department, expiresAt: now() + ttlMs });
    if (entries.size <= maxEntries) return;
    const current = now();
    for (const [key, value] of entries) {
      if (value.expiresAt <= current) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (typeof oldest !== 'string') break;
      entries.delete(oldest);
    }
  }

  return {
    get,
    set,
    clear: () => { entries.clear(); },
    size: () => entries.size,
  };
}

/** Compare requester identity, roles, and resolver teams before vs after provider await. */
export function samePeopleProfileAuthority(before: PeopleProfilePrincipal, after: PeopleProfilePrincipal): boolean {
  if (before.principal_id !== after.principal_id) return false;
  if (before.roles.length !== after.roles.length || before.team_ids.length !== after.team_ids.length) return false;
  const beforeRoles = [...before.roles].sort();
  const afterRoles = [...after.roles].sort();
  if (beforeRoles.some((role, index) => role !== afterRoles[index])) return false;
  const beforeTeams = [...before.team_ids].sort();
  const afterTeams = [...after.team_ids].sort();
  return !beforeTeams.some((teamId, index) => teamId !== afterTeams[index]);
}

interface AtomicAuthorityRow {
  session_ok: boolean;
  requester_active: boolean;
  roles_match: boolean;
  teams_match: boolean;
  targets: CandidateRow[];
}

async function findAuthorizedTargetAtomic(
  pool: PostgresTransaction,
  authContext: unknown,
  requester: PeopleProfilePrincipal,
  displayName: string,
  now: () => number,
  currentSessionPredicate?: (authContext: unknown, principalId: string, start?: number) => { sql: string; values: readonly unknown[] },
): Promise<CandidateRow> {
  const expectedRoles = [...new Set(requester.roles)].sort();
  const expectedTeams = [...new Set(requester.team_ids)].sort();

  let sessionSql = 'TRUE';
  let sessionValues: readonly unknown[] = [];
  if (currentSessionPredicate) {
    const guard = currentSessionPredicate(authContext, requester.principal_id, 5);
    sessionSql = guard.sql;
    sessionValues = guard.values;
  } else {
    const context = authContext && typeof authContext === 'object' ? (authContext as Record<string, unknown>) : {};
    if (
      typeof context.expires_epoch_ms === 'string'
      && (!/^\d+$/u.test(context.expires_epoch_ms) || BigInt(context.expires_epoch_ms) <= BigInt(now()))
    ) {
      failP2016('FORBIDDEN', 403);
    }
    if (typeof context.session_id === 'string') {
      sessionSql = `EXISTS(SELECT 1 FROM pilot_ticket.workbench_auth_session session_guard
        WHERE session_guard.session_id = $5::uuid
          AND session_guard.principal_id = $2::uuid
          AND session_guard.state = 'ACTIVE'
          AND session_guard.expires_epoch_ms > platform.physical_epoch_ms())`;
      sessionValues = [context.session_id];
    }
  }

  const result = await pool.query<AtomicAuthorityRow>(
    `WITH requester_state AS (
       SELECT
         (${sessionSql}) AS session_ok,
         EXISTS (
           SELECT 1
             FROM pilot_ticket.pilot_principal AS me
            WHERE me.id = $2::uuid
              AND me.is_active
         ) AS requester_active,
         COALESCE(
           (
             SELECT array_agg(DISTINCT r.role::text)
               FROM pilot_ticket.pilot_principal_role AS r
              WHERE r.principal_id = $2::uuid
           ),
           '{}'::text[]
         ) AS db_roles,
         COALESCE(
           (
             SELECT array_agg(DISTINCT tm.team_id::text)
               FROM pilot_ticket.pilot_team_member AS tm
              WHERE tm.principal_id = $2::uuid
           ),
           '{}'::text[]
         ) AS db_teams
     ),
     authorized_targets AS (
       SELECT p.id::text AS principal_id, btrim(p.display_name) AS display_name
         FROM pilot_ticket.pilot_principal AS p
         CROSS JOIN requester_state AS rs
        WHERE rs.session_ok
          AND rs.requester_active
          AND rs.db_roles @> $3::text[] AND $3::text[] @> rs.db_roles
          AND rs.db_teams @> $4::text[] AND $4::text[] @> rs.db_teams
          AND p.is_active
          AND btrim(p.display_name) = $1
          AND EXISTS (
            SELECT 1
              FROM pilot_ticket.pilot_principal_role AS tr
             WHERE tr.principal_id = p.id
               AND tr.role IN ('ADMIN', 'DISPATCHER', 'HANDLER')
          )
          AND (
            p.id = $2::uuid
            OR EXISTS (
              SELECT 1
                FROM pilot_ticket.pilot_team_member AS mine
                JOIN pilot_ticket.pilot_team_member AS theirs ON theirs.team_id = mine.team_id
                JOIN pilot_ticket.resolver_team AS team ON team.team_id = mine.team_id AND team.is_active
               WHERE mine.principal_id = $2::uuid
                 AND theirs.principal_id = p.id
            )
          )
        LIMIT 2
     )
     SELECT
       rs.session_ok,
       rs.requester_active,
       (rs.db_roles @> $3::text[] AND $3::text[] @> rs.db_roles) AS roles_match,
       (rs.db_teams @> $4::text[] AND $4::text[] @> rs.db_teams) AS teams_match,
       COALESCE(
         (
           SELECT json_agg(json_build_object('principal_id', at.principal_id, 'display_name', at.display_name))
             FROM authorized_targets AS at
         ),
         '[]'::json
       ) AS targets
       FROM requester_state AS rs`,
    [displayName, requester.principal_id, expectedRoles, expectedTeams, ...sessionValues],
  );

  const row = result.rows[0];
  if (!row?.session_ok) {
    if (currentSessionPredicate) throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated, 401);
    failP2016('FORBIDDEN', 403);
  }
  if (!row.requester_active || !row.roles_match || !row.teams_match) {
    failP2016('FORBIDDEN', 403);
  }
  const targets = Array.isArray(row.targets) ? row.targets : [];
  if (targets.length !== 1 || !targets[0]) failP2016('NOT_FOUND', 404);
  return targets[0];
}

/** Look up a visible teammate's (or self's) department by display name without mutating stored names. */
export function createWorkbenchPeopleProfile({
  pool,
  resolvePrincipal,
  resolveDepartment,
  currentSessionPredicate,
  now = Date.now,
  cache = createPeopleProfileCache({ now }),
}: WorkbenchPeopleProfileOptions) {
  async function lookup({ authContext, body }: { authContext: unknown; body: unknown }): Promise<WorkbenchPeopleProfileResponse> {
    if (typeof resolveDepartment !== 'function') failP2016('DISABLED', 503);
    const requester = await resolvePrincipal(authContext);
    const { display_name } = parsePeopleProfileBody(body);

    const target = await findAuthorizedTargetAtomic(pool, authContext, requester, display_name, now, currentSessionPredicate);

    const cached = cache.get(target.principal_id);
    if (cached.hit) {
      return publicP2016({ name: target.display_name, department: cached.department });
    }

    let department: string | null;
    try {
      department = await resolveDepartment(target.principal_id);
    } catch (error) {
      if (error instanceof WorkbenchError && error.status === 404) failP2016('NOT_FOUND', 404);
      if (error instanceof WorkbenchError && error.code === 'P2_016_DISABLED') throw error;
      failP2016('PROVIDER_UNAVAILABLE', 503);
    }

    const afterRequester = await resolvePrincipal(authContext);
    if (!samePeopleProfileAuthority(requester, afterRequester)) failP2016('FORBIDDEN', 403);

    const afterTarget = await findAuthorizedTargetAtomic(pool, authContext, afterRequester, display_name, now, currentSessionPredicate);
    if (afterTarget.principal_id !== target.principal_id) failP2016('NOT_FOUND', 404);

    const normalizedDepartment = typeof department === 'string' && department.trim() ? department.trim() : null;
    cache.set(target.principal_id, normalizedDepartment);
    return publicP2016({ name: afterTarget.display_name, department: normalizedDepartment });
  }

  return Object.freeze({
    lookup,
    clearCache: () => cache.clear(),
    cacheSize: () => cache.size(),
  });
}
