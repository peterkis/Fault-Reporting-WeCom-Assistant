import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) errors.push(message);
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function json(rel) { return JSON.parse(read(rel)); }

const manifest = json('MANIFEST.json');
const current = json('plans/current_phase.json');
const backlog = json('plans/master_backlog.json');
const parallel = json('plans/parallel_workstreams.json');
const taskIndex = json('tasks/master_backlog.json');
const pkg = json('package.json');
const sourceExample = json('config_examples/integration_source.example.json');

check(manifest.architecture_baseline === 'V1.4', 'manifest baseline is V1.4');
check(manifest.current_phase === 'P1', 'manifest keeps P1 current');
check(manifest.active_task === null, 'manifest has no active task after P1 Go');
check(manifest.status === 'P1_GO_APPROVED_AWAITING_P2_AUTHORIZATION', 'manifest records P1 Go without starting P2');
check(manifest.p3_scope === 'GREENFIELD_INTRANET_SOURCE_ONBOARDING_NO_HISTORICAL_TICKETS', 'manifest declares greenfield P3');
check(current.phase_id === 'P1' && current.status === 'DONE' && current.active_task === null, 'current phase records completed P1');
check(current.last_completed_task === 'P1-012', 'current phase records P1-012 as last completed');
check(current.next_phase_authorized === false, 'P2 still requires separate authorization');
check(current.exit_decision?.decision === 'GO' && current.exit_decision?.blockers?.length === 0, 'P1 exit decision is GO with no blockers');

const p1 = backlog.phases.find((p) => p.id === 'P1');
const p2 = backlog.phases.find((p) => p.id === 'P2');
const p3 = backlog.phases.find((p) => p.id === 'P3');
check(p1?.status === 'DONE' && p1?.go_decision === 'GO', 'P1 phase is complete with Go');
check(p2?.status === 'TODO', 'P2 remains TODO');
check(backlog.tasks.filter((task) => task.phase === 'P2').every((task) => task.status === 'TODO'), 'all P2 tasks remain TODO');
check(p3?.status === 'TODO', 'P3 remains TODO');
check(p3?.target_source_of_truth === 'Unified Ticket Core', 'Unified Ticket Core remains authoritative');
check(p3?.scope_mode === 'GREENFIELD_NO_HISTORICAL_TICKETS', 'P3 scope is greenfield');
check(!Object.hasOwn(p3 ?? {}, 'legacy_source'), 'P3 has no legacy source field');

const taskIds = new Set(backlog.tasks.map((t) => t.id));
for (let i = 1; i <= 14; i += 1) check(taskIds.has(`P2-${String(i).padStart(3, '0')}`), `backlog defines P2-${String(i).padStart(3, '0')}`);
for (let i = 1; i <= 12; i += 1) check(taskIds.has(`P3-${String(i).padStart(3, '0')}`), `backlog defines P3-${String(i).padStart(3, '0')}`);

const p3_007 = backlog.tasks.find((t) => t.id === 'P3-007');
const p3_012 = backlog.tasks.find((t) => t.id === 'P3-012');
const p1_012 = backlog.tasks.find((t) => t.id === 'P1-012');
check(p1_012?.status === 'DONE' && p1_012?.decision === 'GO', 'P1-012 is complete with Go');
check(p3_007?.title.includes('内网报修门户'), 'P3-007 is first intranet portal adapter');
check(p3_012?.title.includes('第一条生产内网来源'), 'P3-012 is first production source onboarding');

const laneIds = parallel.lanes.map((l) => l.id);
check(parallel.current_phase === 'P1' && parallel.next_phase_authorized === false, 'parallel workstreams do not start P2');
check(JSON.stringify(laneIds) === JSON.stringify(['P2-A','P2-B','P2-C','P2-D','P3-A','P3-B','P3-C','P3-D']), 'parallel lanes are complete');
const p3c = parallel.lanes.find((l) => l.id === 'P3-C');
check(p3c?.name === 'Intranet Source Adapters', 'P3-C is intranet source adapters');
check(p3c?.branch === 'phase3/intranet-sources', 'P3-C branch is greenfield');
check(!(p3c?.feature_flags ?? []).some((f) => /LEGACY|HOSPITAL_TICKETS/.test(f)), 'P3-C has no legacy import flags');

const gates = new Map(parallel.assembly_gates.map((g) => [g.id, g.name]));
check(gates.get('P3-G2') === 'First Intranet Source E2E', 'P3-G2 is first source E2E');
check(gates.get('P3-G4') === 'First Production Source Onboarding and Phase 3 Go', 'P3-G4 is production source onboarding');

const canonicalFiles = [
  'README.md', 'AGENTS.md', 'docs/architecture_baseline_status.md',
  'plans/phase_3_unified_ticket_platform.md', 'tickets/P3_unified_ticket_platform_tasks.md',
  'docs/35_unified_ticket_and_intranet_connectors.md', 'docs/37_parallel_delivery_and_acceptance.md'
];
for (const rel of canonicalFiles) {
  const text = read(rel);
  check(text.includes('Unified Ticket Core'), `${rel} names Unified Ticket Core`);
  check(!/SUPERSEDED_EXTERNAL_TARGET|SUPERSEDED_IMPORT_FLAG_REMOVED|SUPERSEDED_TARGET_FLAG_REMOVED/.test(text), `${rel} has no placeholder legacy identifiers`);
}
const activeP3Titles = backlog.tasks.filter((t) => t.phase === 'P3').map((t) => t.title).join('\n');
check(!/历史|未完结|旧工单|冻结|退役|迁移批次|最终增量/.test(activeP3Titles), 'active P3 task titles contain no historical-ticket work');
const activeGateNames = parallel.assembly_gates.filter((g) => g.id.startsWith('P3-')).map((g) => g.name).join('\n');
check(!/Legacy|Cutover|Decommission|Migration/.test(activeGateNames), 'active P3 gates are greenfield');

const p3Plan = read('plans/phase_3_unified_ticket_platform.md');
check(p3Plan.includes('P3-G2 First Intranet Source E2E'), 'P3 plan includes greenfield G2');
check(p3Plan.includes('P3-G4 First Production Source Onboarding'), 'P3 plan includes greenfield G4');
check(read('adr/0012_greenfield_p3_no_historical_ticket_compatibility.md').includes('状态：Accepted'), 'ADR-0012 is accepted');
check(read('adr/0007_pilot_ticket_core_then_adapter.md').includes('Superseded'), 'ADR-0007 remains superseded');

const env = read('.env.example');
for (const line of [
  'CONVERSATION_CENTER_ENABLED=false', 'HUMAN_WORKBENCH_V2_ENABLED=false',
  'AI_CONVERSATION_ENABLED=false', 'AI_AUTO_REPLY_ENABLED=false', 'OCR_ENABLED=false',
  'INTEGRATION_CONNECTOR_ENABLED=false', 'HOSPITAL_IDENTITY_ENABLED=false',
  'INTRANET_PORTAL_SOURCE_ENABLED=false', 'HOSPITAL_API_SOURCE_ENABLED=false',
  'MONITORING_SOURCE_ENABLED=false'
]) check(new RegExp(`^${line}$`, 'm').test(env), `${line} defaults off`);
check(!/SUPERSEDED_IMPORT_FLAG_REMOVED|SUPERSEDED_TARGET_FLAG_REMOVED/.test(env), 'env has no historical-ticket flags');

check(sourceExample.source_code === 'INTRANET_REPORT_PORTAL', 'source example is a new intranet portal');
check(sourceExample.capabilities.submit_service_requests === true, 'source can submit new requests');
check(sourceExample.capabilities.own_ticket_state === false, 'source cannot own ticket state');
check(!Object.hasOwn(sourceExample, 'cutover'), 'source example has no cutover section');

const schema = read('database/schema_draft.sql');
check(schema.includes('V1.4 CONCEPTUAL SCHEMA DRAFT'), 'schema is V1.4');
check(schema.includes('greenfield sources only'), 'schema declares greenfield integration');
check(!/migration_batch_id|MIGRATION_BATCH|FINAL_CUTOVER|IMPORT_ONLY|IMPORT_AND_PROJECT|FILE_IMPORT/.test(schema), 'schema has no historical migration fields');
check(!/CREATE TABLE IF NOT EXISTS\s+unified_ticket\.ticket/i.test(schema), 'schema does not create second ticket core');

check(taskIndex.architecture_baseline === 'V1.4', 'task index baseline is V1.4');
check(taskIndex.active_task === null && taskIndex.last_completed_task === 'P1-012', 'task index closes P1-012 without activating another task');
check(taskIndex.next_phase_authorized === false, 'task index keeps P2 unauthorized');
check(taskIndex.architecture_guards.some((g) => g.includes('no historical ticket import')), 'task index guards greenfield P3');

const p1Approval = read('evidence/p1-012-project-owner-go-approval.md');
check(p1Approval.includes('“我批准了”'), 'P1 approval preserves the project owner confirmation');
check(p1Approval.includes('P2') && p1Approval.includes('单独授权'), 'P1 approval does not start P2');

check(pkg.scripts['validate:architecture:v1.4'] === 'node scripts/validate-v1-4-architecture.mjs', 'package exposes V1.4 validator');
check(pkg.scripts['test:architecture:v1.4'] === 'node --test tests/v1-4-architecture-baseline.test.mjs', 'package exposes V1.4 tests');
check(pkg.dependencies['@wecom/aibot-node-sdk'] === '1.0.6', 'WeCom SDK remains pinned');
check(pkg.dependencies.pg === '8.23.0', 'pg remains pinned');

if (errors.length) {
  console.error(`V1.4 architecture validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`V1.4 architecture validation passed (${checks} checks).`);
}
