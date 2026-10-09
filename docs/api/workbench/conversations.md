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

基础会话宿主的 `GET /api/attachments/*` 明确返回 404 `WORKBENCH_ATTACHMENT_NOT_AVAILABLE`。P2016宿主后继默认关闭的[事项附件扩展](attachments.md)有独立的精确下载合同，不从会话引用自动授予读取权。会话 detail 中 Incident/attachments 的 available:false 是这一参考视图的状态，不代表独立 Incident API 未实现。

核对测试：[unit](../../../tests/p2-006-workbench.test.mjs)、[integration](../../../tests/p2-006-workbench.integration.test.mjs)。更详细背景：[P2-006](../../42_p2_006_realtime_web_workbench.md)。这些是验证入口，不声明本轮重跑了业务验收。
## 集中服务会话工作区（WBINT-T22，默认关闭）

W 的 `workbenchConversationsEnabled=false` 控制正式 React `/workbench/app/conversations` 和 `/workbench/app/conversations/{sessionId}`，以及下列新增别名。关闭时新接口返回503、页面不挂载；既有 `/api/conversations` profile 保留。新入口复用现有 Session/Control/Communication/Delivery 权威事实，无新表、迁移或长期 owner。纯 Web 事项没有 Session 时返回空关联，不创建聊天。

所有读取先核对当前活动主体与对象权限。participant/topic 只显示当前保留资料与获权 canonical Item，缺资料明确显示未知；不输出外部用户、群、Bot、Thread 或目标标识。内部浏览器用 Session UUID 作路由，不把 UUID 当显示姓名或授权。当前服务主题按 persisted sequence 读取，时间较早的新材料不丢失；超期材料不返回。

| 方法与完整路径 | 输入与成功响应 |
| --- | --- |
| `GET /api/workbench/conversations` | `state`：open/mine/unassigned/waiting_human/waiting_user/failed_delivery/ended；`cursor?` opaque；`limit?` 默认30/最大100。`{items,next_cursor}`；每项为安全 Session、participant_label/topic/channel_label、assignment、handoff、capabilities、逐对象获权 canonical_item 或 null |
| `GET /api/workbench/conversations/{sessionId}` | 无query；workspace entry，ETag 为 Session row_version |
| `GET /api/workbench/conversations/{sessionId}/items` | `before_sequence?` 或 `after_sequence?` 十进制 string；`limit?` 默认50/最大200。item_id/sequence_no/item_type/sender_kind/visibility/text/occurred_at 与两端边界/has_more |
| `GET /api/workbench/conversations/{sessionId}/eligible-principals` | 当前合法转派候选 `{principal_id,display_name}`；不是任意人员目录 |
| `GET /api/workbench/conversations/{sessionId}/deliveries` | 最大100个实际 Communication Delivery；安全message_id/delivery_id与purpose/status/side_effect_state/channel/attempt_count/last_error_code/sent_at/created_at；按精确 Message 关联 |
| `GET /api/workbench/items/{ticket\|review\|intake}/{itemId}/conversations` | 先授权事项、再授权各真实 Session；`{items}` 最大100，含真实结束主题；无关联为空数组 |
| `POST /api/workbench/conversations/{sessionId}/takeover` | 共同 UUID/expected_row_version；可选reason_code/handoff_id；200，当前合法接管 |
| `POST /api/workbench/conversations/{sessionId}/transfer` | 共同字段+target_principal_id必需，force/reason_code可选；强制需当前角色/原因，200 |
| `POST /api/workbench/conversations/{sessionId}/release` | 共同字段+reason_code可选；200 |
| `POST /api/workbench/conversations/{sessionId}/handoff/request` | 共同字段+reason_code可选；200 |
| `POST /api/workbench/conversations/{sessionId}/handoff/cancel` | 共同字段+reason_code/handoff_id可选；200 |
| `POST /api/workbench/conversations/{sessionId}/messages` | 闭合 `{client_command_id,expected_row_version,text}`；text1..20480，UI最大2000；202仅受理 Message/Outbox/Delivery，不是已发送 |
| `POST /api/workbench/conversations/{sessionId}/internal-notes` | 同一闭合文本形状；201，仅内部 Message，无Outbox/Delivery |
| `GET /api/workbench/conversations/{sessionId}/messages/commands/{commandId}` | 专用只读回复核对；无query/body |
| `GET /api/workbench/conversations/{sessionId}/internal-notes/commands/{commandId}` | 专用只读内部备注核对；无query/body |

POST 使用 UUID Idempotency-Key、`If-Match: "<expected_row_version>"`，Cookie另需当前 CSRF/Origin；后端重查当前动作与转派目标。沟通 Assignment 不改变 Ticket 处理责任/状态。不提供 personal read writes、Delivery retry/reconcile、AI模式或通知写入口。workspace 不接受 quote/外部 target 字段。启用策略下 Bot 群来源人工回复从保留的 Session/Intake/Thread 一致绑定导出原 Reporter PERSON 私聊；浏览器不能选择外发对象。

文本成功为 `{message_id,outbox_id,delivery_ids,command_status,replayed,created_at}`，内部备注 outbox_id=null、delivery_ids=[]。专用 receipt 只返回 `{session_id,client_command_id,state:"UNKNOWN"}`，或 state:"COMMITTED" 加上述安全result；匹配当前可读 Session、原sender主体、固定purpose和AGENT scope。其他主体/用途/不存在统一UNKNOWN，不返回正文、目标或hash。UNKNOWN不表示未提交。同一原UUID/body/version可在新材料推进Session版本后核对已提交结果；fresh UUID仍要求当前版本。

`conversation_workspace_enabled` 是实际workspace能力；`conversation_draft_recovery_enabled` 还要求 raw `workbenchDraftRecoveryEnabled`。旧 Notes 的 `draft_recovery_enabled` 保持仅Notes含义。恢复scope为 principal+conversation+Session+conversation-reply/conversation-note，复用同一浏览器 AES-GCM 非导出密钥、24h/16KiB/20份限制。恢复前fresh bootstrap和当前Session READ/action，当前失权/跨tab清理/abort优先。原UNKNOWN命令正文/版本/UUID不被新材料替换；24h后敏感正文/密钥清理，原opaque UUID只读GET核对，无自动POST。

正式UI列表最多200项、当前主题材料100条×4页最多400、Delivery100，selected查询备用轮询5秒；启用实时全局刷新时使用单一全局周期。新材料不抢焦点或覆盖输入。共享draft对另一用途settlement导致的epoch变化，仅在fresh own authority且同一未过期row/operationbasis时允许内存rebase；此前真正blank的handle仅从sameprincipal完整scoped unrelatedsettled通知进行fresh检查后metadata刷新。普通save fence、logout/revoke/discard/expiry和新标签row优先，不重新创建被清正文。

与已集成T38共用Session中的单一realtime controller；`conversations`、`conversation-view`（包含当前材料/精确Delivery）、`conversation-eligible`、`item-conversations`四个当前主体活动GET family参与同一失效重读。启用realtime时停用selected备用轮询；关闭时保留既有5秒selected回退，不创建新增EventSource。会话读取复用同一授权epoch/AbortSignal栅栏，迟到读取不得恢复已清授权事实。对象403/404只清目标会话草稿/资料，先取消再清含该主体会话关系的聚合查询并仅重读活动family；主体401/bootstrap403继续清全部当前主体。完整fresh周期失败时新的回复/备注/控制不prepare或POST，输入与选择保留；原UNKNOWN的显式同UUID核对及专用只读receipt保持原合同。这里记录源码接入合同；合入新根后的HTTP/生产bundle验证仍按T22当次候选单独记录。

闭合 Schema：[文本命令](../../../contracts/workbench_conversation_text_command.schema.json)、[安全收据](../../../contracts/workbench_conversation_command_receipt.schema.json)、[工作区详情](../../../contracts/workbench_conversation_workspace.schema.json)、[工作区分页](../../../contracts/workbench_conversation_workspace_page.schema.json)、[材料分页](../../../contracts/workbench_conversation_item_page.schema.json)、[精确投递分页](../../../contracts/workbench_conversation_delivery_page.schema.json)。材料的 RESTRICTED visibility 沿既有 ADMIN audience；Schema 取值不授予额外读取权。

关闭新workspace选项可回退，保留已提交的Control/Communication/Delivery事实与旧获权profile。源码：[workspace](../../../src/workbench-conversations.mts)、[production UI](../../../web/admin-workbench/src/features/conversations/Conversations.tsx)、[types](../../../contracts/workbench_conversation_workspace_contracts.d.ts)。当前实际测试与精确候选/资源证据见 [T22执行记录](../../../plans/admin-workbench-integration/execution/t22.md)；不代表真实服务发送、部署或Gate批准。

