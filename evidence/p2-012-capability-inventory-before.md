# P2-012 实现前能力盘点

- 基线：30a394e85973f5a300b841b23d2c358998796ba6；授权提交：f8d29caf50816ab90f3debf14995085158460784。
- 证据类型：仓库源码/迁移检查，非现场数据库或客户端观察；Asia/Shanghai，2026-09-04。
- 精确源码路径与 SHA-256 见同名 JSON。

## 已有能力

P2-007 产生候选，creates_incident=false。P2-015 可持久化 INCIDENT_REVIEW_CANDIDATE、Decision、Manual Review、Safe Action。P2-016 提供人工复核、完整 Ticket UI、模板卡片 Sender 和 Reporter-safe Timeline。Communication/Outbox/Delivery 归 P2-004/P2-016，内部 durable SSE 归 P2-003。

所有已编号迁移中真实 incident Aggregate 与 ReporterSubscription 均不存在；候选自动创建 Incident、自动 Ticket Link、自动公共广播路径均为 0。Ticket UI 与 Ticket 通知不算 Incident 能力。

## 缺口

- Candidate Review state
- Incident Aggregate
- IncidentReport
- ReporterSubscription
- command receipt and idempotency
- append-only Incident Event
- primary Ticket reference
- human confirm/reject
- manual link/unlink
- individual reporter recovery
- Incident Workbench
- public/private notification policy
- Reporter-safe Incident milestone
- separately approved targeted live validation
- P2-015 transport of complete frozen Candidate fields

## 冻结边界与漂移

ADR-0015 初始人工复核窗口为 5 分钟；src/p2-007-incident-candidate.mjs 的 DEFAULT_THRESHOLDS.correlation_window_ms 为 120000。本任务不修改 P2-007、不改为 300000、不在 P2-012 重建阈值。校准属于单独授权任务/P2-G2 试点；窗口不是自动 Incident 规则。

当前 P2-015 safe_result 只保留候选标志及安全事实，未携带完整候选指纹、数量和窗口。需要新 Decision 的窄兼容传递接口，旧 Decision 不回填或重算 hash，缺证据必须显示不可确认。现有身份权威为 P2-015 的稳定内部 reporter binding/HMAC；尚无 SYSTEM_PERSON_ID 人员实体，不创建人员主数据表。

本盘点生成时尚无 P2-012 Runtime/DB/UI 实现。未执行真实企业微信、数据库迁移或模型/OCR/RAG。
