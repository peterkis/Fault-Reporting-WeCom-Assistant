# T29 Incident 负责人交接拟议合同

状态：**PROPOSED／NOT_MOUNTED／NOT_RUN**。来源 WBINT-T29/#84、WBINT-10/A10；基线为 [ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md) 的人类明确目标读取规则。本文件不是现有 API 清单或启用授权。当前 [Incident handler](../../../src/p2-012-workbench-http.mts) 没有这两个操作，当前事件投影亦没有责任交接详情。

## 当前事实与拟议入口

复用 `incident.incident.owner_principal_id/owner_team_id`、父 string row_version、原命令 ledger 和追加 Incident Event，不另建所有权、Ticket Core、receipt DB或新宿主。T27 确认现有人员／团队检查保持原语义，不追溯追加本票条件。

| METHOD＋PATH | 宿主／状态 | 输入与输出 |
| --- | --- | --- |
| `GET /api/incidents/{incidentId}/owner-transfer-targets` | W Cookie；PROPOSED／NOT_MOUNTED | 当前原交接用途授权后，`limit` 默认30、最大100，`cursor`可空；闭合 `{items,next_cursor}`，每人 `{id,display_name,teams,teams_truncated}`，每有效团队 `{team_id,display_name}`，最多20组；仅有效 worker AND 对该精确 Incident 当前 READ，不泄漏隐形候选或全量计数。游标绑定父、用途、调用主体。 |
| `POST /api/incidents/{incidentId}/transfer-owner` | W Cookie；PROPOSED／NOT_MOUNTED | 闭合 body 五字段：`client_command_id:UUID`、`reason_code`（原封闭原因枚举）、`expected_row_version:string`、`owner_principal_id:UUID`、`owner_team_id:string|null`，全部必填；null 明确无团队，字符串 `NONE` 不是空值。仅成功返回原封闭六字段 Incident ACK。 |

路径注入内部 `TRANSFER_OWNER` 及 Incident UUID；body不能带action/pathID。沿现有 Origin／CSRF／Sec-Fetch-Site、32KiB、UUID Idempotency-Key、精确带双引号 If-Match。版本为1..BIGINT_MAX的十进制 string，禁止 Number、weak／bare tag。客户端必须显式目标、团队和原因，不从姓名、当前 owner、首项或分页缺席推断授权。

## 事务、权限与原命令

调用者重查当前精确 Incident READ及原 ADMIN／DISPATCHER 变更用途；现有范围政策不因交接放宽，HANDLER-owner没有交接权。新交接限非 CLOSED，保留 status、confirmed_scope及全部个人 Ticket 事实。沿原授权／全局事务锁顺序，在父版本／目标有效角色、活动团队成员关系及目标现有 exact Incident READ全部成立后，一次原子更新owner字段、父版本+1、追加 `incident.owner.transferred` 事件和原ledger ACK。

目标查询只是当前观察，事务必须重验同一目标，不以 owner 身份补发 READ。既有主工单、Report／Subscription及个人处理／沟通责任不变。内部追加历史记录 previous/next 的 principal/team、当前 actor、原原因和平台秒精度 occurred_at；由授权 broad事件投影安全提供 `owner_transfer:{previous:{owner_principal_id,owner_team_id},next:{owner_principal_id,owner_team_id}}` 与 `actor_principal_id`，不直返safe_payload，不向HANDLER/Reporter外推人员或内部原因。历史不覆写，无自动通知意图、外部发送或人员资料查询。

调用者原用途授权先于任何回执观察。同 principal／UUID／规范hash仅观察或重放原结果，异正文冲突；已 COMMITTED 的旧ACK不执行新交接、不反转事实，不因目标后来离组撤销原提交。未终态／新UUID则必须当前事务目标检查。未来仅扩原 `GET /api/incidents/{incidentId}/commands/{commandId}` 的新用途白名单，不另开收据库；本票用途当前 **NOT_IMPLEMENTED**。403/404失权与稳定409输入／版本／目标冲突沿原mapper，UNKNOWN保留原UUID/body，禁止自动换版本或POST。

## Schema、数据库、关闭及证据

未来命令／目标／安全事件声明和Schema只能独立 additive；原13份P2-012合同、032、旧fixture／首例／Evidence保持原字节。054仅reserved：待真实RED后，以最小增量扩原命令／事件数据库allowlist及必要守卫；当前无SQL文件、DDL、迁移注册或应用。字段仍归原Incident／Event／ledger，不创建第二事实源。

沿默认false的既有 workspace／Incident capability，当前没有启用或新增持久Flag；将来若确需新增能力仍defaultfalse并实测关闭。关闭新入口保留所有已提交 owner历史及Ticket／Incident／Outbox／Delivery。资源沿单App／Worker、零新增Gateway、SSE32、总池建议≤8、native concurrency1，有界页面／最多三页窗口；不声称真实2C4G容量验证。

首tracer：[owner-transfer.browser](../../../tests/wbint-t29-owner-transfer.browser.test.mts)，只写一个公开W HTTP交接主链，复用原T27 fixture、032及真实确认 setup；先核对合法目标，再显式POST、ACK／新owner／追加历史／个人Ticket和通知不变。当前源码检查不是RED；全部build/types/artifact/Unit/Contract/PG/HTTP/browser/cleanup均NOT_RUN。未来WHOLE grant后原样实际运行，按真实缺口逐片最小实现；原七项仍见 [own执行记录](../../../plans/admin-workbench-integration/execution/t29.md)。
