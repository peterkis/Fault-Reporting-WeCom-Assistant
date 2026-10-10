# Web 原报修人仍未解决反馈（WBINT-T20）

返回[成员自助](self-service.md) · [T20执行记录](../../../plans/admin-workbench-integration/execution/t20.md)。来源为 WBINT-06/A06、[Issue #75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)、Accepted [ADR-0024](../../../adr/0024_staff_completion_and_takeover.md)。

2026-10-10 当前为 **LOCAL_VERIFIED_WHOLE / AWAITING_PARENT_ACCEPTANCE**：M详情context、真实feedback POST/专用GET、043同Ticket共享新轮、独立HANDLER W服务与正式H5/PC消费、获权两来源前人提示及受保护恢复已实现并完成[原七项本地验证](../../../plans/admin-workbench-integration/execution/t20.md)。最终0f9af956一套build/strict/artifact原生0，直接消费者10PASS、原hosts外层27PASS/native0；每个更早HTTP/合同/并发/隐私结果保留原HEAD/制品/日志，不重绑或伪称同候选全量。原RED、mixed FAIL、observer/setup错误和NOT_REACHED均保全，以下带日期的后继段落保留其原历史阶段。待父独立审查/集成/GitHub收口；真实外部、现场、部署/full/certify/Gate未运行。Bot feedback属于T21；补充与readonly/OAuth-only/SS011边界保持。

## HTTP、输入和输出

宿主 M，既有 MEMBER_SELF_SERVICE 或 FULL_SERVICE_LOOP 成员扩展。Web `requestRef` 为原 `intake.web_request_binding.request_ref` 的32字符不透明引用；不能传内部 Ticket/Intake UUID、Bot publicRef、entryRef或旧Grant。它只定位来源，不授予权利。

| METHOD + PATH | 当前合同 |
| --- | --- |
| `GET /api/yixiaoxiu/requests/{requestRef}` | 复用当前详情；仅显式启用反馈能力时追加闭合 `feedback_context`。当前成员绑定读权、应用范围和保留期仍由既有授权核对，ETag含上下文的真变化 |
| `POST /api/yixiaoxiu/requests/{requestRef}/feedback` | JSON≤2KiB、无query、精确Origin/非cross-site、当前Cookie+CSRF；200为同事务已提交的 FeedbackResult，原UUID重放亦200且replayed:true，不以202表示重开 |
| `GET /api/yixiaoxiu/requests/{requestRef}/feedback/commands/{clientCommandId}` | 无query/body；只读核对原成员/企业/应用/原Web引用/FEEDBACK用途/UUID，200为 FeedbackReceipt。当前原绑定失效或错来源404，认证失效401，当前M读取能力失效403 |

POST所有字段必须存在，additionalProperties:false；重复JSON键和越深JSON按既有native输入守卫拒绝。输入为 `schema_version:1`、UUID `client_command_id`、唯一枚举 `feedback:'STILL_UNRESOLVED'`、32字符 `completed_round_ref`、number `expected_ticket_version`（安全整数1..2147483647）。`Idempotency-Key`精确等于UUID；`If-Match`精确为带双引号的同一Ticket版本。Web材料 `input_revision`、工作人员cycle UUID和客户端身份不是替代字段；无任意反馈文本或内部过程入口。

`feedback_context`为[闭合Schema](../../../contracts/yxx_self_service_feedback_context.schema.json)：允许时包含 `schema_version:1,can_feedback:true,completed_round_ref,completed_round_no:number,ticket_version:number,rejection:null`；不允许时引用/轮次/版本均null，rejection为 `WRITE_DISABLED|TICKET_NOT_CREATED|ROUND_NOT_COMPLETED|ROUND_ALREADY_REOPENED`。错误绑定没有上下文而是404。不暴露 Ticket/Intake/cycle/event UUID、上一轮处理人或原始身份。

completed_round_ref由现有受信服务端secret对用途、原成员/企业/应用范围、Web requestRef、当前cycle及其staff_completion_event_id做HMAC，截取24字节base64url。它不依赖浏览器session代次、不授予Bearer权限；重登录仍须重新核对原绑定。客户端只能从最新真实GET取值，服务端锁后从真实完工依据重算，不接受客户端宣称已完工。

[FeedbackResult](../../../contracts/yxx_self_service_feedback_result.schema.json)仅为 `ok:true,replayed:boolean,request_ref,completed_round_ref,reopened_round_no,ticket:{ticket_no,status:'REOPENED',version:number}`。[FeedbackReceipt](../../../contracts/yxx_self_service_feedback_receipt.schema.json)为原 `client_command_id,request_ref,state:'UNKNOWN'` 或 `state:'COMMITTED',result:FeedbackResult(replayed:true)`；不返回内部记录/owner/数据库主键。不存在当前用途回执是UNKNOWN，不能推出之前事务永远不提交。确定输入/权限/版本失败在原POST明确返回，不另造FAILED反馈收据系统。

## 权限、轮次与事务

新的宿主能力 `reporterFeedbackEnabled=false` 默认关闭，不增加部署profile或隐式启用选项。关闭时不构建新反馈用例、不读取043新字段/表、不扩旧详情响应、不改补充/通用收据；既有闭合详情Schema仅增加条件可选的feedback_context引用，additionalProperties:false保持。启用时要求实际033/039/040及043迁移标记；缺失503且无写入。M POST仍须为MEMBER_SELF_SERVICE/FULL_SERVICE_LOOP，MY_REPORTS和SELF_SERVICE均true、服务端当前write_flag:true，既有SS011外层guard和当前成员认证继续执行。不能由查看详情、旧Grant或W principal推导M写权；OAUTH_ONLY、MEMBER_TICKET_READONLY和SS011零写仍拒绝。原purpose GET单独要求当前READ；运行中配置代次/flag变化继续拒绝，不放宽既有FLAGS_CHANGED或global读禁用。合法WRITE关闭仍READ的恢复情境使用当前稳定profile与fresh认证，核对原scope/UUID；不会由旧cookie或M写权推导读权。

已CLOSED/CANCELLED详情can_supplement=false，普通补充继续拒绝；普通谢谢/材料在原允许补充的合法阶段被接收，也不直接重开。反馈最后提交前在同事务重新核对原source与物理epoch保留期，不能沿用Ticket锁等待前的存活判断；真实过期回滚整个新轮次及receipt。

独立W `ticketReopenRoundsEnabled=false`沿自身PILOT_USER/角色/对象/版本权限复用同一043合法完工basis，原W ledger记录reopen，不伪Reporter FEEDBACK。条件readiness043和bootstrap ticket_reopen_rounds_enabled由同一能力决定；没有完工basis或能力关闭保持原W动作合同。正式PC显式原因/原UUID/原版本表单在成功响应后读取当前获权新cycle事实；UNKNOWN不自动POST/换UUID，专用安全GET只按当前W READ/原actor/Ticket/reopen用途查安全标量与basis，不读取原原因或私有payload。关闭新write/raw仍可在当前READ下核对已有原UUID，失权拒绝。当前闭合reopen_follow_up消费已证明STAFF和WEB_REPORTER两来源、仍获权前人/团队待承接及失效认证清理；不重新派工、外发或建立第二事实。M和W不改变Conversation责任。

核验是四道独立门禁：原Web绑定及source corp/app/proof、当前服务端写profile/flags/identity-generation、合法当前完工轮次、当前Ticket版本。完工轮次必须为039当前cycle、source_intake_id等于原Intake、040的不可变STAFF_COMPLETED结束事件/承诺成立、Ticket为CLOSED。未建单Intake、历史seed CLOSED或旧RESOLVED不能冒充T11完工轮次。共享恢复GET只要求当前M读权和原绑定；当前write_flag关闭或本轮已重开不能阻止已提交原命令核对，也不使新写入合法。O只读替代宿主原限制不因此扩展。

新反馈复用成员command adapter的本地quota（kind FEEDBACK）、CSRF/UUID、command advisory锁、localOnly身份复核及既有pool/caller transaction。禁止OAuth/Provider网络进入DB事务，重放也先重新验原绑定、保留期、当前profile/scope和身份。使用既有stream mutex于Ticket外键/业务行锁前，避免T11已有双UUID锁顺序风险；锁后再查绑定、Ticket、当前cycle/完工事件/版本。caller-TX入口不自行COMMIT/ROLLBACK，全部事实和最后身份复核在调用者同一事务内。

043前向迁移已实现并仅在隔离owned测试库实际应用；033/039/040及旧SQL原字节保留。它扩展现有 `intake.web_command_receipt` 的FEEDBACK kind及安全原结果引用/快照，不另建收据账本；scope+UUID唯一约束继续共享SUBMIT/SUPPLEMENT/FEEDBACK，跨用途或改payload同UUID409。反馈不追加Web材料revision、不成为orchestrator补充输入；未对用户数据库执行迁移。

现有Ticket核心内已增加不可变、事件关联的cycle-reopen依据：唯一completed_cycle_id、原source Intake、reopen event、新cycle、原command receipt及明确Reporter或STAFF来源依据，不是第二套Ticket或owner。真实不同UUID/两来源竞争只产生一个重开事件/新cycle；后到新UUID409，原UUID合法重放返回原安全结果。反馈、Core事件、cycle、owner清理或最后身份/物理retention复核任一步失败，全事务回滚；Caller-TX和锁等待风险已按原固定源验证。

唯一Ticket通过显式Core reopen从CLOSED到REOPENED，版本+1；保留原resolver_team/source/history，清assignee，追加一次ticket.reopened事件及新cycle（cycle_no+1、cycle_start_event为该事件，首次责任三字段全null、staff_completion_event_id:null）。原040完工与承诺不改。下一轮需显式承接；round能力下T04/T05对合法未承接REOPENED开放受控accept→start/accept-for-later，同一轮首次责任仅填一次，旧默认关闭矩阵保留。不能仅start、自动派回前人或制造FIRST_RESPONSIBILITY通知。

W既有reopen仍沿自身current principal/对象/action权限和W receipt执行；它在具有合法完工cycle时复用上述锁定、唯一结束依据与新cycle helper，不通过成员profile/CSRF授权，也不伪造Reporter feedback。独立W round能力 `ticketReopenRoundsEnabled=false` 不由M配置开启；无合格cycle的旧历史W动作保持既有合同，不回填历史或宣称新round已完成。

## UI、内部提醒、隐私和关闭

既有生产 `web/p2-reporter/self-service.js` 已接入正式H5：只在获准原详情展示“同一故障仍未解决”；普通补充/谢谢沿原supplement语义，关闭补充保持当前拒绝。新故障另报。成功后闭合原结果与fresh GET显示同单待重新承接。409保留原意图并fresh GET，用户明确发起新意图才换UUID；UNKNOWN保留原UUID/body/round/version，只由用户GET原FEEDBACK回执和当前本人事实，不自动POST/换ID。当前授权scope改变或失权清受保护内容，不认领他人命令。

M独立 `reporterFeedbackDraftRecoveryEnabled=false`、W raw投影 `ticket_reopen_draft_recovery_enabled`均默认关闭。启用时两端复用T03唯一AES-GCM/non-extractable key、first-save24h不续期、scope/purpose AAD、CAS和20份/16KiB限制；M使用principal64摘要/request_ref32/reporter-feedback，W为当前principal/Ticket/staff-reopen，不保存Cookie/CSRF。expiry/corrupt清敏感副本并保原opaque，恢复先当前READ，失去新写或动作不显示原原因。oldopaque在raw关闭后仍可用户GET；终态清理后不能为新输入新建敏感副本。真实POST200之后读取暂时503不变成已知失败，不丢唯一UUID；cleanup未确认保原栅栏。cold rawOFF/no oldrow不读写IDB，不承诺刷新24h，仅挂载页内核对。退出/current授权拒绝清页面与范围内容；原同scope取消回调在rawOFF仍保留，迟到回执不能重新显示旧内容。Member新scope和两端真实consumer/nativeCDP/IDB/privacy/logout/原T03兼容均保各原制品证据，不把decoy store scope称业务授权。

回执/原命令恢复不包含输入原文。现有recovery_scope下仅保存有界用途、Web ref、UUID、round ref、Ticket版本；不存Cookie/CSRF/原始成员标识。每次新动作单in-flight1，UNKNOWN禁止新反馈。返回来源与原scope改变、401/403/404时清可信页面/cache；404核对来源失效不能伪判先前事务未提交。

提醒复用reopen核心事实、已有获权workbench查询/事件投影和SSE失效：从原040完工event取得上轮处理依据，投影/读取时重新核对该principal仍活动、有当前角色、原组/对象访问。只有仍获权上轮人可见其内部事实提示“原报修人反馈仍未解决，等待重新承接”；失权不披露，原获权团队仍保留待受理事项。它不写owner、跟进事实、Delivery或发真实消息；T24通知策略、T37跟进和T39声音不提前实现。外部timeline只给安全状态，内部过程/处理人/组/绑定hash/原始身份不进入Member DTO或恢复元数据。

复用既有pool（fixture业务池≤4、admin1；应用总池≤8）、一个App/Worker/Gateway、SSE32和concurrency1；POST2KiB、详情/收据单对象、原quota与32请求in-flight上限保留，无新进程/扫描平台。退回方式为关闭成员write_flag或SELF_SERVICE，保留MY_REPORTS下原读取/已启用feedback recovery；全面关闭新能力不读043，保留已提交Ticket/事件/round/receipt，禁止删除事实或回写旧SQL。真实发送、Provider/OAuth、用户DB、部署、full/certify和Gate另行授权。

原公开RED源：[wbint-t20-feedback.integration.test.mts](../../../tests/wbint-t20-feedback.integration.test.mts)，STAGED_RUNTIME/v3-p09、PG required、browser:false、原runner每文件240s。它经真实Web源受理/原orchestrator建单和T04/T11公共工作人员HTTP完工，再走member GET/POST；原7a607…字节、9c150实际RED和31e3实际GREEN1均保留。独立STAFF原c630…和next accept原b393…分别保角色/原断言/240s；原首不是整票替代，完整七项/后续实际失败与当前证据见执行记录。以下是各原固定候选的历史，不是当前未实现清单。

## 2026-10-10 原目的核对与保护恢复后继合同（PLANNED / NOT_RUN）

cf53真实H5和独立HANDLER PC各1PASS仅证明明确提交首行为。下一公开slice保留模拟已提交响应丢失：真实POST已提交后只丢其浏览器响应，页面保持原UUID/body/round/version；“只读核对原操作”只能GET原FEEDBACK或STAFF_REOPEN用途回执，再GET当前获权事实，禁止换ID、自动POST、把UNKNOWN当未提交或伪造成功。M现有FEEDBACK receipt已实现，H5该消费尚未实现；W拟加 `/api/tickets/{ticketId}/reopen/commands/{clientCommandId}`，仅当前W读取授权、原principal receipt scope、原Ticket和`reopen`目的。安全回执只包含原command/Ticket标识、UNKNOWN或FAILED或COMMITTED的原安全结果，不含原因、内部过程、Cookie/CSRF或第二套owner。非该principal/目的没有可冒领结果；原对象失权仍拒绝读取。raw关闭不是GET核对的前置阻断。

M拟新增独立严格boolean配置 `reporterFeedbackDraftRecoveryEnabled=false`，只在显式启用feedback的bootstrap中声明闭合 `feedback_draft_recovery_enabled:boolean`，旧未启用feedback的bootstrap形状保持。W沿T03已有独立默认关闭raw选项，使用独立`staff-reopen`用途；M使用`web-feedback`用途和当前受信`recovery_scope`、原Web ref。raw关闭时本票原操作仅留当前页内存，不把FEEDBACK塞入旧SUBMIT/SUPPLEMENT journal，不新存原UUID或原文。raw打开才允许有界受保护内容：同浏览器AES-GCM/不可导出key、首次保存起24小时不续期、单操作in-flight、最多20项，元数据不含Cookie/CSRF/真实成员身份或原因原文。

恢复每次先核当前READ、当前原scope/应用/来源和独立用途，再恢复敏感内容；新提交另核当前WRITE/CSRF/round/version。退出、失权、来源失效或scope代次不匹配清页面敏感内容；过期/损坏记录不能给新操作授权。UNKNOWN即使raw不可恢复仍只能查原UUID，没有终态不得重交；COMMITTED只在闭合原结果与fresh事实均核实后说明已核对，FAILED也须fresh读取后由用户明确发起新意图。这是待公开RED/最小实现/正式浏览器验证的合同，不是cf53已通过的恢复证明。

工作人员详情拟追加闭合可选`reopen_follow_up:{origin:'WEB_REPORTER'|'STAFF',is_previous_handler:boolean,awaiting_acceptance:true}`，仅真实043 current shared basis/未承接轮次、当前获权W读者可见。`is_previous_handler`根据040真实完成操作人及当前身份/对象读权派生；不保存新跟进或owner，不自动派回。前人失权仍拒读，其余获权团队保持未指派事项和普通待承接提示。M DTO没有该字段，不泄露工作人员身份或内部处理内容。本后继有两来源公开首断言，运行仍NOT_RUN。

## b41 原11实际差额后的最小前向（SOURCE / NOT_RUN）

b41 原六文件2PASS/9FAIL和NOT_REACHED完整保全，见本票执行记录。已观察的专用W ACK/两端UNKNOWN控件/M raw false声明/未承接START/两来源提示差额现在沿上文合同实现源码；H5现有FEEDBACK GET消费和W独立GET安全回执都不自动重POST。M当前详情本就只含安全Ticket编号/状态，不假造内部cycle/version供浏览器核对；闭合原FEEDBACK receipt确认原结果，再读当前本人同Ticket安全事实和timeline。PC按闭合原回执与当前同轮事实核对，两端暂仍本页内存，不实现未经first观察的raw存储。readonly/OAuth-only的403是原namespace拒绝，保留原FAIL后仅更正合法安排；W readiness先执行既有public coordinator前置，不修改Schema门禁。新候选须实际build/types/artifact和原11验证，默认关闭、当前READ边界、独立STAFF、原七remaining保持。

b176 两生产UNKNOWN browser现已各原生1PASS，真实POST status200/原purpose GET/fresh同Ticket事实、无第二POST/rawOFF均到达；原POST body未独立persist，不回填历史。下一同浏览器raw首仅在独立raw选项显式true下由真实页面提交丢响应、reload后保原UUID或核实原终态、只GET原用途和当前事实，不用私有seed/新UUID/假成功。它尚未运行，也不代表加密、首次保存24h、损坏/到期/当前READ/source scope清理已完成；这些仍需后续实际slice。当前全局READ关闭、readonly/OAuth-only、原配置代次及来源绑定/保留期规则保持，不能用W权限绕M边界。
