# 29. P1-010 补充、解决确认、关闭与重开

- 状态：DONE（本机 PostgreSQL 集成验收；非真实卡片/临床闭环验收）
- 运行时接缝：`createTicketClosureService(...)` 与
  `createTicketLifecycleProcessor(...)`

## 补充与卡片任务

申报人补充使用已持久化的 Channel Message；系统通过 `ticket_supplement` 防止同一消息
重复追加，并在等待补充时恢复至 `IN_PROGRESS`。请求补充和解决会创建
`notification.card_action_task`；actor、过期时间、预期版本、任务消费状态和
`event_req_id` 共同限制回调。

重复卡片事件返回 `card_action_receipt` 的首次响应快照；错误用户、错误 action 或过期
任务不会修改 Ticket。解决后先在 `auto_close_reminder_at` 记录一次关闭前提醒，并通过
Outbox 产生 `ticket.auto_close_reminder`；只有提醒已记录且到期后，才可由 `SYSTEM` 执行
`auto-close`。关闭原因明确写为 `AUTO_TIMEOUT` 而非用户确认。确认关闭或重开会清除未到期
的自动关闭/提醒时间。

## 组合

完整生命周期处理器在创建 Ticket 时同时追加 `ticket.created`、Outbox 和 Delivery，且
把 `delivery_ids` 暴露给 P1-008 的提交后首次确认服务；后续补充同样在原 Inbox 事务内
写 Ticket Event 与 Outbox。

执行 `npm run p1:010:migrate` 和 `npm run test:p1:010:integration`。卡片任务是本地、
持久化的回调处理契约；没有发送真实企业微信模板卡片，也没有真实客户端显示、点击或
临床人员闭环观察。
