# Card 42C-4 `conversation.realtime_event` 过期索引去重推理

## 1. 两套现有过期索引对比

| 索引名 | 定义来源 | 列定义 | 时间列类型 | 状态 |
| --- | --- | --- | --- | --- |
| `conversation_realtime_event_expiry_event_idx` | `012_p2_003_realtime_event_log.sql` | `(expires_at, event_id)` | `timestamp without time zone`（022 从 `timestamptz` 转换） | **删除（077）** |
| `conversation_realtime_expiry_epoch_idx` | `022_arch_005_asia_shanghai_time_contract.sql` | `(expires_epoch_ms, event_id)` | `bigint`（ARCH-005 绝对纪元毫秒） | **保留** |

## 2. 清理路径与全部读写代码审计

对 `app/server/src/p2-003-realtime-event-log.mts` 及全仓所有引用 `conversation.realtime_event` 的代码逐条核对如下：

1. **留存候选查询 `readRetentionCandidates`**（`p2-003-realtime-event-log.mts`）：
   ```sql
   SELECT event.event_id::text, event.expires_at, event.expires_epoch_ms::text
     FROM conversation.realtime_event AS event
    WHERE event.stream_name = $1
      AND event.event_id > $2::bigint
    ORDER BY event.event_id
    LIMIT $3
   ```
   - 清理任务必须按单调递增 `event_id` 推进连续的 `retention_floor_event_id`，因此在数据库端使用主键/流序扫描（`event_id > $2 ORDER BY event_id`），在应用层 `expiredPrefix()` 中用 `BigInt(assertEpochMsString(row.expires_epoch_ms)) <= cutoff` 判定连续过期前缀，再按 `WHERE stream_name = $1 AND event_id = ANY($2::bigint[])` 删除。
   - 也就是说，**两套过期索引在当前 `readRetentionCandidates` 的 `WHERE`/`ORDER BY` 中均未直接参与排序扫描**；而应用层过期比较使用的是 `expires_epoch_ms`（而非 `expires_at`）。
2. **幂等重放收紧过期时间 `appendRealtimeEvent`**（`p2-003-realtime-event-log.mts`）：
   - 比较 `BigInt(command.expires_epoch_ms) < BigInt(assertEpochMsString(existing.expires_epoch_ms))`，并在 `UPDATE` 的 `WHERE` 中使用 `AND expires_epoch_ms > $5::bigint`。
3. **重放查询与游标读取**（`listAuthorizedRealtimeEvents`、`readReplayWindow`、`p2-016-realtime-projector.mts`、`p2-012-realtime-projector.mts`、`workbench-reminders.mts`）：
   - 均未在 `WHERE` 或 `ORDER BY` 中使用 `expires_at` 或 `expires_epoch_ms`。

## 3. 决策结论

- **删除**：`conversation.conversation_realtime_event_expiry_event_idx (expires_at, event_id)`；
- **保留**：`conversation.conversation_realtime_expiry_epoch_idx (expires_epoch_ms, event_id)`。

**理由**：
1. 根据 ARCH-005 时间契约（`022`），过期（expiry）与留存（retention）属于物理时钟比较语义，权威判定列是 `expires_epoch_ms`（`bigint`），`expires_at` 仅作为派生的本地展示/对齐列存在；
2. 所有运行时过期判断（`expiredPrefix` 与 `appendRealtimeEvent` 的收紧 `UPDATE`）都只比较 `expires_epoch_ms`；未来若清理或监控按时间窗口检索过期事件，走 `(expires_epoch_ms, event_id)` 可直接匹配整型范围比较而无需时区转换；
3. 删掉冗余的 `(expires_at, event_id)` 索引可减少每条实时事件写入时的 B-tree 索引维护与 WAL 开销。

## 4. 索引契约守卫一致性处理

- `database/migrations/012_p2_003_realtime_event_log.sql` 内含 `$p2_003_index_contract$` `DO` 块（校验 5 个索引包含 `conversation_realtime_event_expiry_event_idx`），该文件已被 `validate-arch-005-time-contract.mjs` 以 SHA-256 冻结且不能修改。
- 同时，`app/server/scripts/p2-003-migrate.mjs` 在 `022` 已应用后会通过 `stopLegacyMigrationAfterArch005` 停止执行 `012`，因此不会在已迁移库上重新触发 `012` 的索引数量断言；`tests/p2-003-realtime-event-log.integration.test.mjs` 是在 `001`–`012`（不含 `022`/`077`）的独立孤立库上验证 `012` 自身契约。
- 为保持 `077` 之后的契约同样严格、不可漂移，[077_retention_and_time_contract.sql](../../../../database/migrations/077_retention_and_time_contract.sql) 新增了 `$card42c_realtime_expiry_index_contract$` `DO` 块与 `retentionTimeContractSchemaReady` 校验：显式断言 `conversation_realtime_event_expiry_event_idx` **不存在**，且 `conversation_realtime_expiry_epoch_idx` **存在且为有效、非部分、非表达式的 `(expires_epoch_ms, event_id)` B-tree 索引**。
