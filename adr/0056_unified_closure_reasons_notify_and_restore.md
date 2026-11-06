# ADR-0056：统一关闭原因、通知与恢复

状态：Accepted；实现、独立审查与验证结果以[卡 27C-A 执行记录](../plans/pc-admin-design-v21/card-27c-a.md)为准。

日期：2026-11-06（Asia/Shanghai）。本卡前向替代 [ADR-0055](0055_workbench_closure_kind_projection.md) 的关闭原因与恢复停止项，不改写旧候选证据。不得据本决策启动部署、真实通知或业务 Gate。

## 用户规则原文

| 编号 | 规则 |
| --- | --- |
| U1 关闭原因 | 统一为 6 个固定选项：**误报或测试**、**重复报修**、**非 IT 范围**、**报修人撤回**、**无法联系报修人**、**其他**（必须填写说明）。取消工单和关闭待判断事项都使用这套原因。 |
| U2 原单关联 | 重复报修**可以**关联原单，**不强制**。 |
| U3 恢复 | 所有已关闭事项都可以恢复，**回到关闭前所在的列和状态**；暂不设时间限制。**所有工作台人员都可以恢复**（ADMIN、DISPATCHER、HANDLER；只读账号除外）。 |
| U8 关闭权限 | **处理人也能关闭**：ADMIN、DISPATCHER、HANDLER 都可以关闭自己可见范围内的事项（与恢复一致）；只读账号不可。 |
| U6 可关闭范围 | **扩大到处理中的事项**：除已结束状态外，待接单、已接单、处理中、等待报修人、等待厂商、重新打开的工单都可以关闭；待判断受理事项照常可关闭。 |
| U7 历史数据 | 项目尚未上线，**不保留、不映射历史数据**。受影响的开发 / 测试数据直接清理，按新规则重新合成。 |
| U4 通知 | 按原因分情况通知报修人（见下文通知矩阵）。 |
| U5 H5 统计 | H5 把已取消、重复单从「已完成」中拿出，单独显示为「已关闭」。 |

2026-11-06 本次用户补充确认：首次感谢类 Intake 在同事务先建立 `WAITING_DESCRIPTION`，再系统关闭并记录该状态，恢复回 `WAITING_DESCRIPTION`。原负责人停用或失去团队权限时，恢复为 `QUEUED`、负责人为空；此为 U3 的明确例外。

## A0 核对与决定

### A0-1：工单终态和关联对象

人工关闭统一进入 `CANCELLED`，不新增状态。`DUPLICATE_LINKED` 不用作人工重复关闭，保留既有公共故障关联含义。`NEW` 与 `QUEUED` 都属于待接单列，均可关闭；另含 `ACCEPTED / IN_PROGRESS / WAITING_REQUESTER / WAITING_VENDOR / REOPENED`。`RESOLVED / CLOSED / CANCELLED / DUPLICATE_LINKED` 拒绝再次关闭。

| 关联对象 / 实际来源 | 关闭处理 | 恢复处理 |
| --- | --- | --- |
| Ticket 状态、处理人、团队、版本；Core `p1-006-ticket-state-actions.mts` | 同事务保存快照，版本递增，追加 `ticket.cancelled` | 还原原状态、团队和仍有效的负责人；失效负责人按用户补充回 QUEUED；版本只递增，不退回旧版本 |
| `ticket_handling_cycle`、轮次事件；迁移 039/040/043 | 保存当前轮次，记录中止事件，保留所有责任/完工历史 | 接续原轮次，保留中止及恢复历史；不虚构完工，不通过完工重开建立新一轮 |
| 补充材料待跟进；`workbench-supplement-follow-up.mts` / 062 | 记录关闭时的待跟进终止边界；保留材料和已回复/处置证据，不伪造人工已回复 | 关闭前已终止的待跟进不重新激活；恢复后的新补充按既有规则进入待跟进 |
| 共享预约、到期信号；`workbench-follow-up-schedules.mts` / 049/053 | 既有 CANCELLED 终态事件结束预约；清除当前预约指针，保留 revision / due signal | 不重建预约；原结束事件历史继续有效，可由员工重新安排 |
| 自动关闭、提醒；`p1-010-ticket-closure.mts` / 007/022 | 清除 auto_close 与 reminder 时间；原版本卡片不可继续操作 | 不恢复已终止定时任务，不生成新的回访任务 |
| 等待报修人、等待厂商 | 当前实现是 Ticket 状态与事件，没有独立厂商工单或厂商定时队列；随关闭结束等待 | 恢复原等待状态与原负责人；已终止的预约/跟进不自动重建 |
| Conversation Session / Assignment / Handoff / generation | 不改变接待状态、沟通责任、读游标或 generation | 不自动接管会话 |
| Contact Journey / Manual Review | 保存本次关闭的 Review / Journey 身份和状态；待判断关闭使 Intake IGNORED；非 IT 范围沿原 Review RESOLVED 分类效果，其它关闭原因通过原取消复核事务使 Review CANCELLED，避免伪造 OUT_OF_SCOPE 分类 | 恢复关闭前 Intake / Review / Journey 状态；递增各自版本，保留旧命令回执和决策事实 |
| Bot / Web 尚未执行的自动受理与分类 | 候选选择和锁内终检排除 IGNORED；分类 Port 不能将已关闭受理事项重新改为开放状态或创建 Ticket | 先提交原状态，再沿原受理流程处理；不新增恢复限制，不复建已终止的跟进/预约 |
| H5 催单事实 / 提醒；`yxx-h5-v2-lifecycle.mts` / 064 | 保留历史催单，但关闭前催单不作为恢复后的待处理提醒 | 不自动重放旧催单；新催单仍按既有冷却时间和当前轮次合同 |
| 已提交 Communication / P1 outbox、Delivery / Attempt | 保留发送事实与 UNKNOWN；不把关闭当作已发送证明；关闭通知仅由当前 runtime 投影 | 恢复通知依据本次关闭的通知事实；不重发关闭通知、不重建已结束跟进 |
| Incident 关联 / 订阅、公开进展、评价、个人关注 / 已读 | 保留关联和历史，不改变公共故障生命周期、订阅或他人责任 | 不撤销历史评价、已读、关注、公开进展或 Incident 事件 |
| 热度与计时；`workbench-card-projections.mts` | 保留 created_at 与旧事件；关闭不重置热度起点 | 继续现有阶段/创建时间规则，不增加专用恢复热度起点 |

没有独立的“回访计划”表；现有相关定时入口是共享预约到期、自动关闭/提醒及通知投递重试。实现不得按名词猜测一个不存在的计划。处理中恢复后，已终止的跟进应可由后继 27C-B 界面提示重新发起，本卡只提供事实。

恢复后的热度显示沿用现有实现：待接单列使用原 created_at，因此恢复后可能立即显示原有较高热度；进行中列使用最近状态转换事件对应的 stage_entered_at，ticket.restored 也按这个既有查询规则成为状态进入时间，前 5 分钟不显示热度。没有给 restored_at 增加特殊起点分支；查询未提供 stage_entered_at 时仍不借其它时间推断热度。

### A0-2：受理事项终态

复用 `IGNORED` 表达已关闭，通过独立关闭记录区分人工/系统来源。`COMPLETED` 仍表示已完成，不改为关闭。初建即 IGNORED 的路径按上述用户补充建立真实前状态；后续 `OUT_OF_SCOPE` 分类必须在实际 UPDATE 所在事务记录关闭时间，不再使用旧 observed_at 充当关闭时间。

### A0-3：二级原因

一级 `NOT_IT_SCOPE` 必选以下原有八项之一；这些码仅在本次明确选择该一级原因时有效，不读取旧自由文本：

| 二级原因码 | 沿用的中文说明 |
| --- | --- |
| HUMAN_CONFIRMED | 人工核对确认 |
| INFORMATION_INSUFFICIENT | 描述不足，需要补充 |
| BUSINESS_CONSULTATION_CONFIRMED | 已核对为业务咨询 |
| ACKNOWLEDGED | 确认收到 |
| OUT_OF_SCOPE_CONFIRMED | 已核对为范围外诉求 |
| SERVICE_REQUEST_CONFIRMED | 已核对为服务请求 |
| INCIDENT_REVIEW_PENDING | 待公共故障审核 |
| STALE_REVIEW_CANCELLED | 明确取消旧复核 |

现有 PC“记录范围外诉求”的 client 适配为一级 `NOT_IT_SCOPE` + 原选择的二级原因；其它复核结论不修改。系统 OUT_OF_SCOPE 使用 `NOT_IT_SCOPE / OUT_OF_SCOPE_CONFIRMED`，初始感谢使用 `NOT_IT_SCOPE / ACKNOWLEDGED`，均按固定矩阵进入当前 runtime 通知管线，沿既有 Web / 手工代录短路；本地验证不实际外发。

### A0-4：通知管线

`p2-016-runtime.mts` 将 `createTicketClosureService().afterTicketAction` 的 enqueue 接到 `notifications.project`，后者使用 Communication Message / Outbox / Delivery。`p2-016-ticket-notification-policy.mts` 原默认只准入 accepted / closed；取消须前向改为由关闭记录及矩阵决定。`p1-007-notification-outbox.mts` 是独立旧管线，原 cancelled 的 reporter/team 默认都为 true，本卡仅将这一事件的两个默认值改为 false。不得双管线发送。

继续保留 Web / 员工代录 app-only 短路、已建立的个人目标授权与原渠道选择。内部 note 从未进入通知模板；H5 只获得服务端固定安全文案。

## 关闭记录、输入与恢复

采用独立追加型记录，主体为 Ticket 或 Intake；每次关闭一条，恢复只填写该条的恢复关联字段。保存原因、二级原因、归一化内部 note、可选原单引用、通知选择与实际通知关联、前状态/负责人/团队/版本/轮次和必要 Review/Journey 快照、关闭 actor/source/实际时间与事件、恢复 actor/time/event。

原因枚举：`FALSE_REPORT_OR_TEST / DUPLICATE / NOT_IT_SCOPE / REPORTER_WITHDREW / REPORTER_UNREACHABLE / OTHER`。OTHER 必有非空说明；NOT_IT_SCOPE 必有八选一二级原因；原单只能在 DUPLICATE 下填写，必须是当前可见的 Ticket 编号，可引用已结束原单，不可自指。非 OTHER 的通知按矩阵固定，不能通过输入改写；OTHER 默认 false。空白 note 归一为 null。

Ticket 沿用 `/api/tickets/{id}/cancel`，新增独立 restore 动作；Intake 关闭/恢复采用专用接口，复用现有工作台身份、命令 ledger、If-Match 与幂等 UUID；有待判断 Review 时同时校验其版本，并在同事务复用原复核处置 Port，不放宽原 READ。ADMIN / DISPATCHER / HANDLER 可关闭或恢复自己当前可见事项；只读账号拒绝；等待锁及旧回执复用前仍做当前权限核验。

Ticket 人工关闭事件沿用 `ticket.cancelled`；新增 `ticket.restored` 与 `ticket.handling_aborted`。Intake 新增 `intake.closed / intake.restored`；实际分类写入保留原 `intake.rule_decision_applied`。迁移 071 和事件契约登记这些值；恢复与处理中止事件按原轮次关联，不改变其它事件的语义。

关闭投影改为读取当前未恢复的记录；DISMISSED 缺记录为数据错误，不回退事件、自由文本或 created_at。COMPLETED 保留已有完工/重开合同。投影包含一级原因及中文、二级原因、可选原单 display_no、实际 closed_at、source、当前账号 can_restore。PC 内部可读 note，H5 和通知永不返回它。

## 通知矩阵与模板

| 原因 | 是否通知 | 固定文本 |
| --- | --- | --- |
| FALSE_REPORT_OR_TEST | 否 | —；H5 仅显示“已关闭” |
| DUPLICATE | 是 | 您的报修与已有报修重复，我们会在原报修中继续跟进。有原单时追加“原报修编号：{编号}” |
| NOT_IT_SCOPE | 是 | 您反映的问题不属于信息科受理范围，建议联系相关部门处理。 |
| REPORTER_WITHDREW | 是 | 已按您的要求撤销本次报修。 |
| REPORTER_UNREACHABLE | 是 | 多次联系未果，本次报修已关闭。如仍需处理，请重新报修。 |
| OTHER | 默认否，显式 true 时是 | 您的报修已关闭。如仍需处理，请重新报修。 |
| 恢复 | 对应关闭通知已通知时 | 您的报修已重新受理，我们会继续处理。 |

模板放服务端配置；关闭及恢复通知只经既有当前 runtime 的 outbox；回归经过生产 Worker / Sender 到合成 SDK 截止，并断言 outbox / Attempt，不真实外发。系统分类通知由同一 runtime 的通知批次提交 outbox。

### 独立审查后的发送与并发边界

关闭文本使用专用 `SERVICE_CLOSURE_TEXT` 标记；标记本身不授权发送。Sender 从关闭记录关联的 Message / Outbox / SENDING Delivery 重新读取原 Intake 的 Bot、报修人、内容 hash、幂等键、保留期和固定模板，全部匹配才使用现有动态成员资格；未配置动态资格时仍要求原静态目标白名单。资格等待后重读相同绑定，再进入 SDK。普通文本或伪造标记不能借用该通路；内部 note 不进入绑定查询和 SDK 参数。

恢复通知只针对同一主体最新关闭版本，按单调的 `before_version` 判断先后，不用秒级时间或 UUID 排序。投影和实际 Sender 都检查该条未被后续关闭覆盖，主体仍开放；Intake 已转成已结束的权威 Ticket 时也停止旧恢复通知。旧关闭的 UNKNOWN 事实继续保留原核对路径，后续确认已发送不能补出过时恢复文案。两个主体版本索引支持此查询。

共享 Ticket facade 所有命令统一先取得 realtime stream mutex，再建立带 Ticket FK 的 receipt，避免默认关闭功能配置下旧命令与新关闭/恢复形成反向锁序。安全回执 SELECT 等待后重新核验当前 READ；新增恢复回执同时重查绝对认证 TTL，再返回 UNKNOWN / FAILED / COMMITTED。

恢复负责人沿既有角色权限：有效 ADMIN / DISPATCHER 保留全局受理资格，不额外要求团队 membership；HANDLER 仍须有效团队成员关系。只有人员停用或实际失权才按用户确认回 QUEUED、负责人为空。

当前 Human / P2016 的 App、Worker、Gateway 均在 ready 前要求迁移 071；Gateway 在构造 Intake、SDK 和连接网络前检查，失败关闭自有连接池。H5 未启用时此关闭模型依赖仍成立；通用 G1 默认入口不增加该前置。

## H5 统计和解析

筛选 `COMPLETED` 仅含 `CLOSED / RESOLVED`；新增 `CLOSED_OUT` 含 `CANCELLED / DUPLICATE_LINKED`。`ACTIVE`、`OPEN`、total、active_count 的现有归属不变。受影响入口：`yxx-self-service-query.mts` 列表、`yxx-h5-batch-sql.mts` reports / home / department/profile 聚合、`yxx-h5-v2-profile.mts` 科室计数。关闭原因只输出固定 reporter 文案，不输出 note、操作人或内部事件。

同次更新 PC `api/client.ts` / feature client 和 H5 `api/types.ts / query.ts / read-decode.ts`；PC 当前自由文本取消适配为 OTHER + note，无兼容开关，无界面组件/样式变更。27C-B 和 27C-H 仍按用户指定合并依赖另行开始。

## 数据范围、迁移和回退

不回填、不映射、不兼容旧自由文本。迁移不得对不明确归属的库执行清理。只清理本卡 helper 创建并持有的隔离 UUID 合成库；重建范围包括旧 CANCELLED / DUPLICATE_LINKED / IGNORED 的 fixture、相关事件/复核/轮次/预约/通知替身事实。用户原件、其它任务数据库和历史 Evidence 保留。正式迁移编号及正向/回退实测在执行记录列出。

正向先在本卡隔离库应用结构，再通过现有 fixture/helper 的既有写入方式重建含“（合成）”的数据。回退先停止本卡宿主/Worker，再清理本卡合成库并按原代码/迁移重建；结构回退需要先确认不存在新事件与关闭记录，禁止对不明数据静默删行。合并后的源码回退采用普通 revert，并同步契约、解析层及资源清单，不改写 main 历史或旧 Evidence。

专用 Intake close 接口覆盖六种原因及其待判断 Review；带活动 Review 时须传 expected_review_version，可带 expected_material_basis。旧 MARK_OUT_OF_SCOPE 只接收 NOT_IT_SCOPE，保持其分类效果；已关联 Ticket 时不伪造 Intake 关闭，Ticket 关闭必须走同一 Ticket Core。其它关闭原因不改写成 OUT_OF_SCOPE，原复核取消与 Intake 关闭在一个事务提交。


## 已有收据 catalog 守卫的前向接线

071 给同一 ledger 增加直接 Intake 主体关联，不要求把个人已读/关注功能变成关闭的前置。现有 061 / Follow 收据守卫继续比较完整旧 inventory；只在 071 的 SQL checksum、专用 UUID 列、精确 FK 和资源 CHECK 均匹配已观察的 PG18 结构时，将本迁移的三项已知扩展投影回原 inventory。资源 CHECK 的六个前后 hash 对来自 BASE / MANUAL / INTAKE / BOT × 061 前后的八次隔离 schema-only 准备；不是业务验收或 Gate。

其它列、约束、索引、触发器及未知 CHECK 仍进入原严格 digest；不放宽旧校验、不改旧 SQL。夹具通过既有迁移 Port 在 071 前完成适用的前序迁移，不在启动宿主后倒序重放旧迁移，也不伪造 migration marker。
