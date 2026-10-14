# 完整HTTP接口索引

返回 [导航](README.md) · [宿主/公共约定](conventions.md)

按 `METHOD + PATH` 搜索。参数 `{...}` 是占位标识，不是字面URL。W/M/O/P定义见公共约定。`已实现`表示源码有handler并依赖相应装配/默认关闭开关，**不表示当前部署已启用**；`条件兼容`仅特定访问策略，`拒绝`不是可用服务。各行链接包含请求/响应/认证/失败规则及源码/测试。

## T31 显式安全公开进展（独立默认关闭）

| 方法 | 完整路径 | 宿主 | 当前状态／用途 | 契约文档 |
| --- | --- | --- | --- | --- |
| POST | `/api/incidents/{incidentId}/publish-update` | W | 本地已实现、默认关闭：独立人工摘要预览确认，不复制内部记录 | [T31公开进展](workbench/incident-public-progress.md) |
| GET | `/api/incidents/{incidentId}/public-progress` | W | 本地已实现、默认关闭：当前用途获权有界发布页 | [T31公开进展](workbench/incident-public-progress.md) |
| GET | `/api/incidents/{incidentId}/public-progress/{publicationId}/deliveries` | W | 本地已实现、默认关闭：具体发布的独立安全按路结果 | [T31公开进展](workbench/incident-public-progress.md) |

原Incident commands读取按同主体原PUBLISH用途及当前授权核对，不另建ledger。新用途不继承旧生命周期现场批准；没有GROUP路由。以上不表示部署已启用。

## T30 内部处置（独立默认关闭）

| 方法 | 完整路径 | 宿主 | 当前状态／候选用途 | 契约文档 |
| --- | --- | --- | --- | --- |
| POST | `/api/incidents/{incidentId}/internal-notes` | W | 已实现、默认关闭：当前获权内部处置追加，不外发 | [T30内部记录](workbench/incident-internal-notes.md) |
| GET | `/api/incidents/{incidentId}/internal-notes` | W | 已实现、默认关闭：当前内部用途获权有界分页 | [T30内部记录](workbench/incident-internal-notes.md) |

原 `/api/incidents/{incidentId}/commands/{commandId}` 的 T28 读取仍为既有入口；默认关闭的 T30 ADD_INTERNAL_NOTE 沿该入口按当前原用途授权核对，不另建 ledger 或回执路径。以上本地实现不表示部署已启用。

## 工作台REST

来源群名称增量默认关闭，启用条件和原始来源语义见 [来源群名称](workbench/source-groups-design.md)。

| ID | 方法 | 完整路径 | 宿主 | 状态 / 用途 | 契约文档 |
| --- | --- | --- | --- | --- | --- |
| PR01 | GET | `/api/workbench/items/{kind}/{id}/read-position` | W | 已挂载、默认关闭：当前获权来源的本人位置，kind=ticket/review/intake，有界分页 | [个人阅读位置](workbench/personal-read.md) |
| PR02 | POST | `/api/workbench/items/{kind}/{id}/read-position` | W | 已挂载、默认关闭：确切 source_ref/revision 的本人单调推进，原 UUID | [个人阅读位置](workbench/personal-read.md) |
| PR03 | GET | `/api/workbench/items/{kind}/{id}/read-position/commands/{commandId}` | W | 已挂载、默认关闭：当前主体/来源下原用途 UUID 的安全 UNKNOWN/COMMITTED核对 | [个人阅读位置](workbench/personal-read.md) |
| G01 | GET | `/api/workbench/source-groups` | W | 本地实现：ADMIN观察群目录、q检索、绑定搜索的分页；默认关闭 | [来源群](workbench/source-groups-design.md) |
| G02 | POST | `/api/workbench/source-groups/{groupRef}/name` | W | 已实现：ADMIN登记/改名；默认关闭 | [来源群](workbench/source-groups-design.md) |
| CW01 | GET | `/api/workbench/conversations` | W | 已实现、默认关闭：获权参与者/服务主题分页 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW02 | GET | `/api/workbench/conversations/{sessionId}` | W | 已实现、默认关闭：集中详情/ETag | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW03 | GET | `/api/workbench/conversations/{sessionId}/items` | W | 已实现、默认关闭：按sequence保留材料 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW04 | GET | `/api/workbench/conversations/{sessionId}/eligible-principals` | W | 已实现、默认关闭：当前合法沟通转派候选 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW05 | GET | `/api/workbench/conversations/{sessionId}/deliveries` | W | 已实现、默认关闭：精确Message/Delivery状态 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW06 | GET | `/api/workbench/items/{kind}/{itemId}/conversations` | W | 已实现、默认关闭：真实canonical事项关联，kind=ticket/review/intake | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW07 | POST | `/api/workbench/conversations/{sessionId}/takeover` | W | 已实现、默认关闭：人工接管 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW08 | POST | `/api/workbench/conversations/{sessionId}/transfer` | W | 已实现、默认关闭：合法沟通转派 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW09 | POST | `/api/workbench/conversations/{sessionId}/release` | W | 已实现、默认关闭：释放沟通责任 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW10 | POST | `/api/workbench/conversations/{sessionId}/handoff/request` | W | 已实现、默认关闭：请求人工接管 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW11 | POST | `/api/workbench/conversations/{sessionId}/handoff/cancel` | W | 已实现、默认关闭：取消人工接管请求 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW12 | POST | `/api/workbench/conversations/{sessionId}/messages` | W | 已实现、默认关闭：人工回复202仅受理 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW13 | POST | `/api/workbench/conversations/{sessionId}/internal-notes` | W | 已实现、默认关闭：内部备注201不外发 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW14 | GET | `/api/workbench/conversations/{sessionId}/messages/commands/{commandId}` | W | 已实现、默认关闭：固定回复purpose安全只读收据 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| CW15 | GET | `/api/workbench/conversations/{sessionId}/internal-notes/commands/{commandId}` | W | 已实现、默认关闭：固定内部备注purpose安全只读收据 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| MR01 | POST | `/api/workbench/reports` | W | 已挂载、默认关闭；T17 手填与 T18 明确核实选择两个 reporter 分支，同一受理账本；T19 一步处理另行实施 | [代录报修](workbench/manual-reports.md) |
| MR02 | GET | `/api/workbench/reports/capabilities` | W | 当前代录创建权限与恢复配置；能力不能替代每次操作验权 | [代录报修](workbench/manual-reports.md) |
| MR03 | GET | `/api/workbench/reports/commands/{commandId}` | W | 原主体／用途同账本只读 UNKNOWN/FAILED/COMMITTED；含核实选择原结果，另需恢复开关 | [代录报修](workbench/manual-reports.md) |
| MR04 | GET | `/api/workbench/reporter-candidates` | W | 已挂载、默认关闭；当前应用／对象获权候选，q/limit/cursor 有界；仅明确选择后才可提交 | [候选查询](workbench/manual-reports.md#2-候选查询-get) |
| C01 | GET | `/api/workbench/bootstrap` | W | 已实现：会话身份/能力 | [会话](workbench/conversations.md) |
| C02 | GET | `/api/conversations` | W | 已实现：会话分页 | [会话](workbench/conversations.md) |
| C03 | GET | `/api/conversations/{sessionId}` | W | 已实现：详情/ETag | [会话](workbench/conversations.md) |
| C04 | GET | `/api/conversations/{sessionId}/items` | W | 已实现：Timeline | [会话](workbench/conversations.md) |
| C05 | GET | `/api/conversations/{sessionId}/eligible-principals` | W | 已实现：转派候选 | [会话](workbench/conversations.md) |
| C06 | GET | `/api/conversations/{sessionId}/deliveries` | W | 已实现：通信投递 | [会话](workbench/conversations.md) |
| C07 | POST | `/api/conversations/{sessionId}/handoff/request` | W | 已实现：请求人工 | [会话](workbench/conversations.md) |
| C08 | POST | `/api/conversations/{sessionId}/handoff/cancel` | W | 已实现：取消接管请求 | [会话](workbench/conversations.md) |
| C09 | POST | `/api/conversations/{sessionId}/takeover` | W | 已实现：接管 | [会话](workbench/conversations.md) |
| C10 | POST | `/api/conversations/{sessionId}/transfer` | W | 已实现：沟通转派 | [会话](workbench/conversations.md) |
| C11 | POST | `/api/conversations/{sessionId}/release` | W | 已实现：释放 | [会话](workbench/conversations.md) |
| C12 | POST | `/api/conversations/{sessionId}/read-cursor` | W | 已实现：已读游标 | [会话](workbench/conversations.md) |
| C13 | POST | `/api/conversations/{sessionId}/messages` | W | 已实现：人工回复/202 | [会话](workbench/conversations.md) |
| C14 | POST | `/api/conversations/{sessionId}/internal-notes` | W | 已实现：内部备注/201 | [会话](workbench/conversations.md) |
| C15 | POST | `/api/deliveries/{deliveryId}/retry` | W | 已实现：通信重试 | [会话](workbench/conversations.md) |
| C16 | POST | `/api/deliveries/{deliveryId}/reconcile` | W | 已实现：通信人工核对 | [会话](workbench/conversations.md) |
| T01 | GET | `/api/lifecycle/bootstrap` | W | 已实现：生命周期身份/能力；WEB01复用及默认关闭的授权实时能力 | [工单](workbench/tickets.md) |
| T02 | GET | `/api/tickets` | W | 已实现：工单队列 | [工单](workbench/tickets.md) |
| T03 | GET | `/api/tickets/{ticketId}` | W | 已实现：工单详情 | [工单](workbench/tickets.md) |
| T04 | GET | `/api/tickets/{ticketId}/events` | W | 已实现：事件分页；T10默认false轮次引用增量源码待验证 | [工单](workbench/tickets.md#等待报修人的同轮次关联wbint-t10首片段) |
| T05 | GET | `/api/tickets/{ticketId}/responsibility` | W | 已实现：双责任 | [工单](workbench/tickets.md) |
| T06 | GET | `/api/tickets/{ticketId}/deliveries` | W | 已实现：工单通知；T24 Bot／T25 App／T26 GROUP 独立轮次默认关闭 | [工单](workbench/tickets.md#bot-原报修人轮次通知读取wbint-t24)、[App](workbench/app-notifications.md) |
| T07 | GET | `/api/tickets/{ticketId}/eligible-principals` | W | 已实现：处理人候选 | [工单](workbench/tickets.md) |
| T08 | GET | `/api/tickets/{ticketId}/reporter-contact` | W | 已实现：内部授权联系资料 | [工单](workbench/tickets.md) |
| T09 | POST | `/api/tickets/{ticketId}/queue` | W | 已实现：入队 | [工单](workbench/tickets.md) |
| T10 | POST | `/api/tickets/{ticketId}/accept` | W | 已实现：接单 | [工单](workbench/tickets.md) |
| T11 | POST | `/api/tickets/{ticketId}/start` | W | 已实现：开始处理 | [工单](workbench/tickets.md) |
| T12 | POST | `/api/tickets/{ticketId}/request-information` | W | 已实现：请求补充；T10默认false同轮次增量源码待验证 | [工单](workbench/tickets.md#等待报修人的同轮次关联wbint-t10首片段) |
| T13 | POST | `/api/tickets/{ticketId}/wait-vendor` | W | 已实现：等待供应商 | [工单](workbench/tickets.md) |
| T14 | POST | `/api/tickets/{ticketId}/resume` | W | 已实现：恢复处理 | [工单](workbench/tickets.md) |
| T15 | POST | `/api/tickets/{ticketId}/resolve` | W | 已实现：解决 | [工单](workbench/tickets.md) |
| T16 | POST | `/api/tickets/{ticketId}/confirm` | W | 已实现：确认 | [工单](workbench/tickets.md) |
| T17 | POST | `/api/tickets/{ticketId}/reopen` | W | 已实现：重开 | [工单](workbench/tickets.md) |
| T18 | POST | `/api/tickets/{ticketId}/cancel` | W | 已实现：取消 | [工单](workbench/tickets.md) |
| T19 | POST | `/api/tickets/{ticketId}/notes` | W | 已实现：备注 | [工单](workbench/tickets.md) |
| T20 | POST | `/api/tickets/{ticketId}/transfer` | W | 已实现：处理责任转派 | [工单](workbench/tickets.md) |
| T21 | POST | `/api/tickets/{ticketId}/deliveries/{deliveryId}/retry` | W | 已实现：通知重试 | [工单](workbench/tickets.md) |
| T22 | POST | `/api/tickets/{ticketId}/deliveries/{deliveryId}/reconcile` | W | 已实现：通知人工核对 | [工单](workbench/tickets.md) |
| T23 | POST | `/api/conversations/{sessionId}/takeover-and-accept-ticket` | W | 已实现：原子双责任 | [工单](workbench/tickets.md) |
| T24 | POST | `/api/tickets/{ticketId}/internal-notes` | W | 已实现、默认关闭：可靠内部备注，旧 notes 兼容保留 | [工单](workbench/tickets.md#可靠内部备注wbint-t02) |
| T25 | POST | `/api/tickets/{ticketId}/take-and-start` | W | 已实现、默认关闭：无真会话本人承接并开始，一个原子命令 | [工单](workbench/tickets.md#无会话本人承接与开始wbint-t04) |
| T26 | POST | `/api/tickets/{ticketId}/accept-for-later` | W | 已实现、默认关闭：先接单，本轮首次责任依据 | [工单](workbench/tickets.md#无会话本人承接与开始wbint-t04) |
| T27 | GET | `/api/tickets/{ticketId}/internal-notes/commands/{commandId}` | W | 已实现、默认关闭：按当前授权和原UUID只读核对内部备注终态 | [草稿与核对](workbench/tickets.md#当前浏览器草稿与只读核对wbint-t03) |
| T28 | GET | `/api/tickets/{ticketId}/related-conversations` | W | 已实现、默认关闭：当前可读的真实关联会话，UUID keyset，每页最多20 | [关联沟通承接](workbench/tickets.md#明确选择关联沟通的本人承接wbint-t05) |
| T29 | POST | `/api/tickets/{ticketId}/take-and-start-with-conversations` | W | 已实现、默认关闭：明确会话集合或保留沟通，原子本人承接并开始 | [关联沟通承接](workbench/tickets.md#明确选择关联沟通的本人承接wbint-t05) |
| T30 | POST | `/api/tickets/{ticketId}/accept-for-later-with-conversations` | W | 已实现、默认关闭：明确会话集合或保留沟通，原子本人先接单 | [关联沟通承接](workbench/tickets.md#明确选择关联沟通的本人承接wbint-t05) |
| T31 | GET | `/api/tickets/{ticketId}/conversation-handling-commands/{commandId}` | W | 已实现、默认关闭：原UUID专用安全Ticket终态，无Session结果 | [关联沟通承接](workbench/tickets.md#明确选择关联沟通的本人承接wbint-t05) |
| WB-T06-A1 | POST | `/api/tickets/{ticketId}/assign` | W | 已挂载、默认关闭，验证进行中：明确内部处理人/组，不接单或开始 | [派单](workbench/tickets.md#明确派单wbint-t06进行中) |
| WB-T06-A2 | POST | `/api/tickets/{ticketId}/transfer-assignment` | W | 源码已挂载、默认关闭，待本候选验证：显式转派处理人/组，保留状态和轮次 | [派单](workbench/tickets.md#明确派单wbint-t06进行中) |
| WB-T06-Q1 | GET | `/api/tickets/{ticketId}/assignment-targets` | W | 已挂载、默认关闭，待本候选验证：当前工单权限下的有效处理组与明确所选组成员 | [派单](workbench/tickets.md#明确派单wbint-t06进行中) |
| WB-T07-A1 | POST | `/api/tickets/{ticketId}/takeover` | W（计划） | PLANNED／NOT_RUN：本人和实际有效组一起接管，保留状态及同轮首次责任依据；尚未挂载 | [T07 SOURCE合同](workbench/tickets.md#跨团队本人接管wbint-t07-source) |
| WB-T07-A2 | POST | `/api/tickets/{ticketId}/takeover-and-start` | W（计划） | PLANNED／NOT_RUN：本人接管与合法accept/start同事务；尚未挂载 | [T07 SOURCE合同](workbench/tickets.md#跨团队本人接管wbint-t07-source) |
| WB-T07-Q1 | GET | `/api/tickets/{ticketId}/takeover-targets` | W（计划） | PLANNED／NOT_RUN：当前Ticket原读权下本人实际有效组；尚未挂载 | [T07 SOURCE合同](workbench/tickets.md#跨团队本人接管wbint-t07-source) |
| WB-T07-Q2 | GET | `/api/tickets/{ticketId}/takeover/commands/{commandId}` | W（计划） | PLANNED／NOT_RUN：原UUID及专用用途的最小Ticket安全核对；尚未挂载 | [T07 SOURCE合同](workbench/tickets.md#跨团队本人接管wbint-t07-source) |
| R01 | GET | `/api/manual-reviews` | W | 已实现：待复核 | [复核](workbench/manual-reviews.md) |
| R02 | GET | `/api/manual-reviews/{reviewId}` | W | 已实现：复核详情 | [复核](workbench/manual-reviews.md) |
| R03 | POST | `/api/manual-reviews/{reviewId}/resolve` | W | 已实现：人工结论 | [复核](workbench/manual-reviews.md) |
| R04 | GET | `/api/contact-journeys/{journeyId}` | W | 已实现：Journey | [复核](workbench/manual-reviews.md) |
| R05 | GET | `/api/contact-journeys/{journeyId}/legs` | W | 已实现：渠道链 | [复核](workbench/manual-reviews.md) |
| R06 | GET | `/api/contact-journeys/{journeyId}/decisions` | W | 已实现：确定性判定 | [复核](workbench/manual-reviews.md) |
| R07 | GET | `/api/manual-reviews/{reviewId}/commands/{commandId}` | W | 已实现、默认关闭：当前Review授权/原UUID只读核对 | [同事项复核](workbench/manual-reviews.md#同事项复核与恢复wbint-t14) |
| I01 | GET | `/api/incident-candidates` | W | 已实现：候选列表 | [公共故障](workbench/incidents.md) |
| I02 | GET | `/api/incident-candidates/{candidateId}` | W | 已实现：候选详情 | [公共故障](workbench/incidents.md) |
| I03 | POST | `/api/incident-candidates/{candidateId}/start-review` | W | 已实现：开始复核 | [公共故障](workbench/incidents.md) |
| I04 | POST | `/api/incident-candidates/{candidateId}/reject` | W | 已实现：拒绝候选 | [公共故障](workbench/incidents.md) |
| I05 | POST | `/api/incident-candidates/{candidateId}/confirm` | W | 已实现：人工确认 | [公共故障](workbench/incidents.md) |
| I25 | GET | `/api/incident-candidates/{candidateId}/commands/{commandId}` | W | 已实现、默认关闭：当前 actor/exact Candidate 的原 UUID 安全回执核对 | [公共故障](workbench/incidents.md) |
| I06 | GET | `/api/incidents` | W | 已实现：聚合列表 | [公共故障](workbench/incidents.md) |
| I07 | GET | `/api/incidents/{incidentId}` | W | 已实现：聚合详情 | [公共故障](workbench/incidents.md) |
| I08 | GET | `/api/incidents/{incidentId}/events` | W | 已实现：事件 | [公共故障](workbench/incidents.md) |
| I09 | GET | `/api/incidents/{incidentId}/reports` | W | 已实现：关联报修 | [公共故障](workbench/incidents.md) |
| I10 | GET | `/api/incidents/{incidentId}/linkable-reports` | W | 已实现：可关联来源 | [公共故障](workbench/incidents.md) |
| I11 | GET | `/api/incidents/{incidentId}/subscriptions` | W | 已实现：订阅 | [公共故障](workbench/incidents.md) |
| I12 | GET | `/api/incidents/{incidentId}/notifications` | W | 已实现：通知投递 | [公共故障](workbench/incidents.md) |
| I13 | GET | `/api/incidents/{incidentId}/direct-destinations` | W | 已实现：ADMIN定向候选 | [公共故障](workbench/incidents.md) |
| I14 | GET | `/api/incidents/{incidentId}/subscriptions/{subscriptionId}/direct-destinations` | W | 已实现：单订阅定向候选 | [公共故障](workbench/incidents.md) |
| I15 | POST | `/api/incidents/{incidentId}/start-investigating` | W | 已实现：开始调查 | [公共故障](workbench/incidents.md) |
| I16 | POST | `/api/incidents/{incidentId}/correct-scope` | W | 已实现：修正范围 | [公共故障](workbench/incidents.md) |
| I17 | POST | `/api/incidents/{incidentId}/primary-ticket` | W | 已实现：主工单 | [公共故障](workbench/incidents.md) |
| I18 | POST | `/api/incidents/{incidentId}/reports/link` | W | 已实现：关联报修 | [公共故障](workbench/incidents.md) |
| I19 | POST | `/api/incidents/{incidentId}/reports/{reportId}/unlink` | W | 已实现：解除关联 | [公共故障](workbench/incidents.md) |
| I20 | POST | `/api/incidents/{incidentId}/reports/{reportId}/mark-recovered` | W | 已实现：个人恢复 | [公共故障](workbench/incidents.md) |
| I21 | POST | `/api/incidents/{incidentId}/subscriptions/{subscriptionId}/pause` | W | 已实现：暂停订阅 | [公共故障](workbench/incidents.md) |
| I22 | POST | `/api/incidents/{incidentId}/subscriptions/{subscriptionId}/resume` | W | 已实现：恢复订阅 | [公共故障](workbench/incidents.md) |
| I23 | POST | `/api/incidents/{incidentId}/resolve` | W | 已实现：解决 | [公共故障](workbench/incidents.md) |
| I24 | POST | `/api/incidents/{incidentId}/close` | W | 已实现：关闭 | [公共故障](workbench/incidents.md) |
| I26 | GET | `/api/incidents/{incidentId}/commands/{commandId}` | W | 已挂载、默认关闭：当前主体/父与原动作用途的安全只读核对；原UUID/当前原动作与子目标权限，沿原ledger | [公共故障](workbench/incidents.md) |
| B01 | GET | `/api/workbench/board` | W | 已实现：WEB01看板 | [看板](workbench/board.md) |
| B02 | GET | `/api/workbench/items/{kind}/{id}` | W | 已实现：WEB01详情 | [看板](workbench/board.md) |

## 成员与Reporter REST

| ID | 方法 | 完整路径 | 宿主 | 状态 / 用途 | 契约文档 |
| --- | --- | --- | --- | --- | --- |
| M01 | GET | `/api/yixiaoxiu/bootstrap` | M / W扩展 | 已实现：成员自助能力 | [自助](member/self-service.md) |
| M02 | GET | `/api/yixiaoxiu/service-catalog` | M / W扩展 | 已实现：授权读写成员目录选择 | [自助](member/self-service.md) |
| M03 | GET | `/api/yixiaoxiu/my-reports` | M / W扩展 | 已实现：本人Web/Bot报修 | [自助](member/self-service.md) |
| M04 | GET | `/api/yixiaoxiu/requests/{requestRef}` | M / W扩展 | 已实现：Web详情/304 | [自助](member/self-service.md) |
| M05 | GET | `/api/yixiaoxiu/requests/{requestRef}/timeline` | M / W扩展 | 已实现：时间线 | [自助](member/self-service.md) |
| M06 | POST | `/api/yixiaoxiu/requests` | M / W扩展 | 已实现：先受理/202 | [自助](member/self-service.md) |
| M07 | POST | `/api/yixiaoxiu/requests/{requestRef}/supplements` | M / W扩展 | 已实现：补充/202 | [自助](member/self-service.md) |
| M08 | GET | `/api/yixiaoxiu/commands/{clientCommandId}` | M / W扩展 | 已实现：本人命令回执 | [自助](member/self-service.md) |
| M09 | POST | `/wecom/yixiaoxiu/logout` | M/O/W按profile | 已实现：JSON或OAuth-only HTML | [自助](member/self-service.md)、[认证差异](platform/auth-health.md) |
| E01 | GET | `/api/reporter/member/session` | M/O/W成员扩展 | 已实现：成员认证状态 | [Reporter](member/reporter-access.md) |
| E02 | GET | `/api/reporter/bootstrap` | 成员或W legacy | 已实现：依策略返回不同DTO | [Reporter](member/reporter-access.md) |
| E03 | POST | `/api/reporter/member-entry/prepare` | 成员扩展 | 已实现：旧卡片浏览器继续入口 | [Reporter](member/reporter-access.md) |
| E04 | GET | `/api/reporter/tickets/{publicRef}` | 成员或W legacy | 已实现：本人/绑定进度；T25核实MANUAL独立READ，T21仅Bot可加feedback_context | [Reporter](member/reporter-access.md)、[App](workbench/app-notifications.md)、[Bot反馈](member/bot-feedback-design.md) |
| E05 | GET | `/api/reporter/tickets/{publicRef}/timeline` | 成员或W legacy | 已实现：公开时间线 | [Reporter](member/reporter-access.md) |
| E06 | POST | `/api/reporter/logout` | 成员或W legacy | 已实现：清对应访问会话 | [Reporter](member/reporter-access.md) |
| E07 | POST | `/api/reporter/access/exchange` | W legacy / 成员扩展 | 条件兼容：旧Grant；成员模式403 | [Reporter](member/reporter-access.md) |
| E08 | GET | `/api/reporter/feedback/bootstrap` | M成员写扩展 | T21已实现，默认关闭：当前WRITE/CSRF | [Bot反馈](member/bot-feedback-design.md) |
| E09 | GET | `/api/reporter/feedback/recovery` | M成员写扩展 | T21已实现：当前Bot独立恢复scope；raw默认关闭，不依赖Web MY_REPORTS | [Bot反馈](member/bot-feedback-design.md) |
| E10 | POST | `/api/reporter/tickets/{publicRef}/feedback` | M成员写扩展 | T21已实现，默认关闭：原Bot本人明确仍未解决 | [Bot反馈](member/bot-feedback-design.md) |
| E11 | GET | `/api/reporter/tickets/{publicRef}/feedback/commands/{clientCommandId}` | M成员写扩展 | T21已实现：当前Bot本人READ下原用途UUID安全核对，与新WRITE分开 | [Bot反馈](member/bot-feedback-design.md) |

## SSE、认证与健康

| ID | 方法 | 完整路径 | 宿主 | 状态 / 协议 | 契约文档 |
| --- | --- | --- | --- | --- | --- |
| S01 | GET | `/api/realtime/events` | W | 已实现：SSE text/event-stream | [实时](platform/realtime.md) |
| A01 | GET | `/workbench/login` | W，员工auth挂载 | 已实现：302登录 | [认证](platform/auth-health.md) |
| A02 | GET | `/workbench/callback` | 同上 | 已实现：code/state→303 | [认证](platform/auth-health.md) |
| A03 | POST | `/workbench/logout` | 同上 | 已实现：JSON退出 | [认证](platform/auth-health.md) |
| A04 | GET | `/wecom/yixiaoxiu/login` | O/M/W按profile | 已实现：302成员OAuth | [认证](platform/auth-health.md) |
| A05 | GET | `/wecom/yixiaoxiu/callback` | 同上 | 已实现：code/state→303 | [认证](platform/auth-health.md) |
| H01 | GET | `/health/live` | W / O/M替代server | 已实现：不同宿主不同DTO | [健康](platform/auth-health.md) |
| H02 | GET | `/health/ready` | W | 已实现：注入readiness provider | [健康](platform/auth-health.md) |
| H03 | GET | `/health/metrics` | W | 已实现：JSON metrics | [健康](platform/auth-health.md) |
| H04 | GET | `/healthz` | P1 foundation | 已实现：历史独立健康 | [健康](platform/auth-health.md) |

## P1历史独立REST（非当前W/M别名）

| ID | 方法 | 完整路径 | 宿主 | 状态 / 用途 | 契约文档 |
| --- | --- | --- | --- | --- | --- |
| P01 | GET | `/api/pilot/work` | P | 已实现：历史工作清单 | [P1契约](platform/auth-health.md) |
| P02 | GET | `/api/pilot/tickets/{ticketId}` | P | 已实现：历史Ticket详情 | [P1契约](platform/auth-health.md) |
| P03 | POST | `/api/pilot/tickets/{ticketId}/actions/queue` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P04 | POST | `/api/pilot/tickets/{ticketId}/actions/accept` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P05 | POST | `/api/pilot/tickets/{ticketId}/actions/start` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P06 | POST | `/api/pilot/tickets/{ticketId}/actions/request-information` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P07 | POST | `/api/pilot/tickets/{ticketId}/actions/resume` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P08 | POST | `/api/pilot/tickets/{ticketId}/actions/wait-vendor` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P09 | POST | `/api/pilot/tickets/{ticketId}/actions/resolve` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P10 | POST | `/api/pilot/tickets/{ticketId}/actions/confirm` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P11 | POST | `/api/pilot/tickets/{ticketId}/actions/reopen` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P12 | POST | `/api/pilot/tickets/{ticketId}/actions/cancel` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |
| P13 | POST | `/api/pilot/tickets/{ticketId}/actions/add-note` | P | 已实现：历史动作 | [P1契约](platform/auth-health.md) |

## HTML、重定向与静态入口（客户端预期GET）

静态W/P2分发的method限制见[平台说明](platform/auth-health.md)。资源路径范围按当前编译/白名单分发，不是任意文件下载服务。

| ID | 方法 | 完整路径 / 范围 | 宿主 | 状态 / 用途 | 契约文档 |
| --- | --- | --- | --- | --- | --- |
| U01 | GET | `/workbench`、`/workbench/` | W | 页面：会话 | [平台](platform/auth-health.md) |
| U02 | GET | `/workbench/lifecycle` | W | 页面：工单/复核 | [平台](platform/auth-health.md) |
| U03 | GET | `/workbench/incidents` | W | 页面：公共故障 | [平台](platform/auth-health.md) |
| U04 | GET | `/workbench/app`、`/workbench/app/` | W | 页面：React内部认证 | [看板](workbench/board.md) |
| U05 | GET | `/workbench/app/items/{kind}/{id}` | W | 页面：React详情deep link | [平台](platform/auth-health.md) |
| UC01 | GET | `/workbench/app/conversations` | W | 正式集中会话页，默认关闭、先验身份 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| UC02 | GET | `/workbench/app/conversations/{sessionId}` | W | 正式主题deep link，默认关闭、先验身份 | [集中会话](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| U06 | GET | `/workbench/app/assets/{buildAsset}.js`、`/workbench/app/assets/{buildAsset}.css` | W | 静态：inventory成员 | [平台](platform/auth-health.md) |
| U07 | GET | `/static/workbench/workbench.js`、`/static/workbench/workbench.css`、`/static/workbench/workbench-state.mjs`、`/static/workbench/time-display.mjs` | W | 静态：会话 | [平台](platform/auth-health.md) |
| U08 | GET | `/static/workbench/lifecycle.js`、`/static/workbench/lifecycle.css`、`/static/workbench/incidents.js` | W | 静态：生命周期/公共故障 | [平台](platform/auth-health.md) |
| U09 | GET | `/wecom/yixiaoxiu/` | O/M/W按profile | 页面：认证/自助主页 | [平台](platform/auth-health.md) |
| U10 | GET | `/wecom/yixiaoxiu/reports` | M/W扩展 | 页面：我的报修 | [自助](member/self-service.md) |
| U11 | GET | `/wecom/yixiaoxiu/reports/new` | M/W扩展 | 页面：新报修 | [自助](member/self-service.md) |
| U12 | GET | `/wecom/yixiaoxiu/reports/{requestRef}` | M/W扩展 | 页面：报修详情 | [自助](member/self-service.md) |
| U13 | GET | `/wecom/yixiaoxiu/continue/{entryRef}` | 成员扩展 | 一次性继续入口/OAuth/303 | [Reporter](member/reporter-access.md) |
| U14 | GET | `/wecom/yixiaoxiu/tickets/{publicRef}` | 成员扩展 | 页面：卡片工单 | [Reporter](member/reporter-access.md) |
| U15 | GET | `/wecom/yixiaoxiu/self-service.js`、`/wecom/yixiaoxiu/self-service.css` | M/W扩展 | 静态：自助 | [平台](platform/auth-health.md) |
| U16 | GET | `/reporter/`、`/reporter/open` | Reporter | 页面：只读进度 | [Reporter](member/reporter-access.md) |
| U17 | GET | `/reporter/reporter.js`、`/reporter/reporter.css` | Reporter | 静态：Reporter | [平台](platform/auth-health.md) |
| U18 | GET | `/`、`/static/pilot-workbench.js`、`/static/pilot-workbench.css` | P | 历史页面/资源 | [平台](platform/auth-health.md) |
| U19 | GET | `/reporter/bot-feedback.js` | M成员写扩展 | T21默认关闭：302到当前Vite第三entry的编译资源 | [Bot反馈](member/bot-feedback-design.md) |
| U20 | GET | `/reporter/feedback-assets/{buildAsset}.js` | M成员写扩展 | T21闭合manifest JS graph；未知404，无源码回退 | [Bot反馈](member/bot-feedback-design.md) |

## 已保存附件（WBINT-T16，默认关闭）

| 方法 | 完整路径 | 宿主与状态 | 契约文档 |
| --- | --- | --- | --- |
| GET | `/api/workbench/items/{kind}/{id}/attachments` | W扩展，获权元信息；无Store／开关关闭明确不可用 | [附件](workbench/attachments.md) |
| GET | `/api/attachments/{attachmentRef}?kind={kind}&id={id}` | W扩展，受控PNG/JPEG下载；显式注入受信加密Store | [附件](workbench/attachments.md) |

基础会话宿主的旧通配附件路径仍是不可用；上述精确路由仅由P2016附件扩展处理，没有上传、登记或现取Provider能力。

## 明确拒绝与设计路径

WBINT-T37以下三条已完成本地定向验证；新view/write默认关闭，旧ACK独立核当前Ticket READ。历史RED及各被测对象见[共享跟进时间](workbench/follow-up-schedules.md)与本票执行记录。

| METHOD | PATH | 状态 | 合同 |
| --- | --- | --- | --- |
| GET | `/api/tickets/{ticketId}/follow-up-schedule` | W，当前获权安排和最近20条历史 | [共享安排](workbench/follow-up-schedules.md) |
| POST | `/api/tickets/{ticketId}/follow-up-schedule` | W，显式SET/CANCEL，两个版本与原UUID | [维护命令](workbench/follow-up-schedules.md#输入并发与幂等) |
| GET | `/api/tickets/{ticketId}/follow-up-schedule/commands/{commandId}` | W，当前READ下的原主体／用途安全终态 | [原命令核对](workbench/follow-up-schedules.md#输出卡片与恢复) |

| 方法 | 完整路径 | 状态 | 去哪里找 |
| --- | --- | --- | --- |
| GET | `/api/attachments/*` | 未匹配附件扩展的路径，基础W仍显式404不可用 | [附件](workbench/attachments.md)／[会话](workbench/conversations.md) |
| POST | `/api/pilot/tickets/{ticketId}/actions/auto-close` | P显式403 | [平台](platform/auth-health.md) |
| POST | `/api/tickets/{ticketId}/auto-close` | 无HTTP动作 | [工单](workbench/tickets.md) |
| POST | `/api/incident-candidates/{candidateId}/expire` | 无HTTP动作 | [公共故障](workbench/incidents.md) |
| POST | `/internal/v1/intakes/wecom` | 仅设计，未挂载 | [设计差异](design-and-gaps.md) |
| POST | `/internal/v1/messages/{messageId}/media` | 仅设计，未挂载 | [设计差异](design-and-gaps.md) |
| POST | `/internal/v1/ai/triage` | 仅设计，未挂载 | [设计差异](design-and-gaps.md) |
| POST | `/internal/v1/wecom/card-actions` | 仅设计，未挂载 | [设计差异](design-and-gaps.md) |
| POST | `/api/yixiaoxiu/requests/{requestRef}/feedback` | WBINT-T20候选合同SOURCE_READY，未挂载／未验证 | [Web反馈候选](member/web-feedback-design.md) |
| GET | `/api/yixiaoxiu/requests/{requestRef}/feedback/commands/{clientCommandId}` | WBINT-T20原命令只读恢复候选，未挂载／未验证 | [Web反馈候选](member/web-feedback-design.md) |
| POST | `/api/v1/tickets/{ticketId}/actions/accept` | 仅设计，未挂载 | [当前工单](workbench/tickets.md) |
| POST | `/api/v1/tickets/{ticketId}/actions/start` | 仅设计，未挂载 | [当前工单](workbench/tickets.md) |
| POST | `/api/v1/tickets/{ticketId}/actions/request-information` | 仅设计，未挂载 | [当前工单](workbench/tickets.md) |
| POST | `/api/v1/tickets/{ticketId}/actions/resolve` | 仅设计，未挂载 | [当前工单](workbench/tickets.md) |
| POST | `/api/v1/tickets/{ticketId}/actions/confirm` | 仅设计，未挂载 | [当前工单](workbench/tickets.md) |
| POST | `/api/v1/tickets/{ticketId}/actions/reopen` | 仅设计，未挂载 | [当前工单](workbench/tickets.md) |
| GET | `/metrics` | 早期设计示例，未挂载 | [当前health/metrics](platform/auth-health.md) |
| GET | `/api/workbench/board?scope=related` | W，当前READ交集处理／沟通／显式关注并集，规范去重后分页；默认关闭 | [当前关注合同](workbench/follow-current-contract.md) |
| POST | `/api/workbench/items/{kind}/{id}/follow` | W，当前READ、原UUID／canonical／opaque版本，显式个人关注／取消；默认关闭 | [当前关注输入](workbench/follow-current-contract.md#当前输入输出与-http) |
| GET | `/api/workbench/items/{kind}/{id}/follow/commands/{commandId}` | W，当前READ下原主体／原请求父项／用途的UNKNOWN、FAILED或COMMITTED；默认关闭 | [安全核对](workbench/follow-current-contract.md) |

后端外部Provider的完整URL见 [外部服务索引](integrations/external-services.md)，群内 @Bot 的 `aibot_msg_callback`、chatid及群名称实测见 [WebSocket消息回调](integrations/wecom-message-callback.md)，无REST的Port/事件见 [内部接口索引](integrations/internal-ports.md)。模拟预览和设计不计为当前业务接口。

## 工作人员完工（WBINT-T11，默认关闭）

| 方法 | 完整路径 | 宿主与用途 | 契约文档 |
| --- | --- | --- | --- |
| POST | `/api/tickets/{ticketId}/complete` | W，当前实际处理人的独立过程/已确认摘要，一次原子完工 | [完工](workbench/tickets.md#工作人员完工wbint-t11) |
| GET | `/api/tickets/{ticketId}/completion/commands/{commandId}` | W，当前读权限下按原主体/用途/UUID只读核对安全终态；另需raw recovery | [完工核对](workbench/tickets.md#工作人员完工wbint-t11) |

内部持久承诺reader不属于REST；默认false的旧Pilot不能执行或广告complete，旧resolve/confirm语义保留。

## WBINT-T08 撤销未开始派工（已实现，默认关闭）

| 方法 | 完整路径 | 当前用途 | 合同 |
| --- | --- | --- | --- |
| POST | `/api/tickets/{ticketId}/unassign` | 获权 ADMIN/DISPATCHER 撤销当前未开始派工；明确内部原因；默认保留沟通，显式所选交接同事务 | [撤派合同](workbench/tickets.md#wbint-t08-撤销未开始派工) |
| GET | `/api/tickets/{ticketId}/unassign/commands/{commandId}` | 当前 Ticket 读权和原 principal/用途/UUID 的最小终态核对；独立 T08 consumer 启用即可，raw recovery 可关闭 | [安全核对](workbench/tickets.md#wbint-t08-撤销未开始派工) |
| GET | `/api/tickets/{ticketId}/unassign/communication-targets` | 当前合法动作的活动内部沟通目标；可用 `target_principal_id=UUID` 验证保存的目标；结果至多 100，不授予 Control 写权 | [目标读取](workbench/tickets.md#wbint-t08-撤销未开始派工) |

三入口和正式管理端消费已完成本机合成隔离 PG、真实 loopback HTTP、生产 bundle 浏览器及相关兼容验证。独立 `ticketUnassignEnabled` 默认 false；准确被测源码、原七项、原始 FAIL/PASS、制品与资源证据见[本票执行](../../plans/admin-workbench-integration/execution/t08.md)。本地验证不构成真实外发、部署或 Gate 授权。

## WBINT-T12 同事接管并工作人员完工（默认关闭）

| 方法 | 完整路径 | 当前用途 | 合同 |
| --- | --- | --- | --- |
| POST | `/api/tickets/{ticketId}/takeover-and-complete` | 当前获权同事、真实 SELF 组与逐 Session 选择，一次原子接管并工作人员关闭 | [复合完工](workbench/tickets.md#同事接管并工作人员完工wbint-t12默认关闭) |
| GET | `/api/tickets/{ticketId}/takeover-completion-targets` | 当前合法动作的 SELF 活动组；可选 resolver_team_id独立核验，展示最多100 | [SELF 候选](workbench/tickets.md#同事接管并工作人员完工wbint-t12默认关闭) |
| GET | `/api/tickets/{ticketId}/takeover-completion/commands/{commandId}` | 当前 Ticket READ及原 actor/用途/UUID 的安全终态，只读；另需 raw recovery | [原操作核对](workbench/tickets.md#同事接管并工作人员完工wbint-t12默认关闭) |

独立 `ticketTakeoverCompletionEnabled` 默认 false，复用039/040、无新 SQL。已实现并有隔离公开 PG/HTTP/生产 bundle 验证；最终整票检查、原始 FAIL/PASS、两轴审查和清理以[本票执行](../../plans/admin-workbench-integration/execution/t12.md)为准。本地验证不授权外发、部署或 Gate。

## Incident 分路投递控制（T33）

| ID | METHOD | PATH | 宿主 | 当前状态 | 详情 |
| --- | --- | --- | --- | --- | --- |
| IDC01 | GET | /api/incidents/{incidentId}/notifications/{deliveryId}/control | W | 当前精确READ/绑定与独立用途；闭合JSON8及authority Header | [投递控制](workbench/incident-delivery-control.md) |
| IDC02 | POST | /api/incidents/{incidentId}/notifications/{deliveryId}/retry | W | 已实现、默认关闭；确定未应用/独立RETRY/v2尝试 | [投递控制](workbench/incident-delivery-control.md) |
| IDC03 | POST | /api/incidents/{incidentId}/notifications/{deliveryId}/reconcile | W | 已实现、默认关闭；ADMIN/独立RECONCILE/明确结论 | [投递控制](workbench/incident-delivery-control.md) |
| IDC04 | GET | /api/incidents/{incidentId}/notification-commands/{commandId} | W | 当前原动作用途安全只读原UUID；关闭控制不删除事实 | [投递控制](workbench/incident-delivery-control.md) |
