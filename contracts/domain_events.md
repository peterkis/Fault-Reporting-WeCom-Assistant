# 领域事件契约

## 公共 Envelope

```json
{
  "event_id": "uuid",
  "event_type": "ticket.accepted",
  "occurred_at": "2026-08-20T01:00:00Z",
  "aggregate_type": "ticket",
  "aggregate_id": "uuid",
  "aggregate_version": 3,
  "trace_id": "trace-id",
  "payload": {}
}
```

## 规则

- `event_id` 全局唯一；
- `aggregate_version` 单调递增；
- Consumer 必须按 `event_id` 幂等；
- 不保证全局顺序，只保证同 aggregate 版本可排序；
- payload 不包含 Bot Secret、患者原始文本或永久附件 URL；
- Schema 变更保持向后兼容。

## 核心事件

### `intake.received`

```json
{
  "intake_id": "uuid",
  "source_channel": "WECOM_GROUP",
  "reporter_wecom_userid": "opaque",
  "request_type": "UNKNOWN"
}
```

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
