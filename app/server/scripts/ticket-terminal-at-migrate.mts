import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {failP2016, transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';

/** Card 42A-2: persists ticket terminal_at / terminal_epoch_ms and partial indexes for handled-column queries. */
export const TICKET_TERMINAL_AT_MIGRATION_ID = '075_ticket_terminal_at';
const file = new URL('../../../database/migrations/075_ticket_terminal_at.sql', import.meta.url);
const SYNC_TRIGGER_NAME = 'arch005_sync_' + createHash('md5').update('pilot_ticket.ticket.terminal_epoch_ms').digest('hex').slice(0, 16);

async function source() {
  const sql = await readFile(file, 'utf8');
  const body = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if (!body) failP2016();
  return {sql, body, checksum: createHash('sha256').update(sql).digest('hex')};
}

/**
 * Applies the 075 body inside the caller's transaction without registering it.
 * For isolated test databases built from a partial migration chain; without pilot_ticket.ticket it does nothing.
 */
export async function applyTicketTerminalAtSql(tx: {query(sql: string): Promise<unknown>}): Promise<void> {
  const {body} = await source();
  await tx.query(body);
}

/**
 * Registry checksum plus the physical objects 075 owns (Codex 42A r1): column types, the three CHECKs and their
 * essential definitions, the ARCH-005 pair trigger, and each index's validity, key columns and partial predicate.
 * A dropped or altered object reports drift even when the registry row still matches.
 */
export async function ticketTerminalAtSchemaReady(tx: Pick<PostgresTransaction, 'query'>): Promise<boolean> {
  const {checksum} = await source();
  const row = (await tx.query<{checksum_sha256: string; ready: boolean}>(
    `WITH cons AS (
       SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = to_regclass('pilot_ticket.ticket') AND contype = 'c'
     ), idx AS (
       SELECT c.relname, i.indisvalid AND i.indisready AS usable, pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = to_regclass('pilot_ticket.ticket')
     ), pair AS (
       SELECT to_regprocedure('platform.local_from_epoch_ms(bigint)') IS NOT NULL
          AND to_regprocedure('platform.sync_local_epoch_pair()') IS NOT NULL AS synced
     )
     SELECT m.checksum_sha256,
       (SELECT count(*) = 2 FROM information_schema.columns
         WHERE table_schema = 'pilot_ticket' AND table_name = 'ticket'
           AND ((column_name = 'terminal_at' AND data_type = 'timestamp without time zone')
             OR (column_name = 'terminal_epoch_ms' AND data_type = 'bigint')))
       AND EXISTS(SELECT 1 FROM cons WHERE conname = 'ticket_terminal_status_check' AND convalidated
         AND def LIKE '%RESOLVED%' AND def LIKE '%COMPLETED%' AND def LIKE '%DISMISSED%' AND def LIKE '%terminal_at IS NOT NULL%')
       AND EXISTS(SELECT 1 FROM cons WHERE conname = 'ticket_terminal_at_second_check' AND convalidated
         AND def LIKE '%date_trunc(''second''%terminal_at%')
       AND EXISTS(SELECT 1 FROM cons, pair WHERE conname = 'ticket_terminal_epoch_check' AND convalidated
         AND def LIKE '%terminal_epoch_ms IS NOT NULL%'
         AND (NOT pair.synced OR def LIKE '%local_from_epoch_ms(terminal_epoch_ms)%'))
       AND ((SELECT NOT synced FROM pair) OR EXISTS(SELECT 1 FROM pg_trigger
         WHERE tgrelid = to_regclass('pilot_ticket.ticket') AND tgname = $3 AND NOT tgisinternal AND tgenabled <> 'D'))
       AND EXISTS(SELECT 1 FROM idx WHERE relname = 'ticket_terminal_idx' AND usable
         AND def LIKE '%(terminal_at DESC, id DESC)%' AND def LIKE '%COMPLETED%' AND def LIKE '%DISMISSED%' AND def NOT LIKE '%RESOLVED%')
       AND EXISTS(SELECT 1 FROM idx WHERE relname = 'ticket_resolved_terminal_idx' AND usable
         AND def LIKE '%(terminal_at DESC, id DESC)%' AND def LIKE '%RESOLVED%')
       AND EXISTS(SELECT 1 FROM idx WHERE relname = 'ticket_open_updated_idx' AND usable
         AND def LIKE '%(updated_at DESC, id DESC)%' AND def LIKE '%RESOLVED%') AS ready
       FROM platform.schema_migration m
      WHERE m.migration_id = $1 AND $2::text IS NOT NULL`,
    [TICKET_TERMINAL_AT_MIGRATION_ID, checksum, SYNC_TRIGGER_NAME],
  )).rows[0];
  return row?.checksum_sha256 === checksum && row.ready === true;
}

/** Workbench / worker / gateway roles require 075 before startup. */
export async function requireTicketTerminalAtSchema({pool}: {pool: Pick<PostgresTransaction, 'query'>}): Promise<void> {
  let ready = false;
  try {
    ready = await ticketTerminalAtSchemaReady(pool);
  } catch {
    /* Missing base schema or unavailable DB is not ready. */
  }
  if (!ready) throw new Error('TICKET_TERMINAL_AT_SCHEMA_REQUIRED');
}

/** Drops the 075 indexes, trigger, constraints, and columns. */
export async function restoreTicketTerminalAtBaseline(tx: Pick<PostgresTransaction, 'query'>): Promise<void> {
  await tx.query('DROP INDEX IF EXISTS pilot_ticket.ticket_terminal_idx');
  await tx.query('DROP INDEX IF EXISTS pilot_ticket.ticket_resolved_terminal_idx');
  await tx.query('DROP INDEX IF EXISTS pilot_ticket.ticket_open_updated_idx');
  if ((await tx.query<{present: boolean}>("SELECT to_regclass('pilot_ticket.ticket') IS NOT NULL AS present")).rows[0]?.present !== true) {
    return;
  }
  await tx.query(`DROP TRIGGER IF EXISTS ${SYNC_TRIGGER_NAME} ON pilot_ticket.ticket`);
  await tx.query('ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT IF EXISTS ticket_terminal_status_check');
  await tx.query('ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT IF EXISTS ticket_terminal_epoch_check');
  await tx.query('ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT IF EXISTS ticket_terminal_at_second_check');
  await tx.query('ALTER TABLE pilot_ticket.ticket DROP COLUMN IF EXISTS terminal_epoch_ms');
  await tx.query('ALTER TABLE pilot_ticket.ticket DROP COLUMN IF EXISTS terminal_at');
}

export async function migrateTicketTerminalAt({databaseUrl, mode = 'check'}: {databaseUrl: string; mode?: 'check' | 'apply' | 'rollback'}) {
  if (!databaseUrl || !['check', 'apply', 'rollback'].includes(mode)) failP2016();
  const {body, checksum} = await source();
  const pool = createPostgresPool({connectionString: databaseUrl, max: 1, application_name: 'ticket_terminal_at_migrator'});
  try {
    return await transactionP2016(pool, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('TICKET_TERMINAL_AT_MIGRATION'))");
      const existing = (await tx.query<{checksum_sha256: string}>(
        'SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id = $1',
        [TICKET_TERMINAL_AT_MIGRATION_ID],
      )).rows[0];
      if (existing) {
        if (existing.checksum_sha256 !== checksum || !await ticketTerminalAtSchemaReady(tx)) {
          throw Error('TICKET_TERMINAL_AT_SCHEMA_DRIFT');
        }
        if (mode !== 'rollback') return {status: 'NOOP_ALREADY_APPLIED', migration_id: TICKET_TERMINAL_AT_MIGRATION_ID};
        await restoreTicketTerminalAtBaseline(tx);
        await tx.query('DELETE FROM platform.schema_migration WHERE migration_id = $1', [TICKET_TERMINAL_AT_MIGRATION_ID]);
        return {status: 'ROLLED_BACK', migration_id: TICKET_TERMINAL_AT_MIGRATION_ID};
      }
      if (mode === 'rollback') return {status: 'NOT_APPLIED', migration_id: TICKET_TERMINAL_AT_MIGRATION_ID};
      if (mode === 'check') return {status: 'PENDING', migration_id: TICKET_TERMINAL_AT_MIGRATION_ID};
      if ((await tx.query<{present: boolean}>("SELECT to_regclass('pilot_ticket.ticket') IS NOT NULL AS present")).rows[0]?.present !== true) {
        throw Error('TICKET_TERMINAL_AT_REQUIRES_TICKET_TABLE');
      }
      await tx.query(body);
      await tx.query(
        `WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
         INSERT INTO platform.schema_migration(migration_id, checksum_sha256, applied_at, applied_epoch_ms)
         SELECT $1, $2, platform.local_from_epoch_ms(epoch), epoch FROM stamp`,
        [TICKET_TERMINAL_AT_MIGRATION_ID, checksum],
      );
      return {status: 'APPLIED', migration_id: TICKET_TERMINAL_AT_MIGRATION_ID};
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply', '--rollback'].includes(arg))) {
    throw Error('TICKET_TERMINAL_AT_ARGUMENT_INVALID');
  }
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) throw Error('TICKET_TERMINAL_AT_DATABASE_URL_REQUIRED');
  try {
    console.log(JSON.stringify(await migrateTicketTerminalAt({
      databaseUrl,
      mode: args[0] === '--apply' ? 'apply' : args[0] === '--rollback' ? 'rollback' : 'check',
    })));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error_code: 'TICKET_TERMINAL_AT_MIGRATION_FAILED',
      detail: error instanceof Error ? error.message.slice(0, 200) : null,
    }));
    process.exitCode = 1;
  }
}
