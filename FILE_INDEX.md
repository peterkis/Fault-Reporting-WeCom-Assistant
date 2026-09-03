# V1.4 文件索引

## 权威入口

- `AGENTS.md`：不可违反的规则和阶段边界；
- `README.md`：架构摘要；
- `docs/architecture_baseline_status.md`：唯一有效架构状态；
- `plans/current_phase.json`：当前阶段；
- `plans/master_backlog.json`：机器可读完整 Backlog；
- `tasks/master_backlog.json`：精简任务索引。
- `tasks/ARCH-004_p1_to_p2_phase_transition.md`：P1 → P2 阶段切换任务记录；
- `tasks/P2-001_conversation_thread_session_contracts.md`：P2-001 契约任务记录；
- `tasks/P2-002_persistent_timeline_projector.md`：已完成 P2-002 投影任务记录；
- `tasks/P2-003_realtime_event_log_sse.md`：已完成的 P2-003 任务记录；
- `tasks/P2-004_unified_communication_outbox_delivery.md`：已完成的 P2-004 任务记录；
- `tasks/P2-005_assignment_handoff_read_cursor_generation_fence.md`：已完成的 P2-005 任务记录；
- `tasks/P2-006_realtime_web_workbench_rest_authorization.md`：P2-006 独立授权与停止线任务记录；
- `tasks/P2-G1_human_only_conversation_center_assembly.md`：P2-G1 Human-only Assembly 授权、验收和停止线；
- `tasks/ARCH-005_asia_shanghai_local_business_time.md`：ARCH-005 独立授权、实现边界与目标现场重验停止线；
- `tasks/ARCH-006_ai_optional_rule_first_service_loop.md`：ARCH-006 规则优先、AI 可选的 P2 重基线与停止线；
- `tasks/P2-015_rule_first_intake_orchestration_manual_review.md`：已完成的规则受理编排、Contact Journey 与人工审核任务；
- `evidence/p2-015-start-authorization.md`：P2-015 独立授权、固定基线和严格停止线；
- `evidence/p2-015-rule-first-intake-orchestration-report.md`：P2-015 完成验证、资源、隐私、回归和停止线 Evidence；
- `tasks/P2-016_full_ticket_lifecycle_workbench_notifications.md`：未来完整 Ticket 工作台、Reporter Timeline 与通知任务（未授权）；
- `evidence/arch-005-start-authorization.md`：ARCH-005 Gate、暂存分支隔离和迁移安全授权 Evidence；
- `evidence/arch-005-time-inventory-before.json` / `.md`：迁移前时间资产、逐列分类、行数、catalog 指纹和备份事实；
- `docs/48_arch_005_asia_shanghai_time_contract.md`：LocalDate/LocalTime/LocalDateTime/PhysicalEpochMs、数据库与 UI 统一契约；
- `docs/49_p2_007_time_contract_migration_note.md`：未来 P2-007 v1.2.1 时间契约升级和重新生成 Manifest/Hash 要求；
- `evidence/p2-phase-start-authorization.md`：Phase 2 启动及仅授权 P2-001 的负责人 Evidence；
- `evidence/p2-001-conversation-contracts-report.md`：P2-001 脱敏验证 Evidence；
- `evidence/p2-002-start-authorization.md`：仅启动 P2-002 的项目负责人独立授权 Evidence；
- `evidence/p2-002-timeline-projector-report.md`：P2-002 完成验证 Evidence；
- `evidence/p2-003-start-authorization.md`：仅启动 P2-003 的项目负责人独立授权 Evidence；
- `evidence/p2-003-realtime-event-log-sse-report.md`：P2-003 完成验证 Evidence。
- `evidence/p2-004-start-authorization.md`：仅启动 P2-004 的项目负责人独立授权 Evidence；
- `evidence/p2-004-communication-outbox-delivery-report.md`：P2-004 完成验证 Evidence。
- `evidence/p2-005-start-authorization.md`：仅启动 P2-005 的项目负责人独立授权 Evidence；
- `evidence/p2-005-assignment-handoff-generation-fence-report.md`：P2-005 完成验证 Evidence。
- `evidence/p2-006-start-authorization.md`：仅启动 P2-006 的项目负责人独立授权 Evidence。
- `evidence/p2-006-realtime-workbench-report.md`：P2-006 REST、权限、SSE、浏览器与性能验收 Evidence。
- `evidence/p2-g1-start-authorization.md`：P2-G1 独立启动授权和固定基线 Evidence。
- `evidence/p2-g1-assembly-readiness-report.md`：P2-G1 自动化 Assembly 与 Live E2E 就绪状态报告。
- `evidence/p2-g1-live-e2e.jsonl`：P2-G1 真实现场与修复周期的追加式结构化 Evidence。
- `evidence/p2-g1-resource-observation.jsonl`：60 分钟 controlled observation 分进程资源 Evidence。
- `evidence/p2-g1-human-only-gate-report.md`：P2-G1 Human-only 现场 Gate 汇总报告。
- `evidence/p2-g1-project-owner-approval.md`：项目负责人 P2-G1 `PASSED` 决定与后续停止线。
- `evidence/arch-006-start-authorization.md`：ARCH-006 独立授权、固定基线和禁止范围；
- `evidence/arch-006-capability-gap-inventory.md` / `.json`：当前能力与装配缺口的双格式盘点；
- `evidence/arch-006-rule-first-service-loop-rebaseline-report.md`：ARCH-006 完成验证与范围证明。

## ADR

- `adr/0007_pilot_ticket_core_then_adapter.md`：Superseded 历史指针；
- `adr/0010_unified_ticket_core_source_of_truth.md`：Unified Ticket Core 权威；
- `adr/0011_lightweight_conversation_center_2c4g.md`：轻量 Conversation Center；
- `adr/0012_greenfield_p3_no_historical_ticket_compatibility.md`：P3 绿地化、取消历史 Ticket 兼容。
- `adr/0017_ai_optional_rule_first_service_loop.md`：规则/人工主路径、AI 可选以及 P2-G2 至 P2-G5 新顺序。

## 阶段计划

- `plans/phase_2_ai_enhancement.md`：Conversation Center 与 AI 协作；
- `plans/phase_3_unified_ticket_platform.md`：医院内网新来源接入；
- `plans/phase_3_hospital_integration.md`：Superseded 文件名指针；
- `plans/parallel_workstreams.json`：并行 Lane 和 Assembly Gate。

## 任务

- `tickets/P2_ai_enhancement_tasks.md`：P2-001 至 P2-016（含 ARCH-006 插入的 P2-015/P2-016；编号不代表执行顺序）；
- `tickets/P3_unified_ticket_platform_tasks.md`：P3-001 至 P3-012；
- `tickets/P3_hospital_integration_tasks.md`：Superseded 指针。

## P2-001 契约与实现

- `CONTEXT.md`：Conversation Center 统一领域语言；
- `contracts/conversation_thread.schema.json`：Thread 契约；
- `contracts/conversation_session.schema.json`：Session 契约；
- `contracts/conversation_item.schema.json`：Item 冻结契约；其持久化由 migration 011 实现；
- `contracts/conversation_contracts.d.ts`：对应 TypeScript 类型；
- `database/migrations/010_p2_001_conversation_contracts.sql`：Thread/Session 增量迁移；
- `src/p2-001-conversation-contracts.mjs`：身份、边界、状态、控制模式与稳定错误策略；
- `scripts/p2-001-migrate.mjs`：受限迁移入口；
- `tests/p2-001-conversation-contracts.test.mjs`：Contract/Unit 测试；
- `tests/p2-001-conversation-contracts.integration.test.mjs`：隔离 PostgreSQL 集成测试。

## P2-002 冻结完成事实

- P2-002：`DONE`（2026-08-30），其 Contract、迁移、运行时与 Evidence 保持冻结；
- 当前前沿已由下方 P2-003 独立授权条目接续；`P2-G1` 仍为 `NOT_STARTED`；
- P3 未启动；
- 所有 P2/P3 Feature Flag 保持 `false`；
- 完成状态不等同于生产、临床或 Assembly Gate 验收。

## P2-G1 Assembly 状态

- P2-003、P2-004、P2-005、P2-006、P2-015：`DONE`；P2-G1：`PASSED`；当前无活动 Lane；
- `docs/42_p2_006_realtime_web_workbench.md`：Internal Alpha、REST/Auth、Query、Command、Delivery、SSE/Polling 与 UI 边界。
- P2-007 与 P2-015 保持 `DONE`；P2-016 为下一候选但未授权；P2-012、P2-008 至 P2-014 继续要求独立授权；
- `P2-G1` 已完成真实测试 Workbench、企业微信 Sender、Replay Gap、恢复和资源现场 Gate；所有提交的 P2/P3 Feature Flag 默认值保持 `false`；
- 未启用生产 Workbench、模型或医院内网；本 Gate 通过不等同于 Phase 2 Go、生产或临床上线。

## P2-005 契约、迁移、运行时与测试

- `docs/41_p2_005_assignment_handoff_generation_fence.md`：Assignment、Handoff、Read Cursor、Control Event、Generation Fence、授权、隐私和资源边界；
- `contracts/conversation_assignment.schema.json`：Assignment 安全状态 Contract；
- `contracts/conversation_handoff.schema.json`：Handoff 生命周期 Contract；
- `contracts/conversation_read_cursor.schema.json`：每 Principal/Session Cursor Contract；
- `contracts/conversation_control_command.schema.json`：有界 Control Command Contract；
- `contracts/conversation_generation_fence.schema.json`：Generation Fence Contract；
- `contracts/conversation_control_contracts.d.ts`：P2-005 TypeScript Port 和状态类型；
- `database/migrations/021_p2_005_conversation_control.sql`：只新增四张 `conversation.*` 控制表的增量迁移；
- `scripts/p2-005-migrate.mjs`：只应用或检查 migration 021 的受限迁移入口；
- `src/p2-005-conversation-control.mjs`：命令规范化、幂等、授权、控制服务、Cursor 与 Fence；
- `src/p2-005-conversation-control-projections.mjs`：纯 Timeline/Realtime Mapper；
- `tests/p2-005-conversation-control.test.mjs`：Contract/Unit 测试；
- `tests/p2-005-conversation-control.integration.test.mjs`：隔离 PostgreSQL 并发、故障、资源与清理测试；
- `tests/helpers/p2-005-postgres-harness.mjs`：随机隔离 PostgreSQL 测试环境。

## P2-004 契约、迁移、运行时与测试

- `docs/40_p2_004_unified_communication.md`：Communication 事实、事务、Sender、Worker、Reconciliation、兼容与投影边界；
- `contracts/communication_message.schema.json`：Message Contract；
- `contracts/communication_delivery.schema.json`：Delivery 安全视图 Contract；
- `contracts/communication_internal_note_command.schema.json`：Internal Note Command Contract；
- `contracts/communication_system_notification.schema.json`：System Notification Command Contract；
- `contracts/communication_contracts.d.ts`：Message/Outbox/Delivery/Attempt/Port 类型；
- `database/migrations/020_p2_004_unified_communication.sql`：只新增四张 `communication.*` 表的增量迁移；
- `scripts/p2-004-migrate.mjs`：只应用/检查 migration 020 的受限迁移入口；
- `src/p2-004-communication-core.mjs`：Command 规范化、Hash、原子提交、目的地解析与 P1 兼容 Adapter；
- `src/p2-004-communication-sender-port.mjs`：Mock-only Sender Port；
- `src/p2-004-communication-delivery-worker.mjs`：有界单并发 Worker、Lease、Retry、Unknown 与 Reconciliation；
- `src/p2-004-communication-projections.mjs`：纯 Timeline/Realtime/Legacy Mapper；
- `tests/p2-004-communication-core.test.mjs`：Contract/Unit 测试；
- `tests/p2-004-communication-core.integration.test.mjs`：隔离 PostgreSQL、Worker、故障、兼容与资源测试；
- `tests/helpers/p2-004-postgres-harness.mjs`：随机隔离 PostgreSQL 测试环境；
- `tests/helpers/p2-004-worker-child.mjs`：受控 Worker 子进程入口；
- `tests/helpers/p2-004-worker-process-harness.mjs`：真实 `SIGKILL`/重启编排。

## P2-002 契约、迁移、运行时与测试

- `docs/38_p2_002_timeline_projector.md`：持久 Timeline Projector、Checkpoint 与 Rebuild
  运行契约；
- `contracts/conversation_projection_source.schema.json`：隐私裁剪后的 Source Record
  JSON Schema；
- `contracts/conversation_projection_checkpoint.schema.json`：全局 Projection Checkpoint
  安全视图 JSON Schema；
- `contracts/conversation_projection_contracts.d.ts`：Source、Binding、Checkpoint、Audience、
  Projector 与 Adapter 类型；
- `database/migrations/011_p2_002_timeline_projector.sql`：Item、Source Binding 与 Projection
  Checkpoint 三表增量迁移；
- `src/p2-002-timeline-projector.mjs`：规范化、Mapper、Projector、Query、Worker 与单 Session
  Rebuild 运行时；
- `scripts/p2-002-migrate.mjs`：只应用/检查 migration 011 的受限迁移入口；
- `scripts/p2-002-rebuild.mjs`：默认 check、显式双重批准 apply 的单 Session Rebuild 入口；
- `tests/p2-002-timeline-projector.test.mjs`：P2-002 Contract/Unit 测试；
- `tests/p2-002-timeline-projector.integration.test.mjs`：隔离 PostgreSQL 集成、故障、资源与
  清理测试；
- `tests/helpers/p2-002-postgres-harness.mjs`：P2-002 隔离 PostgreSQL 测试环境；
- `tests/helpers/p2-002-migrate-process-harness.mjs`：迁移 CLI 子进程验证编排；
- `tests/helpers/p2-002-migrate-child.mjs`：migration 011 独立子进程入口；
- `tests/helpers/p2-002-worker-process-harness.mjs`：真实 Worker 进程 `SIGKILL`/重启编排；
- `tests/helpers/p2-002-worker-child.mjs`：受控 Worker 子进程入口。

## P2-003 契约、迁移、运行时与测试

- `docs/39_p2_003_realtime_event_log_sse.md`：非权威 Event Log、授权 replay、SSE、backpressure、fallback 与 retention 契约；
- `contracts/conversation_realtime_event.schema.json`：Realtime Event Command Schema；
- `contracts/conversation_realtime_fallback.schema.json`：Polling Fallback Schema；
- `contracts/conversation_realtime_contracts.d.ts`：Realtime Event、Authorization、SSE、Fallback 与 Retention 类型；
- `database/migrations/012_p2_003_realtime_event_log.sql`：Realtime Event 与 Stream State 权威增量迁移；
- `src/p2-003-realtime-event-log.mjs`：规范化、identity/hash、caller-owned append、授权 replay 与 retention runtime；
- `src/p2-003-realtime-sse.mjs`：SSE handler、wakeup/recovery、heartbeat、capacity 与 slow-client runtime；
- `scripts/p2-003-migrate.mjs`：只应用/检查 migration 012 的受限迁移入口；
- `scripts/p2-003-retention.mjs`：默认 check、显式双重批准 apply 的连续前缀清理入口；
- `tests/p2-003-realtime-event-log.test.mjs`：P2-003 Contract/Unit 测试；
- `tests/p2-003-realtime-event-log.integration.test.mjs`：隔离 PostgreSQL、localhost SSE、故障、资源与残留集成测试；
- `tests/helpers/p2-003-postgres-harness.mjs`：随机隔离 PostgreSQL 测试环境；
- `tests/helpers/p2-003-sse-harness.mjs`：localhost SSE server/client 编排；
- `tests/helpers/p2-003-server-child.mjs`：受控 SSE 子进程入口；
- `tests/helpers/p2-003-client-harness.mjs`：SSE client、fallback request 与 socket 生命周期编排；
- `tests/helpers/p2-003-cli-process-harness.mjs`：migration/retention CLI 子进程编排；
- `tests/helpers/p2-003-realtime-fixtures.mjs`：纯合成 Event、Authorization 与数据库 fixture。

## 设计与契约

- `docs/33_conversation_center_and_handoff.md`；
- `docs/34_ai_context_and_deepseek.md`；
- `docs/35_unified_ticket_and_intranet_connectors.md`；
- `docs/36_2c4g_deployment_capacity.md`；
- `docs/37_parallel_delivery_and_acceptance.md`；
- `contracts/conversation_center.openapi.yaml`；
- `contracts/conversation_reply_command.schema.json`；
- `contracts/ai_conversation_turn.schema.json`；
- `contracts/integration_event.schema.json`；
- `contracts/domain_events.md`；
- `database/schema_draft.sql`：概念草案，禁止直接执行。

## 配置与图

- `config_examples/conversation_policy.example.json`；
- `config_examples/integration_source.example.json`；
- `config_examples/resource_limits.2c4g.example.json`；
- `architecture/conversation_center.mmd`；
- `architecture/intranet_integration.mmd`；
- `architecture/overall_architecture.mmd`；
- `architecture/deployment_topology.mmd`；
- `architecture/message_sequence.mmd`。

## 自动校验

- `scripts/validate-v1-4-architecture.mjs`；
- `tests/v1-4-architecture-baseline.test.mjs`；
- `scripts/validate-arch-006-rule-first-service-loop.mjs`；
- `tests/arch-006-rule-first-service-loop.test.mjs`；
- V1.3 同名脚本保留为兼容入口并委托 V1.4 校验。

## ARCH-006 架构

- `docs/50_arch_006_ai_optional_rule_first_service_loop.md`：AI-off 主闭环、不变量、双责任、Readiness 和 Gate 指标；
- `docs/51_rule_first_intake_manual_review.md`：十类一等确定性结果和 Contact Journey/Manual Review 契约；
- `docs/52_full_ticket_lifecycle_workbench_notifications.md`：既有 Ticket Action、API、UI、Reporter Timeline 和通知链；
- `docs/53_human_confirmed_incident_before_ai.md`：P2-012 人工确认 Incident 边界；
- `docs/54_p2_g2_deterministic_full_service_loop_gate.md`：新 P2-G2 验收与后续 Gate；
- `architecture/rule_first_service_loop.mmd`、`deterministic_intake_sequence.mmd`、`full_ticket_lifecycle.mmd`、`incident_human_confirmation.mmd`：ARCH-006 Mermaid 视图。

## P2-015 实现

- `database/migrations/030_p2_015_rule_first_intake_orchestration.sql`：六张 `intake.*` 表与 Intake Event Check 的权威增量迁移；
- `contracts/p2_015_*.schema.json` / `p2_015_contracts.d.ts`：Journey、Leg、continuation、Decision、Review、Safe Action 与内部编排契约；
- `src/p2-015-*.mjs`：确定性路由、持久化 Store、安全 Port/Executor、内部 Query 与单 Worker；
- `scripts/p2-015-migrate.mjs` / `p2-015-reconcile.mjs` / `validate-p2-015-rule-first-intake.mjs`：迁移、catalog 对账和静态关闭线；
- `tests/p2-015-*.test.mjs` / `tests/p2-015-*.integration.test.mjs`：纯函数、隔离 PostgreSQL、并发、kill/restart、容量、隐私和资源验证；
- `tests/fixtures/p2-015/`：对冻结 P2-007 96 + 42 + 64 案例的 ID-only 人工金标引用。

## Evidence

- `evidence/v1-3-architecture-increment-report.md`：历史 V1.3 报告，已标记 Superseded；
- `evidence/v1-4-architecture-increment-report.md`：V1.4 当前报告。
