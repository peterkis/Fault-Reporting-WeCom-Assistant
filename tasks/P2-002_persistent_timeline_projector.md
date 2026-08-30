# P2-002 持久化 Timeline Projector 与可重建投影

## 状态

`DONE`（2026-08-30）

项目负责人已通过 `evidence/p2-002-start-authorization.md` 正式、独立授权本任务。
完成验证见 `evidence/p2-002-timeline-projector-report.md`。P2-002 完成后已停止；当前无
活动任务或 Lane，P2-003 及以后任务和 P2-G1 仍须另行授权。

## 输入

- V1.4 架构基线和 Accepted ADR-0010、ADR-0011、ADR-0012；
- P2-001 冻结的 Thread、Session、Item 枚举和控制模式 Contract；
- P1 的 Channel Message、Ticket Event、Notification Delivery 事实结构；
- 合成 Communication Message 与 Handoff Event fixture；
- 2 CPU / 4GB RAM、单 Worker、默认 batch 20 的资源约束。

## 输出与 Contract

- `conversation_projection_source.schema.json`：规范化安全 Source Record；
- `conversation_projection_checkpoint.schema.json`：按 Projector/Source Stream 的安全进度视图；
- `conversation_projection_contracts.d.ts`：Source、Binding、Checkpoint、Audience 与结果类型；
- 通用 `TimelineSourceAdapter` Port；
- Channel Message、Ticket Event、Notification Delivery 的只读 Mapper；
- Communication Message、Handoff Event 的 fixture-only Mapper；
- 稳定 Canonical Order、Canonical Timeline Hash 和 Projection Variant；
- 唯一 `CONVERSATION_TIMELINE` Projector、Query Port、Worker 与显式单 Session Rebuild；
- 稳定、无敏感原文的 `CONVERSATION_TIMELINE_*` 错误码。

P2-001 的 Item Type、Sender Kind、Visibility、Thread/Session 唯一性、状态机和控制模式
语义保持不变。

## 事实源与投影边界

```text
Channel Message / Ticket Event / Delivery / future Communication / future Handoff
                                ↓
                 Normalized Timeline Source Record
                                ↓
                    Timeline Projector
                                ↓
             Conversation Item + Source Binding
                                ↓
                    Projection Checkpoint
```

Conversation Item、Source Binding 和 Projection Checkpoint 都不是新的业务事实源。
投影失败或重建不得修改 Thread、Session、Intake、Ticket、Outbox、Delivery 或任何源表。

## 数据库变更

新增 `database/migrations/011_p2_002_timeline_projector.sql`，且只允许创建：

1. `conversation.item`；
2. `conversation.item_source_binding`；
3. `conversation.projection_checkpoint`；
4. 与上述三表直接相关的约束和索引。

迁移必须可重入并对结构漂移失败关闭，稳定错误为
`P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。不得修改 migration 010、任何 P1 表或创建
Realtime、Handoff、Assignment、Read Cursor、Communication、AI、Integration 或新 Ticket 表。

## 顺序、幂等与一致性

Canonical Order Tuple 固定为：

1. `occurred_at`；
2. 固定 Source Rank；
3. `source_ordinal`；
4. `source_type`；
5. `source_id`；
6. `projection_variant`。

幂等身份至少包含 Projector、Source Stream、Source Type、Source ID、Projection Variant
和 Session。相同身份/相同 Hash 返回既有 Binding；相同身份/不同 Hash 失败关闭。同一
Session 通过 PostgreSQL 事务级 advisory lock 分配连续 `sequence_no`，禁止无锁
`MAX(sequence_no)+1`。早于现有尾部的增量返回
`CONVERSATION_TIMELINE_REBUILD_REQUIRED`。

普通增量 `projectBatch` 必须把 Item、Binding 与全局
`(projector_name, source_stream)` Checkpoint 在同一事务 CAS 提交，且只有该增量路径推进
Checkpoint。Checkpoint 只是扫描优化；丢失或回退由 Binding 保证安全重放。提交前终止
全部回滚；提交后 ACK 丢失由重放返回既有结果。

显式单 Session Rebuild 按稳定顺序锁住所涉全局 Checkpoint Key 与目标 Session，但保留
Checkpoint 原值并返回 `checkpoint_updated=false`。删除前在锁内以当前 Session 的全部
Binding identity、source hash、privacy 和 retention 控制信封拒绝 stale snapshot；写入后
必须从持久化 Item/Binding 重读并核验 Canonical Timeline Hash，之后才可提交。

## Visibility、隐私与留存

- `EXTERNAL` 只读取 External Item；
- `WORKBENCH` 可读取 External/Internal，但不能读取 Restricted；
- `RESTRICTED_ADMIN` 仍须显式授权；
- Ticket `internal_note` 永不进入 External Item；
- Channel Message 只使用 `clean_text`，不复制 raw text/payload；
- Delivery 不复制 target、provider message ID 或原始错误；
- Item 继承 `privacy_class` 和 `retention_until`；
- safe content 必须是无 Proxy、无 `toJSON`、无原型污染的纯 JSON object；
- 日志、CLI 和 Evidence 只输出稳定码、数量、时长和 opaque hash。

## 测试与验收

- Contract/Unit：Schema、枚举、日期/UUID/ordinal、纯 JSON、固定排序/Hash、五类 Mapper、
  多 Variant、隐私裁剪、Feature Flag 关闭、batch 边界、公共错误与 Audience；
- PostgreSQL Integration：迁移首次/重复/漂移、结构范围、重放/冲突、12 路并发、乱序、
  Checkpoint 原子性、故障回滚、ACK 丢失、重建、Visibility、2,000+ 合成 Item、Worker
  kill/restart 和隔离数据库清理；
- Read-only Mapping：验证 P1 Schema fixture，不修改源表、不安装 Trigger；
- 回归：架构、P2-001、P1-011、P1-012 和全仓串行测试。

关键验收已经通过：Contract/Unit 39/39、PostgreSQL Integration 13/13；数据库验收包含
真实 `SIGKILL` 后重启恢复、锁内 stale rebuild race 拒绝、only-011 CLI、2,001 Item
有界批次，以及隔离数据库清理。全仓最终回归数字、资源测量、Hash 与残留检查只以完成
Evidence 为准。P2-003 与 P2-G1 未启动。

## Feature Flag 与资源上限

所有 P2/P3 Feature Flag 保持 `false`。Projector 默认禁用；关闭时不得调用数据库。
单 Worker、Projector 并发 1、默认 batch 20、查询最大 200、迁移连接池最大 1；不新增
Redis/Kafka/RabbitMQ/ORM/TypeScript runtime/本地模型/Elasticsearch 或常驻进程。

## Evidence

- 启动授权：`evidence/p2-002-start-authorization.md`；
- 完成验证：`evidence/p2-002-timeline-projector-report.md`。

## Rollback / 关闭方式

- 运行时保持 Feature Flag 为 `false` 即关闭 Projector；
- Rebuild 默认 `--check`，写入同时要求 `--apply` 与一次性
  `P2_002_REBUILD_APPROVED=true`；
- P1 运行路径不依赖新表；
- 如未来需撤销结构，必须另立受审迁移，不改写 011，不使用临时破坏性命令。

## 停止线

P2-002 完成即停止。不得启动 P2-003、P2-G1 或任何未授权能力；不得推送、合并、打
标签或发布远端。
