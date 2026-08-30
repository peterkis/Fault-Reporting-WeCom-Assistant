import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function readWorkspaceFile(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

test('G0-008 closure preserves the completed P1 pointers and keeps P2 gated', () => {
  const currentPhase = JSON.parse(readWorkspaceFile('plans/current_phase.json'));
  const backlog = JSON.parse(readWorkspaceFile('plans/master_backlog.json'));
  const projectSummary = JSON.parse(readWorkspaceFile('project_summary.json'));
  const g0Task = backlog.tasks.find(({ id }) => id === 'G0-008');
  const p1Task = backlog.tasks.find(({ id }) => id === 'P1-001');
  const p1AdapterTask = backlog.tasks.find(({ id }) => id === 'P1-002');
  const p1InboxTask = backlog.tasks.find(({ id }) => id === 'P1-003');
  const p1IntakeTask = backlog.tasks.find(({ id }) => id === 'P1-004');
  const p1OperationsTask = backlog.tasks.find(({ id }) => id === 'P1-011');
  const p1E2ETask = backlog.tasks.find(({ id }) => id === 'P1-012');
  const completedPilotTasks = ['P1-005', 'P1-006', 'P1-007', 'P1-008', 'P1-009', 'P1-010', 'P1-011']
    .map((id) => backlog.tasks.find((task) => task.id === id));

  assert.equal(currentPhase.phase_id, 'P1');
  assert.equal(currentPhase.status, 'DONE');
  assert.equal(currentPhase.last_completed_task, 'P1-012');
  assert.equal(currentPhase.active_task, null);
  assert.equal(currentPhase.next_phase_authorized, false);
  assert.equal(currentPhase.exit_decision.decision, 'GO');
  assert.equal(backlog.current_phase, 'P1');
  assert.equal(backlog.active_task, null);
  assert.equal(g0Task?.status, 'DONE');
  assert.equal(p1Task?.status, 'DONE');
  assert.equal(p1AdapterTask?.status, 'DONE');
  assert.equal(p1InboxTask?.status, 'DONE');
  assert.equal(p1IntakeTask?.status, 'DONE');
  assert.equal(p1OperationsTask?.status, 'DONE');
  assert.equal(p1E2ETask?.status, 'DONE');
  assert.deepEqual(p1E2ETask?.depends_on, ['P1-010', 'P1-011']);
  assert.ok(completedPilotTasks.every((task) => task?.status === 'DONE'));
  assert.ok(g0Task.depends_on.includes('G0-006A'));
  assert.equal(projectSummary.project.status, 'p1_complete_go_approved_awaiting_p2_authorization');
  assert.equal(projectSummary.project.last_completed_task, 'P1-012');
  assert.equal(projectSummary.project.active_task, null);
  assert.equal(projectSummary.project.next_task, null);
  assert.ok(projectSummary.hard_invariants.includes('channel_message_idempotency_required'));
  assert.ok(!projectSummary.hard_invariants.includes('provider_msg_id_unique'));
  assert.ok(currentPhase.forbidden_before_exit.includes('real hospital identity connection'));
  assert.ok(currentPhase.forbidden_before_exit.includes('production AI conversation or automatic reply'));
  assert.ok(currentPhase.forbidden_before_exit.includes('production OCR'));
  assert.ok(currentPhase.allowed_scope.includes('P1 closeout documentation and evidence integrity'));
  assert.ok(currentPhase.forbidden_without_next_phase_authorization.includes('start any P2 or P3 task'));
  assert.equal(backlog.phases.find(({ id }) => id === 'P2')?.status, 'TODO');
  assert.equal(backlog.tasks.find(({ id }) => id === 'P2-001')?.status, 'TODO');
});

test('G0-008 report covers every completed Gate 0 evidence source and retains limits', () => {
  const report = readWorkspaceFile('evidence/g0-008-gate0-acceptance-report.md');
  const requiredSources = [
    'g0-001-wss-network-report.md',
    'g0-002-sdk-authentication-report.md',
    'g0-003-text-capability-matrix.md',
    'g0-004-media-capability-matrix.md',
    'g0-005-active-push-matrix.md',
    'g0-006-template-card-matrix.md',
    'g0-006a-reply-capability-matrix.md',
    'g0-007-stability-report.md'
  ];

  for (const source of requiredSources) {
    assert.match(report, new RegExp(source.replaceAll('.', '\\.')));
  }

  assert.match(report, /不通过（降级）/);
  assert.match(report, /未验证/);
  assert.match(report, /主动侧显示可见性已确认/);
  assert.match(report, /单连接限制已确认/);
  assert.match(report, /新连接完成订阅后会踢掉旧连接/);
  assert.match(report, /项目负责人明确授权“可以开始进行下一阶段”/);
  assert.match(report, /Phase 1 已获准进入/);
  assert.match(report, /当前只启动 P1-001/);
});

test('the capability-freeze ADR is accepted and does not skip P1-001', () => {
  const adr = readWorkspaceFile('adr/0009_gate0_capability_freeze.md');
  const openIssues = readWorkspaceFile('docs/19_gate0_open_issues.md');

  assert.match(adr, /状态：Accepted/);
  assert.match(adr, /官方已确认每个智能机器人同一时间只支持一个有效长连接/);
  assert.match(adr, /新连接完成订阅后会踢掉旧连接/);
  assert.match(adr, /顺序主备切换/);
  assert.match(adr, /项目负责人已确认主动媒体投递的客户端显示可见性/);
  assert.match(adr, /超过 1 MiB 的自动视频回复、群 @ 提醒、反馈空包响应和多活/);
  assert.match(adr, /Phase 1 仅启动其首个任务 P1-001/);
  assert.match(adr, /P1-002 及后续任务仍须遵循各自依赖与验收条件/);
  assert.match(openIssues, /G0-OPEN-001/);
  assert.match(openIssues, /CLOSED（项目负责人确认）/);
  assert.match(openIssues, /G0-OPEN-002[\s\S]*CLOSED（项目负责人确认）/);
  assert.match(openIssues, /G0-OPEN-006[\s\S]*CLOSED（官方限制已确认）/);
  assert.match(openIssues, /新连接完成订阅会踢掉旧连接/);
  assert.match(openIssues, /G0-OPEN-008/);
});
