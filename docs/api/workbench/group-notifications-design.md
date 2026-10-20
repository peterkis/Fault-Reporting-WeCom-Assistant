# WBINT-T26：原群消息推送与 Bot 私聊合同

2026-10-20 human-v1 前向调整见 [ADR-0034](../../../adr/0034_mvp_notifications_and_application_members.md)：个人通知改为本轮 `FIRST_HANDLING` 与 `STAFF_COMPLETED`，原群仅在工作人员完工且存在准确 botId + groupId Webhook 时创建投递；无 Webhook 正常跳过，个人路继续执行。群正文为 `工单#{完整业务编号}小修已完成，麻烦您验收一下，有问题随时@医小修～`，原生提及由原报修人的已核验 mentioned_list 提供。Bot 收件和固定群回应不要求 Webhook；不沿群名路由。新模式成员接收开启时，个人模板和原群提及复用当前应用成员核验，等待后再次检查原来源与留存。下文原双节点群消息保留为兼容模式和 T26 历史合同；不改写已发送、UNKNOWN 或不可变消息正文。

状态：**LOCAL_IMPLEMENTED / SYNTHETIC_VALIDATION / REAL_DELIVERY_NOT_RUN**。这是 [#81](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81) 的实施合同，群适配器已接入现有Sender factory；本票不增加REST。原生强 @ 与真实送达尚未验证。原 [T24](../../../plans/admin-workbench-integration/execution/t24.md) 只完成原始单聊 Bot 轮次通知。依据 [ADR-0023](../../../adr/0023_origin_based_notification_routing.md)、[ADR-0024](../../../adr/0024_staff_completion_and_takeover.md)、[ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md)；本票原七项与实际运行/失败保全见 [执行页](../../../plans/admin-workbench-integration/execution/t26.md)。

## Consumer 输入、输出与来源

复用公开 `createTicketRoundNotifications({pool,enabled,botId,reporterAccess,...}).runOnce()`，不新增 HTTP 消费命令。输入是已有 039 轮次首次责任依据、040 完工承诺、真实 Ticket Event 与原 `source_intake_id`；`runOnce()` 不接收前端目的地或正文，返回现有 `{scanned:number,created:number}`。`created` 仍统计有新节点绑定的候选，不将两条路数误报为两个业务节点。每批最多20个候选；分页只是可重扫优化，早期 cycle 晚到完工及独立缺失路必须可恢复。

原群解析从 cycle 的原 source 出发，用权威 Contact Journey 的 `origin_intake_id`，校验同 provider/Bot/Reporter、真实 Inbox 的 group/chatid、Journey/Leg reporter binding 和最短 retention。没有 Journey 的真实群源可直接使用原 Intake；有 Journey 却无法证明一致时失败关闭。原群不能为空，缺群不证明单聊。群转单聊的 current channel、最新消息、H5访问、ADMIN维护的群显示名都不改变来源或目的地；同名不同群仍分别处理。

[内部 types](../../../contracts/workbench_group_notifications_contracts.d.ts) 明确最小原始源 tuple 与固定群内容，不作为浏览器 DTO。Bot／group／reporter 字符串仅在可信来源读取、Delivery目标和发送 seam 内使用，不进安全 HTTP、普通日志、群正文或 Evidence。身份匹配不能使用显示名、手机号、Provider user_id 或跨应用相似字符串。

## 每路持久承诺与发送

每 `Ticket + handling cycle + FIRST_RESPONSIBILITY/STAFF_COMPLETED + 原接收绑定 + destination_type` 独立唯一。两路为：

| 路 | 可信目标与外发内容 | 独立结果 |
| --- | --- | --- |
| GROUP | 精确原 Bot／原 group；批准固定低敏状态与四位工单尾号；消息推送的原生提及参数只指定原 Reporter | 一组 Message/Outbox/Delivery 与节点绑定 |
| PERSON | 精确原 Bot／原 Reporter；沿既有 Bot 私聊卡片与医小修本人详情授权 | 另一组 Message/Outbox/Delivery 与节点绑定 |

两种模板内容不同，因此各有真实 Message/Outbox/Delivery，不能仅增加 DTO 行或共用一条结果。缺失绑定由既有 caller-owned PostgreSQL Tx 补齐，追加承诺和原绑定原子提交，事务内不调用 Sender。已有同路合法承诺可按精确事件/来源采用；成功或已提交的另一条保持原身份，不由模板升级、交接、撤派、停止退回、再次承接或重放新增。下一真实轮次首次责任是新节点。新意图失败回滚当前 Tx 的新事实；不会撤销已提交 Ticket，也不会重建先前独立承诺。

现有 `personDestinationAuthorizer` 独立检查私聊资格；不以某一路拒绝改变另一条可信目的地，不转投别的 Bot、任意群或应用。失效/未证明的源不造猜测 Delivery；UI 不把缺路或一条 SENT 解释为全部完成。

`WeComMessagePushAdapter.send` 复用现有 Communication Sender 请求/结果。现有 `createWorkbenchGroupNotificationSender` 已由P2016 Sender/runtime可选配置接线，默认关闭。它沿 delivery_id/idempotency_key 重查真实 SENDING Delivery、exact 031/轮次/event 链、原 group/Reporter、不可变 content 和 retention，在异步资格/beforeSend等待后重新核验真实SENDING链与原源，再使用服务器保存的精确 `(bot_id,group_id)` 配置。显式resolveMentionUserId提供经核验的消息推送命名空间ID；默认null，不猜Bot userid跨命名空间等价。无需第二 Worker、receipt或目标登记事实源。既有 `createP2016GroupClosureWebhookSender` 仅处理旧 TICKET_CLOSED 模板，不满足新首次责任/双路合同，不能直接宣称通用 T26 adapter。

群内容闭合为 `transport=WECOM_MESSAGE_PUSH,node,suffix,status,occurred_at`：suffix严格4位数字；首次责任只接受权威 QUEUED/ACCEPTED，完工只接受 CLOSED；time为Asia/Shanghai无offset时间。固定渲染分别是“工单尾号 {suffix} 已有人员处理。”及“工单尾号 {suffix} 处理完成。”；无患者信息、报修原文、内部过程、任意自由摘要、原身份或公开链接。真正提及所需 Reporter ID 来自发送时精确源校验，不能写进群正文或由普通文本 `@姓名` 代替；禁止 @all。实际官方请求/响应、精确群配置与发送资格需在适配器实施时核对官方资料和现有能力证据，合成验证只证明结构和状态处理。原生强 @、客户端可见和真实 Bot 私聊送达另行授权验证。

ACKNOWLEDGED才进入SENT/ACKNOWLEDGED；明确REJECTED_NOT_APPLIED保持NOT_ATTEMPTED并按现有重试/终止规则记账；超时、缺回执或已调用而副作用不明进入RECONCILIATION_REQUIRED/UNKNOWN。一条成功不改变另一条；成功路不再send。只失败路经其原Delivery显式重试/核对，原群不可达保留安全失败，不回落其他目的地。外部技术ACK不是本人已读、客户端展示或真实强@证明。

## 实际 REST 与权限

本票没有新增已挂载 REST；继续以下真实 W 入口。查询均先当前身份和精确父对象授权，再返回安全现有 DTO；GROUP/PERSON、node/cycle_no、status/side_effect_state/attempt_count/sent_at真实显示。最多100条是展示上限，不能当所有历史轮次完整或全局异常队列。具体实现以 [tickets.md](tickets.md#ticket-通知控制) 及真实 handler 为准。

| METHOD + PATH | 输入与权限 | 结果/恢复 |
| --- | --- | --- |
| GET `/api/tickets/{ticketId}/deliveries` | 当前Ticket READ；ADMIN/DISPATCHER广域或HANDLER本人/有效团队范围 | 安全 `items`，无目标/群身份/原错误/凭据；两路分别显示 |
| POST `/api/tickets/{ticketId}/deliveries/{deliveryId}/retry` | 精确父binding，当前READ + ADMIN/DISPATCHER或当前处理人；闭合UUID `client_command_id`、CODE `reason_code` | 200 `{ok:true,delivery_id,status,replayed}`；仅原失败Delivery，SENT不重发、UNKNOWN不能普通重试 |
| POST `/api/tickets/{ticketId}/deliveries/{deliveryId}/reconcile` | 精确父binding、当前READ + ADMIN；上述字段加固定三种resolution | 显式CONFIRMED_SENT/CONFIRMED_NOT_SENT_REQUEUE/CANCEL，原Attempt审计 |

两个POST保持 Idempotency-Key等于UUID，Cookie仍验当前Origin/CSRF，现有Delivery控制无需If-Match。当前认证失效401/403、隐藏/wrong-parent404、输入400、状态/命令冲突409、关闭/未安装能力503；以原稳定错误码为准，不向报修人暴露核对原因。命令 authorize-before-replay，复用原principal-scoped Ticket ledger与同caller Tx；响应丢失只允许原UUID/原hash显式重放。当前无专用Delivery control安全GET command receipt，普通GET状态刷新不等于原控制命令成功；不能用T22 HUMAN_REPLY/INTERNAL_NOTE安全ACK或legacy `/api/deliveries/*` 的HTTP UUID校验冒充可靠控制回执。

T22获权精确Message列表可关联实际人工消息；本票不扩大会话读取范围、不复制owner、不建立第二receipt或把Session READ当核对权限。正式详情只读重读真实两路结果；跨域队列、Attempt详情和新重试UI沿T32/T33独立执行。

## 数据库、资源和关闭

新增052_ticket_group_round_notifications前向迁移，隔离合成库实际应用：仅扩展041 destination CHECK至GROUP/PERSON，保留原node/唯一键/FK/append-only guard。041及历史SQL字节不变。现有migrateTicketRoundNotifications apply同caller Tx校验并应用041/052，包括已装041升级；check不写库、返回的041标识不证明052已装，运行时完整schemaReady独立验052。没有用户库迁移。

复用原表，不另建Ticket、Delivery、owner、receipt或永久checkpoint；不回填不存在的历史数据。

复用 `ticketRoundNotificationsEnabled=false` 的默认关闭能力；此合同不引入或开启新持久Flag。false不扫描/读取新增结构，保留既有profiles；未来新增适配配置也默认不可外发。group发送还受现有senderEnabled、externalSend、精确发送批准及范围校验约束；合成Sender显式隔离，不连接Provider/OAuth/WeCom。关闭通知能力停止生成新节点；关闭发送并停止现有Worker消费保留全部Ticket/Event/cycle/Outbox/Delivery/Attempt，不删成功、失败、UNKNOWN或历史证据。

App/API/SSE1、Worker1、Gateway单活、Communication concurrency1、SSE32、复用原pool≤4/同机总量建议≤8；batch≤20，lease30s、Sender deadline5s、maxAttempts5、每目标60s窗口20。群配置≤32、响应体≤8192byte、生成群正文UTF-8≤2048byte，复用原数据库Attempt限流，不新建无界队列、计时器或连接池。合成节点、原生中断、当前正式bundle及资源结果见执行页和final handoff；真实2C4G容量仍NOT_RUN。
