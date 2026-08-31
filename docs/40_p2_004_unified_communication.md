# P2-004 统一 Communication Message / Outbox / Delivery

## 1. 范围与状态

P2-004 在 P2-B Lane 内独立实现统一出站消息与内部备注事实、已提交发送意图、每目标当前投递
状态、每次投递尝试审计、Mock-only Sender Port、单并发 Worker、显式 Reconciliation Port、P1
通知兼容 Adapter 和未装配的纯函数 Projection Mapper。实现基线为
`2b4548888882ce895a85f513d0a5bb57d9920b91`。

本任务不实现 Assignment、Read Cursor、Handoff、Generation Fence、Workbench、真实 REST Route、
真实权限系统、真实 WeCom Sender、AI Provider、Media/OCR、Incident、医院内网或 P3。P2-G1 仍为
`NOT_STARTED`，所有 P2/P3 Feature Flag 保持 `false`。

## 2. 事实边界

- `communication.message`：外部消息或内部备注的追加式事实；
- `communication.outbox`：Message 已在数据库事务提交的不可变发送意图；
- `communication.delivery`：每个内部解析目标的当前状态；
- `communication.delivery_attempt`：每次 STARTED、SENT、RETRY、UNKNOWN、DEAD 或 CANCEL 审计；
- Unified Ticket Core：继续唯一拥有 Ticket 编号、状态、责任和事件；
- Channel Message：继续是入站事实；Conversation Item 与 Realtime Event 继续是可重建投影；
- `notification.*`：继续承载已验证 P1 Ticket 通知事实。

P2-004 不迁移、回填、复制、删除、重命名或双写 `notification.*`，Communication Worker 不领取
`notification.delivery`。

## 3. Contract 与输入硬化

冻结 sender kind `AGENT/AI/SYSTEM`、purpose `HUMAN_REPLY/AI_REPLY/SYSTEM_NOTIFICATION/INTERNAL_NOTE`、
message type `text/markdown/image/file/mixed/template_card`、visibility
`EXTERNAL/INTERNAL/RESTRICTED`、Delivery/Attempt/side-effect 状态枚举。

运行时只接受 ordinary plain JSON。descriptor snapshot 在读取值前拒绝 accessor、symbol、`toJSON`、
非普通 prototype、循环、污染键、越界深度/节点/数组/字符串；Proxy trap 异常统一映射为稳定错误。
Command/Content 使用 canonical key ordering 与小写 SHA-256。浏览器 Contract 不接受 provider、
channel account、target、sender authority、lease 或 delivery status。

公开成功结果只包含 `message_id`、可空 `outbox_id`、`delivery_ids`、`command_status`、`replayed`
和 `created_at`。目标、Hash、Provider receipt、内部 sender identity 与原始错误均不公开。

## 4. Command 幂等

业务身份为 `(idempotency_scope, client_command_id)`；scope 至少隔离 AGENT、AI、SYSTEM。
`command_hash` 覆盖 Session、expected row version、sender/purpose/type/visibility、content、reply、
attachment ids、destination policy、privacy 和 retention。

- 同 identity、同 hash：返回原 Message/Outbox/Delivery，`replayed=true`；
- 同 identity、异 hash：`COMMUNICATION_COMMAND_CONFLICT`；
- 同正文、不同 command id：形成不同 Message；
- Human 与 AI 同正文：因 scope/command identity 不同而保持隔离；
- 重放不新增 Attempt、Outbox、Delivery，不修改 Session，不调用 Sender。

未来 HTTP `Idempotency-Key` 必须与 body `client_command_id` 完全相同；P2-004 只冻结 OpenAPI，
不实现 Route。

## 5. Session、Authorization 与目标解析

Agent/AI 外部消息要求 Session 存在、未 ENDED、`expected_row_version` 匹配；Session 与 Thread 在
同一事务中锁定读取，但 P2-004 不修改 row/generation/control/last activity。默认 Authorization
Port 拒绝；测试只能显式注入 synthetic authorization。AI Contract 可解析，但真实入口和 Feature
Flag 均关闭。

默认 Destination Resolver 只读取 Thread 的 `provider/channel_account_id/chat_type/external_thread_key`：
single → PERSON，group → GROUP，provider 固定为权威字段 `WECOM_AIBOT`。`target_id` 持久化供异步
Sender 使用，同时计算 SHA-256 `target_hash` 供唯一性、限流和安全诊断。target 永不进入公共结果、
普通日志、Evidence、Timeline 或 Realtime payload。

## 6. caller-owned transaction

`appendCommunication({transaction,...})` 不自行 commit/rollback。standalone Service 的外部消息在同一
PostgreSQL 事务内验证 Session/Thread 并写 Message、Outbox、至少一条 Delivery；内部备注只写
Message。事务内禁止 HTTP、企业微信、模型、对象存储或 Sender 调用。任何插入或目标失败使整组
事实回滚。

System Notification 只接受可信服务端提供的 `trustedDestinations`；这些目标不得来自 HTTP body。
一个 Message 对应一个 Outbox，多个 Delivery 独立处理。本任务不把现有 Ticket Event 改接新链路。

## 7. Migration 020

`database/migrations/020_p2_004_unified_communication.sql` 只创建 `communication` 下四表及直接约束/
索引，沿用 `uuidv7()`，不安装 extension、Trigger 或持久 Function，不修改既有表。

七个显式 B-tree 索引覆盖 Message Session timeline、retention、Delivery claim、lease expiry、
reconciliation、target rate limit 和 Attempt 顺序。迁移可重入并检查四表/列/关键类型/约束定义/
Unique/索引访问方法/字段顺序/predicate/Trigger/Function 漂移。所有漂移失败关闭为
`P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。

`scripts/p2-004-migrate.mjs` 只读取 migration 020，pool `max=1`；`--check` 在事务中执行并回滚，
不输出 SQL 或数据库 URL。

## 8. Sender Port 与媒体边界

Sender 输入含内部 provider、account、target、delivery/idempotency identity、Message 与 AbortSignal；
输出只有 `ACKNOWLEDGED`、`REJECTED_NOT_APPLIED` 或 `UNKNOWN` 及安全 code/receipt。只有 ACK 可进入
SENT；明确未应用可重试；无法确认副作用必须进入 Reconciliation。

P2-004 只提供 Mock Sender。真实运行只允许 text/markdown；image/file/mixed/template_card 仅冻结
Contract，Runtime 返回 `COMMUNICATION_MEDIA_NOT_AUTHORIZED`，不创建虚假附件、URL/Base64 或 P2-011 表。

## 9. Delivery Worker 状态机

单 Worker、并发 1、默认 batch 20。claim 使用 `FOR UPDATE SKIP LOCKED` 和基于 provider/target_hash
的 advisory transaction lock：

```text
PENDING → LEASED → SENDING → SENT
                     ├─ confirmed not applied → PENDING → retry
                     ├─ terminal/max attempts → DEAD_LETTER
                     └─ side effect unknown → RECONCILIATION_REQUIRED
```

claim 事务只写 LEASED；发送前另一事务以 lease token CAS 写 SENDING 并插入 STARTED Attempt；
Sender 在事务外调用；finalize 再以 lease token CAS。过期 LEASED 可重领，因为 Sender 尚未调用；
过期 SENDING 必须转 `RECONCILIATION_REQUIRED`，禁止盲重发。指数退避从 `retryBaseMs` 开始。

目标限流在数据库内按 target_hash 统计；一个目标失败不阻断另一个。runOnce 不超过 20，不建立
进程内无界队列。

## 10. Reconciliation

内部 Port 默认拒绝，只在 `authorized=true` 且当前状态精确为 `RECONCILIATION_REQUIRED` 时接受：

- `CONFIRMED_SENT` → SENT；
- `CONFIRMED_NOT_SENT_REQUEUE` → PENDING 并重置 NOT_ATTEMPTED；
- `CANCEL` → CANCELLED。

每个决议写独立 Attempt 审计与稳定 reason code；不提供管理 UI、任意 SQL 或普通 Agent 接口。

## 11. Internal Note

Internal Note 强制 purpose INTERNAL_NOTE、visibility INTERNAL、Session/version 检查和 append-only。
它只创建 Message，Outbox/Delivery/Sender 调用均为 0；不编辑、不删除，默认不进入 AI Context。

## 12. P1 Compatibility

`P1NotificationCompatibilityAdapter` 的安全 View 只含 source kind、delivery/outbox id、status、channel、
attempt count、last error code 与 sent time。它不返回 target key、payload、provider message id、reporter、
chat 或 Secret。读取接口只查 P1；`deliverLegacy` 只委托现有 `createNotificationDeliveryWorker` 实例，
不复制领取、lease、retry、rate-limit 或 dead-letter SQL。

## 13. Projection Mapper

纯函数 Mapper 可把 Message/Delivery 映射为 P2-002 Source Record，把 Delivery 状态映射为
`communication.delivery.changed`。Realtime payload 仅含 status、attempt count、last error code、
side-effect state；不含正文、target/hash、receipt、sender 或内部备注。P2-004 不写 Item 或 Realtime
Event，P2-G1 才能另行授权组装。

## 14. 隐私、2C4G 与关闭

Message/target 仅在必要存储和 Sender seam 内可见；普通日志只允许稳定 code、计数、opaque hash、
duration、attempt 和 status。测试全部使用合成数据。默认一个 Worker、batch 20、pool 不超过 4；不新增
Redis、Kafka、RabbitMQ、ORM、Socket.IO、TypeScript runtime、本地模型、Elasticsearch 或常驻进程。

运行关闭方式是保持 `HUMAN_WORKBENCH_V2_ENABLED=false` 并停止调用 Service/Worker。disabled seam 在
任何数据库或 Sender 调用前返回 `COMMUNICATION_DISABLED`。Migration 020 保留追加事实；后续结构修复
必须使用新编号迁移，不改写 020。P1 `notification.*` 继续独立运行。

## 15. 后续消费边界

P2-005 已在独立授权下提供 Assignment/Handoff/Read Cursor/Generation Fence 和 assigned
Communication Authorizer；P2-006 可在另行授权后实现真实
REST/Workbench/权限；P2-G1 才能装配 Timeline/SSE/发送路径。上述接口兼容说明不构成启动授权。
