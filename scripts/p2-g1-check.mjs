import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { captureP2G1CatalogSnapshot, P2_G1_REQUIRED_MIGRATION_RELATIONS } from '../src/p2-g1-observability.mjs';

const REQUIRED_MIGRATIONS = Object.freeze([
  '001_p1_003_channel_message_inbox.sql', '002_p1_004_service_intake.sql',
  '003_p1_005_pilot_ticket_core.sql', '004_p1_006_ticket_state_actions.sql',
  '005_p1_007_notification_outbox.sql', '006_p1_009_pilot_access.sql',
  '007_p1_010_ticket_closure.sql', '008_p1_010_review_hardening.sql',
  '009_p1_011_pilot_operations_baseline.sql', '010_p2_001_conversation_contracts.sql',
  '011_p2_002_timeline_projector.sql', '012_p2_003_realtime_event_log.sql',
  '020_p2_004_unified_communication.sql', '021_p2_005_conversation_control.sql',
]);

const DEFAULT_FALSE_FLAGS = Object.freeze([
  'CONVERSATION_CENTER_ENABLED','CONVERSATION_REALTIME_SSE_ENABLED','HUMAN_WORKBENCH_V2_ENABLED',
  'AI_TRIAGE_ENABLED','AI_CONVERSATION_ENABLED','AI_AUTO_REPLY_ENABLED','OCR_ENABLED',
  'INCIDENT_CORRELATION_ENABLED','INTEGRATION_CONNECTOR_ENABLED','HOSPITAL_IDENTITY_ENABLED',
  'INTRANET_PORTAL_SOURCE_ENABLED','HOSPITAL_API_SOURCE_ENABLED','MONITORING_SOURCE_ENABLED',
]);

function hash(values) { return createHash('sha256').update(values.join('\n')).digest('hex'); }

export async function runP2G1Check({ env = process.env } = {}) {
  const envExample = readFileSync('.env.example', 'utf8');
  const migrationsPresent = REQUIRED_MIGRATIONS.every((name) => existsSync(`database/migrations/${name}`));
  const noNewMigration = !existsSync('database/migrations/022_p2_g1_human_only_assembly.sql');
  const defaultsOff = DEFAULT_FALSE_FLAGS.every((name) => new RegExp(`^${name}=false$`, 'mu').test(envExample));
  const sourcePresent = [
    'src/p2-g1-human-only-assembly.mjs','src/p2-g1-inbound-projection-coordinator.mjs',
    'src/p2-g1-wecom-gateway.mjs','src/p2-g1-wecom-sender.mjs','src/p2-g1-test-authentication.mjs',
    'src/p2-g1-runtime.mjs','src/p2-g1-observability.mjs',
  ].every(existsSync);
  let postgres = false;
  let relations = false;
  let catalogHash = null;
  let catalogIdentityCount = 0;
  if (typeof env.PILOT_DATABASE_URL === 'string' && env.PILOT_DATABASE_URL.length > 0) {
    const pool = new Pool({ connectionString: env.PILOT_DATABASE_URL, max: 1, connectionTimeoutMillis: 2_000 });
    try {
      await pool.query('SELECT 1'); postgres = true;
      const present = await pool.query('SELECT to_regclass(name) IS NOT NULL present FROM unnest($1::text[]) name', [P2_G1_REQUIRED_MIGRATION_RELATIONS]);
      relations = present.rows.length === P2_G1_REQUIRED_MIGRATION_RELATIONS.length && present.rows.every((row) => row.present === true);
      const catalog = await captureP2G1CatalogSnapshot(pool);
      catalogHash = hash(catalog);
      catalogIdentityCount = catalog.length;
    } catch { postgres = false; relations = false; }
    finally { await pool.end(); }
  }
  const checks = Object.freeze({ migrations_present: migrationsPresent, no_new_migration: noNewMigration, feature_defaults_off: defaultsOff, assembly_sources_present: sourcePresent, postgres, required_relations: relations });
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks, catalog_hash: catalogHash, catalog_identity_count: catalogIdentityCount });
}

async function main() {
  if (process.argv.slice(2).some((value) => value !== '--check')) { process.exitCode = 2; return; }
  const result = await runP2G1Check();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
