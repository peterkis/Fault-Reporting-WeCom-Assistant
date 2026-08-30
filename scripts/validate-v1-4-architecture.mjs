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
const projectSummary = json('project_summary.json');
const pkg = json('package.json');
const sourceExample = json('config_examples/integration_source.example.json');

check(manifest.architecture_baseline === 'V1.4', 'manifest baseline is V1.4');
check(manifest.current_phase === 'P2', 'manifest records P2 current');
check(manifest.active_task === 'P2-002' && manifest.last_completed_task === 'P2-001', 'manifest records only P2-002 active after P2-001');
check(manifest.status === 'P2_P2_002_IN_PROGRESS', 'manifest records P2-002 in progress');
check(manifest.next_task_candidate === 'P2-002' && manifest.next_task_authorized === true, 'manifest records P2-002 authorization');
check(JSON.stringify(manifest.authorized_tasks) === JSON.stringify(['P2-001', 'P2-002']) && manifest.active_lane === 'P2-A', 'manifest limits active authorization to P2-A P2-002');
check(manifest.implementation_authorization_status === 'P2_002_IN_PROGRESS' && manifest.p2_g1_status === 'NOT_STARTED', 'manifest keeps P2-G1 not started');
check(manifest.source_of_truth === 'Unified Ticket Core in this repository', 'manifest preserves Unified Ticket Core as sole source');
check(manifest.p3_scope === 'GREENFIELD_INTRANET_SOURCE_ONBOARDING_NO_HISTORICAL_TICKETS', 'manifest declares greenfield P3');
check(current.phase_id === 'P2' && current.status === 'IN_PROGRESS' && current.active_task === 'P2-002', 'current phase records only P2-002 active');
check(current.last_completed_task === 'P2-001', 'current phase records P2-001 as last completed');
check(current.next_phase_authorized === true, 'P2 phase start is authorized');
check(JSON.stringify(current.authorized_tasks) === JSON.stringify(['P2-001', 'P2-002']) && current.active_lane === 'P2-A', 'current authorization is limited to P2-001 and active P2-002 in P2-A');
check(current.next_task_candidate === 'P2-002' && current.next_task_authorized === true, 'P2-002 is the authorized active candidate');
check(current.implementation_authorization_status === 'P2_002_IN_PROGRESS' && current.p2_g1_status === 'NOT_STARTED', 'current state keeps P2-G1 not started');
check(current.p2_002_authorization_evidence === 'evidence/p2-002-start-authorization.md', 'current state links P2-002 authorization evidence');
check(current.exit_decision?.phase_id === 'P1' && current.exit_decision?.decision === 'GO' && current.exit_decision?.completed_at === '2026-08-30' && current.exit_decision?.evidence === 'evidence/p1-012-project-owner-go-approval.md' && current.exit_decision?.blockers?.length === 0, 'P1 exit identity completion and Go evidence are preserved');

const p1 = backlog.phases.find((p) => p.id === 'P1');
const p2 = backlog.phases.find((p) => p.id === 'P2');
const p3 = backlog.phases.find((p) => p.id === 'P3');
check(p1?.status === 'DONE' && p1?.go_decision === 'GO', 'P1 phase is complete with Go');
check(p2?.status === 'IN_PROGRESS', 'P2 is in progress');
check(backlog.active_task === 'P2-002' && backlog.last_completed_task === 'P2-001', 'backlog records P2-002 active after P2-001');
check(backlog.next_task_candidate === 'P2-002' && backlog.next_task_authorized === true, 'backlog records P2-002 authorized');
check(JSON.stringify(backlog.authorized_tasks) === JSON.stringify(['P2-001', 'P2-002']) && backlog.active_lane === 'P2-A' && backlog.implementation_authorization_status === 'P2_002_IN_PROGRESS', 'backlog limits active work to P2-002 in P2-A');
check(backlog.tasks.find((task) => task.id === 'P2-001')?.status === 'DONE', 'P2-001 is done');
check(backlog.tasks.find((task) => task.id === 'P2-001')?.evidence === 'evidence/p2-001-conversation-contracts-report.md', 'P2-001 evidence is linked');
check(backlog.tasks.find((task) => task.id === 'P2-002')?.status === 'IN_PROGRESS', 'P2-002 is in progress');
check(backlog.tasks.find((task) => task.id === 'P2-002')?.lane === 'P2-A' && backlog.tasks.find((task) => task.id === 'P2-002')?.gate === 'P2-G1', 'P2-002 remains in P2-A targeting but not starting P2-G1');
check(backlog.tasks.find((task) => task.id === 'P2-002')?.authorization_evidence === 'evidence/p2-002-start-authorization.md' && backlog.tasks.find((task) => task.id === 'P2-002')?.task_file === 'tasks/P2-002_persistent_timeline_projector.md', 'P2-002 links its task and authorization evidence');
check(backlog.tasks.filter((task) => task.phase === 'P2' && !['P2-001', 'P2-002'].includes(task.id)).every((task) => task.status === 'TODO'), 'P2-003 and later remain TODO');
check(p3?.status === 'TODO', 'P3 remains TODO');
check(backlog.tasks.filter((task) => task.phase === 'P3').every((task) => task.status === 'TODO'), 'all P3 tasks remain TODO');
check(backlog.source_of_truth === 'Unified Ticket Core in this repository' && p2?.ticket_backend === 'Unified Ticket Core', 'backlog preserves Unified Ticket Core as sole source');
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
const expectedFeatureFlags = [
  'CONVERSATION_CENTER_ENABLED',
  'CONVERSATION_REALTIME_SSE_ENABLED',
  'HUMAN_WORKBENCH_V2_ENABLED',
  'AI_TRIAGE_ENABLED',
  'AI_CONVERSATION_ENABLED',
  'AI_AUTO_REPLY_ENABLED',
  'OCR_ENABLED',
  'INCIDENT_CORRELATION_ENABLED',
  'INTEGRATION_CONNECTOR_ENABLED',
  'HOSPITAL_IDENTITY_ENABLED',
  'INTRANET_PORTAL_SOURCE_ENABLED',
  'HOSPITAL_API_SOURCE_ENABLED',
  'MONITORING_SOURCE_ENABLED',
];
check(parallel.current_phase === 'P2' && parallel.next_phase_authorized === true, 'parallel workstreams record P2 authorization');
check(parallel.active_task === 'P2-002' && parallel.active_lane === 'P2-A' && parallel.last_completed_task === 'P2-001' && JSON.stringify(parallel.authorized_tasks) === JSON.stringify(['P2-001', 'P2-002']), 'parallel workstreams activate only P2-002 in P2-A');
check(parallel.next_task_candidate === 'P2-002' && parallel.next_task_authorized === true && parallel.implementation_authorization_status === 'P2_002_IN_PROGRESS', 'parallel workstreams record P2-002 authorization');
check(Object.values(parallel.feature_flag_defaults ?? {}).every((value) => value === false) && parallel.feature_flags_enabled?.length === 0, 'all parallel feature flags remain false');
check(JSON.stringify(Object.keys(parallel.feature_flag_defaults ?? {})) === JSON.stringify(expectedFeatureFlags), 'parallel feature flag inventory matches the frozen environment contract');
check(JSON.stringify(laneIds) === JSON.stringify(['P2-A','P2-B','P2-C','P2-D','P3-A','P3-B','P3-C','P3-D']), 'parallel lanes are complete');
const p3c = parallel.lanes.find((l) => l.id === 'P3-C');
check(p3c?.name === 'Intranet Source Adapters', 'P3-C is intranet source adapters');
check(p3c?.branch === 'phase3/intranet-sources', 'P3-C branch is greenfield');
check(!(p3c?.feature_flags ?? []).some((f) => /LEGACY|HOSPITAL_TICKETS/.test(f)), 'P3-C has no legacy import flags');

const gates = new Map(parallel.assembly_gates.map((g) => [g.id, g.name]));
check(parallel.assembly_gates.find((g) => g.id === 'P2-G1')?.status === 'NOT_STARTED', 'P2-G1 remains not started');
check(parallel.assembly_gates.every((g) => g.status === 'NOT_STARTED'), 'all assembly gates remain not started');
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
for (const name of expectedFeatureFlags) {
  const line = `${name}=false`;
  check(new RegExp(`^${line}$`, 'm').test(env), `${line} defaults off`);
}
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
check(taskIndex.current_phase === 'P2' && taskIndex.active_task === 'P2-002' && taskIndex.last_completed_task === 'P2-001', 'task index records P2-002 active after P2-001');
check(taskIndex.next_phase_authorized === true, 'task index records P2 authorization');
check(taskIndex.next_tasks?.current === 'P2-002' && taskIndex.next_tasks?.candidate === 'P2-002' && taskIndex.next_tasks?.candidate_authorized === true, 'task index records P2-002 as current and authorized');
check(JSON.stringify(taskIndex.authorized_tasks) === JSON.stringify(['P2-001', 'P2-002']) && taskIndex.active_lane === 'P2-A' && taskIndex.implementation_authorization_status === 'P2_002_IN_PROGRESS', 'task index limits authorization to active P2-A');
check(JSON.stringify(taskIndex.next_tasks?.after_p1) === JSON.stringify(['P2-001']) && taskIndex.next_tasks?.authorization_required_after_current === true, 'task index requires separate authorization after P2-002');
check(taskIndex.architecture_guards.some((g) => g.includes('no historical ticket import')), 'task index guards greenfield P3');

check(projectSummary.project.architecture_baseline === 'V1.4', 'project summary uses V1.4');
check(projectSummary.project.status === 'p2_p2_002_in_progress', 'project summary records P2-002 in progress');
check(projectSummary.project.last_completed_task === 'P2-001' && projectSummary.project.active_task === 'P2-002' && projectSummary.project.active_lane === 'P2-A', 'project summary records only P2-002 active in P2-A');
check(projectSummary.project.next_task === 'P2-002' && projectSummary.project.next_task_authorized === true, 'project summary records P2-002 authorization');
check(JSON.stringify(projectSummary.project.authorized_tasks) === JSON.stringify(['P2-001', 'P2-002']) && projectSummary.project.p2_g1_status === 'NOT_STARTED', 'project summary keeps P2-G1 not started');
const p2Summary = projectSummary.phase_model.find((phase) => phase.id === 'P2');
check(p2Summary?.status === 'IN_PROGRESS' && p2Summary?.active_task === 'P2-002' && p2Summary?.next_task_authorized === true && p2Summary?.p2_g1_status === 'NOT_STARTED', 'phase model mirrors P2-002 active state');
check(projectSummary.hard_invariants.includes('unified_ticket_core_is_long_term_source_of_truth'), 'project summary preserves Unified Ticket Core authority');

const conversationThreadSchema = json('contracts/conversation_thread.schema.json');
const conversationSessionSchema = json('contracts/conversation_session.schema.json');
const conversationItemSchema = json('contracts/conversation_item.schema.json');
check(JSON.stringify(conversationThreadSchema['x-natural-identity']) === JSON.stringify(['provider', 'channel_account_id', 'chat_type', 'external_thread_key']), 'Thread natural identity is frozen');
check(conversationSessionSchema.properties?.control_mode?.default === 'HUMAN', 'Session defaults to HUMAN');
check(conversationItemSchema['x-implementation-task'] === 'P2-002', 'Conversation Item persistence remains reserved for P2-002');
check(fs.existsSync(path.join(root, 'tasks/P2-001_conversation_thread_session_contracts.md')), 'P2-001 task record exists');
check(fs.existsSync(path.join(root, 'evidence/p2-001-conversation-contracts-report.md')), 'P2-001 evidence exists');
check(fs.existsSync(path.join(root, 'tasks/P2-002_persistent_timeline_projector.md')), 'P2-002 task record exists');
check(fs.existsSync(path.join(root, 'evidence/p2-002-start-authorization.md')), 'P2-002 authorization evidence exists');

const p1Approval = read('evidence/p1-012-project-owner-go-approval.md');
check(p1Approval.includes('“我批准了”'), 'P1 approval preserves the project owner confirmation');
check(p1Approval.includes('P2') && p1Approval.includes('单独授权'), 'P1 approval itself did not start P2');
const p2Authorization = read('evidence/p2-phase-start-authorization.md');
check(p2Authorization.includes('项目负责人正式授权启动 Phase 2，但本轮仅授权 ARCH-004 和 P2-001'), 'P2 authorization records exact authorized scope');
check(p2Authorization.includes('P2-002 及以后任务仍须另行授权'), 'P2 authorization preserves the next-task stop line');
check(p2Authorization.includes('不等同于生产上线、临床上线或 AI 自动回复批准'), 'P2 authorization excludes production clinical and AI reply approval');
const p2_002Authorization = read('evidence/p2-002-start-authorization.md');
check(p2_002Authorization.includes('项目负责人正式、独立授权启动 P2-002'), 'P2-002 authorization records exact project-owner scope');
check(p2_002Authorization.includes('P2-003 及以后任务、P2-G1 组装和所有生产功能仍须另行授权'), 'P2-002 authorization preserves the next-task and gate stop line');
check(p2_002Authorization.includes('所有 P2/P3 Feature Flag 继续为 `false`'), 'P2-002 authorization keeps all feature flags off');

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
