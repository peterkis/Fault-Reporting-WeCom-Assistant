import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';

import { migrateCurrentBaseline } from '../scripts/migrate-current-baseline.mjs';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const names = [];
let admin;

function targetUrl(name) { const url = new URL(databaseUrl); url.pathname = `/${name}`; return url.toString(); }
function databaseName(kind) { const name = `arch005_${kind}_${randomUUID().replaceAll('-', '')}`; names.push(name); return name; }

before(async () => {
  if (!databaseUrl) return;
  const url = new URL(databaseUrl); url.pathname = '/postgres';
  admin = createPostgresPool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 5_000, allowExitOnIdle: true });
});

after(async () => {
  if (!admin) return;
  for (const name of names) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`).catch(() => {});
  }
  await admin.end();
});

async function createDatabase(kind) {
  const name = databaseName(kind);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  return Object.freeze({ name, url: targetUrl(name) });
}

const legacyFiles = [
  '001_p1_003_channel_message_inbox.sql', '002_p1_004_service_intake.sql',
  '003_p1_005_pilot_ticket_core.sql', '004_p1_006_ticket_state_actions.sql',
  '005_p1_007_notification_outbox.sql', '006_p1_009_pilot_access.sql',
  '007_p1_010_ticket_closure.sql', '008_p1_010_review_hardening.sql',
  '009_p1_011_pilot_operations_baseline.sql', '010_p2_001_conversation_contracts.sql',
  '011_p2_002_timeline_projector.sql', '012_p2_003_realtime_event_log.sql',
  '020_p2_004_unified_communication.sql', '021_p2_005_conversation_control.sql',
];

integrationTest('existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op', async () => {
  const target = await createDatabase('existing');
  const pool = createPostgresPool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 5_000, allowExitOnIdle: true });
  try {
    for (const file of legacyFiles) await pool.query(await readFile(`database/migrations/${file}`, 'utf8'));
    const beforeCount = await pool.query(`SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_schema=ANY($1::text[]) AND data_type='timestamp with time zone'`, [['channel','intake','pilot_ticket','notification','operations','conversation','communication']]);
    assert.equal(beforeCount.rows[0].count, 77);

    const check = await migrateCurrentBaseline({ databaseUrl: target.url, mode: 'check' });
    assert.equal(check.status, 'CHECK_ROLLBACK_SUCCEEDED');
    assert.equal((await pool.query("SELECT to_regclass('platform.time_contract') IS NULL AS rolled_back")).rows[0].rolled_back, true);

    const applied = await migrateCurrentBaseline({ databaseUrl: target.url, mode: 'apply' });
    assert.equal(applied.status, 'APPLIED');
    assert.deepEqual(applied.legacy_applied, []);
    const facts = await pool.query(`SELECT
      (SELECT count(*)::integer FROM platform.forbidden_owned_schema_time_types()) AS forbidden_count,
      platform.local_now()::text AS local_now,
      platform.physical_epoch_ms()::text AS epoch_ms,
      platform.local_from_epoch_ms(0)::text AS epoch_zero,
      (SELECT owned_schemas FROM platform.time_contract WHERE contract_version='ARCH-005/v1') AS owned_schemas`);
    assert.equal(facts.rows[0].forbidden_count, 0);
    assert.match(facts.rows[0].local_now, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u);
    assert.match(facts.rows[0].epoch_ms, /^(0|[1-9][0-9]*)$/u);
    assert.equal(facts.rows[0].epoch_zero, '1970-01-01 08:00:00');
    assert.deepEqual(facts.rows[0].owned_schemas, ['channel','intake','pilot_ticket','notification','operations','conversation','communication','platform','integration']);

    const repeat = await migrateCurrentBaseline({ databaseUrl: target.url, mode: 'apply' });
    assert.equal(repeat.status, 'NOOP_ALREADY_APPLIED');
  } finally { await pool.end(); }
});

integrationTest('fresh database executes 001-021-022 through the current-baseline entrypoint', async () => {
  const target = await createDatabase('fresh');
  const applied = await migrateCurrentBaseline({ databaseUrl: target.url, mode: 'apply' });
  assert.equal(applied.status, 'APPLIED');
  assert.deepEqual(applied.legacy_applied, ['001','002','003','004','005','006','007','008','009','010','011','012','020','021']);
  const pool = createPostgresPool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 5_000, allowExitOnIdle: true });
  try {
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM platform.forbidden_owned_schema_time_types()')).rows[0].count, 0);
    const marker = await pool.query("SELECT checksum_sha256,applied_at,applied_epoch_ms::text FROM platform.schema_migration WHERE migration_id='022_arch_005_asia_shanghai_time_contract'");
    assert.equal(marker.rowCount, 1);
    assert.match(marker.rows[0].checksum_sha256, /^[a-f0-9]{64}$/u);
    assert.match(marker.rows[0].applied_at, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u);
    assert.match(marker.rows[0].applied_epoch_ms, /^(0|[1-9][0-9]*)$/u);
  } finally { await pool.end(); }
});
