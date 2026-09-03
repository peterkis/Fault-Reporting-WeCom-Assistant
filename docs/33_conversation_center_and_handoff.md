# 33. Conversation Center、人工接管与实时工作台

## 1. 目标

在不引入第二套 Ticket 事实源的前提下，为企业微信机器人增加一个类似微信/微博私信的
实时 Web 工作台：

- 实时看到入站消息；
- 按用户/群/话题查看历史；
- 多名信息科人员安全协作；
- 人工接管并主动回复；
- AI 自动、Copilot 和人工模式切换；
- 关联 Service Intake、Ticket 和 Incident；
- 断线后可补放；
- 内部备注与用户可见消息严格隔离。

## 2. 边界

Conversation Center 不是工单系统，也不是原始消息数据库的替代品。

```text
Channel Message        = 原始入站事实
Conversation Center    = 通信时间线和控制状态
Service Intake         = 一次服务受理
Unified Ticket Core    = 处理生命周期
```

已完成的 `P2-001` 冻结 Thread、Session、Conversation Item、控制模式、版本和隔离
契约，并建立 Thread/Session 数据库约束。随后独立授权的 `P2-002` 也已完成：
持久化、幂等、可重建的 Timeline Item/Source Binding/Checkpoint 与只读源 Mapper。
P2-003 随后获得独立授权并实现 durable Realtime Event Log、授权 SSE replay、heartbeat、
slow-client governance、fallback contract 与 retention；详细边界见
`docs/39_p2_003_realtime_event_log_sse.md`。人工回复、Handoff、Assignment、Read Cursor、
Communication Message/Outbox/Delivery 已由独立授权的 P2-004 完成；Assignment、Handoff、Read Cursor、Control Event 与 Generation Fence 已由独立授权的 P2-005 实现，详细边界见 `docs/41_p2_005_assignment_handoff_generation_fence.md`。Workbench、真实 REST Route、页面和任何 AI 行为仍属于 P2-006 及以后任务，未授权、未实现。

## 3. Thread 与 Session

### Thread

长期渠道窗口。

```text
数据库自然键 = provider + bot_id + chat_type + external_thread_key

单聊 external_thread_key = userid
群聊 external_thread_key = chatid
```

`chat_type` 必须进入唯一键，避免同一机器人下字面值相同的 `userid` 与 `chatid`
发生碰撞。文档可展示 `wecom:{bot_id}:single:{userid}` 或
`wecom:{bot_id}:group:{chatid}`，但外部标识是不透明值，数据库不得依赖分隔符拆解。

### Session

一次连续问题或服务话题。新 Session 触发条件：

- 旧 Session 已结束；
- 超过可配置空闲时间；
- 用户明确说“另一个问题”；
- 人工点击“新受理”；
- 当前消息关联不同 Ticket；
- 规则高置信确认话题切换。

AI 不得自行在无审计情况下切换 Session。

P2-001 冻结以下确定性边界原因：`EXPLICIT_USER_NEW_TOPIC`、
`MANUAL_NEW_INTAKE`、`DIFFERENT_INTAKE`、`DIFFERENT_TICKET` 和
`IDLE_TIMEOUT`。自然语言或模型只可由后续获批规则转换为一个已审计原因，不能直接
切换 Session。空闲判定为 `received_at >= last_activity_at + idle_timeout`；超时时长
必须作为正整数配置注入。每个 `(thread_id, participant_key)` 同时最多一个非
`ENDED` Session；旧 Session 原子结束后才可创建新 Session，`ENDED` 不得复活。

Session 创建使用独立 `creation_idempotency_key`。同键同输入返回原 Session；同键
不同输入返回稳定幂等冲突。不能只依赖“当前活动 Session”唯一约束，否则旧 Session
结束后的消息重放会错误创建新 Session。

`participant_key`、`session_scope_key` 和 `creation_idempotency_key` 是内部持久化契约，
不得直接进入公共 Workbench 响应。显式结束通过 Session 状态转换为 `ENDED` 表达，
不是“启动新 Session”的边界动作。

### 群聊子上下文

群聊 Thread 保存完整投影，但每个服务 Session 必须保留：

```text
provider + bot_id + chatid + participant_key + session_id + service_intake_id
```

回复目标仍是群 `chatid`，但时间线和 AI 上下文只选取相关用户、引用消息、对应 Ticket
和已确认 Incident 背景。

`service_intake_id` 是可空关联；Conversation 不复制 Intake 或 Ticket 状态。Ticket
信息必须从 Service Intake / Unified Ticket Core 查询，不能在 Session 中建立第二份
可漂移事实。

## 4. Timeline Item

`Conversation Item` 是可删除、可重建的 Session 读模型，不是 Channel Message、Ticket
Event、Delivery 或 Communication/Handoff 的事实副本。P2-002 的详细 Contract、迁移、
排序、Checkpoint 和 Rebuild 边界见 `docs/38_p2_002_timeline_projector.md`。

完整 Conversation Center 未来可统一显示：

| 类型 | 权威来源 | P2-002 状态 | 默认可见性 |
|---|---|---|---|
| 用户消息 | Channel Message | 现有 P1 表的只读 Mapper | `EXTERNAL` |
| AI/人工回复 | Communication Message | P2-004 合成 Contract/Mapper；未装配真实发送路径 | 由 Communication 事实明确声明 |
| 内部备注 | future Communication / Ticket Event | 仅 Ticket internal note 可从现有事实映射 | `INTERNAL` |
| Ticket 事件 | Ticket Event | 现有 P1 表的只读 Mapper | 状态/外部备注/内部备注按 Variant 隔离 |
| Handoff/分配 | future Handoff Event | 合成 fixture Mapper；P2-005 未授权 | `INTERNAL` |
| 投递状态 | Notification Delivery | 现有 P1 表的只读 Mapper | `INTERNAL` |
| 系统告警 | future Operations Contract | 不属于 P2-002 | `INTERNAL` |

P2-002 的固定 Source Rank 是 Channel Message `10`、future Communication Message `20`、
Ticket Event `30`、Delivery `40`、future Handoff Event `50`。Session 内排序使用完整
Canonical Tuple：

```text
(occurred_at, source_rank, source_ordinal, source_type, source_id, projection_variant)
```

调用方不得提交 source rank；`source_ordinal` 以受限十进制字符串和 BigInt 语义比较。
唯一 Projector 名称固定为 `CONVERSATION_TIMELINE`。Projector 在 PostgreSQL
transaction-level advisory lock 下分配从 1 开始的连续
`sequence_no`。普通增量记录早于当前尾部时失败为
`CONVERSATION_TIMELINE_REBUILD_REQUIRED`，不静默追加或重排。

Source Binding 的幂等身份为 Projector、Source Stream、Source Type、Source ID、
Projection Variant 和 Session 的完整组合。相同身份/相同 Hash 是安全重放；相同身份/
不同 Hash 失败关闭。普通增量 `projectBatch` 把 Item、Binding 和按
`(projector_name, source_stream)` 标识的全局 Checkpoint 在同一数据库事务提交，并且只有
这条增量路径以 compare-and-set 推进该 Checkpoint。

显式 Rebuild 每次只处理一个 Session。它按稳定顺序锁住所涉全局 Checkpoint Key 和目标
Session，但保留全局 Checkpoint 原值，结果固定为 `checkpoint_updated=false`。在删除前，
锁内检查该 Session 的全部既有 Binding identity、source hash、privacy 与 retention 控制
信封，拒绝 stale snapshot；重建后从持久化 Item/Binding 重新读取并比对 Canonical
Timeline Hash，之后才允许事务提交。投影重建绝不修改 Thread、Session、Service Intake、
Ticket、Outbox、Delivery 或来源事实。

Timeline Query 必须显式提供 Audience：`EXTERNAL` 仅看 External；`WORKBENCH` 可看
External/Internal；`RESTRICTED_ADMIN` 还必须携带显式受限授权。普通 Workbench 不得读取
Restricted Item。

## 5. 会话模式

```text
AUTO
COPILOT
HUMAN
```

P2-001 新 Session 默认 `HUMAN`。进入目标模式的最低条件为：

| 目标模式 | 最低条件 |
|---|---|
| HUMAN | `CONVERSATION_CENTER_ENABLED=true` |
| COPILOT | Center 开启且 `AI_CONVERSATION_ENABLED=true` |
| AUTO | Center、AI、Auto Flag 开启，且另有 P2-010 / P2-G5 Controlled Auto 授权 |

当前所有 Flag 均为 `false`，且没有 Controlled Auto 授权，因此本任务不会进入
COPILOT/AUTO，也不会调用模型或发送消息。同模式请求是幂等 no-op；实际模式变化使
`generation_version` 与 `row_version` 各增加 1。`HUMAN` 只表示控制模式，不表示已
分配坐席、已接管或存在 Handoff。

### AUTO

仅在满足以下条件时允许：

- 对应场景已批准；
- Session 在白名单；
- 未发现敏感信息；
- 模型/Prompt 版本已通过评估；
- 无人工接管；
- 无高风险业务；
- 当前 generation version 未变化。

### COPILOT

AI 生成草稿，人工编辑/确认后发送。发送者记为人工，AI 草稿和修改差异进入审计。

### HUMAN

AI 不得自动发送。允许：

- 总结；
- 字段候选；
- 知识建议；
- 草稿。

### generation_version 与 row_version

- 新 Session 两者均从 `1` 开始；首条触发消息已包含在初值中，不重复递增；
- 同一 Session 的后续唯一用户消息、实际控制模式变化、Session 结束会使两者原子增加；
- 重复消息、幂等重放和同模式 no-op 不增加版本；
- `row_version` 用于乐观锁，`generation_version` 用于使旧生成假设失效；
- Assignment、Handoff、Ticket 关键状态和管理员取消生成的运行时监听属于后续任务，
  P2-001 只保留契约，不实现副作用。

## 6. Handoff 状态（未来 P2-005，当前未授权）

建议独立 Handoff 状态：

```text
NONE
REQUESTED
ACCEPTED
RELEASED
CANCELLED
```

触发来源：

- 用户请求人工；
- AI 低置信；
- 连续失败；
- 敏感内容；
- 高优先级故障；
- 坐席主动接管；
- 管理员分派。

### 接管事务

```text
UPDATE conversation_session
  control_mode = HUMAN
  assigned_principal_id = actor
  generation_version = generation_version + 1
  row_version = row_version + 1

INSERT conversation_handoff
INSERT conversation_event
INSERT realtime_event
COMMIT
```

所有未发送 AI 任务在完成时会因 generation version 不一致而失效。

## 7. 人工回复命令（P2-004 Contract 已完成；真实 Route/Workbench 未授权）

REST：

```http
POST /api/conversations/{sessionId}/messages
Idempotency-Key: <client-command-uuid>
If-Match: <session-row-version>
```

请求：

```json
{
  "message_type": "text",
  "visibility": "external",
  "text": "您好，我正在帮您查看，请补充终端编号。",
  "reply_to_item_id": null,
  "client_command_id": "uuid"
}
```

同一事务：

1. 校验用户和 Session 权限；
2. 校验当前控制模式和版本；
3. 创建 Communication Message；
4. 创建 Outbox；
5. 创建 Timeline Projection/Realtime Event；
6. 提交。

Delivery Worker 才能调用 WeCom Adapter。

## 8. 内部备注（P2-004 Contract 已完成；真实 Route/Workbench 未授权）

```http
POST /api/conversations/{sessionId}/internal-notes
```

必须：

- `visibility=INTERNAL`；
- 不创建外部 Outbox；
- 默认不加入 AI Context；
- 仅授权人员可见；
- 记录创建人、编辑策略和审计；
- 不允许通过参数改成 external。

建议内部备注只追加；确需修订时保留版本历史。

## 9. 分配与抢占（未来 P2-005/P2-006，当前未授权）

坐席接管使用乐观锁：

```text
expected_row_version
```

并在数据库中原子判断：

- 当前是否已被他人接管；
- 当前用户是否有处理组权限；
- 管理员是否允许强制转派。

浏览器按钮隐藏不能替代后端授权。

## 10. 已读游标（未来 P2-005，当前未授权）

每个用户独立：

```text
principal_id
thread_id / session_id
last_read_sequence
updated_at
```

未读计算：

```text
latest_external_sequence - last_read_sequence
```

不能把一个全局 unread_count 当作所有坐席共同状态。

## 11. 实时 Event Log（P2-003 独立交付）

P2-003 使用 migration 012 的 `conversation.realtime_event` 与
`conversation.realtime_stream_state`。Event ID 是 `BIGINT GENERATED ALWAYS AS IDENTITY`，
客户端只见规范十进制字符串；Event Log 是可清理 replay projection，不是 Timeline 或 Ticket 事实源。

SSE：

```http
GET /api/realtime/events?scope=workbench
Last-Event-ID: 1234
```

事件：

```text
conversation.session.created
conversation.session.updated
conversation.item.created
conversation.timeline.rebuilt
conversation.mode.changed
conversation.assigned
conversation.handoff.requested
conversation.handoff.accepted
conversation.read_cursor.changed
communication.delivery.changed
ticket.updated
incident.updated
gateway.connection.changed
```

PostgreSQL 是唯一 durable replay 依据；进程内 Wakeup Hub 不携带 payload。Last-Event-ID 小于
retention floor 返回 gap fallback，大于 high watermark 返回 ahead；自然 identity 空洞不是 gap。
SESSION/THREAD/SYSTEM 与 RESTRICTED_ADMIN 在 SQL 中先裁剪并在返回前复核。32 clients、20 秒
heartbeat、5 秒 recovery poll、64 KiB buffer 与 5 秒 drain timeout 是 2C4G 默认值。

## 12. 页面结构（未来 P2-006，当前未授权）

### 左侧

- 待人工；
- 我的会话；
- 未分配；
- AI 处理中；
- 等待用户；
- 发送失败；
- 高优先级；
- 已结束。

列表项：

- 姓名/科室；
- 最后一条消息；
- 未读；
- 等待时长；
- 模式；
- 接待人；
- Ticket/Incident 标记；
- 投递异常标记。

### 中间

- 稳定时间线；
- sender 标识；
- 引用；
- 附件；
- 系统事件；
- 投递状态；
- 草稿与发送输入框。

### 右侧

- 用户/身份快照；
- 当前 Session 摘要；
- 已确认字段；
- Service Intake；
- Ticket；
- Incident；
- 历史工单；
- AI Run；
- 审计。

## 13. 安全

- 工作台必须认证；
- Session/Ticket/Attachment 均后端授权；
- 防 CSRF（Cookie 模式）或使用短期 Bearer；
- CSP、frame-ancestors、nosniff；
- 附件签名 URL；
- 内部备注不进入对外 API；
- SSE 只推授权范围；
- 搜索结果按权限裁剪；
- 操作日志使用哈希化身份；
- 不将患者原文写入浏览器错误日志。

## 14. P2-G1 未来验收场景（当前未启动）

以下是 P2-G1 的跨任务目标，不是 P2-002 的完成声明，也不表示相应能力已实现：

1. 企业微信单聊消息在 2 秒目标内出现在打开的 Workbench；
2. 重复同一 msgid 只有一个 Timeline Item；
3. 两名坐席同时接管只有一人成功；
4. 人工发送重复点击只产生一次 Outbox；
5. 人工接管前启动的 AI 结果不会发送；
6. 内部备注不会出现在企业微信；
7. SSE 断线后按 Last-Event-ID 补齐；
8. 群聊两名用户的问题不会混入同一 Session；
9. Delivery 失败可重试并可见；
10. Ticket Event 可进入时间线但不改变原始消息；
11. AI 服务关闭时人工全流程继续；
12. 浏览器刷新后会话顺序、已读和分配保持。

## 15. P2-006 Internal Alpha 完成边界

P2-006 已以默认关闭的 Reference Client 验证 REST、Pilot 数据面授权、P2-005 Control、P2-004
Communication、P2-003 SSE 与 Polling。它不等于上述 P2-G1 跨任务组装已经开始或通过；真实入站
Projector、真实 Sender、最终生产前端和任何 Feature Flag 启用仍须 P2-G1 或后续独立授权。
