# V1.4 开发阶段任务

## Gate 0

企业微信能力验证，已完成并冻结。

## Phase 1

企业微信外网试点。P1-012 已完成真实 E2E、故障演练和 Go/No-Go；Phase 1 于 2026-08-30 获项目负责人正式批准，状态为 `DONE / GO`。

## Phase 2

状态：`IN_PROGRESS`。P2-001 至 P2-007、P2-G1、ARCH-005、ARCH-006 已完成，当前无活动任务或 Lane。下一候选 P2-015 未授权；P2-016、P2-012、P2-008 至 P2-014 与 P2-G2 至 P2-G5 仍为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，全部 Feature Flag 保持 `false`。

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
