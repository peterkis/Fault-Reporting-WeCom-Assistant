# 26. P1-007 Notification Outbox 与 Delivery

- 状态：DONE（本机 PostgreSQL 集成验收；非真实外发验收）
- 运行时接缝：`createNotificationOutbox(...)` 与
  `createNotificationDeliveryWorker({ pool, sender, ... })`

## 事务边界

Action 成功时，Ticket 状态、`ticket_event`、`notification.outbox` 和每个目标的
`notification.delivery` 必须在同一 PostgreSQL 事务提交。Outbox enqueue 失败会使
动作、事件和 Delivery 一起回滚；发送失败只改变 Delivery，不回滚已提交的工单事实。

Delivery 幂等键由 event、Ticket、aggregate version、channel、目标哈希和模板组成。
默认目标由可执行通知矩阵决定：创建、受理、开始、待补充、解决、关闭、重开和关闭前
提醒发给申报人及 Pilot 处理组；排队、待厂商、恢复和内部备注只发处理组。矩阵缺项会
失败关闭，内部备注绝不进入申报人单聊。目标均只是要发送的持久化事实。

## Worker

Worker 用 `FOR UPDATE SKIP LOCKED` 与租约领取 Delivery；每次尝试均写入
`notification.delivery_attempt`。超时或 sender 错误会指数退避重试，达到上限后写为
`DEAD_LETTER`。同一租约不会被并发 Worker 二次发送。领取时以 PostgreSQL 事务级目标
锁串行化，并把有效 `SENDING` 租约作为窗口配额预留；随后按 `(channel, target_key)`
统计当前窗口内已 `SENT` 或仍有效租约的 Delivery。超过
`maxDeliveriesPerTargetWindow` 的目标暂不领取，窗口过后才可继续发送。该限流是持久化
发送事实上的逐目标限制，不是客户端收到通知的证据。

## 运行与限制

执行 `npm run p1:007:migrate` 和 `npm run test:p1:007:integration`。`sender` 是显式
注入依赖；本任务没有调用企业微信主动发送 API。因此 Delivery 为 `SENT` 仅说明
注入 sender 成功，不能证明企业微信 ACK、客户端显示、提醒或临床人员收到通知。

接入真实企业微信 sender 后，每个 Attempt 必须在脱敏审计边界记录实际 `provider_errcode`（如有）、稳定内部码和 `ACKED`/`REJECTED`/`UNKNOWN`，并按 `docs/32_wecom_global_error_code_governance.md` 决定等待窗口、受控重建输入或人工处置。它不改变本任务现有 `sender` 注入式本地验收结论。
