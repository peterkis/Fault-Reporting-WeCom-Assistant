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
- `tasks/P2-002_persistent_timeline_projector.md`：当前 P2-002 投影任务记录；
- `evidence/p2-phase-start-authorization.md`：Phase 2 启动及仅授权 P2-001 的负责人 Evidence；
- `evidence/p2-001-conversation-contracts-report.md`：P2-001 脱敏验证 Evidence；
- `evidence/p2-002-start-authorization.md`：仅启动 P2-002 的项目负责人独立授权 Evidence。

## ADR

- `adr/0007_pilot_ticket_core_then_adapter.md`：Superseded 历史指针；
- `adr/0010_unified_ticket_core_source_of_truth.md`：Unified Ticket Core 权威；
- `adr/0011_lightweight_conversation_center_2c4g.md`：轻量 Conversation Center；
- `adr/0012_greenfield_p3_no_historical_ticket_compatibility.md`：P3 绿地化、取消历史 Ticket 兼容。

## 阶段计划

- `plans/phase_2_ai_enhancement.md`：Conversation Center 与 AI 协作；
- `plans/phase_3_unified_ticket_platform.md`：医院内网新来源接入；
- `plans/phase_3_hospital_integration.md`：Superseded 文件名指针；
- `plans/parallel_workstreams.json`：并行 Lane 和 Assembly Gate。

## 任务

- `tickets/P2_ai_enhancement_tasks.md`：P2-001 至 P2-014；
- `tickets/P3_unified_ticket_platform_tasks.md`：P3-001 至 P3-012；
- `tickets/P3_hospital_integration_tasks.md`：Superseded 指针。

## P2-001 契约与实现

- `CONTEXT.md`：Conversation Center 统一领域语言；
- `contracts/conversation_thread.schema.json`：Thread 契约；
- `contracts/conversation_session.schema.json`：Session 契约；
- `contracts/conversation_item.schema.json`：Item 冻结契约，持久化保留给 P2-002；
- `contracts/conversation_contracts.d.ts`：对应 TypeScript 类型；
- `database/migrations/010_p2_001_conversation_contracts.sql`：Thread/Session 增量迁移；
- `src/p2-001-conversation-contracts.mjs`：身份、边界、状态、控制模式与稳定错误策略；
- `scripts/p2-001-migrate.mjs`：受限迁移入口；
- `tests/p2-001-conversation-contracts.test.mjs`：Contract/Unit 测试；
- `tests/p2-001-conversation-contracts.integration.test.mjs`：隔离 PostgreSQL 集成测试。

## P2-002 授权状态

- 当前唯一活动任务：`P2-002 / P2-A / IN_PROGRESS`；
- `P2-003` 及以后任务与 `P2-G1` 均未授权；
- 所有 P2/P3 Feature Flag 保持 `false`；
- P2-002 实现文件只可在本任务第二个本地提交中加入。

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
- V1.3 同名脚本保留为兼容入口并委托 V1.4 校验。

## Evidence

- `evidence/v1-3-architecture-increment-report.md`：历史 V1.3 报告，已标记 Superseded；
- `evidence/v1-4-architecture-increment-report.md`：V1.4 当前报告。
