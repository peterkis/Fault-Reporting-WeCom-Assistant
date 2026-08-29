# 领域事件契约

> V1.2：Phase 1/2 事件由 Pilot Ticket Core 产生；Phase 3 通过 Ticket Adapter 映射并切换至 Hospital Tickets。事件名表达领域事实，不绑定企业微信 Frame 或医院数据库表。

## 公共 Envelope

```json
{
  "event_id": "uuid",
  "event_type": "ticket.accepted",
  "occurred_at": "2026-08-20T01:00:00Z",
  "aggregate_type": "ticket",
  "aggregate_id": "uuid",
  "aggregate_version": 3,
  "event_ordinal": 7,
  "trace_id": "trace-id",
  "payload": {}
}
```

## 规则

- `event_id` 全局唯一；
- `aggregate_version` 按聚合状态单调非递减；同一原子状态变化可产生多个同版本事件；
- `event_ordinal` 在同一 aggregate 内从 1 严格递增，并与 `aggregate_id` 组成唯一顺序键；
- Consumer 必须按 `event_id` 幂等；
- 不保证全局顺序；同一 aggregate 以内按 `event_ordinal` 确定事件顺序；
- payload 不包含 Bot Secret、患者原始文本或永久附件 URL；
- Schema 变更保持向后兼容。

## 核心事件

### `intake.received`

```json
{
  "intake_id": "uuid",
  "channel_message_id": "opaque-channel-message-id",
  "source_channel": "WECOM_GROUP",
  "reporter_wecom_userid": "opaque",
  "request_type": "UNKNOWN",
  "status": "WAITING_DESCRIPTION"
}
```

### `intake.needs_clarification`

```json
{
  "intake_id": "uuid",
  "channel_message_id": "opaque-channel-message-id",
  "reason": "DESCRIPTION_REQUIRED",
  "message_type": "image"
}
```

### `intake.message_added`

```json
{
  "intake_id": "uuid",
  "channel_message_id": "opaque-channel-message-id",
  "relation_type": "SUPPLEMENT",
  "message_count": 3,
  "request_type": "INCIDENT",
  "status": "RECEIVED"
}
```

### `intake.clarification_added`

```json
{
  "intake_id": "uuid",
  "channel_message_id": "opaque-channel-message-id",
  "relation_type": "CLARIFICATION",
  "message_count": 2,
  "request_type": "INCIDENT",
  "status": "RECEIVED"
}
```

P1-004 将以上 Intake 事件保存在 `intake.service_intake_event` 作为同事务审计事实；这不是 P1-007 的 Notification Outbox，也不会触发通知。payload 不复制原始报修文字、媒体 URL、AES Key、患者文本或 Secret。

### `intake.ticket_created`

```json
{
  "intake_id": "uuid",
  "ticket_id": "uuid",
  "ticket_no": "IT-20260820-0013",
  "external_status": "等待受理"
}
```

### `ticket.accepted`

```json
{
  "ticket_id": "uuid",
  "ticket_no": "IT-20260820-0013",
  "handler_id": "uuid",
  "external_note": "信息科已受理"
}
```

### Ticket lifecycle events

`ticket.created`、`ticket.started`、`ticket.waiting_vendor`、`ticket.resolved`、
`ticket.closed`、`ticket.reopened`、`ticket.information_added` 和
`ticket.auto_close_reminder` 均写入
`pilot_ticket.ticket_event`。所有事件都带有 `ticket_id`、`ticket_no`、
`aggregate_version`、前后状态、operator、`trace_id` 和时间线顺序；仅
`external_note` 可以进入对申报人的通知 payload，`internal_note` 不得复制出去。

```json
{
  "ticket_id": "uuid",
  "ticket_no": "IT-20260829-0013",
  "old_status": "RESOLVED",
  "new_status": "CLOSED",
  "aggregate_version": 6,
  "reason_code": "AUTO_TIMEOUT"
}
```

`ticket.closed` 的 `reason_code=REQUESTER_CONFIRMED` 表示申报人确认；
`reason_code=AUTO_TIMEOUT` 表示系统自动关闭，二者不得混同。P1-010 的卡片
回调、过期、重放和 actor 检查是本地持久化契约，并不声明真实企业微信客户端
的显示或点击结果。

`ticket.auto_close_reminder` 不改变 Ticket 状态；它只记录在自动关闭到期前、由 Outbox
安排的一次提醒事实。自动关闭服务要求该事件已经被写入，不能跳过提醒直接把已解决工单
关闭。

`ticket.duplicate_linked` 与 `ticket.unlinked` 保留给 Phase 2 在存在可审计 Incident/主任务
事实时使用；P1 不生成这两类事件。

### `ticket.waiting_requester`

```json
{
  "ticket_id": "uuid",
  "questions": ["请补充终端编号"],
  "card_task_id": "opaque"
}
```

### `incident.confirmed`

```json
{
  "incident_id": "uuid",
  "incident_no": "INC-20260820-003",
  "summary": "HIS统一认证异常",
  "affected_scope": "MULTI_DEPARTMENT",
  "report_count": 5
}
```

### `notification.delivery_failed`

```json
{
  "outbox_id": "uuid",
  "channel": "WECOM_DIRECT",
  "target_hash": "hash",
  "error_code": "WECOM_SEND_TIMEOUT",
  "attempt_count": 5
}
```
