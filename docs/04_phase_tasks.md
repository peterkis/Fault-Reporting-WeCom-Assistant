# V1.4 开发阶段任务

## Gate 0

企业微信能力验证，已完成并冻结。

## Phase 1

企业微信外网试点。P1-012 已完成真实 E2E、故障演练和 Go/No-Go；Phase 1 于 2026-08-30 获项目负责人正式批准，状态为 `DONE / GO`。

## Phase 2

状态：`IN_PROGRESS`。项目负责人已于 2026-08-30 独立授权启动 Phase 2；P2-A 的 P2-001 与 P2-002 均已完成，随后又正式、独立授权仅启动 P2-003。当前唯一活动任务为 `P2-003 / P2-A`；P2-004 至 P2-014 和其他 Lane 实现仍为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，P2-G1 为 `NOT_STARTED`，全部 Feature Flag 保持 `false`。完成 P2-003 后必须停止。

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
