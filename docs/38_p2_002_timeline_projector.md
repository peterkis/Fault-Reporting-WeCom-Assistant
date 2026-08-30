# 38. P2-002 持久化 Timeline Projector 与可重建投影

## 1. 文档状态与授权边界

本文记录已于 2026-08-30 完成的 `P2-002 / P2-A / DONE` 实现契约和运行边界；具体
执行结果见 `evidence/p2-002-timeline-projector-report.md`。P2-002 完成后已停止，当前无
活动任务或 Lane。

以下能力仍为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`：

- P2-003 Realtime Event Log、SSE、`Last-Event-ID` 和慢客户端治理；
- P2-004 Communication Message / Outbox / Delivery；
- P2-005 Handoff、Assignment、Read Cursor 和 Generation Fence；
- Workbench、AI/OCR、Incident、P2-G1 组装、全部 P3 能力；
- 生产或临床启用、真实医院内网连接、真实模型调用和新增企业微信外发路径。

全部 P2/P3 Feature Flag 继续为 `false`。本轮不推送、合并、打标签或发布远端。

## 2. 范围

P2-002 在 P2-001 已冻结的 Thread、Session 和 Conversation Item 词汇之上实现：

1. 规范化且经过隐私裁剪的 Timeline Source Record Contract；
2. Channel Message、Ticket Event、Notification Delivery 的只读 Mapper；
3. future Communication Message、future Handoff Event 的合成 fixture Mapper；
4. `conversation.item`、`conversation.item_source_binding`、
   `conversation.projection_checkpoint` 三张持久投影表；
5. 稳定 Canonical Order、Session 内连续 `sequence_no` 和数据库级并发串行化；
6. 幂等投影、Checkpoint 原子推进、乱序失败关闭；
7. 显式授权、单 Session、单事务 Rebuild 和 Canonical Timeline Hash；
8. 分页且按 Audience 裁剪的 Query Port；
9. 单 Worker、受限批次、可中止和 kill/restart 恢复接缝。

P2-001 的 Item Type、Sender Kind、Visibility、Thread/Session 唯一性、状态机和控制模式
含义保持不变。migration 010 是 Thread/Session 的权威物理结构；migration 011 是
Item/Binding/Checkpoint 的权威物理结构。

### 非目标

P2-002 不创建或启用 Realtime Event、SSE、HTTP Endpoint、Communication 表、Handoff、
Assignment、Read Cursor、AI/Memory、Incident、Integration 或第二套 Ticket 表；不安装数据库
Trigger，不修改 P1 表，不在 P1 入站路径自动启动 Projector，也不访问企业微信、模型、
对象存储或医院内网。`database/schema_draft.sql` 仅是概念导航，绝不能整体执行。

## 3. 事实源与读模型

```text
Channel Message / Ticket Event / Delivery / future Communication / future Handoff
                                ↓  read-only adapters / fixtures
                  Normalized Timeline Source Record
                                ↓
                       Timeline Projector
                                ↓
              Conversation Item + Source Binding
                                ↓
                    Projection Checkpoint
```

权威边界如下：

| 数据 | 权威来源 | P2-002 中的角色 |
|---|---|---|
| 原始入站消息 | `channel.message_inbox` | 只读映射为 `USER_MESSAGE` |
| Ticket 生命周期 | `pilot_ticket.ticket_event` / Unified Ticket Core | 只读映射，绝不取得 Ticket 状态所有权 |
| 通知送达 | `notification.delivery` | 只读映射为内部 Delivery 状态 |
| future 人工/AI 消息 | P2-004 的 Communication 事实 | 本轮仅 fixture Contract |
| future 接管事件 | P2-005 的 Handoff 事实 | 本轮仅 fixture Contract |
| 时间线显示 | `conversation.item` | 可删除、可重建读模型 |
| 来源关系 | `conversation.item_source_binding` | 幂等与追溯关系，不拥有源数据 |
| 扫描进度 | `conversation.projection_checkpoint` | 优化游标，不是业务事实或正确性根 |

投影失败、重放或重建都不得修改 Thread、Session、Service Intake、Ticket、Ticket Event、
Outbox、Delivery 或任何来源事实。Redis、内存游标和 Worker 本地状态都不能成为唯一投影
进度或幂等依据。

## 4. Normalized Timeline Source Record

Source Adapter 在 Projector 写事务外读取事实，并输出
`ConversationProjectionSourceRecord`（别名 `TimelineSourceRecord`）。Schema 固定
`additionalProperties: false`，核心字段如下：

| 字段 | 约束与含义 |
|---|---|
| `schema_version` | 固定为 `1` |
| `projector_name` | 固定为唯一名称 `CONVERSATION_TIMELINE`；进入幂等身份和 Checkpoint Key |
| `projector_version` | 1–64 字符；记录投影算法版本 |
| `source_stream` | 1–128 字符；有界逻辑扫描流 |
| `source_type` | 五个冻结类型之一 |
| `source_id` | 1–256 字符的系统内部稳定主键；禁止使用原始 provider `msgid` |
| `projection_variant` | 1–64 字符的大写稳定变体，例如 `STATUS`、`EXTERNAL_NOTE`、`INTERNAL_NOTE` |
| `session_id` | UUID；所有记录必须明确归属一个已存在 Session |
| `item_type` / `sender_kind` / `visibility` | 完全复用 P2-001 枚举和语义 |
| `text` | `null` 或最多 20,000 字符的已裁剪文本 |
| `safe_content` | 最多 64 个属性的有界纯 JSON object |
| `occurred_at` | RFC 3339 `date-time` |
| `source_ordinal` | `0..9223372036854775807` 的规范十进制字符串 |
| `source_hash` | 64 位小写 SHA-256 |
| `privacy_class` | 继承 P1 六级隐私枚举 |
| `retention_until` | 继承来源的 `date-time` 留存截止时间 |

`source_ordinal` 保持为十进制字符串并以 BigInt 语义比较；PostgreSQL `BIGINT` 不能未经
范围检查转换成 JavaScript `Number`。

### Source Hash 与控制信封

`source_hash` 是除 `source_hash`、`privacy_class`、`retention_until` 之外所有规范化
Source Record 字段的 canonical representation 的 SHA-256。也就是说，它覆盖 Projector/
Stream、来源身份与 Variant、Session、Item/Sender/Visibility、`text`、`safe_content`、
发生时间和 ordinal。

隐私等级和留存截止时间是独立继承的控制信封：同一语义来源重放时，它们只能收紧，
不能降低隐私等级或延长留存期限。控制信封收紧不制造语义冲突；其余受 Hash 覆盖的字段
发生变化则是来源冲突。

### safe_content

运行时在序列化和 Hash 之前拒绝 Proxy、accessor、symbol、`toJSON`、非普通原型和原型污染
键。嵌套对象/数组也必须有界。禁止保存原始 payload、加密 payload、AES Key、临时媒体
URL、`response_url`、Bot Secret、数据库 URL、原始 provider 错误、原始 `userid/chatid`、
Delivery `target_key`、`provider_message_id` 或 Ticket `operator_id`。

## 5. Source Type、Rank 与 Mapper

Source Rank 由 `source_type` 派生，调用方不能提交或覆盖：

| Source Type | Rank | 本轮来源 |
|---|---:|---|
| `CHANNEL_MESSAGE` | 10 | `channel.message_inbox` 只读 Mapper |
| `COMMUNICATION_MESSAGE` | 20 | future P2-004 fixture-only Mapper |
| `TICKET_EVENT` | 30 | `pilot_ticket.ticket_event` 只读 Mapper |
| `DELIVERY` | 40 | `notification.delivery` 只读 Mapper |
| `HANDOFF_EVENT` | 50 | future P2-005 fixture-only Mapper |

映射边界：

- `CHANNEL_MESSAGE`：`source_id=channel.message_inbox.id`，映射为
  `USER_MESSAGE / USER / EXTERNAL`；`text` 只取 `clean_text`，safe content 只保留
  `msg_type`、`relation_type`、`has_text`、`has_media` 等稳定安全字段；继承 Channel
  Message/Intake 的隐私与留存控制。
- `TICKET_EVENT`：`source_id=pilot_ticket.ticket_event.event_id`，映射为
  `TICKET_EVENT / SYSTEM`；稳定 safe content 可包含 `event_type`、`old_status`、
  `new_status`、`aggregate_version`、`event_ordinal`、`reason_code`。状态、外部备注和
  内部备注使用不同 Variant；`external_note` 只进入 `EXTERNAL`，`internal_note` 只进入
  `INTERNAL`，两者同时存在时生成两个独立 Item，且不复制 `operator_id`。
- `DELIVERY`：`source_id=notification.delivery.id`，映射为
  `DELIVERY_STATUS / SYSTEM / INTERNAL`；safe content 仅含 `channel`、`status`、
  `attempt_count` 和稳定 `error_code`，不复制 target、provider message ID 或原始错误。
- `COMMUNICATION_MESSAGE` 与 `HANDOFF_EVENT`：本轮只接受合成 Contract fixture，不查询
  不存在的表；Handoff 默认 `INTERNAL`。任何外部 Handoff 摘要须另行授权。

## 6. Projection Variant 与 Source Binding

一个事实可以按不同内容或 Audience 产生多个 Item。Ticket Event 的 `STATUS`、
`EXTERNAL_NOTE`、`INTERNAL_NOTE` 是典型例子，因此幂等身份固定为：

```text
(projector_name, source_stream, source_type, source_id,
 projection_variant, session_id)
```

`conversation.item_source_binding` 持久化上述身份，以及 `projector_version`、`item_id`、
`source_hash`、`canonical_order_key`、`created_at`、`last_seen_at`。其规则是：

1. 同一完整身份只绑定一个 Item；
2. 一个 Item 只有一个 Binding，`item_id` 是 Binding 主键；
3. 相同身份、相同 Hash 是安全重放，返回既有 Item/Binding 并更新受控的 last-seen/
   control-envelope 数据；
4. 相同身份、不同 Hash 以 `CONVERSATION_TIMELINE_SOURCE_CONFLICT` 失败关闭；
5. 不静默覆盖既有 Item，也不靠 `source_type + source_id` 这种不完整键去重；
6. Item 删除时 Binding 通过外键级联删除；Rebuild 在同一事务内删除并重建二者。

Binding 不为多态上游源表建立伪外键；它只保存内部稳定身份和投影追溯关系。

## 7. migration 011 的三表边界

`database/migrations/011_p2_002_timeline_projector.sql` 是以下结构的唯一权威迁移：

### `conversation.item`

持久化 UUID `id`、Session 外键、连续 `sequence_no`、冻结枚举、`text`、纯对象
`safe_content`、来源身份/Variant、`canonical_order_key`、`content_hash`、隐私/留存控制、
`occurred_at` 和 `projected_at`。约束包括：

- `session_id` 引用 `conversation.session(id) ON DELETE CASCADE`；
- `UNIQUE(id, session_id)` 为 Binding 的复合外键提供同 Session 约束；
- `sequence_no >= 1`，并且 `UNIQUE(session_id, sequence_no)`；
- `content_hash` 和来源 Hash 使用 64 位小写 SHA-256；
- `safe_content` 必须是 JSON object；
- 内外部显示分别由 `visibility` 和显式 Audience 控制。

### `conversation.item_source_binding`

`item_id` 为一对一主键；完整幂等身份有唯一约束；`session_id` 外键到 Session，且
`(item_id, session_id)` 复合外键到 Item 的 `(id, session_id)`，从数据库层禁止 Binding
指向另一 Session 的 Item；两者均 `ON DELETE CASCADE`。`(session_id,
canonical_order_key)` 索引用于顺序和重建检查。

### `conversation.projection_checkpoint`

主键固定为 `(projector_name, source_stream)`，而不是全局单游标。它保存
`projector_version`、可空 `cursor_value`、可空 `last_source_occurred_at`、可空
`last_batch_hash`、`row_version` 和 `updated_at`。

三表以外，migration 011 不创建任何未来表。迁移可重入且完整验证关系、列、类型、默认
值、约束、B-tree 索引和部分索引谓词；发现结构漂移以
`P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED` 失败关闭，不以 `IF NOT EXISTS` 掩盖错误
结构。migration 010、P1 表和既有索引保持不变。

## 8. Canonical Order 与 sequence_no

固定 Canonical Order Tuple 为：

```text
(
  occurred_at,
  source_rank,
  source_ordinal,
  source_type,
  source_id,
  projection_variant
)
```

时间首先按规范化时刻比较；Rank 为上表固定数值；ordinal 按无符号 BigInt 语义比较；
其余字符串按固定字节序比较。`canonical_order_key` 使用以下可按字典序排序的 UTF-8 安全
编码：规范 ISO 时刻、两位 Rank、19 位左补零 ordinal、`source_type` 的 UTF-8 hex、
`source_id` 的 UTF-8 hex、Variant 的 UTF-8 hex，以固定分隔符连接。该编码精确表示完整
Tuple，不依赖 JavaScript Object 遍历顺序、数据库物理顺序、本地时区或无 `ORDER BY`
查询。

Projector 先按 Session 分组，再按完整 Tuple 排序。每个 Session 的 `sequence_no` 从 1
开始且连续。并发写入使用
`hashtextextended('P2_002_SESSION:' || session_id, 0)` 确定性派生的 PostgreSQL
transaction-level advisory lock；多个 Session 按确定顺序取锁。锁覆盖尾部检查、Binding
判定、sequence 分配、Item/Binding 写入和 Checkpoint 推进。进程内 Mutex 不是正确性边界，
且无锁 `MAX(sequence_no)+1` 被禁止。

## 9. Batch 与 Checkpoint 原子性

`projectBatch` 的事务协议是：

1. 在事务外由 Source Adapter 分批读取并规范化安全记录；
2. 校验 Projector/Stream 与每条 Record 一致，按 Session 和 Canonical Order 排序；
3. 开启数据库事务，先以
   `hashtextextended('P2_002_CHECKPOINT:' || projector_name || ':' || source_stream, 0)`
   串行化 Checkpoint，再按稳定 Session 次序取得 Session advisory transaction lock；
4. 校验 Session 存在、expected checkpoint、当前 Timeline 尾部和 Source Binding；
5. 分配 `sequence_no`，插入新 Item 与 Binding；安全重放不生成第二个 Item；
6. 以 compare-and-set 语义更新同一 `(projector_name, source_stream)` 全局 Checkpoint；
7. Item、Binding 和 Checkpoint 一次提交；任一步失败全部回滚。

只有普通增量 `projectBatch` 才推进这个全局 Checkpoint。单 Session Rebuild 不能声称替代
整个 Source Stream 的扫描进度，也不得回退、跳过或重写全局游标。

可选 expected checkpoint 以 `cursor_value + row_version` 防止两个扫描者静默越过彼此；
不匹配返回 `CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT`。Checkpoint 只用于减少扫描：
Checkpoint 丢失或回退会重读事实，但完整 Binding 身份使重放不重复；Checkpoint 绝不能
在相应 Item/Binding 提交前单独前移。

`last_batch_hash` 是规范化批次的 opaque 完整性摘要，不包含业务原文。Projector 的安全
结果只返回计数、是否推进和 Hash，不返回源文本、外部身份、SQL 或原始数据库错误。

## 10. 幂等、冲突与乱序

| 条件 | 结果 |
|---|---|
| 新身份，且位于现有尾部之后 | 插入 Item + Binding，分配下一个 sequence |
| 相同身份、相同 Hash | 返回既有 Binding；不重复 Item |
| 相同身份、不同 Hash | `CONVERSATION_TIMELINE_SOURCE_CONFLICT` |
| sequence 唯一性异常 | `CONVERSATION_TIMELINE_SEQUENCE_CONFLICT` |
| expected checkpoint 不匹配 | `CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT` |
| 新记录 Canonical Order 早于现有尾部 | `CONVERSATION_TIMELINE_REBUILD_REQUIRED` |

乱序记录不得静默追加，也不得在普通增量路径中重编号已有 Item。调用方必须停止该 Session
的增量推进，取得完整 Source Record 集并走显式 Rebuild。这样普通写入保持有界，读者不会
在无授权情况下看到时间线大范围变动。

## 11. 显式单 Session Rebuild 与 Canonical Hash

Rebuild 输入必须包含 `sessionId`、唯一 Projector `CONVERSATION_TIMELINE` 的名称/版本、
当前 Session 的完整 Source Record 集合、显式授权和可选 `AbortSignal`。流程固定为：

1. 在写事务前完成输入边界校验，并确认所有记录都属于目标 Session；
2. 开启事务，按稳定顺序取得输入涉及的 Checkpoint advisory transaction lock，再取得目标
   Session lock；锁只用于与增量路径串行化，不表示 Rebuild 可以推进全局游标；
3. 重新规范化、按 Canonical Tuple 排序并验证无身份/Hash 冲突；
4. 在锁内读取该 Session 的全部既有 Item/Binding，逐一核对完整 Binding identity、
   `source_hash`、privacy class 与 retention deadline；缺失事实、Hash 变化或试图放宽控制
   信封的 stale snapshot 均以稳定 Rebuild 错误失败关闭；
5. 在同一事务删除该 Session 的 Binding/Item，从空投影开始重建；
6. 从 1 连续分配 `sequence_no` 并写入 Item/Binding；所有
   `(projector_name, source_stream)` 全局 Checkpoint 保持原值，结果固定为
   `checkpoint_updated=false`；
7. 从事务内持久化 Item 与 Binding 重新读取 Canonical Timeline，并将 Item 数与 Hash 和
   授权输入比对；
8. 原子提交。任何异常或中止使整个事务回滚。

数据库读者在 PostgreSQL 事务隔离下只能看到旧投影或新投影，不能看到半空时间线。
Canonical Timeline Hash 包含 `session_id`、`sequence_no`、`item_type`、`sender_kind`、
`visibility`、`content_hash`、来源身份、`projection_variant` 和 `occurred_at`；排除
`projected_at`、数据库物理顺序、Worker ID、运行 ID 和其他瞬态值。相同完整安全输入的
重建结果必须得到相同 sequence 和 Hash；内存输入 Hash 不能替代对事务内持久化结果的
重新读取和比对。

维护命令只接受 `--check`（默认）、`--apply` 和 `--session-id=<uuid>`。真实写入同时要求
`--apply` 与一次性环境批准 `P2_002_REBUILD_APPROVED=true`，且在创建数据库连接池前
校验授权。数据库 URL 只从 `PILOT_DATABASE_URL` 读取；CLI 不接受 SQL、文件路径或数据库
URL 参数，输出仅含安全计数和 Hash，不打印 Session 外部身份或内容。

## 12. Worker kill/restart

| 故障点 | 一致性结果 |
|---|---|
| 读取 Source Record 时终止 | 尚未写入；重启从 Checkpoint 重读 |
| 增量 Item/Binding/Checkpoint 或 Rebuild Item/Binding 提交前终止 | 同一事务全部回滚 |
| Commit 已成功、调用方收到 ACK 前终止 | 重启重放命中既有 Binding，不产生重复 Item |
| Checkpoint 丢失或回退 | 重读安全；Binding 仍是幂等防线 |
| Checkpoint CAS 冲突 | 当前批次回滚，调用方重新读取 Checkpoint |
| AbortSignal 在写事务中触发 | 抛出稳定错误并回滚，不吞异常 |

Source 读取发生在事务外；事务内不进行 HTTP、企业微信、模型、对象存储或其他外部调用。
“Checkpoint 已前移但 Item 未提交”由单事务边界排除。

## 13. Query Port、Visibility 与 Audience

`listTimelineItems` 必须显式传入 Audience；没有默认高权限。分页使用 `sequence_no`，默认
`limit=50`，最大 200：

| Audience | 可见范围 |
|---|---|
| `EXTERNAL` | 仅 `visibility=EXTERNAL` |
| `WORKBENCH` | `EXTERNAL` + `INTERNAL`，不含 `RESTRICTED` |
| `RESTRICTED_ADMIN` | 只有同时提供显式受限授权时才可包含 `RESTRICTED` |

普通 Workbench 查询不能通过参数升级成受限管理员。P2-002 只实现 Query Port，不实现
HTTP/SSE Endpoint；后续 UI/API 仍必须在后端重新执行身份和作用域授权。

## 14. 隐私与留存

- Item 复制来源的 `privacy_class` 与 `retention_until`，并在重放时只允许控制信封收紧；
- 隐私顺序沿用 P1：`PUBLIC`、`INTERNAL`、`SENSITIVE_INTERNAL`、`PERSONAL`、
  `PATIENT_SENSITIVE`、`SECRET`；
- Channel Message 不复制 `raw_text`、原始/加密 payload 或临时媒体凭证；
- Ticket `internal_note` 永不进入 External Item；
- Delivery target、provider message ID、原始错误和用户标识永不进入 Item；
- Restricted Item 不进入普通 Workbench 或 External 查询；
- 日志、CLI 和公共错误只记录稳定错误码、数量、时长和 opaque hash；
- 测试和设计示例只使用合成数据，不使用患者真实数据；
- 到期投影的清理是未来受审维护行为；它删除可重建 Item/Binding，不修改上游事实。

## 15. 2C4G 资源边界

- 单 Worker、Projector 并发默认 1；
- `batchSize` 默认 20、硬上限 200；
- Rebuild 每次只处理一个 Session，不把全系统历史加载到内存；
- Query 默认 50、最大 200，始终使用 sequence 分页；
- 迁移和 Rebuild CLI 数据库连接池 `max=1`；应用总连接池仍遵守项目 2C4G 上限；
- 不新增 Redis 必需依赖、Kafka、RabbitMQ、ORM、TypeScript runtime、本地模型、
  Elasticsearch 或常驻重型进程；
- 事务只做本地数据库工作，锁持有期间不等待外部服务；
- 大批量验证必须使用有界分批并支持中断续跑，不能以一次性全量数组作为运行模型。

## 16. Feature Flag、关闭与回滚

Projector 构造参数 `enabled` 默认 `false`。关闭时在任何数据库调用前返回
`CONVERSATION_TIMELINE_DISABLED`；维护 CLI 的显式 check/apply 只授权一次维护动作，
不等于启用任何 P2 Feature Flag。

运行回滚的首选方式是保持/恢复 Feature Flag 为 `false`，停止 Worker，并保留来源事实。
P1 运行链路不依赖三张投影表，因此 Projector 关闭不会阻断入站、受理、Ticket 或既有通知。
结构变更必须通过新的受审编号迁移处理；不得改写 migration 011，也不得用临时破坏性 SQL
删除事实源。若投影损坏，先关闭增量 Worker，再在受控 `--check` 后按单 Session 显式重建。

## 17. 稳定错误边界

公开错误只暴露以下稳定码及安全元数据，不包含 SQL、PostgreSQL 原始错误、数据库 URL、
Source 原文、内部备注、外部身份、Provider 原始错误或 Secret：

```text
CONVERSATION_TIMELINE_DISABLED
CONVERSATION_TIMELINE_SOURCE_INVALID
CONVERSATION_TIMELINE_SESSION_NOT_FOUND
CONVERSATION_TIMELINE_SOURCE_CONFLICT
CONVERSATION_TIMELINE_SEQUENCE_CONFLICT
CONVERSATION_TIMELINE_REBUILD_REQUIRED
CONVERSATION_TIMELINE_REBUILD_NOT_AUTHORIZED
CONVERSATION_TIMELINE_REBUILD_FAILED
CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT
CONVERSATION_TIMELINE_STORAGE_FAILED
P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED
```

## 18. 后续任务如何消费本 Contract

### P2-003（未来，未授权）

P2-003 可在另行授权后把已提交的 Timeline 变化转换为独立 Realtime Event Log，并通过 SSE
补放。它必须引用 Item/Session 的稳定内部身份和 sequence，不得把 SSE 或 Realtime Event
反向变为时间线事实源，也不得把 Projection Checkpoint 当作 `Last-Event-ID`。P2-003 的事件
提交原子性、保留期、慢客户端和权限裁剪必须在自己的 Contract/迁移中解决。

### P2-004（未来，未授权）

P2-004 可在另行授权后提供权威 Communication Message / Outbox / Delivery 事实，并实现
当前 `COMMUNICATION_MESSAGE` fixture Adapter 的真实只读版本。Communication 事务不得直接
写或拥有 Timeline Item；投影仍通过本 Contract 的 Source Record、Variant、Binding 和
Checkpoint 接入。真实外发只能由 Delivery Worker 执行，Projector 永远不调用 WeCom SDK。

以上“可消费”是接口兼容说明，不是启动授权。P2-003、P2-004、P2-G1 和所有后续能力保持
未启动；P2-002 的实现或测试结果不能被表述为 P2-G1、生产或临床验收。

## 19. 验证与 Evidence 分界

P2-002 已通过 Contract/Unit 39/39 与 PostgreSQL Integration 13/13。数据库验收覆盖只读
Source Mapping、并发、乱序、Rebuild、Visibility、真实 `SIGKILL` 后重启、锁内 stale
rebuild race、只应用 migration 011 的受限 CLI、2,001 Item 有界批次和隔离数据库清理。
完整执行命令、全仓回归数字、资源测量、Hash 与残留检查只以
`evidence/p2-002-timeline-projector-report.md` 为准。该完成结论不启动 P2-003 或 P2-G1。
