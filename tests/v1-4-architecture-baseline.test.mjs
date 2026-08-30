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

test('P1 remains active and future phases remain gated', () => {
  const current = json('plans/current_phase.json');
  const backlog = json('plans/master_backlog.json');
  assert.equal(current.phase_id, 'P1');
  assert.equal(current.active_task, 'P1-012');
  assert.equal(backlog.tasks.find((t) => t.id === 'P1-012').status, 'IN_PROGRESS');
  assert.equal(backlog.tasks.find((t) => t.id === 'P2-001').status, 'TODO');
  assert.equal(backlog.tasks.find((t) => t.id === 'P3-001').status, 'TODO');
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
    'CONVERSATION_CENTER_ENABLED=false', 'AI_CONVERSATION_ENABLED=false',
    'AI_AUTO_REPLY_ENABLED=false', 'INTEGRATION_CONNECTOR_ENABLED=false',
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
