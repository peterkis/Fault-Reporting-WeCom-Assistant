# 08. API 接口契约说明

> 当前可调用接口先查 [服务接口导航](api/README.md) 和 [完整HTTP索引](api/endpoint-index.md)。本文件保留早期设计；`/internal/v1/*`、`/api/v1/tickets/*` 等不代表当前已挂载路由，“所有响应包含trace_id”也不适用于全部当前handler。旧Hospital Tickets迁移段落须按V1.4绿地/唯一Unified Ticket Core基线阅读，不作为新任务来源。当前实现与设计差异见 [差异清单](api/design-and-gaps.md)。

完整机器可读契约见 `contracts/openapi.yaml` 和 JSON Schema。

阶段适用性：Phase 1/2 的 Ticket API 由 Pilot Ticket Core 提供；Phase 3 新增 Ticket Adapter 契约并完成向 Hospital Tickets 的迁移。Gateway 和识别服务不得直接调用 Hospital Tickets。

## 1. 设计原则

- 内部接口使用 `/internal/v1`；
- 面向前端使用 `/api/v1`；
- 创建类接口支持 `Idempotency-Key`；
- 工单状态通过 Action API；
- 所有响应包含 `trace_id`；
- 错误使用稳定 `code`；
- Schema 变更遵循向后兼容；
- AI 接口只返回建议。

## 2. Gateway → Intake

### `POST /internal/v1/intakes/wecom`

Header：

```http
Idempotency-Key: {provider}:{msg_id}
Authorization: Bearer <internal-token>
Content-Type: application/json
```

请求核心字段：

```json
{
  "schema_version": 1,
  "provider": "WECOM_AIBOT",
  "idempotency_key": "WECOM_AIBOT:msg-001",
  "msg_id": "msg-001",
  "req_id": "req-001",
  "bot_id": "bot-001",
  "chat_type": "group",
  "chat_id": "group-001",
  "sender_user_id": "zhangsan",
  "msg_type": "mixed",
  "create_time": null,
  "received_at": "2026-08-28T10:00:00Z",
  "content": [
    {
      "kind": "text",
      "text": {
        "raw": "HIS登录报错",
        "clean": "his登录报错"
      }
    },
    {
      "kind": "media",
      "media": {
        "type": "image",
        "source_index": 1,
        "download_ref": "wmr_0123456789abcdef0123456789abcdef"
      }
    }
  ],
  "quote": null
}
```

`req_id` 仅用于通道关联；Inbox 幂等只使用 `provider + msg_id`。Gate 0 真实 Frame 可能没有 `create_time`，此时保持 `null` 并使用 Adapter 记录的 `received_at`，不得伪造提供方时间。`download_ref` 只指向受保护原始回调上下文中的媒体位置，不能替代附件或企业微信 `media_id`。

P1-005 至 P1-010 的可执行编排在同一 Inbox 事务中创建 Intake 和 Pilot Ticket，并在提交后才由首次确认服务尝试投递。咨询、无效请求或未创建 Ticket 的 Intake 不得虚构 `ticket_no`、`ticket_id` 或“处理中”状态；外发 sender 为注入式边界，提交或 SDK ACK 均不等同于客户端可见。

成功响应：

```json
{
  "trace_id": "trace-001",
  "duplicate": false,
  "intake_id": "uuid",
  "ticket_id": "uuid",
  "ticket_no": "IT-20260820-0013",
  "external_status": "等待受理",
  "reply": {
    "template_code": "TICKET_CREATED",
    "variables": {
      "ticket_no": "IT-20260820-0013"
    }
  }
}
```

重复消息响应必须返回原结果：

```json
{
  "duplicate": true,
  "intake_id": "original-intake",
  "ticket_id": "original-ticket",
  "ticket_no": "IT-20260820-0013"
}
```

## 3. 媒体登记

### `POST /internal/v1/messages/{message_id}/media`

Gateway 完成下载、解密和存储后登记：

```json
{
  "object_key": "wecom/2026/08/20/sha256",
  "mime_type": "image/png",
  "size_bytes": 123456,
  "sha256": "...",
  "security_scan_status": "PASSED",
  "sensitivity_level": "UNKNOWN"
}
```

## 4. Ticket Action API

以下 Action 在 Phase 1/2 操作 Pilot Ticket。Phase 3 必须由 Ticket Adapter 或切换后的 Hospital Tickets 兼容层承接相同业务语义。

### 接单

```http
POST /api/v1/tickets/{ticket_id}/actions/accept
```

### 开始处理

```http
POST /api/v1/tickets/{ticket_id}/actions/start
```

### 请求补充

```http
POST /api/v1/tickets/{ticket_id}/actions/request-information
```

### 解决

```http
POST /api/v1/tickets/{ticket_id}/actions/resolve
```

### 确认恢复

```http
POST /api/v1/tickets/{ticket_id}/actions/confirm
```

### 重新打开

```http
POST /api/v1/tickets/{ticket_id}/actions/reopen
```

统一请求：

```json
{
  "expected_version": 4,
  "note": "已重新同步权限",
  "external_visible": true,
  "reason_code": "PERMISSION_RESYNC",
  "attachment_ids": []
}
```

统一响应：

```json
{
  "trace_id": "trace-001",
  "ticket": {
    "id": "uuid",
    "ticket_no": "IT-20260820-0013",
    "status": "RESOLVED",
    "version": 5
  }
}
```

## 5. Card Action API

### `POST /internal/v1/wecom/card-actions`

```json
{
  "task_id": "opaque-task-id",
  "action_key": "still_broken",
  "actor_wecom_userid": "zhangsan",
  "event_req_id": "req-xxx"
}
```

服务端：

- 解析 task；
- 校验 actor；
- 校验过期时间；
- 转换为 Ticket Action；
- 返回卡片更新内容。

P1-010 的本地实现为 `notification.card_action_task` 和 `card_action_receipt`：服务端先校验任务、actor、过期时间和 `event_req_id`，再调用同一 Action 服务；重复事件返回首次响应快照。它是回调处理契约，不是企业微信客户端显示或用户点击的实测结论。

## 6. AI Triage API

### `POST /internal/v1/ai/triage`

请求：

```json
{
  "intake_id": "uuid",
  "text": "HIS 登录提示 HTTP 403",
  "ocr_text_redacted": "HTTP 403 Access Denied",
  "context": {
    "reporter_campus_id": "HQ",
    "reporter_department_id": "CARDIOLOGY"
  },
  "catalog_version": "2026-08-20"
}
```

响应：

```json
{
  "pipeline_version": "triage-v1",
  "model": {
    "name": "local-model",
    "version": "pinned-version"
  },
  "result": {
    "request_type": "INCIDENT",
    "system_code": "HIS",
    "symptom_code": "AUTHORIZATION_ERROR",
    "error_codes": ["HTTP 403"],
    "decision_band": "SUGGEST_ROUTE",
    "evidence": [
      {
        "source": "USER_TEXT",
        "value": "HIS登录"
      },
      {
        "source": "OCR",
        "value": "HTTP 403"
      }
    ]
  }
}
```

AI 响应不得直接包含数据库更新指令或可执行命令。

## 7. Incident API

```text
POST /api/v1/incidents/candidates/{candidate_id}/confirm
POST /api/v1/incidents/{incident_id}/reports/{intake_id}/link
DELETE /api/v1/incidents/{incident_id}/reports/{intake_id}
POST /api/v1/incidents/{incident_id}/actions/publish-update
POST /api/v1/incidents/{incident_id}/actions/resolve
```

## 8. Health API

```text
GET /health/live
GET /health/ready
GET /metrics
```

Readiness 需要：

- Gateway authenticated；
- Database 可用；
- Pilot Ticket Core 可用或处于明确的消息已落库、工单待补建策略；
- 不要求 AI/OCR 可用。

## 9. 错误响应

```json
{
  "trace_id": "trace-001",
  "error": {
    "code": "TICKET_VERSION_CONFLICT",
    "message": "工单状态已更新，请刷新后重试",
    "retryable": false,
    "details": {}
  }
}
```

核心错误码：

```text
VALIDATION_FAILED
UNAUTHORIZED
FORBIDDEN
IDEMPOTENCY_CONFLICT
MESSAGE_ALREADY_PROCESSED
IDENTITY_NOT_MAPPED
TICKET_CREATE_PENDING
INVALID_STATE_TRANSITION
TICKET_VERSION_CONFLICT
CARD_ACTION_EXPIRED
MEDIA_REJECTED
AI_UNAVAILABLE
INTERNAL_DEPENDENCY_UNAVAILABLE
```

## 10. 超时建议

| 调用 | 超时 |
|---|---:|
| Gateway → Intake | 3 秒 |
| Intake → Pilot Ticket Core 创建 | 2 秒，失败进入待补建 |
| Outbox → WeCom send | 5 秒 |
| 媒体下载 | 按大小配置，默认 15 秒 |
| OCR | 10 秒 |
| AI Triage | 15 秒，但不在首次回复链路 |

超时值须经本地测试调整。

## 11. Phase 3 Adapter 契约要求

Phase 3 实施前必须补充机器可读 Ticket Adapter Contract，至少覆盖：

- Pilot/Hospital Ticket 幂等创建和查询；
- `ticket_external_mapping`；
- 状态、事件、备注、附件和身份映射；
- 重放、死信、对账和冲突响应；
- 切换状态与只读保护。

在 P3-003 前，本文件不构成 Hospital Tickets 的可调用契约。


## 12. T32 获权通知异常只读入口

内部职员Session。宿主 `notificationExceptionsEnabled=false` 为默认；能力 `notification_exceptions_enabled` false时GET/static入口404。启用不授新的域或用途权限。

| HTTP | 输入 | 输出/拒绝 |
|---|---|---|
| GET `/api/notification-exceptions` | domain=ALL/TICKET/SESSION/INCIDENT；route=ALL/GROUP/BOT_DIRECT/YIXIAOXIU_APP；state=ALL/FAILED/UNKNOWN；limit默认30/最大50；opaque cursor | items≤limit、has_more、next_cursor；没有total/count；重复/多余字段或混用游标400 |
| GET `/api/notification-exceptions/{ticket\|session\|incident}/{parent_id}/{delivery_id}` | 当前获权同域parent和opaque Delivery ID，无query参数 | 精确安全item；wrong parent/隐藏对象404；未认证401 |

DTO/DTS见 `contracts/workbench_notification_exception_contracts.d.ts`、query/page/item/capability四同名前缀Schema。来源分别为Ticket binding、获权Session外部Message、Incident lifecycle binding以及仍获原T31用途权的public-progress。授权先于分页与has_more；stable created_at/id倒序，HMAC cursor绑定当前主体/范围/筛选，host重启旧cursor重新从首页读。最多四分支各n+1行、最近Attempt一条；事务READ ONLY、statement_timeout2秒，无数据库变更/新长期事实源。

items闭合字段为domain/parent_id/delivery_id/source_kind/route_kind/destination_type/status/side_effect_state/attempt_count/last_attempt/safe_summary/error_code/created_at/updated_at/sent_at/allowed_actions/parent_link。时间为北京时间本地ISO格式、最多6位小数；sent_at不是本人已读。错误仅FAILURE_RECORDED或RESULT_UNCONFIRMED，绝无原始身份、目标/hash/provider/raw receipt、通用Message正文或内部备注。DEAD_LETTER与UNKNOWN待核对独立；仅UNKNOWN的CANCELLED可列。

Ticket/Session actions按现有域控制与当前角色/状态/发送开关投影，正式页面只链接既有域入口，不执行新命令；Incident actions=[]，T33新retry/reconcile仍后续票。public-progress关闭/缺058/失去当前scope时在LIMIT前排除，旧Incident入口不绕读。关闭新查询保留全部原Delivery/Attempt/事件。正式App `/workbench/app/notification-exceptions[/]` 当前页最多10、一条当前已选item，不从每张卡片扇出投递；取消迟到读取，403/404局部裁剪、真实401统一失效。执行证据见本票 `plans/admin-workbench-integration/execution/t32.md`，本地实现待父验收，不等于现场授权。
