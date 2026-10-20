# 医小修 App 原来源轮次通知（WBINT-T25）

2026-10-20 前向调整见 [ADR-0034](../../../adr/0034_mvp_notifications_and_application_members.md)。human-v1 使用 `FIRST_HANDLING`（首次实际接单或开始）与 `STAFF_COMPLETED`，派单、转派、等待不通知。063 为原 Web Request 追加不可改投的应用收件绑定；新 `VERIFIED_APP_OPENID` 模式不依赖逐人名单或当前 OAuth 会话定位通知。发送前在事务外核验当前应用成员，随后保留原来源、绑定、物理留存和等待后终检。原生应用身份直接作为应用收件人，不能当作原始 userid 再转换。个人卡片没有顶部渠道来源，已受理标题为“工程师正在处理你的工单”。下文 T25 保留为原兼容模式合同和历史证据；新 H5 接口见[接入说明](../../../h5/README.md)。

已实现、默认关闭；仅本地隔离合成验证。实际实现和各被测祖先见 [T25 执行记录](../../../plans/admin-workbench-integration/execution/t25.md)。没有真实送达或现场批准。

## 1. 配置、输入与关闭

宿主 W/P2-016，复用唯一 Ticket、原 Message/Outbox/Delivery/Attempt 和 Communication Worker。

| 服务端配置 | 默认与当前关系 |
| --- | --- |
| appNotifications / appNotificationTransport | 默认 null；前者显式 enabled/authority/localOnly targetResolver，关闭 enabled:false；后者 agentId/accessTokenProvider/可选 fetchImpl |
| senderEnabled / gatewayEnabled / ticketRoundNotificationsEnabled | 默认 false；App 沿原 template-card、MEMBER_REQUIRED 和独立发送授权 |
| externalSendEnabled | 既有默认 true；false 阻断 App 外发及 Delivery 控制，不能单独启用新能力 |
| liveApproval | 原 gatewayEnabled 或 senderEnabled=true 仍要求 live/scope/send 全部 true，否则 LIVE_APPROVAL_REQUIRED |

源码：`src/p2-016-runtime.mts:33,88–92,113–151`；`src/p2-016-wecom-sender.mts:19–35`。

输入保留原 WEB_REQUEST 或 VERIFIED_MANUAL_REPORT 的 scope/corp/app/mapping proof；MANUAL binding_proof_ref 独立核对。历史 ADMISSION 不授予未来发送权。当前受控 Resolver 要求原 authority、ACTIVE/VERIFIED/REACHABLE，不换人/应用；原 source/journey/leg、未撤销依据及物理 retention 必须有效。T17 HAND_ENTERED 保持人工联系且不要求可选045；每轮/node/原 Reporter/binding 意图稳定，模板升级不重复创建。

Resolver 1秒、闭合结果≤8KiB。SDK 链共享5秒 signal，credential/fetch/body read/cancel 均有 deadline race，响应≤8KiB。token 与 SDK 在事务外；source-before-public-ref 顺序锁定原 source 与 SENDING Delivery/basis，所有 source/basis 读取与锁等待完成后，在锁内进行最后 local member qualification；COMMIT 返回后、实际 send 前同步复查 signal 和物理 retention。源码：`src/workbench-app-notification-target.mts:28–99`；`src/workbench-app-notification-sender.mts:20–30,35–109`。

## 2. HTTP 与安全投影

没有新增 HTTP command。沿当前 W Ticket READ 的 GET `/api/tickets/{ticketId}/deliveries`，无 query、最多100条；安全 DTO 增加 `route_kind:YIXIAOXIU_APP`，destination 仍 PERSON；node/cycle_no 成对，状态、次数、技术副作用独立。typed/schema/decoder/“医小修应用”文案已存在，原始成员/账号/binding/hash/proof/Provider receipt/内部内容不公开。

| 原来源 | 本人详情与数据路径 |
| --- | --- |
| H5 | `/wecom/yixiaoxiu/reports/{requestRef}`；GET `/api/yixiaoxiu/requests/{requestRef}` 及 /timeline |
| VERIFIED MANUAL | `/wecom/yixiaoxiu/tickets/{publicRef}`；GET `/api/reporter/tickets/{publicRef}` 及 /timeline |

两者沿既有 login/callback 当前 OAuth 与独立对象归属。H5 MEMBER_SELF_SERVICE 可 MY_REPORTS=true/SELF_SERVICE=false，只读；MANUAL READ 核对 canonical member HMAC、原 scope/journey、ACTIVE public-ref/App binding 和物理 retention；reader await 与 COMMIT 后复查当前 OAuth。MANUAL 不进入 BOT_TICKET/Bot feedback。**保留匹配配置并 app.enabled=false 时历史本人 READ 继续有效**，不调用发送 Resolver；app=null 不是该读取装配。timeline 仅安全里程碑/批准的≤500字完工摘要，内部过程不可见。

源码：`src/p2-g2-yixiaoxiu-authorizer.mts:19–100`；`src/yxx-self-service-native-http.mts:217–233,325–331,387–404`；`src/yxx-self-service-query.mts:300–336`；`src/p2-016-reporter-timeline.mts:36–49`；`contracts/p2_016_contracts.d.ts:34`；`contracts/p2_016_ticket_notification.schema.json:18,111`；`web/admin-workbench/src/api/client.ts:130–144`。

## 3. SDK 与原恢复

实际 adapter 仅取 token，userid_to_openuserid 后 message/send；agentId 精确等于 sourceAppScope，仅一个 PERSON，拒绝批量/@all。卡片仅批准编号/状态/安全摘要/上述本人URL，无 Cookie/CSRF/Grant。conversion/pre-send 拒绝不发送；send 阶段 error/nonzero/partial/malformed/无可信 msgid 均 UNKNOWN，原 Worker 保留 RECONCILIATION_REQUIRED，不自动重发 UNKNOWN 或成功路。合法 SDK-only ACK 只保留技术摘要，不代表客户端送达。

原 POST `/api/tickets/{ticketId}/deliveries/{deliveryId}/retry` 闭合 `{client_command_id,reason_code}`；/reconcile 增加 resolution：CONFIRMED_SENT/CONFIRMED_NOT_SENT_REQUEUE/CANCEL。沿原 UUID/hash、Origin/CSRF、当前 Ticket/binding：retry 为 ADMIN/DISPATCHER/当前处理人，reconcile 为 ADMIN；externalSendEnabled=false 拒绝。UNKNOWN 不可普通 retry；核对更新同一 Delivery，追加 Attempt。无新增 receipt GET。源码：`src/p2-016-delivery-control.mts:15–34`；`src/p2-004-communication-delivery-worker.mts:244–260,375–468`。

读取200沿原闭合items；未经认证401、当前对象不可读403/404，不返回原正文或私有路由。恢复成功200返回原delivery_id/status/replayed；UUID改意图、状态不允许恢复为409。失败码、reason_code/UUID格式、CSRF及宿主合同沿[原Ticket控制](tickets.md)，本人认证失败沿[Reporter](../member/reporter-access.md)及[自助读取](../member/self-service.md)。客户端不推断UNKNOWN为失败，也不从卡片链接取得写权。

## 4. 合同、资源、关闭

当前[窄配置types](../../../contracts/workbench_app_notification_contracts.d.ts)、[安全Delivery Schema](../../../contracts/p2_016_ticket_notification.schema.json)、[目标核验](../../../src/workbench-app-notification-target.mts)、[实际App Sender](../../../src/workbench-app-notification-sender.mts)和[原Runtime](../../../src/p2-016-runtime.mts)是实现入口。公共route_kind仅允许YIXIAOXIU_APP，且destination_type必须PERSON；node/cycle_no成对。成员和管理端仍独立权限域，不公开账号、目标、绑定、mapping/proof或SDK receipt。

T25无数据库变更；054仅预留，无SQL文件。旧033/041/045/051/052不改，无第二Core/Outbox/Worker或新HTTP命令。消费批次沿20候选及(cycle_id,node)游标；复用单App/Worker、Communication并发1、Gateway单活、SSE32及池总建议≤8。SDK响应≤8192字节，共享5秒截止；Resolver≤8192字节/1秒。只验证这些有界场景，不声称2C4G现场容量。

app.enabled=false停止新通知入口、消费和发送；关闭轮次消费停止新意图，关闭原Sender/外发开关停止发送；保留已有承诺、历史和失败/UNKNOWN，匹配配置下本人历史READ仍可用。移除整个app配置会移除该MANUAL读取装配；停用发送宜保留严格有效的配置而设enabled=false，不反向删除事实或旧SQL。

官方主站本文/当前命名空间与字段、去重或错误副作用保证仍UNCONFIRMED；既有G0只支持适配器能力边界。实际SDK-only ACK和合成人工核对不代表客户端送达。没有真实Provider/OAuth/WeCom、部署、full/certify或Gate；原失败和逐祖先结果见[T25执行记录](../../../plans/admin-workbench-integration/execution/t25.md)。

