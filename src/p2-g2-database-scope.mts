import type { PostgresTransaction } from './platform/postgres-pool.mjs';
export interface DatabaseScopeInput {transaction:PostgresTransaction;manifest:unknown}
import { validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';

// This is a read-only startup check. A live run starts from a dedicated empty
// business database; only explicitly approved local principals/teams may exist.
export async function inspectG2DatabaseScope({ transaction, manifest }: DatabaseScopeInput) {
  const m = validateG2Manifest(manifest);
  const result = await transaction.query(`SELECT
    (SELECT count(*)::integer FROM channel.message_inbox) AS inbox,
    (SELECT count(*)::integer FROM intake.service_intake) AS intakes,
    (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
    (SELECT count(*)::integer FROM conversation.session) AS sessions,
    (SELECT count(*)::integer FROM conversation.thread) AS threads,
    (SELECT count(*)::integer FROM communication.message) AS messages,
    (SELECT count(*)::integer FROM incident.incident) AS incidents,
    (SELECT count(*)::integer FROM incident.candidate_review) AS candidates,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')) AS competing_roles`);
  const people = await transaction.query(`SELECT p.id::text,p.is_active,
      EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role='ADMIN') AS admin,
      EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('DISPATCHER','HANDLER')) AS agent
    FROM pilot_ticket.pilot_principal p`);
  const principalsReady = people.rows.length === m.scope.principal_ids.length
    && people.rows.every(p => p.is_active && m.scope.principal_ids.includes(p.id as string))
    && people.rows.some(p => p.admin) && people.rows.filter(p => p.agent && !p.admin).length >= 2;
  return Object.freeze({ ...result.rows[0], principals_ready: principalsReady,
    ready: Object.values(result.rows[0] as Record<string,unknown>).every(n => n === 0) && principalsReady });
}

export async function requireG2DatabaseScope(input: DatabaseScopeInput) {
  const result = await inspectG2DatabaseScope(input);
  if (!result.ready) failG2('DEDICATED_EMPTY_DATABASE_REQUIRED');
  return result;
}
