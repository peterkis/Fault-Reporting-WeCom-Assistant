# P2-002 持久化 Timeline Projector 与可重建投影 Evidence

## 1. 结论与范围

- 日期：2026-08-30
- 分支：`phase2/conversation-core`
- 远端基线：`a30dced5fc62fa62ace1ebe1b86cd765f9f73310`
- 启动授权提交：`03402b1dd13fce822920e6c96dae87420cbb6d6b`
- 授权范围：仅 P2-002
- 结论：实现、数据库验收、第二轮独立代码终审和第 13 节最终回归全部通过，本报告作为 P2-002 DONE Evidence。

P2-003 及以后任务、P2-G1、P3、生产/临床启用、真实医院内网、模型和新的企业微信出站路径均未获授权。所有 P2/P3 Feature Flag 保持 `false`。

## 2. 文件清单

### Contract、数据库、Runtime 与命令

- `contracts/conversation_projection_source.schema.json`
- `contracts/conversation_projection_checkpoint.schema.json`
- `contracts/conversation_projection_contracts.d.ts`
- `database/migrations/011_p2_002_timeline_projector.sql`
- `scripts/p2-002-migrate.mjs`
- `scripts/p2-002-rebuild.mjs`
- `src/p2-002-timeline-projector.mjs`
- `package.json`

### 测试与辅助程序

- `tests/p2-002-timeline-projector.test.mjs`
- `tests/p2-002-timeline-projector.integration.test.mjs`
- `tests/helpers/p2-002-postgres-harness.mjs`
- `tests/helpers/p2-002-migrate-process-harness.mjs`
- `tests/helpers/p2-002-worker-process-harness.mjs`
- `tests/helpers/p2-002-worker-child.mjs`
- `tests/helpers/p2-002-migrate-child.mjs`

### 设计、状态与索引

- `docs/38_p2_002_timeline_projector.md`
- `CONTEXT.md`
- `database/schema_draft.sql`
- `docs/33_conversation_center_and_handoff.md`
- `docs/37_parallel_delivery_and_acceptance.md`
- `tasks/P2-002_persistent_timeline_projector.md`
- `AGENTS.md`、`README.md`、`FILE_INDEX.md`、`CHANGELOG.md`
- `docs/00_latest_architecture_boundary.md`、`docs/00_project_context.md`、`docs/01_prd.md`、`docs/04_phase_tasks.md`、`docs/architecture_baseline_status.md`
- `plans/current_phase.json`、`plans/master_backlog.json`、`plans/parallel_workstreams.json`、`plans/phase_2_ai_enhancement.md`、`plans/roadmap.md`
- `tasks/master_backlog.json`、`tickets/P2_ai_enhancement_tasks.md`、`MANIFEST.json`、`project_summary.json`
- `scripts/validate-v1-4-architecture.mjs`、`tests/v1-4-architecture-baseline.test.mjs`、`tests/g0-008-capability-freeze.test.mjs`

## 3. Contract 与事实边界

- 唯一 Projector 名冻结为 `CONVERSATION_TIMELINE`。
- Source Type 冻结为 `CHANNEL_MESSAGE`、`COMMUNICATION_MESSAGE`、`TICKET_EVENT`、`DELIVERY`、`HANDOFF_EVENT`。
- P2-001 的 Item Type、Sender Kind、Visibility 枚举逐项保持不变。
- Source Record 使用封闭 Schema、显式长度、UUID/date-time、规范化 BIGINT 字符串和安全 JSON object；拒绝 Proxy、accessor、`toJSON`、污染键、循环和危险字段。
- `source_hash` 仅覆盖规范化安全语义输入；Conversation Item、Binding 和 Checkpoint 都不是业务事实源。
- 当前 P1 Adapter 在一个 `REPEATABLE READ READ ONLY` 事务读取 Channel Message、Ticket Event 和 Delivery；Communication/Handoff 仅有 Fixture Mapper，不查询未来表。

## 4. Migration 011

只创建三个永久普通表：

1. `conversation.item`
2. `conversation.item_source_binding`
3. `conversation.projection_checkpoint`

核心约束：

- Item：`PRIMARY KEY(id)`、`UNIQUE(id, session_id)`、`UNIQUE(session_id, sequence_no)`、Session FK、`sequence_no >= 1`、冻结枚举、JSON object、长度、SHA-256 和隐私类别约束。
- Binding：`PRIMARY KEY(item_id)`、完整幂等身份唯一约束、Session FK、复合 `(item_id, session_id)` FK 到 Item 并 `ON DELETE CASCADE`、hash/order/seen-time 约束。
- Checkpoint：`PRIMARY KEY(projector_name, source_stream)`、cursor/hash/正数 BIGINT row-version 约束。
- 显式索引：External Timeline 部分 B-tree、Retention B-tree、Binding Session/Order B-tree；PK/Unique 同时产生其权威唯一索引。

验收结果：

- 直接执行 011 首次和重复均通过。
- CLI 四次真实子进程 `check-before/apply/apply-repeat/check-after` 全部 exit 0；CLI 只读取/执行 011，check 模式回滚。
- 缺列、弱 CHECK、错误 Unique、错误索引方法、错误部分谓词全部稳定失败关闭为 `P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。
- 不兼容只读源依赖时子进程 exit 1、未创建 P2 表。
- 非系统 schema/table/relation/function/procedure/type/domain/enum/extension/trigger inventory 证明只新增上述三表及其直接约束/索引/comments；P1 和 migration 010 catalog/trigger 前后完全一致。

## 5. 幂等、排序与并发

Canonical Order Tuple 固定为：

1. `occurred_at`
2. 固定 Source Rank
3. `source_ordinal`
4. `source_type`
5. `source_id`
6. `projection_variant`

BIGINT 不转为不安全的 JavaScript Number。相同时间戳的逆序输入仍按固定 Rank/tie-breaker 排序。单 Session 使用 PostgreSQL advisory transaction lock；12 路同 Source 得到 1 insert + 11 replay，12 路不同 Source 得到 12 insert 和连续唯一 sequence 1..12。乱序增量返回 `CONVERSATION_TIMELINE_REBUILD_REQUIRED`，不静默追加或重排。

## 6. Checkpoint、事务与 Rebuild

- 增量 `projectBatch` 才在 Item/Binding 同一事务内 CAS 推进全局 `(projector_name, source_stream)` Checkpoint。
- 锁序固定为排序后的 Checkpoint locks，再到 Session lock；未发现反向锁序。
- 单 Session Rebuild 锁住但不创建、不更新、不前移全局扫描 Checkpoint，返回 `checkpoint_updated=false`。
- 删除前在 Session 锁内核对全部 Binding identity/hash/privacy/retention。确定性 stale-snapshot race 返回 `CONVERSATION_TIMELINE_REBUILD_FAILED`，并保留 3 Item、3 Binding、cursor 3；补全快照后重建成功。
- Rebuild 在提交前读取持久化 Item+Binding 重新计算 hash；输入、返回值和持久化结果相等才提交。
- 本次专门验收运行的完整 Rebuild hash 为 `576a571b69b95051a2a93e12963b6459c3221c01f034b05361d08e9449ba09e1`；stale-race 补全快照 hash 为 `4791d0c49db7b95c59fabe7d5be9272a7eac3523739adce391afc4343cdfee07`。

## 7. Worker Kill/Restart

- 提交前：真实 Node 子进程在 `beforeCommit` 阻塞后被 OS `SIGKILL`；backend 关闭后 Item/Binding/Checkpoint 为 0/0/0；新进程重启插入 1 条。
- 提交后、ACK 前：真实子进程被 `SIGKILL`；数据库保持 1 Item、1 Binding、cursor 1；新进程重启得到 1 replay、0 重复。
- child 事件、退出和迁移子进程均有硬超时，`finally` 清理 pool/IPC/随机数据库。

## 8. Visibility、Privacy 与 Retention

- EXTERNAL 只返回 EXTERNAL；WORKBENCH 返回 EXTERNAL/INTERNAL 但不返回 RESTRICTED；RESTRICTED_ADMIN 同时要求显式参数和 authorizer。
- Ticket Event 的 external/internal note 拆为不同 variant；internal note 不进入 External Item。
- Channel 只复制 `clean_text` 与四个安全标记；不复制 raw text/payload、媒体 URL、AES Key、response URL 或原始身份。
- Delivery 只复制 channel/status/attempt_count/stable error code；不复制 target、provider message id 或原始错误。
- Item 继承或只能收紧 `privacy_class` 和 `retention_until`；stale fence 防止 Rebuild 降低既有控制。
- 9 张 P1 源事实表在 Adapter 读取/Rebuild 前后 row count 和 JSON digest 不变；非内部 Trigger 清单不变。Adapter 读取后、显式 Rebuild 前 Item/Binding/Checkpoint 为 0/0/0，证明未自动启动 Worker。

## 9. Contract/Unit 结果

`npm run test:p2:002`：39 tests，39 pass，0 fail，0 skip。

覆盖冻结枚举、Schema、非法输入、纯 JSON、Proxy/accessor/Date 错误脱敏、hash、固定排序、五类 Mapper、隐私、Feature Flag、batch 边界、全部 11 个稳定错误、audience、adapter、worker、checkpoint 和 migration seam。

## 10. PostgreSQL Integration 与资源结果

`npm run test:p2:002:integration`：13 tests，13 pass，0 fail，0 skip/cancel。

- 32 项数据库矩阵全部有实际断言。
- 2,001 Item 使用 101 批、最大 batch 20；cursor 20 处 Abort 后新 Worker 续写剩余 1,981 条。
- 101 个 heap 样本；峰值增量 16,672,064 bytes；四段均值为 15,343,088 / 17,689,469 / 19,741,666 / 23,032,726 bytes；首末趋势 7,689,638 bytes；最大相邻分段趋势 3,291,060 bytes，均在固定 256 MiB 验收上限内。
- Projector 默认并发 1、默认 batch 20、查询最大 200；无 Redis/Kafka/RabbitMQ/ORM/本地模型/Elasticsearch/常驻新进程依赖。

## 11. P1/P2-001 回归

- `npm run test:p2:001`：13/13 pass。
- `npm run test:p2:001:integration`：1/1 pass，真实 PostgreSQL，0 skip。
- `npm run test:p1:011:integration`：11/11 pass。
- `npm run test:p1:012:integration`：46/46 pass。
- P1 `DONE / GO` 事实、P2-001 Contract 和 migration 010 均未改变。

## 12. 清理与本地数据库状态

- 随机 `template0` 测试数据库：suite 结束后 0。
- Worker PostgreSQL backend：suite 结束后 0。
- 隔离 Source data residual：0；隔离 Projection schema residual：0。
- 本地 `.env.pilot` 指向的开发数据库已应用并验证 migration 011；三张目标表当前 Item/Binding/Checkpoint 行数均为 0。该空权威结构不是临时测试残留，Feature Flag 仍关闭。

## 13. 最终架构与全仓回归

- `npm run validate:architecture:v1.4`：174/174 checks passed。
- `npm run test:architecture:v1.4`：10/10 pass，0 fail/skip。
- `npm run test:g0:008`：3/3 pass。
- `npm run test:p2:001`：13/13 pass。
- `npm run test:p2:001:integration`：1/1 pass，0 skip。
- `npm run test:p2:002`：39/39 pass。
- `npm run test:p2:002:integration`：13/13 pass，0 skip。
- `npm run test:p1:011:integration`：11/11 pass。
- `npm run test:p1:012:integration`：46/46 pass。
- `node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs`：281/281 pass，0 fail/cancel/skip/todo，39.612 s。

上述结果只关闭 P2-002，不主张远端发布、P2-G1 或 P2-003 已获授权。

## 14. 独立终审与剩余问题

第二轮只读终审结论：代码/测试层无 HIGH、无 MED，不存在阻止 P2-002 DONE 的实现问题。

仅保留一个非阻断 LOW：两个测试 harness 在极端 OS 强杀本身失败或退出超时时没有第二层跨平台进程回收机制。本次真实 `SIGKILL`、backend 关闭以及 suite residual=0 全部通过。

## 15. 停止线

- 未启动 P2-003；未实现 SSE、Realtime Event Log 或 Workbench。
- 未实现 Communication Outbox、Handoff、Assignment 或 Read Cursor。
- 未接入 DeepSeek，未启用 AI，未启用任何 P2/P3 Feature Flag。
- 未接医院内网，未新增真实企业微信出站能力。
- 未改变 Unified Ticket Core 的事实所有权。
- P2-G1 未启动、未通过；未推送、合并、打标签或发布远端。
