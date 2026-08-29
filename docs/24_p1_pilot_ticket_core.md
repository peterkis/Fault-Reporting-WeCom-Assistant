# 24. P1-005 Pilot Ticket Core 模型与编号

- 状态：DONE（本机 PostgreSQL 集成验收；非公网/临床试点验收）
- 依赖：P1-004 Service Intake
- 运行时接缝：`createPilotTicketCore({ pool })` 与 `createPilotTicketProcessor(...)`

## 输入与输出

输入是已经在 Inbox 事务内持久化的 `Service Intake`。只有 `INCIDENT` 和
`SERVICE_REQUEST` 且处于可受理状态的 Intake 创建 Ticket；咨询或无效请求保留
Intake 事实但返回 `ticket: null`。

输出是独立的 `pilot_ticket.ticket`：`IT-YYYYMMDD-NNNN` 编号、`QUEUED` 初始状态、
`PILOT_IT` 默认处理组、版本和对外“等待受理”状态。创建同时把 Intake 更新为
`TICKET_CREATED` 并追加 `intake.ticket_created` 审计事件。

## 不变量

- `ticket.source_intake_id` 与 `intake.pilot_ticket_id` 是同一一对一关系；延迟触发器
  在提交时验证两端一致。
- 同一 Inbox 重放返回原始处理结果，不重复创建 Ticket。
- Ticket 编号唯一冲突稳定映射为 `PILOT_TICKET_NUMBER_CONFLICT`；失败不能留下第二个
  Intake 关联。
- 不调用 Hospital Tickets、Ticket Adapter、医院 SSO、医院 Hub、院内 Outbox 或 AI/OCR。

## 运行与限制

执行 `npm run p1:005:migrate` 和 `npm run test:p1:005:integration`。测试使用合成
Normalized Message 与本机 PostgreSQL，只证明数据库事务和领域边界；不证明公网、
真实企业微信、客户端可见性或临床试点。
