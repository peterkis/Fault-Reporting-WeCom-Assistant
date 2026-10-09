# Web 原报修人仍未解决反馈（WBINT-T20 候选合同）

返回[成员自助](self-service.md) · [T20执行记录](../../../plans/admin-workbench-integration/execution/t20.md)。来源为 WBINT-06/A06、[Issue #75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)、Accepted [ADR-0024](../../../adr/0024_staff_completion_and_takeover.md)。

2026-10-09 状态为 **SOURCE_READY / NOT_IMPLEMENTED / NOT_RUN**。本页冻结后续公开 RED 的目标，当前 handler 尚无反馈入口、反馈上下文或命令核对。不能把下表当成当前可调用 API。Bot feedback 属于 T21，不在本票挂载；既有 Web 补充与只读/OAuth-only/SS011 profile 保留。

## HTTP、输入和输出

宿主 M，既有 MEMBER_SELF_SERVICE 或 FULL_SERVICE_LOOP 成员扩展。Web `requestRef` 为原 `intake.web_request_binding.request_ref` 的32字符不透明引用；不能传内部 Ticket/Intake UUID、Bot publicRef、entryRef或旧Grant。它只定位来源，不授予权利。

| METHOD + PATH | 候选合同 |
| --- | --- |
| `GET /api/yixiaoxiu/requests/{requestRef}` | 复用当前详情；仅显式启用反馈能力时追加闭合 `feedback_context`。当前成员绑定读权、应用范围和保留期仍由既有授权核对，ETag含上下文的真变化 |
| `POST /api/yixiaoxiu/requests/{requestRef}/feedback` | JSON≤2KiB、无query、精确Origin/非cross-site、当前Cookie+CSRF；200为同事务已提交的 FeedbackResult，原UUID重放亦200且replayed:true，不以202表示重开 |
| `GET /api/yixiaoxiu/requests/{requestRef}/feedback/commands/{clientCommandId}` | 无query/body；只读核对原成员/企业/应用/原Web引用/FEEDBACK用途/UUID，200为 FeedbackReceipt。当前原绑定失效或错来源404，认证失效401，当前M读取能力失效403 |

POST所有字段必须存在，additionalProperties:false；重复JSON键和越深JSON按既有native输入守卫拒绝。输入为 `schema_version:1`、UUID `client_command_id`、唯一枚举 `feedback:'STILL_UNRESOLVED'`、32字符 `completed_round_ref`、number `expected_ticket_version`（安全整数1..2147483647）。`Idempotency-Key`精确等于UUID；`If-Match`精确为带双引号的同一Ticket版本。Web材料 `input_revision`、工作人员cycle UUID和客户端身份不是替代字段；无任意反馈文本或内部过程入口。

`feedback_context`为[闭合Schema](../../../contracts/yxx_self_service_feedback_context.schema.json)：允许时包含 `schema_version:1,can_feedback:true,completed_round_ref,completed_round_no:number,ticket_version:number,rejection:null`；不允许时引用/轮次/版本均null，rejection为 `WRITE_DISABLED|TICKET_NOT_CREATED|ROUND_NOT_COMPLETED|ROUND_ALREADY_REOPENED`。错误绑定没有上下文而是404。不暴露 Ticket/Intake/cycle/event UUID、上一轮处理人或原始身份。

completed_round_ref由现有受信服务端secret对用途、原成员/企业/应用范围、Web requestRef、当前cycle及其staff_completion_event_id做HMAC，截取24字节base64url。它不依赖浏览器session代次、不授予Bearer权限；重登录仍须重新核对原绑定。客户端只能从最新真实GET取值，服务端锁后从真实完工依据重算，不接受客户端宣称已完工。

[FeedbackResult](../../../contracts/yxx_self_service_feedback_result.schema.json)仅为 `ok:true,replayed:boolean,request_ref,completed_round_ref,reopened_round_no,ticket:{ticket_no,status:'REOPENED',version:number}`。[FeedbackReceipt](../../../contracts/yxx_self_service_feedback_receipt.schema.json)为原 `client_command_id,request_ref,state:'UNKNOWN'` 或 `state:'COMMITTED',result:FeedbackResult(replayed:true)`；不返回内部记录/owner/数据库主键。不存在当前用途回执是UNKNOWN，不能推出之前事务永远不提交。确定输入/权限/版本失败在原POST明确返回，不另造FAILED反馈收据系统。

## 权限、轮次与事务

新的宿主能力 `reporterFeedbackEnabled=false` 默认关闭，不增加部署profile或隐式启用选项。关闭时不构建新反馈用例、不读取043新字段/表、不改旧详情Schema/补充/收据。启用时要求实际033/039/040及043迁移标记；缺失503且无写入。M profile仍须为 MEMBER_SELF_SERVICE/FULL_SERVICE_LOOP，MY_REPORTS和SELF_SERVICE均true、服务端当前write_flag:true，既有SS011外层guard和当前成员认证继续执行。不能由查看详情、旧Grant或W principal推导M写权；OAUTH_ONLY、MEMBER_TICKET_READONLY和SS011零写仍拒绝。

核验是四道独立门禁：原Web绑定及source corp/app/proof、当前服务端写profile/flags/identity-generation、合法当前完工轮次、当前Ticket版本。完工轮次必须为039当前cycle、source_intake_id等于原Intake、040的不可变STAFF_COMPLETED结束事件/承诺成立、Ticket为CLOSED。未建单Intake、历史seed CLOSED或旧RESOLVED不能冒充T11完工轮次。共享恢复GET只要求当前M读权和原绑定；当前write_flag关闭或本轮已重开不能阻止已提交原命令核对，也不使新写入合法。O只读替代宿主原限制不因此扩展。

新反馈复用成员command adapter的本地quota（kind FEEDBACK）、CSRF/UUID、command advisory锁、localOnly身份复核及既有pool/caller transaction。禁止OAuth/Provider网络进入DB事务，重放也先重新验原绑定、保留期、当前profile/scope和身份。使用既有stream mutex于Ticket外键/业务行锁前，避免T11已有双UUID锁顺序风险；锁后再查绑定、Ticket、当前cycle/完工事件/版本。caller-TX入口不自行COMMIT/ROLLBACK，全部事实和最后身份复核在调用者同一事务内。

043仅作为前向提案独占预留，**未编写/应用**；033/039/040原字节保留。计划扩展现有 `intake.web_command_receipt` 的FEEDBACK kind及安全原结果引用/快照，不另建收据账本；其scope+UUID唯一约束继续共享SUBMIT/SUPPLEMENT/FEEDBACK，跨用途或改payload同UUID409。反馈不追加Web材料revision、不成为orchestrator补充输入。

计划在现有Ticket核心内增加不可变、事件关联的cycle-reopen依据（不是第二套Ticket或owner）：唯一completed_cycle_id、原source Intake、reopen event、新cycle、原command receipt及明确Reporter反馈依据。相同完工轮次被不同UUID或工作人员命令竞争时只能产生一个重开事件/新cycle；后到新UUID409，原已提交UUID返回原安全结果。失败于反馈、Core事件、cycle、owner清理或最后身份复核的任何一步，全事务回滚，不留下部分重开/收据。

唯一Ticket通过显式Core reopen从CLOSED到REOPENED，版本+1；保留原resolver_team/source/history，清assignee，追加一次ticket.reopened事件及新cycle（cycle_no+1、cycle_start_event为该事件，首次责任三字段全null、staff_completion_event_id:null）。原040完工与承诺不改。下一轮需显式承接；round能力下T04/T05对合法未承接REOPENED开放受控accept→start/accept-for-later，同一轮首次责任仅填一次，旧默认关闭矩阵保留。不能仅start、自动派回前人或制造FIRST_RESPONSIBILITY通知。

W既有reopen仍沿自身current principal/对象/action权限和W receipt执行；它在具有合法完工cycle时复用上述锁定、唯一结束依据与新cycle helper，不通过成员profile/CSRF授权，也不伪造Reporter feedback。独立W round能力 `ticketReopenRoundsEnabled=false` 不由M配置开启；无合格cycle的旧历史W动作保持既有合同，不回填历史或宣称新round已完成。

## UI、内部提醒、隐私和关闭

既有生产 `web/p2-reporter/self-service.js` 后续由本票接入：只在获准原详情展示“同一故障仍未解决”；普通补充/谢谢沿原supplement语义，关闭补充保持当前拒绝。新故障另报。成功后fresh GET显示同单待重新承接。409保留原意图并fresh GET，用户明确发起新意图才换UUID；未知结果保留原UUID/body/round/version，不自动POST或换ID。重新认证后只读核对原命令；可信scope改变清受保护内容且不认领他人命令。

回执/原命令恢复不包含输入原文。现有recovery_scope下仅保存有界用途、Web ref、UUID、round ref、Ticket版本；不存Cookie/CSRF/原始成员标识。每次新动作单in-flight1，UNKNOWN禁止新反馈。返回来源与原scope改变、401/403/404时清可信页面/cache；404核对来源失效不能伪判先前事务未提交。

提醒复用reopen核心事实、已有获权workbench查询/事件投影和SSE失效：从原040完工event取得上轮处理依据，投影/读取时重新核对该principal仍活动、有当前角色、原组/对象访问。只有仍获权上轮人可见其内部事实提示“原报修人反馈仍未解决，等待重新承接”；失权不披露，原获权团队仍保留待受理事项。它不写owner、跟进事实、Delivery或发真实消息；T24通知策略、T37跟进和T39声音不提前实现。外部timeline只给安全状态，内部过程/处理人/组/绑定hash/原始身份不进入Member DTO或恢复元数据。

复用既有pool（fixture业务池≤4、admin1；应用总池≤8）、一个App/Worker/Gateway、SSE32和concurrency1；POST2KiB、详情/收据单对象、原quota与32请求in-flight上限保留，无新进程/扫描平台。退回方式为关闭成员write_flag或SELF_SERVICE，保留MY_REPORTS下原读取/已启用feedback recovery；全面关闭新能力不读043，保留已提交Ticket/事件/round/receipt，禁止删除事实或回写旧SQL。真实发送、Provider/OAuth、用户DB、部署、full/certify和Gate另行授权。

原公开RED源：[wbint-t20-feedback.integration.test.mts](../../../tests/wbint-t20-feedback.integration.test.mts)，STAGED_RUNTIME/v3-p09、PG required、browser:false、原runner每文件240s。它经真实Web源受理/原orchestrator建单和T04/T11公共工作人员HTTP完工，再走真实member GET/POST。当前仅已准备，所有运行证据NOT_RUN。后续逐片补成员/绑定/profile负向、不同UUID/陈旧轮次、Caller-TX回滚、工作人员共享round/获权提醒、普通材料、响应丢失恢复及正式H5制品浏览器；首片不等于七项验收完成。
