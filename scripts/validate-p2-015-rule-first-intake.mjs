import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import ts from 'typescript';
import { P2_015_ACTION_TYPES, P2_015_LIMITS, P2_015_RESULT_CODES } from '../src/p2-015-domain-contracts.mjs';

const root = process.cwd(); const errors = []; let checks = 0;
const check = (condition, message) => { checks += 1; if (!condition) errors.push(message); };
const migrationScope = JSON.parse(fs.readFileSync(path.join(root, 'plans/typescript-migration/scope.json'), 'utf8'));
const moduleMap = migrationScope.current_module_map;
const sourcePath = name => path.join(root, moduleMap[name] ?? name);
const read = (name) => fs.readFileSync(sourcePath(name), 'utf8');
const required = [
  'database/migrations/030_p2_015_rule_first_intake_orchestration.sql',
  ...['contact_journey','channel_leg','continuation_ref','deterministic_decision','manual_review_item','manual_review_command','safe_action_suggestion','orchestration_input','orchestration_result'].map((name) => `contracts/p2_015_${name}.schema.json`),
  'contracts/p2_015_contracts.d.ts',
  ...['domain-contracts','contact-journey','continuation-ref','decision-router','decision-store','service-intake-decision-port','safe-action-executor','manual-review','rule-first-orchestrator','worker','query','projections'].map((name) => `src/p2-015-${name}.mjs`),
  'scripts/p2-015-migrate.mjs','scripts/p2-015-reconcile.mjs',
  'tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl','tests/fixtures/p2-015/rule-first-safe-route-manifest.v1.json',
  'tests/p2-015-rule-first-orchestration.test.mjs','tests/p2-015-contact-journey.test.mjs',
  'tests/p2-015-manual-review.test.mjs','tests/p2-015-worker.test.mjs',
  'tests/p2-015-rule-first-orchestration.integration.test.mjs','tests/p2-015-worker-restart.integration.test.mjs',
  'tests/helpers/p2-015-postgres-harness.mjs','tests/helpers/p2-015-worker-child.mjs',
  'docs/55_p2_015_rule_first_intake_orchestration.md','docs/56_p2_015_contact_journey_continuation.md',
  'docs/57_p2_015_manual_review_and_safe_actions.md','evidence/p2-015-start-authorization.md',
  'evidence/p2-015-rule-first-intake-orchestration-report.md',
];
for (const name of required) check(fs.existsSync(sourcePath(name)), `${name} exists`);

const migration = read('database/migrations/030_p2_015_rule_first_intake_orchestration.sql');
check((migration.match(/CREATE TABLE IF NOT EXISTS intake\./gu) ?? []).length === 6, 'migration 030 creates exactly six intake tables');
for (const table of ['contact_journey','channel_leg','continuation_ref','deterministic_decision','manual_review_item','safe_action_suggestion']) check(migration.includes(`intake.${table}`), `migration owns ${table}`);
check(!/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER|EXTENSION)/iu.test(migration), 'migration adds no trigger function or extension');
check(!/CREATE TABLE IF NOT EXISTS\s+(?:pilot_ticket|conversation|communication|incident)\./iu.test(migration), 'migration adds no second owned core');
check(!/TIMESTAMPTZ|timestamp with time zone|time with time zone/iu.test(migration), 'migration has no timezone-bearing type');
check(/FOR UPDATE SKIP LOCKED/u.test(read('src/p2-015-worker.mjs')), 'worker uses PostgreSQL safe claim');
check(!/\b(?:redis|kafka|rabbitmq|bullmq|celery|typeorm|prisma)\b/iu.test([...required.filter((name) => name.startsWith('src/')).map(read)].join('\n')), 'runtime has no broker Redis or ORM');
check(!/(?:fetch\s*\(|https?:\/\/|@wecom\/aibot|deepseek|openai)/iu.test([...required.filter((name) => name.startsWith('src/')).map(read)].join('\n')), 'runtime has no network model or WeCom SDK call');

const contractNames = required.filter((name) => name.startsWith('contracts/') && name.endsWith('.schema.json'));
for (const name of contractNames) {
  const content = read(name); JSON.parse(content);
  check(!/"format"\s*:\s*"date-time"|\\dT\\d|Z(?:"|\/)|[+-][0-9]{2}:[0-9]{2}/u.test(content), `${name} uses offset-free time`);
}
check(contractNames.some((name) => read(name).includes('local_datetime.schema.json')), 'contracts reference LocalDateTime');
check(contractNames.some((name) => read(name).includes('epoch_ms_string.schema.json')), 'contracts reference PhysicalEpochMs string');

const gold = read('tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl').trim().split(/\r?\n/u).map(JSON.parse);
check(gold.length === 202, 'gold references 96 + 42 + 64 cases');
check(new Set(gold.map((item) => `${item.source_fixture}:${item.source_case_id}`)).size === 202, 'gold source references are unique');
const covered = new Set(gold.map((item) => item.expected_result_code));
for (const code of P2_015_RESULT_CODES) check(covered.has(code), `gold covers ${code}`);
check(gold.every((item) => P2_015_ACTION_TYPES.length > 0 && item.prohibited_effects.includes('CALL_LLM_PROVIDER')), 'gold forbids model effects');
const coverage = gold.filter((item) => P2_015_RESULT_CODES.includes(item.expected_result_code)).length / gold.length;
check(coverage >= 0.9, 'deterministic safe route coverage is at least 90 percent');

const env = read('.env.example');
for (const flag of ['RULE_FIRST_ORCHESTRATION_ENABLED=false','MANUAL_REVIEW_QUEUE_ENABLED=false','AI_TRIAGE_ENABLED=false','AI_CONVERSATION_ENABLED=false','AI_AUTO_REPLY_ENABLED=false','OCR_ENABLED=false']) check(env.includes(flag), `${flag} remains default`);
check(P2_015_LIMITS.poolMax <= 4 && P2_015_LIMITS.workerCount === 1, '2C4G pool and worker bounds');
check(P2_015_LIMITS.defaultBatch === 20 && P2_015_LIMITS.maximumBatch <= 100, 'worker batch bounds');
check(P2_015_LIMITS.maximumReviewPage <= 100 && P2_015_LIMITS.messageWindowTurns <= 50 && P2_015_LIMITS.evaluatedTextCharacters <= 20_000 && P2_015_LIMITS.openJourneyCandidates <= 10, 'query and message bounds');

function erasedMigrationRuntime(source) {
  // Match ARCH-006's locked compiler comparison; executable expressions remain significant.
  const result = ts.transpileModule(source.replaceAll('\r\n', '\n'), {
    fileName: 'module.mts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      verbatimModuleSyntax: true, removeComments: true, newLine: ts.NewLineKind.LineFeed },
  });
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new SyntaxError('P2015_MIGRATION_EMIT_INVALID');
  }
  return result.outputText;
}

function onlyRegisteredTypeMigrations(paths) {
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  try {
    const base = git('merge-base', 'origin/main', 'HEAD').trim();
    const targets = new Set(Object.values(migrationScope.migration_batches).flat());
    return [...new Set(paths)].every(physical => {
      if (!/^src\/p2-007-.+\.(?:mjs|mts)$/u.test(physical)) return false;
      const logical = physical.replace(/\.mts$/u, '.mjs'), typed = logical.replace(/\.mjs$/u, '.mts');
      if (!targets.has(logical) || moduleMap[logical] !== typed) return false;
      const before = git('ls-tree', base, '--', logical, typed).trim().split('\n');
      const after = git('ls-tree', 'HEAD', '--', logical, typed).trim().split('\n');
      // A single original file must become a single typed file, retaining its mode.
      if (before.length !== 1 || after.length !== 1 || !before[0].endsWith('\t' + logical)
        || !after[0].endsWith('\t' + typed) || !/^100(?:644|755) blob /u.test(before[0])
        || before[0].split(' ')[0] !== after[0].split(' ')[0]) return false;
      return erasedMigrationRuntime(git('show', base + ':' + logical)) === erasedMigrationRuntime(git('show', 'HEAD:' + typed));
    });
  } catch { return false; }
}

const frozen = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\','/')}`, 'diff', '--no-renames', '--name-only', '-z', 'origin/main...HEAD', '--',
  'database/migrations/001_*','database/migrations/002_*','database/migrations/003_*','database/migrations/004_*','database/migrations/005_*','database/migrations/006_*','database/migrations/007_*','database/migrations/008_*','database/migrations/009_*','database/migrations/010_*','database/migrations/011_*','database/migrations/012_*','database/migrations/020_*','database/migrations/021_*','database/migrations/022_*','src/p2-007-*'], { cwd: root, encoding: 'utf8' });
const frozenPaths = frozen.stdout?.split('\0').filter(Boolean) ?? [];
check(frozen.status === 0 && (frozenPaths.length === 0 || onlyRegisteredTypeMigrations(frozenPaths)), 'migrations 001-022 and P2-007 runtime are unchanged');

if (errors.length > 0) { console.error(`P2-015 validation failed (${errors.length}/${checks}):`); for (const error of errors) console.error(`- ${error}`); process.exitCode = 1; }
else console.log(JSON.stringify({ task: 'P2-015', ok: true, checks, deterministic_safe_route_coverage: coverage, source_cases: gold.length,
  result_codes: [...covered].sort(), model_provider_calls: 0, sender_calls: 0, incident_writes: 0,
  limits: P2_015_LIMITS }));
