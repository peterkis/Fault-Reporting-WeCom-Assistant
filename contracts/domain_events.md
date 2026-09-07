# V1.4 领域事件契约

> Ticket Event 由本系统 Unified Ticket Core 产生。Conversation、AI 和 Integration 事件不改变 Ticket 状态所有权。

## 公共 Envelope

```json
{
  "event_id": "uuid-or-monotonic-id",
  "event_type": "conversation.handoff.accepted",
  "occurred_at": "2026-08-30 08:00:00",
  "occurred_epoch_ms": "1788048000000",
  "aggregate_type": "conversation_session",
  "aggregate_id": "uuid",
  "aggregate_version": 3,
  "event_ordinal": 7,
  "trace_id": "trace-id",
  "schema_version": "1.0",
  "payload": {}
}
```

规则：

- `event_id` 全局唯一；
- 同一 aggregate 按 `event_ordinal` 严格排序；
- Consumer 按 `event_id` 幂等；
- 不保证全局顺序；
- payload 不包含 Secret、AES Key、永久公开附件 URL 或未脱敏患者文本；
- Schema 变更向后兼容；
- Conversation 投影失败可重建；
- Ticket Event 不能由 Conversation、AI 或 Integration 服务伪造。

## Conversation 事件

```text
conversation.thread.created
conversation.session.created
conversation.item.projected
conversation.handoff.requested
conversation.handoff.accepted
conversation.mode.changed
conversation.assigned
conversation.read_cursor.changed
conversation.session.closed
```

`conversation.handoff.accepted` 示例：

```json
{
  "session_id": "uuid",
  "handoff_status": "ACCEPTED",
  "handoff_row_version": 2,
  "session_row_version": 4,
  "generation_version": 6
}
```

P2-005 Control Event 是 Assignment/Handoff/Cursor/Generation 的追加式审计与命令幂等事实；
Realtime Event 只是可清理通知投影。二者与状态变化在同一事务提交，但 Realtime payload 只含
状态/版本，不含 Principal、display name、外部用户标识、正文、Internal Note 或目标。Read Cursor
不写 Timeline Item；Assignment/Handoff 可由纯 Mapper 形成 INTERNAL `HANDOFF_EVENT` Source Record。

## Communication 事件

```text
communication.message.committed
communication.delivery.changed
communication.delivery.sent
communication.delivery.failed
communication.delivery.reconciliation_required
communication.delivery.dead_lettered
communication.delivery.cancelled
```

P2-004 已冻结 Message / committed Outbox / per-target Delivery / Delivery Attempt 事实边界。
人工、AI 和可信 System 通知必须先在同一 PostgreSQL 事务提交 Message、Outbox 和 Delivery，
再由单 Worker 调用 Sender。`visibility=INTERNAL` 或 `purpose=INTERNAL_NOTE` 的消息不得产生
Outbox、Delivery 或外部 Sender 调用。`communication.delivery.changed` 只是未来 P2-G1 可消费的
Realtime 投影事件；P2-004 的纯函数 Mapper 不自动写 P2-002/P2-003 表。

现有 P1 Ticket 通知继续由 `notification.*` 承载，不迁移、不回填、不复制、不重命名、不双写；
Compatibility Adapter 只提供安全只读 View 或委托既有 P1 Worker。

## AI 事件

```text
ai.job.queued
ai.run.completed
ai.run.stale
ai.run.rejected
ai.memory.updated
ai.degraded
```

`ai.run.stale` 示例：

```json
{
  "ai_run_id": "uuid",
  "session_id": "uuid",
  "generation_version_at_start": 8,
  "current_generation_version": 9,
  "reason_code": "HUMAN_TAKEOVER"
}
```

## Ticket 事件

现有 P1 事件继续有效：

```text
intake.received
intake.message_added
intake.needs_clarification
intake.ticket_created
ticket.created
ticket.accepted
ticket.started
ticket.waiting_requester
ticket.waiting_vendor
ticket.information_added
ticket.resolved
ticket.auto_close_reminder
ticket.closed
ticket.reopened
```

长期权威属于 Unified Ticket Core；物理表可继续位于 `pilot_ticket.ticket_event`。

## Incident 事件

```text
incident.candidate_detected
incident.confirmed
incident.report_linked
incident.report_unlinked
incident.updated
incident.mitigated
incident.resolved
incident.closed
subscription.created
subscription.updated
```

## Integration 事件

### `integration.source.registered`

```json
{
  "source_id": "uuid",
  "source_code": "INTRANET_REPORT_PORTAL",
  "source_type": "INTRANET_PORTAL",
  "contract_version": "1.0",
  "status": "TESTING"
}
```

### `integration.event.received`

```json
{
  "source_id": "uuid",
  "source_code": "INTRANET_REPORT_PORTAL",
  "external_event_id_hash": "sha256",
  "external_record_type": "SERVICE_REQUEST",
  "event_type": "SERVICE_REQUEST_SUBMITTED"
}
```

### `integration.event.quarantined`

```json
{
  "source_id": "uuid",
  "inbox_event_id": "uuid",
  "error_code": "IDENTITY_UNMAPPED",
  "retryable_after_mapping": true
}
```

### `integration.reference.bound`

```json
{
  "source_id": "uuid",
  "external_record_id_hash": "sha256",
  "local_aggregate_type": "SERVICE_INTAKE",
  "local_aggregate_id": "uuid",
  "mapping_version": "intranet-request-v1"
}
```

### `integration.projection.acknowledged`

```json
{
  "source_id": "uuid",
  "integration_outbox_id": "uuid",
  "local_event_id": "uuid",
  "external_ack_hash": "sha256"
}
```

### `integration.reconciliation.completed`

```json
{
  "run_id": "uuid",
  "source_id": "uuid",
  "run_type": "PERIODIC",
  "checked_count": 500,
  "explained_difference_count": 3,
  "unexplained_difference_count": 0,
  "status": "PASSED"
}
```

Integration Reconciliation 只用于新来源事件、Binding、Cursor 和外部投影的一致性核验，不表示历史 Ticket 迁移。

## P2-006 Workbench 消费边界

P2-006 不新增 Domain Event 或数据库事实。Workbench 列表/详情只读现有 Conversation、Unified Ticket
Core、Communication 与 Control 投影；命令只调用 P2-004/P2-005 Port。SSE 继续消费 P2-003
`CONVERSATION_WORKBENCH` 事件，Realtime Event 不是业务事实源，Polling/Refetch 不取得状态所有权。

## P2-016 生命周期投影扩展（默认关闭）

新增权威事件仅为 `ticket.assignment_transferred`：追加到原 Ticket Event，包含旧/新处理人和团队的受限 metadata；不创建第二份 Assignment 事实。

以下事件是原事实的内部 durable SSE 投影，不是外部通知或新的业务状态：

- `manual_review.created`、`manual_review.resolved`：仅携带 Review ref、状态和版本；
- `ticket.command.committed`、`ticket.status.changed`、`ticket.assignment.changed`：仅携带 Ticket/Event ref 与版本；
- `ticket.notification.created`、`ticket.notification.delivery_changed`：仅携带 Ticket/Delivery ref 与状态。

有 Session 时按既有 Session Scope 裁剪，否则仅发 SYSTEM scope（内部 ADMIN/DISPATCHER）；HANDLER 仍通过授权查询与 5 秒轮询恢复。载荷没有正文、患者、账号、原始 Provider 错误或 Grant。旧十三种事件和九种 source/aggregate 保留，Migration 031 添加七种事件与 MANUAL_REVIEW source/aggregate。

P2-016 装配使用单调的发布 envelope 时间；业务发生时间仍由原 Ticket/Event/Journey 保存。过期来源不延长保留期，wakeup 失败不回滚已提交事实。Reporter 仅使用独立绑定会话下的只读时间线，不复用内部 SSE 权限。

## P2-012 人工 Incident 事件

Candidate 事件：candidate.review_started / rejected / expired / confirmed，仅 expired 允许 SYSTEM。
Incident 事件：incident.confirmed / investigating / resolved / closed / scope.corrected / primary_ticket_changed；incident.report.linked / unlinked / recovered；incident.subscription.created / activated / paused / ended。

所有事件写入 incident.incident_event，关联原 incident.command_receipt，使用 event_ordinal、payload_hash、无时区秒精度 occurred_at。Candidate 与 Incident 资源严格二选一。旧事件不可更新或删除。内部 SSE 只携带安全 ref/version/status，使用原 conversation.realtime_event，不成为业务事实源。
Reporter 只投影四类人工生命周期 milestone。任何 Incident 命令都不会发布 Ticket 状态变化。完整字段见 p2_012_incident_event.schema.json。
