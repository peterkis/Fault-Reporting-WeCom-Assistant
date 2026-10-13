# Incident 显式安全公开进展（WBINT-T31）

返回 [API导航](../README.md) · [路径索引](../endpoint-index.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t31.md)

状态：`LOCAL_SYNTHETIC_IMPLEMENTED_DEFAULT_OFF`。WBINT-10/A10；原功能pin `bdbe6422506b4ab0d77b7c11eeca60df7b172391` 的032八文件15项、034相关六文件32项保留原对象。S1 Worker修补pin `2f18fbec1ec19c8a07394ac6d7bba0ba2e2476ec` 的040受影响六文件19项通过；S2最终功能pin `84093163c703b583bbc4a6cfa35ab3463c6eb543` 的046两个真实403/401分支与047三项既有恢复风险通过。这些不同范围不相加包装成一次整票总数。纯文档后继不重绑被测对象。父独立审查、验收、集成和Issue收口另行记录；没有部署、真实外发或Gate批准。原SOURCE合同/首例和D记录保留其原身份，不能改称当时已运行。

## 输入、权限和确认

独立人工填写安全公开摘要，初始空白，先预览、再明确确认；不读取或复制T30内部处置。沿Incident当前身份、READ和ADMIN/DISPATCHER范围政策，授权先于同主体原UUID重放和回执结果读取。默认DISPATCHER仅LOCAL/BUILDING，ADMIN仍须当前对象读取；owner、HANDLER、Ticket权限或T36规则不授此用途。CLOSED拒绝新发布，获权历史和原已提交命令仍可核对。

| 当前路径（W，独立默认关闭） | 输入 | 输出 |
| --- | --- | --- |
| `POST /api/incidents/{incidentId}/publish-update` | 原Cookie、同源Origin、CSRF、Idempotency-Key、精确带引号If-Match；无query；闭合五字段JSON | 原六字段Incident成功ACK或安全失败结构 |
| `GET /api/incidents/{incidentId}/public-progress` | cursor?；limit默认10/最大30 | [公开记录页](../../../contracts/workbench_incident_public_progress_page.schema.json) |
| `GET /api/incidents/{incidentId}/public-progress/{publicationId}/deliveries` | cursor?；limit默认30/最大100 | [本次按路结果页](../../../contracts/workbench_incident_public_progress_delivery_page.schema.json) |
| `GET /api/incidents/{incidentId}/commands/{commandId}` | 原UUID、无query，当前原PUBLISH用途与主体绑定 | 原UNKNOWN/FAILED/COMMITTED安全回执，不返回摘要、body/hash或他人结果 |

POST见[命令Schema](../../../contracts/workbench_incident_public_progress_command.schema.json)与[独立类型](../../../contracts/workbench_incident_public_progress_contracts.d.ts)：`client_command_id:UUID`、`expected_row_version:十进制string BIGINT`、`reason_code:WORKBENCH_PUBLIC_PROGRESS`、`summary:plain text`、`preview_confirmed:true`。路径注入action和Incident，body不可指定actor、target、audience或覆盖对象。摘要非空，最多1000 Unicode code points/4096 UTF8 bytes，允许tab/CR/LF，拒控制字符和非法surrogate；HTTP总body32KiB。精确版本及原UUID核验，异body冲突；无效输入400，当前权限403/对象不可见404，版本/状态/命令冲突409，结构或服务暂不可用503。查询拒重复、未知参数；关闭用途404。

## 唯一事实、意图和实际发送

同事务原`incident.command_receipt`、父版本+1、一条追加式`incident.public_progress_published`事件，以及每个有效个人的原Communication Message/Outbox/Delivery。原事件的独立`public_progress_summary`与提交版本不是内部text；`safe_payload={}`，不把摘要或内部记录混入原SSE/Reporter/旧event DTO。不可编辑、删除或自动摘取内部记录。个人Ticket编号、状态、责任及其ADR0023路由独立。

新模板`INCIDENT_PUBLIC_PROGRESS_DIRECT`和持久`sender_system_code=INCIDENT_PUBLIC_PROGRESS`只标识这个用途。当前ACTIVE、未暂停、同身份且有效DIRECT leg/Journey/单聊来源绑定才产生PERSON意图；暂停、失效、无绑定跳过。共享GROUP没有意图、广播或fallback，也不借Ticket App权限。每次最多200有效个人，超过受控拒绝，事务不截断提交。原四生命周期用途/六模板不变。

生产P2012装配在既有Worker尝试事务内再次核验订阅、原DIRECT锚点、同身份和当前有效目标，与原暂停/修改命令锁序协调。通用Worker以原Communication的持久新purpose识别意图；拆分进程或其他未装配admission的消费者在Sender前取消新目的，旧无hook用途不受阻，无需引入Incident DDL到旧Core。失效或用途关闭时，新目的排队意图CANCELLED/NOT_ATTEMPTED，不调用Sender；原目的继续既有策略。准入的LEASED→SENDING事务提交后即属在途，之后暂停不把真实ACK/UNKNOWN改称未发送。UNKNOWN不盲重试；各路失败/UNKNOWN不撤销已提交发布。T32/T33管理、重试/核对控制未提前实现。

GET只返回opaque Delivery ID、BOT_DIRECT/REPORTER_DIRECT、status、attempt_count、side_effect_state、安全error code及sent_at，无account、target、binding hash、provider receipt或内部标记。发布页ordinal/ID升序，投递页created/ID升序，游标绑定对象、当前主体/范围；当前页不称全部。正式UI每页10/30，分别最多保留三页，按具体发布显示独立真实行，已发布不等于已发送。attempt_count也可包含Sender前取消的准入审计，不等于实际发送或送达次数。

## 058、默认关闭、恢复和回退

最小additive[DDL058](../../../database/migrations/058_workbench_incident_public_progress.sql)沿原Event增加摘要/提交版本及严格shape、分页索引；沿原notification binding增加DIRECT leg锚点、新模板/shape/索引，前向完整扩展共享command/event CHECK。无第二ledger、Ticket、所有权或独立通知事实表。原032/055及旧SQL原字节保护。

先以既有工具完成032和055，再用本次编译`node .build/runtime/scripts/incident-public-progress-migrate.mjs --check|--apply|--status`，只能对另行获权数据库。check通过原savepoint实际应用/验证后回滚；apply记录058实际SQL checksum，重复status/apply验证marker/checksum和精确catalog后NOOP。保留原055摘要485113…与058共存完整结构d1f95e…证明，055工具允许经过058 marker/checksum核验的合法扩展。运行ready比较实际完整相关catalog；CHECK(true)、缺列/索引或CHECK漂移失败关闭，不是enum contains或全库认证。合成测试CLI最后的拒绝为checksum+shape联合漂移，不冒称shape单因CLI证明。

`incidentPublicProgressEnabled=false`，还须原correlation和candidate workspace。关闭不回滚追加事实或破坏性down。新用途开启时拒绝senderEnabled/gatewayEnabled；旧五项生命周期现场批准不授权这个新目的，本交付没有新的现场批准机制。原用途在新开关关闭时保持旧批准合同。[能力Schema](../../../contracts/workbench_incident_public_progress_capability.schema.json)的发布与恢复boolean默认false，恢复另需既有workbenchDraftRecoveryEnabled。

按路GET的已知purpose403/404只清除T31内容/查询/敏感恢复副本，不依赖其他请求的mutable授权stage，不把仍有效会话和别用途清除；真实401或身份变化仍沿原会话撤销边界。

草稿绑定当前账号、浏览器、Incident和独立`incident-public-progress`purpose：24h/16KiB/20份，非可导出AES-GCM键，无身份凭据。恢复前重验当前权限，UNKNOWN保留原UUID/body/提交版本，先显式只读核对；不自动重发/新UUID。恢复关闭时没有持久副本，同页仍保留丢ACK后的原UUID/version；CLOSED清理敏感正文与已知/未知结论分开，晚到GET/ACK不得恢复失权内容。原正文可用且明确核对UNKNOWN后才可人工重放同意图。

单App/API/SSE和既有Worker，communication concurrency1，SSE32，fixture池≤4/总建议≤8；无新进程、逐记录timer或无界timeline。证据根`D:/wecom-workbench-evidence/t31/whole-after-t30-20261013`：008原HTTP404 RED→014 GREEN；016真实暂停RED与023真实缺列FAIL分别保留；017表单缺失RED→024 GREEN，024静态“待发送”匹配不证明实际行，027/032按具体ID/status补证。030旧批准组合真实RED→032 GREEN。原类型FAIL、NOT_REACHED及日期转义误读纠正各保留。S1无hook生产Worker实际038 Sender2≠0 RED→040 GREEN；S2实际044 route403错误关闭有效会话RED→046 GREEN，原44外层AggregateError未存leaves，历史cleanup UNKNOWN/独立residual NOT_REACHED保持。049独立前向实查本票profile根/原HTTP51265/原用例隔离DB前缀均0；未发明旧PID/profile或重标历史PASS。050自有PG10012 pre0/stop0/post3、pidfile缺失、单62775 LISTEN0、原config同SHA、keeper STOPPED/pidnull/cleanuptrue。051保存当前1519源码/1959制品及MF，原60保护文件/40旧SQL、Root6和589entries/123selections/330resources原并集合规。独立审查准确引用由本票D最终前向handoff收口。

真实外部服务/发送、生产库、部署、push/PR、full/certify和Gate均NOT_RUN。
