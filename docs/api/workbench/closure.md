# 统一关闭与恢复（卡 27C-A）

决策：[ADR-0056](../../../adr/0056_unified_closure_reasons_notify_and_restore.md)。宿主 W，沿原工作台身份、READ、Origin/CSRF、principal-scoped ledger、Idempotency-Key 与 If-Match；不授权真实发送或部署。原生命周期开关默认 false，不增加关闭规则兼容开关。

## 接口

| METHOD + PATH | 合同 |
| --- | --- |
| POST /api/tickets/{ticketId}/dismiss | 关闭接口（ADR-0058，原 `/cancel` 已删除）使用 ClosureCommand；返回原安全 Ticket 命令结果，原 waiting 模式保留 handling_cycle_id |
| POST /api/tickets/{ticketId}/restore | RestoreCommand，返回原安全 Ticket 命令结果，版本递增 |
| GET /api/tickets/{ticketId}/restore/commands/{commandId} | 无 query，原 actor + 当前 READ 下的 UNKNOWN / FAILED / COMMITTED 安全核对 |
| POST /api/manual-reviews/{reviewId}/resolve | MARK_OUT_OF_SCOPE 保持非 IT 范围分类，仅接受 NOT_IT_SCOPE；下列原因字段必经校验。resolution_reason_code 等于二级原因，非 NOT_IT_SCOPE 时等于一级原因。沿原 expected_row_version、材料 fence 和安全结果 |
| GET /api/intakes/{intakeId}/closure-context | 无 query；subject_id、version、status、can_close、can_restore、closure_id、pending_review；pending_review 为 {id,row_version} 或 null |
| POST /api/intakes/{intakeId}/close | 所有原因使用 IntakeClosureCommand；有 Review 时须传 expected_review_version，在同事务复用原复核处置，保留 human override Decision 和材料校验 |
| POST /api/intakes/{intakeId}/restore | RestoreCommand；结果为 {ok:true,subject_type:'INTAKE',subject_id,version,closure_id,event_id,replayed} |
| GET /api/intakes/{intakeId}/{close或restore}/commands/{commandId} | 无 query；UNKNOWN、FAILED 安全错误或 COMMITTED + ClosureResult，不返回原正文 |

ClosureCommand 为 `{client_command_id,expected_version,reason_code,secondary_reason_code?,note?,duplicate_of_ref?,notify_reporter?}`。旧 resolve 的控制版本仍为 `expected_row_version`。专用 Intake close 带 Review 时另传 `expected_review_version`，可携带 `expected_material_basis`。RestoreCommand 为 `{client_command_id,expected_version,reason_code:'RESTORE_CLOSED'}`。header UUID/版本须与 body 一致；未知键拒绝。

| reason_code | 中文 | 附加校验 | 通知 |
| --- | --- | --- | --- |
| FALSE_REPORT_OR_TEST | 误报或测试 | 说明可空 | 固定 false |
| DUPLICATE | 重复报修 | 可选原单 | 固定 true |
| NOT_IT_SCOPE | 非 IT 范围 | 必选八项二级原因之一 | 固定 true |
| REPORTER_WITHDREW | 报修人撤回 | 说明可空 | 固定 true |
| REPORTER_UNREACHABLE | 无法联系报修人 | 说明可空 | 固定 true |
| OTHER | 其他 | 非空内部说明必填 | 默认 false，可 true |

二级原因沿原八码，中文映射见 ADR。其它一级原因禁止二级原因。duplicate_of_ref 只在 DUPLICATE 可填，须是当前可见 Ticket 展示编号，可以指向已结束原单，不可自指。纯空白 note 归一为 null；OTHER 因此拒绝。取消不再接收旧技术码/自由文本 wire；PC 旧对话框在 client 适配为 OTHER + 原说明。

## 状态、权限和核对

### 27C-B 只读历史补充

2026-11-07 用户明确授权补齐前端必需的最小读取合同及解析层；原关闭/恢复命令、状态、通知投递和权限不变。

工作台 bootstrap 的 `closure_draft_recovery_enabled` 只反映全局浏览器草稿恢复开关，独立于内部备注开关。关闭/恢复仍以当前主体命令权限为准；关闭草稿沿原 `waiting-cancel` 作用域读取旧版加密副本，旧待核对 UUID 只用于原用途回执 GET。恢复关闭时不要求浏览器草稿存储存在；有旧记录则先核对或清理，避免盲发新命令。

`GET /api/tickets/{ticketId}/closure-history` 与 `GET /api/intakes/{intakeId}/closure-history` 由 W 宿主沿既有 lifecycle 开关提供，只供当前获权工作台读取。可选 query `before_version` 为 1–2147483647 的整数十进制；未知/重复参数拒绝。按 `before_version` 倒序，每页最多 20 条，额外读 1 条判断下一页；`next_before_version` 为末条版本或 null。单事务只读，statement timeout 2000ms；身份、READ、Cookie 会话及绝对 TTL 在查询后再核验，主体版本或权限快照改变返回 409。

返回 `subject_id`、当前 `version`、`items`、`next_before_version`、`restore_target`。条目含关闭 ID/前版本、固定原因/二级原因、内部说明、可选原单展示编号、来源、关闭/恢复时间和操作人名称、实际 `notification_state`。关闭版本顺序也用于同秒事件的稳定排列；恢复事件在同条关闭之前显示。`restore_target` 仅首页当前未恢复记录有值，包含当前有效恢复状态/列/负责人、`notify_reporter`（该次关闭是否选择通知报修人；为 false 时恢复不发送通知）、通知状态；失效原负责人按 ADR-0056 回 QUEUED。这个提示不是命令授权，提交仍按版本与当前权限终检。

通知状态 `SENT` 必须同时存在 SENT Delivery、ACKNOWLEDGED、实际发送时间和最新成功 Attempt；SENDING 或 UNKNOWN 为 `UNKNOWN`；其它为 `NOT_SENT`。不能把 outbox、通知选择或原因矩阵当送达证明。时间均为上海时区秒精度；说明最多 2000 字、展示名/原单编号最多 128 字。内部说明不进入 H5、通知或外部接口。原单编号通过既有授权搜索解析，搜索不到不猜测其 ID。

DTO 与 Schema：[unified_closure_contracts](../../../contracts/unified_closure_contracts.d.ts)、[关闭历史](../../../contracts/unified_closure_history.schema.json)。无需数据库迁移；关闭/恢复写合同和 071 结构不变。回退时配套撤回此读取、PC 解析和展示。

ADMIN / DISPATCHER / HANDLER 可关闭、恢复当前可见事项，只读账号不可；写权不扩大 READ。Ticket 可从 NEW / QUEUED / ACCEPTED / IN_PROGRESS / WAITING_REQUESTER / WAITING_VENDOR / REOPENED 关闭，统一 DISMISSED（事件 ticket.dismissed）；RESOLVED / COMPLETED / DISMISSED 拒绝再次关闭。人工重复关闭同为 DISMISSED + 原因 DUPLICATE；DUPLICATE_LINKED 已删除（ADR-0058）。Intake 使用 DISMISSED（事件 intake.dismissed），已关联 Ticket 的事项通过 Ticket 操作。

恢复当前未恢复的关闭记录，回到前状态/列/负责人/团队/轮次；原负责人失效时按本次用户补充回 QUEUED 且负责人为空。每次关闭一条记录，版本只递增；不重建已终止跟进/预约/提醒，会话接待不变。没有额外恢复时间窗，仍沿已有可见性与保留规则。

有效 ADMIN / DISPATCHER 的既有全局受理权限不要求额外团队 membership；HANDLER 继续要求有效团队权限。新增恢复安全回执在实际 receipt SELECT 等待后再次核验当前 READ 与认证 TTL。

本卡四个新增只读入口（Ticket 恢复回执、Intake 关闭/恢复回执和 closure-context）在数据等待后核验原 Cookie 会话。官方退出登录后为 401 / WORKBENCH_UNAUTHENTICATED，无旧回执或上下文字段；携带绝对 TTL 的非持久认证过期时为 403。内部 principal-only 调用和原写命令合同不变。

UNKNOWN 使用原 UUID 查询同用途回执，不生成新 UUID 盲重试；等待锁和复用回执前保留当前 READ，实际写入保留权限终检。冲突沿原 409；参数守卫 400；不可见 404，失权 401/403，缺迁移/数据错误 503。

## 投影和通知

DISMISSED closure 必须有关闭记录；缺失是数据错误，不回退旧事件、自由文本或 created_at。保留原 kind/source/reason_code/reason_label/reason_note/closed_by_display_name/closed_at/duplicate_of/can_restore，增加 secondary_reason:{code,label}|null。COMPLETED 保留原完工/重开规则。

通知使用服务端固定模板与逐原因矩阵；内部 note 不参与模板。Ticket 关闭同事务投影，系统 Intake 关闭由当前 runtime 通知批次消费，不增加定时器。Web / 手工代录沿原 app-only 短路；旧 P1 取消 reporter/team 默认均关闭。

恢复通知须有对应关闭通知的 SENT + ACKNOWLEDGED 与 Attempt 证据；只进入 outbox 不算已通知。尚未尝试的关闭通知按原取消审计终止；SENDING / UNKNOWN 保留，等既有投递/人工核对完成后由当前批次处理，不改成未发送、不盲重发。

恢复通知投影与发送前均检查最新关闭版本及当前开放状态；后续再次关闭，或 Intake 对应的权威 Ticket 已结束时，旧恢复通知停止。Bot 文本通路只接受与关闭记录、原报修人和固定模板绑定的通知，沿现有成员资格，资格等待后重新校验绑定；普通文本不能使用此通路。

H5 详情只增加固定安全 closure_text；误报/测试仅“已关闭”。不返回 note、操作人或关闭记录原文。

## 迁移与回退

071_unified_service_closure.sql 由 service-closure-migrate.mts 的编译制品执行 --check / --apply / --rollback；迁移锁、checksum 与原事件/receipt 约束定义受保全。关闭记录、补充待跟进终止关联和 ledger 的 Intake 专用关联不复制 Ticket 权威。

当前 Human / P2016 的 App readiness、Worker 与 Gateway 始终要求 071，独立的 service_closure_schema 检查反映其 checksum 与必需表是否就绪；H5 关闭不取消这个关闭模型的依赖。Gateway 在构造受理入口、SDK 和连接网络前检查；通用 G1 默认入口不增加前置。

按 U7 不回填、不映射、不读旧自由文本原因。只在本卡隔离 fixture 库应用并重新合成，不清理非本地库或不明归属数据；旧 Evidence 保留。结构回退须无新关闭记录/新事件；有事实时停止结构回退，通过原隔离库重置 helper 重建本卡库。实际结果见[执行记录](../../../plans/pc-admin-design-v21/card-27c-a.md)。

HANDLER 的当前组写权仍须终检；历史负责人可能保留原 READ，但不能用它绕过失组后的关闭 / 恢复权限。
