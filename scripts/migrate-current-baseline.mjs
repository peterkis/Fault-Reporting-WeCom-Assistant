import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

const ARCH005_ID = '022_arch_005_asia_shanghai_time_contract';
const ARCH005_URL = new URL('../database/migrations/022_arch_005_asia_shanghai_time_contract.sql', import.meta.url);
const LEGACY_MIGRATIONS = Object.freeze([
  ['001', new URL('../database/migrations/001_p1_003_channel_message_inbox.sql', import.meta.url), "to_regclass('channel.message_inbox') IS NOT NULL"],
  ['002', new URL('../database/migrations/002_p1_004_service_intake.sql', import.meta.url), "to_regclass('intake.service_intake_event') IS NOT NULL"],
  ['003', new URL('../database/migrations/003_p1_005_pilot_ticket_core.sql', import.meta.url), "to_regclass('pilot_ticket.ticket') IS NOT NULL"],
  ['004', new URL('../database/migrations/004_p1_006_ticket_state_actions.sql', import.meta.url), "to_regclass('pilot_ticket.ticket_event') IS NOT NULL"],
  ['005', new URL('../database/migrations/005_p1_007_notification_outbox.sql', import.meta.url), "to_regclass('notification.delivery_attempt') IS NOT NULL"],
  ['006', new URL('../database/migrations/006_p1_009_pilot_access.sql', import.meta.url), "to_regclass('pilot_ticket.pilot_principal') IS NOT NULL"],
  ['007', new URL('../database/migrations/007_p1_010_ticket_closure.sql', import.meta.url), "to_regclass('notification.card_action_task') IS NOT NULL"],
  ['008', new URL('../database/migrations/008_p1_010_review_hardening.sql', import.meta.url), `EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('pilot_ticket.ticket_event')
         AND conname = 'ticket_event_type_check'
         AND pg_get_constraintdef(oid, true) LIKE '%auto_close_reminder%'
    )`],
  ['009', new URL('../database/migrations/009_p1_011_pilot_operations_baseline.sql', import.meta.url), "to_regclass('operations.restore_drill') IS NOT NULL"],
  ['010', new URL('../database/migrations/010_p2_001_conversation_contracts.sql', import.meta.url), "to_regclass('conversation.session') IS NOT NULL"],
  ['011', new URL('../database/migrations/011_p2_002_timeline_projector.sql', import.meta.url), "to_regclass('conversation.projection_checkpoint') IS NOT NULL"],
  ['012', new URL('../database/migrations/012_p2_003_realtime_event_log.sql', import.meta.url), "to_regclass('conversation.realtime_event') IS NOT NULL"],
  ['020', new URL('../database/migrations/020_p2_004_unified_communication.sql', import.meta.url), "to_regclass('communication.delivery') IS NOT NULL"],
  ['021', new URL('../database/migrations/021_p2_005_conversation_control.sql', import.meta.url), "to_regclass('conversation.control_event') IS NOT NULL"],
]);

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function parseCurrentBaselineMigrationArgs(argv) {
  if (argv.length === 0) return Object.freeze({ mode: 'apply' });
  if (argv.length === 1 && argv[0] === '--check') return Object.freeze({ mode: 'check' });
  if (argv.length === 1 && argv[0] === '--status') return Object.freeze({ mode: 'status' });
  throw failure('ARCH_005_MIGRATION_ARGS_INVALID');
}

async function legacyState(client) {
  const state = [];
  for (const [id, , expression] of LEGACY_MIGRATIONS) {
    const result = await client.query(`SELECT (${expression}) AS applied`);
    state.push(Object.freeze({ id, applied: result.rows[0]?.applied === true }));
  }
  const firstMissing = state.findIndex((entry) => !entry.applied);
  if (firstMissing >= 0 && state.slice(firstMissing + 1).some((entry) => entry.applied)) {
    throw failure('ARCH_005_LEGACY_MIGRATION_GAP');
  }
  return Object.freeze(state);
}

async function arch005Marker(client) {
  const table = await client.query(`SELECT to_regclass('platform.schema_migration') IS NOT NULL AS exists`);
  if (table.rows[0]?.exists !== true) return null;
  const result = await client.query(
    `SELECT checksum_sha256, applied_at, applied_epoch_ms::text
       FROM platform.schema_migration
      WHERE migration_id = $1`,
    [ARCH005_ID],
  );
  return result.rowCount === 0 ? null : Object.freeze(result.rows[0]);
}

async function validateAppliedArch005(client, expectedChecksum) {
  const marker = await arch005Marker(client);
  if (marker === null) throw failure('ARCH_005_MIGRATION_MARKER_MISSING');
  if (marker.checksum_sha256 !== expectedChecksum) throw failure('ARCH_005_MIGRATION_CHECKSUM_MISMATCH');
  await client.query('SELECT platform.assert_time_contract()');
  const forbidden = await client.query('SELECT count(*)::integer AS count FROM platform.forbidden_owned_schema_time_types()');
  if (forbidden.rows[0]?.count !== 0) throw failure('ARCH_005_FORBIDDEN_TIME_TYPE_COUNT_NONZERO');
  return marker;
}

async function applyLegacyTail(client, state) {
  const applied = [];
  for (let index = 0; index < LEGACY_MIGRATIONS.length; index += 1) {
    if (state[index].applied) continue;
    const [id, url] = LEGACY_MIGRATIONS[index];
    await client.query(await readFile(url, 'utf8'));
    applied.push(id);
  }
  return Object.freeze(applied);
}

async function applyArch005(client, migrationSql, checksum, { rollback }) {
  await client.query('BEGIN');
  try {
    await client.query(migrationSql);
    await client.query('SELECT platform.assert_time_contract()');
    if (rollback) {
      await client.query('ROLLBACK');
      return Object.freeze({ rolled_back: true });
    }
    const inserted = await client.query(
      `WITH applied AS (SELECT platform.physical_epoch_ms() AS epoch_ms)
       INSERT INTO platform.schema_migration (
         migration_id, checksum_sha256, applied_at, applied_epoch_ms
       )
       SELECT $1, $2, platform.local_from_epoch_ms(epoch_ms), epoch_ms
         FROM applied
       ON CONFLICT (migration_id) DO NOTHING
       RETURNING migration_id`,
      [ARCH005_ID, checksum],
    );
    if (inserted.rowCount !== 1) throw failure('ARCH_005_MIGRATION_MARKER_CONFLICT');
    await client.query('COMMIT');
    return Object.freeze({ rolled_back: false });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function migrateCurrentBaseline({
  databaseUrl,
  mode = 'apply',
  PoolFactory = createPostgresPool,
} = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw failure('ARCH_005_DATABASE_URL_REQUIRED');
  if (!['apply', 'check', 'status'].includes(mode)) throw failure('ARCH_005_MIGRATION_MODE_INVALID');

  const migrationSql = await readFile(ARCH005_URL, 'utf8');
  const checksum = createHash('sha256').update(migrationSql).digest('hex');
  const pool = PoolFactory({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    application_name: 'arch_005_current_baseline_migrator',
  });
  let client;
  try {
    client = await pool.connect();
    const marker = await arch005Marker(client);
    if (marker !== null) {
      const verified = await validateAppliedArch005(client, checksum);
      return Object.freeze({
        status: 'NOOP_ALREADY_APPLIED',
        mode,
        checksum_sha256: checksum,
        applied_at: verified.applied_at,
        applied_epoch_ms: verified.applied_epoch_ms,
        legacy_applied: Object.freeze([]),
        forbidden_type_count: 0,
      });
    }

    const state = await legacyState(client);
    const legacyComplete = state.every((entry) => entry.applied);
    if (mode === 'status') {
      return Object.freeze({
        status: legacyComplete ? 'READY_FOR_022' : 'LEGACY_CHAIN_INCOMPLETE',
        mode,
        checksum_sha256: checksum,
        legacy_state: state,
      });
    }
    if (mode === 'check' && !legacyComplete) throw failure('ARCH_005_CHECK_REQUIRES_001_THROUGH_021');

    const legacyApplied = mode === 'apply' ? await applyLegacyTail(client, state) : Object.freeze([]);
    await applyArch005(client, migrationSql, checksum, { rollback: mode === 'check' });
    if (mode === 'check') {
      return Object.freeze({
        status: 'CHECK_ROLLBACK_SUCCEEDED',
        mode,
        checksum_sha256: checksum,
        legacy_applied: legacyApplied,
        forbidden_type_count_in_transaction: 0,
      });
    }
    const verified = await validateAppliedArch005(client, checksum);
    return Object.freeze({
      status: 'APPLIED',
      mode,
      checksum_sha256: checksum,
      applied_at: verified.applied_at,
      applied_epoch_ms: verified.applied_epoch_ms,
      legacy_applied: legacyApplied,
      forbidden_type_count: 0,
    });
  } finally {
    client?.release?.();
    await pool.end().catch(() => {});
  }
}

async function main() {
  try {
    const options = parseCurrentBaselineMigrationArgs(process.argv.slice(2));
    const result = await migrateCurrentBaseline({
      databaseUrl: process.env.PILOT_DATABASE_URL,
      mode: options.mode,
    });
    console.log(JSON.stringify({ test_id: 'ARCH-005', event: 'arch_005_migration_result', ...result }));
  } catch (error) {
    console.log(JSON.stringify({
      test_id: 'ARCH-005',
      event: 'arch_005_migration_failed',
      error_code: error?.code ?? 'ARCH_005_MIGRATION_FAILED',
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
