# 工单生命周期与双责任

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主：W，P2-016 扩展。调用方：[lifecycle UI](../../../web/p2-workbench/lifecycle.js)。默认关闭：`TICKET_LIFECYCLE_WORKBENCH_ENABLED`。实现：[HTTP](../../../src/p2-016-workbench-http.mts)、[query](../../../src/p2-016-ticket-query.mts)、[command facade](../../../src/p2-016-ticket-command-facade.mts)、[command ledger](../../../src/p2-016-ticket-command-ledger.mts)。Ticket 是唯一编号/状态/处理责任事实源，Conversation Assignment 单独管理沟通责任。

## 查询

| METHOD + PATH | 输入 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | `principal_id,display_name,csrf_token`（Bearer 为 null）、`internal_beta:true,ai_enabled:false,roles[],polling_interval_ms:5000,source_group_directory_enabled:boolean,internal_notes_enabled:boolean,ticket_self_handling_enabled:boolean,draft_recovery_enabled:boolean,logout_enabled:boolean`；新增宿主能力默认false，退出仅在实际员工Cookie认证已初始化且有当前CSRF时可用 |
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
| `POST /api/tickets/{ticketId}/notes` | 既有兼容 facade action=`add-note`；保留可选 note／external_visible，默认内部；自由备注不进入外部通知／Reporter 时间线 |
| `POST /api/tickets/{ticketId}/internal-notes` | 默认关闭的专用内部备注；必需非空白 note 和 external_visible=false，详见下文 |
| `POST /api/tickets/{ticketId}/transfer` | facade action=`transfer-assignment`；必需 `target_principal_id:UUID`，可选 `resolver_team_id` |

具体状态迁移和角色由 [Action 服务](../../../src/p1-006-ticket-state-actions.mts) 与 query 的 allowed_actions 决定；不要用前端枚举绕过状态检查。`auto-close` 只在获授权 SYSTEM job，未开放 HTTP。

200 成功结果：`{ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id,replayed}`。失败 ledger 结果：`{ok:false,error:{code,retryable},replayed}`；HTTP 按结果映射为 403/409/503。每次 receipt 查找先重查活动身份和对象可读权限；新写入另查当前动作权限和版本。已 COMMITTED／FAILED 的 receipt 重放只读取原结果，不再次写入，也不重新执行动作许可检查。仅失去写动作但仍可读时可核对旧收据；身份失效或对象失权拒绝收据。改 payload 不能沿用同一 ID。

合成接单成功响应（之后仍应重读详情）：

```json
{"ok":true,"ticket_id":"11111111-1111-4111-8111-111111111111","ticket_version":5,"ticket_event_id":"33333333-3333-4333-8333-333333333333","control_event_id":null,"replayed":false}
```

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_version":4,"reason_code":"WORKBENCH_CONFIRMED"}
```

## 可靠内部备注（WBINT-T02）

W `POST /api/tickets/{ticketId}/internal-notes` 复用现有 `add-note` facade／ledger／事务；新宿主选项 `workbenchInternalNotesEnabled:boolean=false` 与原生命周期开关共同限制入口。未启用返回 `503 P2_016_DISABLED`；关闭此选项不改变旧 `/notes` 兼容合同、已提交 Ticket／事件／receipt 或其他默认开关。无需数据库变更、事实表、进程或连接池。T03 补齐下文专用只读核对入口。

输入 Schema：[专用内部备注](../../../contracts/p2_016_internal_note_command.schema.json)；类型：[P2016InternalNoteCommand](../../../contracts/p2_016_contracts.d.ts)。闭合 JSON 必需五字段：UUID `client_command_id`、安全整数 `expected_version`（1..2147483647）、大写 code `reason_code`（1..64）、`note:string`（1..2000，trim 后必须非空，运行时按 UTF-16 长度约束）、`external_visible:false`。不得带目标、action、ticket_id 或额外字段。客户端只在首次提交前 trim，服务器不改原正文／hash。Cookie 写入沿公共 32 KiB、精确 Origin／CSRF、非 cross-site、Header/body UUID 与 If-Match 数字版本匹配规则。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_version":2,"reason_code":"WORKBENCH_INTERNAL_NOTE","note":"合成内部排查记录","external_visible":false}
```

200 结果沿上文，专用备注的 `control_event_id:null`；无正文或私有身份回传。新增写入保持状态／处理责任，版本增加一次，追加 `ticket.note_added` 的 `internal_note`，`external_note=null`。备注不生成外部通知意图；Reporter 按既有里程碑 allowlist 读取，不能读取此正文。沿用原 principal scope＋UUID，原 payload／版本重放返回原 receipt；改 payload 为 409，陈旧新命令为 409，当前动作拒绝为 403，对象不可读为 404，身份失效为 401／403。事务／SAVEPOINT、通知策略和实时锁顺序保持。

正式 React [TicketNotes](../../../web/admin-workbench/src/features/ticket-notes/TicketNotes.tsx) 只在 `internal_notes_enabled=true` 时读取真实 `GET /api/tickets/{ticketId}`。界面显示服务器当前 `allowed_actions` 和数字 `version`；只有当前 `add-note` 许可才提供新写入，未建单事项不猜测能力。`idle／submitting／checking／succeeded／denied／conflict／unknown` 分别呈现；单表单只允许一个 in-flight。可信成功才清输入并使 context／detail／board 查询失效，重读失败不反转已提交结论。

网络失败、发出后的 abort、200 正文／字段不可信、无法确认的 5xx 均保留不可变原 UUID＋原版本＋原 payload，锁定输入并显式“核对保存结果”重放同一 POST；不自动重试或生成新操作。409 保留输入并重读，用户再次明确提交才产生新意图。可信 401／403／404 即使正文不可解析仍触发授权清理；401 清整个会话，对象拒绝取消并清同对象 detail／command-context、刷新 board。组件卸载 abort 自有 POST，abort 不证明未提交。未启用恢复时草稿／原命令仍只存组件内存，close／move 和 beforeunload 保护保留；启用 T03 后，仅实际持久快照已保存才可安全离开。

## 当前浏览器草稿与只读核对（WBINT-T03）

宿主 `workbenchDraftRecoveryEnabled:boolean=false`；只有 notes 与 recovery 均启用，bootstrap 的 `draft_recovery_enabled` 才为 true。当前消费者是内部备注；通用 [存储](../../../web/admin-workbench/src/features/drafts/encrypted-drafts.ts) 以 `[principal_id,kind,id,purpose]` 隔离，后续表单须定义自身闭合载荷和权限恢复规则，不能直接借用内部备注授权。详见[前端合同](../../../web/admin-workbench/README.md#当前浏览器草稿恢复wbint-t03)和[执行记录](../../../plans/admin-workbench-integration/execution/t03.md)。

W `GET /api/tickets/{ticketId}/internal-notes/commands/{commandId}`：两个 UUID、空 query、无 body、`no-store`；不需写动作、CSRF、If-Match 或 Idempotency-Key。原生命周期、notes、recovery 三开关均须启用；关闭返回 `503 P2_016_DISABLED`，不调用新增 receipt 查询。先核对当前 active principal 与 Ticket 可读权限，再在现有 ledger 的只读事务按 `P2_016:<principal>`、原 command UUID、Ticket 和服务器用途 `WORKBENCH_INTERNAL_NOTE` 查找。无数据库变更、第二 ledger、草稿服务或后台轮询。

闭合输出 [Schema](../../../contracts/p2_016_internal_note_receipt.schema.json)／[P2016InternalNoteReceipt](../../../contracts/p2_016_contracts.d.ts) 必含 `client_command_id,ticket_id,state`：

| state | 额外字段与含义 |
| --- | --- |
| UNKNOWN | 无 result/error；没有收据、STARTED、其他主体／Ticket／用途或旧兼容 notes UUID均不能推断未提交 |
| COMMITTED | `result:{ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id:null,replayed:true}`；只有安全结果引用，无正文、payload、hash或私有身份 |
| FAILED | `error:{code,retryable:false}`；既有明确终态错误，不能把网络或查不到结果转换成此状态 |

身份401／会话403与对象403／404沿可信授权清理；空query外字段400；服务／网络／畸形响应不收口 UNKNOWN。专用 POST 的 receipt 用途只由服务器设置，客户端额外字段拒绝；旧行和原 POST hash／重放语义保留。

POST 前先将不可变原 UUID／版本／payload 成功持久化为密文；失败保留当前输入并阻止本次发送。24h或“丢弃草稿内容”清正文和 CryptoKey，保留最多20个独立 opaque 未核对操作标识；界面仍禁止新UUID，只能按原标识只读核对。COMMITTED／FAILED 才清匹配原标识，UNKNOWN继续保留；不提供普通“忘记”来绕过未知结果。核对旧操作不清后来输入的未提交内容，下一次发送仍须用户明确确认当前版本。已知 POST 成功而本地清理失败仍显示真实成功、禁止新提交并允许同UUID只读核对／重试清理；不降为 UNKNOWN。

资源仍为单 App/API/SSE、复用 pool≤4／同机池预算≤8、SSE32、Worker／Gateway 单活及各 concurrency1；没有新增轮询。关闭方式为显式设 `workbenchInternalNotesEnabled=false` 后装配原宿主；源码回退采用单独 forward／revert，不删除事实。不涉及真实 Provider／OAuth／WeCom、部署、full／certify 或 Gate 推进。隔离 HTTP／生产 bundle 的新旧入口、失权、冲突和未知核对证据见[本票执行记录](../../../plans/admin-workbench-integration/execution/t02.md)。

## 无会话本人承接与开始（WBINT-T04）

W 的 `POST /api/tickets/{ticketId}/take-and-start` 和 `POST /api/tickets/{ticketId}/accept-for-later` 使用独立宿主选项 `ticketSelfHandlingEnabled=false`。同源认证、Origin/CSRF、Idempotency-Key 与 If-Match 沿既有规则；closed body 必须为 `client_command_id:UUID,expected_version:number(1..2147483647),reason_code:大写code,resolver_team_id:当前组code`。客户端不能指定 actor、target、session 或自由备注。详细 [Schema](../../../contracts/p2_016_self_handling_command.schema.json) 与 [types](../../../contracts/p2_016_contracts.d.ts) 随本票实现；最终证据见 [T04](../../../plans/admin-workbench-integration/execution/t04.md)。

服务器重新核对活动主体、当前处理角色、活动当前组及真实成员，且目标固定本人。已有他人预分派或承接不可覆盖，ADMIN 也不例外；不同处理组拒绝。Ticket 源 Intake 或 canonical Journey/Leg 上任何非 ENDED 真会话（含未分配）都拒绝 Ticket-only，转由 T05 的真实会话用例处理；不构造 Session。

NEW/QUEUED 的合法 Action 链为 queue（仅 NEW）→accept→start，或先接单止于 ACCEPTED。首次 accept 建立第1处理轮次，记录真实 accepted event、操作者、当前组、源 Intake 和命令依据；本人 ACCEPTED 已有轮次时 take-and-start 只 start，复用轮次。旧 ACCEPTED 无轮次、REOPENED、进行中、等待及终态拒绝本入口；不回填旧事件或在每次 start 增轮。

成功结果沿既有 receipt 增加 `handling_cycle:{id,cycle_no,first_responsibility_event_id}`，control_event_id 为 null；启用时 GET TicketDetail 增加可空 handling_cycle 与真实 `take-and-start/accept-for-later` actions。客户端一条 POST，可信成功后重读 GET 的 owner/status/version/cycle；未知只核对原 UUID/version/payload。039 显式迁移保存原 Ticket 当前轮次引用和追加轮次/事件关联；cycle_start_event_id 是轮次起始依据，首次责任三字段允许未来显式重开后暂未派工的合法空态，T04 成功时 first_responsibility_event_id 必非空真实 accepted 事件，不创建另一套 owner 或 Ticket，固定历史迁移清单不变。Action/轮次/事件/既有投影和 COMMITTED receipt 同事务；失败业务 savepoint 整体回滚，FAILED receipt 可留审计。原始来源不改写，未来通知能由首次责任事件与源依据恢复，本票不真实发送。

关闭选项返回503并隐藏按钮，旧 profiles 不访问039/new fields，旧 accept/start 保持；已提交责任/轮次/事件保留。启用缺039时 readiness 与新命令 fail closed。body32KiB、单表单in-flight1、无自动重试/新增轮询/常驻进程，复用原池预算、单App/Worker/Gateway与SSE32。

正式 [TicketSelfHandling](../../../web/admin-workbench/src/features/ticket-handling/TicketSelfHandling.tsx) 仅在 bootstrap 能力开启后读取真实 Ticket command-context，按服务端新 actions 呈现两种按钮。处理组固定为服务端当前组，不从卡片、角色或沟通责任推断。共享 T02 的 unknown 响应核验；原动作与闭合 payload 在组件内存冻结，未知仅显式核对同一 POST，不使用新 UUID/版本/组。成功失效 context/detail/board，GET 未返回前不接受新的提交；不会按动画或 version+N 移卡。可信失权取消/清同对象缓存，组件卸载 abort 自有 POST；abort 不证明未提交。提交中与未知限制详情关闭/切换并提醒页面离开；跨刷新持久恢复仍由 T03 的独立合同维护，不在本票扩展。

错误：输入/额外字段400，Header/版本或责任/状态/真会话冲突409，当前角色/组/成员拒绝403，对象失权404，活动身份失效401/403，关闭或未安装039为503。稳定拒绝含 `P2_016_SELF_HANDLING_OWNER_CONFLICT/CONVERSATION_REQUIRED/STATE_CONFLICT/UNAVAILABLE`；前缀后三个分别为完整 `P2_016_SELF_HANDLING_*` code。事务失败的 FAILED receipt 以既有 `P2_016_ACTION_FAILED` 返回503且不重试业务。

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

核对测试：[HTTP integration](../../../tests/p2-016-workbench-http.integration.test.mjs)、[auth integration](../../../tests/p2-016-workbench-auth.integration.test.mjs)、[T04](../../../tests/t04-self-handling.integration.test.mjs)。背景：[生命周期与双责任](../../59_p2_016_ticket_lifecycle_and_responsibility.md)。本票仅显式增加039轮次结构；生产权限未改变。
