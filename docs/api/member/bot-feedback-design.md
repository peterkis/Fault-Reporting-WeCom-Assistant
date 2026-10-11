# Bot 原报修人仍未解决反馈（WBINT-T21）

返回[Reporter接口](reporter-access.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t21.md) · [共享轮次](web-feedback-design.md)。

2026-10-11：本地隔离业务与生产制品浏览器验证已完成，最终运行和边界见执行记录。本地结果尚待父汇合、Issue验收；没有发布、启用或现场授权。独立宿主选项 `botReporterFeedbackEnabled=false`、`botReporterFeedbackDraftRecoveryEnabled=false`，全部持久 Feature Flag 默认false。

## 身份、来源与HTTP

M的MEMBER_SELF_SERVICE/FULL_SERVICE_LOOP、MEMBER_REQUIRED按当前独立获准corp/App/Bot配置、同App OAuth及configHash绑定的官方成员映射建立身份，再核原WECOM_AIBOT/Bot/Reporter、ACTIVE publicRef/binding hash及原Intake/关联Journey物理保留期。沿用ADR-0018/0019/0021；既有Bot Intake没有历史App pin，不回填或新增永久pin规则。命令创建时App和用途保持隔离，另一App的配置与映射仍须独立获准。

32字符publicRef只定位原Bot工单；旧Grant/entryRef/Bound Session、Web requestRef、内部UUID或浏览器自述来源不授写权。原Bot详情读取保持独立；原成员只读和OAuth-only职责见Reporter接口。

| Method / path | 行为 |
| --- | --- |
| `GET /api/reporter/tickets/{publicRef}` | 当前Bot本人READ；显式Bot能力启用时加闭合feedback_context，同事务生成context/ETag |
| `GET /api/reporter/feedback/bootstrap` | 当前成员；闭合schema_version/write_enabled/csrf_token三字段，WRITE关闭时false/null |
| `GET /api/reporter/feedback/recovery` | 当前受信成员独立Bot恢复scope；闭合schema_version/recovery_scope/raw_enabled，无query/body；不要求Web MY_REPORTS读取权限 |
| `POST /api/reporter/tickets/{publicRef}/feedback` | 当前WRITE及原Bot本人来源；仅显式STILL_UNRESOLVED，成功200表示事务已提交 |
| `GET /api/reporter/tickets/{publicRef}/feedback/commands/{clientCommandId}` | 当前独立Bot READ、原对象/App/用途/UUID；闭合UNKNOWN或COMMITTED，不受新WRITE关闭阻断 |

POST JSON≤2KiB、无query；当前Cookie、精确Origin、非cross-site、CSRF、Idempotency-Key精确UUID、If-Match为同版本带双引号十进制。共享[输入Schema](../../../contracts/yxx_self_service_feedback_command.schema.json)只收schema_version:1、client_command_id、feedback:'STILL_UNRESOLVED'、completed_round_ref、expected_ticket_version（安全整数1..2147483647）；拒绝额外文本/身份字段、重复JSON键、过深或非JSON输入。

共享[context](../../../contracts/yxx_self_service_feedback_context.schema.json)允许时给原completed_round_no/ticket_version和32字符opaque凭据；拒绝时业务标量null。round凭据是服务端物理分钟桶+HMAC，绑定Bot用途、当前corp/App/Bot/本人、publicRef、真实source/cycle/staff_completion_event，5分钟有效。不同分钟的凭据可以不同，不能按两次GET字节相等判断同一轮。

[Bootstrap](../../../contracts/bot_reporter_feedback_bootstrap.schema.json)、[Recovery](../../../contracts/bot_reporter_feedback_recovery.schema.json)、[Result](../../../contracts/bot_reporter_feedback_result.schema.json)、[Receipt](../../../contracts/bot_reporter_feedback_receipt.schema.json)及[类型](../../../contracts/bot_reporter_feedback_contracts.d.ts)均闭合。Result仅ok/replayed/public_ref/completed_round_ref/reopened_round_no和ticket{ticket_no,status:'REOPENED',version}；Receipt仅原UUID/public_ref/state及安全Result。没有内部Ticket/Intake/cycle/event UUID、身份、前人、内部过程、私有ledger或Grant。UNKNOWN不证明未提交。

## 当前权限与共享轮次

新POST要求当前Bot能力、当前SELF_SERVICE/MY_REPORTS及成员写profile。入口、锁后、最后授权DB await后和事务返回前核验当前WRITE、source/binding/物理retention/local-only成员；变化即拒绝并整事务回滚。事务内不连接OAuth/Provider。错误按当前认证401、对象拒绝404、禁止403、版本/轮次/幂等冲突409和不可用503区分；一般403或失权响应不证明原POST未提交。

只复用T20 completedTicketRound/reopenCompletedRound及同一TicketActionService。真正T11 STAFF_COMPLETED/040完成依据才可重开：同Ticket/version+1，新cycle、assignee清空，原组/source/history保留，首次责任与完工字段为空，等待工作人员显式重新承接；Conversation责任独立。普通补充和谢谢继续原Channel/Intake/Journey，不隐式重开。

stream→App/用途/UUID→source/Ticket→原ledger的锁顺序；同completed cycle唯一basis使不同UUID及STAFF/Bot竞争只成功一次。原UUID/原payload重放原安全结果，改payload或后到的新命令409。其他App/Web/Staff用途没有本用途原结果时返回UNKNOWN，不泄漏其他命令。

## 生产成员页面与恢复

既有Reporter进度页由独立typed Vite entry增加本人显式“仍未解决”及原操作只读核对控件。Node只发布当前编译manifest的闭合JS graph，不回退源码。实际可反馈时header说明“本人进度与明确反馈”；成功后fresh GET显示同单待承接。

恢复先取得当前原Bot本人detail READ，再从独立Recovery接口取得稳定opaque actor分区；对象publicRef和purpose:'bot-reporter-feedback'分别隔离，scope不授Ticket或WRITE权限。Bot raw选项独立默认false，raw_enabled还受当前WRITE约束。默认关闭且没有旧操作时不创建IndexedDB。

复用现有T03有界journal：raw payload在发送前加密、原UUID保存；非导出AES-GCM key、16KiB/20条上限、从首次保存起24小时。恢复只取opaque UUID而不解密/重发旧payload；过期或WRITE/raw关闭清cipher/key，已有原UUID仍须当前READ下显式GET。POST结果不确定、一般403、刷新或重认证不换UUID/版本，不自动POST；只有验证本对象的真实COMMITTED终态才结算。

退出按本Actor/kind/Bot purpose清各工单敏感副本、更新持久epoch并保opaque操作，隐藏标签同步停止。首次Recovery尚未到达的退出发明确无身份logout广播，已知Actor peer不经可见性门禁清自己的scope，不猜未知sender身份；迟到旧响应受generation/abort隔离。不同Actor和Web用途保持隔离，多标签save CAS/epoch禁止迟到加密复活副本。

## 数据库、资源与关闭

[050迁移](../../../database/migrations/050_bot_reporter_feedback.sql)与[迁移器](../../../scripts/bot-reporter-feedback-migrate.mts)仅在本地owned隔离库应用验证。前向扩已有ticket_command_receipt的BOT_REPORTER_FEEDBACK用途/App scope、安全snapshot及严格NULL actor CHECK，并向043 origin加BOT_REPORTER；既有SQL原字节、Ticket/cycle/ledger权威保持。成员不创建或借内部principal；没有第二Ticket/owner/双写。启用需要050/043就绪，缺schema明确503；默认关闭的原readiness不要求050。

同App/API、单Worker/Gateway/PG边界保持；业务pool≤4、总池建议≤8、路径in-flight≤32、锁/语句2s、SSE默认32，浏览器单busy请求及5s进度轮询。证据是软件资源和隔离行为验证，不宣称2C4G负载容量。

关闭两个Bot宿主选项并保全部持久Flag false，停止新写与新raw副本；成员写profile保当前READ下原UUID安全核对。保留已提交Ticket/event/cycle/ledger事实，不反向执行050或删除事实来回滚。readonly/OAuth-only/LEGACY_BOUND_GRANT不获得Bot写权。

## 证据边界

原七项、每组真实被测head/manifest、原RED/FAIL、两轴独立审查和资源释放见[执行记录](../../../plans/admin-workbench-integration/execution/t21.md)。原e971 HTTP和2f8a PC first body/roles/hash保留。新的physical Journey安排由现有Journey/ref Ports创建；SQL只注入锁/保留期/receipt或native clock包装等待故障，原clock OID/定义/comment恢复。

仅本地合成OAuth/mapping、隔离PG、真实HTTP和生产bundle浏览器。真实OAuth、WeCom/Provider、已送达卡片、强@或用户业务库、full/certify、部署、P2-G2-LIVE/P2-008及后续Gate未授权/未运行；不从本地PASS推导这些能力。
