# 会话、人工沟通与投递

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主：W。调用方：[既有会话 UI](../../../web/p2-workbench/workbench.js)。实现：[HTTP 路由](../../../src/p2-006-workbench-http.mts)、[query](../../../src/p2-006-workbench-query.mts)、[command facade](../../../src/p2-006-workbench-command-facade.mts)、[授权](../../../src/p2-006-workbench-authorization.mts)。工厂使用enabled参数；持久政策Flag为默认false的 `HUMAN_WORKBENCH_V2_ENABLED`，获授权G1装配显式enabled:true。消息外发还受通信/实际sender授权和开关约束。

## 查询入口

所有 ID 为 UUID；读取要求内部身份和对象级权限。除注明外成功为 200，详情响应直接是对象。

| METHOD + PATH | Query / Header | 响应字段 |
| --- | --- | --- |
| `GET /api/workbench/bootstrap` | 无必需 query | `authenticated:true, principal, expires_at, expires_epoch_ms, csrf_token?, capabilities[], feature_status, polling_interval_ms:5000, sse_endpoint, max_page_sizes` |
| `GET /api/conversations` | `state` 默认 open；`cursor?`；`limit` 默认 30、最大 100 | `{items:[ConversationSummary],next_cursor}` |
| `GET /api/conversations/{sessionId}` | 无必需 query | `session,assignment,handoff,read_cursor,unread_count,ticket,incident,attachments,delivery_summary,capabilities,etag`；Header ETag |
| `GET /api/conversations/{sessionId}/items` | `before_sequence?` / `after_sequence?` 互斥；`limit` 默认 50、最大 200 | `{session_id,items:[Item],has_more,before_sequence,after_sequence}` |
| `GET /api/conversations/{sessionId}/eligible-principals` | 无必需 query | `{items:[{principal_id,display_name,actions[]}]}`；actions为TRANSFER_TARGET，可加FORCE_TRANSFER_TARGET |
| `GET /api/conversations/{sessionId}/deliveries` | 无必需 query | `{items:[Delivery]}`，最多 100 |

`state` 接受 `open|waiting_human|mine|unassigned|waiting_user|failed_delivery|ended`。会话 `row_version` 在此HTTP投影为number，`sequence_no`为十进制string。Summary包含 `session,queue_state,channel_label,assignment,handoff,last_item,unread_count,ticket,latest_delivery,waiting_duration_seconds,capabilities`。Session含 `session_id,status,control_mode,generation_version,row_version,last_activity_at`；详情read_cursor为 `{last_read_sequence:string,row_version:number}`。

Item 字段为 `item_id,sequence_no,item_type,sender_kind,visibility,text,safe_content,occurred_at`。Assignment 含 `status,version,assigned_to_me,assigned_display_name,assigned_at`；Delivery 含 `delivery_id,status,channel,attempt_count,last_error_code,side_effect_state,sent_at`。普通内部角色可见 INTERNAL/EXTERNAL，RESTRICTED 需 ADMIN。前端不能把内部 Item 转发给成员端。

完整投影定义：[bootstrap schema](../../../contracts/workbench_bootstrap.schema.json)、[page schema](../../../contracts/workbench_conversation_page.schema.json)、[detail schema](../../../contracts/workbench_conversation_detail.schema.json)、[types](../../../contracts/workbench_contracts.d.ts)。查询的扩展字段及精确 null/省略行为以 query 和相应测试核对，旧 types 并非所有扩展字段的完整枚举。

合成空会话列表响应：

```json
{"items":[],"next_cursor":null}
```

## 会话命令

除 read-cursor 外，共同 body 为 `client_command_id:UUID`、`expected_row_version:number>=1`，可选 `reason_code`（大写 code，默认 `WORKBENCH_<COMMAND>`）；Header 需 `Idempotency-Key`、`If-Match: "<expected_row_version>"`，Cookie 另需 CSRF/Origin。未列字段拒绝。

| METHOD + PATH | 额外 body | 成功 status / 服务 |
| --- | --- | --- |
| `POST /api/conversations/{sessionId}/handoff/request` | 无 | 200；requestHandoff |
| `POST /api/conversations/{sessionId}/handoff/cancel` | `handoff_id?:UUID` | 200；cancelHandoff |
| `POST /api/conversations/{sessionId}/takeover` | `target_principal_id?:UUID` 默认当前坐席；`handoff_id?:UUID` | 200；takeover |
| `POST /api/conversations/{sessionId}/transfer` | `target_principal_id:UUID` 必需；`force?:boolean`，force=true 时必需 reason_code | 200；transfer；强制转派仍检查服务端角色 |
| `POST /api/conversations/{sessionId}/release` | 无 | 200；release |
| `POST /api/conversations/{sessionId}/read-cursor` | 改用 `expected_cursor_row_version:number>=0,last_read_sequence:number>=0`（安全整数）；不传expected_row_version | 200；advanceReadCursor；不要求If-Match |
| `POST /api/conversations/{sessionId}/messages` | `text:string` 1..20480；`message_type?` 默认 text；`reply_to_item_id?` | 202；reply，入统一 Communication/Outbox |
| `POST /api/conversations/{sessionId}/internal-notes` | `text:string` 1..20480 | 201；internalNote，不外发 |

响应为底层 control/communication 的结果对象，经 facade 处理；不是 Ticket DTO。控制结果与事件见 [control types](../../../contracts/conversation_control_contracts.d.ts)，消息结果见 [communication types](../../../contracts/communication_contracts.d.ts)。成功后重新读详情，202 和 SDK ACK 均不能代表客户端可见发送成功。

合成接管请求：

```http
POST /api/conversations/11111111-1111-4111-8111-111111111111/takeover
Content-Type: application/json
Idempotency-Key: 22222222-2222-4222-8222-222222222222
If-Match: "3"
X-CSRF-Token: <bootstrap.csrf_token>
Origin: <workbench-origin>
```

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_row_version":3,"reason_code":"WORKBENCH_TAKEOVER"}
```

## 通信 Delivery 控制

| METHOD + PATH | Body（均需 client_command_id） | 成功 |
| --- | --- | --- |
| `POST /api/deliveries/{deliveryId}/retry` | `reason_code?` | 200，底层 delivery control 结果 |
| `POST /api/deliveries/{deliveryId}/reconcile` | `reason_code` 和 `resolution` 必需；`CONFIRMED_SENT\|CONFIRMED_NOT_SENT_REQUEUE\|CANCEL` | 200，显式核对结果 |

不要求 If-Match。实现：[delivery control](../../../src/p2-006-workbench-delivery-control.mts)。PENDING 可幂等 no-op；普通 retry 不处理 UNKNOWN/RECONCILIATION_REQUIRED，ADMIN 才可显式 reconcile。Ticket 通知另用 [Ticket delivery 路由](tickets.md)，不要混用两个资源域。

## 失败与限制

共享错误见公共约定；本模块常见 `WORKBENCH_UNAUTHENTICATED/AUTH_EXPIRED/FORBIDDEN/NOT_FOUND/CSRF_INVALID/ORIGIN_INVALID/VERSION_CONFLICT/IDEMPOTENCY_MISMATCH`，投递控制还有 `WORKBENCH_DELIVERY_RETRY_FORBIDDEN/DELIVERY_RECONCILIATION_REQUIRED`。版本冲突刷新后再决定新意图；网络未知结果保持原 ID。

`GET /api/attachments/*` 当前明确返回 404 `WORKBENCH_ATTACHMENT_NOT_AVAILABLE`。会话 detail 中 Incident/attachments 的 available:false 是这一参考视图的状态，不代表独立 Incident API 未实现。

核对测试：[unit](../../../tests/p2-006-workbench.test.mjs)、[integration](../../../tests/p2-006-workbench.integration.test.mjs)。更详细背景：[P2-006](../../42_p2_006_realtime_web_workbench.md)。这些是验证入口，不声明本轮重跑了业务验收。
