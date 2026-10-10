# 工单生命周期与双责任

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

WBINT-T08撤销未开始派工的后继合同见[PLANNED / NOT_RUN](#撤销未开始派工wbint-t08plannednot_run)。计划路径不表示已挂载。

宿主：W，P2-016 扩展。调用方：[lifecycle UI](../../../web/p2-workbench/lifecycle.js)。默认关闭：`TICKET_LIFECYCLE_WORKBENCH_ENABLED`。实现：[HTTP](../../../src/p2-016-workbench-http.mts)、[query](../../../src/p2-016-ticket-query.mts)、[command facade](../../../src/p2-016-ticket-command-facade.mts)、[command ledger](../../../src/p2-016-ticket-command-ledger.mts)。Ticket 是唯一编号/状态/处理责任事实源，Conversation Assignment 单独管理沟通责任。

## 查询

| METHOD + PATH | 输入 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | `principal_id,display_name,csrf_token:string|null`、`internal_beta:true,ai_enabled:false,manual_review_enabled:boolean,manual_review_draft_recovery_enabled:boolean,roles[],polling_interval_ms:5000,source_group_directory_enabled:boolean,internal_notes_enabled:boolean,ticket_self_handling_enabled:boolean,ticket_conversation_self_handling_enabled:boolean,ticket_conversation_draft_recovery_enabled:boolean,ticket_staff_completion_enabled:boolean,draft_recovery_enabled:boolean,staff_completion_draft_recovery_enabled:boolean,logout_enabled:boolean`；另含 [授权实时能力](../platform/realtime.md#正式管理端接入wbint-t38) `realtime_sse_enabled,realtime_sse_available,sse_endpoint,expires_epoch_ms,authorization_revision`。新增宿主能力默认false；读取不要求独立CSRF cookie，写与退出仍需当前Origin/CSRF |
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

Notification：`notification_type,destination_type,delivery_id,status,side_effect_state,attempt_count,sent_at,created_at`；T24开启时另含成对的node:FIRST_RESPONSIBILITY|STAFF_COMPLETED|null与cycle_no:positive integer|null，未绑定轮次的既有通知两值均null；SENT/ACKNOWLEDGED 的技术含义不替代现场客户端观察。

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

## 明确选择关联沟通的本人承接（WBINT-T05）

W 宿主 `ticketConversationSelfHandlingEnabled:boolean=false` 独立于 T04，启用须已安装039首次责任轮次结构。关闭时新入口503且不新增关联/039读取；开启但缺039时503 `P2_016_SELF_HANDLING_UNAVAILABLE`。本票无数据库变更，复用单一 Ticket、039轮次、原 command ledger 和 Conversation Control。实际被测对象和关闭方式见 [T05执行记录](../../../plans/admin-workbench-integration/execution/t05.md)。

`GET /api/tickets/{ticketId}/related-conversations?cursor=&limit=` 只列当前可读、非ENDED、源Intake或同一真实Journey/Channel Leg关联且身份匹配的服务会话。权限裁剪在LIMIT前，Session UUID keyset，每页默认/最多20；cursor绑定Ticket。返回 `{items:[{session_id,session_row_version:string,conversation_principal_id,conversation_principal_name,assignment_status,take_allowed}],next_cursor}`。没有一页结果不能证明不存在其他会话，不能从最后消息推断关联。读取BIGINT保留原十进制字符串；新写桥沿既有 `versionP2016` 和 [command Schema](../../../contracts/p2_016_conversation_self_handling_command.schema.json) 的1..2147483647。2147483647可实际写至2147483648，此后 `take_allowed=false`；更大的值也精确展示且不可写。既有Control的SafeInteger语义不改。

`POST /api/tickets/{ticketId}/take-and-start-with-conversations` 与 `/accept-for-later-with-conversations` 的closed body：`client_command_id:UUID,expected_version:number,reason_code:大写code,resolver_team_id:当前组code,communication_choice:TAKE_SELECTED|RETAIN_CURRENT,sessions:[{session_id:UUID,expected_row_version:number}]`。TAKE_SELECTED须1..8个不同真实会话，逐一显式选择；RETAIN_CURRENT须空数组，明确保留原沟通人。不接受actor、target、force、自由备注或额外字段。版本范围同上；沿既有32KiB、Origin/CSRF、Idempotency-Key与Ticket If-Match，不改旧单会话复合命令。

当前主体须活动且是活动当前组的真实成员；不得覆盖他人Ticket处理责任。NEW/QUEUED复用原queue/accept/start及首次责任依据，ACCEPTED本人已有真实basis仅允许开始。每个选中会话独立验证当前VIEW和TAKEOVER/TRANSFER、canonical主题与精确版本；给他人的沟通须现有TRANSFER授权且固定force=false，Ticket可读不能授予Conversation转交权。该会话上层检查使用锁后关联查询重新读取的当前主体，不沿用Ticket锁等待前的角色。给本人是无事件的合法no-op。锁序为realtime发布锁→Ticket→按UUID排序的Session；既有standalone Control取相同发布锁后再锁Session。同事务包含Ticket Action、真实cycle、独立Conversation assignment/generation/control事件、既有投影及COMMITTED receipt，任一失败全部业务回滚，仅FAILED审计可留。无会话的Web事项须明确RETAIN_CURRENT，不造Session。

成功沿原Ticket命令结果，`control_event_id:null,handling_cycle`，另有 `communication_choice,conversations:[{session_id,session_row_version:number,control_event_id:UUID|null,changed:boolean}]`；Schema见 [result](../../../contracts/p2_016_conversation_handling_result.schema.json) 与 [page](../../../contracts/p2_016_related_conversation_page.schema.json)。原UUID重放先重验当前主体、Ticket和选中会话可读，再读取原结果；payload变化409。浏览器只发一条POST，成功重读GET双责任事实，冲突保留原选择及旧版本，取消后才按当前版本重选。

`ticket_conversation_draft_recovery_enabled = 本服务能力 && workbenchDraftRecoveryEnabled`，独立于Notes的 `draft_recovery_enabled`。正式表单复用T03加密store和T14授权生命周期，purpose=`ticket-conversation-handling`，账号/kind/Ticket/用途隔离，24h、20份、16KiB、500ms节流；恢复前重验bootstrap、Ticket和每个选择会话的实际读取及canonical关系，未通过不发布选择到UI。UNKNOWN冻结原UUID、动作、Ticket和各Session旧版本，未过期只显式重放原POST，不自动换身份或版本。敏感副本过期只留opaque原UUID。

`GET /api/tickets/{ticketId}/conversation-handling-commands/{commandId}` 是该操作专用的只读核对，须能力和raw恢复选项都开启。closed无query/body，当前活动principal和Ticket读权、principal scope/Ticket/UUID/两种专用命令类型绑定原ledger。响应仅 `{state:'UNKNOWN'}`、`{state:'FAILED',error:{code:稳定P2_016码,retryable:false}}` 或 `{state:'COMMITTED',ticket_id,ticket_version,ticket_event_id}`，见 [Ack Schema](../../../contracts/p2_016_conversation_handling_ack.schema.json)。不返回会话引用/数量/版本、Control结果、payload/hash，也不授予Session读取或变更权。其他scope/type均UNKNOWN；当前Ticket失权拒绝。丢失Session读权的原操作可按当前Ticket读权读这份安全Ack，普通POST仍逐Session验权。

选中最多8、页长最多20、单表单in-flight1；复用单App/Worker和原pool≤4、Gateway单活与SSE32预算，无新pool、常驻计时器或外部连接。本票不执行真实Provider/OAuth/WeCom/发送、部署、full/certify或Gate。关闭宿主选项退回旧入口并停止本用途恢复；已提交责任/事件/轮次不删除或倒写，代码回退采用独立forward/revert。

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

## 工作人员完工（WBINT-T11）

W 的 `POST /api/tickets/{ticketId}/complete` 使用宿主 `ticketStaffCompletionEnabled:boolean=false`。启用前显式安装039与前向040；关闭时隐藏并拒绝新完工入口，不读取040的新字段或承诺表，旧 resolve/confirm 和旧 Pilot profile 保留。缺少任一迁移时 readiness 与新命令返回503，不插入命令receipt。[输入 Schema](../../../contracts/p2_016_completion_command.schema.json)、[安全结果 Schema](../../../contracts/p2_016_completion_result.schema.json)、[types](../../../contracts/p2_016_contracts.d.ts)、[本票执行](../../../plans/admin-workbench-integration/execution/t11.md)。

沿 W 同源认证、Origin/CSRF、Idempotency-Key=client_command_id、If-Match=数字版本与32KiB上限。闭合body仅含以下七字段；拒绝 actor、target、action、ticket_id、来源、接收人、legacy note 或任何额外字段。

| 字段 | 约束 |
| --- | --- |
| client_command_id、handling_cycle_id | UUID，分别为本次原命令与当前处理轮次 |
| expected_version | 数字整数1..2147483647，不能传十进制字符串 |
| reason_code | 固定 STAFF_COMPLETED |
| internal_process | 独立必填字符串，trim非空，原长度≤2000，工作人员内部可见 |
| external_summary | 另行填写的可公开字符串，trim非空，原长度≤500；不会从内部过程复制 |
| external_summary_confirmed | 必须显式 true；编辑外部摘要后重新确认 |

服务器在行锁后重新核对活动主体、ADMIN/DISPATCHER/HANDLER、活动当前组与实际成员，且固定为当前 assignee；ADMIN/BROAD可见性不能绕过责任。body轮次须为Ticket真实当前轮次，具有首次责任event且未结束。IN_PROGRESS通过明确 Core complete Action关闭；WAITING_REQUESTER/VENDOR在同事务合法resume→complete并保留两事件。ACCEPTED、REOPENED、无轮次历史状态、legacy RESOLVED及所有终态拒绝。另一个同事需使用独立T12，不提供隐式接管。

同一 command ledger 事务追加实际 PILOT_USER、业务时间与 STAFF_COMPLETED 的ticket.closed，分别保存internal_note/external_note，关联同Ticket/同cycle事件、唯一工作人员结束event、引用原source的持久通知承诺、安全实时投影与COMMITTEDreceipt。六处写入任一失败回滚全部业务事实与等待态resume，仅保留FAILED审计；同UUID/原hash重放不重新执行，改正文/版本/轮次拒绝。完工启用profile的既有Facade与新service均在receipt外键锁之前取得同一实时流mutex，再获权；旧false profile保持原顺序。

200结果仅 `ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id:null,replayed:boolean,completion:{cycle_id,cycle_no,event_id,basis:'STAFF_COMPLETED'}`，无处理正文、目标或身份。401/403/404清可信授权范围；409保持独立输入，GET读当前事实后由用户明确新操作；网络、畸形响应或未核定终态保持UNKNOWN，不创建新UUID、不自动重发。

`GET /api/tickets/{ticketId}/completion/commands/{commandId}` 是只读核对；依赖实际完工能力及raw `workbenchDraftRecoveryEnabled=true`，并验证当前读权限、原principal/Ticket/UUID和服务器设置的WORKBENCH_STAFF_COMPLETION用途。空query才合法。闭合 [receipt Schema](../../../contracts/p2_016_completion_receipt.schema.json) 为UNKNOWN、COMMITTED+以上安全replayed:true结果，或FAILED+code/retryable:false。未知、他人的命令、错误Ticket、其它用途均不泄漏原receipt；UNKNOWN不证明未提交。失去complete写权限但保留读权限时，只能查原标识。

bootstrap的 `staff_completion_draft_recovery_enabled` 为实际完工能力AND raw recovery，独立于Notes限定的旧 `draft_recovery_enabled`；Notes关闭仍可恢复完工。purpose=staff-completion，敏感 `{value:{process,summary,confirmed},pending:原七字段命令或null}` 复用T03的非导出AES-GCM、固定24h、scope/AAD、上限与generation fence；不另建存储协议。刷新先核实当前主体、能力和准确Ticket写资格，普通恢复摘要要求再次确认。丢弃/过期/写资格丧失清敏感副本并保留未知原opaque标识；核定COMMITTED/FAILED才清匹配标识。可信失权清scope及跨tab缓存，但不伪判旧命令FAILED。raw recovery关闭不访问恢复存储或receipt，只在本页保留不可变UNKNOWN命令供显式原POST核对。

040的append-only通知承诺仅引用同Ticket/同cycle/真实结束event/原source，没有正文、owner、第二状态或Delivery。进程内 `readCommittedStaffCompletions({afterCycleId?:UUID|null,limit?:1..100})` 默认20，返回 `{items:[{cycle_id,cycle_no,node:'STAFF_COMPLETED',ticket_id,ticket_event_id,source_intake_id,external_summary,occurred_at}],next_cursor}`；安全摘要读取权威event。UUID cursor仅一次完整扫描的分页，不是永久增量checkpoint：旧cycle可能后来完工，恢复消费须重扫并以稳定cycle/node/event幂等。T24负责路由、模板、去重及Outbox/Delivery生成，此Port没有HTTP/发送入口。Reporter/H5本人安全投影只展示此明确完工事件的external_note，普通内部备注/处理过程不外发。

表单in-flight1，复用原事务、pool≤4、总池建议≤8，App/API/SSE1、Worker1、Gateway单活、SSE32，无新轮询/常驻进程。关闭能力拒绝新命令并保留已提交事实；独立forward/revert不删除receipt、cycle/end/event或承诺。真实外部依赖、发送、部署、full/certify与Gate仍须独立授权。


## 明确派单与转派（WBINT-T06）

W 的 `POST /api/tickets/{ticketId}/assign` 与 `/transfer-assignment` 使用宿主 `ticketAssignmentEnabled:boolean=false`。有效人/组、明确沟通原子交接、候选查询、正式表单、终态、回执、同轮通知、事务权限锁及专用恢复均已完成隔离公开验证；固定被测身份、七项映射与相关回归见[本票执行记录](../../../plans/admin-workbench-integration/execution/t06.md)。[command](../../../contracts/p2_016_assignment_command.schema.json)、[result](../../../contracts/p2_016_assignment_result.schema.json)、[types](../../../contracts/p2_016_contracts.d.ts)、[service](../../../src/workbench-ticket-assignment.mts)。

沿W认证/当前Ticket可见范围、Origin/CSRF、Idempotency-Key=client_command_id、If-Match=expected_version和32KiB上限。闭合body的七字段为UUID client_command_id、数字整数expected_version（1..2147483647）、CODE reason_code、UUID target_principal_id、CODE resolver_team_id、communication_choice、sessions。RETAIN_CURRENT必须空sessions；TRANSFER_SELECTED必须1..8个唯一、真实关联且当前分别获权的 `{session_id:UUID,expected_row_version:number}`。调用者必须独立具有Conversation Control权限；Ticket读取不授予Session权限。Session按UUID排序锁定，在原Ticket组范围内先执行Control caller事务，再执行人/组责任写；任何业务写失败全部回滚，保留FAILED审计。拒绝actor/来源/通知目的地/force/任意额外字段。

合法派单仅无当前处理人的NEW/QUEUED；NEW使用原Core queue进入QUEUED，绝不执行accept/start。操作者须保持原Ticket读权及活动内部业务角色；目标须是选定活动组中的真实活动内部ADMIN/DISPATCHER/HANDLER。组成员指目标承接者，不要求操作者同时加入目标组，不授予新的Ticket读取或系统管理权限。外部厂商不成为候选内部Principal。

显式转派仅有当前处理人的QUEUED/ACCEPTED/IN_PROGRESS/WAITING_REQUESTER/WAITING_VENDOR；当前合法可读的活动内部业务同事可操作，不要求自己是原处理人。原目标人和组完全不变时拒绝。复用同一责任写/event/ledger事务，仅人和实际有效目标组改变，状态、来源和已有轮次/first-responsibility依据保留，事件加入原轮次；legacy本无轮次时不补造历史轮次。新路径不调用accept/start；旧`/transfer`保留输入及角色合同，同样阻断终态绕过。目标活动人、真实成员、活动组、业务角色和操作者当前业务角色/可见成员在事务内验权并持共享锁至提交，不把候选查询或旧缓存当权限租约。外部协助的WAITING_VENDOR仍由内部同事负责。

只读候选查询为 `GET /api/tickets/{ticketId}/assignment-targets?resolver_team_id=CODE`，闭合输出为 `{resolver_teams:[{team_id,display_name}],resolver_team_id:CODE|null,items:[{principal_id,display_name}]}`，见[targets Schema](../../../contracts/p2_016_assignment_targets.schema.json)。只在当前Ticket原读权、活动内部业务角色及当前可派单/转派动作内，返回有有效内部业务承接者的活动组；100只是展示上限，显式合法所选组按独立活动组/成员事实核验并仍纳入最多100项的有界响应，不把排序第101项误作403或业务权限上限。组按CODE排序，成员按display_name/id排序且最多100，只返回活动真实内部业务成员。不要求操作者属于目标组；未选组返回null/空items，多个组必须明确选择。查询闭合为可选resolver_team_id:CODE及target_principal_id:UUID；提供所选人必须同时明确组。所选目标按该活动组真实活动成员/内部业务角色独立核验，合法目标即使普通100人展示页缺席也纳入最多100项有界响应，原display_name/id排序与安全两字段保持；真实失效目标或不允许组403、缺明确组/非法query400、Ticket不可见404、关闭/缺039为503。列表缺席本身不作为草稿撤权依据。读取不写Ticket/Event/cycle/receipt，不返回登录身份、联系方式、外部身份或整份成员图；提交仍按实际活动组、成员、角色及当前权限独立核验，查询不提供权限凭据。

`GET /api/tickets/{id}/related-conversations?limit=20&cursor=...`在T06单独启用时可沿既有当前Session scope/Control授权发现安全规范会话；仍只返回原最小六字段与20项keyset分页，不启动独立T05写能力。正式表单无默认组、人或沟通选择；TRANSFER_SELECTED仅交接人工勾选的真实会话及原版本，选择本身不POST。提交一个闭合命令，成功后真正GET当前事实；失去Ticket原范围则清除私有事项，不能为展示新责任授予额外读权。409保留选择，读取当前版本后由用户再次明确确认。

`GET /api/tickets/{id}/assignment/commands/{uuid}`依赖实际assignment能力和raw `workbenchDraftRecoveryEnabled=true`，只在当前原Principal/Ticket/WORKBENCH_TICKET_ASSIGNMENT用途内READ ONLY核对。闭合[receipt Schema](../../../contracts/p2_016_assignment_receipt.schema.json)为UNKNOWN单字段、COMMITTED仅state/Ticket/version/event，或FAILED仅state/code/retryable:false；不返回目标、Session身份、正文或完整result_snapshot。其他主体/事项/用途不泄漏receipt，UNKNOWN不表示未提交；失去写动作但保留当前读权时可只读核对原标识。

bootstrap的 `ticket_assignment_draft_recovery_enabled` 为assignment能力AND raw恢复开关，缺字段按false。purpose `ticket-assignment`复用T03唯一AES-GCM、非导出钥、24h固定TTL、主体/事项/用途AAD、generation fence和跨tab清理；不延长TTL。冻结原UUID、动作、Ticket版本、目标人/组、明确沟通选择与Session原版本；恢复前核对当前主体、能力、Ticket、目标和每个Session独立读权/真实关联。UNKNOWN不自动创建新UUID或发送；开启恢复时仅用户明确GET原安全ACK，raw=false不打开IndexedDB，内存核对只复用原意图幂等命令。仅明确失权或关联撤销清理敏感内容；临时503／网络失败保留原密文与不透明操作，未核验选择不显示且禁止新提交，服务恢复后刷新重新授权再恢复。过期清理敏感内容，保留原opaque命令供当前合法读权核对；成功后清理副本并GET事实。

仅原Ticket保存owner/team；原ticket.assignment_transferred追加前后人/组和实际操作者，039保存该真实首次派单事件的轮次/首次责任依据及同轮event引用，原来源不改。责任、事件、轮次、既有安全实时投影与原principal-scoped ledger的WORKBENCH_TICKET_ASSIGNMENT receipt同事务。每次原命令重放在查账本之前也重新验证当前Ticket与所选规范Session的READ权限；不得返回已失权Session元数据，也不要求已经交出的TRANSFER写权。专用安全ACK仍只核对当前Ticket读权并返回最小四字段，无Session引用。依赖显式039、无新数据库变更；关闭后新路径503、不读039，保留旧profiles及真实历史。缺039为ASSIGNMENT_UNAVAILABLE/503且不插receipt；非法前态或责任为ASSIGNMENT_STATE_CONFLICT/409，其余现有INPUT_INVALID/TARGET_INVALID/FORBIDDEN/NOT_FOUND/VERSION_CONFLICT/COMMAND_CONFLICT/ACTION_FAILED维持W状态合同。结果仅Ticket/event/version、可空handling_cycle、沟通选择与安全会话结果；不返回报修正文、外部身份或登录资料。

复用原pool≤4/同机建议≤8、单App/API/SSE与Worker、Gateway单活、SSE32；无新进程/轮询/外发。回退关闭option，保留责任/event/cycle/receipt；本片段和整票状态区分，真实外部服务/发送、部署、full/certify/Gate仍NOT_RUN。

## WBINT-T08 撤销未开始派工

本节为当前冻结合同及本票实现进度。POST、安全 GET ACK、沟通目标 GET 及正式管理端 UI 已在自有隔离 PG、真实 HTTP 和生产 bundle 浏览器局部验证。原七项已完成本地整票验证：固定 20 个本票文件 32PASS、15 个直接相关文件 106PASS、既有 hosts 原生 27PASS。原 source 与文档后继身份分开记录，GitHub/工作包收口由父独立验收。准确被测源码与原始FAIL/PASS见[逐票执行与原七项](../../../plans/admin-workbench-integration/execution/t08.md)、[闭合command Schema](../../../contracts/p2_016_unassign_command.schema.json)、[safe result](../../../contracts/p2_016_unassign_result.schema.json)、[private event fact](../../../contracts/p2_016_unassign_event.schema.json)、[独立types](../../../contracts/workbench_unassign_contracts.d.ts)。局部验证不构成整票完成、真实外发或部署授权。

| METHOD + PATH | 当前合同 |
| --- | --- |
| POST `/api/tickets/{ticketId}/unassign` | 一个闭合原子撤派命令，当前未开始责任由获权ADMIN/DISPATCHER撤回 |
| GET `/api/tickets/{ticketId}/unassign/commands/{commandId}` | 当前Ticket读权、原principal/专用用途/原UUID的最小UNKNOWN/FAILED/COMMITTED；独立T08启用即可，raw草稿恢复可关闭 |
| GET `/api/tickets/{ticketId}/unassign/communication-targets[?target_principal_id=UUID]` | 当前合法撤派动作及Ticket读权；活动内部沟通target，safe `items:[{principal_id,display_name}]` ≤100，显式有效保存target在界内pin；不要求处理组成员、不授予Control写权。源码已挂载，隔离真实 HTTP 已验证 |

宿主`ticketUnassignEnabled:boolean=false`，独立于T05/T06；关闭不广告/不读新迁移，旧profile保留。启用须039及前向046_ticket_unassign。046只扩充既有event/check，允许严格的同组旧owner→JSON null释放metadata，不增owner/started字段、表或第二套Ticket/receipt；既有031/039迁移字节保留。

body恰为七字段：`client_command_id:UUID,expected_version:number(1..2147483647),reason_code:CODE(1..64),reason:string(原长≤2000、trim非空),communication_choice:RETAIN_CURRENT|TRANSFER_SELECTED,communication_target_principal_id:UUID|null,sessions:[{session_id:UUID,expected_row_version:number(1..2147483647)}]`。RETAIN_CURRENT必须null target/空sessions；显式TRANSFER_SELECTED必须活动内部target、1..8个唯一规范Session。原因只存internal_note，没有external_visible/外部摘要/接收人；额外键拒绝。沿W Origin/CSRF/JSON/32KiB/Idempotency-Key与If-Match一致。

只允许QUEUED/ACCEPTED、nonnull当前owner、可证明当前个人责任段未开始；ADMIN/DISPATCHER也不能在IN_PROGRESS或两waiting使用此入口。NEW/REOPENED/无owner/终态拒绝，未知legacy边界fail-closed。权威按同Ticket event_ordinal与T06真实assignment metadata/accepted核验、必须吻合当前owner/组；同人换组或同人接单不重置started，来源transfer已处于进行中/waiting也继承开始。当前段之后started/waiting/resume拒绝，过去轮次/已结束旧段started不永久禁止未来合法新未开始承接；精确事件fence见本票执行，不加不存在的业务事实。

清个人owner、留组/报修/source/当前cycle/first basis，回QUEUED、version+1，仅追加ticket.unassigned（原owner→null、同组、操作者、内部原因）。默认不触Conversation；显式选择在Ticket行锁和UUID排序Session锁后独立核验关联/VIEW/Control权限/版本/target，通过现已集成caller-Tx transfer/takeover原子提交。Ticket、选定Control、event/cycle link/安全实时投影/COMMITTED receipt全成功或全失败；失败只留FAILED审计。原UUID/hash重放一次终态，改payload409，重放仍当前授权原所选Session READ，不泄漏失权DTO。

安全200为`ok,ticket_id,ticket_version,ticket_event_id,control_event_id:null,handling_cycle,communication_choice,conversations,replayed`，无原因/Reporter/正文；默认retain返回空conversations，GET重读实际责任。ACK复用[安全assignment receipt形状](../../../contracts/p2_016_assignment_receipt.schema.json)，只给最小Ticket终态，无Session/原因。UNKNOWN不等于未提交；409保留输入并明确新操作，401/403/404清可信授权敏感副本，临时503/网络保留未核验输入且不自动POST；当前浏览器按账号、Ticket 和 purpose 加密恢复，最长 24h；原 UUID 在 UNKNOWN 后只 GET 安全 ACK，不自动重放 POST。raw 关闭仍可内存核对。已知 COMMITTED 后清理失败仍保持已提交并阻止新命令，重试核对后完成清理；恢复须当前授权和目标/所选 Session 版本核验。临时网络故障保留密文并隐藏未核验选择；真实失权仅清本用途敏感副本，其他用途保留。

输入400、身份401、角色/沟通/target403、不可见或非规范关联404、版本/hash/状态/fence409、关闭/缺Schema/事务失败503。稳定业务码 `P2_016_UNASSIGN_UNAVAILABLE`、`P2_016_UNASSIGN_STATE_CONFLICT` 已加入当前 runtime 枚举；另沿用 `P2_016_VERSION_CONFLICT`、`P2_016_COMMAND_CONFLICT`、`P2_016_FORBIDDEN`、`P2_016_NOT_FOUND`、`P2_016_TARGET_INVALID`、`P2_016_CONTROL_CONFLICT`、`P2_016_ACTION_FAILED`。unassigned不新增Message/Outbox/Delivery，不外发撤派；同轮再承接不重复已发生首次责任通知，不新增轮次。资源沿单App/Worker、Gateway单活、SSE32/pool≤4/总建议≤8/所选≤8；关闭新option保留已提交事实。原公开首 tracer、闭合合同、隔离 PG/HTTP、生产 UI、敏感草稿/UNKNOWN/并发恢复已有分阶段真实证据及清理；历史 FAIL/NOT_REACHED 原样保留。最终固定候选全部本票文件与有限相关组通过；既有工具主运行原生 27PASS，故障注入子 TAP 和采集器误读的更正分别保留。整票 LOCAL_VERIFIED_WHOLE，默认关闭和原生产授权边界不变。


## Bot 原报修人轮次通知读取（WBINT-T24，UI源码后继 NOT_BUILT_NOT_RUN）

现有获权 GET /api/tickets/{ticketId}/deliveries 和041真实节点绑定保持。ticketRoundNotificationsEnabled=false继续默认关闭；已认证 /api/lifecycle/bootstrap 新布尔 ticket_round_notifications_enabled 仅反映该宿主能力，客户端缺字段按false。正式Ticket详情仅能力开启时挂载“报修人通知送达”只读区域，读取现有安全DTO，显示首次责任／工作人员完工、轮次、PERSON路由、实际Delivery状态／尝试次数／side_effect_state／sent_at。原通知Schema仍闭合，轮次两字段成对可空；客户端拒绝未知字段、重复Delivery身份、不合法枚举或版本／时间，不收取raw目标、Bot／Reporter、binding或内部内容。

组件沿共享当前授权epoch的同源无缓存GET，挂载读取一次，只提供“重新读取通知”的显式GET；卸载／切换取消自身读取，generation屏蔽晚结果，可信失权清当前Ticket／Session视图。没有通知POST、retry／reconcile／SDK调用、轮询、发送或通知消费者变更。

原干净9ac9b280候选一次build／strict／artifact原生0／0／0，原browser首0PASS／1FAIL/native1：真实Cookie accept/start/complete、CLOSED和FIRST／STAFF cycle1 PERSON/PENDING两条API前置到达，正式页面缺区域为真实UI RED（原source45／compiled51）。原TAP、1920×1080失败PNG、完整1110inputs／1281outputs及sourceZIP冻结在D外部归档，手动重读／UI隐私／末尾物理counts均NOT_REACHED，不用源码补丁升级其结论。当前后继尚未build／运行，原首7836字节、SHA db547b5e777b064aca0d5c3092274c43e5981c918ea7c56f89dcb4e07599984d、240秒与角色／flags／routing不变。完整七项、T06 assignment/QUEUED首通知与真正T08／T09范围继续remaining；运行窗口已TEMP_RELEASE返T20。
