# 工单生命周期与双责任

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

WBINT-T08撤销未开始派工的后继合同见[PLANNED / NOT_RUN](#wbint-t08-撤销未开始派工)。计划路径不表示已挂载。

WBINT-T37 的[共享跟进安排合同](follow-up-schedules.md)完整业务仍进行中：原调度员POST404形成真实RED后，后继仅SOURCE挂载三条W路径与049，尚未构建／迁移／HTTP验证。当前处理人／获权调度源码已补，canonical沟通人、Worker、生命周期与正式页面待逐片验收；不能当作已交付的预约服务。

宿主：W，P2-016 扩展。调用方：[lifecycle UI](../../../web/p2-workbench/lifecycle.js)。默认关闭：`TICKET_LIFECYCLE_WORKBENCH_ENABLED`。实现：[HTTP](../../../app/server/src/p2-016-workbench-http.mts)、[query](../../../app/server/src/p2-016-ticket-query.mts)、[command facade](../../../app/server/src/p2-016-ticket-command-facade.mts)、[command ledger](../../../app/server/src/p2-016-ticket-command-ledger.mts)。Ticket 是唯一编号/状态/处理责任事实源，Conversation Assignment 单独管理沟通责任。

## 查询

| METHOD + PATH | 输入 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | `principal_id,display_name,csrf_token:string|null`、`internal_beta:true,ai_enabled:false,manual_review_enabled:boolean,manual_review_draft_recovery_enabled:boolean,roles[],polling_interval_ms:5000,source_group_directory_enabled:boolean,internal_notes_enabled:boolean,ticket_self_handling_enabled:boolean,ticket_reopen_rounds_enabled:boolean,ticket_reopen_draft_recovery_enabled:boolean,ticket_conversation_self_handling_enabled:boolean,ticket_conversation_draft_recovery_enabled:boolean,ticket_staff_completion_enabled:boolean,draft_recovery_enabled:boolean,staff_completion_draft_recovery_enabled:boolean,logout_enabled:boolean`；另含 [授权实时能力](../platform/realtime.md#正式管理端接入wbint-t38) `realtime_sse_enabled,realtime_sse_available,sse_endpoint,expires_epoch_ms,authorization_revision`。新增宿主能力默认false；读取不要求独立CSRF cookie，写与退出仍需当前Origin/CSRF |
| `GET /api/tickets` | `state` 默认 queued；`cursor?`；limit 默认 30、最大 100 | `{items:[TicketDetail],next_cursor}` |
| `GET /api/tickets/{ticketId}` | UUID，无 query | TicketDetail；ETag 为 `"<version>"`；此路由未实现 If-None-Match/304 |
| `GET /api/tickets/{ticketId}/events` | cursor?；limit 默认 30、最大 200 | `{items:[TicketEventProjection],next_cursor}` |
| `GET /api/tickets/{ticketId}/responsibility` | 无 query | ResponsibilityView |
| `GET /api/tickets/{ticketId}/deliveries` | 无 query | `{items:[TicketNotification]}`，最多 100 |
| `GET /api/tickets/{ticketId}/eligible-principals` | 无 query | `{items:[{principal_id,display_name}]}`，最多 100 |
| `GET /api/tickets/{ticketId}/reporter-contact` | 无 query | 已授权的联系资料投影，见下文 |

state：`queued|accepted|in_progress|waiting_requester|waiting_vendor|resolved|closed|reopened|cancelled|unassigned|mine|failed_delivery`；queued 包含 NEW/QUEUED。未知 query 参数拒绝。ADMIN/DISPATCHER 广域读取；HANDLER 按处理人/团队读取。对象越权以不可见处理，不能由猜测 Ticket UUID 扩大范围。

TicketDetail：`id,ticket_no,request_type,status,priority,resolver_team_id,assignee_id,version:number,created_at,updated_at,intake_id,external_status,allowed_actions[]`；Web 来源可增加 `web_report`。后者含 `source_kind,description,location:{text,unknown},service_code,impact_scope,reported_department_text,extension,supplements:[{input_revision,text}]`，保留期后字段可能不可用，不是任意原始 Channel payload。

事件投影：`event_id,event_type,old_status,new_status,aggregate_version,event_ordinal,created_at,has_internal_note,has_external_note`；T10默认false源码增量的`handling_cycle_id`见[首片段合同](#等待报修人的同轮次关联wbint-t10首片段)。责任投影：`ticket_id,ticket_assignee_id,ticket_assignee_name,resolver_team_id,resolver_team_name,conversations[]`；每条 conversation 含 `session_id,session_row_version:string,combined_accept_allowed,conversation_principal_id,conversation_principal_name,assignment_status,assignment_version`。复合命令使用前须按命令要求将可验证的会话版本转成安全整数。

Notification：`notification_type,destination_type,delivery_id,status,side_effect_state,attempt_count,sent_at,created_at`；T24开启时另含成对的node:FIRST_RESPONSIBILITY|STAFF_COMPLETED|null与cycle_no:positive integer|null，未绑定轮次的既有通知两值均null；SENT/ACKNOWLEDGED 的技术含义不替代现场客户端观察。

`reporter-contact` 顶层：`status,contact,departments[],fetched_at`。历史 contact 可含 `name,userid,mobile,telephone`，department 含 `name,department_ref,role`。第三方来源可增加 `sex,current_profile`；current_profile 含 `status,contact:{name,mobile},sex,avatar_url,departments,fetched_at`。缺资料为 DEFERRED/STALE 与 null，不伪造联系方式。这是内部授权接口，不提供给 Reporter/成员 UI。

ADR-0048的工单资料能力显式开启后，可增加`retained_profile:{name,department,source,captured_at}`。它只承载随工单保存的必要资料，source区分原快照与后续补取，不冒充实时人员目录；完结后也不因原消息过期而删除。读取前后均核验当前Ticket READ，不返回原始人员ID、手机号或令牌。原顶层历史快照与第三方`current_profile`语义保持。

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

具体状态迁移和角色由 [Action 服务](../../../app/server/src/p1-006-ticket-state-actions.mts) 与 query 的 allowed_actions 决定；不要用前端枚举绕过状态检查。`auto-close` 只在获授权 SYSTEM job，未开放 HTTP。

200 成功结果：`{ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id,replayed}`。失败 ledger 结果：`{ok:false,error:{code,retryable},replayed}`；HTTP 按结果映射为 403/409/503。每次 receipt 查找先重查活动身份和对象可读权限；新写入另查当前动作权限和版本。已 COMMITTED／FAILED 的 receipt 重放只读取原结果，不再次写入，也不重新执行动作许可检查。仅失去写动作但仍可读时可核对旧收据；身份失效或对象失权拒绝收据。改 payload 不能沿用同一 ID。

合成接单成功响应（之后仍应重读详情）：

```json
{"ok":true,"ticket_id":"11111111-1111-4111-8111-111111111111","ticket_version":5,"ticket_event_id":"33333333-3333-4333-8333-333333333333","control_event_id":null,"replayed":false}
```

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_version":4,"reason_code":"WORKBENCH_CONFIRMED"}
```

## 等待报修人的同轮次关联（WBINT-T10，首片段）

本段是T10首个公开RED后准备的**源码增量，新的候选仍SOURCE_UNVERIFIED**；不是整票完成、发布或启用。实际原RED及归档见[T10执行](../../../plans/admin-workbench-integration/execution/t10.md)。本片段只扩展既有W `POST /api/tickets/{ticketId}/request-information`；厂商等待、恢复、取消的T10消费合同与菜单／草稿／只读核对尚待后续片段，不由本段声明已完成。

新显式宿主选项`ticketWaitingActionsEnabled:boolean=false`，在当前首片段仅启用request-information的轮次关联和事件引用投影。false保留原路由可选note／external_visible与原六字段结果，新增分支不读039。true要求已安装039；命令在receipt和业务写入前核对迁移标记，缺失返回503 `P2_016_SELF_HANDLING_UNAVAILABLE`，readiness同样不就绪。没有新迁移、表、Ticket、责任或receipt事实源。

开启此profile的request-information闭合body沿[输入Schema](../../../contracts/p2_016_waiting_action_command.schema.json)：`client_command_id:UUID,expected_version:number(1..2147483647),reason_code:大写code(1..64),note:string(原长1..2000且trim非空),external_visible:false`。服务器不改原正文／hash。Origin/CSRF、Idempotency-Key、If-Match、32KiB与当前活动角色／对象权限沿原W合同；HANDLER仍须是同组当前处理人，ADMIN/DISPATCHER沿既有许可，状态只允许IN_PROGRESS→WAITING_REQUESTER。

原Core Action持有Ticket行锁，在同一ledger业务SAVEPOINT内从该Ticket读取真实`current_handling_cycle_id`，把本次真实waiting_requester event写入已有`ticket_handling_cycle_event`。既有同Ticket FK保证归属；不创建轮次，不改cycle_no、source、首次责任、人／组或Conversation责任。旧合法无轮次Ticket返回null并保留真实历史。关联、原通知／实时投影与COMMITTED receipt均在同一事务；事务故障与竞争行为尚待本候选运行证据。

新写入的安全200结果为[结果Schema](../../../contracts/p2_016_waiting_action_result.schema.json)的原六字段加`handling_cycle_id:UUID|null`，无原因正文。原receipt重放读取原快照；既有兼容profile已提交的六字段收据不被回填或改造为新历史。`GET /api/tickets/{ticketId}/events`在该选项true时，为每个获权事件增加`handling_cycle_id:UUID|null`，从该event的已持久关联读取；不能把Ticket当前cycle投射给未关联的旧事件。[事件页Schema](../../../contracts/p2_016_waiting_event_page.schema.json)仅描述该true profile，原时间／排序／分页字段沿实际原合同。类型见[P2016RequestInformationResult／P2016TicketEventProjection](../../../contracts/p2_016_contracts.d.ts)。

复用原App/API/SSE、池和查询分页；新profile不增加进程、轮询或外发。关闭ticketWaitingActionsEnabled回到原合同，保留已提交event／cycle关联／receipt；源码撤销使用独立forward/revert，不删除事实。本片段未接bootstrap菜单能力或新增只读receipt URL。整票角色／版本／幂等／原子性矩阵、正式bundle菜单和原因恢复仍IN_PROGRESS；本候选build／strict／HTTP验证均NOT_RUN。

## 可靠内部备注（WBINT-T02）

W `POST /api/tickets/{ticketId}/internal-notes` 复用现有 `add-note` facade／ledger／事务；新宿主选项 `workbenchInternalNotesEnabled:boolean=false` 与原生命周期开关共同限制入口。未启用返回 `503 P2_016_DISABLED`；关闭此选项不改变旧 `/notes` 兼容合同、已提交 Ticket／事件／receipt 或其他默认开关。无需数据库变更、事实表、进程或连接池。T03 补齐下文专用只读核对入口。

输入 Schema：[专用内部备注](../../../contracts/p2_016_internal_note_command.schema.json)；类型：[P2016InternalNoteCommand](../../../contracts/p2_016_contracts.d.ts)。闭合 JSON 必需五字段：UUID `client_command_id`、安全整数 `expected_version`（1..2147483647）、大写 code `reason_code`（1..64）、`note:string`（1..2000，trim 后必须非空，运行时按 UTF-16 长度约束）、`external_visible:false`。不得带目标、action、ticket_id 或额外字段。客户端只在首次提交前 trim，服务器不改原正文／hash。Cookie 写入沿公共 32 KiB、精确 Origin／CSRF、非 cross-site、Header/body UUID 与 If-Match 数字版本匹配规则。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_version":2,"reason_code":"WORKBENCH_INTERNAL_NOTE","note":"合成内部排查记录","external_visible":false}
```

200 结果沿上文，专用备注的 `control_event_id:null`；无正文或私有身份回传。新增写入保持状态／处理责任，版本增加一次，追加 `ticket.note_added` 的 `internal_note`，`external_note=null`。备注不生成外部通知意图；Reporter 按既有里程碑 allowlist 读取，不能读取此正文。沿用原 principal scope＋UUID，原 payload／版本重放返回原 receipt；改 payload 为 409，陈旧新命令为 409，当前动作拒绝为 403，对象不可读为 404，身份失效为 401／403。事务／SAVEPOINT、通知策略和实时锁顺序保持。

正式 React [TicketNotes](../../../app/pc-admin/src/features/ticket-notes/TicketNotes.tsx) 只在 `internal_notes_enabled=true` 时读取真实 `GET /api/tickets/{ticketId}`。界面显示服务器当前 `allowed_actions` 和数字 `version`；只有当前 `add-note` 许可才提供新写入，未建单事项不猜测能力。`idle／submitting／checking／succeeded／denied／conflict／unknown` 分别呈现；单表单只允许一个 in-flight。可信成功才清输入并使 context／detail／board 查询失效，重读失败不反转已提交结论。

网络失败、发出后的 abort、200 正文／字段不可信、无法确认的 5xx 均保留不可变原 UUID＋原版本＋原 payload，锁定输入并显式“核对保存结果”重放同一 POST；不自动重试或生成新操作。409 保留输入并重读，用户再次明确提交才产生新意图。可信 401／403／404 即使正文不可解析仍触发授权清理；401 清整个会话，对象拒绝取消并清同对象 detail／command-context、刷新 board。组件卸载 abort 自有 POST，abort 不证明未提交。未启用恢复时草稿／原命令仍只存组件内存，close／move 和 beforeunload 保护保留；启用 T03 后，仅实际持久快照已保存才可安全离开。

## 当前浏览器草稿与只读核对（WBINT-T03）

宿主 `workbenchDraftRecoveryEnabled:boolean=false`；只有 notes 与 recovery 均启用，bootstrap 的 `draft_recovery_enabled` 才为 true。当前消费者是内部备注；通用 [存储](../../../app/pc-admin/src/features/drafts/encrypted-drafts.ts) 以 `[principal_id,kind,id,purpose]` 隔离，后续表单须定义自身闭合载荷和权限恢复规则，不能直接借用内部备注授权。详见[前端合同](../../../app/pc-admin/README.md#当前浏览器草稿恢复wbint-t03)和[执行记录](../../../plans/admin-workbench-integration/execution/t03.md)。

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

MVP 接单简化：草稿恢复关闭且非看板快捷操作时，首批完整结果若只有一个可承接的会话，并且无人接待或接待人为本人，显示“我来处理并回复”。点击该按钮才明确选取此会话及当前版本，并提交原子命令；仅打开页面不选择或提交。多人、分页、他人接待、冲突或未知结果沿原选择与核对流程。可点“更多接单选项”保留当前沟通人或稍后处理。无新接口、权限、数据库或默认开关变更。

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

正式 [TicketSelfHandling](../../../app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx) 仅在 bootstrap 能力开启后读取真实 Ticket command-context，按服务端新 actions 呈现两种按钮。处理组固定为服务端当前组，不从卡片、角色或沟通责任推断。共享 T02 的 unknown 响应核验；原动作与闭合 payload 在组件内存冻结，未知仅显式核对同一 POST，不使用新 UUID/版本/组。成功失效 context/detail/board，GET 未返回前不接受新的提交；不会按动画或 version+N 移卡。可信失权取消/清同对象缓存，组件卸载 abort 自有 POST；abort 不证明未提交。提交中与未知限制详情关闭/切换并提醒页面离开；跨刷新持久恢复仍由 T03 的独立合同维护，不在本票扩展。

错误：输入/额外字段400，Header/版本或责任/状态/真会话冲突409，当前角色/组/成员拒绝403，对象失权404，活动身份失效401/403，关闭或未安装039为503。稳定拒绝含 `P2_016_SELF_HANDLING_OWNER_CONFLICT/CONVERSATION_REQUIRED/STATE_CONFLICT/UNAVAILABLE`；前缀后三个分别为完整 `P2_016_SELF_HANDLING_*` code。事务失败的 FAILED receipt 以既有 `P2_016_ACTION_FAILED` 返回503且不重试业务。

## 原子接管并接单

`POST /api/conversations/{sessionId}/takeover-and-accept-ticket`：必需 `client_command_id,ticket_id,expected_ticket_version:number,expected_session_row_version:number,reason_code`；Header If-Match 对**会话版本**。Session 和 Ticket 来源必须匹配、combined_accept_allowed 且当前权限成立。两种责任在同一事务内全部成功或回滚，结果同 Ticket 命令并含 control_event_id。

[combined schema](../../../contracts/p2_016_combined_takeover_accept.schema.json)、[transfer schema](../../../contracts/p2_016_ticket_transfer_command.schema.json)、[action schema](../../../contracts/p2_016_ticket_action_command.schema.json)。

## Ticket 通知控制

| METHOD + PATH | Body | 成功 |
| --- | --- | --- |
| `POST /api/tickets/{ticketId}/deliveries/{deliveryId}/retry` | client_command_id、reason_code 必需 | 200 `{ok:true,delivery_id,status,replayed}` |
| `POST /api/tickets/{ticketId}/deliveries/{deliveryId}/reconcile` | 同上，加 resolution=`CONFIRMED_SENT\|CONFIRMED_NOT_SENT_REQUEUE\|CANCEL` | 同上 |

这两条无需 If-Match，仍需幂等和身份/CSRF，检查 delivery 属于该 Ticket。[控制实现](../../../app/server/src/p2-016-delivery-control.mts)。UNKNOWN 不可普通重发；核对操作须具备相应权限。

常见码：`P2_016_FORBIDDEN/NOT_FOUND/VERSION_CONFLICT/COMMAND_CONFLICT/ACTION_FAILED/TARGET_INVALID/CONTROL_CONFLICT/DELIVERY_STATE_CONFLICT`，以及主宿主 WORKBENCH 错误。详情刷新不能等于命令成功。

核对测试：[HTTP integration](../../../tests/p2-016-workbench-http.integration.test.mjs)、[auth integration](../../../tests/p2-016-workbench-auth.integration.test.mjs)、[T04](../../../tests/t04-self-handling.integration.test.mjs)。背景：[生命周期与双责任](../../59_p2_016_ticket_lifecycle_and_responsibility.md)。本票仅显式增加039轮次结构；生产权限未改变。

## 同事接管并工作人员完工（WBINT-T12，默认关闭）

W 的三个入口与正式管理端表单已实现，隔离 PG、真实 loopback HTTP 和本次生产 bundle 的局部业务验证已完成；最终整票检查、两轴审查与自有清理进度见[本票执行](../../../plans/admin-workbench-integration/execution/t12.md)。这不是部署启用或现场发送授权。[command](../../../contracts/p2_016_takeover_completion_command.schema.json)、[result](../../../contracts/p2_016_takeover_completion_result.schema.json)、[targets](../../../contracts/p2_016_takeover_completion_targets.schema.json)、[safe ACK](../../../contracts/p2_016_takeover_completion_receipt.schema.json)、[DTS](../../../contracts/p2_016_takeover_completion_contracts.d.ts)保持原冻结合同；[service](../../../app/server/src/workbench-ticket-takeover-completion.mts)复用原 T07/T11 callerTx。

`POST /api/tickets/{ticketId}/takeover-and-complete` 使用独立宿主 `ticketTakeoverCompletionEnabled:boolean=false`。空 query、闭合十字段 client_command_id/expected_version/reason_code=STAFF_COMPLETED/resolver_team_id/handling_cycle_id/communication_choice/sessions/internal_process/external_summary/external_summary_confirmed=true；UUID、整数1..2147483647、CODE沿现有 guard。RETAIN_CURRENT 必须 []；TAKE_SELECTED 必须1..8个规范去重 Session 与各自原版本。单 body32KiB，JSON、同源 Origin/CSRF、Idempotency-Key=UUID、强引用 `If-Match: "<expected_version>"`；拒绝 actor、target、force 和额外字段。默认同时承接沟通，但不预选组或 Session；用户明确选择本人的真实组及关联对象，或明确保留沟通责任。内部过程必填、trim非空、原长≤2000；独立空白公开摘要必填、原长≤500，预览并显式确认，编辑及非 pending 恢复后须重新确认。

前态仅 T11 合法 IN_PROGRESS、WAITING_REQUESTER、WAITING_VENDOR，要求真实当前未结束 cycle、同 Ticket/sourceIntake 和原首次责任依据。等待态同事务 resume→complete，保留两条事件；不能隐式 accept/start、回填轮次或伪称报修人确认。服务器核验当前 Ticket READ/活动业务 role、原操作范围、真实 SELF 活动目标组和成员，以及每个所选 Session 的当前关系、READ、Control、版本；权限锁持有到 commit。原处理人和组完全相同拒绝，原处理人的独立完工使用 T11。

一次 UUID、一个 WORKBENCH_TICKET_TAKEOVER_COMPLETION ledger/callerTx 覆盖所选 Control、SELF/组 transfer、追加 assignment metadata、StaffClosed、cycle/end、040 唯一通知承诺及安全实时投影。任一步失败全部回滚业务事实；FAILED 审计沿原 ledger 保留。原 body/hash 重放不重复事实；不嵌套两个 perform/receipt，不串两个 POST。T12 与旧 Facade 写入在 receipt 外键之前取得同一 stream mutex，独立 T12 开启不改变旧三写 flag、权限或 allowed_actions。039/040 复用，**无新 SQL**；缺任一结构时启用 readiness/命令503先于 receipt。通知沿既有 source/T24 Outbox/Delivery，不直接发送、不重复同轮 FIRST。

`GET /api/tickets/{ticketId}/takeover-completion-targets?resolver_team_id=CODE` 只接受这一个可选参数，闭合返回当前 SELF 实际活动组（展示≤100）、明确所选组及合法 action；100外明确合法组独立核验。`GET /api/tickets/{ticketId}/takeover-completion/commands/{commandId}` 仅空 query，要求当前 READ、原 actor/Ticket/UUID/purpose，且本能力与 raw `workbenchDraftRecoveryEnabled` 同时开启。闭合 UNKNOWN、COMMITTED 安全 Ticket/版本/event/STAFF_COMPLETED basis，或 FAILED 稳定 code/retryable:false；无原 body、文案、组、人或 Session，不读 result_snapshot。UNKNOWN 不证明未提交。200 POST 结果只有安全 Ticket/event/cycle basis、显式沟通 choice、所选 Session 版本与 Control 结果，不代表报修人确认或通知送达。

bootstrap 的 `ticket_takeover_completion_enabled` 为独立能力，`ticket_takeover_completion_draft_recovery_enabled` 为该能力 AND raw recovery，不借 Notes/T07/T11 写 flag 开启旧动作。Query 仅增加独立只读 cycle/related 投影，旧三写能力及 allowed_actions 保持原值。表单通过既有公开 related-conversations 分页核验最多8个已选对象；核验未完成时禁提交并保留输入，遍历到末页仍缺失或明确失效才清对应选择，合法跨页选择保留。一个 Session 失权不扩大成 Ticket 失权。

可信401清当前 session scope；Ticket级404或 context403清本 Ticket 的私有输入、在途请求和共享缓存。targets/related 的可信401/404同样触发清理；普通目标资格403不误清仍可读 Ticket。409保留独立输入，fresh GET 后由用户明确新意图。网络、畸形响应或未知终态冻结原 UUID/body/version/cycle，零自动 POST；人工核对按钮只 GET，raw recovery 关闭时保留本页 UNKNOWN capture并禁用核对，绝不将核对变成 POST。动作消失后 pending/opaque controller继续挂载，仅隐藏或禁用闲置新提交。

purpose=ticket-takeover-completion复用 T03 AES-GCM、非导出密钥、24h、20 cipher/20 opaque、16KiB、500ms、当前授权及 generation/revision fence，不另建 store/epoch。非 pending 输入恢复须重新确认；过期、失权或临时授权失败不展示未经复核的私有内容，原 opaque UUID用于只读核对。丢弃或结算仅清匹配用途，不覆盖其它草稿；真实 commit 后本地清理失败保留已知结果和导航保护，人工原 GET 与成功清理后释放保护。失权后的晚到 POST/ACK/解密不得恢复内容。

表单 in-flight1、最多8 Session、组展示100、App/API/SSE1、Worker1、Gateway单活、SSE32、池≤4/总建议≤8，Communication/Integration concurrency1；无新库、池、poller 或 worker。关闭能力拒绝新操作并保留已提交责任、关闭、历史、receipt 和 Outbox 承诺。真实外部服务、发送、部署、full/certify 和 Gate 仍未授权。

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

W 的 `POST /api/tickets/{ticketId}/assign` 与 `/transfer-assignment` 使用宿主 `ticketAssignmentEnabled:boolean=false`。有效人/组、明确沟通原子交接、候选查询、正式表单、终态、回执、同轮通知、事务权限锁及专用恢复均已完成隔离公开验证；固定被测身份、七项映射与相关回归见[本票执行记录](../../../plans/admin-workbench-integration/execution/t06.md)。[command](../../../contracts/p2_016_assignment_command.schema.json)、[result](../../../contracts/p2_016_assignment_result.schema.json)、[types](../../../contracts/p2_016_contracts.d.ts)、[service](../../../app/server/src/workbench-ticket-assignment.mts)。

沿W认证/当前Ticket可见范围、Origin/CSRF、Idempotency-Key=client_command_id、If-Match=expected_version和32KiB上限。闭合body的七字段为UUID client_command_id、数字整数expected_version（1..2147483647）、CODE reason_code、UUID target_principal_id、CODE resolver_team_id、communication_choice、sessions。RETAIN_CURRENT必须空sessions；TRANSFER_SELECTED必须1..8个唯一、真实关联且当前分别获权的 `{session_id:UUID,expected_row_version:number}`。调用者必须独立具有Conversation Control权限；Ticket读取不授予Session权限。Session按UUID排序锁定，在原Ticket组范围内先执行Control caller事务，再执行人/组责任写；任何业务写失败全部回滚，保留FAILED审计。拒绝actor/来源/通知目的地/force/任意额外字段。

合法派单仅无当前处理人的NEW/QUEUED；NEW使用原Core queue进入QUEUED，绝不执行accept/start。操作者须保持原Ticket读权及活动内部业务角色；目标须是选定活动组中的真实活动内部ADMIN/DISPATCHER/HANDLER。组成员指目标承接者，不要求操作者同时加入目标组，不授予新的Ticket读取或系统管理权限。外部厂商不成为候选内部Principal。

显式转派仅有当前处理人的QUEUED/ACCEPTED/IN_PROGRESS/WAITING_REQUESTER/WAITING_VENDOR；当前合法可读的活动内部业务同事可操作，不要求自己是原处理人。原目标人和组完全不变时拒绝。复用同一责任写/event/ledger事务，仅人和实际有效目标组改变，状态、来源和已有轮次/first-responsibility依据保留，事件加入原轮次；legacy本无轮次时不补造历史轮次。新路径不调用accept/start；旧`/transfer`保留输入及角色合同，同样阻断终态绕过。目标活动人、真实成员、活动组、业务角色和操作者当前业务角色/可见成员在事务内验权并持共享锁至提交，不把候选查询或旧缓存当权限租约。外部协助的WAITING_VENDOR仍由内部同事负责。

只读候选查询为 `GET /api/tickets/{ticketId}/assignment-targets?resolver_team_id=CODE`，闭合输出为 `{resolver_teams:[{team_id,display_name}],resolver_team_id:CODE|null,items:[{principal_id,display_name}]}`，见[targets Schema](../../../contracts/p2_016_assignment_targets.schema.json)。只在当前Ticket原读权、活动内部业务角色及当前可派单/转派动作内，返回有有效内部业务承接者的活动组；100只是展示上限，显式合法所选组按独立活动组/成员事实核验并仍纳入最多100项的有界响应，不把排序第101项误作403或业务权限上限。组按CODE排序，成员按display_name/id排序且最多100，只返回活动真实内部业务成员。不要求操作者属于目标组；未选组返回null/空items，多个组必须明确选择。查询闭合为可选resolver_team_id:CODE及target_principal_id:UUID；提供所选人必须同时明确组。所选目标按该活动组真实活动成员/内部业务角色独立核验，合法目标即使普通100人展示页缺席也纳入最多100项有界响应，原display_name/id排序与安全两字段保持；真实失效目标或不允许组403、缺明确组/非法query400、Ticket不可见404、关闭/缺039为503。列表缺席本身不作为草稿撤权依据。读取不写Ticket/Event/cycle/receipt，不返回登录身份、联系方式、外部身份或整份成员图；提交仍按实际活动组、成员、角色及当前权限独立核验，查询不提供权限凭据。

`GET /api/tickets/{id}/related-conversations?limit=20&cursor=...`在T06单独启用时可沿既有当前Session scope/Control授权发现安全规范会话；仍只返回原最小六字段与20项keyset分页，不启动独立T05写能力。正式表单无默认组、人或沟通选择；TRANSFER_SELECTED仅交接人工勾选的真实会话及原版本，选择本身不POST。提交一个闭合命令，成功后真正GET当前事实；失去Ticket原范围则清除私有事项，不能为展示新责任授予额外读权。409保留选择，读取当前版本后由用户再次明确确认。

`GET /api/tickets/{id}/assignment/commands/{uuid}`依赖实际 assignment 能力，只在当前原 Principal/Ticket/WORKBENCH_TICKET_ASSIGNMENT 用途内 READ ONLY 核对。2026-10-19 的首期 MVP 调整将此提交核对与浏览器草稿存储分开：`workbenchDraftRecoveryEnabled=false` 时仍可核对原操作，不能恢复或写入新的草稿。闭合[receipt Schema](../../../contracts/p2_016_assignment_receipt.schema.json)为 UNKNOWN 单字段、COMMITTED 仅 state/Ticket/version/event，或 FAILED 仅 state/code/retryable:false；不返回目标、Session 身份、正文或完整 result_snapshot。其他主体/事项/用途不泄漏 receipt，UNKNOWN 不表示未提交；失去写动作但保留当前读权时可只读核对原标识。未启用 assignment 时仍拒绝此入口。历史 T06 执行记录保留原条件，不作为本次装配的说明。

bootstrap的 `ticket_assignment_draft_recovery_enabled` 为assignment能力AND raw恢复开关，缺字段按false。purpose `ticket-assignment`复用T03唯一AES-GCM、非导出钥、24h固定TTL、主体/事项/用途AAD、generation fence和跨tab清理；不延长TTL。冻结原UUID、动作、Ticket版本、目标人/组、明确沟通选择与Session原版本；恢复前核对当前主体、能力、Ticket、目标和每个Session独立读权/真实关联。UNKNOWN不自动创建新UUID或发送；开启恢复时仅用户明确GET原安全ACK，raw=false不打开IndexedDB，内存核对只复用原意图幂等命令。仅明确失权或关联撤销清理敏感内容；临时503／网络失败保留原密文与不透明操作，未核验选择不显示且禁止新提交，服务恢复后刷新重新授权再恢复。过期清理敏感内容，保留原opaque命令供当前合法读权核对；成功后清理副本并GET事实。

仅原Ticket保存owner/team；原ticket.assignment_transferred追加前后人/组和实际操作者，039保存该真实首次派单事件的轮次/首次责任依据及同轮event引用，原来源不改。责任、事件、轮次、既有安全实时投影与原principal-scoped ledger的WORKBENCH_TICKET_ASSIGNMENT receipt同事务。每次原命令重放在查账本之前也重新验证当前Ticket与所选规范Session的READ权限；不得返回已失权Session元数据，也不要求已经交出的TRANSFER写权。专用安全ACK仍只核对当前Ticket读权并返回最小四字段，无Session引用。依赖显式039、无新数据库变更；关闭后新路径503、不读039，保留旧profiles及真实历史。缺039为ASSIGNMENT_UNAVAILABLE/503且不插receipt；非法前态或责任为ASSIGNMENT_STATE_CONFLICT/409，其余现有INPUT_INVALID/TARGET_INVALID/FORBIDDEN/NOT_FOUND/VERSION_CONFLICT/COMMAND_CONFLICT/ACTION_FAILED维持W状态合同。结果仅Ticket/event/version、可空handling_cycle、沟通选择与安全会话结果；不返回报修正文、外部身份或登录资料。

复用原pool≤4/同机建议≤8、单App/API/SSE与Worker、Gateway单活、SSE32；无新进程/轮询/外发。回退关闭option，保留责任/event/cycle/receipt；本片段和整票状态区分，真实外部服务/发送、部署、full/certify/Gate仍NOT_RUN。

## 跨团队本人接管（WBINT-T07 SOURCE）

2026-10-12：原SOURCE合同已在T07私树接入真实HTTP、唯一Ticket Core／Control事务、当前权限投影和正式React制品；本地合成PG／HTTP／浏览器证据见[本票记录](../../../plans/admin-workbench-integration/execution/t07.md)。五份冻结Schema／DTS保留2026-10-09原字节，其SOURCE题注属于历史准备元信息。最终严格检查、独立审查、资源清理和原七项收口以本票最终交接为准；本地能力不改变默认关闭、生产授权、外部发送或Gate。

| 已挂载HTTP（默认关闭） | 用途 |
| --- | --- |
| `POST /api/tickets/{ticketId}/takeover` | 仅交接当前处理人及有效处理组；保留合法状态 |
| `POST /api/tickets/{ticketId}/takeover-and-start` | 同事务交接及合法accept/start；浏览器只提交一次 |
| `GET /api/tickets/{ticketId}/takeover-targets?resolver_team_id=CODE` | 当前原读权及业务权限下，本人实际所属有效组；多组明确选择 |
| `GET /api/tickets/{ticketId}/takeover/commands/{commandId}` | raw恢复开关开启时，原Principal/Ticket/UUID/专用用途的READ ONLY安全核对 |

两个POST共享闭合[command Schema](../../../contracts/p2_016_takeover_command.schema.json)，仅六字段：`client_command_id:UUID`、`expected_version:integer`、`reason_code:CODE`、`resolver_team_id:CODE`、`communication_choice`、`sessions`。path决定动作和Ticket，服务端当前认证主体即新处理人；拒绝`target_principal_id`、`actor_principal_id`、角色、force、状态或任意额外字段。沿用W的Origin/CSRF、32KiB、Idempotency-Key等于body原UUID、If-Match等于Ticket版本。UUID规范化后拒绝重复Session；`TAKE_SELECTED`须明确选择1–8个规范关联Session及各原`expected_row_version:integer`，`RETAIN_CURRENT`须`sessions=[]`且不写任何Conversation。不得根据换组后的新可见性倒推原沟通交接权限。

| 前态（须已有当前处理人） | `takeover` | `takeover-and-start` |
| --- | --- | --- |
| QUEUED | 人和组交接，仍QUEUED，保留原可空轮次/依据 | 须有效current cycle及已有非空first basis；交接后原Core合法accept→start，同一事务/轮次 |
| ACCEPTED | 人和组交接，仍ACCEPTED，保留原可空轮次/依据 | 须有效current cycle及已有非空first basis；交接后原Core合法start→IN_PROGRESS |
| IN_PROGRESS | 人和组交接，仍IN_PROGRESS | 409，不重复started |
| WAITING_REQUESTER / WAITING_VENDOR | 人和组交接，保留等待 | 409，不把resume混为start |
| NEW / REOPENED / RESOLVED / CLOSED / CANCELLED / DUPLICATE_LINKED，或无当前处理人 | 409 | 409 |

仅接管沿已集成T06合法transfer的当前状态/责任事实；`current_handling_cycle_id=null`且不存在已有cycle时允许交接并返回`handling_cycle:null`，不为旧活跃事实虚构轮次或历史首次责任。原有效cycle及其可空first basis保持原值；有cycle才追加该真实责任事件的cycle link。损坏current pointer、指向他Ticket的cycle，或current为空但存在孤立cycle均fail-closed/409，不以null掩盖损坏。一步开始独立要求有效current cycle及已有非空first basis；缺此依据409，不自动历史回填、创轮次或补首次通知。

同本人同组且无责任变化返回409；相同原UUID合法重放按原结果核对。仅拥有读取权限仍须具备活动ADMIN/DISPATCHER/HANDLER业务角色；普通HANDLER不须为旧owner，但必须在原Ticket本人/实际所属旧组读取范围内。新组必须活动、实际包含本人且本次可用；不能复用T06“任意内部目标人”的候选列表作为本人接管授权。活动主体/角色、原可见组及目标本人/成员/组在事务内重新取得并持锁到commit，Ticket版本、Session原版本和逐对象Control动作同时核验。Ticket接管不授予他人沟通TRANSFER权限、全院读取、管理或通知核对权限。

[targets Schema](../../../contracts/p2_016_takeover_targets.schema.json)闭合为`{resolver_teams:[{team_id,display_name}],resolver_team_id:CODE|null,allowed_actions:[...]}`。查询只接受可选`resolver_team_id`；组按CODE排序、最多100展示项，不返回人员目录/联系方式/外部身份。显式所选组独立验证有效本人membership后纳入最多100项响应，列表缺席不等同撤权；查询不构成稍后提交的授权租约。既有`related-conversations`规范关系、20项keyset及逐对象当前Session读取继续复用；T07可独立读取规范选择，不启用T05独立写能力。detail与targets都按当前合法责任、实际本人组和有效轮次投影动作。

[result Schema](../../../contracts/p2_016_takeover_result.schema.json)与[独立类型](../../../contracts/p2_016_takeover_contracts.d.ts)仅返回Ticket/version/最后Ticket event、`control_event_id:null`、原可空handling_cycle（已有cycle的first basis也可空）、沟通选择及安全Session结果。一步开始使用同Schema的`#/$defs/started_result`及`P2016TakeoverAndStartResult`非空轮次/依据约束。仅接管追加唯一`ticket.assignment_transferred`，保留原/新人及组/实际操作者metadata；一步开始另追加合法accept/start。存在有效039 current cycle时保留原first responsibility basis并追加同轮event links；无cycle仅交接当前责任，不回填任意历史accept、不创建新轮次、不重复或新造首次责任通知、不改原Intake/来源。既有公开events仍仅含安全字段；本票隔离PG独立核验实际metadata及同轮持久event links，未向HTTP扩大私有字段。

所有责任、合法状态动作、Control/generation、轮次链接、通知/实时投影及原ledger回执同事务提交。复用T06 stream mutex→receipt→Ticket→UUID排序Session及authority锁约束，选定沟通在Ticket换组前按原scope验证，并使用既有`takeResponsibilityInTransaction`本人caller-Tx seam；第二对象及后段start event、cycle link、COMMITTED receipt失败均全回滚。复用原`ticket_command_receipt`及专用用途`WORKBENCH_TICKET_TAKEOVER`；同UUID异payload409，重放前重验当前Ticket与所选Session READ scope，失去原写权不等同失去核对读权。[receipt Schema](../../../contracts/p2_016_takeover_receipt.schema.json)只返回UNKNOWN、COMMITTED最小四字段或FAILED稳定code/retryable:false，不查询组/Session/完整snapshot；UNKNOWN不表示未提交。

宿主选项`ticketTakeoverEnabled:boolean=false`；关闭及缺039在插入receipt前503，缺039沿用`ASSIGNMENT_UNAVAILABLE`，非法前态沿用`ASSIGNMENT_STATE_CONFLICT/409`，其余W现有INPUT_INVALID/TARGET_INVALID/FORBIDDEN/NOT_FOUND/VERSION_CONFLICT/COMMAND_CONFLICT/ACTION_FAILED保持。bootstrap返回`ticket_takeover_enabled`和`ticket_takeover_draft_recovery_enabled = ticketTakeoverEnabled && raw workbenchDraftRecoveryEnabled`。正式表单按ADR0031默认TAKE_SELECTED，组选项仍为空且不预选Session；保留沟通由用户明确选择。其独立“本次接管的沟通责任”决定该次POST；原T04/T05恢复控制器保持挂载；只有无可用新动作、原intent/result/input或opaque时隐藏闲置呈现。无关联会话的Ticket不创建虚构Session，用户可明确RETAIN_CURRENT。

专用purpose`ticket-takeover`复用T03唯一AES-GCM、24h、20份/16KiB及原主体/事项/用途AAD。原UUID、动作、Ticket版本、原目标组、沟通选择和Session原版本全部冻结；恢复前真实核验，503保留密文但不显示未核验内容或提交。首次授权暂不可用时也保留opaque原UUID，仅允许用户显式只读ACK；核对终态后按原revision清理，未初始化的写表单要求重新读取。成功／丢弃／退出／明确失权清理，过期仅保留opaque原操作核对；用途清理不删除同Ticket内部备注草稿。raw关闭不创建恢复库、不访问ACK，只能用户显式重放内存原POST。真实本地会话退出后迟到解密／POST／ACK不得恢复表单或副本；不可把当前GET版本替换到原pending命令。

明确无新数据库变更：复用唯一Ticket/Event/039 cycle与event links/原ledger/Control；原29份SQL保持字节，不使用预留056。每池≤4、同机建议总≤8、单App/Worker、Gateway单活、SSE32、Session选择≤8；无新常驻进程／轮询。关闭新option停止新接管入口及投影，保留已提交责任／历史／回执／Outbox。原7729字节首tracer已真实404 RED→PASS且不修改；状态、独立沟通、并发／authority锁、原子失败、恢复及正式制品浏览器逐项实际结果和历史FAIL／NOT_REACHED均由本票执行记录及D证据保留。

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

## 停止处理并退回（WBINT-T09，本地整票验证完成，父集成待收口）

以下是 [#64](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/64) 的冻结合同。历史 b0cd 对象的真实 PC 输入恢复／UNKNOWN／ACK 及三条 HTTP 原首共 4 PASS，69ae 对象的安全 ACK、字段权限及竞争重放再承接共 5 PASS；各自旧 FAIL 与原被测对象保留。已正常合入 Root918／T07／T24/041；固定 c638 一次 build／strict／artifact 0/0/0，当前合同、独立能力、057、事务回滚、默认关闭、041 组装及生产 PC 共 23 PASS／0 FAIL／0 SKIP，自有 PG 和客户端已精确关闭。两轴 9b 修补审查三项 CLOSED_SOURCE、新问题 0，c638 产品同 blob。状态 **LOCAL_VERIFIED_WHOLE_PARENT_HANDOFF**；#64 与来源导航待父独立验收／集成收口。独立动作覆盖 `IN_PROGRESS|WAITING_REQUESTER|WAITING_VENDOR → QUEUED`，当前处理人或获权 ADMIN／DISPATCHER 记录原因及未完成工作后清处理人，保留处理组、本轮及来源历史，默认保留独立沟通责任。完整被测对象、版本、七项结论和历史限制见 [T09 执行记录](../../../plans/admin-workbench-integration/execution/t09.md)。

| METHOD + PATH（W；验证对象见执行记录） | 合同与状态 |
| --- | --- |
| `POST /api/tickets/{ticketId}/return-to-dispatch` | 已实现；RETAIN_CURRENT在9eab、单Session TRANSFER_SELECTED在cca730原HTTP1PASS。单个原子停止退回命令；[闭合八字段Schema](../../../contracts/p2_016_return_to_dispatch_command.schema.json)，[安全结果Schema](../../../contracts/p2_016_return_to_dispatch_result.schema.json)。c638 生产 PC 的默认保留、双 Session 显式原子交接和陈旧版本拒绝均已验证 |
| `GET /api/tickets/{ticketId}/return-to-dispatch/commands/{commandId}` | 已实现；1528原HTTP1PASS。当前Ticket READ、原principal／Ticket／专用用途及UUID；[闭合安全ACK](../../../contracts/p2_016_return_to_dispatch_receipt.schema.json)不返回原因、未完成工作或所选Session。整个W读入口启用且当前TicketREAD有效，独立于T09写option与raw恢复；literal 写 false、raw false、当前 READ／actor／purpose／UUID 边界已在 c638 原例验证 |
| `GET /api/lifecycle/bootstrap`、`GET /api/tickets/{ticketId}` | 已验证 T09 两项 boolean 能力及获权`allowed_actions: return-to-dispatch`；[闭合能力片段](../../../contracts/p2_016_return_to_dispatch_capability.schema.json)。缺省能力按false解码；广告不执行命令，仍由POST锁后再次验权 |
| `GET /api/tickets/{ticketId}/related-conversations[?cursor=…]` | 复用已实现的canonical关联会话分页；每页≤20，真实row_version与take_allowed。c638 仅 T09=true、T05／T06／T07／T08=false 的实际 GET 与交接已验证；不根据最近消息猜测Session |
| `GET /api/conversations/{sessionId}/eligible-principals` | 复用已实现的当前Session读权与活动内部资格列表，每页≤100；生产消费者对最多8个明确Session串行读取TRANSFER_TARGET交集，再逐Session复核READ／Control／版本／关系。列表不授予写权；原target未在有界列表中出现只算未核验，不据此清除密文 |
| `GET /api/tickets/{ticketId}/return-to-dispatch/communication-targets[?target_principal_id=UUID]` | **PLANNED，未挂载，PC不调用。** [专用沟通target页计划](../../../contracts/p2_016_return_to_dispatch_targets.schema.json)最多100，合法保存target可在界内pin；需要此专用能力时另以真实公开RED验证后实现 |

命令恰为`client_command_id:UUID,expected_version:number(1..2147483647),reason_code:CODE(1..64),reason:string,unfinished_work:string,communication_choice:RETAIN_CURRENT|TRANSFER_SELECTED,communication_target_principal_id:UUID|null,sessions:[{session_id:UUID,expected_row_version:number}]`。reason原UTF16长度≤500、unfinished_work≤1400，分别trim后必填；服务器加固定“停止原因／未完成工作”标题保存在既有internal_note，整体≤2000，原ledger命令还保留两个独立字段。内部记录不作为状态解析输入，不提供external_visible、外部摘要或接收人。RETAIN_CURRENT要求null target和空sessions；TRANSFER_SELECTED要求明确活动内部target及1..8个规范唯一真实关联Session，逐Session版本为1..2147483647。[类型和私有事件提案](../../../contracts/workbench_return_to_dispatch_contracts.d.ts)区分HTTP与内部事实。

沿W Cookie、Origin／CSRF、JSON／32KiB，`Idempotency-Key`精确匹配UUID，`If-Match`精确匹配捕获Ticket版本；query及额外body字段拒绝。状态必须属于上述三类且当前owner非空。当前handler还须具备现有活动人员／角色／组的业务操作许可；只可见的同事没有此写权，调度／管理员同样不能在未开始或终态使用本动作。继承T08的顺序责任段围栏，用当前canonical event_ordinal、真实开始／等待／恢复或进行中交接事实证明当前段已开始；过去已结束段的开始不冒充当前段，未知／截断未得到合法依据时fail-closed。同人调整不伪造新段。当前责任、权限、对象关系在行锁后再次核验；不能用当前status、时间或投影独自替代完整业务围栏。

复用原ledger和caller-Tx Core／Control，保持receipt→shared realtime fence→Ticket→UUID排序Session锁序和锁后权限。清owner、保组、保current cycle及first basis，version+1，追加独立`ticket.returned_to_dispatch`和同轮event link；其[私有事实Schema](../../../contracts/p2_016_return_to_dispatch_event.schema.json)记录真实old owner→JSON null／同组／操作者／两块内部内容。默认retain不调用沟通release；显式选取独立校验当前Session READ、同源／主题、Control TRANSFER与target，不借Ticket调度权扩充沟通权限。不猜最新会话、不造Session、不写第二套owner。Ticket、选定Session／Control／generation、event／cycle link／安全实时投影与COMMITTED全部同事务，失败只留原FAILED审计。

原首真实 RED 后的最小 048 及独立迁移器保留原文件与 checksum；当前 c638 原组装经正式入口实际组合 039/040/041/046/048，并验证 FIRST 不重复。049-first 的兼容使用前向 057，实际路径及标记见下节。既有046只允许未开始`ticket.unassigned`释放，048扩充独立returned词汇和严格同组旧owner→null、三类old状态→QUEUED及内部记录约束，无新表／owner／started列，依赖031／039／046。旧迁移字节保留。同轮再承接在 c638 原竞争例及实际 041 round worker 组装均已验证，原 FIRST 身份和四表计数保持；历史 69ae 仍保其原对象。Core仍是唯一工单／状态／责任／事件事实源。

同UUID原hash终态只一次；重放先重查当前Ticket及原所选Session读权，改payload409。ACK仅当前Ticket READ和原actor／resource／专用purpose的最小UNKNOWN／FAILED／COMMITTED；UNKNOWN不能推断未提交，不返回原命令或内部材料。错误分类沿 P2_016：输入400、身份401、动作／Control／target403、不可见／错误关联404、版本／状态／hash／段围栏409、关闭／Schema不齐／事务失败503；实际原请求与结果见逐票证据，不把静态分类视为每项都已运行。

当前 PC 草稿使用 purpose=`ticket-return-to-dispatch`，沿T03同账号／Ticket／当前浏览器AES-GCM、24h／20份／16KiB与T38 epoch、abort、generation及storage CAS。双必填独立字段、Ticket版本和明确沟通选择共同保存；原UUID／版本／八字段body在UNKNOWN后冻结，只显式GET安全ACK，不自动换UUID／版本或POST。成功／丢弃／退出／可信失权清本用途，临时失败保留未核验密文，敏感到期只留opaque标识；迟到结果不得改新输入。恢复前重验Ticket与明确Session授权，最多10页关联查询；超过界限或目标列表未能证明旧选择时保留密文并阻止恢复／新提交。关raw后不解密或新建空恢复库；已有原操作必须只读核对，不能以新的UUID提交。实际POST成功先记COMMITTED，后续GET或本地清理暂时失败不改成终态拒绝。c638 原 PC 完整八阶段实际验证输入恢复、原 UNKNOWN UUID／body／version、显式 GET-only ACK 和消费者事实重读；独立后继两个原业务场景验证显式双 Session 原子成功及真实版本变更后的零部分事实。第二 Session 原生写后失败的全事务回滚另以隔离 PG 实测，不由截图外推。

`ticketReturnToDispatchEnabled=false`仍为独立默认关闭源码option，不偷开T05／T06／T08。关闭T09停止POST及动作能力，安全ACK仍以整个W读启用、当前认证／TicketREAD及原actor／Ticket／专用purpose／UUID读取原031 ledger；不查048、不检查当前写状态／版本／target。PC保持安全ACK消费者可挂载，关闭写能力或raw恢复不允许创建新操作；整个W关闭／身份失效／失权仍拒绝。literal T09=false、raw=false 和安全 ACK 当前授权边界已在 c638 实测，省略生产 option 的缺省关闭亦有独立真实 HTTP 证据。退回不创建轮次、不改首责任basis、不取消／关闭，不创建退回Message／Outbox／Delivery；同轮后续承接不应重复已有首次责任承诺，下一重开轮次仍独立。单App／Worker、Gateway单活、SSE32、pool max4／总预算8、选Session≤8、target每页≤100、关联恢复≤10页、单表单in-flight1保持，无新SSE／轮询／worker。原bd412编译FAIL、aab2／b618／0a0ffcb真实HTTP RED、9eab／cca730／1528各原首GREEN及55c PC FORM_PRESENT RED独立保全；当前 c638 的严格制品及 23 项业务／风险验证已完成；本票本地七项收口，父管理 Root／来源导航／GitHub 集成。文档后继保留 c638 真实被测祖先，不把制品身份重绑到文档提交。

### 2026-10-12 审查后前向接缝修补与当前验证

正式 TicketDetail 的闭合 Schema 和 TypeScript `allowed_actions` 同时加入 `return-to-dispatch`。关联会话 GET 的原宿主围栏追加独立 T09；当前 Ticket READ、canonical 关系、分页和逐 Session／target 权限保持，不要求打开 T05／T06／T07／T08。

旧 048／049 SQL 字节和旧 checksum 保留。原迁移入口在没有 049 时仍实际应用 048；已集成 049 时选择前向 057，保留当前完整 event check，再追加退回及已集成跟进词汇。metadata check 保留所有非退回规则，退回严格沿原 048 的同组旧 owner→null、三种已开始状态、内部说明及零外发约束，无新事实表。入口复用原 049 DDL 锁，在锁后选择实际路径；057 只记自己的 checksum／stamp，未执行 048 就不生成 048 stamp。T09 启用且存在 049 时，readiness 和写命令要求真实 057；关闭 T09 后的安全 ACK 仍只按当前 Ticket READ 和原 actor／purpose／UUID 读取原回执，不依赖 048／057。

三项缺口在冻结 `f2bcd11d5476306767db3f112eb5b60ce55e5058` 上实际产生五条 RED：合法 GET 被详情 enum 拒绝；仅 T09 的 related GET 503；049 既有事件时旧 048 原生 23514；049 空历史及联合能力下后续真实跟进写 503。当前 c638 五项后继全部 PASS：049 既有事件及空历史路径、后续实际 SET／CANCEL 和 T09 联合动作通过，真实 057 stamp／checksum／NOOP 保持；原 048 未执行时没有其 stamp。缺 048／057 标记 fail-closed 及关闭写能力的安全 ACK 已实测。原五 RED、011 必填 CANCEL 输入失败、原九例字节与原 selected UI 两 FAIL／NOT_REACHED 均保留，后继未重标原例。完整七项和自有清理见[本票执行记录](../../../plans/admin-workbench-integration/execution/t09.md)。

## Bot 原报修人轮次通知读取（WBINT-T24）

本票已完成本地隔离验收；能力默认关闭，未部署或现场外发。沿用获权 `GET /api/tickets/{ticketId}/deliveries`，宿主 W、当前 Ticket READ、原认证与失败规则不变，没有新增通知读取路径。最多100条，不作为全历史分页。新节点通知沿原 Bot 单聊报修人绑定生成，041 只增加轮次／节点与既有通知的绑定，不建立第二套 Ticket 或 Delivery。

`ticketRoundNotificationsEnabled=false` 继续默认关闭；已认证 `/api/lifecycle/bootstrap` 的 `ticket_round_notifications_enabled` 反映宿主能力，客户端缺字段按 false。启用时沿既有安全 DTO 显示首次责任／工作人员完工、轮次、PERSON 路由、实际 Delivery 状态、尝试次数、`side_effect_state` 和 `sent_at`。轮次两字段成对可空；客户端拒绝未知字段、重复 Delivery 身份、不合法枚举、版本或时间，不读取原始目标、Bot／Reporter、binding 或内部内容。

正式 Ticket 详情的“报修人通知送达”区域挂载时读取一次，提供“重新读取通知”的显式 GET。切换／卸载取消本次读取，generation 与当前授权 epoch 屏蔽迟到结果；可信失权清理视图。此区域不提交通知、重试或人工核对命令；既有 retry／reconcile HTTP 权限及独立外发开关保持。关闭能力停止新节点扫描与该区域展示，既有 Ticket／Outbox／Delivery／审计保留。

验证分属真实对象：824f 正式 production bundle 浏览器验证 PENDING、SENT、DEAD_LETTER、RECONCILIATION_REQUIRED 与读取／隐私边界；发送结果来自隔离合成 Sender，不代表现场送达。18d 一次 build／strict／artifact 为 0/0/0，原 Schema／Contract／资源检查各 1 PASS。早期缺区域 UI RED、严格类型失败、两次 Schema 失败与工具超时均保留在[逐项执行记录](../../../plans/admin-workbench-integration/execution/t24.md)，不改写为通过，不把较早制品重绑至文档后继。

## 同一工单新轮次重开（WBINT-T20，本地整票验证完成，待父审查）

当前M/H5与独立W/PC服务、043 shared-round、当前获权提示、安全原UUID GET和独立raw恢复已完成原七项本地隔离验证；最终0f9af956一套build/strict/artifact原生0、直接消费者10PASS、原hosts外层27PASS。原HTTP/合同/并发/两端真实bundle证据各保tested源，不重绑更早PASS；全部原FAIL/setup/observer/NOT_REACHED与当前原始索引见[逐票执行记录](../../../plans/admin-workbench-integration/execution/t20.md)。待父独立验收/集成；下面带b41/b176/15306/9395身份的NOT_RUN和remaining保留其历史阶段，当前行为以上文与本节合同为准。默认关闭/不外发/不部署/不推进Gate保持。

`ticket_reopen_rounds_enabled` 是 W 宿主 `ticketReopenRoundsEnabled` 的独立能力投影，默认 false；显式启用须先具备 043 schema 与当前 W 权限。正式 PC 仅在该能力和当前 command context 同时允许 `reopen` 时显示原因表单，使用原 W `POST /api/tickets/{ticketId}/reopen`、当前 CSRF、原 UUID 和 `expected_version`；这不授予 Reporter 自助写权。新 shared round 清当前处理人、保处理组，之后必须显式重新承接；Conversation 责任独立。

关闭该选项隐藏新 PC 写消费并停用新 shared-round 服务路径，保留既有 legacy 生命周期行为和追加历史，不回改 043 或旧 SQL。`GET /api/tickets/{ticketId}/reopen/commands/{commandId}` 是原 STAFF_REOPEN 用途的只读核对：整 W 读入口仍启用且当前 principal 具有 Ticket READ 即可，独立于新写能力和 raw 恢复选项。它绑定原 actor/principal scope、Ticket、UUID 和 `reopen`，仅查 ledger 安全标量与不可变 shared-round basis，不读取原因、hash 或私有结果快照；其他 actor/用途或未取得终态返回 UNKNOWN，当前对象失权仍拒绝。闭合 [结果](../../../contracts/p2_016_reopen_result.schema.json) 和 [回执](../../../contracts/p2_016_reopen_receipt.schema.json) 不授予新操作权限。

PC UNKNOWN 保留原 UUID，显式只 GET 该回执及当前获权 Ticket，不自动 POST、ACK 或换 ID。新源码复用 T03 AES-GCM/non-extractable key、first-save 24h、CAS/20份/16KiB journal，purpose 为 `staff-reopen`；W bootstrap 的 `ticket_reopen_draft_recovery_enabled` 是原 raw 选项与新写能力同时启用的投影，不改变默认关闭。恢复先重新验证当前 READ；新写能力或原动作消失时清敏感原因/原写 payload，只恢复 opaque UUID 给用户点击 GET。raw 关闭不创建新数据库/恢复副本，已存在的原操作仍可在当前 READ 下只读核对。

M 的独立 `reporterFeedbackDraftRecoveryEnabled=false` 投影 `feedback_draft_recovery_enabled`；新源码从本次编译 manifest 的受限 JS entry/import 图加载同一个 T03 store，Web scope 使用当前 `recovery_scope` 摘要、request ref 与 `reporter-feedback` purpose，不借 W principal/Ticket ID。原字段全部密文保存，Cookie/CSRF 不进入副本；24h 到期/丢弃或原写能力失效不把 UNKNOWN 改成失败，原 UUID 仍只能按 FEEDBACK purpose GET。COMMITTED 闭合结果与当前获权同 Ticket 事实核实、恢复清理确认后才显示已核对；cleanup 未确认阻止新反馈，退出独立清理本成员反馈范围。该源码后继尚 NOT_RUN，save/reload GREEN、实际 24h/current READ/损坏/跨标签/关闭边界与适用兼容仍需本票逐段实证，不由旧 GREEN 或 T03 原证明推定交付。本人 Web 反馈的独立默认关闭能力见[反馈合同](../member/web-feedback-design.md)。

真正 043 新轮次未承接前，legacy `start` 拒绝绕过首次责任依据；T04 的显式承接路径保持。当前获权 W TicketDetail 可追加闭合 `reopen_follow_up:{origin,is_previous_handler,awaiting_acceptance:true}`，只由当前未承接 shared basis 和 040 上轮完工人派生；获权团队看到普通待承接事实，旧处理人失权仍拒绝，M 不包含此字段。该字段不派工、不存新跟进或 owner。以上 b41 实际差额的前向源码待新固定候选验证，整票仍 IN_PROGRESS。

b176原11实际9PASS/2FAIL保留原运行身份。专用ACK/两端UNKNOWN原GET核对、newround START阻断及两来源安全字段已到达；两FAIL在停用账号现行401与原403预期的差异，不能调整产品授权边界。后继来源校准精确401/闭合无正文认证拒绝，并准备关闭新write/raw仍当前READ的ACK、同浏览器raw reload和正式上轮HANDLER提示首组，全部NOT_RUN。保护恢复需独立原scope/Ticket/purpose、当前READ、首次保存24h不续期及有界非导出AES-GCM；raw过期或敏感内容不能恢复不等于原命令未提交，原opaque UUID只供安全GET核对。PC提示的实际消费和完整raw/currentauth尚未由现有9PASS证明，默认关闭和整票IN_PROGRESS保持。

15306原四实际2PASS/2FAIL保留原身份：两端生产页面同浏览器reload后恢复原opaque UUID并由用户GET核对已通过；WRITE/raw关闭时当前READ专用ACK已到达，后续START广告不一致与fresh REOPENED后的literal PC提示缺失是实际RED。前向源码对真实043未指派未承接轮次独立于新write选项过滤start，保持无043 basis legacy；PC仅消费当前获权GET的闭合reopen_follow_up，在正在读取或错误时隐藏提示。提示不授予重开/承接权限、不通知外部、不重新分派。该后继尚NOT_RUN，当前原七仍IN_PROGRESS。

raw关闭后允许已有UNKNOWN opaque操作在当前READ下显式GET，不允许该旧操作已被终态核对清理后为新输入创建敏感恢复副本；业务写权限与是否保存恢复副本独立。原POST已得到200而随后context GET暂时失败，也不得将已提交命令显示为已知拒绝或丢弃唯一UUID；保留UNKNOWN只读核对与新命令栅栏，待原receipt/当前事实和必要清理确认。两项生命周期边界已登记真实公开首测、尚NOT_RUN，不能把未运行源码审查当完成证据。

9395原四实际2PASS/2FAIL已保全：START关闭广告与获权STAFF正式提示PASS；两生命周期首测分别实际新敏感record1≠0，以及真实原POST200/服务器GET200受控client503却误报拒绝。最小后继给现有共享hook独立writeEnabled（缺省仍沿原enabled），W旧opaque读消费不启用新敏感保存；只有原POST未成功时才按其明确拒绝清理，POST200后的临时读取失败保原UUID UNKNOWN。该源码后继尚NOT_RUN，旧15306/9395结果保持各自被测身份。

冷raw关闭且没有旧row时，不打开或写入IndexedDB，也不在local/sessionStorage持久化UUID；此时只保证挂载页面内原UUID的GET核对，不承诺刷新后24h恢复。刷新丢失内存标识不代表原命令失败，不能自动重发。raw启用的固定24h副本，以及既有opaque在关闭raw后的只读恢复，是两个独立路径；前者到期或丢弃只清敏感payload/key，不能把原未知操作变成失败或借此换UUID。

## 原H5与核实代录应用轮次通知（WBINT-T25）

原 GET deliveries 沿当前 Ticket READ，可返回 PERSON 的 route_kind=YIXIAOXIU_APP；同轮FIRST/完工、各路成功/失败/UNKNOWN均独立。正式管理端仅显示安全状态，不能从投影推断外部送达。恢复仍用原 retry/reconcile、当前权限和原UUID/hash，不增加客户端SDK或HTTP发送入口。配置、SDK、本人详情、安全字段与关闭历史读取见[应用通知合同](app-notifications.md)；[本地执行](../../../plans/admin-workbench-integration/execution/t25.md)保留逐祖先证据和未运行现场边界。

### T10 历史首片段：四动作消费合同冻结与首个菜单源码（2026-10-12）

本段替代旧未实施 SOURCE 提案中将安全 ACK 绑定 mode/raw 的假定，依据本次 Root586 连续授权和已交付恢复边界；旧记录与旧回执不改写。四条 POST 路由仍为 request-information、wait-vendor、resume、cancel，复用原 frozen 五字段 waiting command、七字段安全结果和真实 event↔cycle 合同。等待／恢复留人、组、沟通和本轮；取消仅原 ADMIN/DISPATCHER、QUEUED/ACCEPTED 与内部必填原因／独立确认，不替代撤派／退回。当前第一菜单源码只消费 request-information，其他三项仍待公开竖切。

[独立 capability 片段](../../../contracts/p2_016_waiting_capability.schema.json)冻结 ticket_waiting_actions_enabled 和 ticket_waiting_action_draft_recovery_enabled 两 boolean，缺省 false、raw 能力蕴含动作能力；只由原宿主 option 与原 recovery option 提供，不修改持久默认 Flag。每次新提交先核当前 bootstrap/Ticket Action/版本、T38 transport 与 epoch／abort／generation，再保存原命令、一次 POST。409 保留用户输入，经当前 GET 后由明确新提交产生新的 UUID；UNKNOWN 保留原 UUID/body/version，不自动再 POST。

[安全 ACK 合同](../../../contracts/p2_016_waiting_action_receipt.schema.json)为四个 GET /api/tickets/{id}/{action}/commands/{uuid} 的最小 UNKNOWN／FAILED／COMMITTED。该原 actor／Ticket／服务器 route-action purpose／UUID 只读核对仅要求当前 W 认证与 Ticket READ，与新写和 raw 恢复分开；不返回 note、原 command 或 private snapshot。四用途为 waiting-requester、waiting-vendor、waiting-resume、waiting-cancel，沿 T03 当前浏览器密文、24h／20份／16KiB及 storage CAS。ACK 宿主及其负向验证在首菜单片段尚未实现，不能把合同冻结视为已有 HTTP。

无新 SQL、表、Core、owner、ledger、SSE、轮询或通知权限。关闭动作 option 禁止新菜单提交，保留既有事实；安全 ACK 的原操作消费者在后续实现保持挂载。原 first/fixture/browser 与三 frozen Schema 不改。当前源码未经本对象运行；原 d563 首 HTTP GREEN 与原 browser 菜单 RED 仍分别绑定 d563，不作为整七验收。

### T10 当前四动作本地交付（2026-10-13）

四动作均已在正式工单菜单实现，沿原 HTTP 与 frozen command/result/event-page Schema。等待报修人和厂商只从 IN_PROGRESS 进入 WAITING_REQUESTER/WAITING_VENDOR，恢复只从两种等待态回到 IN_PROGRESS；当前有效 ADMIN/DISPATCHER 或原处理人且仍属于有效处理组才可执行。独立取消仅 ADMIN/DISPATCHER、QUEUED/ACCEPTED，要求内部原因与一次独立人工复选确认；它不替代撤派、停止处理或退回。等待与恢复保留当前人、组、沟通、轮次及首次责任；取消也保留已有轮次，原 nullable cycle 仍为 null，不新开历史。

五字段 POST 仍为 client_command_id、expected_version、reason_code、note、external_visible:false；每次执行 Origin、CSRF、Idempotency-Key、If-Match、当前身份／Ticket授权与合法状态。数字版本范围1..2147483647，原因按UTF-16最长2000且trim后非空，前端只trim一次，服务端不改原raw body或hash。同UUID重放仍重查当前READ，锁等待后重查当前角色／处理组权限；单一ledger事务内状态、event、现存event↔cycle关系和相关投影全部成功或全部回滚。无新数据库迁移、表、Core、owner、ledger或通知规则，内部原因不进入外部Delivery；原宿主通知策略和发送关闭保持。

四个独立 purpose 控制器使用原T03密文与storage CAS：waiting-requester、waiting-vendor、waiting-resume、waiting-cancel。新动作消失时继续挂载原操作，只保原UUID／正文／版本，用户明确点四条专用GET才核对，不自动POST、ACK或换UUID。409保输入，当前获权事实重读后由明确新提交生成新UUID。首次保存24h不续期、不可导出AES-GCM key、20份／16KiB限值保持；过期／只关闭WRITE或raw只清敏感payload/key，原opaque在当前READ下仍供GET。冷raw关闭不打开或写IDB，只保证当前页面内核对，不承诺刷新恢复。真实Ticket404、身份失权和退出清理各自受限范围；迟到POST、ACK和解密结果不能恢复旧内容。

ticketWaitingActionsEnabled默认false，两bootstrap capability也缺省false，raw须同时有原recovery与新写能力。关闭新写禁止新菜单提交，保留已提交Ticket／event／责任及原操作的当前READ核对；不删除历史或扩大通知权限。复用现有App/API/SSE与池，不增加后台服务、SSE连接或轮询；单App/Worker、Gateway单活、SSE32／原池预算保持。

本地未发布对象69d5619ee31cd69aa8b6378a16bfaf0eeb92f6bc完成当前一次build／strict含负向类型／artifact 0/0/0、22文件41PASS（T10 28＋相关13）、13 accepted PNG；三适用工具风险组真实20PASS/native0，外部wrapper误读嵌套失败计数的原FAIL和外层解释分别保留。自有PG stop0/status3/pidnull/62775拒绝连接、data/config保留，extraDB／client／probe池0。原3 tracer与3Schema、所有历史FAIL／NOT_REACHED／NOT_RUN和5d逐原SHA恢复边界保持。完整逐项证据与两轴固定SOURCE收口见[本票执行记录](../../../plans/admin-workbench-integration/execution/t10.md)及外部D最终handoff；该纯记录后继不重绑tested_head。父独立整票验收、Root聚合／安全FF／原生Issue收口由父完成，不改变真实外部服务／发送、部署、full/certify或Gate停止线。

## WBINT-T13 当前安全责任链（本地验证，2026-10-13）

当前独立只读 GET /api/tickets/{ticketId}/assignment-history 已由原 W/P2-016 宿主挂载，并在正式 Detail 显示；[本票 WBINT-03/A03 执行记录](../../../plans/admin-workbench-integration/execution/t13.md)保留原 SOURCE 与当前证据。宿主 option workbenchAssignmentHistoryEnabled=false、bootstrap assignment_history_enabled 缺省false；关闭历史入口保留全部 Ticket/Event/cycle/Control 事实及其他获权入口。无数据库变更、第二 Core/历史表/ledger、写命令、池、poller 或通知授权变化。

GET无body，只接受各一次cursor/limit（重复或额外参数400）；limit默认20、正整数最大100，cursor最多2048字符。每页重新认证并核当前Ticket READ，既有039 ready未成立时503；不能借cursor或Ticket写许可获取读取权。event_ordinal/event_id稳定升序keyset，以n+1判定next_cursor，不用OFFSET、total或hidden_count；cursor绑定Ticket、主体、角色/组授权范围及查询版本。

[原Page Schema](../../../contracts/p2_016_assignment_history_page.schema.json)/[类型](../../../contracts/p2_016_assignment_history_contracts.d.ts)保持冻结闭合字段schema_version/ticket_id/initial_basis/items/next_cursor，每页最多100行、每行当前可读沟通最多8项、显示名最长128字符。KNOWN安全当前名字、NONE有事实证明无人/无组、UNKNOWN缺记录三态保持；安全名字不承诺旧历史拼写。缺首任、前序、metadata或有界完整前缀证明不拿当前负责人填补；空页items=[]/next_cursor=null，initial_basis不足为UNKNOWN。转派/等待/退回及同轮再次接单不新开轮次，结束/合法重开保留旧记录。

既有Ticket event/cycle、真实assignment_metadata、021 Control和已COMMITTED复合引用是唯一来源。T06首次由调度员指派他人按真实target/team证明，后来同轮accept用该次receipt及同轮前序，不借首任组；T07/T12仅实际transfer关联沟通，不误绑最终start/close。每条历史Session先核真实Ticket关系及当前独立VIEW/保留边界再LIMIT8；隐藏对象不返回ID、名称、计数或存在标志。communication=[]只表示当前获权范围无可返回实际交接，RETAIN/no-op或独立沟通不会按时间伪造关联；不返raw principal identity、内部原因、原命令/hash/private receipt。

正式视图按20条请求、maxPages10/gcTime0限界，显示已加载范围、缺证/空白/失败、后续页及显式重读；沿原epoch/abort、clearItemView和Realtime失效，不自动POST/ACK或创建草稿。实际生产浏览器测得DOM峰值200/末次185/重读20；cache内容未实测，200缓存上限为SOURCE配置。真实合成Cookie生产logout后释放旧server200，DOM未恢复且当前读401；旧body送达/解析未观测。固定本地未发布c6ec52f312dbf9d05f872039587fa31e22b02252完成040一次build/strict/artifact及042五文件17PASS、4accepted PNG；相关五文件71PASS经043/043b两个窗口，原超时FAIL不改，044工具外层27PASS。两轴SOURCE0产品修补、046精确自有PG清理通过；本段纯文档后继不重绑测试SHA，不表示Root集成、GH关票、生产/临床上线或Gate批准。

以下为原 SOURCE 候选历史原文，按当时状态保留。

## WBINT-T13 安全责任链候选（SOURCE / PROPOSED_NOT_MOUNTED）

候选 `GET /api/tickets/{ticketId}/assignment-history` 和 additive read Query interface 已在 [T13 SOURCE 合同](../../../plans/admin-workbench-integration/execution/t13.md)冻结；本节不表示该路径、生产查询或正式视图已挂载。独立 [闭合 Page Schema](../../../contracts/p2_016_assignment_history_page.schema.json) / [类型](../../../contracts/p2_016_assignment_history_contracts.d.ts) 保持原 P2-016/Incident 合同及 SQL。

候选仅当前 Ticket READ，逐 Session 独立 VIEW 在 LIMIT 前裁剪；default20/max100、稳定 event ordinal cursor、名称/前任/轮次明确 KNOWN/NONE/UNKNOWN，缺初始事实不得用当前负责人回填。真实 Ticket/cycle/Control 及原 composite references 提供事实，返回安全显示而非 private receipt dump。原首例源码已登记，全部 runtime NOT_RUN，原七项 PENDING。候选配置 `workbenchAssignmentHistoryEnabled=false` 尚未装配；无数据库变更、无新事实表/权限，详见 own SOURCE 合同。



## 2026-10-14 T29 Incident 负责人交接（本地验证，默认关闭）

来源WBINT-10/A10，当前实现/历史证据详见[执行记录](../../../plans/admin-workbench-integration/execution/t29.md)和[合同及事务设计](incident-owner-transfer-design.md)。功能实际被测28230562/tree66a5/MF14719c9d；030本票13PASS和031相关16PASS各保存自己的范围，纯文档后继不重绑被测身份。父验收/Root/GH集成待处理，不称full、业务Gate或生产启用。

| 操作 | 显式宿主选项与合同 |
| --- | --- |
| `GET /api/incidents/{incidentId}/owner-transfer-targets` | `incidentOwnerTransferEnabled:true`且当前用途已授权；闭合`{items,next_cursor}`，每人`{id,display_name,teams,teams_truncated}`。有效worker且已经拥有精确Incident READ先过滤后分页；limit默认30/max100，每人20有效组、名称200、cursor2048，页面最多保留三页，不返回隐形人计数。 |
| `POST /api/incidents/{incidentId}/transfer-owner` | 必填闭合五字段`client_command_id/reason_code/expected_row_version/owner_principal_id/owner_team_id`；team是合法原code或明确null，真实`NONE`是字符串。UUID、原八种reason、string BIGINT版本及Idempotency-Key/精确quoted If-Match、Origin/CSRF/32KiB沿原HTTP fence。成功只返回原六字段Incident ACK。 |
| `GET /api/incidents/{incidentId}/commands/{commandId}` | 原单ledger新增TRANSFER_OWNER用途白名单；先按当前caller原交接用途授权，再观察原结果。旧COMMITTED只观察原ACK，不因target后失效反转、不给新意图扩权；UNKNOWN沿原UUID/body，manual GET后才可显式重放，不自动POST或换版本。 |

当前caller须ADMIN/DISPATCHER及精确Incident原范围，owner/HANDLER身份不授交接权。原receipt等待后锁稳并重查current active/roles/用途；父版本、target active/role/team membership/exactREAD在同事务重验。非CLOSED仅改原Incident owner字段、版本+1、追加一次HUMAN`incident.owner.transferred`及原ACK，不写个人Ticket/Conversation责任、不产生SSE责任内容或任何外发意图。

内部责任历史只向授权broad事件读面提供actor及previous/next principal/team与原原因/平台秒精度时间，不直返safe_payload，不向HANDLER/Reporter/通知泄漏。正式表单显式选择和一次button POST后fresh GET；不乐观伪成功。known T29 purpose403/404局部清理scope/cache，Session和合法一般Incident READ保留；真实bootstrap401/403或身份会话边界才清Session。迟到结果受generation/cancel约束，不复活清除输入。

054 typed迁移复用原表/ledger，完整17command/20event目录保留055内部处置及058公开进展的shape/列/FK/索引、原SQLchecksum与marker。合法组合仅由完整054 catalog证明，不接受子集或假058 stamp；默认OFF/缺054旧宿主保持可用，新purpose failclosed。冻结四Schema+一DTS、两个first、旧SQL/合同/Evidence不改。关闭新选项保留历史，无破坏性down。全部默认false；资源单App/既有Worker、零新增Gateway/SSE32、池总建议≤8、concurrency1；外部真实服务/send、部署、full/certify/Gate未运行。
