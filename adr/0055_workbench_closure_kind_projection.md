# ADR-0055：工作台结束方式的只读投影

Status: **Accepted for the authorized local read projection; 写入侧原因与恢复方案为 Draft / 停止待确认。**

日期：2026-11-06（Asia/Shanghai）。范围：卡 27A。核查基线：`702f80d653f0c96f6febd7404c58834246427fe7`。本卡不提交、不推送、不创建 PR，不构成部署、现场或 Gate 批准。

## 背景

第三列「已处理」混合了完成与关闭，且默认排除已取消工单。按用户确认，保留三列，提供「已完成」「已关闭」分组的读取事实，界面由 27B 实现。沿用 [ADR-0052](0052_workbench_service_and_stage_read_projections.md) 的最终 READ 证明和 [ADR-0053](0053_mvp_delivery_and_test_policy.md) 的风险验证。对本投影直接更新合同与前端解析，不沿用 [ADR-0054](0054_conversation_inbox_counts_and_waiting_since.md) 的 opt-in 字段协商。

## K1 现状核对

代码位置以本地候选为准；未改写的命令位置也对应上述基线。合成验证沿既有 `withWeb01Fixture` / Seed / DecisionPort / appendTicketEvent，原始回执见执行记录。

1. **待判断事项的人工处置**：`app/pc-admin/src/features/manual-review/client.ts:6` 有 `MARK_OUT_OF_SCOPE`（记录范围外诉求）和 `CANCEL_REVIEW`（取消此复核）；`ReviewWorkspace.tsx:23` 为固定原因选择，`:123` 提交结论及原因码（允许全部八项，不仅结论的默认项）。HTTP 为 `POST /api/manual-reviews/{reviewId}/resolve`（`app/server/src/p2-016-workbench-http.mts:153` 分派），经 `p2-016-manual-review-facade.mts:115` normalize、`:129` authorize 和 `:138` runResolution；`:151` 在工作台处置路径加入 `APPLY_INTAKE_CLASSIFICATION`。`p2-015-manual-review.mts:33` 与 `p2-015-service-intake-decision-port.mts:14` 最终使 Intake → `IGNORED`，Review → `RESOLVED`。权限复用 facade `:74` 的 Journey READ 和 `p2-016-ticket-query.mts:37` 的广域谓词：未关联 Ticket 的待判断事项仅当前有效 ADMIN / DISPATCHER 可操作，普通 HANDLER 不因此获权。

   原因是 **UI 固定选项、服务端格式串**，不是完整关闭业务枚举：`contracts/p2_016_manual_review_resolution.schema.json:39` 及 facade `:133` 只校验 code 格式。`p2-015-manual-review.mts:244` 保存 human_override / reason，`:271` 保存 Review.resolution_code / resolution_reason_code / resolved_by_principal_id / resolution_decision_id / resolved_at；DecisionPort `:51` 追加 `intake.rule_decision_applied`，payload 含 decision_id、old/new status、reason_code。无 Ticket 时不产生 Ticket Event。`CANCEL_REVIEW` 在 manual-review `:240` / `:270` 仅使复核取消，Intake 仍 WAITING_TRIAGE。

   手工/自动可用该同 Intake decision_id、HUMAN_OVERRIDDEN 与匹配的已解决 Review/actor 区分；不能按相同事件类型猜系统。初始 CHATTER 自动忽略见 `p1-004-service-intake.mts:106`，`:451` 的 intake.received payload 保存 status。合成结果：真实 MARK_OUT_OF_SCOPE 得 IGNORED / MANUAL / OUT_OF_SCOPE_CONFIRMED；真实自动 OUT_OF_SCOPE 得 IGNORED / SYSTEM / reason_code=null，任意文本原因不投影。另以旧观察时刻人工处置验证 closed_at 取 Review.resolved_at，Journey 到期后时间/来源变 null。

2. **取消工单**：`app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx:18` 用技术码 CANCELLED_BY_STAFF，`:74` / `:100` 要求自由文本 note；界面说明仅内部记录。`POST /api/tickets/{id}/cancel`（`p2-016-workbench-http.mts:161`）经 `p2-016-ticket-command-facade.mts:65`，Core `p1-006-ticket-state-actions.mts:100` 只允许 QUEUED / ACCEPTED → CANCELLED。`p2-016-ticket-query.mts:49` 允许 ADMIN / DISPATCHER，HANDLER 的动作清单不含 cancel。Core `:578` / `:595` 存 Ticket.closure_reason（技术 reasonCode），`:615` 追加 ticket.cancelled 的 reason_code / internal_note / actor，external_note 保持 null；自由文本在事件而不是 closure_reason。

   前端及 `ticketWaitingActionsEnabled=true` 的等待操作流程必填说明；未启用该选项的旧通用 facade 仍允许省略 note（command-facade `:65`–`:72`），本卡原 HTTP 用例保留了此情况，缺失文本返回 null。技术 reason_code 不能解释为用户选择的业务关闭原因。

   通知不能答成「永不通知」：当前 runtime `p2-016-runtime.mts:217` 接入 `notifications.project`，`p2-016-ticket-notification-policy.mts:6` 默认仅 accepted / closed，取消只有显式 AdditionalEvents 配置才纳入；projector `:39` 另对 Web / 手工代录短路。旧 P1 `p1-007-notification-outbox.mts:155` 默认 cancel reporter/team=true，属于另一旧路径。合成结果：真实取消 QUEUED 得 CANCELLED、内部原文和操作人可读；既有 T10 验证 QUEUED / ACCEPTED、HANDLER 拒绝、DISPATCHER 成功与投递数不变，当前候选是否运行见执行记录。

3. **重复单关联**：`p1-005-pilot-ticket-core.mts:29` / `:73` / `:88` 有 DUPLICATE_LINKED 状态（旧展示甚至为已关联公共故障），`p1-006-ticket-state-actions.mts:47` 有事件类型；实际 Ticket / Event Schema（`database/migrations/003_p1_005_pilot_ticket_core.sql:19`、`004_p1_006_ticket_state_actions.sql:3`）没有 duplicate_of 字段。生产路径检索未找到关联原单的写入或 payload。Incident 不是原 Ticket，无法取原单编号。合成结果：按既有 fixture 写状态、appendTicketEvent 写事件后得到 DISMISSED / 重复 / duplicate_of=null；这不是已实现重复关联的证明。

4. **恢复**：Core `p1-006-ticket-state-actions.mts:95` 的 reopen 只从 RESOLVED / CLOSED → REOPENED；`features/ticket-reopen/TicketReopen.tsx:81` 接入此命令，`ticket-reopen-rounds.mts:40` / `:54` 提供已有完工轮次重开。CANCELLED / DUPLICATE_LINKED 不在 from 集合，IGNORED 是 Intake，三者没有恢复操作。合成结果：真实取消及合成重复的原 allowed_actions 均不含 reopen，三类 closure.can_restore=false；权限单测覆盖原 HANDLER 同组本人、失组、非本人、inactive 与 ADMIN，Intake COMPLETED 同样 false。

5. **完成统计**：`app/pc-admin/src/design/board-presentation.ts:17` 只判断第三列、合法 completed_at 和同日，不查 kind；本卡保留该消费者。H5 `yxx-self-service-query.mts:290`、`yxx-h5-batch-sql.mts:79` 的 COMPLETED 筛选包括 CLOSED / CANCELLED / DUPLICATE_LINKED / RESOLVED；`yxx-h5-v2-profile.mts:71` 和 batch SQL `:85` / `:98` / `:104` 的 total / active_count 也把这些当非活跃项。Intake IGNORED / COMPLETED 在 self-service-query `:129` 映为 NOT_SERVICE，不是 Ticket 完成数。当前源码与 docs/api 检索未发现独立月报或完成率接口。合成测试显式验证同日 CLOSED / CANCELLED / DUPLICATE_LINKED 都命中现有 today，IGNORED 且无 completed_at 不命中。已有后端口径与未来月报列待决，本卡不修改。

## closure 合同与来源

所有 board / detail / search 卡片必含 `closure`，第一、二列为 null；第三列为对象。字段沿现有 snake_case，时间为北京时间 `YYYY-MM-DD HH:mm:ss`。不增加状态、写命令、存储或权限。

| 状态 | kind |
| --- | --- |
| RESOLVED / CLOSED / COMPLETED | COMPLETED |
| CANCELLED / DUPLICATE_LINKED / IGNORED | DISMISSED |

对象含 `kind`、`source: MANUAL | SYSTEM | null`、nullable `reason_code` / `reason_label` / `reason_note` / `closed_by_display_name` / `closed_at`、`duplicate_of: {display_no} | null` 和 `can_restore`。

- Ticket：只采用进入当前状态的真实事件（按 aggregate_version / event_ordinal），PILOT_USER / REPORTER 为 MANUAL，SYSTEM 为 SYSTEM；缺证为 null。只查现有 Principal 展示名，不公开 operator_id。reason_note 取该事件已有 internal_note，同一 Ticket READ 的详情本来可见；无权对象不返回卡片。
- Intake：状态变更事件的 decision_id 必须连接同 Intake 的 decision。人工来源须同时有 HUMAN_OVERRIDDEN、匹配的 human_override principal 与已解决复核；自动 decision 不含人工覆盖才可标 SYSTEM。无证据不按状态猜来源。人工 closed_at 必须取同一 Review.resolved_at：旧 BOT 写入会复用 Decision.observed_at（manual-review `:267`、safe-action-executor `:107`，facade `:186` 仅给 appOnly 补内存 applied_at），本卡不改写入。Journey 到期或证据不完整时，来源及人工关闭时间为 null，不回退到旧 observed_at / occurred_at。
- 自动后续分类的 SYSTEM 来源可证明，物理关闭时刻不可据输入时间证明：`p2-015-rule-first-orchestrator.mts:169` 取 last_message_at，safe-action-executor `:107` / `:165` 传 observed_at 并作为 executed_at；`yxx-self-service-orchestrator.mts:399`–`:419` 传 latest.received_at。decision.created_at 仅为插入时刻，action.executed_at 还可被 markAction 重试覆盖，不能替代关闭事实。因此该分支 closed_at=null，按未知时间处理；实际关闭时间的写入留给后续卡评估。
- 初始创建即 IGNORED 是独立事实：仅匹配该 Intake 的初始 intake.received、aggregate_version=1 / event_ordinal=1、payload.status=IGNORED 时，才使用不可变 Intake.created_at（p1-004 `:386` 的 INSERT 同时确立该状态，未传 created_at；022 默认 platform.local_now()）。这不是一般 created_at 回退，后续 rule_decision_applied 不适用。
- 不返回任意事件 payload 或任意格式合法 reason_code。只解释已有复核 UI 的固定原因白名单；取消技术码不能充当业务原因枚举。无枚举时用「已取消」「重复」「系统判定不受理」「已关闭」默认名。Intake 详情目前不展示原因文本，因此 reason_note 恒 null。既有命令允许非空但全空白的说明/人员名，投影将这些无展示内容的值归一为 null，原记录不改，非空白文本保留原字节语义。
- DISMISSED 的 can_restore 恒 false。仅 Ticket 的 RESOLVED / CLOSED 在当前既有 reopen 权限满足时为 true；Intake COMPLETED 无 reopen。投影不授予写权，执行仍沿原命令终检。

## 日期、计数、分页与筛选

第三列默认同时读取两组（含 CANCELLED），总集合先过当前 READ、责任范围和日期条件，再计算 `group_counts: {completed,dismissed}`，之后分页。每页返回同一完整匹配集合计数，空页也返回零或匹配集合实际总数。最终同一 SQL 保留原身份/角色/会话/对象 READ 终检，并用同一初始分页 SQL 重算当前有序前缀（含排序键和 limit+1 哨兵）；与初始前缀不同则返回原 VERSION_CONFLICT 409，覆盖等待期间新增匹配、移出集合、排序/后续页边界变化，避免新计数与旧 next_cursor 混合。没有额外数据库往返。已关闭用可证明的关闭时间筛选，不以 updated_at 推断关闭；缺时间仅 all / cancelled 可见。已完成保留既有 RESOLVED 未最终关闭仍展示的语义。

`cancelled` 模式暂保留，只返回 CANCELLED，原本不带日期限制；由 27B 处理界面及移除。无 include_* / closure_groups 等兼容开关。closed 列必须有 group_counts，其它列不返回。

列表 `closure_kind=completed|dismissed` 为可选参数，省略不增响应 criteria 键；只筛选第三列状态，第一、二列状态保持原结果。与 q / 状态 / 责任 / 来源等条件取交集，游标绑定规范筛选身份，未知值、空值和重复参数拒绝。

## S1–S4 状态与后续写入侧方案

| 项 | 状态 | 本卡处理与后续方案 |
| --- | --- | --- |
| S1 | 停止待确认（统一业务关闭原因缺失，取消仅自由文本） | 只读已有复核固定选项，其它 reason_code=null。27C 可提议误报或测试、重复报修（必关联原单）、非 IT 范围、报修人撤回、无法联系报修人、其他（必说明）。需更新复核/取消命令输入守卫及事件，评估统一原因与 duplicate_of 的增量迁移；旧记录按可证明事实映射，无法证明保持未知，不从文本猜枚举。 |
| S2 | 已确认无需修改现有范围外入口；通用关闭停止待确认 | 待判断确有人工范围外复核，可投影；尚无误报/测试/重复/撤回等统一关闭入口，这部分只为 27C 写方案，不能把 CANCEL_REVIEW 改成关闭。 |
| S3 | 停止待确认（DISMISSED 无恢复） | can_restore=false。27C 需明确恢复目标（如 WAITING_TRIAGE 或 QUEUED）、原责任/版本/轮次、幂等与权限、追加事件及通知策略；不借用当前完成工单 reopen 跳过状态合法性。 |
| S4 | 来源无需新增存储；自动关闭时间缺口保留 | 有现有事件/decision/复核证据时给来源；缺证据返回 null。自动后续分类缺实际关闭时间则 closed_at=null，不能拿输入时间冒充。27C 若要求补齐，应在实际状态转换事务记录 actor/source/实际关闭时刻，保留历史未知。 |

## 待决事项、风险与回退

完成统计口径需单独决定前端今日完成、H5 COMPLETED/active_count 与未来月报是否按 kind 分开；27A 不改这些消费者。重复关联无法交付编号；完整业务原因与恢复写入侧未实现。

投影与计数复用现有查询和最终当前主体/角色/团队/会话/对象 READ 证明；不得按卡追加查询或读取生产配置。查询计划、实测规模、验证、截图、文件与资源记录见[卡 27A 执行记录](../plans/pc-admin-design-v21/card-27a.md)。本地未提交改动可按本卡文件撤回，保留原型及历史证据。无迁移、依赖、默认 Flag 或写入事实变化。
