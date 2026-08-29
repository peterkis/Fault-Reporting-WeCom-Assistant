# 27. P1-008 首次确认与可靠回执

- 状态：DONE（本机 PostgreSQL 集成验收；非客户端可见验收）
- 运行时接缝：`createFirstAcknowledgementService({ inbox, processor, deliveryWorker })`

服务先调用 Inbox 的持久化处理器；只有 `accept` 返回成功后，才尝试领取首次确认的
Delivery。创建 Ticket 的首个 Delivery 成功时才返回 `TICKET_CREATED`、真实
`ticket_no` 和“等待受理”状态。

重放不会重复创建或发送；已经发送时返回 `ALREADY_DELIVERED`。临时失败或未领取时返回
`PENDING`，同时给出基于已提交 Ticket 的 `TICKET_CREATED_DELIVERY_PENDING` 临时回复：
只包含真实编号、真实对外状态及 `temporary: true`，不暗示已送达；未创建 Ticket 时返回
`NO_TICKET`，不编造编号或“处理中”事实。结果含 `first_ack_delivery_latency_ms`；它是
本机 worker 延迟，不是客户端到达时间。

执行 `npm run test:p1:008:integration`。该服务不调用真实企业微信回执接口，不能以
事务提交、Delivery 状态或 SDK ACK 推断客户端可见性。
