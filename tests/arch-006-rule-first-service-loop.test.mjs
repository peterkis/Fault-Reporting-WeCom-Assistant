import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { testRoots } from './helpers/migration-roots.mjs';

const root = process.cwd();
const text = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(text(file));

test('ARCH-006 validator passes', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-arch-006-rule-first-service-loop.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('ARCH-006 current structure rejects missing scope and changed historical evidence', () => {
  const { sourceRoot, runtimeRoot } = testRoots();
  for (const relative of ['plans/yxx-current-readiness-scope.json', 'evidence/g0-005-active-push-matrix.md']) {
    const file = path.join(sourceRoot, relative), original = fs.readFileSync(file);
    try {
      if (relative.endsWith('.json')) fs.unlinkSync(file);
      else fs.appendFileSync(file, '\nSynthetic unauthorized change\n');
      const result = spawnSync(process.execPath, [path.join(runtimeRoot, 'scripts/validate-arch-006-rule-first-service-loop.mjs')], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 90_000,
      });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /current ADR-0027 structure and protected history are valid/u);
    } finally {
      fs.writeFileSync(file, original);
      assert.ok(fs.readFileSync(file).equals(original));
    }
  }
});

test('machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles', () => {
  const current = json('plans/current_phase.json');
  const backlog = json('plans/master_backlog.json');
  assert.equal(['P2-007', 'P2-015', 'P2-016', 'P2-012'].includes(current.last_completed_task), true);
  assert.equal(current.last_completed_gate, 'P2-G1');
  assert.equal(current.last_completed_architecture_task, 'ARCH-006');
  assert.equal(current.arch_005_status, 'DONE');
  assert.equal(current.arch_006_status, 'DONE');
  assert.equal(current.p2_007_status, 'DONE');
  assert.equal(current.p2_g1_status, 'PASSED');
  if (current.p2_015_status === 'AUTHORIZED') {
    assert.equal(current.active_task, 'P2-015'); assert.equal(current.active_lane, 'P2-C');
    assert.equal(current.next_task_candidate, 'P2-015'); assert.equal(current.next_task_authorized, true);
  } else if (['IN_PROGRESS','READY_FOR_LIVE_E2E'].includes(current.p2_g2_status)) {
    assert.equal(current.last_completed_task,'P2-012');assert.equal(current.p2_016_status,'DONE');
    assert.equal(current.active_task,'P2-G2');assert.equal(current.active_lane,'ASSEMBLY');
    assert.equal(current.next_task_candidate,current.p2_g2_status==='IN_PROGRESS'?'P2-G2':'P2-G2-LIVE');
    assert.equal(current.next_task_authorized,current.p2_g2_status==='IN_PROGRESS');
    assert.deepEqual(current.authorized_gates,['P2-G1','P2-G2']);
    assert.equal(current.authorized_tasks.includes('P2-G2'),false);
  } else if (current.p2_012_status==='DONE') {
    assert.equal(current.last_completed_task,'P2-012');assert.equal(current.p2_016_status,'DONE');
    assert.equal(current.active_task,null);assert.equal(current.active_lane,null);
    assert.equal(current.next_task_candidate,'P2-G2');assert.equal(current.next_task_authorized,false);
  } else if (['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION'].includes(current.p2_012_status)) {
    assert.equal(current.last_completed_task,'P2-016');assert.equal(current.p2_016_status,'DONE');
    assert.equal(current.active_task,'P2-012');assert.equal(current.active_lane,'P2-D');
    assert.equal(current.next_task_candidate,current.p2_012_status==='AUTHORIZED'?'P2-012':'P2-012-LIVE');
    assert.equal(current.next_task_authorized,current.p2_012_status==='AUTHORIZED');
  } else if (current.p2_016_status==='DONE') {
    assert.equal(current.last_completed_task,'P2-016');assert.equal(current.p2_015_status,'DONE');
    assert.equal(current.active_task,null);assert.equal(current.active_lane,null);
    assert.equal(current.next_task_candidate,'P2-012');assert.equal(current.next_task_authorized,false);
  } else if (['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION'].includes(current.p2_016_status)) {
    assert.equal(current.p2_015_status,'DONE');assert.equal(current.last_completed_task,'P2-015');
    assert.equal(current.active_task,'P2-016');assert.equal(current.active_lane,'P2-B');
    assert.equal(current.next_task_candidate,'P2-016');assert.equal(current.next_task_authorized,true);
  } else {
    assert.equal(current.p2_015_status, 'DONE'); assert.equal(current.active_task, null); assert.equal(current.active_lane, null);
    assert.equal(current.next_task_candidate, 'P2-016'); assert.equal(current.next_task_authorized, false);
  }
  for (const id of ['P2-016', 'P2-012']) {
    const task = backlog.tasks.find((entry) => entry.id === id);
    if(id==='P2-016'&&['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION','DONE'].includes(current.p2_016_status)){
      assert.equal(task.status,current.p2_016_status);assert.equal(task.authorization_status,'AUTHORIZED');continue;
    }
    if(id==='P2-012'&&['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION','DONE'].includes(current.p2_012_status)){assert.equal(task.status,current.p2_012_status);assert.equal(task.authorization_status,'AUTHORIZED');continue;}
    assert.equal(task.status, 'TODO');
    assert.equal(task.authorization_status, 'REQUIRES_SEPARATE_AUTHORIZATION');
  }
  assert.equal(backlog.tasks.find((entry) => entry.id === 'P2-008').authorization_status, 'BLOCKED_BY_P2_G2');
});

test('ten safe deterministic results are first-class and Manual Review is valid', () => {
  const contract = text('docs/51_rule_first_intake_manual_review.md');
  for (const result of ['TICKET_ELIGIBLE', 'NEEDS_DESCRIPTION', 'MANUAL_REVIEW_REQUIRED', 'RELATED_FOLLOW_UP', 'STATUS_QUERY', 'SERVICE_REQUEST', 'BUSINESS_CONSULTATION', 'ACKNOWLEDGEMENT', 'OUT_OF_SCOPE', 'INCIDENT_REVIEW_CANDIDATE']) {
    assert.match(contract, new RegExp('`' + result + '`', 'u'));
  }
  assert.match(contract, /不得静默忽略/u);
  assert.match(contract, /每次只问一个高信息量问题/u);
  assert.match(contract, /不自动关闭 Ticket/u);
  assert.match(contract, /不调用外部天气或其他服务/u);
});

test('Ticket lifecycle reuses authoritative actions and reliable notification boundary', () => {
  const contract = text('docs/52_full_ticket_lifecycle_workbench_notifications.md');
  for (const action of ['queue', 'accept', 'start', 'request-information', 'resume', 'wait-vendor', 'resolve', 'confirm', 'reopen', 'cancel', 'auto-close', 'add-note']) assert.match(contract, new RegExp(action, 'u'));
  assert.match(contract, /TicketActionService/u);
  assert.match(contract, /Ticket Event[\s\S]*Notification Policy[\s\S]*Communication Message[\s\S]*Outbox[\s\S]*Delivery[\s\S]*WeCom Sender/u);
  assert.match(contract, /Conversation Assignment[\s\S]*Ticket Assignment/u);
  assert.match(contract, /全部成功或全部失败/u);
  assert.match(contract, /发送失败不回滚 Ticket/u);
});

test('Incident remains human-confirmed and AI-independent', () => {
  const contract = text('docs/53_human_confirmed_incident_before_ai.md');
  assert.match(contract, /P2-007 只产生 `INCIDENT_REVIEW_CANDIDATE`/u);
  assert.match(contract, /自动创建 Incident/u);
  assert.match(contract, /模型调用必须为 0/u);
  assert.match(contract, /错误关联必须可 unlink/u);
  assert.match(contract, /一名用户恢复只更新其个人 Report\/Subscription，不关闭共享 Incident，也不改变 Ticket/u);
});

test('AI-off readiness and feature flags are closed by default', () => {
  const parallel = json('plans/parallel_workstreams.json');
  const gate = text('docs/54_p2_g2_deterministic_full_service_loop_gate.md');
  assert.deepEqual(parallel.feature_flags_enabled, []);
  assert.equal(Object.values(parallel.feature_flag_defaults).every((value) => value === false), true);
  for (const flag of ['RULE_FIRST_ORCHESTRATION_ENABLED', 'MANUAL_REVIEW_QUEUE_ENABLED', 'TICKET_LIFECYCLE_WORKBENCH_ENABLED', 'REPORTER_TIMELINE_ENABLED', 'WECOM_TEMPLATE_CARD_ENABLED', 'INCIDENT_CORRELATION_ENABLED']) {
    assert.equal(parallel.feature_flag_defaults[flag], false);
  }
  assert.match(gate, /base_service_ready=true/u);
  assert.match(gate, /DeepSeek Key 不存在/u);
  assert.match(gate, /模型网络不可达/u);
  assert.match(gate, /model_provider_calls = 0/u);
});
