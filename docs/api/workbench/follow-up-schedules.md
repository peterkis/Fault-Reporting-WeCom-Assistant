---
task_id: WBINT-T37
issue: 92
status: LOCAL_VERIFIED
runtime_status: SELECTED_LOCAL_CHECKS_PASS
source_base: 406599744d5676a840c90cb497ff033b4c375aea
tested_head: 7ec7b3ec73cd2f1fc67f839582b4aad4bd34caa3
timezone: Asia/Shanghai
---

# 工单共享跟进时间（WBINT-T37）

返回 [API 导航](../README.md) · [HTTP 索引](../endpoint-index.md) · [工单](tickets.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t37.md)

本页描述当前实现。原七项的本地隔离验证、真实 loopback HTTP、生产前端制品浏览器结果及历史 RED 见执行记录；各结果保留自己的被测提交，不能拼成一次 full/certify。领域依据为 [ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md) 第4项及 [WBINT-12/A12](../../../plans/admin-workbench-integration/implementation-plan.md#wbint-12个人已读关注团队待跟进与共享预约)。T09 停止退回与共享安排组合归 T43，完整搜索归 T41；本票不推进现场、生产或业务 Gate。

## 宿主和入口

W 同源工作人员宿主，沿用当前活动内部 Principal 认证、Cookie Origin/CSRF 和 no-store。成员、Reporter、OAuth-only、公共 ref 和 Conversation 子路由没有本操作权限。

| METHOD + PATH | 行为 | 开关 |
| --- | --- | --- |
| GET /api/tickets/{ticketId}/follow-up-schedule | 当前获权安排、维护动作与最近20条历史 | workbenchFollowUpSchedulesEnabled，默认false |
| POST /api/tickets/{ticketId}/follow-up-schedule | 显式 SET 或 CANCEL | 同上，并核当前维护权限 |
| GET /api/tickets/{ticketId}/follow-up-schedule/commands/{commandId} | 原主体／用途／UUID 的最小安全终态 | 只依赖原生命周期与当前 Ticket READ，独立于新入口和 raw recovery |

路径使用 UUID，无 query。POST JSON≤32 KiB，拒绝未知字段；Idempotency-Key 必须等于 body UUID，If-Match 的引号数字必须等于 body expected_version。ACK GET 不需 CSRF/Origin、If-Match 或 Idempotency-Key，不返回原时间、payload/hash、人员、责任或私有资料。

## 输入、并发与幂等

[命令 Schema](../../../contracts/workbench_follow_up_schedule_command.schema.json)／[类型](../../../contracts/workbench_follow_up_schedule_contracts.d.ts)闭合为六字段：

| 字段 | 约束 |
| --- | --- |
| client_command_id | 原 UUID；UNKNOWN 保留，不生成新意图 |
| expected_version | 当前 Ticket 安全整数 number，1..2147483647 |
| expected_schedule_version | 当前安排修订的十进制 string，初始"0"，最大 PostgreSQL BIGINT；不得 Number 强转 |
| reason_code | 固定 WORKBENCH_FOLLOW_UP_SCHEDULE |
| action | SET 或 CANCEL |
| due_at | SET 为有效 Gregorian YYYY-MM-DD HH:mm:ss；CANCEL 为 null |

时间使用 Asia/Shanghai 秒精度合同，保存／返回精确配对的非负 physical epoch string；拒绝 offset、UTC 字面值、非法日历和不能表示的 epoch。过去时间表示已到期行动，不冒充 SLA。新 UUID 的合法 SET 总是创建新修订，包括相同时间；CANCEL 只用于当前活动安排，无活动安排时为409，不制造取消历史。

命令复用 P2_016:<principal> ledger，服务器固定用途为 WORKBENCH_FOLLOW_UP_SCHEDULE，不建立第二 ledger。hashP2016 的 canonical SHA-256 按递归对象键排序，绑定 server ticket_id、purpose、原 UUID、两个版本、reason_code、action 和精确 due_at；null 不省略，数字与字符串不互换，主体 scope 不由客户端指定。相同 hash 返回原 COMMITTED/FAILED，同 UUID 异内容为409；只有新写入核对当前维护权、两个版本与状态。重放不能再次推进版本、事件、信号或投递。

## 当前维护权限

先核当前活动内部身份及独立 Ticket READ，再允许当前 Ticket 处理人、真实 canonical 未结束 Session 的 ASSIGNED 本人沟通人、获权 DISPATCHER/ADMIN 维护。普通同组 READ、Conversation VIEW/CONTROL、关注和旧责任不自动授予维护权或 Ticket READ。

canonical 关联沿原 Intake 或 Journey/Channel Leg 完整关系，核实际 service_intake、Thread 与 Reporter 绑定。多个有效会话中任意一条实际 ASSIGNED 本人即可；查询先筛选本人 assignment，按 Session UUID 取最多一条，在调用方事务内保持 stream→Ticket→当前 authority→选中 Session→assignment 的锁序，再用原 getSessionAccess 复核。3和21个关联会话的实测保持固定查询数量，不锁其他会话。

可维护状态为 NEW/QUEUED/ACCEPTED/IN_PROGRESS/WAITING_REQUESTER/WAITING_VENDOR/REOPENED。RESOLVED/CLOSED/CANCELLED/DUPLICATE_LINKED 不接受新 SET/CANCEL。RESOLVED 保留现有活动安排及到期提示。没有个人处理／沟通责任时，由原处理组作为团队待办承接，不保存第三份 owner。

## 输出、卡片与恢复

[查询 Schema](../../../contracts/workbench_follow_up_schedule_view.schema.json)闭合输出 ticket_id、ticket_version、schedule_version、active、allowed_actions、history、history_has_more。active 为 null 或四字段 {schedule_version,due_at,due_epoch_ms,is_due}，修订等于顶层，时间／epoch精确配对。无安排初始版本为"0"，取消／结束后不回零。history 按安排修订和真实 Event ordinal 降序，最多20条；history_has_more 明示持久历史尚有后页。

历史项为 {schedule_version,action:SET|CANCEL|ENDED,due_at,occurred_at,ticket_event_id,end_reason:null|CLOSED|CANCELLED}。CANCEL/ENDED 保留结束的时间；ENDED 引用真实关闭／取消 Event，不伪造用户 CANCEL。

[POST结果](../../../contracts/workbench_follow_up_schedule_result.schema.json)为 {ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id:null,schedule_version,replayed}。成功后重读当前事实；当前读取临时失败不推翻原成功。[ACK](../../../contracts/workbench_follow_up_schedule_receipt.schema.json)为 {client_command_id,ticket_id,state}：UNKNOWN 无额外字段；COMMITTED 增加上述安全 result 且 replayed=true；FAILED 增加 error:{code,retryable:false}。无收据、STARTED或不匹配主体／Ticket／用途返回 UNKNOWN，不能据此推定未提交。旧 ACK 始终核当前 Ticket READ，但不要求新写开关、raw recovery 或维护资格；后续改期不会改写原成功 ACK。UNKNOWN 只显式 GET，不自动 POST。

现有 WorkbenchCard 的可选 follow_up_schedule 字段供看板、列表和 detail.item 共用，内容仅为上述 active 或 null。仅在开关开启时向已授权、已分页的 Ticket 追加，每批最多100个去重 ID，单次批量事实查询，无逐 Ticket HTTP 扇出，不附历史或维护权限；关闭时省略字段且不访问049。三处显示相同北京时间，复用严格 active 解码。到期一次提示后持续显示，显式取消后移除活动显示，详情保留历史；不改变排序、游标或全范围筛选。

正式 React 沿用公共加密草稿和 opaque store。follow_up_schedule_draft_recovery_enabled 由共享入口与 workbenchDraftRecoveryEnabled 共同派生，默认false。恢复先核当前身份和独立 Ticket READ，再核维护资格。敏感副本保留首次保存后的24小时，后续保存不续期；公共 store 最多20份敏感草稿、20个待核对操作，每份序列化内容≤16 KiB。过期、raw/view关闭或维护失权清敏感副本，保原 opaque UUID供独立 ACK；真实 READ/身份失效清对应授权范围。原 UUID和两个版本保持冻结，CAS失败保留实际当前操作，迟到 ACK不能清除新 UUID。已确认提交不因当前读取失败降格为UNKNOWN或重发。Cookie/CSRF不持久化。

POST维护403需补查当前 Ticket READ：200仅收口本用途；READ401/403/404才清对应授权范围。临时读取失败保留待核对操作。错误沿现有 W envelope：坏路径／字段／时间400，Origin/CSRF403，If-Match或业务版本冲突409，body超限413，未认证401、内部身份失效403、对象不可见404。新入口关闭503 P2_016_DISABLED，所需 schema未就绪503 P2_016_FOLLOW_UP_UNAVAILABLE；网络、临时503或畸形成功响应不能单独转为终态FAILED。

## 数据库与生命周期

[049](../../../database/migrations/049_workbench_follow_up_schedules.sql)和[迁移器](../../../scripts/workbench-follow-up-schedules-migrate.mts)保存原 Ticket 下的当前安排与追加SET/CANCEL修订，关联同一 Ticket/Event，不复制状态或责任。时间与epoch配对，PK/FK约束关联和修订，due索引稳定。迁移要求原031，check/apply显式调用，pool1且finally关闭；旧SQL字节保留。

SET/CANCEL 在原 ledger 事务内执行 Ticket version+1、同状态 ticket.follow_up_scheduled/ticket.follow_up_cancelled Event、049修订／当前值和内部实时失效；失败回滚业务保存点，原协议可保留终态FAILED收据。它们不改变状态、责任、Intake、轮次或外部 Delivery，不写自由正文。当前049 readiness核原checksum、两表及两个时间配对CHECK的存在、validated/enforced状态；本次删除／恢复真实约束已验证，不宣称完整表达式或catalog等价性检查。

转派、沟通责任交接及撤派保留原时间／修订，责任仍从原事实读取。活动状态由当前 Ticket 状态和原SET之后的关闭／取消／重开Event派生；终态不物理删除历史或额外增加用户修订。显式CANCEL才清当前指针／时间并追加取消修订。write关闭期间发生的真实关闭／取消仍结束活动；重新开启或重开不会复活旧安排，须新明确SET。T09停止退回组合留T43验证。

## 到期 Worker、资源和关闭

P2016EnabledRuntime.runFollowUpDueBatch({limit}) 为内部系统 Port，无公开HTTP批处理写入口。limit缺省20，仅接受1..20安全整数；返回 {scanned,emitted,skipped}，逐项非负且不超过limit。同实例忙或关闭返回全0，无BUSY字段。

批次按 (due_epoch_ms,ticket_id) 稳定选取，逐项串行、每项独立事务，锁序stream→Ticket→当前安排。重核当前修订、活动状态和到期时间；关闭／改期先提交则跳过旧候选，Worker先提交则保留一次历史提示，由消费者重读当前事实。后项失败不撤销前项。

[053 marker](../../../database/migrations/053_workbench_follow_up_due_signals.sql)以 (ticket_id,schedule_version) 持久去重，与内部realtime同事务提交；重复批次、并发runtime或重启不重复该修订。marker不因7天realtime保留期清理而失效。[053迁移器](../../../scripts/workbench-follow-up-due-migrate.mts)要求049并核原checksum、列、PK/FK及正版本约束。启用时runtime readiness同时要求049和053；普通view/POST依赖049。due故障记录既有projection failure，继续其他Worker任务后重新抛错，不伪装成功。

提示仅 ticket.updated / SYSTEM / TICKET，payload为 {ticket_id,follow_up_schedule_version,reason:FOLLOW_UP_DUE}，不含时间、人员或正文。当前Ticket READ决定可见性，Session CONTROL不扩权，SSE沿既有256授权ID总预算。发布不推进Ticket version/Event、安排修订、责任或Delivery；一次提示不清is_due。

复用单App/API/SSE、单Worker和宿主连接池；Gateway单活、SSE≤32、批次≤20、pool≤4／全机建议≤8。不新建进程、连接池或每Ticket定时器，两个显式迁移器各max1并关闭。关闭新view/write/due后，due在049/053访问前返回，保留历史、marker、receipt及仍获当前READ的旧ACK；不自动down迁移或删数据。前向修补／revert保持这些边界，不授权外部服务／真实发送、部署、full/certify或Gate推进。
