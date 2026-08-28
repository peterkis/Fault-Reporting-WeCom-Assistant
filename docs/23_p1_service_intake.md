# 23. P1-004 Service Intake 创建与消息聚合

- 状态：DONE（本机 PostgreSQL 集成验收；非公网/临床试点验收）
- 范围：只创建/追加 Service Intake、Channel Message 关系和 Intake 审计事件；不创建 Pilot Ticket、Incident、Notification Outbox、AI/OCR 或 Hospital 集成。
- 架构依据：`AGENTS.md`、`docs/architecture_baseline_status.md`、`docs/04_domain_model.md`、`docs/05_recognition_conversion_rules.md`、`docs/09_data_model.md`。

## 输入与输出

| 类别 | 内容 |
| --- | --- |
| 输入 | P1-003 已持久化的 `Channel Message`、含边界的 90 秒聚合规则、确定性请求类型规则。 |
| 输出 | `ServiceIntake`、`PRIMARY / SUPPLEMENT / CLARIFICATION` 消息关系、Intake 审计事件和 JSON 可序列化的首次处理结果。 |
| 不输出 | Ticket、工单号、Incident、通知/回复、Outbox、AI/OCR 结果、医院身份或 Hospital Tickets 映射。 |

P1-004 的唯一运行时 seam 是 P1-003 首次处理回调：

```js
const inbox = createChannelMessageInbox({ pool });
const processIntake = createServiceIntakeProcessor();
const result = await inbox.accept(request, processIntake);
```

P1-003 把 `{ channelMessageId, message, transaction }` 交给处理器。处理器只能使用该事务查询接口，因此 Channel Message、Intake、关系、事件和首次结果快照全部提交，或全部回滚。重复 `(provider, msg_id)` 不再次执行处理器，而是返回已提交的原结果。

## 数据库边界

迁移 `002_p1_004_service_intake.sql` 创建：

| 关系 | 职责 | 关键约束 |
| --- | --- | --- |
| `intake.service_intake` | 一次服务受理上下文 | UUID 主键、唯一 `intake_no`、唯一主消息、显式新上下文边界、请求类型/状态/版本检查、聚合隐私与留存边界。 |
| `intake.service_intake_message` | Intake 与 Channel Message 的显式关系 | `channel_message_id` 全局唯一；同 Intake 的 `sequence_no` 唯一。 |
| `intake.service_intake_event` | 同事务 Intake 审计事实 | UUID 事件 ID、受限事件类型、正版本、对象型 JSONB payload。 |

`INT-YYYYMMDD-NNNN` 使用 PostgreSQL 序列生成，宽度至少为 4，超过 `9999` 后保留全部数字而不截断。序列因回滚或并发出现间隙属于正常行为，不表示丢失 Intake。外部契约中的 `ticket_id`、`incident_id` 当前固定返回 `null`；数据库不提前创建无外键的占位关联列。

## 聚合算法

后续消息只有同时满足以下条件才追加：

1. `provider + bot_id + chat_type + chat_id + sender_user_id` 相同；
2. 当前 Intake 状态属于 `RECEIVED / WAITING_DESCRIPTION / WAITING_TRIAGE / TICKET_CREATED`；
3. 与最近消息间隔不超过 90 秒，恰好 90 秒允许追加；
4. 文本不包含“新报修”“另一个问题”“重新报修”；
5. 文本不明确引用形如 `IT-YYYYMMDD-NNNN` 的另一工单。

处理器先对完整上下文键获取 `pg_advisory_xact_lock`，再查询和写入 Intake。锁在事务提交/回滚时自动释放，避免同一上下文的不同 `msg_id` 并发创建多个 Intake；它不是进程内锁，也不依赖 Redis。查询接受 90 秒内有界的时间戳逆序，追加时以 `GREATEST(last_message_at, incoming_received_at)` 保持时间高水位，并用锁后 `clock_timestamp()` 更新数据库时间，避免事务启动顺序与获锁顺序相反时回滚有效补充。由“新报修”或另一工单号开启的 Intake 会持久化 `explicit_aggregation_boundary`；时间更早的逆序消息不得跨入该边界。候选按主消息的逻辑接收时间而不是数据库更新时间选择，因此边界前补充即使最后完成，也不会抢走边界后的正常补充。

普通追加写 `SUPPLEMENT / intake.message_added`。若当前状态为 `WAITING_DESCRIPTION`，后续消息写 `CLARIFICATION / intake.clarification_added`；当新内容能确定有效请求类型时，同时把 Intake 推进到 `RECEIVED`。纯图片或弱上下文仍创建 Intake，并写 `intake.received` 与 `intake.needs_clarification`。

## 确定性请求类型

P1-004 不调用 AI/OCR，按固定优先级识别：

```text
STATUS_QUERY
→ COMPLAINT
→ SERVICE_REQUEST
→ INCIDENT（先应用否定规则）
→ QUESTION
→ FOLLOW_UP
→ CHATTER
→ UNKNOWN
```

`INCIDENT / SERVICE_REQUEST / QUESTION / COMPLAINT / STATUS_QUERY` 初始状态为 `RECEIVED`；`FOLLOW_UP / CHATTER / UNKNOWN` 通常为 `WAITING_DESCRIPTION`，但独立感谢归为 `CHATTER / IGNORED`，不产生无意义的澄清请求。故障否定按标点和转折词切分后的分句判断：“今天没有报错”不是故障，而“PACS 没有报错，但 HIS 登录失败”仍是明确故障。分类只决定 Intake 事实，不表示已建 Ticket，也不自动操作生产系统。

## 审计与敏感数据

事件 payload 只含 Intake/Channel Message 标识、关系类型、消息计数、请求类型、状态和无原文原因码。它不复制报修原文、患者文本、媒体 URL、AES Key、Secret 或 SDK 原始 Frame。每个 Intake 的 `event_ordinal` 从 1 严格递增；同一原子状态版本产生多个事件时可共享 `aggregate_version`，但仍可按 ordinal 唯一排序。`intake.service_intake_event` 是审计表，不是 Notification Outbox，不会产生客户端通知。

Intake 行保存所有关联消息中的最强 `privacy_class` 和最早 `retention_until`，这两个字段仅是数据库内部控制，不无版本地扩展既有严格 `ServiceIntake` 响应契约。受控数据库内可保存标准摘要，但新的 P1-003 可重放首次处理结果始终把 `summary` 返回为 `null`。升级迁移按全部消息关系重算隐私/留存边界，并从主 Channel Message 的 `clean_text` 恢复显式边界；若发现旧快照仍含非空 `response_snapshot.intake.summary`，迁移以稳定错误 `P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED` 失败并保持原值，不越界改写 P1-003 原结果。此类历史快照需另行授权、版本化处理后再重试 P1-004 迁移。

## 运行与验收

```powershell
npm run p1:004:migrate
npm run test:p1:004:integration
npm run p1:004:verify
```

定向真实 PostgreSQL 验收为 22/22 通过，覆盖单条、多条补充、显式新报修、另一工单引用、纯图片、图片后澄清、12 路不同消息并发、普通与显式边界逆序获锁及边界后回挂、八类请求类型与分句否定/感谢、聚合隐私与留存、旧结构升级及旧快照失败关闭、CLI 稳定错误映射、90 秒边界、上下文隔离、重放、事务回滚、五位数编号、事件顺序、迁移可重入和契约/迁移范围。

全量带库回归为 99/99 通过；验收后 `p1-004-*` 合成 Channel Message、Intake、关系和事件残留均为 0，且数据库中不存在 `pilot_ticket` Schema。

当前结果只证明本机、合成 Normalized Message 和本机 PostgreSQL 下的 P1-004 行为。它没有连接真实 WSS、没有公网 IP、没有客户端回执，也没有临床人员观察，因此不构成公网、企业微信端到端或临床试点验收。P1-005 仍为 TODO，必须另行授权后才能创建 Pilot Ticket。
