# P2-012 个人订阅与恢复

ReporterSubscription 在 Incident + P2-015 reporter_identity_hash 上唯一。该 HMAC binding 是现有身份权威；本任务不创建 person 表，不使用同 userid 加相近时间关联。一个人群聊/单聊、多个 Intake、多个 Ticket 可保留多个 Reports，同时只占一条 Subscription。

没有实际 DIRECT_GUIDED/DIRECT_ORGANIC leg 时为 PENDING_DESTINATION，不由群聊 userid 猜出单聊目标。管理员可在界面选择同 HMAC binding 的已验证本人单聊渠道后显式激活；人工确认/Link 本身选入真实单聊 Report 时也可激活待目的地订阅。PAUSED 不被后续 Link 自动恢复。暂停、恢复、结束和 relink 都有版本围栏与审计。

定向现场使用 `APPROVED_GROUP_PARTICIPANTS`：配置只冻结批准测试群的 SHA-256，不要求逐人预登记 userid。带 `【P2-012测试】` 的群入站先在批准群中持久化 Reporter 事实；同一 bot、同一 Reporter 的后续带标签单聊才可进入。私人目的地仍必须来自该 Reporter 的实际 DIRECT leg，Sender 每次发送前重新核对其批准群入站事实。未在批准群出现、群外来源、缺少测试标签或只有群聊而无 DIRECT leg 的用户均失败关闭。

个人恢复只改变被选中的 IncidentReport 和该人的 Subscription impact_state。其他 Report、其他 Subscription、Incident.status 与任何 Ticket.status 保持不变。同一人的其他报告仍保留自己的影响状态。Incident resolved/closed 不确认或关闭个人 Ticket。

Reporter 身份继续由 P2-016 一次性 HMAC grant 和绑定 session 校验。Incident Adapter 只接收已认证 Ticket ID，输出当前仍 LINKED 报告对应的公共确认/调查/恢复/关闭四类里程碑，最多最近100条，按业务时间和 ordinal 展示。候选、责任人、聚类 hash、其他上报人、内部原因、原文、目标地址、Provider 错误均不输出。解除关联后停止展示该 Incident；个人工单和原时间线保留。

现有详情 ETag 包含里程碑结果，因此 Incident 变化/解除关联会让刷新失效缓存。前端不用本地时区 Date 转换，不保存能力 token，不通过 Ticket ID 或 Incident ID 绕过 Reporter 会话。
