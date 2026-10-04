# V1.4 开发阶段任务

## Gate 0

企业微信能力验证，已完成并冻结。

## Phase 1

企业微信外网试点。P1-012 已完成真实 E2E、故障演练和 Go/No-Go；Phase 1 于 2026-08-30 获项目负责人正式批准，状态为 `DONE / GO`。

## Phase 2

业务阶段状态为 `IN_PROGRESS`；完成任务、Gate 与后续授权以 [业务架构/Gate 状态](architecture_baseline_status.md) 与 `plans/current_phase.json` 及其引用的既有 Evidence 为准。本文件列业务阶段范围，旧任务完成与停止线保留各自历史身份。当前语言迁移见 [TypeScript 迁移执行入口](../plans/typescript-migration/README.md)；迁移 P02 不等于业务任务 P2-002，不推进 P2-G2-LIVE/P2-008。全部持久 Feature Flag 默认 `false`。

范围：

- Conversation Thread/Session；
- 持久 Timeline；
- REST + SSE Workbench；
- 人工分配、接管和 Read Cursor；
- Communication Outbox；
- DeepSeek Shadow/Copilot/Controlled Auto；
- 媒体/OCR；
- Incident；
- 指标和 2C4G 验收。

## Phase 3

范围：

- UnifiedTicket Port；
- Integration Source Registry；
- Inbox/Outbox/Binding/Cursor/Reconciliation；
- 医院身份组织映射；
- 主动出站内网 Connector；
- 新内网门户、医院 API 和监控告警 Adapter；
- 多来源统一 Workbench；
- 第一条生产来源接入与阶段验收。

P3 不包含历史 Ticket 导入、未完结切换、旧状态兼容、双系统切换或旧系统退役。
