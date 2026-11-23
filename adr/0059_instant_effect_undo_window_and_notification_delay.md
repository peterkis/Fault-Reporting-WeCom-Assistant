# ADR-0059：即时生效、撤销窗口与关闭通知延迟

Status: Accepted for implementation (Card 37A: Instant Effect, Undo Window & Delayed Reporter Notifications), 2026-11-22 (Asia/Shanghai). Development stage only; does not change P2-G2-LIVE, P2-008, P2-G3, or P3 stops, and never authorizes live external sends or production deployment.

前向参考：[ADR-0034](0034_mvp_notifications_and_application_members.md)（human-v1 / `mvpPolicy` 通知策略）、[ADR-0056](0056_unified_closure_reasons_notify_and_restore.md)（统一关闭原因、通知矩阵与恢复）、[ADR-0058](0058_completion_and_dismissal_language.md)（完成与关闭术语及状态拆分）。

## 背景与目标

在 PC 管理端第一批效率改进（卡 37A）中，领取、关闭确认与关注属于高频且具备清晰可逆边界的日常操作：等待服务器往返完成才更新界面会让连续处理感到卡顿，而在操作刚完成时的误触（例如领错工单、选错关闭原因）又缺少顺手的短时退回路径。

与此同时，在 human-v1（`mvpPolicy`）下，工单的关闭通知（[ADR-0056](0056_unified_closure_reasons_notify_and_restore.md)）和领取通知（`FIRST_HANDLING`）若在提交后立刻外发给报修人，用户在 5 秒内撤销就会使已发出的外部通知无法收回并打扰报修人。

## 决定

### 1. 适用范围（A1）

只有以下三项高频操作进入即时生效与 5 秒撤销窗口；其余高后果或涉及他人提醒的操作维持原确认与往返提交流程不变：

| 操作 | 即时生效 | 5 秒撤销窗口 | 说明与原因 |
| --- | --- | --- | --- |
| 领取（`take-and-start`） | 是 | 有条件支持 | 卡片立即移入「处理中」并展示当前处理人；仅当账户具备退回调度权且新状态允许 `return-to-dispatch` 时显示「撤销」 |
| 关闭（点「确认关闭」后 `dismiss`） | 是 | 支持 | 弹窗立即关闭、事项移入「已处理 · 已关闭」；按关闭通知矩阵延迟 10 秒外发 |
| 关注 / 取消关注（`follow`） | 是 | 支持 | 仅改变本人关注，不涉及他人或外部通知 |
| 恢复（`restore`） | 否 | 否 | 低频且需再次确认回到关闭前状态；若仍需关闭可再次选择原因 |
| 完工（`complete`） / 重开（`reopen`） | 否 | 否 | 完工前有确认步骤且可能触发通知；重开会开启新一轮处理轮次 |
| 转交 / 派单（`transfer` / `assign`） | 否 | 否 | 涉及跨人或跨组责任交接与即时协作感知 |

### 2. 纯展示层乐观覆盖（`features/optimistic/`）

1. **禁止写入 React Query 缓存**：所有未确认前的乐观移动、状态、关注标记与排序恢复均保存在独立展示覆盖层 store（`app/pc-admin/src/features/optimistic/`），绝不篡改 React Query 查询缓存。移除覆盖层即可无污染退回官方服务端投影。
   覆盖层仅作用于当前读视图返回的事项。切换搜索、范围或过滤条件时，旧快照不能补入新结果。
2. **复用 36B 卡片动效**：切换前调用 `markSelfWrite`，由既有 `board-motion.ts` 执行纯位移动效（无到达高亮）。提交确认后维持 `confirmed` 占位直到最新服务器看板/详情查询赶上并交接，避免同一动作重复播放第二次 FLIP。
3. **「确认中」延迟标记**：仅当挂起超过 `150ms`（`--load-delay`）时在卡片 `.card-meta` 与列表 `.ds-list-tags` 渲染中性徽标「确认中」（10px 加载图标 + `--tone-neutral-*`，不触碰 37C 负责人名牌与列表负责人单元格），最小展示 `300ms` 防止闪烁；挂起期间阻止同一事项重复触发同一动作，不阻断打开详情查看。
4. **明确失败回退**：服务端明确拒绝（如 409 版本/抢单冲突、403、草稿预检失败）时移除覆盖层，卡片按 36B FLIP 退回原位，原卡/行外框按 `--dur-return` 闪现一次危险色提示（`rollback-cue.ts` / `--tone-danger-dot`），并弹出含原因（如「{姓名}刚刚已经领取了这张工单」）与「查看」按钮的错误 Toast；关闭失败同时重新打开关闭弹窗并完整保留表单输入与草稿。
5. **网络中断或超过 8 秒转入「结果未确认」**：超过 `OPTIMISTIC_UNKNOWN_TIMEOUT_MS`（`8000ms`）或请求以未知错误结束时，保留当前覆盖层并中止等待，无缝交接给原控制器的 `unknown` 流程（「重新提交」/「核对结果」），不显示撤销按钮，直到核对或重放达到终态。
6. **断网保护**：当 `workbenchTransportWritable()` 为 `false` 时，不应用乐观覆盖，保持既有断网提示与拦截。

### 3. 撤销 = 真实反向操作（A3）

1. **交互时序**：操作确认后弹出底部带 `2px` `--border-strong` 倒计时条（由 `requestAnimationFrame` 驱动，不注册有限 CSS/Web 动画以避免阻塞测试动画等待）的成功提示，`5 秒`（`UNDO_TOAST_MS`）内展示「撤销」按钮；单条提示悬停或内部聚焦时暂停倒计时，最长停留 `10 秒`（`UNDO_TOAST_MAX_VISIBLE_MS`）后隐藏「撤销」按钮并按普通成功提示关闭。
2. **快捷键**：非输入框/模态框状态下，`Ctrl + Z` / `⌘ + Z` 仅撤销最新一条仍处于撤销窗口内的操作；输入框/文本域内保留浏览器原生文字撤销。
3. **审计与历史保留**：撤销不是擦除历史，而是一次真实的新写命令：原动作事件与撤销反向事件**两条均如实保留**，不新增事件类型或修改历史事件结构。撤销完成后弹出 `4 秒` 普通提示「已撤销」，不提供「重做」。

撤销前核对本次操作回执。领取须仍由本人负责并匹配领取版本，关闭须匹配关闭版本，关注须匹配本人该次关注版本。反向命令沿用该版本作为并发条件。

### 4. 关闭通知延迟与撤回（A4）

1. **10 秒投递延迟**：在 `app/server/src/service-closure-notifications.mts` 中，对人工/系统关闭且选择通知报修人（`!restoring && notify_reporter`）生成的 `WECOM_AIBOT` `PERSON` 投递，在创建后同事务通过 `delayDeliveryInTransaction` 将 `communication.delivery.next_attempt_epoch_ms`（及 ARCH-005 成对 `next_attempt_at`）设为 `closureEventEpochMs + closureNotificationUndoWindowMs`。
2. **可配置窗口常量**：服务端定义 `DEFAULT_CLOSURE_NOTIFICATION_UNDO_WINDOW_MS = 10_000`（上限 `3_600_000`，允许 `0` 用于测试即时投递），通过 `human-workbench-configuration.mts` 与 `createP2016Runtime` 传入 APP 实时投影器及 WORKER 补偿投影器（不暴露给 GATEWAY）。
3. **窗口内恢复不发关闭也不发恢复通知**：在 10 秒窗口内执行 `restore` 时，复用既有 `cancelUnattemptedDeliveryInTransaction`（原因码 `CLOSURE_RESTORED_BEFORE_NOTIFICATION`）取消尚未尝试发送的 `NOT_ATTEMPTED` 闭合投递，并因原关闭未曾送达而跳过恢复通知（`CLOSURE_NOT_NOTIFIED`）。

### 5. 超出卡片正文的用户补充决策（Binding）

以下三项为本卡实装中拍板并具约束力的用户决策：

1. **领取 `FIRST_HANDLING` 通知同样进入 10 秒撤销窗口**：
   - 在 human-v1（`mvpPolicy`）下，`app/server/src/workbench-ticket-round-notifications.mts` 为 `take-and-start` 创建的 `FIRST_HANDLING` Bot 或企业应用渠道的 `PERSON` 个人通知，创建后在同事务将 `next_attempt_epoch_ms` 设为 `claimEventEpochMs + claimNotificationUndoWindowMs`（默认 `DEFAULT_CLAIM_NOTIFICATION_UNDO_WINDOW_MS = 10_000`，**从领取事件本身的发生时间 `e.created_at` 起算**，而非 Worker 扫描时间）。
   - 若在 Worker 扫描之前已经发生同轮次、领取窗口内的后续 `ticket.returned_to_dispatch` 事件（`re.aggregate_version > claim.aggregate_version` 或同版本更高 `event_ordinal`），`workbench-ticket-round-notifications.mts` 直接跳过创建，不再为这次已被撤销的领取生成 `FIRST_HANDLING` 通知。
   - 若在领取窗口内退回且 `FIRST_HANDLING` 的 Bot 或企业应用 `PERSON` 投递已经生成并处于 `NOT_ATTEMPTED`（`PENDING` / `LEASED` / `DEAD_LETTER`），`app/server/src/workbench-ticket-return-to-dispatch.mts` 在记录 `ticket.returned_to_dispatch` 之后按锁顺序（`ticket` → `ticket_handling_cycle` → `communication.delivery`）通过 `cancelUnattemptedDeliveryInTransaction` 撤销该投递，原因码为 `CLAIM_UNDONE_BEFORE_NOTIFICATION`。
   - `STAFF_COMPLETED`、`FIRST_RESPONSIBILITY`、群消息推送保持原有时机。窗口按数据库中的事件时间判断，退回时间须早于截止点。窗口为 0 时保留原有投递；`closureNotificationUndoWindowMs` 与 `claimNotificationUndoWindowMs` 在 `notification-undo-window.mts` 中作为并列配置常量与辅助函数维护。
   - **既有 Schema 边界说明**：迁移 063 触发器 `guard_ticket_round_notification_binding()` 规定同一 `handling_cycle` 的 `FIRST_HANDLING` 只能绑定该轮次**首次** `PILOT_USER` 领取事件；因此同一轮次若首次领取在投递前被退回且未生成通知，同轮次再次领取仍受既有首次事件绑定约束而不另行补发首接通知（本 ADR 不改动迁移 063 与轮次绑定规则）。

2. **领取撤销执行的真实命令与权限门控**：
   - 领取后的工单处于 `IN_PROGRESS`，撤销必须调用既有退回调度接口（`api.returnTicket`），附带新的 `client_command_id` 与领取回执中的 `ticket_version` 作为 `expected_version`，字段固定填写为：
     - `reason_code`: `'WORKBENCH_RETURN_TO_DISPATCH'`
     - `reason`: `'撤销领取'`
     - `unfinished_work`: `'刚领取即撤销，尚未开始处理'`
     - `communication_choice`: `'RETAIN_CURRENT'`
     - `communication_target_principal_id`: `null`
     - `sessions`: `[]`
   - **Toast 撤销按钮门控**：仅当同时满足 `principal.ticket_return_to_dispatch_enabled === true`、`principal.roles` 包含 `ADMIN` / `DISPATCHER` / `HANDLER`，且领取提交后查询的最新 `allowed_actions` 包含 `'return-to-dispatch'` 时，成功 Toast 才显示「撤销」按钮；否则仅显示普通成功 Toast「已领取」，不提供撤销。
   - **列表 / 看板原位还原约束**：客户端展示覆盖层记录领取前卡片在列内/分组内的邻居锚点（`beforeKey` / `afterKey` / `index`），撤销后立即插回原位；**不修改服务端 `web01-workbench-query.mts` 的 `updated_at DESC` 排序规则**（刷新重拉列表视图时退回操作更新后的 `updated_at` 在纯服务端排序下位于列首，客户端位置固定锚点仅在当前展示态生效）。

3. **一键领取冲突**时，卡片回到原位，只显示失败 Toast 和「查看」，看板可继续操作，其他意图的冲突保留原操作冲突栏。

## 不做什么与回退

- 不新增后台事件类型，不修改数据库表结构与迁移，不改变任何接口权限检查。
- 不为关闭/领取增加客户端本地持久化的“离线撤销队列”；切换同一工作台视图中的详情抽屉或详情页保留原撤销时限，离开工作台或刷新页面后退出本次撤销窗口，事项本身仍可通过详情页「退回调度」或「已关闭 → 恢复」继续操作。
- **回退**：客户端恢复仅需移除 `features/optimistic/` 调用与 Toast/快捷键扩展；服务端可将 `closureNotificationUndoWindowMs` / `claimNotificationUndoWindowMs` 设为 `0` 关闭延迟或回退相关服务端模块改动，无任何数据库迁移需要撤销。
