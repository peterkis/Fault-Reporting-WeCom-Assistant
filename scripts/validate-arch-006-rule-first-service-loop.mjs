import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const errors = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) errors.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function same(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

const stateFiles = [
  'MANIFEST.json',
  'plans/current_phase.json',
  'plans/master_backlog.json',
  'plans/parallel_workstreams.json',
  'tasks/master_backlog.json',
  'project_summary.json',
];
const manifest = json(stateFiles[0]);
const current = json(stateFiles[1]);
const backlog = json(stateFiles[2]);
const parallel = json(stateFiles[3]);
const taskIndex = json(stateFiles[4]);
const summary = json(stateFiles[5]);
const views = [manifest, current, backlog, parallel, taskIndex, summary.project];
const lifecycleState = current.implementation_authorization_status;
const p2g2Authorized=['P2_G2_ASSEMBLY_AUTHORIZED','P2_G2_READY_FOR_LIVE_E2E'].includes(lifecycleState);
const p2g2Ready=lifecycleState==='P2_G2_READY_FOR_LIVE_E2E';
const expectedP2g2Status=p2g2Authorized?(p2g2Ready?'READY_FOR_LIVE_E2E':'IN_PROGRESS'):'NOT_STARTED';
const p2012Authorized=['P2_012_AUTHORIZED','P2_012_READY_FOR_TARGETED_LIVE_VALIDATION'].includes(lifecycleState);
const p2012Ready=lifecycleState==='P2_012_READY_FOR_TARGETED_LIVE_VALIDATION';
const p2012Done=p2g2Authorized||lifecycleState==='P2_012_DONE_AWAITING_P2_G2_AUTHORIZATION';
const expectedP2012Status=p2012Done?'DONE':p2012Ready?'READY_FOR_TARGETED_LIVE_VALIDATION':p2012Authorized?'AUTHORIZED':'TODO_REQUIRES_SEPARATE_AUTHORIZATION';
const p2016Done=p2012Authorized||p2012Done||lifecycleState==='P2_016_DONE_AWAITING_P2_012_AUTHORIZATION';
const p2016Authorized=p2016Done||['P2_016_AUTHORIZED','P2_016_READY_FOR_TARGETED_LIVE_VALIDATION'].includes(lifecycleState);
const expectedP2016Status=p2016Done?'DONE':lifecycleState==='P2_016_READY_FOR_TARGETED_LIVE_VALIDATION'?'READY_FOR_TARGETED_LIVE_VALIDATION':p2016Authorized?'AUTHORIZED':'TODO_REQUIRES_SEPARATE_AUTHORIZATION';
const successor = p2016Authorized || lifecycleState === 'P2_015_AUTHORIZED' || lifecycleState === 'P2_015_DONE_AWAITING_P2_016_AUTHORIZATION';
const completed = p2016Authorized || lifecycleState === 'P2_015_DONE_AWAITING_P2_016_AUTHORIZATION';
const expectedLastTask = p2012Done?'P2-012':p2016Done?'P2-016':completed ? 'P2-015' : 'P2-007';
const expectedActiveTask = p2g2Authorized?'P2-G2':p2012Authorized?'P2-012':p2016Done?null:p2016Authorized?'P2-016':lifecycleState === 'P2_015_AUTHORIZED' ? 'P2-015' : null;
const expectedActiveLane = p2g2Authorized?'ASSEMBLY':p2012Authorized?'P2-D':p2016Done?null:p2016Authorized?'P2-B':lifecycleState === 'P2_015_AUTHORIZED' ? 'P2-C' : null;
const expectedCandidate = p2g2Ready?'P2-G2-LIVE':p2012Done?'P2-G2':p2012Ready?'P2-012-LIVE':p2016Done?'P2-012':completed ? 'P2-016' : 'P2-015';
const expectedCandidateAuthorized = p2g2Authorized?!p2g2Ready:p2012Authorized?!p2012Ready:!p2016Done&&(p2016Authorized || lifecycleState === 'P2_015_AUTHORIZED');
const expectedP2015Status = completed ? 'DONE' : successor ? 'AUTHORIZED' : 'TODO_REQUIRES_SEPARATE_AUTHORIZATION';

for (const view of views) {
  check(view.last_completed_task === expectedLastTask, 'last_completed_task preserves ARCH-006 or authorized successor state');
  check(view.last_completed_gate === 'P2-G1', 'last_completed_gate remains P2-G1');
  check(view.last_completed_architecture_task === 'ARCH-006', 'last_completed_architecture_task is ARCH-006');
  check(view.active_task === expectedActiveTask && view.active_lane === expectedActiveLane, 'active task and lane match the authorized successor state');
  check(view.implementation_authorization_status === lifecycleState, 'ARCH-006 and successor lifecycle status is consistent');
  check(view.arch_005_status === 'DONE', 'ARCH-005 remains DONE');
  check(view.arch_006_status === 'DONE', 'ARCH-006 is DONE');
  check(view.p2_007_status === 'DONE', 'P2-007 remains DONE');
  check(view.p2_g1_status === 'PASSED', 'P2-G1 remains PASSED');
  for (const gate of ['p2_g2_status', 'p2_g3_status', 'p2_g4_status', 'p2_g5_status']) {
    check(view[gate] === (gate==='p2_g2_status'?expectedP2g2Status:'NOT_STARTED'), gate + ' remains NOT_STARTED');
  }
  check(view.p2_015_status === expectedP2015Status, 'P2-015 machine status is exact');
  check(view.p2_016_status === expectedP2016Status, 'P2-016 machine status is exact');
  check(view.p2_012_status === expectedP2012Status, 'P2-012 machine status is exact');
  check(view.p2_008_status === 'TODO_BLOCKED_BY_P2_G2', 'P2-008 machine status is exact');
  for (const task of ['p2_009_status', 'p2_010_status', 'p2_011_status', 'p2_013_status', 'p2_014_status']) {
    check(view[task] === 'TODO', task + ' remains TODO');
  }
}

if(p2g2Authorized){
  check(views.every(v=>same(v.authorized_gates,['P2-G1','P2-G2']) && !v.authorized_tasks.includes('P2-G2') && !v.authorized_tasks.includes('P2-008')), 'P2-G2 uses independent Gate authorization without AI Runtime');
  check(views.every(v=>v.p2_g2_base_commit==='8c332710dad9b6cf3f6796f3344c04d1c710ddf3'
    && v.p2_g2_authorization_evidence==='evidence/p2-g2-start-authorization.md'), 'P2-G2 frozen merge and authorization are exact');
}

check(manifest.status === (p2016Authorized||p2012Done?'P2_'+lifecycleState:completed ? 'P2_P2_015_DONE_AWAITING_P2_016_AUTHORIZATION' : successor ? 'P2_P2_015_AUTHORIZED' : 'P2_ARCH_006_DONE_AWAITING_P2_015_AUTHORIZATION'), 'manifest lifecycle status is exact');
check(summary.project.status === (p2016Authorized||p2012Done?'p2_'+lifecycleState.toLowerCase():completed ? 'p2_p2_015_done_awaiting_p2_016_authorization' : successor ? 'p2_p2_015_authorized' : 'p2_arch_006_done_awaiting_p2_015_authorization'), 'project lifecycle status is exact');
check(current.phase_id === 'P2' && current.status === 'IN_PROGRESS', 'Phase P2 remains IN_PROGRESS');
check(views.every((view) => (view.next_task_candidate ?? view.next_task) === expectedCandidate), 'next candidate matches the successor lifecycle');
check(taskIndex.next_tasks.current === expectedActiveTask && taskIndex.next_tasks.candidate === expectedCandidate, 'task index matches active and next tasks');
check(views.every((view) => (view.next_task_authorized ?? false) === expectedCandidateAuthorized), 'next candidate authorization is exact');

const byId = new Map(backlog.tasks.map((task) => [task.id, task]));
const p2015 = byId.get('P2-015');
const p2016 = byId.get('P2-016');
const p2012 = byId.get('P2-012');
const p2008 = byId.get('P2-008');
check(p2015?.status === (completed ? 'DONE' : successor ? 'AUTHORIZED' : 'TODO')
  && p2015?.authorization_status === (successor ? 'AUTHORIZED' : 'REQUIRES_SEPARATE_AUTHORIZATION'), 'P2-015 lifecycle is exact');
check(same(p2015?.depends_on, ['P2-G1', 'ARCH-005', 'P2-007', 'P1-004', 'P1-005', 'P2-004']), 'P2-015 dependencies are exact');
check(p2015?.migration_reservation === '030', 'P2-015 owns migration 030 reservation');
check(p2016?.status === (p2016Authorized?expectedP2016Status:'TODO') && p2016?.authorization_status === (p2016Authorized?'AUTHORIZED':'REQUIRES_SEPARATE_AUTHORIZATION'), 'P2-016 requires its independent authorization');
check(same(p2016?.depends_on, ['P2-015', 'P1-006', 'P2-004', 'P2-005', 'P2-006']), 'P2-016 dependencies are exact');
check(p2016?.migration_reservation === '031_IF_REQUIRED', 'P2-016 conditionally reserves migration 031');
check(p2012?.status === (p2012Authorized||p2012Done?expectedP2012Status:'TODO') && p2012?.authorization_status === (p2012Authorized||p2012Done?'AUTHORIZED':'REQUIRES_SEPARATE_AUTHORIZATION'), 'P2-012 lifecycle is exact');
check(same(p2012?.depends_on, ['P2-007', 'P2-015', 'P2-016']) && p2012?.gate === 'P2-G2', 'P2-012 precedes AI with exact dependencies');
check(backlog.tasks.filter((task) => task.id === 'P2-012').length === 1, 'P2-012 is not duplicated');
check(p2008?.status === 'TODO' && p2008?.authorization_status === 'BLOCKED_BY_P2_G2'
  && same(p2008?.depends_on, ['P2-G2', 'P2-007']), 'P2-008 is blocked until P2-G2');

const gates = parallel.assembly_gates.filter((gate) => gate.id.startsWith('P2-'));
check(same(gates.map((gate) => gate.id), ['P2-G1', 'P2-G2', 'P2-G3', 'P2-G4', 'P2-G5']), 'P2-G1 through P2-G5 are ordered');
check(gates[0]?.status === 'PASSED' && gates.slice(1).every((gate) => gate.status === (gate.id==='P2-G2'?expectedP2g2Status:'NOT_STARTED')), 'only P2-G1 is passed');
check(gates[1]?.name === '规则优先、人工兜底的完整服务闭环'
  && same(gates[1].requires, ['P2-G1', 'ARCH-005', 'P2-007', 'P2-015', 'P2-016', 'P2-012']), 'P2-G2 definition is exact');
check(gates[2]?.name === 'AI Shadow' && same(gates[2].requires, ['P2-G2', 'P2-008', 'P2-009']), 'P2-G3 definition is exact');
check(gates[3]?.name === 'Copilot and Media' && same(gates[3].requires, ['P2-G3', 'P2-010', 'P2-011']), 'P2-G4 definition is exact');
check(gates[4]?.name === 'Controlled Auto and Phase 2 Go'
  && same(gates[4].requires, ['P2-G4', 'P2-013', 'P2-014']), 'P2-G5 definition is exact');

const expectedResults = [
  'TICKET_ELIGIBLE', 'NEEDS_DESCRIPTION', 'MANUAL_REVIEW_REQUIRED', 'RELATED_FOLLOW_UP',
  'STATUS_QUERY', 'SERVICE_REQUEST', 'BUSINESS_CONSULTATION', 'ACKNOWLEDGEMENT',
  'OUT_OF_SCOPE', 'INCIDENT_REVIEW_CANDIDATE',
];
const resultContract = read('docs/51_rule_first_intake_manual_review.md');
for (const result of expectedResults) check(resultContract.includes('`' + result + '`'), result + ' is first-class');
for (const phrase of ['输入前置条件', '最小 Ticket', '追加目标', '自动回复', '人工审核', '通知建议', 'Incident Candidate', '必记 Provenance', '稳定 reason code', '失败降级']) {
  check(resultContract.includes(phrase), 'result contract includes ' + phrase);
}

const arch = read('docs/50_arch_006_ai_optional_rule_first_service_loop.md');
const gateDoc = read('docs/54_p2_g2_deterministic_full_service_loop_gate.md');
for (const mode of ['GROUP_MENTION_INLINE', 'GROUP_MENTION_TO_DIRECT_GUIDED', 'DIRECT_ORGANIC']) check(arch.includes(mode), mode + ' is frozen');
for (const metric of ['deterministic_safe_route_coverage', 'explicit_incident_report_missed', 'clinical_high_risk_missed', 'real_fault_auto_ignored', 'unsupported_root_cause_confirmed', 'manual_review_reachable', 'determinism_mismatch', 'model_provider_calls']) {
  check(arch.includes(metric) && gateDoc.includes(metric), metric + ' is in architecture and Gate');
}
check(arch.includes('不是自动建单率') && arch.includes('不是自动关闭率'), '90 percent metric rejects auto-create and auto-close interpretations');
check(arch.includes('base_service_ready') && arch.includes('ai_enhancement_ready'), 'readiness is split');
check(gateDoc.includes('DeepSeek Key 不存在') && gateDoc.includes('模型网络不可达'), 'AI-off failure conditions are required');

const lifecycle = read('docs/52_full_ticket_lifecycle_workbench_notifications.md');
for (const action of ['queue', 'accept', 'start', 'request-information', 'resume', 'wait-vendor', 'resolve', 'confirm', 'reopen', 'cancel', 'auto-close', 'add-note']) check(lifecycle.includes(action), 'Ticket action ' + action + ' is reused');
for (const boundary of ['Authentication', 'Authorization', 'If-Match / expected version', 'Idempotency-Key', 'TicketActionService', 'Ticket Event', 'Communication Outbox']) check(lifecycle.includes(boundary), 'write boundary includes ' + boundary);
check(lifecycle.includes('Conversation Assignment') && lifecycle.includes('Ticket Assignment'), 'dual responsibility is explicit');
check(lifecycle.includes('全部成功或全部失败'), 'compound command is atomic');
check(lifecycle.includes('opaque public ref') && lifecycle.includes('不作为主键'), 'Reporter Timeline access is safe');
check(lifecycle.includes('Ticket Event') && lifecycle.includes('Notification Policy') && lifecycle.includes('WeCom Sender'), 'notification chain is complete');

const incident = read('docs/53_human_confirmed_incident_before_ai.md');
for (const state of ['CANDIDATE', 'UNDER_REVIEW', 'CONFIRMED_LOCAL', 'CONFIRMED_CAMPUS', 'CONFIRMED_HOSPITAL_WIDE', 'INVESTIGATING', 'RESOLVED', 'CLOSED', 'REJECTED', 'UNLINKED']) check(incident.includes(state), 'Incident state ' + state + ' is frozen');
check(incident.includes('模型调用必须为 0') && incident.includes('一名用户恢复只更新其个人 Report/Subscription，不关闭共享 Incident'), 'Incident is human-confirmed and AI-independent');

const expectedFlags = [
  'RULE_FIRST_ORCHESTRATION_ENABLED', 'MANUAL_REVIEW_QUEUE_ENABLED',
  'TICKET_LIFECYCLE_WORKBENCH_ENABLED', 'REPORTER_TIMELINE_ENABLED',
  'WECOM_TEMPLATE_CARD_ENABLED', 'INCIDENT_CORRELATION_ENABLED',
];
const env = read('.env.example');
for (const flag of expectedFlags) {
  check(parallel.feature_flag_defaults[flag] === false, flag + ' defaults false in plan');
  check(new RegExp('^' + flag + '=false$', 'm').test(env), flag + ' defaults false in env example');
}
check(parallel.feature_flags_enabled.length === 0
  && Object.values(parallel.feature_flag_defaults).every((value) => value === false), 'all feature flags are false');

const requiredFiles = [
  'adr/0017_ai_optional_rule_first_service_loop.md',
  'architecture/rule_first_service_loop.mmd', 'architecture/deterministic_intake_sequence.mmd',
  'architecture/full_ticket_lifecycle.mmd', 'architecture/incident_human_confirmation.mmd',
  'docs/50_arch_006_ai_optional_rule_first_service_loop.md', 'docs/51_rule_first_intake_manual_review.md',
  'docs/52_full_ticket_lifecycle_workbench_notifications.md', 'docs/53_human_confirmed_incident_before_ai.md',
  'docs/54_p2_g2_deterministic_full_service_loop_gate.md',
  'tasks/ARCH-006_ai_optional_rule_first_service_loop.md',
  'tasks/P2-015_rule_first_intake_orchestration_manual_review.md',
  'tasks/P2-016_full_ticket_lifecycle_workbench_notifications.md',
  'evidence/arch-006-start-authorization.md', 'evidence/arch-006-capability-gap-inventory.md',
  'evidence/arch-006-capability-gap-inventory.json', 'evidence/arch-006-rule-first-service-loop-rebaseline-report.md',
];
for (const relativePath of requiredFiles) check(fs.existsSync(path.join(root, relativePath)), relativePath + ' exists');

const inventory = json('evidence/arch-006-capability-gap-inventory.json');
check(inventory.existing_capabilities.length === 9, 'inventory proves nine existing capabilities');
check(inventory.gaps.length === 13, 'inventory records thirteen required gaps');
check(inventory.runtime_changes === 0 && inventory.migration_changes === 0 && inventory.model_provider_calls === 0, 'inventory records zero Runtime Migration and model changes');

check(successor ? fs.existsSync(path.join(root, 'database/migrations/030_p2_015_rule_first_intake_orchestration.sql'))
  : !fs.existsSync(path.join(root, 'database/migrations/030_p2_015_rule_first_intake_orchestration.sql')), 'migration 030 presence matches P2-015 authorization');
check(!fs.existsSync(path.join(root, 'database/migrations/031_p2_016_ticket_workbench.sql')), 'migration 031 was not created');
check(p2016Authorized || !fs.existsSync(path.join(root,'database/migrations/031_p2_016_ticket_lifecycle_workbench_notifications.sql')), 'runtime migration 031 requires P2-016 authorization');

let changedPaths = [];
try {
  changedPaths = execFileSync('git', ['-c', 'safe.directory=D:/Projects/Fault-Reporting-WeCom-Assistant', '-c','core.safecrlf=false','diff', '--name-only', 'origin/main'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/u).filter(Boolean).map((value) => value.replaceAll('\\', '/'));
} catch {
  errors.push('unable to inspect changed paths against origin/main');
}
const p2016Seams=new Set(['src/p1-006-ticket-state-actions.mjs','src/p1-010-ticket-closure.mjs','src/p2-004-communication-delivery-worker.mjs',
  'src/p2-005-conversation-control.mjs','src/p2-006-workbench-http.mjs','src/p2-006-workbench-authorization.mjs']);
// These exact predecessor seams have separately recorded P2-G2 repair authorization.
const p2g2RepairSeams=new Set(['src/p1-004-service-intake.mjs','src/p2-006-workbench-command-facade.mjs','src/p2-007-rule-engine.mjs']);
const p2g2RepairAuthorized=p2g2Authorized&&['evidence/p2-g2-gold-repair-authorization.md',
  'evidence/p2-g2-direct-session-repair-authorization.md','evidence/p2-g2-continuing-gap-repair-authorization.md']
  .every(file=>fs.existsSync(path.join(root,file)));
const forbidden = changedPaths.filter((relativePath) => /^(?:database\/migrations\/(?:00[1-9]|01[0-2]|020|021|022)_|src\/p1-|src\/p2-004|src\/p2-005|src\/p2-006|src\/p2-007|web\/|archive\/|\.env\.pilot$)/u.test(relativePath)
  && !(p2016Authorized&&(p2016Seams.has(relativePath)||/^web\/p2-(?:workbench|reporter)\//u.test(relativePath)))
  && !(p2g2RepairAuthorized&&p2g2RepairSeams.has(relativePath)));
check(forbidden.length === 0, 'no forbidden Runtime Migration web archive or secret path changed');
const historicalEvidence=execFileSync('git',['-c','safe.directory=D:/Projects/Fault-Reporting-WeCom-Assistant','-c','core.safecrlf=false',
  'diff','--name-only','--diff-filter=MDR','origin/main','--','evidence'],{cwd:root,encoding:'utf8'}).split(/\r?\n/u).filter(Boolean);
check(historicalEvidence.length === 0, 'no historical Evidence was rewritten');

if (errors.length) {
  console.error(`ARCH-006 validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error('- ' + error);
  process.exitCode = 1;
} else {
  console.log(`ARCH-006 rule-first service loop validation passed (${checks} checks).`);
}
