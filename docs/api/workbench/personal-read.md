# 个人阅读位置（WBINT-T35，已挂载、默认关闭）

W 宿主已装配个人阅读服务、HTTP handler 与正式管理端观察组件，独立 `workbenchPersonalReadEnabled` 默认 `false`。本地隔离证据按精确被测提交记录；接口实现不表示部署启用、真实身份授权、整组 WBINT-12 或 Gate 完成。来源：[T35 #90](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)、[WBINT-12](../../../plans/admin-workbench-integration/implementation-plan.md#wbint-12个人已读关注团队待跟进与共享预约)、[ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md)。当期对象、失败保留及收口范围见 [执行记录](../../../plans/admin-workbench-integration/execution/t35.md)。

## 入口与闭合合同

| METHOD + PATH | 输入 | 结果 |
| --- | --- | --- |
| `GET /api/workbench/items/{kind}/{id}/read-position` | kind=ticket/review/intake，UUID；仅 limit/cursor，默认50、最大100，未知或重复 query 400 | 闭合 Page，只读事务，无写副作用 |
| `POST /api/workbench/items/{kind}/{id}/read-position` | 无 query；JSON≤8192 bytes，仅 client_command_id/source_ref/revision | 闭合 ACK，只推进本人位置 |
| `GET /api/workbench/items/{kind}/{id}/read-position/commands/{commandId}` | UUID，无 query；当前主体、事项、来源及固定用途 | 闭合 UNKNOWN/COMMITTED 安全收据，无正文 |

POST 沿原认证和 `validateWriteRequest`：`Content-Type: application/json`，`Idempotency-Key` 与 body UUID 精确相同；Cookie 模式同源 Origin、非 cross-site、当前 CSRF。主体由认证推导，不接受 principal、角色、团队或任意 source_key。阅读不改 Ticket/Review 版本，没有它们的 If-Match；同 UUID 改意图409。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","source_ref":"web:11111111-1111-4111-8111-111111111111","revision":"2"}
```

四个冻结闭合 Schema 保持原字节：[Command](../../../contracts/workbench_personal_read_command.schema.json)、[Page](../../../contracts/workbench_personal_read_page.schema.json)、[ACK](../../../contracts/workbench_personal_read_acknowledgement.schema.json)、[Receipt](../../../contracts/workbench_personal_read_receipt.schema.json)。历史 title 的 PLANNED 标签不表示当前 handler 未实现。类型声明在 [contracts](../../../contracts/workbench_personal_read_contracts.d.ts)，实际服务和前端都保留运行时输入/响应守卫。revision 是正十进制 string，上限 signed BIGINT；未写行的 last_read_position/row_version 为 "0"。

Page 仅含 canonical_item、sources、next_cursor。每来源只有 source_key（真实 kind+Intake 派生的64hex锚点）、source_kind、last_read_position、latest_position、row_version、has_unread_material。latest_position 只是当前获权且保留材料的提示，不能自动作为写目标，有界页也不冒充全量未读计数。keyset 绑定当前主体、roles/teams 和原请求事项，权限/保留过滤先于 LIMIT。

ACK 仅含 ok/client_command_id/source_key/source_kind/last_read_position/row_version/replayed；Receipt 的 COMMITTED 只含安全 ACK。UNKNOWN 不能推断未提交。错误：400闭合字段/值/query；401认证；403Origin/CSRF/读权；404不存在、错误关联、过期或不可读材料；409改意图；413过大正文；415 Content-Type；503关闭/schema不可用。错误不返回 SQL、DSN、原始 Provider 内容、外部身份或正文。

## 真实来源与独立坐标

| 来源引用 | 权威位置 | 独立范围 |
| --- | --- | --- |
| channel:{ChannelMessage BIGINT} | service_intake_message.sequence_no 的 string | 每个真实 Intake/Leg，不能用全局 Message ID 或另一 Leg 序列 |
| web:{Submission UUID} | web_submission.input_revision | 同一 binding 的 Intake；不是 processed_revision |
| manual:{Intake UUID} | 经现有快照解码的 PHONE/ON_SITE 原文，固定 "1" | 不可变 MANUAL 来源；还需原 manual-report 开关，不制造 Session |
| Session 已渲染 Item | 原 Control 的实际 Item 序列、安全整数、cursor CAS | 独立 POST /api/conversations/{sessionId}/read-cursor，不写新表 |

服务从精确引用与 revision 派生真实来源，不能拿 Ticket 版本、来源 metadata 最大值或浏览器自报坐标代替。每次 page/perform/receipt 都验当前活动主体和原事项。Ticket 关联来源需真实 linked Journey、各 Intake/Journey 保留期与对应 Ticket 读权；Review 先重验原 Review，再沿真实 canonical 和其原 basis/后续 Leg 范围读源。WEB binding 未撤销且 binding/submission 均保留；BOT Message 保留；MANUAL 有合法原快照。旧 Review 失权或过期不能借可读 Ticket 恢复。

Review→Ticket 只是导航；principal+真实来源同一行、同一规范事项，不复制行或两卡计数。个人 read 不改 Core、双责任、判定、Ticket Event、团队待跟进。T34关注、T36处置、T37共享时间仍为各自明确命令的事实；本票没有伪造尚未交付的 T36 字段。

## 事务、047 与关闭

[047 SQL](../../../database/migrations/047_workbench_personal_read.sql) 和 [迁移器](../../../scripts/workbench-personal-read-migrate.mts) 已实现。迁移器要求031及042，防止042随后覆盖同一资源约束；支持默认 check 回滚、apply、同 checksum noop。检查 marker、个人表精确 PK 和 receipt 新 UUID 列，不声称覆盖所有约束漂移。旧031/042 SQL字节保持；本地应用不证明现场库已应用。

新 `pilot_ticket.personal_material_read_position` 只有 principal+source_kind+source_intake 主键、BIGINT position/row_version 与本地更新时间。原 ticket_command_receipt 增加 nullable source_intake 外键，保留042的 WORKBENCH_MANUAL_REPORT 裸受理分支；固定 WORKBENCH_PERSONAL_READ 用途及 actor scope，沿同一 ledger。意图包含 actor、真实 Intake、ref、revision、原 UUID，忽略导航 alias。同事务锁来源、receipt、当前资源/主体/role/team/Journey 事实；等待后重验当前事项/材料，再提交或重放。位置 GREATEST 单调，只有更高位置增 row_version；无第二 Ticket Core、状态所有权或命令账本。

关闭 `workbenchPersonalReadEnabled` 使本票 handler 在自身 schema/query/write 前503，bootstrap personal_read_enabled=false，前端停止新观察；宿主原认证仍独立执行。已提交行/receipt 保留，原 Session Control 和受理链继续工作。回退用关闭装配 option，不逆改旧SQL、不删除原业务事实。

服务复用现有 pool，迁移器 pool=1，无新 Worker/EventSource/后台轮询。维持一 App/API/SSE、一 Worker、Gateway 单活、SSE32、应用池建议≤8。个人来源页≤100，原 Review材料≤50/20k，Session分页≤200/UI累计≤400；只观察当前有界获权 DOM。

## 正式管理端、UNKNOWN 与授权清理

Review 原材料与普通详情 REPORT 记录消费精确 read_material。普通 BOT/WEB 的真实引用与 revision 来自获权 Query；普通 MANUAL 追加经受信快照解码的原文 REPORT，没有 Review 也能消费。摘要、内部事件/备注和占位文字不猜测原文坐标。

观察要求非空安全正文已挂载、document visible/focus、transport 可写、当前 actor/epoch/事项一致。[foreground-text](../../../web/admin-workbench/src/features/personal-read/foreground-text.ts) 在 viewport 与祖先 overflow 裁剪内累积全部纵向可见区间，尺寸变化重置；长文可分段看到，不要求整段一次塞进屏幕。隐藏、预加载、离开视口、折叠或未加载均不能写。随后真实当前获权 GET，再确认正文仍在前台，才 POST 该确切 ref/revision。几何/focus 是合成浏览器的平台边界；没有另行声称物理DWM或覆盖层像素识别已验证。

非 Session 传输未知保留 QueryClient 内 UUID/ref/revision 安全元数据，无正文/凭据明文持久化。下次实际前景观察先 fresh page，再按当前授权核对同一原 UUID receipt，只 GET、不自动重试 POST；跨 Review/Ticket alias 仍按同 principal/ref/revision 找到原意图。上限100，未核对 UNKNOWN 不静默淘汰，容量满暂停新增命令；真实前景核对已提交结果后释放容量。已知结果只清其精确 UUID。

401或可信403 WORKBENCH_CSRF_INVALID 沿原会话/epoch清理；普通对象403/404清当前精确恢复意图和原事项显示，包括 canonical 移动后、初始 fresh page 先失败的时序，保留其它仍获权项目。账号切换取消旧观察、请求和该主体恢复权。personal-read-position 纳入现有 realtime family；迟到成功与403正文在真实新账号显示、旧 signal 已中止的生命周期得到验证，不把静态调度推断替代运行证据。Session继续原 current cursor GET/CAS恢复，不添加个人材料 receipt 路由。

主要实现：[服务/HTTP](../../../src/workbench-personal-read.mts)、[runtime](../../../src/p2-016-runtime.mts)、[Query](../../../src/web01-workbench-query.mts)、[个人 client](../../../web/admin-workbench/src/features/personal-read/client.ts)、[Material](../../../web/admin-workbench/src/features/personal-read/PersonalReadMaterial.tsx)、[Session](../../../web/admin-workbench/src/features/conversations/ConversationReadTimeline.tsx)、[原首验收](../../../tests/wbint-t35-visible-read.browser.test.mts)。每个真实运行的对象/结果和未到达断言见执行记录及其外置证据，默认 false 与无真实OAuth/WeCom/Provider/SDK发送、部署、push/PR、full/certify/Gate 边界保持。
