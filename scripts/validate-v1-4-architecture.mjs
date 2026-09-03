import fs from 'node:fs';
import path from 'node:path';

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

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

const SOURCE_BASE = '1c18d5653b17e4368b5fa057d513e1af1a8b4622';
const P2_006_SOURCE_BASE = '6afe8157bfcae49d391d0f6e2aa5c60388377ea5';
const P2_005_SOURCE_BASE = '7e9a41498c471be4deca235439440ea7f157bdd4';
const P2_004_SOURCE_BASE = '2b4548888882ce895a85f513d0a5bb57d9920b91';
const P2_003_SOURCE_BASE = 'd59de5d7db39c4a39f82093496a0e42565d67a7e';
const AUTHORIZED_TASKS = Object.freeze(['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006']);
const AUTHORIZED_GATES = Object.freeze(['P2-G1']);
const LIFECYCLE_PROFILES = Object.freeze({
  P2_006_IN_PROGRESS: Object.freeze({
    lastCompletedTask: 'P2-005',
    lastCompletedGate: null,
    activeTask: 'P2-006',
    activeLane: 'P2-B',
    candidate: 'P2-006',
    candidateAuthorized: true,
    p2006Status: 'IN_PROGRESS',
    manifestStatus: 'P2_P2_006_IN_PROGRESS',
    projectStatus: 'p2_p2_006_in_progress',
  }),
  P2_006_DONE_AWAITING_P2_G1_ASSEMBLY_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: null,
    activeTask: null,
    activeLane: null,
    candidate: 'P2-G1',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    manifestStatus: 'P2_P2_006_DONE_AWAITING_P2_G1_ASSEMBLY_AUTHORIZATION',
    projectStatus: 'p2_p2_006_done_awaiting_p2_g1_assembly_authorization',
  }),
  P2_G1_ASSEMBLY_IN_PROGRESS: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: null,
    activeTask: 'P2-G1',
    activeLane: 'ASSEMBLY',
    candidate: 'P2-G1',
    candidateAuthorized: true,
    p2006Status: 'DONE',
    p2g1Status: 'IN_PROGRESS',
    manifestStatus: 'P2_P2_G1_ASSEMBLY_IN_PROGRESS',
    projectStatus: 'p2_p2_g1_assembly_in_progress',
  }),
  P2_G1_READY_FOR_LIVE_E2E: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: null,
    activeTask: 'P2-G1',
    activeLane: 'ASSEMBLY',
    candidate: 'P2-G1-LIVE',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    p2g1Status: 'READY_FOR_LIVE_E2E',
    manifestStatus: 'P2_P2_G1_READY_FOR_LIVE_E2E',
    projectStatus: 'p2_p2_g1_ready_for_live_e2e',
  }),
  P2_G1_PASSED_AWAITING_P2_007_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: 'P2-G1',
    activeTask: null,
    activeLane: null,
    candidate: 'P2-007',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    p2g1Status: 'PASSED',
    manifestStatus: 'P2_P2_G1_PASSED_AWAITING_P2_007_AUTHORIZATION',
    projectStatus: 'p2_p2_g1_passed_awaiting_p2_007_authorization',
  }),
  ARCH_005_AUTHORIZED_P2_007_BLOCKED: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: 'P2-G1',
    activeTask: 'ARCH-005',
    activeLane: 'ARCHITECTURE',
    candidate: 'P2-007',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    p2g1Status: 'PASSED',
    manifestStatus: 'P2_ARCH_005_IN_PROGRESS',
    projectStatus: 'p2_arch_005_in_progress',
  }),
});

const manifest = json('MANIFEST.json');
const current = json('plans/current_phase.json');
const backlog = json('plans/master_backlog.json');
const parallel = json('plans/parallel_workstreams.json');
const taskIndex = json('tasks/master_backlog.json');
const projectSummary = json('project_summary.json');
const pkg = json('package.json');
const sourceExample = json('config_examples/integration_source.example.json');

const lifecycleStatus = current.implementation_authorization_status;
const profile = LIFECYCLE_PROFILES[lifecycleStatus];
check(Boolean(profile), 'current phase uses a recognized P2/P2-G1 lifecycle profile');

if (profile) {
  const lifecycleViews = [
    {
      name: 'MANIFEST',
      lastCompletedTask: manifest.last_completed_task,
      lastCompletedGate: manifest.last_completed_gate,
      activeTask: manifest.active_task,
      activeLane: manifest.active_lane,
      authorizedTasks: manifest.authorized_tasks,
      authorizedGates: manifest.authorized_gates,
      implementationStatus: manifest.implementation_authorization_status,
      candidate: manifest.next_task_candidate,
      candidateAuthorized: manifest.next_task_authorized,
      p2g1: manifest.p2_g1_status,
    },
    {
      name: 'current phase',
      lastCompletedTask: current.last_completed_task,
      lastCompletedGate: current.last_completed_gate,
      activeTask: current.active_task,
      activeLane: current.active_lane,
      authorizedTasks: current.authorized_tasks,
      authorizedGates: current.authorized_gates,
      implementationStatus: current.implementation_authorization_status,
      candidate: current.next_task_candidate,
      candidateAuthorized: current.next_task_authorized,
      p2g1: current.p2_g1_status,
    },
    {
      name: 'master backlog',
      lastCompletedTask: backlog.last_completed_task,
      lastCompletedGate: backlog.last_completed_gate,
      activeTask: backlog.active_task,
      activeLane: backlog.active_lane,
      authorizedTasks: backlog.authorized_tasks,
      authorizedGates: backlog.authorized_gates,
      implementationStatus: backlog.implementation_authorization_status,
      candidate: backlog.next_task_candidate,
      candidateAuthorized: backlog.next_task_authorized,
      p2g1: backlog.p2_g1_status,
    },
    {
      name: 'parallel workstreams',
      lastCompletedTask: parallel.last_completed_task,
      lastCompletedGate: parallel.last_completed_gate,
      activeTask: parallel.active_task,
      activeLane: parallel.active_lane,
      authorizedTasks: parallel.authorized_tasks,
      authorizedGates: parallel.authorized_gates,
      implementationStatus: parallel.implementation_authorization_status,
      candidate: parallel.next_task_candidate,
      candidateAuthorized: parallel.next_task_authorized,
      p2g1: parallel.assembly_gates.find((gate) => gate.id === 'P2-G1')?.status,
    },
    {
      name: 'task index',
      lastCompletedTask: taskIndex.last_completed_task,
      lastCompletedGate: taskIndex.last_completed_gate,
      activeTask: taskIndex.active_task,
      activeLane: taskIndex.active_lane,
      authorizedTasks: taskIndex.authorized_tasks,
      authorizedGates: taskIndex.authorized_gates,
      implementationStatus: taskIndex.implementation_authorization_status,
      candidate: taskIndex.next_tasks?.candidate,
      candidateAuthorized: taskIndex.next_tasks?.candidate_authorized,
      p2g1: taskIndex.p2_g1_status,
    },
    {
      name: 'project summary',
      lastCompletedTask: projectSummary.project.last_completed_task,
      lastCompletedGate: projectSummary.project.last_completed_gate,
      activeTask: projectSummary.project.active_task,
      activeLane: projectSummary.project.active_lane,
      authorizedTasks: projectSummary.project.authorized_tasks,
      authorizedGates: projectSummary.project.authorized_gates,
      implementationStatus: projectSummary.project.implementation_authorization_status,
      candidate: projectSummary.project.next_task,
      candidateAuthorized: projectSummary.project.next_task_authorized,
      p2g1: projectSummary.project.p2_g1_status,
    },
  ];

  for (const view of lifecycleViews) {
    check(view.lastCompletedTask === profile.lastCompletedTask, view.name + ' has the profile last completed task');
    check(view.lastCompletedGate === profile.lastCompletedGate, view.name + ' has the profile last completed gate');
    check(view.activeTask === profile.activeTask, view.name + ' has the profile active task');
    check(view.activeLane === profile.activeLane, view.name + ' has the profile active lane');
    check(sameArray(view.authorizedTasks, AUTHORIZED_TASKS), view.name + ' has the exact authorized task set');
    check(sameArray(view.authorizedGates, AUTHORIZED_GATES), view.name + ' has the exact authorized gate set');
    check(view.lastCompletedTask === null || view.authorizedTasks.includes(view.lastCompletedTask), view.name + ' last completed task is authorized');
    check(view.lastCompletedGate === null || view.authorizedGates.includes(view.lastCompletedGate), view.name + ' last completed gate is authorized');
    check(view.implementationStatus === lifecycleStatus, view.name + ' has the selected lifecycle status');
    check(view.candidate === profile.candidate, view.name + ' has the profile next candidate');
    check(view.candidateAuthorized === profile.candidateAuthorized, view.name + ' has the profile candidate authorization');
    check(view.p2g1 === (profile.p2g1Status ?? 'NOT_STARTED'), view.name + ' has the profile P2-G1 status');
  }

  check(manifest.status === profile.manifestStatus, 'manifest status matches the lifecycle profile');
  check(projectSummary.project.status === profile.projectStatus, 'project status matches the lifecycle profile');
  check(taskIndex.next_tasks?.current === profile.activeTask, 'task index current task matches the lifecycle profile');
  check(current.next_phase_after_exit?.activation_status === lifecycleStatus, 'current phase activation status matches the lifecycle profile');
  const p2Summary = projectSummary.phase_model.find((phase) => phase.id === 'P2');
  check(p2Summary?.last_completed_task === profile.lastCompletedTask, 'project P2 summary has the profile last completed task');
  check(p2Summary?.last_completed_gate === profile.lastCompletedGate, 'project P2 summary has the profile last completed gate');
  if (profile.p2g1Status === 'PASSED') {
    check(current.next_task_candidate === 'P2-007' && current.next_task_authorized === false, 'P2-007 remains the unauthorized next task candidate');
  }
}

check(manifest.architecture_baseline === 'V1.4', 'manifest baseline is V1.4');
check(manifest.current_phase === 'P2', 'manifest records P2 current');
check(current.phase_id === 'P2' && current.status === 'IN_PROGRESS', 'current phase remains P2 IN_PROGRESS');
check(current.next_phase_authorized === true, 'P2 phase start remains authorized');
check(backlog.current_phase === 'P2', 'master backlog records P2 current');
check(taskIndex.current_phase === 'P2', 'task index records P2 current');
check(parallel.current_phase === 'P2', 'parallel workstreams record P2 current');
check(projectSummary.project.current_phase === 'P2', 'project summary records P2 current');
check(manifest.source_base_commit === SOURCE_BASE, 'manifest uses the frozen P2-G1 base commit');
check(current.source_base_commit === SOURCE_BASE, 'current phase uses the frozen P2-G1 base commit');
check(backlog.source_base_commit === SOURCE_BASE, 'master backlog uses the frozen P2-G1 base commit');

const p1 = backlog.phases.find((phase) => phase.id === 'P1');
const p2 = backlog.phases.find((phase) => phase.id === 'P2');
const p3 = backlog.phases.find((phase) => phase.id === 'P3');
const p10012 = backlog.tasks.find((task) => task.id === 'P1-012');
const p2001 = backlog.tasks.find((task) => task.id === 'P2-001');
const p2002 = backlog.tasks.find((task) => task.id === 'P2-002');
const p2003 = backlog.tasks.find((task) => task.id === 'P2-003');
const p2004 = backlog.tasks.find((task) => task.id === 'P2-004');
const p2005 = backlog.tasks.find((task) => task.id === 'P2-005');
const p2006 = backlog.tasks.find((task) => task.id === 'P2-006');

check(p1?.status === 'DONE' && p1?.go_decision === 'GO', 'P1 remains DONE with GO');
check(p10012?.status === 'DONE' && p10012?.decision === 'GO', 'P1-012 remains DONE with GO');
check(current.exit_decision?.phase_id === 'P1'
  && current.exit_decision?.decision === 'GO'
  && current.exit_decision?.completed_at === '2026-08-30'
  && current.exit_decision?.evidence === 'evidence/p1-012-project-owner-go-approval.md'
  && current.exit_decision?.blockers?.length === 0, 'P1 exit evidence remains preserved');
check(p2?.status === 'IN_PROGRESS', 'P2 remains IN_PROGRESS');
check(p2001?.status === 'DONE' && p2001?.evidence === 'evidence/p2-001-conversation-contracts-report.md', 'P2-001 remains DONE with evidence');
check(p2002?.status === 'DONE'
  && p2002?.authorization_evidence === 'evidence/p2-002-start-authorization.md'
  && p2002?.evidence === 'evidence/p2-002-timeline-projector-report.md', 'P2-002 remains DONE with evidence');
check(p2003?.status === 'DONE', 'P2-003 remains DONE');
check(p2003?.authorized_at === '2026-08-30'
  && p2003?.authorization_evidence === 'evidence/p2-003-start-authorization.md'
  && p2003?.task_file === 'tasks/P2-003_realtime_event_log_sse.md', 'P2-003 authorization metadata is linked');
check(p2004?.status === 'DONE', 'P2-004 remains DONE');
check(p2004?.authorized_at === '2026-08-31'
  && p2004?.authorization_evidence === 'evidence/p2-004-start-authorization.md'
  && p2004?.task_file === 'tasks/P2-004_unified_communication_outbox_delivery.md', 'P2-004 authorization metadata is linked');
check(p2005?.status === 'DONE', 'P2-005 remains DONE');
check(p2005?.authorized_at === '2026-08-31'
  && p2005?.authorization_evidence === 'evidence/p2-005-start-authorization.md'
  && p2005?.task_file === 'tasks/P2-005_assignment_handoff_read_cursor_generation_fence.md', 'P2-005 authorization metadata is linked');
check(p2006?.status === profile?.p2006Status, 'P2-006 task status matches the lifecycle profile');
check(p2006?.authorized_at === '2026-09-01'
  && p2006?.authorization_evidence === 'evidence/p2-006-start-authorization.md'
  && p2006?.task_file === 'tasks/P2-006_realtime_web_workbench_rest_authorization.md', 'P2-006 authorization metadata is linked');
check(backlog.tasks.filter((task) => task.phase === 'P2' && /^P2-(00[7-9]|01[0-4])$/u.test(task.id))
  .every((task) => task.status === 'TODO'), 'P2-007 through P2-014 remain TODO');
check(sameArray(backlog.tasks.filter((task) => task.status === 'IN_PROGRESS').map((task) => task.id),
  profile?.activeTask?.startsWith('P2-0') || profile?.activeTask?.startsWith('ARCH-') ? [profile.activeTask] : []), 'the exact IN_PROGRESS task set matches the lifecycle profile');
check(p3?.status === 'TODO', 'P3 remains TODO');
check(backlog.tasks.filter((task) => task.phase === 'P3').every((task) => task.status === 'TODO'), 'all P3 tasks remain TODO');

check(current.p2_003_authorized_at === '2026-08-30'
  && current.p2_003_authorization_evidence === 'evidence/p2-003-start-authorization.md', 'current phase links P2-003 authorization');
check(manifest.p2_003_authorized_at === '2026-08-30'
  && manifest.p2_003_authorization_evidence === 'evidence/p2-003-start-authorization.md', 'manifest links P2-003 authorization');
check(taskIndex.p2_003_authorized_at === '2026-08-30'
  && taskIndex.p2_003_authorization_evidence === 'evidence/p2-003-start-authorization.md', 'task index links P2-003 authorization');
check(projectSummary.project.p2_003_authorized_at === '2026-08-30'
  && projectSummary.project.p2_003_authorization_evidence === 'evidence/p2-003-start-authorization.md', 'project summary links P2-003 authorization');
check(current.p2_004_authorized_at === '2026-08-31'
  && current.p2_004_authorization_evidence === 'evidence/p2-004-start-authorization.md', 'current phase links P2-004 authorization');
check(manifest.p2_004_authorized_at === '2026-08-31'
  && manifest.p2_004_authorization_evidence === 'evidence/p2-004-start-authorization.md', 'manifest links P2-004 authorization');
check(taskIndex.p2_004_authorized_at === '2026-08-31'
  && taskIndex.p2_004_authorization_evidence === 'evidence/p2-004-start-authorization.md', 'task index links P2-004 authorization');
check(projectSummary.project.p2_004_authorized_at === '2026-08-31'
  && projectSummary.project.p2_004_authorization_evidence === 'evidence/p2-004-start-authorization.md', 'project summary links P2-004 authorization');
check(current.p2_005_authorized_at === '2026-08-31'
  && current.p2_005_authorization_evidence === 'evidence/p2-005-start-authorization.md', 'current phase links P2-005 authorization');
check(manifest.p2_005_authorized_at === '2026-08-31'
  && manifest.p2_005_authorization_evidence === 'evidence/p2-005-start-authorization.md', 'manifest links P2-005 authorization');
check(taskIndex.p2_005_authorized_at === '2026-08-31'
  && taskIndex.p2_005_authorization_evidence === 'evidence/p2-005-start-authorization.md', 'task index links P2-005 authorization');
check(projectSummary.project.p2_005_authorized_at === '2026-08-31'
  && projectSummary.project.p2_005_authorization_evidence === 'evidence/p2-005-start-authorization.md', 'project summary links P2-005 authorization');
check(current.p2_006_authorized_at === '2026-09-01'
  && current.p2_006_authorization_evidence === 'evidence/p2-006-start-authorization.md', 'current phase links P2-006 authorization');
check(manifest.p2_006_authorized_at === '2026-09-01'
  && manifest.p2_006_authorization_evidence === 'evidence/p2-006-start-authorization.md', 'manifest links P2-006 authorization');
check(taskIndex.p2_006_authorized_at === '2026-09-01'
  && taskIndex.p2_006_authorization_evidence === 'evidence/p2-006-start-authorization.md', 'task index links P2-006 authorization');
check(projectSummary.project.p2_006_authorized_at === '2026-09-01'
  && projectSummary.project.p2_006_authorization_evidence === 'evidence/p2-006-start-authorization.md', 'project summary links P2-006 authorization');

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
check(parallel.feature_flags_enabled?.length === 0, 'no P2 or P3 feature flag is enabled');
check(sameArray(Object.keys(parallel.feature_flag_defaults ?? {}), expectedFeatureFlags), 'feature flag inventory remains frozen');
check(Object.values(parallel.feature_flag_defaults ?? {}).every((value) => value === false), 'all feature flag defaults remain false');
check(parallel.assembly_gates.find((gate) => gate.id === 'P2-G1')?.status === (profile?.p2g1Status ?? 'NOT_STARTED'), 'P2-G1 gate matches the lifecycle profile');
check(parallel.assembly_gates.filter((gate) => gate.id !== 'P2-G1').every((gate) => gate.status === 'NOT_STARTED'), 'later assembly gates remain NOT_STARTED');
if (profile?.p2g1Status === 'PASSED') {
  const completionEvidence = 'evidence/p2-g1-project-owner-approval.md';
  const completionViews = [manifest, current, backlog, parallel, taskIndex, projectSummary.project];
  check(completionViews.every((view) => view.p2_g1_completed_at === '2026-09-02'), 'all lifecycle views record the P2-G1 completion date');
  check(completionViews.every((view) => view.p2_g1_completion_evidence === completionEvidence), 'all lifecycle views link the P2-G1 approval evidence');
  check(fs.existsSync(path.join(root, completionEvidence)), 'P2-G1 approval evidence exists');
  const approval = read(completionEvidence);
  check(approval.includes('决策：PASSED'), 'P2-G1 approval records PASSED');
  check(approval.includes('16a02a56e60bd3cdb845b069caa4e6847d3fff52'), 'P2-G1 approval identifies the live candidate');
  check(approval.includes('P2-007') && approval.includes('不授权'), 'P2-G1 approval preserves the P2-007 stop line');
}
check(sameArray(parallel.lanes.map((lane) => lane.id), ['P2-A', 'P2-B', 'P2-C', 'P2-D', 'P3-A', 'P3-B', 'P3-C', 'P3-D']), 'parallel lane inventory remains complete');

check(manifest.source_of_truth === 'Unified Ticket Core in this repository', 'manifest preserves Unified Ticket Core authority');
check(backlog.source_of_truth === 'Unified Ticket Core in this repository' && p2?.ticket_backend === 'Unified Ticket Core', 'backlog preserves Unified Ticket Core authority');
check(projectSummary.hard_invariants.includes('unified_ticket_core_is_long_term_source_of_truth'), 'project summary preserves Unified Ticket Core authority');
check(p3?.target_source_of_truth === 'Unified Ticket Core' && p3?.scope_mode === 'GREENFIELD_NO_HISTORICAL_TICKETS', 'P3 remains greenfield against Unified Ticket Core');
check(!Object.hasOwn(p3 ?? {}, 'legacy_source'), 'P3 has no legacy source');

const taskIds = new Set(backlog.tasks.map((task) => task.id));
for (let index = 1; index <= 14; index += 1) {
  check(taskIds.has('P2-' + String(index).padStart(3, '0')), 'backlog defines P2-' + String(index).padStart(3, '0'));
}
for (let index = 1; index <= 12; index += 1) {
  check(taskIds.has('P3-' + String(index).padStart(3, '0')), 'backlog defines P3-' + String(index).padStart(3, '0'));
}

const p3c = parallel.lanes.find((lane) => lane.id === 'P3-C');
check(p3c?.name === 'Intranet Source Adapters' && p3c?.branch === 'phase3/intranet-sources', 'P3-C remains the greenfield adapter lane');
check(!(p3c?.feature_flags ?? []).some((flag) => /LEGACY|HOSPITAL_TICKETS/u.test(flag)), 'P3-C has no legacy import flag');
check(parallel.assembly_gates.find((gate) => gate.id === 'P3-G2')?.name === 'First Intranet Source E2E', 'P3-G2 remains first source E2E');
check(parallel.assembly_gates.find((gate) => gate.id === 'P3-G4')?.name === 'First Production Source Onboarding and Phase 3 Go', 'P3-G4 remains first production source onboarding');

const canonicalFiles = [
  'README.md',
  'AGENTS.md',
  'docs/architecture_baseline_status.md',
  'plans/phase_3_unified_ticket_platform.md',
  'tickets/P3_unified_ticket_platform_tasks.md',
  'docs/35_unified_ticket_and_intranet_connectors.md',
  'docs/37_parallel_delivery_and_acceptance.md',
];
for (const relativePath of canonicalFiles) {
  const content = read(relativePath);
  check(content.includes('Unified Ticket Core'), relativePath + ' names Unified Ticket Core');
  check(!/SUPERSEDED_EXTERNAL_TARGET|SUPERSEDED_IMPORT_FLAG_REMOVED|SUPERSEDED_TARGET_FLAG_REMOVED/u.test(content), relativePath + ' has no placeholder legacy identifier');
}
check(!/历史|未完结|旧工单|冻结|退役|迁移批次|最终增量/u.test(
  backlog.tasks.filter((task) => task.phase === 'P3').map((task) => task.title).join('\n'),
), 'active P3 titles contain no historical-ticket work');

const env = read('.env.example');
for (const name of expectedFeatureFlags) {
  check(new RegExp('^' + name + '=false$', 'm').test(env), name + ' defaults false');
}
check(!/SUPERSEDED_IMPORT_FLAG_REMOVED|SUPERSEDED_TARGET_FLAG_REMOVED/u.test(env), 'environment example has no historical-ticket flag');

check(sourceExample.source_code === 'INTRANET_REPORT_PORTAL', 'source example is a new intranet portal');
check(sourceExample.capabilities.submit_service_requests === true, 'source example can submit new requests');
check(sourceExample.capabilities.own_ticket_state === false, 'source example cannot own ticket state');
check(!Object.hasOwn(sourceExample, 'cutover'), 'source example has no cutover section');

const conceptualSchema = read('database/schema_draft.sql');
check(conceptualSchema.includes('V1.4 CONCEPTUAL SCHEMA DRAFT'), 'conceptual schema is V1.4');
check(conceptualSchema.includes('greenfield sources only'), 'conceptual schema declares greenfield integration');
check(!/migration_batch_id|MIGRATION_BATCH|FINAL_CUTOVER|IMPORT_ONLY|IMPORT_AND_PROJECT|FILE_IMPORT/u.test(conceptualSchema), 'conceptual schema has no historical migration field');
check(!/CREATE TABLE IF NOT EXISTS\s+unified_ticket\.ticket/iu.test(conceptualSchema), 'conceptual schema does not create a second ticket core');

const conversationThreadSchema = json('contracts/conversation_thread.schema.json');
const conversationSessionSchema = json('contracts/conversation_session.schema.json');
const conversationItemSchema = json('contracts/conversation_item.schema.json');
check(sameArray(conversationThreadSchema['x-natural-identity'], ['provider', 'channel_account_id', 'chat_type', 'external_thread_key']), 'Thread natural identity remains frozen');
check(conversationSessionSchema.properties?.control_mode?.default === 'HUMAN', 'Session defaults to HUMAN');
check(conversationItemSchema['x-implementation-task'] === 'P2-002', 'Conversation Item persistence remains P2-002');

const p2002Files = [
  'contracts/conversation_projection_source.schema.json',
  'contracts/conversation_projection_checkpoint.schema.json',
  'contracts/conversation_projection_contracts.d.ts',
  'database/migrations/011_p2_002_timeline_projector.sql',
  'docs/38_p2_002_timeline_projector.md',
  'evidence/p2-002-timeline-projector-report.md',
  'scripts/p2-002-migrate.mjs',
  'scripts/p2-002-rebuild.mjs',
  'src/p2-002-timeline-projector.mjs',
  'tests/helpers/p2-002-postgres-harness.mjs',
  'tests/p2-002-timeline-projector.test.mjs',
  'tests/p2-002-timeline-projector.integration.test.mjs',
];
for (const relativePath of p2002Files) {
  check(fs.existsSync(path.join(root, relativePath)), relativePath + ' remains present for P2-002');
}

check(fs.existsSync(path.join(root, 'tasks/P2-003_realtime_event_log_sse.md')), 'P2-003 task record exists');
check(fs.existsSync(path.join(root, 'evidence/p2-003-start-authorization.md')), 'P2-003 authorization evidence exists');
const p2003Authorization = read('evidence/p2-003-start-authorization.md');
check(p2003Authorization.includes('项目负责人正式、独立授权启动 P2-003。完成 P2-003 后必须停止。'), 'P2-003 authorization has the exact completion stop line');
check(p2003Authorization.includes('P2-004 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。'), 'P2-003 authorization has the exact next-task and gate stop line');
check(p2003Authorization.includes(P2_003_SOURCE_BASE), 'P2-003 authorization names the exact frozen base');
check(p2003Authorization.includes('所有 P2/P3 Feature Flag 继续为') && p2003Authorization.includes('false'), 'P2-003 authorization keeps all feature flags false');
check(fs.existsSync(path.join(root, 'tasks/P2-004_unified_communication_outbox_delivery.md')), 'P2-004 task record exists');
check(fs.existsSync(path.join(root, 'evidence/p2-004-start-authorization.md')), 'P2-004 authorization evidence exists');
const p2004Authorization = read('evidence/p2-004-start-authorization.md');
check(p2004Authorization.includes('项目负责人正式、独立授权启动 P2-004。完成 P2-004 后必须停止。'), 'P2-004 authorization has the exact completion stop line');
check(p2004Authorization.includes('P2-005 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。'), 'P2-004 authorization has the exact next-task and gate stop line');
check(p2004Authorization.includes(P2_004_SOURCE_BASE), 'P2-004 authorization names the exact frozen base');
check(p2004Authorization.includes('所有 P2/P3 Feature Flag 继续为') && p2004Authorization.includes('false'), 'P2-004 authorization keeps all feature flags false');
check(fs.existsSync(path.join(root, 'tasks/P2-005_assignment_handoff_read_cursor_generation_fence.md')), 'P2-005 task record exists');
check(fs.existsSync(path.join(root, 'evidence/p2-005-start-authorization.md')), 'P2-005 authorization evidence exists');
const p2005Authorization = read('evidence/p2-005-start-authorization.md');
check(p2005Authorization.includes('项目负责人正式、独立授权启动 P2-005。'), 'P2-005 authorization has the exact start line');
check(p2005Authorization.includes('完成 P2-005 后必须停止。'), 'P2-005 authorization has the exact completion stop line');
check(p2005Authorization.includes('P2-006、P2-G1 和后续生产功能仍须另行授权。'), 'P2-005 authorization has the exact next-task and gate stop line');
check(p2005Authorization.includes(P2_005_SOURCE_BASE), 'P2-005 authorization names the exact frozen base');
check(p2005Authorization.includes('所有 P2/P3 Feature Flag 继续为') && p2005Authorization.includes('false'), 'P2-005 authorization keeps all feature flags false');
check(fs.existsSync(path.join(root, 'evidence/p2-006-start-authorization.md')), 'P2-006 authorization evidence exists');
const p2006Authorization = read('evidence/p2-006-start-authorization.md');
check(p2006Authorization.includes('项目负责人正式、独立授权启动 P2-006。'), 'P2-006 authorization has the exact start line');
check(p2006Authorization.includes('完成 P2-006 后必须停止。'), 'P2-006 authorization has the exact completion stop line');
check(p2006Authorization.includes('P2-G1 组装、P2-007 及以后任务和所有生产功能仍须另行授权。'), 'P2-006 authorization has the exact next-task and gate stop line');
check(p2006Authorization.includes(P2_006_SOURCE_BASE), 'P2-006 authorization names the exact frozen base');
check(fs.existsSync(path.join(root, 'tasks/P2-006_realtime_web_workbench_rest_authorization.md')), 'P2-006 task record exists');

const p1Approval = read('evidence/p1-012-project-owner-go-approval.md');
check(p1Approval.includes('“我批准了”'), 'P1 owner approval remains preserved');
check(p1Approval.includes('P2') && p1Approval.includes('单独授权'), 'P1 approval itself did not start P2');
const p2Authorization = read('evidence/p2-phase-start-authorization.md');
check(p2Authorization.includes('项目负责人正式授权启动 Phase 2，但本轮仅授权 ARCH-004 和 P2-001'), 'Phase 2 authorization remains preserved');
const p2002Authorization = read('evidence/p2-002-start-authorization.md');
check(p2002Authorization.includes('项目负责人正式、独立授权启动 P2-002'), 'P2-002 authorization remains preserved');

check(pkg.scripts['validate:architecture:v1.4'] === 'node scripts/validate-v1-4-architecture.mjs', 'package exposes V1.4 validator');
check(pkg.scripts['test:architecture:v1.4'] === 'node --test tests/v1-4-architecture-baseline.test.mjs', 'package exposes V1.4 architecture tests');
check(pkg.scripts['test:p2:001'] === 'node --test tests/p2-001-conversation-contracts.test.mjs', 'package preserves P2-001 unit tests');
check(pkg.scripts['test:p2:002'] === 'node --test tests/p2-002-timeline-projector.test.mjs', 'package preserves P2-002 unit tests');
check(pkg.dependencies['@wecom/aibot-node-sdk'] === '1.0.6', 'WeCom SDK remains pinned');
check(pkg.dependencies.pg === '8.23.0', 'pg remains pinned');

const p2003CompletionDate = current.p2_003_completed_at;
const p2003CompletionEvidence = 'evidence/p2-003-realtime-event-log-sse-report.md';
check(isIsoDate(p2003CompletionDate), 'P2-003 completion date is ISO formatted');
check(current.p2_003_completion_evidence === p2003CompletionEvidence, 'current phase links P2-003 completion evidence');
check(manifest.p2_003_completed_at === p2003CompletionDate && manifest.p2_003_completion_evidence === p2003CompletionEvidence, 'manifest mirrors P2-003 completion metadata');
check(taskIndex.p2_003_completed_at === p2003CompletionDate && taskIndex.p2_003_completion_evidence === p2003CompletionEvidence, 'task index mirrors P2-003 completion metadata');
check(projectSummary.project.p2_003_completed_at === p2003CompletionDate && projectSummary.project.p2_003_completion_evidence === p2003CompletionEvidence, 'project summary mirrors P2-003 completion metadata');
check(p2003?.completed_at === p2003CompletionDate && p2003?.evidence === p2003CompletionEvidence, 'master backlog mirrors P2-003 completion metadata');
check(projectSummary.hard_invariants.includes('realtime_event_log_is_non_authoritative'), 'project summary declares Realtime Event Log non-authoritative');

const p2003Files = [
    'contracts/conversation_realtime_event.schema.json',
    'contracts/conversation_realtime_fallback.schema.json',
    'contracts/conversation_realtime_contracts.d.ts',
    'database/migrations/012_p2_003_realtime_event_log.sql',
    'scripts/p2-003-migrate.mjs',
    'scripts/p2-003-retention.mjs',
    'src/p2-003-realtime-event-log.mjs',
    'src/p2-003-realtime-sse.mjs',
    'docs/39_p2_003_realtime_event_log_sse.md',
    'evidence/p2-003-realtime-event-log-sse-report.md',
    'tests/p2-003-realtime-event-log.test.mjs',
    'tests/p2-003-realtime-event-log.integration.test.mjs',
];
for (const relativePath of p2003Files) {
  check(fs.existsSync(path.join(root, relativePath)), relativePath + ' exists for P2-003 completion');
}
check(pkg.scripts['p2:003:migrate'] === 'node --env-file=.env.pilot scripts/p2-003-migrate.mjs', 'package exposes migration 012 command');
check(pkg.scripts['p2:003:retention:check'] === 'node --env-file=.env.pilot scripts/p2-003-retention.mjs --check', 'package exposes retention check command');
check(pkg.scripts['test:p2:003'] === 'node --test tests/p2-003-realtime-event-log.test.mjs', 'package exposes P2-003 unit tests');
check(pkg.scripts['test:p2:003:integration'] === 'node --env-file=.env.pilot --test --test-concurrency=1 tests/p2-003-realtime-event-log.integration.test.mjs', 'package exposes serial P2-003 integration tests');

{
  const completionDate = current.p2_004_completed_at;
  const completionEvidence = 'evidence/p2-004-communication-outbox-delivery-report.md';
  check(isIsoDate(completionDate), 'P2-004 completion date is ISO formatted');
  check(current.p2_004_completion_evidence === completionEvidence, 'current phase links P2-004 completion evidence');
  check(manifest.p2_004_completed_at === completionDate && manifest.p2_004_completion_evidence === completionEvidence, 'manifest mirrors P2-004 completion metadata');
  check(taskIndex.p2_004_completed_at === completionDate && taskIndex.p2_004_completion_evidence === completionEvidence, 'task index mirrors P2-004 completion metadata');
  check(projectSummary.project.p2_004_completed_at === completionDate && projectSummary.project.p2_004_completion_evidence === completionEvidence, 'project summary mirrors P2-004 completion metadata');
  check(p2004?.completed_at === completionDate && p2004?.evidence === completionEvidence, 'master backlog mirrors P2-004 completion metadata');
  for (const relativePath of [
    'contracts/communication_message.schema.json',
    'contracts/communication_delivery.schema.json',
    'contracts/communication_internal_note_command.schema.json',
    'contracts/communication_system_notification.schema.json',
    'contracts/communication_contracts.d.ts',
    'database/migrations/020_p2_004_unified_communication.sql',
    'docs/40_p2_004_unified_communication.md',
    'scripts/p2-004-migrate.mjs',
    'src/p2-004-communication-core.mjs',
    'src/p2-004-communication-delivery-worker.mjs',
    'src/p2-004-communication-projections.mjs',
    'src/p2-004-communication-sender-port.mjs',
    'tests/p2-004-communication-core.test.mjs',
    'tests/p2-004-communication-core.integration.test.mjs',
    completionEvidence,
  ]) check(fs.existsSync(path.join(root, relativePath)), relativePath + ' exists for P2-004 completion');
  check(pkg.scripts['p2:004:migrate'] === 'node --env-file=.env.pilot scripts/p2-004-migrate.mjs', 'package exposes migration 020 command');
  check(pkg.scripts['p2:004:migrate:check'] === 'node --env-file=.env.pilot scripts/p2-004-migrate.mjs --check', 'package exposes migration 020 check command');
  check(pkg.scripts['test:p2:004'] === 'node --test tests/p2-004-communication-core.test.mjs', 'package exposes P2-004 unit tests');
  check(pkg.scripts['test:p2:004:integration'] === 'node --env-file=.env.pilot --test --test-concurrency=1 tests/p2-004-communication-core.integration.test.mjs', 'package exposes serial P2-004 integration tests');
  const communicationMigration = read('database/migrations/020_p2_004_unified_communication.sql');
  check((communicationMigration.match(/CREATE TABLE IF NOT EXISTS\s+communication\./giu) ?? []).length === 4, 'migration 020 creates exactly four communication tables');
  check(!/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s+(?:TABLE\s+)?notification\./iu.test(communicationMigration), 'migration 020 never mutates notification facts');
}

for (const relativePath of [
  'contracts/conversation_assignment.schema.json',
  'contracts/conversation_handoff.schema.json',
  'contracts/conversation_read_cursor.schema.json',
  'contracts/conversation_control_command.schema.json',
  'contracts/conversation_generation_fence.schema.json',
  'contracts/conversation_control_contracts.d.ts',
  'database/migrations/021_p2_005_conversation_control.sql',
  'docs/41_p2_005_assignment_handoff_generation_fence.md',
  'scripts/p2-005-migrate.mjs',
  'src/p2-005-conversation-control.mjs',
  'src/p2-005-conversation-control-projections.mjs',
  'tests/p2-005-conversation-control.test.mjs',
  'tests/p2-005-conversation-control.integration.test.mjs',
]) check(fs.existsSync(path.join(root, relativePath)), relativePath + ' exists for P2-005');
check(pkg.scripts['p2:005:migrate'] === 'node --env-file=.env.pilot scripts/p2-005-migrate.mjs', 'package exposes migration 021 command');
check(pkg.scripts['p2:005:migrate:check'] === 'node --env-file=.env.pilot scripts/p2-005-migrate.mjs --check', 'package exposes migration 021 check command');
check(pkg.scripts['test:p2:005'] === 'node --test tests/p2-005-conversation-control.test.mjs', 'package exposes P2-005 unit tests');
check(pkg.scripts['test:p2:005:integration'] === 'node --env-file=.env.pilot --test --test-concurrency=1 tests/p2-005-conversation-control.integration.test.mjs', 'package exposes serial P2-005 integration tests');
const controlMigration = read('database/migrations/021_p2_005_conversation_control.sql');
check((controlMigration.match(/CREATE TABLE IF NOT EXISTS\s+conversation\./giu) ?? []).length === 4, 'migration 021 creates exactly four conversation control tables');
check(!/ALTER\s+TABLE\s+conversation\.session/iu.test(controlMigration), 'migration 021 does not alter conversation.session');
check(sameArray([...controlMigration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+\.[a-z_]+)/giu)].map((match) => match[1]), [
  'conversation.assignment', 'conversation.handoff', 'conversation.read_cursor', 'conversation.control_event',
]), 'migration 021 creates only the four frozen control tables');

if (profile?.p2006Status === 'DONE') {
  const completionDate = current.p2_006_completed_at;
  const completionEvidence = 'evidence/p2-006-realtime-workbench-report.md';
  check(isIsoDate(completionDate), 'P2-006 completion date is ISO formatted');
  check(current.p2_006_completion_evidence === completionEvidence, 'current phase links P2-006 completion evidence');
  check(manifest.p2_006_completed_at === completionDate && manifest.p2_006_completion_evidence === completionEvidence, 'manifest mirrors P2-006 completion metadata');
  check(taskIndex.p2_006_completed_at === completionDate && taskIndex.p2_006_completion_evidence === completionEvidence, 'task index mirrors P2-006 completion metadata');
  check(projectSummary.project.p2_006_completed_at === completionDate && projectSummary.project.p2_006_completion_evidence === completionEvidence, 'project summary mirrors P2-006 completion metadata');
  check(p2006?.completed_at === completionDate && p2006?.evidence === completionEvidence, 'master backlog mirrors P2-006 completion metadata');
  check(fs.existsSync(path.join(root, completionEvidence)), 'P2-006 completion evidence exists');
  for (const relativePath of [
    'docs/42_p2_006_realtime_web_workbench.md', 'src/p2-006-workbench-query.mjs',
    'src/p2-006-workbench-authorization.mjs', 'src/p2-006-workbench-command-facade.mjs',
    'src/p2-006-workbench-delivery-control.mjs', 'src/p2-006-workbench-http.mjs',
    'src/p2-006-workbench-static.mjs', 'web/p2-workbench/index.html',
    'tests/p2-006-workbench.test.mjs', 'tests/p2-006-workbench.integration.test.mjs',
    'tests/p2-006-workbench-browser.test.mjs',
  ]) check(fs.existsSync(path.join(root, relativePath)), relativePath + ' exists for P2-006');
  check(!fs.existsSync(path.join(root, 'database/migrations/022_p2_006_realtime_workbench.sql')), 'P2-006 creates no migration 022');
  check(pkg.scripts['test:p2:006'] === 'node --test tests/p2-006-workbench.test.mjs', 'package exposes P2-006 unit tests');
  check(pkg.scripts['test:p2:006:integration'] === 'node --env-file=.env.pilot --test --test-concurrency=1 tests/p2-006-workbench.integration.test.mjs', 'package exposes P2-006 integration tests');
  check(pkg.scripts['test:p2:006:browser'] === 'node --test tests/p2-006-workbench-browser.test.mjs', 'package exposes real browser tests');
}

if (errors.length > 0) {
  console.error('V1.4 architecture validation failed with ' + errors.length + ' error(s):');
  for (const error of errors) console.error('- ' + error);
  process.exitCode = 1;
} else {
  console.log('V1.4 architecture validation passed (' + checks + ' checks).');
}
