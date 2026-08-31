# P2-003 Realtime Event Log、SSE 补放与慢客户端治理 Evidence

## 1. 结论与授权边界

- 基线：`d59de5d7db39c4a39f82093496a0e42565d67a7e`；
- 分支：`phase2/conversation-core`；
- 授权：仅 P2-003，授权记录为 `evidence/p2-003-start-authorization.md`；
- 完成日期：2026-08-31；
- 结论：`P2 / P2-003 / DONE / AWAITING_SEPARATE_AUTHORIZATION`；
- 当前无活动任务或 Lane；P2-004 及以后仍为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，
  P2-G1 为 `NOT_STARTED`，全部 P2/P3 Feature Flag 为 `false`。

本 Evidence 是本地 Contract、PostgreSQL 18.4、localhost SSE、故障与资源验证，不是生产、临床、
真实 Workbench、企业微信客户端或 P2-G1 Evidence。

## 2. 交付文件

- Contract：`contracts/conversation_realtime_event.schema.json`（Event Command）、
  `contracts/conversation_realtime_fallback.schema.json`、
  `contracts/conversation_realtime_contracts.d.ts`、`contracts/conversation_center.openapi.yaml`；
- 数据库：`database/migrations/012_p2_003_realtime_event_log.sql`、`database/schema_draft.sql`；
- Runtime/CLI：`src/p2-003-realtime-event-log.mjs`、`src/p2-003-realtime-sse.mjs`、
  `scripts/p2-003-migrate.mjs`、`scripts/p2-003-retention.mjs`；
- 测试：`tests/p2-003-realtime-event-log.test.mjs`、
  `tests/p2-003-realtime-event-log.integration.test.mjs` 与六个 `tests/helpers/p2-003-*.mjs`；
- 设计/配置：`docs/39_p2_003_realtime_event_log_sse.md`、`.env.example`、
  `config_examples/conversation_policy.example.json`、
  `config_examples/resource_limits.2c4g.example.json`；
- 状态、Backlog、索引、说明和本 Evidence 随终态同步更新。

未修改 migration 010/011、P1 migration、P1/P2-001/P2-002 Evidence 或 `.env.pilot`，未新增 npm 依赖。

## 3. Migration 012 与 Catalog

Migration 012 只创建：

1. `conversation.realtime_event`：`event_id BIGINT GENERATED ALWAYS AS IDENTITY` 主键、opaque
   `event_key` 唯一键、publisher/source/aggregate/scope/visibility、受限 `JSONB payload`、三个
   SHA-256 hash/key、`TIMESTAMPTZ` 生命周期；
2. `conversation.realtime_stream_state`：stream 主键、单调 `retention_floor_event_id`、
   `row_version` 与 `updated_at`。

约束覆盖 key/hash 格式、stream/event/source/aggregate/scope/visibility vocabulary 与字符集、
SESSION/THREAD/SYSTEM scope-null 一致性、JSON object、expiry、非负 aggregate version/floor、
`row_version >= 1`。除 PK/unique 外只有三个 B-tree：

- `(visibility_scope, event_id)`；
- `(authorization_scope_type, authorization_scope_id, event_id)`；
- `(expires_at, event_id)`。

迁移 `BEGIN/COMMIT`、可重入；pre-create guard 只接受“两表三索引全不存在”或结构全部存在，列、
类型、default、identity、constraint、unique、index method/order/include/expression/predicate、trigger/
function 漂移均失败关闭为 `P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。CLI pool max=1，只执行 012；
`--check` 在事务中执行并回滚，不执行 `schema_draft.sql`，不输出 SQL 或数据库 URL。

集成结果：首次/重复迁移、仅 012 CLI、pre/post `--check` rollback、010/011/P1 catalog 不变均通过；
缺列、弱化 check、错误 unique、错误 index method、错误 index predicate 五类 drift 全部稳定失败。

## 4. Event Contract、Identity 与事务

Command 冻结 13 个 Event Type、9 个 Source Type、9 个 Aggregate Type、三种 Authorization Scope 与
两种 Visibility；Event ID/版本/Cursor 只公开规范十进制字符串，不用 JavaScript Number 表示 BIGINT。
Payload 仅接受有深度、节点、对象属性、数组、字符串和 canonical-byte 上限的普通纯 JSON object，
拒绝 Proxy、accessor、symbol、`toJSON`、非普通原型、污染键、正文和敏感标识。

`event_key = rte_v1_<64 lowercase hex>` 覆盖冻结 identity tuple；`event_hash` 覆盖所有语义字段，
排除 event ID、created/expiry time、worker/process/run ID。相同 key/hash 返回 `REPLAYED`，相同 key/
异 hash 返回 conflict；payload 不可变，重放只允许收紧 expiry。12 路相同事件只持久化一行；12 路
不同事件获得唯一递增 commit-visible ID。Identity 回滚空洞不被视为 replay gap。

`appendRealtimeEvent({ transaction, command })` 使用调用方事务，不自行 commit/rollback；identity 分配前
取得固定 stream transaction advisory lock。集成测试在同一调用方事务同时更新真实合成
`conversation.session` 与 append event，并验证提交、回滚、ACK 丢失重放与 SSE 写失败隔离。
Event Store flag 关闭时零数据库调用。本任务没有把 P2-002 Projector 接入 append。

## 5. Authorization、Replay 与 SSE

Authorization Port 默认拒绝，只接受有界 session/thread UUID 集、显式 system/admin 布尔值。
每页单条 SQL statement 原子读取 floor/high；先以 scope/visibility 过滤 event ID，再执行 LIMIT，之后
才回表读取 payload；返回前应用层再次核验并构造九字段 Public View。51 个未授权事件位于授权事件
之前且 `limit=1` 的定向测试仍返回该授权事件，证明未授权行不会占用 page limit 或饿死授权 replay。

缺失 Last-Event-ID 从 floor 开始；规范 Cursor 精确执行 `event_id > cursor`，自然 identity 空洞不是
gap。Cursor 大于 durable high 返回 409；Cursor 小于 floor 在发 headers 前返回 410 replay fallback。
若 floor 在 200 SSE 已建立后前移，连接失败关闭且不发送不完整事件；重连由 pre-header 检查返回 410。

200 headers 固定为：

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

事件帧依次为 `id:`、`event:`、单行 canonical JSON `data:` 与空行；Event Type/encoder 拒绝 CR/LF/
control injection。Heartbeat 是 `: heartbeat` 注释帧，不持久化、不消耗 event ID，默认 20 秒。
Hub 只广播无 payload wakeup；missed wakeup 由默认 5 秒 PostgreSQL recovery poll 补偿。认证/授权
异步等待期间断连的测试证明不取得 replay 查询、Hub lease 或 timer。

Flag 关闭返回 `SSE_DISABLED` fallback，零 replay DB、客户端、heartbeat/recovery timer；认证失败仍为
401/403，不包装 fallback。第 33 个客户端返回 `CONVERSATION_REALTIME_CAPACITY_REACHED` fallback；
gap、临时服务不可用分别使用 `REPLAY_GAP`、`TEMPORARY_UNAVAILABLE`。P2-003 只冻结 fallback body，
不实现 P2-006 polling endpoint。

## 6. Retention

默认保留 168 小时，每批最多 200。`--check` 零写；`--apply` 还要求
`P2_003_RETENTION_CLEANUP_APPROVED=true`。清理只删除第一个未过期事件之前的连续已持久化前缀，
不跨越 live event；delete 与 floor 单事务，floor 单调，崩溃回滚，重试幂等。实测首批删除 200、
次批删除 1；事务故障时 delete/floor 同时回滚；Replay Gap 返回 410 fallback。

## 7. 可核验测试结果

| 命令 | 结果 |
|---|---:|
| `npm run validate:architecture:v1.4` | 211 checks，0 error |
| `npm run test:architecture:v1.4` | 9/9 |
| `npm run test:p2:001` | 13/13 |
| `npm run test:p2:001:integration` | 1/1，真实执行 |
| `npm run test:p2:002` | 39/39 |
| `npm run test:p2:002:integration` | 13/13，真实执行 |
| `npm run test:p2:003` | 41/41 |
| `npm run test:p2:003:integration` | 10/10，真实执行 |
| `npm run test:p1:011:integration` | 11/11，真实执行 |
| `npm run test:p1:012:integration` | 46/46，真实执行 |
| `node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs` | 331/331，真实串行执行 |

以上单项运行均为 `fail=0 / cancelled=0 / skipped=0 / todo=0`；没有用 skip 绕过 P2-003。

## 8. 2C4G、客户端与故障结果

- 32 SSE clients：峰值 32；持久事件 100；每客户端收到 100；capacity rejection 1；DB replay query
  batches 105；最大 `writableLength=16,764` bytes；slow disconnect 0；资源释放 2 polls；
- 32-client heap 样本（bytes）：`10,261,672 / 11,355,240 / 12,833,672 / 13,547,400 /
  12,108,992 / 13,977,512 / 16,258,280`；first-to-last 与 peak delta 均 `5,996,608`；
- 第 33 client：HTTP 503，capacity fallback，未超过 32 个 Hub lease；
- 真实 paused slow client：观察到 `active_drain_waiters=1` 后才提交模拟业务事务；只关闭该慢客户端
  1 次，正常客户端保持连接并收到 5,001 个事件；event 与 Session 更新均持久化；
- 5,000-event replay：batch 50、100 次查询；parser buffer 最大 380 bytes；`writableLength` 最大
  16,641 bytes；不保留已发送 frame；heap first-to-last `+5,835,760`、peak `+7,838,168` bytes；
- restart：Server A `SIGKILL` 后 PostgreSQL backend 1 poll 关闭；Server B 以 Last-Event-ID 补放，
  新 event 与 missed wakeup event 均收到；
- 无 Redis/Kafka/RabbitMQ/Socket.IO/ORM/TypeScript runtime/模型/重型常驻进程；App/API/SSE 仍是
  一个进程模型、共享 pool，集成 pool 最大 4、replay 默认 50/最大 200、无应用事件队列。

Heap 样本受 V8 GC 时点影响，不作脆弱的单点下降断言；硬 buffer/page/client 上限、无 frame retention、
慢客户端隔离和终态资源释放共同证明本测试窗口内行为有界。该结果不是长期 soak 或生产容量证明。

## 9. 残留与隐私检查

P2-003 suite 终态：active clients/fallback requests/HTTP sockets/wait timers/CLI children/server children/
owned databases/owned schemas/owned backends/active databases 均为 0；六个随机端口均关闭，
emergency cleanup 计数全部为 0。测试只使用随机隔离数据库、localhost 随机端口和合成 UUID/内容；
没有真实患者数据、userid/chatid、消息正文、Secret、数据库 URL、Provider 原文或媒体密钥进入 Event、
公开错误、日志或 Evidence。

## 10. 未解决边界与明确非范围

- PostgreSQL 18.4 是本地验证版本；最低受支持 PostgreSQL 大版本尚未在 P2-003 单独冻结；
- 未执行长期 soak、真实反向代理、浏览器 EventSource、生产网络或多进程/multi-host 验证；
- 未启动 P2-004，未实现 Communication Outbox/Delivery；
- 未实现 Assignment、Read Cursor 或 Handoff；
- 未实现 Workbench，未把 P2-002 正式接入 SSE；
- 未通过 P2-G1，未接 DeepSeek，未启用 AI 或任何 P2/P3 Feature Flag；
- 未接医院内网，未新增真实企业微信发送路径；
- Realtime Event Log、SSE 与 Hub 均非事实源，Unified Ticket Core 的唯一 Ticket 事实所有权未改变；
- 未 push、merge、tag、release 或发布远端。
