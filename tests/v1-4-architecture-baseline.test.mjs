import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const root = process.cwd();
const json = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const text = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const profiles = Object.freeze({
  P2_006_IN_PROGRESS: Object.freeze({
    lastCompletedTask: 'P2-005',
    lastCompletedGate: null,
    activeTask: 'P2-006',
    activeLane: 'P2-B',
    candidate: 'P2-006',
    candidateAuthorized: true,
    p2006Status: 'IN_PROGRESS',
  }),
  P2_006_DONE_AWAITING_P2_G1_ASSEMBLY_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: null,
    activeTask: null,
    activeLane: null,
    candidate: 'P2-G1',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    p2g1Status: 'NOT_STARTED',
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
  }),
  ARCH_005_READY_FOR_TARGETED_LIVE_REVALIDATION_P2_007_BLOCKED: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: 'P2-G1',
    activeTask: 'ARCH-005',
    activeLane: 'ARCHITECTURE',
    candidate: 'P2-007',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    p2g1Status: 'PASSED',
    activeTaskStatus: 'READY_FOR_TARGETED_LIVE_REVALIDATION',
  }),
  ARCH_005_COMPLETED_P2_007_REQUIRES_SEPARATE_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-006',
    lastCompletedGate: 'P2-G1',
    lastCompletedArchitectureTask: 'ARCH-005',
    activeTask: null,
    activeLane: null,
    candidate: 'P2-007',
    candidateAuthorized: false,
    p2006Status: 'DONE',
    p2g1Status: 'PASSED',
  }),
  P2_007_DONE_AWAITING_SEPARATE_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-007',
    lastCompletedGate: 'P2-G1',
    lastCompletedArchitectureTask: 'ARCH-005',
    activeTask: null,
    activeLane: null,
    candidate: 'P2-008',
    candidateAuthorized: false,
    authorizedTasks: Object.freeze(['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006', 'P2-007']),
    p2006Status: 'DONE',
    p2007Status: 'DONE',
    p2g1Status: 'PASSED',
  }),
  ARCH_006_DONE_AWAITING_P2_015_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-007',
    lastCompletedGate: 'P2-G1',
    lastCompletedArchitectureTask: 'ARCH-006',
    activeTask: null,
    activeLane: null,
    candidate: 'P2-015',
    candidateAuthorized: false,
    authorizedTasks: Object.freeze(['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006', 'P2-007']),
    p2006Status: 'DONE',
    p2007Status: 'DONE',
    p2g1Status: 'PASSED',
  }),
  P2_015_AUTHORIZED: Object.freeze({
    lastCompletedTask: 'P2-007',
    lastCompletedGate: 'P2-G1',
    lastCompletedArchitectureTask: 'ARCH-006',
    activeTask: 'P2-015',
    activeLane: 'P2-C',
    candidate: 'P2-015',
    candidateAuthorized: true,
    authorizedTasks: Object.freeze(['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006', 'P2-007', 'P2-015']),
    p2006Status: 'DONE',
    p2007Status: 'DONE',
    activeTaskStatus: 'AUTHORIZED',
    p2g1Status: 'PASSED',
  }),
  P2_015_DONE_AWAITING_P2_016_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-015',
    lastCompletedGate: 'P2-G1',
    lastCompletedArchitectureTask: 'ARCH-006',
    activeTask: null,
    activeLane: null,
    candidate: 'P2-016',
    candidateAuthorized: false,
    authorizedTasks: Object.freeze(['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006', 'P2-007', 'P2-015']),
    p2006Status: 'DONE',
    p2007Status: 'DONE',
    p2g1Status: 'PASSED',
  }),
  P2_016_AUTHORIZED: Object.freeze({
    lastCompletedTask: 'P2-015',
    lastCompletedGate: 'P2-G1',
    lastCompletedArchitectureTask: 'ARCH-006',
    activeTask: 'P2-016',
    activeLane: 'P2-B',
    candidate: 'P2-016',
    candidateAuthorized: true,
    authorizedTasks: Object.freeze(['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006', 'P2-007', 'P2-015', 'P2-016']),
    p2006Status: 'DONE',
    p2007Status: 'DONE',
    activeTaskStatus: 'AUTHORIZED',
    p2g1Status: 'PASSED',
  }),
});

test('V1.4 architecture validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-v1-4-architecture.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});

test('P2/P2-G1 lifecycle state is internally consistent without changing P1', () => {
  const manifest = json('MANIFEST.json');
  const current = json('plans/current_phase.json');
  const backlog = json('plans/master_backlog.json');
  const parallel = json('plans/parallel_workstreams.json');
  const taskIndex = json('tasks/master_backlog.json');
  const projectSummary = json('project_summary.json');
  const status = current.implementation_authorization_status;
  const profile = profiles[status];

  assert.ok(profile, 'recognized lifecycle profile');
  assert.equal(current.phase_id, 'P2');
  assert.equal(current.status, 'IN_PROGRESS');
  assert.equal(backlog.phases.find((phase) => phase.id === 'P1').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P1-012').status, 'DONE');
  assert.equal(current.exit_decision.decision, 'GO');
  assert.equal(backlog.phases.find((phase) => phase.id === 'P2').status, 'IN_PROGRESS');

  const views = [
    [manifest.last_completed_task, manifest.last_completed_gate, manifest.active_task, manifest.active_lane,
      manifest.next_task_candidate, manifest.next_task_authorized, manifest.authorized_tasks, manifest.authorized_gates],
    [current.last_completed_task, current.last_completed_gate, current.active_task, current.active_lane,
      current.next_task_candidate, current.next_task_authorized, current.authorized_tasks, current.authorized_gates],
    [backlog.last_completed_task, backlog.last_completed_gate, backlog.active_task, backlog.active_lane,
      backlog.next_task_candidate, backlog.next_task_authorized, backlog.authorized_tasks, backlog.authorized_gates],
    [parallel.last_completed_task, parallel.last_completed_gate, parallel.active_task, parallel.active_lane,
      parallel.next_task_candidate, parallel.next_task_authorized, parallel.authorized_tasks, parallel.authorized_gates],
    [taskIndex.last_completed_task, taskIndex.last_completed_gate, taskIndex.active_task, taskIndex.active_lane,
      taskIndex.next_tasks.candidate, taskIndex.next_tasks.candidate_authorized, taskIndex.authorized_tasks, taskIndex.authorized_gates],
    [projectSummary.project.last_completed_task, projectSummary.project.last_completed_gate, projectSummary.project.active_task,
      projectSummary.project.active_lane, projectSummary.project.next_task,
      projectSummary.project.next_task_authorized, projectSummary.project.authorized_tasks, projectSummary.project.authorized_gates],
  ];
  for (const [lastTask, lastGate, active, lane, candidate, authorized, tasks, gates] of views) {
    assert.equal(lastTask, profile.lastCompletedTask);
    assert.equal(lastGate, profile.lastCompletedGate);
    assert.equal(active, profile.activeTask);
    assert.equal(lane, profile.activeLane);
    assert.equal(candidate, profile.candidate);
    assert.equal(authorized, profile.candidateAuthorized);
    assert.deepEqual(tasks, profile.authorizedTasks ?? ['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005', 'P2-006']);
    assert.deepEqual(gates, ['P2-G1']);
    assert.equal(tasks.includes(lastTask), true);
    assert.equal(gates.includes(lastGate), profile.lastCompletedGate !== null);
  }

  const p2Summary = projectSummary.phase_model.find((phase) => phase.id === 'P2');
  assert.equal(p2Summary.last_completed_task, profile.lastCompletedTask);
  assert.equal(p2Summary.last_completed_gate, profile.lastCompletedGate);
  if (Object.hasOwn(profile, 'lastCompletedArchitectureTask')) {
    assert.equal(manifest.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(current.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(backlog.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(parallel.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(taskIndex.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(projectSummary.project.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(p2Summary.last_completed_architecture_task, profile.lastCompletedArchitectureTask);
    assert.equal(fs.existsSync(path.join(root, 'evidence/arch-005-targeted-live-revalidation.md')), true);
    if (profile.lastCompletedArchitectureTask === 'ARCH-006') {
      assert.equal(fs.existsSync(path.join(root, 'evidence/arch-006-rule-first-service-loop-rebaseline-report.md')), true);
      for (const view of [manifest, current, backlog, parallel, taskIndex, projectSummary.project]) {
        assert.equal(view.arch_006_status, 'DONE');
        assert.equal(view.arch_006_completion_evidence, 'evidence/arch-006-rule-first-service-loop-rebaseline-report.md');
      }
    }
  }
  if (profile.p2g1Status === 'PASSED') {
    assert.equal(current.next_task_candidate, profile.candidate);
    assert.equal(current.next_task_authorized, profile.candidateAuthorized);
  }

  assert.equal(backlog.tasks.find((task) => task.id === 'P2-001').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-002').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-003').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-004').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-005').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-006').status, profile.p2006Status);
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-007').status, profile.p2007Status ?? 'TODO');
  assert.equal(backlog.tasks.filter((task) => task.phase === 'P2' && /^P2-(00[8-9]|01[0-4])$/u.test(task.id))
    .every((task) => task.status === 'TODO'), true);
  assert.deepEqual(
    backlog.tasks.filter((task) => task.status === (profile.activeTaskStatus ?? 'IN_PROGRESS')).map((task) => task.id),
    profile.activeTask?.startsWith('P2-0') || profile.activeTask?.startsWith('ARCH-') ? [profile.activeTask] : [],
  );
  assert.equal(backlog.tasks.filter((task) => task.phase === 'P3').every((task) => task.status === 'TODO'), true);
  if (profile.lastCompletedArchitectureTask === 'ARCH-006') {
    assert.equal(backlog.tasks.find((task) => task.id === 'P2-015').status,
      status === 'P2_015_AUTHORIZED' ? 'AUTHORIZED' : profile.lastCompletedTask === 'P2-015' ? 'DONE' : 'TODO');
    if (status === 'P2_015_AUTHORIZED' || profile.lastCompletedTask === 'P2-015') {
      const done = profile.lastCompletedTask === 'P2-015';
      assert.equal(fs.existsSync(path.join(root, 'evidence/p2-015-start-authorization.md')), true);
      for (const view of [manifest, current, backlog, parallel, taskIndex, projectSummary.project]) {
        assert.equal(view.p2_015_status, done ? 'DONE' : 'AUTHORIZED');
        assert.equal(view.p2_015_authorization_evidence, 'evidence/p2-015-start-authorization.md');
        if (done) assert.equal(view.p2_015_completion_evidence, 'evidence/p2-015-rule-first-intake-orchestration-report.md');
      }
    }
    assert.equal(backlog.tasks.find((task) => task.id === 'P2-016').status, status === 'P2_016_AUTHORIZED' ? 'AUTHORIZED' : 'TODO');
    assert.equal(backlog.tasks.find((task) => task.id === 'P2-012').authorization_status, 'REQUIRES_SEPARATE_AUTHORIZATION');
    assert.equal(backlog.tasks.find((task) => task.id === 'P2-008').authorization_status, 'BLOCKED_BY_P2_G2');
    assert.deepEqual(parallel.assembly_gates.filter((gate) => gate.id.startsWith('P2-')).map((gate) => gate.id),
      ['P2-G1', 'P2-G2', 'P2-G3', 'P2-G4', 'P2-G5']);
  }
  assert.equal(parallel.assembly_gates.find((gate) => gate.id === 'P2-G1').status, profile.p2g1Status ?? 'NOT_STARTED');
  assert.equal(parallel.assembly_gates.filter((gate) => gate.id !== 'P2-G1').every((gate) => gate.status === 'NOT_STARTED'), true);
  assert.deepEqual(parallel.feature_flags_enabled, []);
  assert.equal(Object.values(parallel.feature_flag_defaults).every((value) => value === false), true);
  if (profile.p2g1Status === 'PASSED') {
    const approvalPath = 'evidence/p2-g1-project-owner-approval.md';
    assert.equal(fs.existsSync(path.join(root, approvalPath)), true);
    const approval = text(approvalPath);
    assert.match(approval, /决策：PASSED/u);
    assert.match(approval, /不授权：/u);
    assert.match(approval, /P2-007 或 P2-G2/u);
  }
});

test('P2-004 independent authorization and stop line are preserved', () => {
  const authorization = text('evidence/p2-004-start-authorization.md');
  assert.match(authorization, /项目负责人正式、独立授权启动 P2-004。完成 P2-004 后必须停止。/u);
  assert.match(authorization, /P2-005 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。/u);
  assert.match(authorization, /2b4548888882ce895a85f513d0a5bb57d9920b91/u);
  assert.match(authorization, /所有 P2\/P3 Feature Flag 继续为/u);
  assert.equal(fs.existsSync(path.join(root, 'tasks/P2-004_unified_communication_outbox_delivery.md')), true);
});

test('P2-005 independent authorization and stop line are recorded', () => {
  const authorization = text('evidence/p2-005-start-authorization.md');
  assert.match(authorization, /项目负责人正式、独立授权启动 P2-005。/u);
  assert.match(authorization, /完成 P2-005 后必须停止。/u);
  assert.match(authorization, /P2-006、P2-G1 和后续生产功能仍须另行授权。/u);
  assert.match(authorization, /7e9a41498c471be4deca235439440ea7f157bdd4/u);
  assert.equal(fs.existsSync(path.join(root, 'tasks/P2-005_assignment_handoff_read_cursor_generation_fence.md')), true);
});

test('P2-006 independent authorization and stop line are recorded', () => {
  const authorization = text('evidence/p2-006-start-authorization.md');
  assert.match(authorization, /项目负责人正式、独立授权启动 P2-006。/u);
  assert.match(authorization, /完成 P2-006 后必须停止。/u);
  assert.match(authorization, /P2-G1 组装、P2-007 及以后任务和所有生产功能仍须另行授权。/u);
  assert.match(authorization, /6afe8157bfcae49d391d0f6e2aa5c60388377ea5/u);
  assert.equal(fs.existsSync(path.join(root, 'tasks/P2-006_realtime_web_workbench_rest_authorization.md')), true);
});

test('P2-004 completion artifacts preserve P1 notification and Ticket ownership', () => {
  for (const relativePath of [
    'contracts/communication_message.schema.json',
    'contracts/communication_delivery.schema.json',
    'database/migrations/020_p2_004_unified_communication.sql',
    'src/p2-004-communication-core.mjs',
    'src/p2-004-communication-delivery-worker.mjs',
    'src/p2-004-communication-projections.mjs',
    'src/p2-004-communication-sender-port.mjs',
    'evidence/p2-004-communication-outbox-delivery-report.md',
  ]) assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  const migration = text('database/migrations/020_p2_004_unified_communication.sql');
  assert.equal((migration.match(/CREATE TABLE IF NOT EXISTS\s+communication\./giu) ?? []).length, 4);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s+(?:TABLE\s+)?notification\./iu);
  assert.match(text('docs/40_p2_004_unified_communication.md'), /Unified Ticket Core/u);
});

test('P2-005 completion artifacts preserve frozen Session and identity ownership', () => {
  const current = json('plans/current_phase.json');
  if (!current.implementation_authorization_status.startsWith('P2_006_') && !current.implementation_authorization_status.startsWith('P2_G1_')) return;
  for (const relativePath of [
    'contracts/conversation_assignment.schema.json',
    'contracts/conversation_handoff.schema.json',
    'contracts/conversation_read_cursor.schema.json',
    'contracts/conversation_control_command.schema.json',
    'contracts/conversation_generation_fence.schema.json',
    'contracts/conversation_control_contracts.d.ts',
    'database/migrations/021_p2_005_conversation_control.sql',
    'src/p2-005-conversation-control.mjs',
    'src/p2-005-conversation-control-projections.mjs',
    'evidence/p2-005-assignment-handoff-generation-fence-report.md',
  ]) assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  const migration = text('database/migrations/021_p2_005_conversation_control.sql');
  assert.equal((migration.match(/CREATE TABLE IF NOT EXISTS\s+conversation\./giu) ?? []).length, 4);
  assert.doesNotMatch(migration, /ALTER TABLE\s+conversation\.session/iu);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS\s+(?:pilot_ticket\.(?:pilot_principal|pilot_principal_role|pilot_team_member)|(?:unified_)?ticket\.)/iu);
});

test('P2-006 completion has a runnable workbench and no migration 022', () => {
  const current = json('plans/current_phase.json');
  if (json('plans/master_backlog.json').tasks.find((task) => task.id === 'P2-006').status !== 'DONE') return;
  for (const relativePath of [
    'docs/42_p2_006_realtime_web_workbench.md',
    'evidence/p2-006-realtime-workbench-report.md',
    'src/p2-006-workbench-query.mjs',
    'src/p2-006-workbench-authorization.mjs',
    'src/p2-006-workbench-command-facade.mjs',
    'src/p2-006-workbench-delivery-control.mjs',
    'src/p2-006-workbench-http.mjs',
    'src/p2-006-workbench-static.mjs',
    'web/p2-workbench/index.html',
    'tests/p2-006-workbench.test.mjs',
    'tests/p2-006-workbench.integration.test.mjs',
    'tests/p2-006-workbench-browser.test.mjs',
  ]) assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  assert.equal(fs.existsSync(path.join(root, 'database/migrations/022_p2_006_realtime_workbench.sql')), false);
});

test('P2-001 and P2-002 frozen artifacts remain present', () => {
  for (const relativePath of [
    'contracts/conversation_thread.schema.json',
    'contracts/conversation_session.schema.json',
    'contracts/conversation_item.schema.json',
    'contracts/conversation_projection_source.schema.json',
    'contracts/conversation_projection_checkpoint.schema.json',
    'contracts/conversation_projection_contracts.d.ts',
    'database/migrations/010_p2_001_conversation_contracts.sql',
    'database/migrations/011_p2_002_timeline_projector.sql',
    'src/p2-001-conversation-contracts.mjs',
    'src/p2-002-timeline-projector.mjs',
    'evidence/p2-001-conversation-contracts-report.md',
    'evidence/p2-002-timeline-projector-report.md',
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath + ' should exist');
  }
});

test('P3 remains greenfield and contains no historical ticket program', () => {
  const backlog = json('plans/master_backlog.json');
  const p3 = backlog.phases.find((phase) => phase.id === 'P3');
  assert.equal(p3.target_source_of_truth, 'Unified Ticket Core');
  assert.equal(p3.scope_mode, 'GREENFIELD_NO_HISTORICAL_TICKETS');
  assert.equal(Object.hasOwn(p3, 'legacy_source'), false);
  assert.match(text('tickets/P3_unified_ticket_platform_tasks.md'), /P3-007 内网报修门户 Source Adapter/u);
  assert.match(text('tickets/P3_unified_ticket_platform_tasks.md'), /P3-012 第一条生产内网来源接入/u);
});

test('future flags default off without legacy import flags', () => {
  const env = text('.env.example');
  for (const line of [
    'CONVERSATION_CENTER_ENABLED=false',
    'CONVERSATION_REALTIME_SSE_ENABLED=false',
    'HUMAN_WORKBENCH_V2_ENABLED=false',
    'AI_TRIAGE_ENABLED=false',
    'AI_CONVERSATION_ENABLED=false',
    'AI_AUTO_REPLY_ENABLED=false',
    'OCR_ENABLED=false',
    'INCIDENT_CORRELATION_ENABLED=false',
    'INTEGRATION_CONNECTOR_ENABLED=false',
    'HOSPITAL_IDENTITY_ENABLED=false',
    'INTRANET_PORTAL_SOURCE_ENABLED=false',
    'HOSPITAL_API_SOURCE_ENABLED=false',
    'MONITORING_SOURCE_ENABLED=false',
    'RULE_FIRST_ORCHESTRATION_ENABLED=false',
    'MANUAL_REVIEW_QUEUE_ENABLED=false',
    'TICKET_LIFECYCLE_WORKBENCH_ENABLED=false',
    'REPORTER_TIMELINE_ENABLED=false',
    'WECOM_TEMPLATE_CARD_ENABLED=false',
  ]) {
    assert.match(env, new RegExp('^' + line + '$', 'm'));
  }
  assert.doesNotMatch(env, /SUPERSEDED_IMPORT_FLAG_REMOVED|SUPERSEDED_TARGET_FLAG_REMOVED/u);
});

test('conceptual schema has no historical migration fields or second ticket core', () => {
  const schema = text('database/schema_draft.sql');
  assert.match(schema, /V1\.4 CONCEPTUAL SCHEMA DRAFT/u);
  assert.doesNotMatch(schema, /migration_batch_id|MIGRATION_BATCH|FINAL_CUTOVER|IMPORT_ONLY|IMPORT_AND_PROJECT|FILE_IMPORT/u);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS\s+unified_ticket\.ticket/iu);
});

test('new source example is non-authoritative', () => {
  const source = json('config_examples/integration_source.example.json');
  assert.equal(source.source_code, 'INTRANET_REPORT_PORTAL');
  assert.equal(source.capabilities.submit_service_requests, true);
  assert.equal(source.capabilities.own_ticket_state, false);
  assert.equal(Object.hasOwn(source, 'cutover'), false);
});

test('2C4G limits remain conservative', () => {
  const limits = json('config_examples/resource_limits.2c4g.example.json');
  assert.equal(limits.processes.worker.ai_concurrency, 1);
  assert.equal(limits.processes.worker.communication_concurrency, 1);
  assert.equal(limits.processes.worker.integration_concurrency, 1);
  assert.equal(limits.not_required_on_host.includes('Chatwoot'), true);
});

test('P2-016 authorization reconciles only the historical P2-015 ledger', () => {
  const current = json('plans/current_phase.json');
  if (current.implementation_authorization_status !== 'P2_016_AUTHORIZED') return;
  const summary = json('project_summary.json');
  const views = [
    current, json('MANIFEST.json'), json('plans/master_backlog.json'),
    json('plans/parallel_workstreams.json'), json('tasks/master_backlog.json'),
    summary.project, summary.phase_model.find((phase) => phase.id === 'P2'),
  ];
  for (const view of views) {
    assert.equal(view.last_completed_task, 'P2-015');
    assert.equal(view.last_completed_gate, 'P2-G1');
    assert.equal(view.last_completed_architecture_task, 'ARCH-006');
    assert.equal(view.active_task, 'P2-016');
    assert.equal(view.active_lane, 'P2-B');
    assert.equal(view.implementation_authorization_status, 'P2_016_AUTHORIZED');
    assert.equal(view.p2_015_status, 'DONE');
    assert.equal(view.p2_015_completed_at, '2026-09-03');
    assert.equal(view.p2_015_completion_evidence, 'evidence/p2-015-rule-first-intake-orchestration-report.md');
    assert.equal(view.p2_016_status, 'AUTHORIZED');
    assert.equal(view.p2_016_authorized_at, '2026-09-04');
    assert.equal(view.p2_016_authorization_evidence, 'evidence/p2-016-start-authorization.md');
    assert.equal(Object.hasOwn(view, 'p2_016_completed_at'), false);
    assert.equal(Object.hasOwn(view, 'p2_016_completion_evidence'), false);
    assert.equal(view.p2_012_status, 'TODO_REQUIRES_SEPARATE_AUTHORIZATION');
    assert.equal(view.p2_008_status, 'TODO_BLOCKED_BY_P2_G2');
    for (const gate of ['p2_g2_status', 'p2_g3_status', 'p2_g4_status', 'p2_g5_status']) {
      assert.equal(view[gate], 'NOT_STARTED');
    }
  }
  const ledger = text('tickets/P2_ai_enhancement_tasks.md');
  const completed = ledger.split('## P2-015 ')[1].split('\n## ')[0];
  const authorized = ledger.split('## P2-016 ')[1].split('\n## ')[0];
  assert.match(completed, /^- 状态：DONE（2026-09-03）$/mu);
  assert.match(completed, /aa1153881fdf9f692d497b1850feda70c0ed45b8/u);
  assert.match(completed, /evidence\/p2-015-rule-first-intake-orchestration-report\.md/u);
  assert.doesNotMatch(completed, /TODO|REQUIRES_SEPARATE_AUTHORIZATION/u);
  assert.match(authorized, /^- 状态：AUTHORIZED（2026-09-04）$/mu);
  const receipt = text('evidence/p2-016-start-authorization.md');
  assert.match(receipt, /## Historical ledger reconciliation/u);
  assert.match(receipt, /READY_FOR_TARGETED_LIVE_VALIDATION/u);
  assert.match(receipt, /不创建第二提交/u);
});

test('architecture validator rejects the historical P2-015 ledger drift', () => {
  if (json('plans/current_phase.json').implementation_authorization_status !== 'P2_016_AUTHORIZED') return;
  const ledgerPath = path.join(root, 'tickets/P2_ai_enhancement_tasks.md');
  const original = text('tickets/P2_ai_enhancement_tasks.md');
  // Normalize only the in-memory fixture; the repository is never mutated by this probe.
  const normalizedOriginal = original.replaceAll('\r\n', '\n');
  const fixture = normalizedOriginal.replace('- 状态：DONE（2026-09-03）\n- 授权 Evidence：`evidence/p2-015-start-authorization.md`',
    '- 状态：TODO / REQUIRES_SEPARATE_AUTHORIZATION\n- 授权 Evidence：`evidence/p2-015-start-authorization.md`');
  assert.notEqual(fixture, normalizedOriginal);
  const errors = [];
  const processView = { cwd: () => root, exitCode: undefined };
  const source = text('scripts/validate-v1-4-architecture.mjs').replace(/^import .*;\r?\n/gmu, '');
  runInNewContext(source, {
    fs: { ...fs, readFileSync: (file, ...args) => file === ledgerPath ? fixture : fs.readFileSync(file, ...args) },
    path, process: processView, console: { log() {}, error: (message) => errors.push(message) },
  });
  assert.equal(processView.exitCode, 1);
  assert.ok(errors.includes('- historical P2-015 ledger agrees with completed facts'));
  assert.equal(text('tickets/P2_ai_enhancement_tasks.md'), original);
});
