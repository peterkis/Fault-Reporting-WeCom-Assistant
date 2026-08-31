import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const json = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const text = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const profiles = Object.freeze({
  P2_005_IN_PROGRESS: Object.freeze({
    lastCompletedTask: 'P2-004',
    activeTask: 'P2-005',
    activeLane: 'P2-B',
    candidate: 'P2-005',
    candidateAuthorized: true,
    p2005Status: 'IN_PROGRESS',
  }),
  P2_005_DONE_AWAITING_SEPARATE_AUTHORIZATION: Object.freeze({
    lastCompletedTask: 'P2-005',
    activeTask: null,
    activeLane: null,
    candidate: 'P2-006',
    candidateAuthorized: false,
    p2005Status: 'DONE',
  }),
});

test('V1.4 architecture validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-v1-4-architecture.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});

test('P2-005 lifecycle state is internally consistent without changing P1', () => {
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
    [manifest.last_completed_task, manifest.active_task, manifest.active_lane,
      manifest.next_task_candidate, manifest.next_task_authorized, manifest.authorized_tasks],
    [current.last_completed_task, current.active_task, current.active_lane,
      current.next_task_candidate, current.next_task_authorized, current.authorized_tasks],
    [backlog.last_completed_task, backlog.active_task, backlog.active_lane,
      backlog.next_task_candidate, backlog.next_task_authorized, backlog.authorized_tasks],
    [parallel.last_completed_task, parallel.active_task, parallel.active_lane,
      parallel.next_task_candidate, parallel.next_task_authorized, parallel.authorized_tasks],
    [taskIndex.last_completed_task, taskIndex.active_task, taskIndex.active_lane,
      taskIndex.next_tasks.candidate, taskIndex.next_tasks.candidate_authorized, taskIndex.authorized_tasks],
    [projectSummary.project.last_completed_task, projectSummary.project.active_task,
      projectSummary.project.active_lane, projectSummary.project.next_task,
      projectSummary.project.next_task_authorized, projectSummary.project.authorized_tasks],
  ];
  for (const [last, active, lane, candidate, authorized, tasks] of views) {
    assert.equal(last, profile.lastCompletedTask);
    assert.equal(active, profile.activeTask);
    assert.equal(lane, profile.activeLane);
    assert.equal(candidate, profile.candidate);
    assert.equal(authorized, profile.candidateAuthorized);
    assert.deepEqual(tasks, ['P2-001', 'P2-002', 'P2-003', 'P2-004', 'P2-005']);
  }

  assert.equal(backlog.tasks.find((task) => task.id === 'P2-001').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-002').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-003').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-004').status, 'DONE');
  assert.equal(backlog.tasks.find((task) => task.id === 'P2-005').status, profile.p2005Status);
  assert.equal(backlog.tasks.filter((task) => task.phase === 'P2' && /^P2-(00[6-9]|01[0-4])$/u.test(task.id))
    .every((task) => task.status === 'TODO'), true);
  assert.deepEqual(
    backlog.tasks.filter((task) => task.status === 'IN_PROGRESS').map((task) => task.id),
    profile.activeTask ? [profile.activeTask] : [],
  );
  assert.equal(backlog.tasks.filter((task) => task.phase === 'P3').every((task) => task.status === 'TODO'), true);
  assert.equal(parallel.assembly_gates.every((gate) => gate.status === 'NOT_STARTED'), true);
  assert.deepEqual(parallel.feature_flags_enabled, []);
  assert.equal(Object.values(parallel.feature_flag_defaults).every((value) => value === false), true);
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

test('P2-004 completion artifacts preserve P1 notification and Ticket ownership', () => {
  const current = json('plans/current_phase.json');
  if (current.implementation_authorization_status !== 'P2_004_DONE_AWAITING_SEPARATE_AUTHORIZATION') return;
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
