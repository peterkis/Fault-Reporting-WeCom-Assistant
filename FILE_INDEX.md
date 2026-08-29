# 文件索引

## 权威入口

- `AGENTS.md`：不可违反的开发规则与阶段边界；
- `README.md`：V1.2 架构摘要；
- `docs/architecture_baseline_status.md`：唯一有效架构、废弃架构、当前 Phase 和迁移路径；
- `plans/current_phase.json`：机器可读当前阶段；
- `plans/roadmap.md`：G0/P1/P2/P3 路线图；
- `plans/master_backlog.json`：机器可读任务状态；
- `tasks/master_backlog.json`：精简任务索引。

## 阶段计划

- `plans/phase_0_wecom_poc.md`：Gate 0；
- `plans/phase_1_public_pilot.md`：公网试点与 Pilot Ticket Core；
- `plans/phase_2_ai_enhancement.md`：AI/OCR 异步增强；
- `plans/phase_3_hospital_integration.md`：Ticket Adapter 与 Hospital Tickets 融合。

## 任务明细

- `tasks/ARCH-001_architecture_baseline_cleanup.md`：已完成的架构基线整理验收记录；
- `tickets/G0_gate0_tasks.md`；
- `tickets/P1_pilot_tasks.md`；
- `tickets/P2_ai_enhancement_tasks.md`；
- `tickets/P3_hospital_integration_tasks.md`。

## Gate 0 证据与 PoC

- `scripts/g0-001-test-wss.ps1` 与 `evidence/g0-001-wss-network-report.md`：WSS 网络路径验证；
- `src/g0-002-sdk-lifecycle.mjs`、`tests/g0-002-sdk-lifecycle.test.mjs` 与 `evidence/g0-002-sdk-authentication-report.md`：官方 SDK 认证、心跳、错误凭据与断开验证；
- `src/g0-003-frame-capture.mjs`、`tests/g0-003-frame-capture.test.mjs` 与 `evidence/g0-003-text-capability-matrix.md`：文本 Frame 的脱敏捕获与能力矩阵；
- `src/g0-004-media-capture.mjs`、`tests/g0-004-media-capture.test.mjs` 与 `evidence/g0-004-media-capability-matrix.md`：图片、图文混排与文件的内存下载/AES 解密、脱敏记录及能力矩阵；
- `src/g0-005-active-push.mjs`、`tests/g0-005-active-push.test.mjs` 与 `evidence/g0-005-active-push-matrix.md`：主动 Markdown 推送、回执、客户端提醒及 Markdown 后独立纯文本 @ 序列的脱敏验证；
- `src/g0-006-template-card.mjs`、`src/g0-006-group-reply-mention.mjs`、对应 `tests/g0-006-*.test.mjs`、`evidence/g0-006-template-card-matrix.md` 与 `evidence/g0-006-group-reply-mention-captures.jsonl`：模板卡片、按钮事件、`task_id`、5 秒更新、重复点击、过期行为，以及绑定群回调 `req_id` 的被动回复 @ 脱敏验证；
- `src/g0-007-stability-soak.mjs`、`tests/g0-007-stability-soak.test.mjs` 与 `evidence/g0-007-stability-report.md`：本机 Windows 连接稳定性、重连、资源采样和消息重放观察；规定浸泡与恢复场景已完成。
- G0-001 至 G0-008（含 G0-006A）均已完成并冻结为 ADR-0009。

## Phase 1 实现与证据

- `src/p1-001-pilot-foundation.mjs`、`tests/p1-001-pilot-foundation.test.mjs`、`docs/20_p1_pilot_foundation.md` 与 `evidence/p1-001-pilot-foundation-report.md`：Pilot 工程骨架、配置边界和本机受控验收；
- `src/p1-002-wecom-sdk-adapter.mjs`、`tests/p1-002-wecom-sdk-adapter.test.mjs`、`contracts/normalized_wecom_message.schema.json`、`docs/21_p1_wecom_sdk_adapter.md` 与 `evidence/p1-002-wecom-adapter-report.md`：SDK Frame 隔离、标准消息契约、opaque 媒体引用和稳定错误码；
- `database/migrations/001_p1_003_channel_message_inbox.sql`、`src/p1-003-channel-message-inbox.mjs`、`scripts/p1-003-migrate.mjs`、`tests/p1-003-channel-message-inbox.test.mjs`、`tests/fixtures/p1-003-inbox-worker.mjs`、`docs/22_p1_channel_message_inbox.md` 与 `evidence/p1-003-channel-message-inbox-report.md`：Channel Message 持久化、数据库并发幂等、原结果快照、隐私/留存输入和本机 PostgreSQL 集成验收；
- `database/migrations/002_p1_004_service_intake.sql`、`src/p1-004-service-intake.mjs`、`scripts/p1-004-migrate.mjs`、`scripts/p1-004-verify.mjs`、`tests/p1-004-service-intake.test.mjs`、`contracts/service_intake.schema.json`、`docs/23_p1_service_intake.md` 与 `evidence/p1-004-service-intake-report.md`：Service Intake、90 秒同上下文聚合、补充/澄清关系、确定性请求分类和 Intake 审计事件的本机 PostgreSQL 集成验收；
- `database/migrations/003_p1_005_pilot_ticket_core.sql`、`src/p1-005-pilot-ticket-core.mjs`、`scripts/p1-005-migrate.mjs`、`tests/p1-005-pilot-ticket-core.test.mjs` 与 `docs/24_p1_pilot_ticket_core.md`：Pilot Ticket Core、Intake 一对一关系和稳定编号；
- `database/migrations/004_p1_006_ticket_state_actions.sql`、`src/p1-006-ticket-state-actions.mjs`、`scripts/p1-006-migrate.mjs`、`tests/p1-006-ticket-state-actions.test.mjs` 与 `docs/25_p1_ticket_actions.md`：显式 Ticket Action、乐观版本和追加式事件；
- `database/migrations/005_p1_007_notification_outbox.sql`、`src/p1-007-notification-outbox.mjs`、`scripts/p1-007-migrate.mjs`、`tests/p1-007-notification-outbox.test.mjs` 与 `docs/26_p1_notification_outbox.md`：Pilot Outbox、Delivery、租约、重试和死信审计；
- `src/p1-008-first-acknowledgement.mjs`、`tests/p1-008-first-acknowledgement.test.mjs` 与 `docs/27_p1_first_acknowledgement.md`：提交后首次确认编排；
- `database/migrations/006_p1_009_pilot_access.sql`、`src/p1-009-pilot-access-workbench.mjs`、`scripts/p1-009-migrate.mjs`、`tests/p1-009-pilot-access-workbench.test.mjs` 与 `docs/28_p1_pilot_access_workbench.md`：Pilot-local 身份、角色、处理组与最小工作台；
- `database/migrations/007_p1_010_ticket_closure.sql`、`database/migrations/008_p1_010_review_hardening.sql`、`src/p1-010-ticket-closure.mjs`、`scripts/p1-010-migrate.mjs`、`tests/p1-010-ticket-closure.test.mjs` 与 `docs/29_p1_ticket_closure.md`：补充、卡片任务回执、关闭前提醒、确认关闭、自动关闭和重开；
- `database/migrations/009_p1_011_pilot_operations_baseline.sql`、`src/p1-011-pilot-operations-baseline.mjs`、`src/p1-011-encrypted-backup.mjs`、`scripts/p1-011-migrate.mjs`、`scripts/p1-011-backup-restore.mjs`、`tests/p1-011-*.test.mjs`、`docs/30_p1_pilot_security_operations.md` 与 `evidence/p1-011-pilot-security-operations-report.md`：安全日志、固定指标告警、不可变运维审计和 AES-256-GCM 本机备份恢复演练；
- `src/p1-012-pilot-e2e.mjs`、`scripts/p1-012-live-e2e.mjs`、`tests/p1-012-*.test.mjs`、`docs/31_p1_e2e_pilot_go_no_go.md` 与 `evidence/p1-012-local-e2e-report.md`：测试群 scoped E2E、真实 Pilot Core 受控演练、WSS 重连、脱敏现场证据和 Go/No-Go 门禁；
- P1-001 至 P1-011 已完成各自本地验收；P1-012 正在执行。没有公网 IP 不阻塞企业微信出站 WSS，但既有注入式 sender/合成卡片仍不构成客户端可见或临床试点验收。

## 其他规格

- `docs/`：PRD、架构、领域、识别、状态、API、数据、安全、测试与运维；
- `docs/18_wecom_temporary_media_constraints.md`：企业微信临时素材三步上传、短期媒体租约、回复/主动投递、时效、限流、隐私和验收约束；
- `docs/32_wecom_global_error_code_governance.md`：企业微信全局错误码权威索引、项目稳定映射、重试纪律、脱敏记录和排障规则；
- `adr/`：架构决策及其取代关系；
- `architecture/`：Mermaid 架构图；
- `contracts/`：机器可读接口和事件契约；
- `config_examples/`：示例配置；
- `examples/`：验收和消息转换样例；
- `source/`：历史来源资料，不是当前执行基线。
