import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const text = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('V1.4 architecture validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-v1-4-architecture.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('P1 remains complete and P2-002 is done with no active implementation task', () => {
  const current = json('plans/current_phase.json');
  const backlog = json('plans/master_backlog.json');
  assert.equal(current.phase_id, 'P2');
  assert.equal(current.status, 'IN_PROGRESS');
  assert.equal(current.last_completed_task, 'P2-002');
  assert.equal(current.active_task, null);
  assert.equal(current.next_phase_authorized, true);
  assert.deepEqual(current.authorized_tasks, ['P2-001', 'P2-002']);
  assert.equal(current.active_lane, null);
  assert.equal(current.implementation_authorization_status, 'P2_002_DONE_AWAITING_SEPARATE_AUTHORIZATION');
  assert.equal(current.p2_g1_status, 'NOT_STARTED');
  assert.equal(current.next_task_candidate, 'P2-003');
  assert.equal(current.next_task_authorized, false);
  assert.equal(current.p2_002_completed_at, '2026-08-30');
  assert.equal(current.p2_002_completion_evidence, 'evidence/p2-002-timeline-projector-report.md');
  assert.deepEqual(current.exit_decision, {
    phase_id: 'P1',
    decision: 'GO',
    approved_at: '2026-08-30',
    completed_at: '2026-08-30',
    evidence: 'evidence/p1-012-project-owner-go-approval.md',
    blockers: [],
  });
  assert.equal(backlog.phases.find((phase) => phase.id === 'P1').status, 'DONE');
  assert.equal(backlog.tasks.find((t) => t.id === 'P1-012').status, 'DONE');
  assert.equal(backlog.phases.find((phase) => phase.id === 'P2').status, 'IN_PROGRESS');
  assert.equal(backlog.active_task, null);
  assert.equal(backlog.last_completed_task, 'P2-002');
  assert.equal(backlog.next_task_candidate, 'P2-003');
  assert.equal(backlog.next_task_authorized, false);
  assert.equal(backlog.tasks.find((t) => t.id === 'P2-001').status, 'DONE');
  assert.equal(backlog.tasks.find((t) => t.id === 'P2-002').status, 'DONE');
  assert.equal(backlog.tasks.find((t) => t.id === 'P2-002').completed_at, '2026-08-30');
  assert.equal(backlog.tasks.find((t) => t.id === 'P2-002').evidence, 'evidence/p2-002-timeline-projector-report.md');
  assert.equal(backlog.tasks.filter((t) => t.phase === 'P2' && !['P2-001', 'P2-002'].includes(t.id)).every((t) => t.status === 'TODO'), true);
  assert.deepEqual(backlog.tasks.filter((t) => t.status === 'IN_PROGRESS').map((t) => t.id), []);
  assert.equal(backlog.tasks.filter((t) => t.phase === 'P3').every((t) => t.status === 'TODO'), true);
  assert.match(text('evidence/p1-012-project-owner-go-approval.md'), /“我批准了”/u);
  assert.match(text('evidence/p1-012-project-owner-go-approval.md'), /P2.*单独授权/u);
  assert.match(text('evidence/p2-phase-start-authorization.md'), /项目负责人正式授权启动 Phase 2，但本轮仅授权 ARCH-004 和 P2-001/u);
  assert.match(text('evidence/p2-phase-start-authorization.md'), /P2-002 及以后任务仍须另行授权/u);
  assert.match(text('evidence/p2-002-start-authorization.md'), /项目负责人正式、独立授权启动 P2-002/u);
  assert.match(text('evidence/p2-002-start-authorization.md'), /P2-003 及以后任务、P2-G1 组装和所有生产功能仍须另行授权/u);
  assert.equal(backlog.source_of_truth, 'Unified Ticket Core in this repository');
});

test('P2-002 completion artifacts and evidence are present', () => {
  for (const rel of [
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
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `${rel} should exist`);
  }
});

test('P3 is greenfield and contains no historical ticket program', () => {
  const backlog = json('plans/master_backlog.json');
  const p3 = backlog.phases.find((p) => p.id === 'P3');
  assert.equal(p3.target_source_of_truth, 'Unified Ticket Core');
  assert.equal(p3.scope_mode, 'GREENFIELD_NO_HISTORICAL_TICKETS');
  assert.equal(Object.hasOwn(p3, 'legacy_source'), false);
  assert.match(text('tickets/P3_unified_ticket_platform_tasks.md'), /P3-007 内网报修门户 Source Adapter/);
  assert.match(text('tickets/P3_unified_ticket_platform_tasks.md'), /P3-012 第一条生产内网来源接入/);
});

test('future flags default off without legacy import flags', () => {
  const env = text('.env.example');
  for (const line of [
    'CONVERSATION_CENTER_ENABLED=false', 'CONVERSATION_REALTIME_SSE_ENABLED=false',
    'HUMAN_WORKBENCH_V2_ENABLED=false', 'AI_TRIAGE_ENABLED=false',
    'AI_CONVERSATION_ENABLED=false', 'AI_AUTO_REPLY_ENABLED=false', 'OCR_ENABLED=false',
    'INCIDENT_CORRELATION_ENABLED=false', 'INTEGRATION_CONNECTOR_ENABLED=false',
    'HOSPITAL_IDENTITY_ENABLED=false', 'INTRANET_PORTAL_SOURCE_ENABLED=false',
    'HOSPITAL_API_SOURCE_ENABLED=false', 'MONITORING_SOURCE_ENABLED=false'
  ]) assert.match(env, new RegExp(`^${line}$`, 'm'));
  assert.doesNotMatch(env, /SUPERSEDED_IMPORT_FLAG_REMOVED|SUPERSEDED_TARGET_FLAG_REMOVED/);
});

test('P3 gates are source onboarding gates', () => {
  const parallel = json('plans/parallel_workstreams.json');
  const gates = Object.fromEntries(parallel.assembly_gates.map((g) => [g.id, g.name]));
  assert.equal(gates['P3-G2'], 'First Intranet Source E2E');
  assert.equal(gates['P3-G4'], 'First Production Source Onboarding and Phase 3 Go');
  const lane = parallel.lanes.find((l) => l.id === 'P3-C');
  assert.equal(lane.name, 'Intranet Source Adapters');
  assert.equal(lane.branch, 'phase3/intranet-sources');
});

test('P2-001 and P2-002 are complete, no lane is active, and all feature flags remain false', () => {
  const parallel = json('plans/parallel_workstreams.json');
  assert.equal(parallel.current_phase, 'P2');
  assert.equal(parallel.last_completed_task, 'P2-002');
  assert.equal(parallel.active_task, null);
  assert.equal(parallel.active_lane, null);
  assert.equal(parallel.next_task_candidate, 'P2-003');
  assert.equal(parallel.next_task_authorized, false);
  assert.deepEqual(parallel.authorized_tasks, ['P2-001', 'P2-002']);
  assert.equal(parallel.implementation_authorization_status, 'P2_002_DONE_AWAITING_SEPARATE_AUTHORIZATION');
  assert.equal(parallel.p2_002_completed_at, '2026-08-30');
  assert.equal(parallel.p2_002_completion_evidence, 'evidence/p2-002-timeline-projector-report.md');
  assert.equal(parallel.assembly_gates.find((gate) => gate.id === 'P2-G1').status, 'NOT_STARTED');
  assert.equal(parallel.assembly_gates.every((gate) => gate.status === 'NOT_STARTED'), true);
  assert.deepEqual(parallel.feature_flags_enabled, []);
  assert.equal(Object.values(parallel.feature_flag_defaults).every((value) => value === false), true);
});

test('conceptual schema has no historical migration fields', () => {
  const schema = text('database/schema_draft.sql');
  assert.match(schema, /V1\.4 CONCEPTUAL SCHEMA DRAFT/);
  assert.doesNotMatch(schema, /migration_batch_id|MIGRATION_BATCH|FINAL_CUTOVER|IMPORT_ONLY|IMPORT_AND_PROJECT|FILE_IMPORT/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS\s+unified_ticket\.ticket/i);
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
