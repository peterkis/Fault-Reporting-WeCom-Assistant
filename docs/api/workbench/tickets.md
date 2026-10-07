# 工单生命周期与双责任

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主：W，P2-016 扩展。调用方：[lifecycle UI](../../../web/p2-workbench/lifecycle.js)。默认关闭：`TICKET_LIFECYCLE_WORKBENCH_ENABLED`。实现：[HTTP](../../../src/p2-016-workbench-http.mts)、[query](../../../src/p2-016-ticket-query.mts)、[command facade](../../../src/p2-016-ticket-command-facade.mts)、[command ledger](../../../src/p2-016-ticket-command-ledger.mts)。Ticket 是唯一编号/状态/处理责任事实源，Conversation Assignment 单独管理沟通责任。

## 查询

| METHOD + PATH | 输入 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | `principal_id,display_name,csrf_token`（Bearer 为 null）、`internal_beta:true,ai_enabled:false,roles[],polling_interval_ms:5000,source_group_directory_enabled:boolean`（默认false） |
| `GET /api/tickets` | `state` 默认 queued；`cursor?`；limit 默认 30、最大 100 | `{items:[TicketDetail],next_cursor}` |
| `GET /api/tickets/{ticketId}` | UUID，无 query | TicketDetail；ETag 为 `"<version>"`；此路由未实现 If-None-Match/304 |
| `GET /api/tickets/{ticketId}/events` | cursor?；limit 默认 30、最大 200 | `{items:[TicketEventProjection],next_cursor}` |
| `GET /api/tickets/{ticketId}/responsibility` | 无 query | ResponsibilityView |
| `GET /api/tickets/{ticketId}/deliveries` | 无 query | `{items:[TicketNotification]}`，最多 100 |
| `GET /api/tickets/{ticketId}/eligible-principals` | 无 query | `{items:[{principal_id,display_name}]}`，最多 100 |
| `GET /api/tickets/{ticketId}/reporter-contact` | 无 query | 已授权的联系资料投影，见下文 |

state：`queued|accepted|in_progress|waiting_requester|waiting_vendor|resolved|closed|reopened|cancelled|unassigned|mine|failed_delivery`；queued 包含 NEW/QUEUED。未知 query 参数拒绝。ADMIN/DISPATCHER 广域读取；HANDLER 按处理人/团队读取。对象越权以不可见处理，不能由猜测 Ticket UUID 扩大范围。

TicketDetail：`id,ticket_no,request_type,status,priority,resolver_team_id,assignee_id,version:number,created_at,updated_at,intake_id,external_status,allowed_actions[]`；Web 来源可增加 `web_report`。后者含 `source_kind,description,location:{text,unknown},service_code,impact_scope,reported_department_text,extension,supplements:[{input_revision,text}]`，保留期后字段可能不可用，不是任意原始 Channel payload。

事件投影：`event_id,event_type,old_status,new_status,aggregate_version,event_ordinal,created_at,has_internal_note,has_external_note`。责任投影：`ticket_id,ticket_assignee_id,ticket_assignee_name,resolver_team_id,resolver_team_name,conversations[]`；每条 conversation 含 `session_id,session_row_version:string,combined_accept_allowed,conversation_principal_id,conversation_principal_name,assignment_status,assignment_version`。复合命令使用前须按命令要求将可验证的会话版本转成安全整数。

Notification：`notification_type,destination_type,delivery_id,status,side_effect_state,attempt_count,sent_at,created_at`；SENT/ACKNOWLEDGED 的技术含义不替代现场客户端观察。

`reporter-contact` 顶层：`status,contact,departments[],fetched_at`。历史 contact 可含 `name,userid,mobile,telephone`，department 含 `name,department_ref,role`。第三方来源可增加 `sex,current_profile`；current_profile 含 `status,contact:{name,mobile},sex,avatar_url,departments,fetched_at`。缺资料为 DEFERRED/STALE 与 null，不伪造联系方式。这是内部授权接口，不提供给 Reporter/成员 UI。

完整约束：[detail](../../../contracts/p2_016_ticket_detail.schema.json)、[list](../../../contracts/p2_016_ticket_list.schema.json)、[responsibility](../../../contracts/p2_016_responsibility_view.schema.json)、[types](../../../contracts/p2_016_contracts.d.ts)。联系资料和事件子查询的精确字段以 query 代码为准。

## 状态、备注与转派命令

以下每行均为具体 POST 路由；没有 `/actions/` 段。共同字段：`client_command_id:UUID,expected_version:number>=1,reason_code:string`（大写 code，最长 64）；可选 `note:string` 1..2000、`external_visible:boolean` 默认 false。Header：幂等、CSRF/Origin、`If-Match: "<expected_version>"`。

| METHOD + PATH | 语义 / 额外输入 |
| --- | --- |
| `POST /api/tickets/{ticketId}/queue` | 入队 |
| `POST /api/tickets/{ticketId}/accept` | 接单 |
| `POST /api/tickets/{ticketId}/start` | 开始处理 |
| `POST /api/tickets/{ticketId}/request-information` | 请求补充 |
| `POST /api/tickets/{ticketId}/wait-vendor` | 等待供应商 |
| `POST /api/tickets/{ticketId}/resume` | 恢复处理 |
| `POST /api/tickets/{ticketId}/resolve` | 解决 |
| `POST /api/tickets/{ticketId}/confirm` | 确认恢复 |
| `POST /api/tickets/{ticketId}/reopen` | 重新打开 |
| `POST /api/tickets/{ticketId}/cancel` | 取消 |
| `POST /api/tickets/{ticketId}/notes` | facade action=`add-note`，note 文本；内部备注不外发 |
| `POST /api/tickets/{ticketId}/transfer` | facade action=`transfer-assignment`；必需 `target_principal_id:UUID`，可选 `resolver_team_id` |

具体状态迁移和角色由 [Action 服务](../../../src/p1-006-ticket-state-actions.mts) 与 query 的 allowed_actions 决定；不要用前端枚举绕过状态检查。`auto-close` 只在获授权 SYSTEM job，未开放 HTTP。

200 成功结果：`{ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id,replayed}`。失败 ledger 结果：`{ok:false,error:{code,retryable},replayed}`；HTTP 按结果映射为 403/409/503。重复命令先核对当前权限，再读取原结果；改 payload 不能沿用同一 ID。

合成接单成功响应（之后仍应重读详情）：

```json
{"ok":true,"ticket_id":"11111111-1111-4111-8111-111111111111","ticket_version":5,"ticket_event_id":"33333333-3333-4333-8333-333333333333","control_event_id":null,"replayed":false}
```

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_version":4,"reason_code":"WORKBENCH_CONFIRMED"}
```

## 原子接管并接单

`POST /api/conversations/{sessionId}/takeover-and-accept-ticket`：必需 `client_command_id,ticket_id,expected_ticket_version:number,expected_session_row_version:number,reason_code`；Header If-Match 对**会话版本**。Session 和 Ticket 来源必须匹配、combined_accept_allowed 且当前权限成立。两种责任在同一事务内全部成功或回滚，结果同 Ticket 命令并含 control_event_id。

[combined schema](../../../contracts/p2_016_combined_takeover_accept.schema.json)、[transfer schema](../../../contracts/p2_016_ticket_transfer_command.schema.json)、[action schema](../../../contracts/p2_016_ticket_action_command.schema.json)。

## Ticket 通知控制

| METHOD + PATH | Body | 成功 |
| --- | --- | --- |
| `POST /api/tickets/{ticketId}/deliveries/{deliveryId}/retry` | client_command_id、reason_code 必需 | 200 `{ok:true,delivery_id,status,replayed}` |
| `POST /api/tickets/{ticketId}/deliveries/{deliveryId}/reconcile` | 同上，加 resolution=`CONFIRMED_SENT\|CONFIRMED_NOT_SENT_REQUEUE\|CANCEL` | 同上 |

这两条无需 If-Match，仍需幂等和身份/CSRF，检查 delivery 属于该 Ticket。[控制实现](../../../src/p2-016-delivery-control.mts)。UNKNOWN 不可普通重发；核对操作须具备相应权限。

常见码：`P2_016_FORBIDDEN/NOT_FOUND/VERSION_CONFLICT/COMMAND_CONFLICT/ACTION_FAILED/TARGET_INVALID/CONTROL_CONFLICT/DELIVERY_STATE_CONFLICT`，以及主宿主 WORKBENCH 错误。详情刷新不能等于命令成功。

核对测试：[HTTP integration](../../../tests/p2-016-workbench-http.integration.test.mjs)、[auth integration](../../../tests/p2-016-workbench-auth.integration.test.mjs)。背景：[生命周期与双责任](../../59_p2_016_ticket_lifecycle_and_responsibility.md)。无新增数据库或生产权限。
