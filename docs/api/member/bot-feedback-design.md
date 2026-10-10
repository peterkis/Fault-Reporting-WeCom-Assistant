# Bot 原报修人仍未解决反馈（WBINT-T21）

返回[Reporter接口](reporter-access.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t21.md) · [共享轮次](web-feedback-design.md)。

2026-10-10：**SOURCE_CONTRACT_FROZEN / NOT_IMPLEMENTED / NOT_RUN**。以下是[#76](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76)冻结候选；新增字段/入口尚未挂载，不能当现有REST调用。当前Bot详情和旧Grant规则仍见Reporter接口。

## 身份、来源与HTTP

宿主M的MEMBER_SELF_SERVICE/FULL_SERVICE_LOOP、MEMBER_REQUIRED。原Bot详情沿独立 `/api/reporter/tickets/{publicRef}`；32字符publicRef只定位。当前企业/应用OAuth及已证明映射、配置Bot、原source WECOM_AIBOT、原Reporter userid、active publicRef/binding hash、Intake/关联Journey物理保留期共同验权。后续H5读取或转单聊不改变原Bot来源。Web requestRef、Ticket UUID/编号、64hex entryRef、继续令牌和Grant均不是feedback定位或授权。

2026-10-10前向范围澄清：沿用[ADR-0018](../../../adr/0018_yixiaoxiu_member_ticket_entry.md)、[ADR-0019](../../../adr/0019_yixiaoxiu_delegated_identity_mapping.md)及[ADR-0021的SS-008装配](../../../adr/0021_yixiaoxiu_self_service_contracts.md)。当前受控且获准的corp/App/Bot配置、同App OAuth和完整configHash绑定的官方映射建立当前成员身份，再与原Bot/User/publicRef/hash及物理保留期共同验权。另一配置不能复用旧mapping；另一合法App也须独立批准配置、成员和映射，不能按同名userid猜测对应。

原Bot来源事实只有原Bot/User绑定，既有Bot Intake的source_app_scope为NULL，publicRef没有创建时App字段。当前认证App、命令创建时App/用途scope、原消息来源是三种不同事实。T21 roundRef和ledger command_scope由受信服务端身份导出当前corp/App/Bot/本人及BOT_REPORTER_FEEDBACK用途；该命令提交时的范围可作为命令事实持久保存，不能称为原Bot消息历史App，也不对publicRef读取回填、旋转或覆盖原hash。原命令恢复/replay必须匹配当前获权身份及原命令App/用途/ref/UUID，其他范围不能读取或重放其结果。

此前外置App-pin提案和依赖它的草稿按原字节保留，属于新增、未批准的策略解释，不作为本票历史App所有权的依据或正向fixture前置。Accepted规则未要求“ref创建时App终身pin”或“旧无pin ref只读”；缺该字段不使原source-bound首fixture失效。两个独立获准App对同一原Bot创建全新命令的历史排他规则未确定，本票不添加该断言或扩大App授权。若另行选择这种策略，须先明确批准并同步领域合同。

| METHOD + PATH | 冻结候选合同 |
| --- | --- |
| `GET /api/reporter/tickets/{publicRef}` | 原本人安全详情，仅显式Bot feedback能力增加T20闭合 `feedback_context`；先验权再ETag/304，ETag包含真实context变化 |
| `GET /api/reporter/feedback/bootstrap` | 无query/body、当前成员、同源；闭合 `schema_version:1,write_enabled:boolean,csrf_token:string或null`。CSRF来自当前服务端会话；无写权为null，不改旧只读bootstrap |
| `POST /api/reporter/tickets/{publicRef}/feedback` | JSON≤2KiB、无query，当前Cookie/精确Origin/非cross-site/CSRF、Idempotency-Key及quoted If-Match；200代表已提交，仅显式STILL_UNRESOLVED |
| `GET /api/reporter/tickets/{publicRef}/feedback/commands/{clientCommandId}` | 无query/body，当前获准corp/App/Bot/Reporter的独立Bot READ及原publicRef/命令创建时App/用途/UUID；200为闭合UNKNOWN或COMMITTED回执；合法新写关闭仍可核对旧命令，只GET不自动POST |

输入直接复用[YxxFeedbackInput](../../../contracts/yxx_self_service_feedback_contracts.d.ts)/[command Schema](../../../contracts/yxx_self_service_feedback_command.schema.json)：schema_version:1、UUID client_command_id、feedback:'STILL_UNRESOLVED'、32字符completed_round_ref、安全整数expected_ticket_version（1..2147483647）。additionalProperties:false；重复JSON键/过深JSON沿当前严格守卫拒绝。Idempotency-Key精确UUID，If-Match为同版本带双引号十进制。无任意反馈文本、内部过程或客户端身份字段。

context复用[Schema](../../../contracts/yxx_self_service_feedback_context.schema.json)：允许时schema_version:1/can_feedback:true/completed_round_ref/completed_round_no/ticket_version/rejection:null；不允许时后三个业务标量null，rejection为WRITE_DISABLED/TICKET_NOT_CREATED/ROUND_NOT_COMPLETED/ROUND_ALREADY_REOPENED。错误binding直接404。Bot roundRef由server secret对BOT_FEEDBACK用途、当前corp/app/Bot/原本人scope、publicRef及真实完工cycle/staff_completion_event做HMAC截24字节base64url，与Web用途/ref隔离；不是Bearer授权，锁后从完成依据重算。

[Bootstrap](../../../contracts/bot_reporter_feedback_bootstrap.schema.json)、[BotResult](../../../contracts/bot_reporter_feedback_result.schema.json)、[BotReceipt](../../../contracts/bot_reporter_feedback_receipt.schema.json)均闭合。[类型](../../../contracts/bot_reporter_feedback_contracts.d.ts)保留独立public_ref。Result仅ok/replayed/public_ref/completed_round_ref/reopened_round_no及ticket{ticket_no,status:'REOPENED',version}；Receipt仅原UUID/public_ref/state UNKNOWN或COMMITTED+Result(replayed:true)。不含Web request_ref、内部Ticket/Intake/cycle/event UUID、前人、原身份、command hash/private snapshot/Grant。缺原用途回执是UNKNOWN，不能推出无迟到提交；确定输入/权限/轮次/版本失败在原POST返回。

## 权限、共享用例与幂等

候选独立宿主选项 `botReporterFeedbackEnabled=false`；Web reporterFeedbackEnabled、旧Reporter timeline或W权限不隐式开启它。只有成员写profile、MEMBER_REQUIRED、当前write_flag、SELF_SERVICE/MY_REPORTS均true及Bot能力true才允许新POST。OAUTH_ONLY、MEMBER_TICKET_READONLY、LEGACY_BOUND_GRANT、SS011零写保持拒绝。ADR-0018旧Grant仅在当前成员重新认证及本人核验后定位，Bound Session读权不成为成员写权。

原UUID恢复独立核验当前Bot READ和原binding/retention/身份；“曾提交”或草稿不是READ。失权404、失认证401、profile/操作禁止403；合法WRITE关闭不阻止已有命令恢复，不创建新POST。原Bot读取不要求Web详情权限；服务端scope由受信认证产生，不按ref外形或浏览器宣称来源。

只有同一命令范围内的原UUID才能重放/核对原结果；另一已获准App上的同UUID若没有本App/BOT_REPORTER_FEEDBACK用途命令，返回闭合UNKNOWN，不能泄漏其他App/WEB/STAFF的已提交结果。这个命令隔离不宣称publicRef属于历史App，也不授予另一App新写权。现有member authorizer的read自行管理只读事务；未来writer需复用其原source/ref核验的caller-Tx接缝，不能用先读后写或嵌套read事务替代同事务验权。

复用T20 `completedTicketRound` / `reopenCompletedRound` 与原TicketActionService，不复制第二重开逻辑。原source Intake须匹配current cycle，仅真实T11 IN_PROGRESS→CLOSED/STAFF_COMPLETED/PILOT_USER事件及040承诺允许；旧seed CLOSED/RESOLVED不冒充。本次反馈命令、ticket.reopened和新cycle同事务，version+1、清assignee、保原组/source/history；新cycle首次责任和完工字段空、待显式重新承接，Conversation责任不变，不产生首次责任通知。

共享completed cycle唯一basis约束不同UUID及STAFF/Bot并发只成功一次；原UUID/原payload重放原结果，改payload或后到新UUID409。stream mutex在receipt FK/source/Ticket锁之前，scope+UUID advisory锁；锁后/提交前再验binding、物理retention和当前local-only身份，任一步失败全事务回滚。caller-owned事务不自行COMMIT/ROLLBACK，不让OAuth/Provider网络进入事务。普通补充/谢谢沿原Channel/Intake/Journey，不自动重开。

## 数据库提案、资源与关闭

父为T21独占预留050，**RESERVED_NOT_APPLIED**；本SOURCE无SQL/迁移器/writer。拟前向扩**已有** `pilot_ticket.ticket_command_receipt`：command_type BOT_REPORTER_FEEDBACK、服务端用途+corp/app/Bot/member hash的command_scope、真实Ticket/publicRef和原安全result_snapshot。Reporter不创建或借内部principal；actor_principal_id可空例外须闭合CHECK限制到Reporter用途，既有工作人员命令仍必须有合法principal。scope+UUID唯一/资源/终态约束不放宽，STAFF actor/scope/用途查询不读取Reporter记录。

以上App scope记录命令创建时受信认证范围；不因旧publicRef没有App列而追加历史pin、回填原Bot Intake或拒绝所有旧ref新反馈。新的合法feedback仍逐次满足本票成员写授权、原Bot所有权、真实完工轮次和并发规则。

050仅向043共享origin枚举添加BOT_REPORTER，不改031/033/039/040/043历史字节或回填。共享cycle仍唯一、Ticket/事件/轮次/已有ledger权威不变，无第二Ticket/ledger/owner。启用新写需迁移就绪；关闭不扩旧详情context/读新gated字段，当前READ下已提交安全原UUID恢复沿现有ledger列；缺必要schema明确不可用。具体SQL以首真实RED后最小实现冻结。

资源沿单App/API、单Worker、Gateway单活、SSE32、业务pool≤4/总池建议≤8；路径in-flight≤32、JSON2KiB、普通测试每文件240s/stock concurrency1。没有新常驻进程/每Ticket timer。关闭保既有Bot只读及已提交事实；UNKNOWN只GET原UUID，不重发/换ID/换版本。

正式Reporter页后续明确“同一故障仍未解决”，成功结果后fresh GET显示同单待承接；普通谢谢和新故障区分。内部获权前人提示复用共享reopen依据，失权不泄漏。恢复最长24小时、原UUID/payload、退出/失权清理、多标签和raw/write OFF须逐片真实验证；恢复Bootstrap/存储合同在对应slice前补充，不将当前三个bootstrap字段冒称已提供草稿恢复。

## 当前证据边界

首[HTTP tracer](../../../tests/wbint-t21-bot-feedback.integration.test.mts)仅一case。现有owned PG normalized Bot Inbox/Intake合成fixture→真实Core建单→真实工作人员T04/T11 HTTP完工→原受信source-bound publicRef Port→合成官方身份映射Stub/成员native HTTP context/CSRF/feedback/ACK→独立staff HTTP新cycle核对。它不是现场回调、SDK或已送达卡片验证；MEMBER_REQUIRED不需要Grant或伪造Delivery。build/types/artifact/PG/HTTP/browser全部NOT_RUN。权限负向、并发/回滚/补充、重新认证/多标签/UNKNOWN及正式生产成员制品浏览器仍是原七项未完成范围。
