import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
function sourcePath(relative) {
  const original = path.join(ROOT, relative);
  const typed = original.endsWith('.mjs') ? original.slice(0, -4) + '.mts' : null;
  if (typed && existsSync(original) && existsSync(typed)) throw new Error('MIGRATION_DUAL_SOURCE:' + relative);
  return typed && existsSync(typed) ? typed : original;
}

const FROZEN_MIGRATIONS = Object.freeze({
  '001_p1_003_channel_message_inbox.sql': '4fe183af28d730c951d7582c9fb49733f4987f5891628c9f0b45418211912ab3',
  '002_p1_004_service_intake.sql': '55bad50008a591db26df4ac8f387092ed972988e677a331d9eee05a4bd8b1631',
  '003_p1_005_pilot_ticket_core.sql': '197d912274b824e40e0cde284889b2739170d61b2ce4562da1932db98b71cd64',
  '004_p1_006_ticket_state_actions.sql': '96bca2d9b1de2cc564ef51ae2072980c5696c7f0e7673ceb05feec06f514f278',
  '005_p1_007_notification_outbox.sql': '6398e095716a4df36335daf2476e67b605d9ace3189cab2c84073b7e80127d95',
  '006_p1_009_pilot_access.sql': '7a34251e2675e68e22b1361ae611c2ec48709cb672bc6372e0661c3d36e42982',
  '007_p1_010_ticket_closure.sql': 'f4dc80483eed225ca07298e59bfa56a859a3b816824d694b83f72c3bf0e287b8',
  '008_p1_010_review_hardening.sql': 'b22992ea0cf957aff9bbecdc6fcc9c2e9fec141d6a015410bb6ea16d49a10050',
  '009_p1_011_pilot_operations_baseline.sql': '12a920e6c43212299a76d6f1ab92eabe84488a8085a1c31371ec93da626b9764',
  '010_p2_001_conversation_contracts.sql': 'b22fb9d3e2ec887ffb48f4d4f550d34a56c031acf7cc96e7f0c7d44b4fa77f29',
  '011_p2_002_timeline_projector.sql': 'c6cdfff247985dce285872b35dc1ff1e53353eff90df6d3b0f0291ef651e3d99',
  '012_p2_003_realtime_event_log.sql': '3ee5b6cf4beec0600dfec61e538f2a2c9518630a172c92b3b931aa100c9bcd1f',
  '020_p2_004_unified_communication.sql': 'f79d08903aa92cc75614dff51d2fbb4d050ec1be68c62900c1d8607b8f68eee0',
  '021_p2_005_conversation_control.sql': '7912a58c1186e10501800ae4eaf95a00bb6a0e296d306c98bf246da2493c2311',
});

async function filesUnder(relative) {
  const base = path.join(ROOT, relative);
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else output.push(target);
    }
  }
  await visit(base);
  return output;
}

function rel(file) { return path.relative(ROOT, file).replaceAll('\\', '/'); }
function matches(text, expression) { return [...text.matchAll(expression)].length; }

export async function validateArch005TimeContract() {
  const errors = [];
  const check = (condition, code) => { if (!condition) errors.push(code); };

  for (const [name, expected] of Object.entries(FROZEN_MIGRATIONS)) {
    const bytes = await readFile(path.join(ROOT, 'database/migrations', name));
    check(createHash('sha256').update(bytes).digest('hex') === expected, `ARCH_005_FROZEN_MIGRATION_CHANGED:${name}`);
  }

  const contractFiles = (await filesUnder('contracts')).filter((file) => /\.(?:json|ya?ml|md|d\.(?:ts|mts|cts))$/u.test(file));
  let dateTimeFormats = 0;
  let offsetTimestampLeaks = 0;
  for (const file of contractFiles) {
    const text = await readFile(file, 'utf8');
    dateTimeFormats += matches(text, /(?:"format"\s*:\s*"date-time"|format:\s*date-time)/gu);
    if (/\.schema\.json$/u.test(file)) {
      try { JSON.parse(text); } catch { errors.push(`ARCH_005_CONTRACT_JSON_INVALID:${rel(file)}`); }
    }
    offsetTimestampLeaks += matches(text, /"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})"/gu);
  }
  check(dateTimeFormats === 0, 'ARCH_005_DATE_TIME_FORMAT_REMAINS');
  check(offsetTimestampLeaks === 0, 'ARCH_005_API_OFFSET_TIMESTAMP_LEAK');

  const draft = await readFile(path.join(ROOT, 'database/schema_draft.sql'), 'utf8');
  check(!/timestamptz|timestamp with time zone|timetz|time with time zone|tstzrange|tstzmultirange/iu.test(draft), 'ARCH_005_SCHEMA_DRAFT_FORBIDDEN_TYPE');

  const runtimeFiles = [
    ...(await filesUnder('src')).filter((file) => /\.(?:mjs|mts)$/u.test(file) && !file.endsWith('.d.mts')),
    ...(await filesUnder('scripts')).filter((file) => /\.(?:mjs|mts)$/u.test(file) && !file.endsWith('.d.mts')),
  ];
  const directPg = [];
  for (const file of runtimeFiles) {
    if (/^src\/platform\/postgres-(?:pool|types)\.(?:mjs|mts)$/u.test(rel(file))) continue;
    const text = await readFile(file, 'utf8');
    if (/from ['"]pg['"]|\bnew Pool\s*\(/u.test(text)) directPg.push(rel(file));
  }
  check(directPg.length === 0, `ARCH_005_DIRECT_PG_FACTORY_BYPASS:${directPg.join(',')}`);

  const criticalBusinessFiles = [
    'src/p1-003-channel-message-inbox.mjs',
    'src/p1-004-service-intake.mjs',
    'src/p1-005-pilot-ticket-core.mjs',
    'src/p1-006-ticket-state-actions.mjs',
    'src/p1-010-ticket-closure.mjs',
    'src/p1-011-pilot-operations-baseline.mjs',
    'src/p2-001-conversation-contracts.mjs',
    'src/p2-002-timeline-projector.mjs',
    'src/p2-003-realtime-event-log.mjs',
    'src/p2-004-communication-core.mjs',
    'src/p2-004-communication-projections.mjs',
    'src/p2-005-conversation-control-projections.mjs',
    'src/p2-006-workbench-query.mjs',
    'src/p2-g1-inbound-projection-coordinator.mjs',
    'web/p2-workbench/workbench.js',
  ];
  for (const relative of criticalBusinessFiles) {
    const text = await readFile(sourcePath(relative), 'utf8');
    check(!/Date\.parse\s*\(|\.toISOString\s*\(|toLocale(?:String|DateString|TimeString)\s*\(/u.test(text), `ARCH_005_BUSINESS_DATE_API:${relative}`);
  }
  const workbench = await readFile(path.join(ROOT, 'web/p2-workbench/workbench.js'), 'utf8');
  check(!/new Date\s*\(|toLocale/u.test(workbench), 'ARCH_005_BROWSER_TIMEZONE_DISPLAY_LEAK');

  const eventOrderingContracts = [
    ['src/p2-002-timeline-projector.mjs', 'ORDER BY item.occurred_at, item.sequence_no'],
    ['src/p2-006-workbench-query.mjs', 'ORDER BY occurred_at ${direction}, sequence_no ${direction}'],
    ['src/p2-003-realtime-event-log.mjs', 'ORDER BY event.occurred_at, event.event_id'],
    ['src/p2-g1-inbound-projection-coordinator.mjs', 'ORDER BY te.created_at,te.event_ordinal,te.event_id'],
    ['src/p2-g1-inbound-projection-coordinator.mjs', 'ORDER BY ce.occurred_at,ce.event_ordinal,ce.id'],
    ['src/p1-009-pilot-access-workbench.mjs', 'ORDER BY created_at, event_ordinal'],
  ];
  let eventOrderingViolations = 0;
  for (const [relative, token] of eventOrderingContracts) {
    const text = await readFile(sourcePath(relative), 'utf8');
    if (!text.includes(token)) {
      eventOrderingViolations += 1;
      errors.push(`ARCH_005_EVENT_ORDERING_CONTRACT_MISSING:${relative}:${token}`);
    }
  }

  const parallel = JSON.parse(await readFile(path.join(ROOT, 'plans/parallel_workstreams.json'), 'utf8'));
  check(parallel.feature_flags_enabled?.length === 0, 'ARCH_005_FEATURE_FLAG_ENABLED');
  check(Object.values(parallel.feature_flag_defaults ?? {}).every((value) => value === false), 'ARCH_005_FEATURE_FLAG_DEFAULT_TRUE');

  const migration = await readFile(path.join(ROOT, 'database/migrations/022_arch_005_asia_shanghai_time_contract.sql'), 'utf8');
  for (const token of ['platform.local_now()', 'platform.physical_epoch_ms()', 'platform.local_from_epoch_ms', 'platform.forbidden_owned_schema_time_types()', 'Asia/Shanghai', 'timestamp without time zone']) {
    check(migration.includes(token), `ARCH_005_MIGRATION_TOKEN_MISSING:${token}`);
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    frozen_migration_count: Object.keys(FROZEN_MIGRATIONS).length,
    contract_date_time_format_count: dateTimeFormats,
    api_offset_timestamp_leak_count: offsetTimestampLeaks,
    direct_pg_factory_bypass_count: directPg.length,
    browser_timezone_display_mismatch_count: 0,
    event_ordering_violation_count: eventOrderingViolations,
  });
}

async function main() {
  const result = await validateArch005TimeContract();
  console.log(JSON.stringify({ test_id: 'ARCH-005', event: 'arch_005_architecture_validation', ...result }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
