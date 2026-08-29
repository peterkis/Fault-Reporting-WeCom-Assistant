# 25. P1-006 Pilot Ticket 状态机、Action 与事件

- 状态：DONE（本机 PostgreSQL 集成验收；非公网/临床试点验收）
- 运行时接缝：`createTicketActionService({ pool, authorize, afterAction })`

## 明确动作

实现只接受 `accept`、`start`、`request-information`、`resume`、`wait-vendor`、
`resolve`、`confirm`、`reopen`、`cancel`、`auto-close` 和 `add-note`。没有通用
状态 PATCH 接口。`auto-close` 仅接受 `SYSTEM` actor，且 P1-009 的人工处理端在路由层
直接拒绝该入口。

每次动作要求 `ticketId`、`expectedVersion`、actor 与 `traceId`。行锁和版本条件
确保旧页面、并发接单与卡片重复点击返回 `TICKET_VERSION_CONFLICT` 或
`INVALID_STATE_TRANSITION`，而不是覆盖已发生的事实。

## 事件与可见性

每次成功动作追加 `pilot_ticket.ticket_event`，包含旧/新状态、事件序号、聚合版本、
operator、原因码和附件标识。`internal_note` 与 `external_note` 分列保存；后者才可
进入对申报人的通知。

P1-010 扩展了 `CLOSED -> REOPENED -> IN_PROGRESS`，`CANCELLED` 仍不能借此绕过
处置。`DUPLICATE_LINKED` 是 Phase 2 Incident 事实建立后的保留状态；P1 不提供
`link-incident` 或 `unlink-incident`，也不创建 Incident 数据或医院关联。

## 运行与限制

执行 `npm run p1:006:migrate` 和 `npm run test:p1:006:integration`。授权策略由注入的
Pilot 策略决定；P1-006 不接入医院身份、Hospital Tickets 或真实通知发送。
