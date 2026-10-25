# T29 Incident 负责人交接合同与实施边界

## 2026-10-14 当前本地实现（默认关闭，待父验收）

冻结四Schema加一DTS及两个first保持原字节；实际功能对象28230562/tree66a5/MF14719c9d保留029 strict/build/artifact原生0、030本票13PASS与031兼容16PASS，范围分别保存。当前GET targets、POST transfer-owner及原commands GET新用途已挂载于显式`incidentOwnerTransferEnabled:true`；该选项及恢复开关默认false，生产不读取test purpose/env自动启用。API与精确运行/关闭指针见[接口记录](tickets.md)和[本票/WBINT-10/A10执行记录](../../../plans/admin-workbench-integration/execution/t29.md)。父验收、Root/GH集成与最终文档独立核对仍待完成，不称full、Gate或上线。

调用者保持Incident原ADMIN/DISPATCHER及当前精确范围，不复制Ticket接管或T36权利。target先有效worker与现有exact Incident READ后分页；新交接在原single ledger/stream锁顺序内，receipt等待后锁稳current caller active/roles并重查用途，父FOR UPDATE及target/team/membership/关联Ticket事实同事务重验。原owner字段、string版本+1、一次HUMAN安全事件及原六ACK原子提交；个人Ticket/Conversation及外发事实不变。

正式生产bundle选择目标、明确团队或无团队、原因，显式按钮一次POST后fresh GET。真实`NONE`非空team code完整保留，UI空值只表示显式null，不碰撞合法code。UNKNOWN保留原UUID/body、不自动POST；manual GET核原COMMITTED，旧ACK不反转后来失效的目标或授新意图。当前purpose403/404只清本scope/cache，合法Session/一般READ保留；实际bootstrap401/403或身份会话边界才全局失效。cancel/generation阻止晚到结果复活已清输入。

真实008 targets400业务RED后，reserved054才新增DDL及typed status/check/apply。它完整保留055/058全部目录、shape/列/FK/index/真实SQLchecksum/marker，并追加TRANSFER_OWNER与incident.owner.transferred，形成17commands/20events；当前完整owner摘要`d61fa6640688ec38523f80a1d08ed309dc1e409d668998b0944dfe8c4412cd09`还绑定原032/055/058实际checksum/marker。055/058旧guard通过完整054 proof接受这个精确已知组合，不使用枚举包含、宽松hash、假旧stamp或第二事实源。仅记录054自己的真实checksum，check回滚/apply/noop/tamper拒绝实际验证；默认OFF/缺054的旧032及055/058宿主保持可用，新用途failclosed。

事件安全详情只在授权broad读面展示actor/previous/next/原因和秒精度时间，不向HANDLER/Reporter/SSE/外发泄漏。关闭新增选项停止新意图，保留owner/Event/ledger和旧Ticket/Outbox/Delivery，不做破坏性down。页面30/max100、每人20组、最多三页，原body32KiB、池总建议≤8、单App/Worker/SSE32/concurrency1；无真实容量、外部发送或部署批准。原caller等待与purpose403真实RED、NONE源码风险及026导航观察器失败独立保留，后继修补不洗历史。

## 历史 SOURCE 冻结时点（以下为当时事实）

下文完整保留WHOLE启动前db031/旧SOURCE的拟议、NOT_MOUNTED、NOT_RUN和054 reserved说明；这些是历史as-of，不表示当前实现仍缺失或追认当时已运行。原源码/首例/证据原件继续保存。

状态：**SOURCE_FROZEN／PROPOSED_NOT_MOUNTED／NOT_RUN**。来源 WBINT-T29/#84、WBINT-10/A10；基线为 [ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md) 的人类明确目标读取规则。本文件不是现有 API 清单或启用授权。当前 [Incident handler](../../../app/server/src/p2-012-workbench-http.mts) 没有这两个操作，当前事件投影亦没有责任交接详情。

### SOURCE 时点事实与拟议入口

复用 `incident.incident.owner_principal_id/owner_team_id`、父 string row_version、原命令 ledger 和追加 Incident Event，不另建所有权、Ticket Core、receipt DB或新宿主。T27 确认现有人员／团队检查保持原语义，不追溯追加本票条件。

| METHOD＋PATH | 宿主／状态 | 输入与输出 |
| --- | --- | --- |
| `GET /api/incidents/{incidentId}/owner-transfer-targets` | W Cookie；PROPOSED／NOT_MOUNTED | 当前原交接用途授权后，`limit` 默认30、最大100，`cursor`可空；闭合 `{items,next_cursor}`，每人 `{id,display_name,teams,teams_truncated}`，每有效团队 `{team_id,display_name}`，最多20组；仅有效 worker AND 对该精确 Incident 当前 READ，不泄漏隐形候选或全量计数。游标绑定父、用途、调用主体。 |
| `POST /api/incidents/{incidentId}/transfer-owner` | W Cookie；PROPOSED／NOT_MOUNTED | 闭合 body 五字段：`client_command_id:UUID`、`reason_code`（原封闭原因枚举）、`expected_row_version:string`、`owner_principal_id:UUID`、`owner_team_id:string|null`，全部必填；null 明确无团队，字符串 `NONE` 不是空值。仅成功返回原封闭六字段 Incident ACK。 |

路径注入内部 `TRANSFER_OWNER` 及 Incident UUID；body不能带action/pathID。沿现有 Origin／CSRF／Sec-Fetch-Site、32KiB、UUID Idempotency-Key、精确带双引号 If-Match。版本为1..BIGINT_MAX的十进制 string，禁止 Number、weak／bare tag。客户端必须显式目标、团队和原因，不从姓名、当前 owner、首项或分页缺席推断授权。

### SOURCE 时点事务、权限与原命令

调用者重查当前精确 Incident READ及原 ADMIN／DISPATCHER 变更用途；现有范围政策不因交接放宽，HANDLER-owner没有交接权。新交接限非 CLOSED，保留 status、confirmed_scope及全部个人 Ticket 事实。沿原授权／全局事务锁顺序，在父版本／目标有效角色、活动团队成员关系及目标现有 exact Incident READ全部成立后，一次原子更新owner字段、父版本+1、追加 `incident.owner.transferred` 事件和原ledger ACK。

目标查询只是当前观察，事务必须重验同一目标，不以 owner 身份补发 READ。既有主工单、Report／Subscription及个人处理／沟通责任不变。内部追加历史记录 previous/next 的 principal/team、当前 actor、原原因和平台秒精度 occurred_at；由授权 broad事件投影安全提供 `owner_transfer:{previous:{owner_principal_id,owner_team_id},next:{owner_principal_id,owner_team_id}}` 与 `actor_principal_id`，不直返safe_payload，不向HANDLER/Reporter外推人员或内部原因。历史不覆写，无自动通知意图、外部发送或人员资料查询。

调用者原用途授权先于任何回执观察。同 principal／UUID／规范hash仅观察或重放原结果，异正文冲突；已 COMMITTED 的旧ACK不执行新交接、不反转事实，不因目标后来离组撤销原提交。未终态／新UUID则必须当前事务目标检查。未来仅扩原 `GET /api/incidents/{incidentId}/commands/{commandId}` 的新用途白名单，不另开收据库；本票用途当前 **NOT_IMPLEMENTED**。403/404失权与稳定409输入／版本／目标冲突沿原mapper，UNKNOWN保留原UUID/body，禁止自动换版本或POST。

### SOURCE 时点Schema、数据库、关闭及证据

未来命令／目标／安全事件声明和Schema只能独立 additive；原13份P2-012合同、032、旧fixture／首例／Evidence保持原字节。054仅reserved：待真实RED后，以最小增量扩原命令／事件数据库allowlist及必要守卫；当前无SQL文件、DDL、迁移注册或应用。字段仍归原Incident／Event／ledger，不创建第二事实源。

沿默认false的既有 workspace／Incident capability，当前没有启用或新增持久Flag；将来若确需新增能力仍defaultfalse并实测关闭。关闭新入口保留所有已提交 owner历史及Ticket／Incident／Outbox／Delivery。资源沿单App／Worker、零新增Gateway、SSE32、总池建议≤8、native concurrency1，有界页面／最多三页窗口；不声称真实2C4G容量验证。

首tracer：[owner-transfer.browser](../../../tests/wbint-t29-owner-transfer.browser.test.mts)，只写一个公开W HTTP交接主链，复用原T27 fixture、032及真实确认 setup；先核对合法目标，再显式POST、ACK／新owner／追加历史／个人Ticket和通知不变。当前源码检查不是RED；全部build/types/artifact/Unit/Contract/PG/HTTP/browser/cleanup均NOT_RUN。未来WHOLE grant后原样实际运行，按真实缺口逐片最小实现；原七项仍见 [own执行记录](../../../plans/admin-workbench-integration/execution/t29.md)。

### 2026-10-14 有限 SOURCE 合同与 HTTP 首例冻结

本轮正常 merge 固定 Root `db0317a3b8b0d8e49884e1cd1e23ce527bc08172`，保留旧 `91d6f16e` SOURCE祖先和原browser first，不是T29 WHOLE或接口实现。当前完整合同如下，全部 **SOURCE_FROZEN／NOT_MOUNTED／NOT_RUN**：

- [闭合五字段HTTP body](../../../contracts/workbench_incident_owner_transfer_command.schema.json)／[独立声明](../../../contracts/workbench_incident_owner_transfer_contracts.d.ts)：沿原八种reason_code、UUID、string BIGINT父版本；team为原code语法（大写、最多64字符）或必填null。Schema结构格式不替代原runtime BIGINT_MAX守卫。
- [目标页](../../../contracts/workbench_incident_owner_transfer_targets.schema.json)：闭合items/next_cursor，每页默认30/max100，每人最多20有效组，名称最多200字符，cursor最多2048字符；过滤当前有效角色/团队及精确Incident READ后才分页，不返回不可见人计数。原confirm目标选择不追溯改变。
- [成功ACK](../../../contracts/workbench_incident_owner_transfer_result.schema.json)：原六字段成功形状，result_ref_type只为INCIDENT；没有新增receipt事实源。
- [责任事件安全变体](../../../contracts/workbench_incident_owner_transfer_event.schema.json)：原history基础字段加actor及previous/next owner/team；该事件状态/范围字段均null，时间为Asia/Shanghai秒精度。仅授权broad读面，不向HANDLER/Reporter或SSE/通知外推私有责任字段。原内部处置/公开进展独立页及其可见性不变。

未来宿主选项名为`incidentOwnerTransferEnabled`，默认false；当前生产Options/guard/handler/UI均未实现该选项。新自有[HTTP fixture](../../../tests/helpers/t29-owner-transfer-http-fixture.mts)以明确的未来合同交叉类型传入true，不是类型逃逸或启用生产功能；它使用现有支持的四个principal、真实隔离fixture、W Cookie、032→055→058、原cleanup allclosers/primaryError。没有不存在模块的catch、伪迁移或源码跳板。

[新HTTP first](../../../tests/wbint-t29-owner-transfer-http.integration.test.mts)没有浏览器前置：真实确认LOCAL Incident、真实GET证明目标现有READ，随后期望targets GET200及一次显式POST200，核六字段ACK/新责任/一次actor时间事件、个人Ticket及notifications不变。当前NOT_RUN，不能称RED或GREEN。历史[原browser first](../../../tests/wbint-t29-owner-transfer.browser.test.mts) raw4575/affddc0e、canonical4534/d45d6399逐字节保留，继续负责未来正式UI与reload证明。后续真正054迁移接入只属于独立WHOLE中的自有fixture后继，不改写本次SOURCE冻结或重绑其被测身份。

### SOURCE 时点未来054与已交付055／058的精确组成

当前Root全仓跟踪SQL为41（migration40＋schema_draft1）；旧47e2为39（38＋1），T30 Root9a92为40（39＋1），各是自己的输入身份。055和058现行SQL原件、checksum及marker不改，054仍 **RESERVED_NOT_IMPLEMENTED**，本窗口无SQL054或任何DDL执行。

055封闭目录为15 command/18 event；058为16/19，完整保留055并只增加PUBLISH_PUBLIC_PROGRESS及incident.public_progress_published。未来054若加入TRANSFER_OWNER／incident.owner.transferred，必须在最新Root的完整目录上追加，不能回退到032枚举或丢掉ADD_INTERNAL_NOTE／internal_note_added。原note/public shape、列、已validated检查、FK和索引、订阅/Communication模板全部保留；owner交接不创建外发意图。

现行[055 guard](../../../app/server/src/p2-012-internal-note-schema.mts)只接受原055摘要或通过完整[058 guard](../../../app/server/src/p2-012-public-progress-schema.mts)；055／058 typed migrator还核原SQLchecksum、marker和具体catalog，正常新增枚举会改变这些精确摘要。后续在真实first RED后通过原受控机制证明合法054＋055＋058目录及status/check/apply，不改旧SQL，不用枚举包含、宽松hash、假058 stamp或新验证平台。最小已有指针为T30 migration/schema与T31 migration，再按实际common consumer diff选原command-port/public-progress/contracts；本窗口全部未运行。

