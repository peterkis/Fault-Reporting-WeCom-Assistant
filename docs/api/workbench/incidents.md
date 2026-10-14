# 公共故障候选、关联与订阅

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 W，P2-012 扩展。调用方 [Incident UI](../../../web/p2-workbench/incidents.js)。`INCIDENT_CORRELATION_ENABLED` 默认 false；对外通知另有发送开关与授权。实现：[HTTP](../../../src/p2-012-workbench-http.mts)、[query](../../../src/p2-012-incident-query.mts)、[commands](../../../src/p2-012-incident-command-service.mts)、[domain guards](../../../src/p2-012-domain-contracts.mts)。Incident 是公共故障聚合，不能替代或删除个人 Intake/Ticket。

## 读取

| METHOD + PATH | Query | 200 响应 / 权限 |
| --- | --- | --- |
| `GET /api/incident-candidates` | state?、cursor?、limit 默认30/最大100 | `{items:[CandidateReview],next_cursor}`，范围授权 |
| `GET /api/incident-candidates/{candidateId}` | 无必需 query | CandidateDetail；ETag=`"<row_version>"` |
| `GET /api/incident-candidates/{candidateId}/commands/{commandId}` | 不接受 query | 当前 principal/candidate 的只读安全回执；额外要求宿主 `incidentCandidateWorkspaceEnabled=true`，默认关闭 |
| `GET /api/incidents` | state?、cursor?、limit 默认30/最大100 | `{items:[IncidentPublicView],next_cursor}` |
| `GET /api/incidents/{incidentId}` | 无必需 query | IncidentDetail；ETag；按角色裁剪 |
| `GET /api/incidents/{incidentId}/commands/{commandId}` | 不接受 query | T28 原 Incident 操作只读回执；宿主 `incidentCandidateWorkspaceEnabled=true`（默认关闭），当前原动作用途授权 |
| `GET /api/incidents/{incidentId}/events` | cursor?、limit 默认30/最大200 | `{items,next_cursor}`；窄权限仅公开事件类型 |
| `GET /api/incidents/{incidentId}/reports` | cursor?、limit 默认30/最大100 | `{items,next_cursor}`；按可见工单过滤 |
| `GET /api/incidents/{incidentId}/linkable-reports` | 同上 | ADMIN/DISPATCHER |
| `GET /api/incidents/{incidentId}/subscriptions` | 同上 | ADMIN/DISPATCHER |
| `GET /api/incidents/{incidentId}/notifications` | 同上 | ADMIN/DISPATCHER |
| `GET /api/incidents/{incidentId}/direct-destinations` | 同上 | ADMIN |
| `GET /api/incidents/{incidentId}/subscriptions/{subscriptionId}/direct-destinations` | 同上 | ADMIN；只返回该 subscription 候选 |

state 候选：`CANDIDATE|UNDER_REVIEW|CONFIRMED|REJECTED|EXPIRED`；Incident：`CONFIRMED_LOCAL|CONFIRMED_BUILDING|CONFIRMED_CAMPUS|CONFIRMED_HOSPITAL_WIDE|INVESTIGATING|RESOLVED|CLOSED`；Incident 聚合过滤 `ACTIVE|FINISHED`。游标绑定 kind/state 或 incident/part。ETag 是版本提示，这些内部 detail 不支持 If-None-Match/304。

Candidate 基础字段详见 [candidate schema](../../../contracts/p2_012_candidate_review.schema.json)；Detail 增加 `source_decision,manual_review,report_sources[],eligible_owners[],roles[]`。source_decision 是 code/版本/hash/安全 refs，非原始消息。IncidentPublicView 为 `id,incident_no,status,confirmed_scope,service_family,symptom_family,severity,safe_title,row_version,confirmed_at,investigating_at,resolved_at,closed_at,created_at,updated_at`。Detail 对广域角色再含 `owner_principal_id,owner_team_id,primary_ticket_id,owner_display_name,primary_ticket_no`，所有角色含 roles。

候选详情还返回当前 `allowed_actions,allowed_scopes,material_basis,materials[]`，以及 `visible_report_source_count,report_sources_truncated,eligible_owners_truncated`。Report 选项最多100、owner最多100、各 owner 有效组最多20并分别标记裁剪；获权来源总数由完整冻结 refs 的范围查询计数，不以返回页面长度代替。owner 和组取当前有效内部事实，确认事务再次锁定并校验。HANDLER 无决定动作/范围/owner，材料依据为 null，全局来源人数/科室/位置、窗口、内部事实 refs 与确认结果 ID 按权限裁剪。来源观察与确认后关联数量有不同语义。

`materials` 最多101项（独立根 Decision 加最多100个 Report 引用），不扩大报修选择或来源选项上限。它保留原 Decision 的 revision/hash，并比较同 Intake 的实际 BOT 消息窗口或 WEB revision/保留 submissions；不使用整个 Journey 的无关 revision。材料变化或过期禁止确认，原 Decision/hash 保持不可变。WEB 当前 hash 仅在原 <=50 窗口及材料仍保留时提供；旧032 BOT profile 不访问033 Web表。当前 extent 沿既有权限：ADMIN全部，DISPATCHER默认LOCAL/BUILDING，只有独立显式政策才允许CAMPUS；不增加角色。

Web 安全来源引用为真实生产者供应的 `web:<web_submission UUID>`，不是 request_ref、Intake 或 Reporter 标识。Query 只在原根为 WEB 且材料仍保留时，按当前根读取权限、同 Intake/binding/Journey、原捕获窗口和实际 submission 保留期限核对原供应引用；不会猜测或补造来源。原 decimal channel/intake 投影、Decision/hash/material basis 保持，BOT/032 profile 不执行这项 Web SQL。

只读回执的当前候选读取及 ADMIN/DISPATCHER 决定用途权限先于 ledger 查询。查询限定 `P2_012:<current principal>`、actor、候选 ID 和开始/拒绝/确认三种动作；无记录或未终态返回 `UNKNOWN`，稳定失败返回 `FAILED` 及白名单 `error:{code,retryable:false}`，已提交返回 `COMMITTED` 及六字段 `result`（`replayed:true`）。共同字段为 `candidate_review_id,client_command_id,state`，各状态均封闭，见 [receipt schema](../../../contracts/p2_012_candidate_command_receipt.schema.json)。已提交 Incident 再独立核对当前 resource 读取权限，不返回命令正文、hash、身份材料或由表单推测的 owner。候选/草稿过期不证明原操作失败；获权的原 UUID 可继续只读核对，不能据此自动创建新意图。回执关闭不改变已有事实或旧 Incident API。

子查询主要字段：

| part | items 中的投影 |
| --- | --- |
| events | id,event_type,event_ordinal,old_status,new_status,old_scope,new_scope,occurred_at |
| reports | id,ticket_id,ticket_no,service_intake_id,link_state,impact_state,row_version,linked_at,unlinked_at,recovered_at |
| linkable-reports | source_decision_id,id,ticket_no |
| subscriptions | id,representative_report_id,status,impact_state,row_version,last_notified_incident_version,created_at,updated_at |
| notifications | id,audience_type,template_code,delivery_id,status,side_effect_state,attempt_count,created_at |
| direct-destinations | id（channel leg）、subscription_id、source_intake_no |

## 人工命令

共同 body：`client_command_id:UUID,reason_code,expected_row_version:string`。确认候选改用 `expected_candidate_version:string`。Header 幂等、CSRF/Origin，If-Match **精确**为 `"<expected_candidate_version ?? expected_row_version>"`，此模块不接受 W/ 前缀或裸版本。

Cookie 会话续期后，命令须使用同一 principal 当前授权核对返回的 CSRF；授权更新不改变原用户意图的 UUID、正文或捕获版本。服务端继续按实际 Cookie 验证 CSRF。正式候选表单复用同一主体当前 bootstrap 的 CSRF；原 captured UUID、正文及版本不变。对应真实续期 HTTP/production bundle 单例与当前隔离验证见 [T27执行记录](../../../plans/admin-workbench-integration/execution/t27.md)。

| METHOD + PATH | 额外必需字段 / 可选字段 |
| --- | --- |
| `POST /api/incident-candidates/{candidateId}/start-review` | 无 |
| `POST /api/incident-candidates/{candidateId}/reject` | 无 |
| `POST /api/incident-candidates/{candidateId}/confirm` | expected_candidate_version、confirmed_scope、owner_principal_id、selected_report_refs[]；expected_material_basis?、owner_team_id?、primary_ticket_id? |
| `POST /api/incidents/{incidentId}/start-investigating` | 无 |
| `POST /api/incidents/{incidentId}/correct-scope` | confirmed_scope |
| `POST /api/incidents/{incidentId}/primary-ticket` | primary_ticket_id:UUID或null |
| `POST /api/incidents/{incidentId}/reports/link` | source_decision_id:UUID |
| `POST /api/incidents/{incidentId}/reports/{reportId}/unlink` | expected_report_version:string |
| `POST /api/incidents/{incidentId}/reports/{reportId}/mark-recovered` | expected_report_version:string |
| `POST /api/incidents/{incidentId}/subscriptions/{subscriptionId}/pause` | expected_subscription_version:string |
| `POST /api/incidents/{incidentId}/subscriptions/{subscriptionId}/resume` | expected_subscription_version:string；direct_channel_leg_id?:UUID或null |
| `POST /api/incidents/{incidentId}/resolve` | 无 |
| `POST /api/incidents/{incidentId}/close` | 无 |

ID 从路径注入命令，不允许 body 覆盖 `action,incident_id,candidate_review_id,incident_report_id,subscription_id`。`EXPIRE_CANDIDATE` 是服务内部动作，没有 HTTP `/expire`；不存在自由 publish-update 路由。

`expected_material_basis` 如提供必须为64位小写 SHA-256，并在既有确认事务中与当前完整材料依据核对；合法但不匹配返回409 `P2_012_SOURCE_CONFLICT`。省略字段的旧 body/hash/行为保持。父版本始终是精确十进制 string（含超过2^53的版本），If-Match必须原样双引号包围；不得转为 Number、weak tag 或 bare value。当前权威确认只创建独立 Incident 和明确选择的 Reports，不合并/关闭个人 Ticket，也不代表通知已发送。

confirmed_scope=`LOCAL|BUILDING|CAMPUS|HOSPITAL_WIDE`，更广范围由 ADMIN 权限控制。reason_code=`OPERATOR_REVIEWED|CONFIRMED_SHARED_FAULT|INCORRECT_ASSOCIATION|RECOVERY_CONFIRMED|SUBSCRIPTION_REQUEST|SCOPE_CORRECTION|MAINTENANCE_EXPIRED|WORKBENCH_CONFIRMED`。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_row_version":"3","reason_code":"RECOVERY_CONFIRMED"}
```

成功为 200：`{ok:true,result_ref_type,result_ref_id,result_row_version,result_event_id,replayed}`。失败为 `{ok:false,error:{code,retryable:false},replayed}`，状态由 domain mapper 决定；常见 `P2_012_VERSION_CONFLICT/COMMAND_CONFLICT/FORBIDDEN/NOT_FOUND/SOURCE_NOT_FOUND` 及状态/关联/订阅错误。具体动作字段、枚举、长度及条件必需见 [IncidentCommand schema](../../../contracts/p2_012_incident_command.schema.json)，不要用一份宽松 body 模板发送所有动作。

合成Incident命令成功响应：

```json
{"ok":true,"result_ref_type":"INCIDENT","result_ref_id":"11111111-1111-4111-8111-111111111111","result_row_version":"4","result_event_id":"33333333-3333-4333-8333-333333333333","replayed":false}
```

核对测试：[workbench integration](../../../tests/p2-012-workbench.integration.test.mjs)、[process assembly](../../../tests/p2-012-process-assembly.integration.test.mjs)、[subscription HTTP/browser](../../../tests/p2-g2-subscription-http-browser.integration.test.mjs)。[长期背景](../../62_p2_012_human_confirmed_incident_lifecycle.md)。本轮未启用 Incident 或外发。


## 正式候选工作区与恢复（WBINT-T27）

正式页面为 `/workbench/app/incidents/candidates`、`/workbench/app/incidents/candidates/{UUID}` 和 `/workbench/app/incidents/{UUID}`。新页面只接受规范 UUID；旧管理端与既有 Incident API 保留原 profile。宿主 `incidentCandidateWorkspaceEnabled` 默认 false，并依赖既有 Incident 扩展；关闭时不发候选领域读取或创建恢复库。恢复还须独立 `workbenchDraftRecoveryEnabled`，bootstrap 的 `incident_candidate_draft_recovery_enabled` 为两项能力的交集，内部备注或退出功能不是其前提。无数据库迁移或第二套 Ticket 事实源。

列表每页30、最多保留最近三页，显示的是当前加载数量。来源观察、当前获权 Report 总数、已提供选项、人工选择的 Report 数及涉及的独立个人 Ticket 数分别表达；不能把页面长度作为全量关联或影响人数。确认须明确选择当前合法范围、有效负责人及有效组或无组、逐项 Report 引用和主工单或无主工单。`owner_team_id:null` 表示无组，合法真实组编码 `NONE` 仍是字符串；非空主 Ticket 必须来自明确选择的来源。确认只创建独立 Incident/关联 Report，不合并或关闭个人 Ticket，不表示通知已发送。结果再通过当前获权 Incident GET 阅读，不能从保存的表单推测负责人或内部投影。

刷新及既有单条 SSE 的 `incident_candidate.created`、`incident_candidate.updated`、`incident.updated` 更新当前事实，不改捕获版本、材料依据、UUID、正文或已有选择。材料变化/过期、父版本失配、当前范围或 owner/team 失效必须重新核对；采用当前依据需要工作人员明确操作。未提交输入或 UNKNOWN 会阻止意外离开；明确清除消费既有跨标签页失效，不能清理失败却声称输入已清除。

恢复 scope 是当前 principal / `incident-candidate` / 候选 UUID / `incident-review`。复用既有 AES-GCM 非导出密钥、首次保存固定24小时、UTF-8 16KiB和各最多20份草稿与20个未结操作标记上限。原操作意图在 POST 前持久化。传输不确定保持 UNKNOWN；重载不自动发送或生成新 UUID，先只读核对原回执。只有仍有完整未过期正文、且只读核对仍 UNKNOWN 时，才能明确重放原 UUID、原版本与原正文。过期或显式丢弃只清除敏感正文，保留 opaque 原 UUID用于只读核对；不据此创建新意图。当前用途/对象/会话失权按既有 revoked 规则清除本地副本与操作标记；原服务端回执事实不变且读取继续按当前权限检查。

直接成功 ACK、明确稳定 FAILED，以及 COMMITTED/FAILED 回执均结算恢复记录。浏览器清理失败不能把已知结果变成 UNKNOWN；保留已知结果与原 UUID，禁止新提交，只能只读核对及重试清理。当前授权 epoch 和原请求撤销状态共同阻止迟到读取、恢复授权及错误回调恢复已清理的缓存、输入或 UNKNOWN。权限变化后仍需当前 bootstrap 和当前资源读取，旧 ADMIN 响应不能复活受保护投影。

资源复用原 App/Worker/Gateway和单条 SSE（默认32客户端），应用池预算不超过8；确认 body沿原32KiB、Report100/owner100/各组20及材料101上限。关闭新宿主能力停止入口、恢复与专用回执，已提交事实及旧 API 保留；外发开关与独立现场授权保持原边界。当前隔离 PostgreSQL、真实 loopback HTTP、production bundle 与清理证据见 [T27执行记录](../../../plans/admin-workbench-integration/execution/t27.md)，不等同于真实外部服务、发送、部署、full/certify或Gate批准。

## 公共故障跟进（WBINT-T28）

正式独立入口为 `/workbench/app/incidents/{incidentId}`。操作和原因均须明确选择，现有十个 POST 消费原 UUID、父字符串版本及所选 Report/Subscription 字符串版本，Header 为同 UUID 的 Idempotency-Key 和精确双引号 If-Match。设置主工单可明确选择无主工单。候选确认页内嵌的 Incident 结果继续只读。

角色和状态提示取当前安全 detail，Incident 没有另造 allowed_actions/allowed_scopes 或所有权。HANDLER 单人恢复须通过现有个人 Ticket GET 核对当前本人 assignee；写入事务再次锁定核验。Incident owner 不增加权限。父、子、来源和主工单归属由原 CommandPort 判断；分页缺席不证明失权，保留的原选择仍须提交时核验。公共恢复、关闭和个人恢复保持个人 Ticket 状态、事件、处理责任与沟通责任独立。

Report、历史、订阅、通知、来源和所选 subscription 的 DIRECT 渠道均从 unknown 按封闭安全字段解码，每页请求30，最多保留最近三页。各段独立游标，下一页与回到起点明确。界面显示当前页及已加载窗口项数，不能用页面长度推断关联总数或受影响人数。HANDLER 继续只读其当前获权的裁剪投影。DIRECT 候选仅来自当前所选同一 Reporter 的有效个人渠道；待配置订阅须明确选渠道，已有订阅可省略字段保留仍有效的原渠道。群聊、他人或过期渠道由原事务拒绝。同人多条 Report 复用一条订阅，PAUSED 不因关联自动恢复，最后一条解除才 ENDED，重新关联复用原 Report。

`GET /api/incidents/{incidentId}/commands/{commandId}` 已挂载，要求当前 workspace 能力。查询绑定当前 principal、Incident、原 UUID 和本票十种动作的原 `incident.command_receipt`。先核验当前父 READ，再核验原动作及子目标当前用途权限，之后才能读终态。ADMIN 专用动作降为 DISPATCHER 后不能核对；HANDLER 仅能核对当前仍由本人负责 Ticket 的原单人恢复。该主体/对象没有原记录时返回 UNKNOWN，不能据此获得重放权。

响应共同字段为 `incident_id,client_command_id,state`。UNKNOWN 无结果；FAILED 仅白名单稳定错误；COMMITTED 仅封闭六字段 Incident ACK、`replayed:true`。见[回执 Schema](../../../contracts/p2_012_incident_followup_receipt.schema.json)及[独立增量声明](../../../contracts/workbench_incident_followup_contracts.d.ts)。不返回正文、hash、身份、目的地或 Provider 错误。原13份 P2-012合同和032保持原字节，无数据库变更或第二套事实。

可用时复用原浏览器加密恢复库，scope 为当前 principal / `incident` / Incident UUID / `incident-followup`，并在展示敏感恢复内容前重新核对原动作用途及 HANDLER 当前 assignee。使用非导出 AES-GCM 密钥、首次保存固定24小时、UTF-8 16KiB、最多20草稿及20操作标记。完整 UNKNOWN 保留原 UUID、正文和捕获版本；页面、刷新、恢复及 SSE 不自动核对或 POST。用户只读核对为 UNKNOWN 后，完整未过期且当前获权的正文才可明确重放原意图。过期或丢弃仅保留 opaque UUID 核对，不能推断未提交。

原用途/对象失权仅清该 Incident 跟进 scope 并撤销其旧回调；真正401或 bootstrap 会话拒绝沿原全会话清理。新目的拒绝不能由恢复开关是否打开推断为全局会话失效。当前授权 epoch、请求身份、原请求撤销和恢复 generation 防止迟到读取、加密、解密、POST及回执恢复旧输入、受保护投影或 UNKNOWN。已知提交或稳定失败保持原结论；清理失败保留 UUID、阻止新提交并允许再次只读核对和清理。

已知提交且恢复副本完全结算后，可在同一详情明确开始下一次操作。上一 ACK 及历史事实保留，新的操作和原因均为空；新意图取得新的 UUID、当前捕获版本并再次验权，没有自动 POST。UNKNOWN 或副本清理失败不能开启新意图。原 UNKNOWN 的显式重放仍重新核对当前原动作用途及 HANDLER assignee，但不以已推进的父版本或状态阻止原正文到达现有账本；原 UUID、正文、父子版本保持，终态由原幂等回执及事务版本检查结算。

现有单条 SSE 控制器同时更新 Incident 父、各子窗口及当前 Report assignee 查询，保留原输入和捕获版本，版本变化须明确采用。通知窗口显示各路 Delivery 的当前结果及尝试次数：已发送、发送结果待核对或失败分别来自各条实际投递；订阅状态和群通知不替代个人投递结果。读取没有重试或核对控制授权（另属 T32）。

资源沿原单 App/Worker、零新增 Gateway、SSE默认32及总池建议≤8；body32KiB和原页数/草稿上限保持。workspace 与浏览器恢复能力默认关闭；关闭入口、专用恢复或 workspace 停止相应消费与专用回执，保留所有原 Ticket/Incident/Report/Subscription/Event/Outbox/Delivery。新增负责人转交、内部处置和显式发布仍属 T29–T31。

当前本地定向测试使用真实隔离 PG、loopback Cookie HTTP、正式 production bundle 与合成外部适配器。原 RED、后继各风险验证、原七项和最终被测对象以[T28执行记录](../../../plans/admin-workbench-integration/execution/t28.md)及外置原始报告为准；真实外部服务/发送、部署、full/certify与Gate仍按原独立停止线。

## T33 控制合同准备（2026-10-14）

[Incident独立Delivery控制合同](incident-delivery-control-design.md)已冻结SOURCE，原七PENDING／runtime NOT_RUN／WHOLE_NOT_GRANTED。普通retry按当前人类角色答复，UNKNOWN保持ADMIN-only独立核对；VIEW／PUBLISH／owner／HANDLER不授控制权。拟议control/retry/reconcile/notification-commands入口均NOT_MOUNTED，默认关闭；不改变本页既有HTTP、Ticket／Conversation控制或原SQL／历史Evidence。

## 分路投递控制（T33，默认关闭）

当前专用授权、四个 HTTP 路由、v2 尝试快照、原 UUID 回执/恢复与显式 060 迁移见 [Incident 投递控制](incident-delivery-control.md)。读取或发布权、负责人身份和一般会话权限不授予此独立用途；通知状态变化不代替权限撤回。
