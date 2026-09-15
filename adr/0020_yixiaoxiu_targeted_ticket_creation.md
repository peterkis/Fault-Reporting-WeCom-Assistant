# ADR 0020：成员入口定向建单运行模式

Status: Accepted

负责人在当前会话授权补齐并验证定向建单模式，随后启动 Bot，由 A/B 经指定群聊及私聊创建测试工单。

使用独立的 `YXX_TARGETED_TICKET_CREATION` 运行配置；不伪造完整 P2-G2 manifest，不改变持久 Feature Flag。范围固定为 A1（A 群聊）、A2（A 私聊）、B1（B 群聊）、B2（B 私聊）各一单，最长 30 分钟。只接收配置中精确文本和成员/群/Bot 组合。使用 Channel Inbox、Service Intake、Ticket Core 原有事务端口，追加 ticket.created 事件和成员只读 public_ref；不建立 Grant，不启动任何发送器、AI、Incident 或 Worker。

每个案例在 Inbox 事务内通过数据库锁和已提交 response_snapshot 去重，包括使用新 msgid 重复发送；配置 run_id、案例及时间窗口不可在重启时改写。数据库独占运行锁和部署单活核验共同限制 Gateway。失败、到期或四案例完成即断开，不自动重连。

公开测试边界为配置验证和定向入站 accept；验证真实隔离数据库中的持久化、并发重复、范围拒绝、到期、原子回滚和无发送副作用。部署前执行独立审查及候选检查。无数据库迁移变更。

关闭方式：停止本次容器；保留测试工单用于成员只读核验，原 OAuth 服务和冻结历史证据不受本模式覆盖。此授权不推进 P2-G2-LIVE、P2-008 或 Gate 状态。
