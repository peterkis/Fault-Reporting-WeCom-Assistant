# P2-003 Durable Realtime Event Log 与 SSE Replay

## 1. 状态与边界

P2-003 只实现 PostgreSQL durable Realtime Event Log、授权补放、原生 HTTP SSE、心跳、
慢客户端治理、polling fallback contract 与受控 retention。`CONVERSATION_REALTIME_SSE_ENABLED`
和 `CONVERSATION_CENTER_ENABLED` 仍默认 `false`；P2-004 已独立完成，但 P2-005 及以后、P2-G1、真实 Workbench、
企业微信新增路径、模型、OCR、医院身份和内网 Connector 均未授权。

Realtime Event Log 是可清理的通信投影；PostgreSQL 表是其 durable replay 依据，但它、SSE
和内存 Wakeup Hub 都不是 Ticket、Conversation、Timeline 或 Delivery 事实源。Unified Ticket
Core 继续是唯一长期 Ticket 事实源。P2-003 不修改 migration 010/011，不把 P2-002 Projector
自动接入 Event Log；P2-G1 才能另行授权组装。

## 2. Event Contract

Command 包含版本化 publisher/source identity、event variant/type、aggregate identity/version、
authorization scope、visibility、纯 JSON payload、occurred/expires time。运行时计算 opaque
`event_key`、`payload_hash`、`event_hash`、identity `event_id` 和 `created_at`。

冻结 Event Type：

- `conversation.session.created`
- `conversation.session.updated`
- `conversation.item.created`
- `conversation.timeline.rebuilt`
- `conversation.mode.changed`
- `conversation.assigned`
- `conversation.handoff.requested`
- `conversation.handoff.accepted`
- `conversation.read_cursor.changed`
- `communication.delivery.changed`
- `ticket.updated`
- `incident.updated`
- `gateway.connection.changed`

P2-003 只提供前四类的 Session、Item 与 Timeline Rebuild 安全 mapper/fixture；其余只冻结
跨 Lane 词汇，不创建对应业务表或流程。Source Type 冻结为 `CONVERSATION_SESSION`、
`CONVERSATION_ITEM`、`TIMELINE_REBUILD`、`COMMUNICATION_DELIVERY`、`TICKET_EVENT`、
`HANDOFF_EVENT`、`READ_CURSOR`、`INCIDENT_EVENT`、`GATEWAY_EVENT`。Aggregate Type 与对应
领域身份词汇独立冻结，避免把 source payload 当业务事实。

Public Event View 只公开规范十进制 `event_id`、event/aggregate identity、可空规范十进制
aggregate version、visibility、裁剪 payload 和 occurred/created time。它不公开 publisher 配置、
source ID、key/hash、scope ID、原始 userid/chatid、正文、安全内容、Provider 原文或凭据。

## 3. 输入硬化与规范化

所有入口先通过 descriptor snapshot 验证 ordinary plain JSON。Proxy、getter/setter、symbol key、
`toJSON`、非 plain prototype、循环引用、`__proto__`/`prototype`/`constructor` 污染键均失败
关闭。深度、总属性数、数组长度、字符串长度和 payload 编码字节数有硬上限。BIGINT 只使用
`0` 或无前导零的正十进制字符串，禁止转为 JavaScript Number。

`event_type` 既要命中冻结枚举，也禁止空格、CR/LF 与 SSE 控制字符。时间必须是带时区的
RFC 3339/ISO instant；`expires_at` 严格晚于 `occurred_at`。

## 4. Identity、Hash 与事务

`event_key = rte_v1_<sha256>`，规范身份包含 publisher name、source type/id、event variant/type
和 authorization scope type/id。`event_hash` 覆盖 publisher/version、source identity、event、
aggregate identity/version、scope、visibility、payload 和 occurred time；明确排除 expiry、event ID、
created time、Worker/进程/运行 ID。Payload 另有 canonical JSON hash。

相同 key/hash 返回既有 ID 和 `REPLAYED`；相同 key/不同 hash 返回稳定 conflict，绝不覆盖；
相同语义重放只可用 `LEAST` 缩短 expiry。`appendRealtimeEvent({transaction, command})` 只使用
调用方事务，不提交、不回滚、不触发 wakeup；写失败向上传播，使未来业务事务不能误提交。

identity 在回滚时允许自然空洞。为避免两个不同 key 的并发事务出现“大 ID 先提交、小 ID 后提交”
而被 cursor 永久跳过，append 在分配 identity 前取得固定 stream transaction advisory lock。
锁随调用方事务释放，保持 event ID 的 commit-visible 顺序。

## 5. Migration 012

migration 012 只新增：

- `conversation.realtime_event`：21 列、`BIGINT GENERATED ALWAYS AS IDENTITY` 主键、唯一 key、
  固定 stream、publisher/source/event/aggregate/scope/visibility、JSONB payload、hash 与时间；
- `conversation.realtime_stream_state`：stream 主键、单调 retention floor、row version、updated time。

除 PK/unique 外仅有三个 B-tree：`(visibility_scope,event_id)`、
`(authorization_scope_type,authorization_scope_id,event_id)`、`(expires_at,event_id)`。
长度、字符集、枚举、scope/null 一致性、JSON object、hash 格式、expiry、version/floor 均由
数据库约束再次防御。迁移事务化、可重入，精确检查列/类型/default/identity/constraint/index method/
ordering/include/expression/predicate/trigger 漂移；任何漂移统一为
`P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。不创建持久 trigger/function，不修改既有表。

## 6. Replay Window 与授权裁剪

cursor 接受 `0..9223372036854775807` 的规范十进制字符串；缺失 cursor 从当前 floor 开始。
durable high watermark 取 `max(floor, max(persisted event_id))`，绝不读取 identity sequence。
cursor 大于 high 返回 `CONVERSATION_REALTIME_CURSOR_AHEAD`；小于 floor 返回
`CONVERSATION_REALTIME_REPLAY_GAP`；identity 自然空洞不是 gap。
建立 SSE 响应头之前发现 gap 时直接返回 410 fallback。若 retention floor 在 200 SSE 响应已经
建立后并发前移，HTTP 已不能改写为 JSON 410；该连接失败关闭且不发送不完整事件，客户端重连后
由 pre-header window 检查得到 410 fallback 并重新拉取权威列表/时间线。

授权 descriptor 由未来应用层注入：有界 `allowed_session_ids`、`allowed_thread_ids`、显式
`allow_system_events` 和 `allow_restricted_admin`。缺少 descriptor 默认拒绝；不存在 wildcard。
SQL 在 LIMIT/返回 payload 前按 SESSION/THREAD/SYSTEM 与 visibility 裁剪，返回前再做
defense-in-depth scope 校验并以白名单构造 Public View。日志和错误不输出 scope 数组或目标是否存在。
每页查询重新原子读取 floor/high，避免 retention 与长连接之间产生无声缺口。

## 7. SSE Wire Contract

端点为 `GET /api/realtime/events?scope=workbench`。认证失败保持 401/403，不降级为匿名 polling。
成功响应头精确为：

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

事件帧为单 writer 顺序写出的 `id`、`event`、单行 canonical JSON `data` 和空行；编码器再次
拒绝 CR/LF/control injection。Heartbeat 固定为 `: heartbeat` 注释帧，不持久化、不消耗 ID。

连接总上限为 32；Hub 原子占位，因此第 33 个有效认证客户端直接得到 capacity fallback 且不查库。
Hub 只广播无 payload 的 wake signal；每连接最多一个 pending boolean，不形成事件队列。所有补放
始终回 PostgreSQL；5 秒 recovery poll 补偿 missed wakeup，进程重启后 Last-Event-ID 同样补齐。
不持有长事务或每客户端专属连接。

每帧只调用一次 `write`。返回 false 时停止写入并等待 drain；`writableLength` 超过 65,536 bytes
或 5 秒未 drain 时只关闭该慢客户端。等待期间 wakeup/heartbeat 只合并状态，不积压应用队列；
append 和其他客户端继续运行。断连会幂等清除 heartbeat、recovery、drain timer、listener 与 Hub lease。
认证或授权异步等待期间即监听 abort/close；每次 await 后以及取得 Hub lease 前均失败关闭检查，
因此早退连接不会占用 replay 查询、Hub 容量或 timer。

## 8. Polling Fallback

Fallback 本体固定为：`fallback_required=true`、reason、`poll_after_ms`、strategy、可空
`latest_event_id`、可空 `retention_floor_event_id`。Reason 为 `SSE_DISABLED`、
`CAPACITY_REACHED`、`REPLAY_GAP` 或 `TEMPORARY_UNAVAILABLE`；strategy 为重新拉取会话/时间线或
有限轮询。P2-003 只冻结 Contract，不实现 P2-006 Workbench polling endpoint。

## 9. Retention

默认保留 168 小时，单次最多 200。cleanup 锁 stream state 后按 ID 读取 floor 之后的有界行，
只删除第一个未过期事件之前的连续“已持久化事件前缀”；identity 空洞不打断前缀。删除与 floor
推进在同一事务，floor 单调且零删除不推进。后续孤立的过期事件不得越过未过期事件提前删除。

CLI 默认为 `--check`；`--apply` 还必须有 `P2_003_RETENTION_CLEANUP_APPROVED=true`。失败只输出
稳定错误与安全计数，不输出 SQL、URL、payload 或 scope。仓库不安装 scheduler。

## 10. 稳定错误与关闭

公开稳定错误包括 disabled、event invalid/conflict、cursor invalid/ahead/gap、unauthenticated、
forbidden、capacity reached、slow client、storage failed、retention not authorized/failed 和 schema
drift。Flag 关闭时 handler 完成认证/授权后、在访问 pool、取得 Hub lease 或启动 timer 之前返回
`SSE_DISABLED` fallback；Event Store 同样零数据库调用。关闭 Flag、停止调用 append/SSE/cleanup
即可回退，追加表保留审计，不删除数据。

## 11. 2C4G 与验收边界

一个 App/API/SSE 进程、共享小 pool、一个 Worker；测试 pool 不超过 4；32 clients、batch 50、
limit 200、heartbeat 20 秒、recovery 5 秒、buffer 64 KiB。无 Redis、Kafka、RabbitMQ、EventSource
依赖或重型服务。验收必须记录 32/33 clients、restart、missed wakeup、slow client、retention、
5,000 event 有界补放、heap 分段/趋势、query batches、timer/socket/backend/database 残留。

这些本地 Contract/Integration/资源证据不等同于真实 Workbench、生产、临床、企业微信客户端或
P2-G1 验收。P2-004 已在后续独立授权中完成；当前必须停止并等待 P2-005 的独立授权。
