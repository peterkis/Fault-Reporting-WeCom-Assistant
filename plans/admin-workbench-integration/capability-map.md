---
document_id: WBINT-CAPABILITIES
status: PLAN_CONFIRMED
verified_on: 2026-10-07
---

# 能力与接口映射

返回 [计划入口](README.md) · [实施任务](implementation-plan.md) · [验收矩阵](acceptance-matrix.md)

## 状态与宿主

`EXISTING` 表示本次核对的实际后端入口，仍受装配模式、开关和授权限制；`LOCAL_INCREMENT` 表示当前工作区后继实现；`BACKEND_REQUIRED` 表示新目标缺口。下文所有 `PROPOSED_PATH` 都是供任务合同定稿的候选，当前不能调用，不能登记为已挂载路径。

宿主 W 是同源工作人员工作台，宿主 M 是成员／Reporter 入口；定义见[公共约定](../../docs/api/conventions.md)。UI 路由不是 REST，内部 Port 和 Gateway WSS 回调不是浏览器接口。

## 页面、业务与当前覆盖

| 页面／业务 | 当前真实能力及入口 | 目标差异／前置任务 |
| --- | --- | --- |
| 登录与用户会话 | W 的登录／callback／退出链；`GET /api/lifecycle/bootstrap`、`GET /api/workbench/bootstrap`，见[平台入口](../../docs/api/platform/auth-health.md) | 沿用认证；按对象补真实操作权限／版本上下文，不能从 roles 在浏览器推断全部动作。00/01 |
| 三列看板／列表／详情 | React 已调用 `GET /api/workbench/board`、`GET /api/workbench/items/{kind}/{id}`；每列分页、只读详情，见[看板](../../docs/api/workbench/board.md) | 完整与我有关、搜索、提醒、动作、拖动未接；同一 Ticket 的复核不重复计卡片。01/12–15 |
| 人工复核 | `GET /api/manual-reviews`、`GET /api/manual-reviews/{reviewId}`、Journey／legs／decisions 查询、`POST .../resolve`，见[复核接口](../../docs/api/workbench/manual-reviews.md) | React 未接；普通 resolve 不是“确认报修并开始处理”。补复合用例并保持材料修订 fence；不必为了统一 UI 新建第二份受理。04 |
| 一步处理／双责任 | 旧 `POST /api/tickets/{ticketId}/accept`、`/start` 和 `/api/conversations/{sessionId}/takeover-and-accept-ticket`；T04 `LOCAL_INCREMENT` 的 `/take-and-start`、`/accept-for-later` 仅无真实会话、当前有效组本人承接 | T04 独立默认 false、039 显式迁移、一次事务与轮次；T05 真会话、完整同事接管／接管关闭仍是缺口。02；[T04 合同/证据](execution/t04.md) |
| 派单／转派／跨团队接管 | `GET .../eligible-principals`、`GET .../responsibility`、`POST .../transfer` | 当前 transfer 不等于全部 AssignTicket／TakeOver，终态及目标团队约束需修订；补本人／有效组原子交接及限定可见范围。02 |
| 撤派／停止退回 | 无 Ticket unassign／return HTTP；Conversation `/release` 只释放沟通责任 | 两类显式命令、合法状态、未完工作和交接；默认保留沟通责任。02 |
| 等待／恢复／取消／内部记录 | 现有 `/request-information`、`/wait-vendor`、`/resume`、`/cancel`、`/notes` | React 未接；显示真实 allowed actions，不用取消模拟撤派；内部记录不默认外发或清待跟进。02/03/12 |
| 完工关闭 | 旧 `/resolve` 到 RESOLVED，`/confirm` 到 CLOSED | 当前角色／状态与目标不同；旧 note＋external_visible 不能独立表达内部过程和对外结果。补 complete 与 takeover-and-complete，不能浏览器串联旧命令。03 |
| 接单／交接链 | `GET /api/tickets/{ticketId}/events` 返回裁剪事件；`GET .../responsibility` 是当前责任 | 缺完整操作者、前后人／组、处理轮次的安全链投影，需有界查询。02/03 |
| 工作人员新建报修 | M 的 `POST /api/yixiaoxiu/requests` 绑定当前 OAuth 本人 | 不可代用本人接口冒充 Reporter。新增 W 代录、真实 Reporter／操作者、目录候选、手填降级及“由我处理”。05 |
| Reporter 未解决重开 | Web `GET /api/yixiaoxiu/requests/{requestRef}`；Bot `GET /api/reporter/tickets/{publicRef}`，各有 timeline | 本人 feedback／reopen HTTP 未实现；旧 closure 内部路径不证明已挂载。补两种绑定的同一重开用例，新轮次重新承接。06 |
| 集中会话／人工回复 | 会话 GET list/detail/items，takeover／transfer／release、read-cursor、messages／internal-notes、Delivery 控制，见[会话接口](../../docs/api/workbench/conversations.md) | React 会话页是占位；回复 202 仅说明已受理发送。群按参与者和服务主题隔离，无会话网页不显示虚构发送能力。07 |
| 已有报修资料／附件 | 安全文字资料、附件元信息；`GET /api/attachments/*` 当前明确 404 | 补获权且有界的人工读取／下载合同；StoragePort、既有采集是否足够先核对，不接 OCR／模型。04 |
| 来源群显示／维护 | `LOCAL_INCREMENT`：ADMIN 名称登记／修改，GET directory、`POST /api/workbench/source-groups/{groupRef}/name`；板／详情来源字段 | [ADR0030／接口](../../docs/api/workbench/source-groups-design.md)，默认 false；不是群名官方查询、不是已部署。将已有增量纳入基线，补设置页检索，不重做核心。00/15 |
| 按来源的工单通知 | 已有 Ticket projector／Delivery 和部分发送器；当前 Web 为 WEB_APP_ONLY，group closure 固定模板 | ADR0023 的所有里程碑、Bot 私聊＋来源群强 @ 双路、H5／已核实代录应用消息尚未完整。补来源绑定／策略／发送适配，权限与真实强 @ 后续独立验证。08 |
| 公共故障 | candidate 人工 review/reject/confirm；Incident 查询、关联／解除、investigating／scope／primary／recovered／resolve／close、subscription 控制，见[Incident](../../docs/api/workbench/incidents.md) | React 是占位；先接现有，补负责人转交、内部记录、安全进展发布及必要 owner／count 投影。09/10 |
| 通知异常 | Ticket、Conversation、Incident 各有 notifications／deliveries 查询；Ticket 和 Conversation 有特定 retry／reconcile | 缺完整跨域有界队列及 Incident 专用控制，不能用会话授权重发无会话 Incident。UNKNOWN 必须核对。11 |
| 个人未读／关注／补充跟进 | 仅会话 read-cursor 已实现；现有 mine 主要为 Ticket assignee | 缺事项级最新资料已读、显式关注、团队补充待跟进及共享预约；这些是独立关系／事实。12 |
| SSE／查看编辑提示／声音 | W `GET /api/realtime/events`；旧工作台使用，React 未接；没有可靠 presence | 授权事件用于失效与重读；补短暂活动、到期信号、跨标签声音去重，不从心跳推断编辑。13 |
| 授权全局搜索／合法拖动／设置 | 当前搜索、与我有关禁用；拖动未接；设置是占位 | 服务端搜索不能只过滤当前页；拖动映射真实命令。设置仅个人偏好与获权群名等现有项。14/15 |

源码主入口：[React client](../../web/admin-workbench/src/api/client.ts)、[App](../../web/admin-workbench/src/app/App.tsx)、[只读 HTTP](../../src/web01-workbench-http.mts)、[只读查询](../../src/web01-workbench-query.mts)、[Ticket facade](../../src/p2-016-ticket-command-facade.mts)、[成员 HTTP](../../src/yxx-self-service-native-http.mts)、[Bot 本人 HTTP](../../src/p2-g2-yixiaoxiu-http.mts)。[原型](../../web/admin-workbench-prototype/README.md)只供视觉／交互参考，不能移植其合成状态逻辑作为真实业务。

## 待冻结的新 HTTP 合同

所有行为均先由 WBINT-00／对应任务冻结 JSON Schema、类型、宿主挂载、权限和测试，再连接页面。优先扩展既有合法合同，不为了风格统一重命名所有 API。

| 状态 | METHOD + 候选 PATH | 宿主／任务 | 合同必须表达 |
| --- | --- | --- | --- |
| PROPOSED_PATH | `GET /api/workbench/items/{kind}/{id}/command-context` | W／01 | 已授权主体、真实可执行动作、Ticket／Review／实际会话各自版本、有效目标引用、材料修订；独立于展示 DTO |
| LOCAL_INCREMENT | `POST /api/tickets/{ticketId}/take-and-start`、`/accept-for-later` | W／T04（02） | 仅无非 ENDED 真会话；当前有效组本人原子承接/开始、首次责任与轮次，默认关闭；[实际合同](../../docs/api/workbench/tickets.md)。T05 会话用例另行冻结 |
| PROPOSED_PATH | `POST /api/tickets/{ticketId}/assign`、`/takeover` | W／02 | 目标人／组、原责任版本、操作者权限；接管跨团队后目标组有效 |
| PROPOSED_PATH | `POST /api/tickets/{ticketId}/unassign`、`/return-to-dispatch` | W／02 | 未开始／已开始区分，原因、未完成说明、明确沟通交接；不增轮次 |
| PROPOSED_PATH | `POST /api/tickets/{ticketId}/complete`、`/takeover-and-complete` | W／03 | 内部过程、对外摘要、工作人员关闭依据、目标轮次；后一命令包括责任交接 |
| PROPOSED_PATH | `GET /api/tickets/{ticketId}/assignment-history` | W／03 | 首次承接、历次前后人／组／沟通对象、操作者、时间、轮次；分页与安全名称 |
| PROPOSED_PATH | `POST /api/manual-reviews/{reviewId}/resolve-and-start` | W／04 | 明确故障结论、Review 材料版本／修订、已关联或新最小 Ticket、两类版本和原子开始；其他结论仍用已有 resolve |
| PROPOSED_PATH | `GET /api/attachments/{attachmentRef}` | W／04 | 受控来源及关联对象授权，安全元数据与真实内容、大小／格式上限；现有通配 404 不代表已可用 |
| PROPOSED_PATH | `GET /api/workbench/reporter-candidates` | W／05 | 授权目录查询／受控快照，候选来源、可验证绑定和消息可达性；无同名猜绑定 |
| PROPOSED_PATH | `POST /api/workbench/reports` | W／05 | 实际 Reporter、代录 Principal、电话／现场来源、描述／位置、可核实身份或手填、提交／本人处理模式 |
| PROPOSED_PATH | `POST /api/yixiaoxiu/requests/{requestRef}/feedback` | M／06 | Web 原绑定→原 Ticket；明确 STILL_UNRESOLVED、完工轮次和最新版本、本人及写 profile 权限 |
| PROPOSED_PATH | `POST /api/reporter/tickets/{publicRef}/feedback` | M／06 | Bot 原绑定／账号范围→原 Ticket；与 Web 共用应用用例，不能用旧 Grant 获得成员写权 |
| PROPOSED_PATH | `POST /api/incidents/{incidentId}/transfer-owner`、`/internal-notes`、`/publish-update` | W／10 | Incident 自身授权／版本；新 owner 的有效团队、内部受众与显式安全发布内容、独立事件与意图 |
| PROPOSED_PATH | `GET /api/workbench/notification-exceptions` | W／11 | 各域先授权再分页的失败／待核对队列、业务 kind/ref、每路投递和允许动作；不披露原始身份 |
| PROPOSED_PATH | `POST /api/incidents/{incidentId}/deliveries/{deliveryId}/retry`、`/reconcile` | W／11 | 该 Incident 的投递归属、独立控制权限和状态条件，不复用 Conversation 的授权路径 |
| PROPOSED_PATH | `POST /api/workbench/items/{kind}/{id}/read-position`、`/follow` | W／12 | 当前本人实际阅读位置、显式关注；单调序列、个人关系版本，不改变 Ticket 责任 |
| PROPOSED_PATH | `POST /api/tickets/{ticketId}/supplement-follow-up`、`/follow-up-schedule` | W／12 | 精确目标补充修订的处置、共享时间／取消、操作者权限及对应版本；不是个人 read-cursor |
| PROPOSED_PATH | `POST /api/workbench/items/{kind}/{id}/presence` | W／13 | 获权浏览器的查看／编辑短暂活动、租期／释放；不领取或锁单 |
| PROPOSED_PATH | `GET /api/workbench/search` | W／14 | 全部获权范围内的编号／描述／Reporter 快照／位置，稳定游标和类型标识；不等于当前页过滤 |

草稿安全存储和偏好存储的具体 HTTP／本地协议在 01／15 定稿；没有把未决定的持久化方案列成已存在服务。凡新增 GET/POST 都必须登记错误码、上限、认证和失败恢复；上表的业务语义与任务依赖已确认，候选 URI 和完整字段不是现有合同。

## 标识、版本与结果边界

| 数据 | 必须保持的区别 |
| --- | --- |
| 事项 | `kind + id`；Ticket UUID 与未建单 Review UUID 不互换，Review 关联 Ticket 后不重复计数 |
| 本人详情 | Web `requestRef` 与 Bot `publicRef` 虽同为 32 位 opaque ref，但来源绑定、API 不同；my-reports 是 `{kind,ref}`，不是统一 request_ref |
| 继续入口 | `entryRef` 是短期继续令牌，不能当 Ticket UUID、Web requestRef、Bot publicRef 或反馈授权 |
| 现有版本 | Ticket／Conversation 命令用安全整数；Review／Incident／来源群 row_version 用十进制 string；Web input_revision、SSE event_id 为 string。不能统一强转 number |
| 多对象命令 | 每个实际变更对象独立验权／验版本，同事务执行；If-Match 与 body 一致。保留沟通时不暗改 Session；不把 Ticket 版本当 Conversation 版本 |
| 本人反馈 | 来源辨别＋原绑定＋完工轮次＋当前 Ticket 版本；Web input_revision 不替代 Ticket 版本，不向成员暴露内部 Ticket UUID |
| 命令结果 | 请求已发出／服务端已提交／通知已入队／已确认发送／报修人已读各不相同 |
| 未知提交 | W 优先用现有 ledger 的同 UUID、原 payload 重放核对；不随刷新改版本生成新意图。M 已有 commands 查询，404 只表示当前未发现 |
| 内部／外部 | 内部过程、备注、交接原因、原始身份及未授权资料不进入 Reporter timeline、群摘要或外发模板 |

## 工单状态合同定稿要求

保留 NEW、QUEUED、ACCEPTED、IN_PROGRESS、WAITING_REQUESTER、WAITING_VENDOR、RESOLVED、CLOSED、REOPENED、CANCELLED，不创建三列同名数据库状态。

- 原子一步处理内部必须记录合法承接和开始动作／事件；新轮次必须有明确派工。不能直接 UPDATE status 绕过状态机。
- 未开始的撤派清除处理人并回到待安排；已重开的事项保留重开语义。已开始的停止退回保留当前轮次及已完成工作，再承接不创造新轮次。精确 old/new status 表在 02 冻结。
- 完工记录 STAFF_COMPLETED 依据，不能伪造 Reporter 确认。合法完工状态及等待状态的恢复规则在 03 明确；继承旧 RESOLVED 的真实标签，不批量改写旧记录／事件。
- 原 Reporter 反馈从合法完工轮次重开同一 Ticket，清除旧的当前处理责任、保留原组和上一轮处理人历史；不是复制 Ticket。多人／多标签不同命令对同一完工轮次不能创建两次重开。
- 转派／接管不是新轮次；取消不是退回；Incident 恢复不是个人 Ticket 完工。当前接口不支持的转换，必须先更改合同与状态机再开放页面。
