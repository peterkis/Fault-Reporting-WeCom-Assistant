# ADR-0054：会话收件箱全局计数与等待起点的只读投影

Status: **Accepted for local read projection implementation — 按用户本次确认口径实施。A3 结束刷新缺口仍为停止待确认；不构成部署、现场或 Gate 批准。**

日期：2026-11-05。范围：PC 管理端 v2.1.6 卡 25A。核查基线：`b4ab3f10c5ea1c10593e8eeed7dd26aa9b8aeb10`。

## 背景与已确认口径

卡 23 的 V1 / V9 / V13 缺少待接待报修人的全局人数、本人的全局未读数、真实等待起点。逐页条数、当前队列及最后一条消息时间不能代替这些事实。保留 [ADR-0032](0032_conversation_inbox_and_rule_admission.md) 的联系人身份、主题边界及释放不恢复规则回复的合同，沿用 [ADR-0052](0052_workbench_service_and_stage_read_projections.md) 的只读投影边界及 [ADR-0053](0053_mvp_delivery_and_test_policy.md) 的验证策略。

用户确认的三条口径原文：

| 口径 | 结论 |
| --- | --- |
| 等待从什么时候算 | 从会话**变成无人接待的那一刻**开始算（首次进入时即为会话开始时刻；被释放 / 转回待接待时为释放时刻）。不是「报修人最后一条消息之后无人回复」。 |
| 统计范围 | 只统计**当前账号可见范围**内的数据，与现有收件箱列表的权限判断完全一致；**不随页面上的筛选、搜索、队列切换变化**。 |
| 刷新方式 | 沿用现有实时推送：凡是现在会让收件箱刷新的事件，也让这些数字刷新；等待时长在前端每分钟重算一次。 |

## waiting_since 的事实来源

`conversation.assignment` 是每 Session 一行的当前责任事实，不是历史表。全仓生产写入仅有 `p2-005-conversation-control.mts` 的 takeover、transfer、release 三条 SQL；普通领取、复合接管和强制转交复用这些路径。

1. 首次进入不保证存在 assignment 行。`p2-001-conversation-contracts.mts` 的创建及入站 coordinator 均只创建 Session；缺行按既有规则视为 UNASSIGNED。取非空的 `session.started_at`，不用 `created_at`、`last_activity_at` 或报修人最后消息时间。coordinator 明确把首次入站的发生时间写进 started_at；普通创建的 started_at 由既有默认值提供。两者可与资料落库时间 created_at 不同。
2. release 成功时必写 `released_at=occurredAt`，将当前状态变为 UNASSIGNED；再次领取/转交时清空 released_at，但同时状态为 ASSIGNED；再次释放时覆盖为最新释放时刻。handoff 释放在同一事务完成。其它控制操作不把 UNASSIGNED 的 released_at 改为别的事件时间；会话结束不改 assignment，必须先排除 ENDED。
3. 没有独立 assignment 历史表；有 append-only `conversation.control_event`，保留 `old_assignment_status` / `new_assignment_status` / `occurred_at` 和每 Session 的 event_ordinal，ASSIGNMENT_RELEASED 可审计最近的转变。当前 UNASSIGNED 的 released_at 已可靠，无需逐行回溯事件、补列或历史表。

定义：非 ENDED 且 `COALESCE(assignment_status,'UNASSIGNED')='UNASSIGNED'` 时，`waiting_since=COALESCE(assignment.released_at,session.started_at)`；其余为 null。所有输出为北京时间 `YYYY-MM-DD HH:mm:ss`。不补写丢失历史，不改业务命令。

chat entry 与 related entry 输出该 Session 的值；收件箱条目按 `(provider,channel_account_id,participant_key)`，在**完整 eligible 可见集合**中取最小非空 waiting_since。先聚合，再与筛选后分页的联系人连接。因此筛选后 anchor 即使已领取或已结束，该联系人另一个可见主题仍可能等待；`matching_topic_count`、原 unread_count、来源及责任摘要仍按本页筛选计算。这是有意的不同口径，25B 的文案不能把联系人等待起点误称为当前筛选主题的等待起点。

新增 waiting_since 在类型/Schema 中为可选只读 nullable，以兼容旧形状的客户端与响应构造；当前服务端总是返回字段（不适用为 null）。实际 chat Schema 为 `workbench_conversation_chat.schema.json`；旧 `workbench_conversation_detail.schema.json` 属于 `/api/conversations/{sessionId}` 的旧详情，保持原合同。summary 是新接口，其成功响应按 A2 明确定义返回非空数字与 as_of；空集合的数字为 0。

**当前客户端兼容限制**：现有 `app/pc-admin/src/features/conversations/inbox-client.ts` 的 exact 守卫按键数量拒绝新增字段，实际旧客户端不会忽略 waiting_since。本次已向用户提出最小解析兼容补丁，用户明确要求“保持不改前端，兼容问题留给 25B”。因此本卡只交付后端；在 25B 更新守卫前，开启 inbox 的当前前端会报 INVALID_RESPONSE。类型/Schema 的可选性不消除此运行时限制，不能声明前后端联调通过或当前 UI 可启用。

## 两个计数与权限复用

新增 `GET /api/workbench/conversations/summary`，只返回 `unassigned_contact_count`、`my_unread_count`、`as_of`。不接受任何 query，包括空值、筛选、分页和重复参数；未知参数沿既有闭合输入规则拒绝，OpenAPI 标记 `x-reject-unknown-query`。成功响应 no-store。

- `unassigned_contact_count`：完整可见集合中至少有一个非 ENDED 且 UNASSIGNED Session 的联系人个数。**必须等于**不带其它筛选、`state=unassigned` 翻完收件箱所有页的联系人数。
- `my_unread_count`：完整可见集合中所有非 ENDED Session、仍在保留期内、EXTERNAL/INTERNAL Item 的 sequence 大于当前 Principal 个人 read_cursor 的数量。**必须等于**不带其它筛选、`state=open` 翻完所有页后各联系人 unread_count 之和。open 覆盖 OPEN 和 WAITING_USER。即使 ADMIN 可见 RESTRICTED 预览，这些 Item 也沿现有收件箱规则不计入 unread_count。ENDED 仍可能保留未读，但不计入此侧栏数字；历史队列可继续显示其原有未读。

复用 `createConversationInbox` 内的 `read()`、`relation()`、`authorization.sessionAccessPredicate()`、真实 currentSessionPredicate 以及最终同快照的角色/团队证明。summary 不复制授权谓词，不改角色/对象 READ，不复用写权限授予读权。计数和等待时间不公开新的身份、群或目标标识。依然受两层默认关闭开关、guard、内部认证及 2000 ms SQL 上限约束。

## 性能与验证

summary 为一条聚合数据 SQL：active CTE 排除 ENDED，distinct 联系人计数与一次 Item/read_cursor 聚合；没有按联系人发请求或查询。沿原 read 的身份/表可用性预检，数据库往返为固定常数，不随联系人增加。等待值也在原收件箱一次批量 SQL 中聚合。合成库捕获实际带最终授权证明的 SQL，执行 `EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)`；计划、数据规模与耗时见[卡 25A 执行记录](../plans/pc-admin-design-v21/card-25a.md)。本卡不加索引/迁移；若实际部署数据出现瓶颈，应另评估 `conversation.item(session_id,sequence_no)` 及保留期选择性，不以小合成库耗时承诺现场性能。

## 实时刷新与未解决项

`useRealtime.ts` 的 conversation-inbox、conversation-chat、conversation-related 等 family 共享既有 realtime refresh。`workbench-realtime-client.mts` 监听 `conversation.assigned`、handoff、`conversation.read_cursor.changed`、`conversation.item.created`、session.updated 等原事件。25B 应把 summary GET 放进既有 `conversation-inbox` family；前端每分钟只重算时间显示，不增加请求轮询或 EventSource。

领取/接管、释放、普通/强制转交在现有控制事务追加 conversation.assigned；个人游标变化追加 conversation.read_cursor.changed；真实入站及回复投影追加 conversation.item.created。结束存在缺口：入站 coordinator 在切换主题时把旧 Session 置 ENDED，未给该旧 Session 追加 session.updated，只会在新 Session 材料投影后产生 item.created。若账号只可读旧 Session 而不可读新 Session，新事件不能保证送达该账号。不能把现有定时重读当作“结束已推送”。

**A3 结束补推送停止待确认**：需在 `p2-g1-inbound-projection-coordinator.mts` 旧 Session 结束的同一事务追加原 `conversation.session.updated`（原 SESSION 授权范围、只含状态/版本），并沿既有 wakeup 在提交后提示。该文件超出本卡写入白名单，且属于 Session 状态写入路径，本卡未改。无需新事件族；后续授权后应覆盖“旧可见、新不可见”及回滚不产生事件。其余编号继续交付。

## A4 通知异常与回退

`GET /api/notification-exceptions` 只有 items / has_more / next_cursor，精确 item GET 也无总数；没有当前可见范围内失败与结果待核对的直接全局计数接口。A4 记为契约缺口，本卡不实现。后续需明确：跨 TICKET/SESSION/INCIDENT 是否按 Delivery 去重；DEAD_LETTER、RECONCILIATION_REQUIRED 及 CANCELLED+UNKNOWN 的纳入规则；保留期、当前 READ 与维护权限的区别；筛选是否影响总数及实时刷新事件。不以页长冒充总数。

本卡不修改前端、数据库、依赖、业务状态/命令或通知发送。关闭既有 inbox/workspace 选项可关闭新增读入口；本地未提交改动可逐文件撤回，保留业务事实和原用户文件。验证结果不推进真实发送、现场写库、部署、P2-G2-LIVE、P2-008、后续阶段或 Gate。
