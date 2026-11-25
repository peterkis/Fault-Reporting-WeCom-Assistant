# 42C PG18 执行记录（076 / 077 / 清理器 / EXPLAIN）

- 采集时间：2026-11-25（UTC 08:45）
- 数据库：`PostgreSQL 18.6 (Homebrew) on aarch64-apple-darwin25.6.0, compiled by Apple clang version 21.0.0 (clang-2100.3.34.2), 64-bit`
- 运行时：Node v24.18.0，macOS（Apple Silicon）
- 库：专用隔离库 `ticket_card42c_ev`，由仓库测试助手 `applyFullSchemaThrough074` 从空库迁到 074（不含 42A 的 075），然后用构建产物 CLI 执行 076 / 077。库内无业务数据；保留扫描计划取自 PG18 集成测试中的（合成）2 万行工作负载。共享库 `postgres` 未被迁移或改写。
- 迁移文件 SHA-256：076 `2d41f08b119a7e47c186194ae6fe4a2eff792dc4ca699f39792be97ad81b498a`；077 `5ea82cbb3ed0f85a5afb4337c2745d91de5a652223a21c24c22d4559c421243a`

## 1. 外键审计（实时 `pg_constraint` / `pg_index`）

| 阶段 | FK 总数 | 已有支撑索引 | 缺失 | 其中仅部分索引 | 补 | 不补 | 076 索引 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-076 | 208 | 104 | 104 | 11 | 75 | 29 | 74（拟建） |
| post-076 | 208 | 179 | 29 | 0 | 0 | 29 | 74（已建） |

逐条清单：[42c-fk-index-list.md](42c-fk-index-list.md)（pre-076，含补/不补理由）；应用后残余：[42c-fk-index-list-post-076.md](42c-fk-index-list-post-076.md)（29 条均为「不补」）。

## 2. 076 执行日志

```text
$ node app/server/scripts/fk-indexes-migrate.mjs --check
{"status":"PENDING","migration_id":"076_fk_indexes"}
$ node app/server/scripts/fk-indexes-migrate.mjs --apply
{"status":"APPLIED","migration_id":"076_fk_indexes"}
$ node app/server/scripts/fk-indexes-migrate.mjs --check
{"status":"NOOP_ALREADY_APPLIED","migration_id":"076_fk_indexes"}
$ psql -Atc "select count(*) from pg_indexes where indexname like '%_fk_idx'"
74
```

回滚与重放：

```text
$ node app/server/scripts/fk-indexes-migrate.mjs --rollback
{"status":"ROLLED_BACK","migration_id":"076_fk_indexes"}
$ node app/server/scripts/fk-indexes-migrate.mjs --check
{"status":"PENDING","migration_id":"076_fk_indexes"}
$ node app/server/scripts/fk-indexes-migrate.mjs --apply
{"status":"APPLIED","migration_id":"076_fk_indexes"}
$ node app/server/scripts/fk-indexes-migrate.mjs --check
{"status":"NOOP_ALREADY_APPLIED","migration_id":"076_fk_indexes"}
```

## 3. 077 执行日志（含回滚与重放）

```text
$ node app/server/scripts/retention-and-time-contract-migrate.mjs --check
{"status":"PENDING","migration_id":"077_retention_and_time_contract"}
$ node app/server/scripts/retention-and-time-contract-migrate.mjs --apply
{"status":"APPLIED","migration_id":"077_retention_and_time_contract"}
$ node app/server/scripts/retention-and-time-contract-migrate.mjs --check
{"status":"NOOP_ALREADY_APPLIED","migration_id":"077_retention_and_time_contract"}
$ node app/server/scripts/retention-and-time-contract-migrate.mjs --rollback
{"status":"ROLLED_BACK","migration_id":"077_retention_and_time_contract"}
-- pre-077 (022 definition, SET search_path): EXPLAIN (VERBOSE)
           QUERY PLAN           
--------------------------------
 Result
   Output: platform.local_now()
(2 rows)

              proconfig               
--------------------------------------
 {"search_path=pg_catalog, platform"}
(1 row)

$ node app/server/scripts/retention-and-time-contract-migrate.mjs --apply
{"status":"APPLIED","migration_id":"077_retention_and_time_contract"}
```

## 4. `platform.local_now()` 内联（077 之后）

077 前（022 定义带 `SET search_path`）计划输出为 `platform.local_now()` 函数调用（见第 3 节回滚后的输出）；077 后规划器直接展开为内建表达式：

```text
-- local_now() / physical_epoch_ms() after 077
      proname      | provolatile | prosecdef |              proconfig               |   pg_get_function_result    
-------------------+-------------+-----------+--------------------------------------+-----------------------------
 local_now         | s           | f         |                                      | timestamp without time zone
 physical_epoch_ms | v           | f         | {"search_path=pg_catalog, platform"} | bigint
(2 rows)

-- EXPLAIN (VERBOSE): local_now() inlined
                                           QUERY PLAN                                           
------------------------------------------------------------------------------------------------
 Result
   Output: date_trunc('second'::text, timezone('Asia/Shanghai'::text, transaction_timestamp()))
(2 rows)

                                                                   QUERY PLAN                                                                    
-------------------------------------------------------------------------------------------------------------------------------------------------
 Aggregate  (cost=12.51..12.52 rows=1 width=8) (actual time=0.096..0.096 rows=1.00 loops=1)
   Output: count(*)
   ->  Result  (cost=0.01..10.01 rows=1000 width=0) (actual time=0.030..0.076 rows=1000.00 loops=1)
         One-Time Filter: (date_trunc('second'::text, timezone('Asia/Shanghai'::text, transaction_timestamp())) IS NOT NULL)
         ->  Function Scan on pg_catalog.generate_series g  (cost=0.01..10.01 rows=1000 width=0) (actual time=0.021..0.037 rows=1000.00 loops=1)
               Output: g
               Function Call: generate_series(1, 1000)
 Planning:
   Buffers: shared hit=3
 Planning Time: 0.014 ms
 Execution Time: 0.103 ms
(11 rows)

-- realtime_event indexes after 077
                         indexname                         |                                                                                    indexdef                                                                                    
-----------------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 conversation_realtime_event_authorization_scope_event_idx | CREATE INDEX conversation_realtime_event_authorization_scope_event_idx ON conversation.realtime_event USING btree (authorization_scope_type, authorization_scope_id, event_id)
 conversation_realtime_event_event_key_unique              | CREATE UNIQUE INDEX conversation_realtime_event_event_key_unique ON conversation.realtime_event USING btree (event_key)
 conversation_realtime_event_pkey                          | CREATE UNIQUE INDEX conversation_realtime_event_pkey ON conversation.realtime_event USING btree (event_id)
 conversation_realtime_event_visibility_event_idx          | CREATE INDEX conversation_realtime_event_visibility_event_idx ON conversation.realtime_event USING btree (visibility_scope, event_id)
 conversation_realtime_expiry_epoch_idx                    | CREATE INDEX conversation_realtime_expiry_epoch_idx ON conversation.realtime_event USING btree (expires_epoch_ms, event_id)
(5 rows)
```

`physical_epoch_ms()` 仍为 VOLATILE（`provolatile = v`），未改动。

## 5. 留存索引扫描计划（`EXPLAIN (ANALYZE, BUFFERS)`，（合成）数据）

取自 `tests/retention-and-time-contract-migration.integration.test.mts` 在 PG18 上的输出：首批与续批都走 `(retention_until_epoch_ms, id)` 索引，无排序节点。

```text
（合成）077 retention first page PG18 plan
Limit  (cost=0.29..4.42 rows=32 width=88) (actual time=0.008..0.013 rows=32.00 loops=1)
  Buffers: shared hit=3
  ->  Index Only Scan using operations_backup_retention_epoch_id_idx on backup_checkpoint r  (cost=0.29..1549.65 rows=12005 width=88) (actual time=0.007..0.011 rows=32.00 loops=1)
        Index Cond: (retention_until_epoch_ms <= '12000000'::bigint)
        Heap Fetches: 32
        Index Searches: 1
        Buffers: shared hit=3
Planning:
  Buffers: shared hit=168
Planning Time: 0.283 ms
Execution Time: 0.018 ms
（合成）077 retention continuation PG18 plan
Limit  (cost=0.29..5.96 rows=32 width=88) (actual time=0.005..0.009 rows=32.00 loops=1)
  Buffers: shared hit=3
  ->  Index Only Scan using operations_backup_retention_epoch_id_idx on backup_checkpoint r  (cost=0.29..1276.58 rows=7201 width=88) (actual time=0.005..0.008 rows=32.00 loops=1)
        Index Cond: ((retention_until_epoch_ms <= '12000000'::bigint) AND (ROW(retention_until_epoch_ms, id) > ROW('8000000'::bigint, '00000000-0000-7000-8000-000000000002'::uuid)))
        Heap Fetches: 32
        Index Searches: 1
        Buffers: shared hit=3
Planning:
  Buffers: shared hit=9
Planning Time: 0.024 ms
Execution Time: 0.015 ms
```

## 6. 清理器（ADR-0060：全部保留，不删除、不匿名化）

```text
$ node app/server/scripts/retention-cleanup-check.mjs --check
{"ok":true,"task":"42C-2","mode":"DRY_RUN","policy_id":"ADR_0060_UNDECIDED","now_epoch_ms":"1795596333722","batch_size":1000,"max_batches_per_table":10,"total_candidates":0,"write_performed":false,"tables":[{"table":"intake.web_report_urge","index_name":"web_report_urge_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"intake.web_report_evaluation","index_name":"web_report_evaluation_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"intake.web_request_binding","index_name":"web_request_binding_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"intake.web_submission","index_name":"web_submission_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"intake.contact_journey","index_name":"contact_journey_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"intake.service_intake","index_name":"service_intake_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"channel.message_inbox","index_name":"channel_message_inbox_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"conversation.item","index_name":"conversation_item_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"communication.message","index_name":"communication_message_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"incident.incident","index_name":"incident_retention_epoch_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false},{"table":"operations.backup_checkpoint","index_name":"operations_backup_retention_epoch_id_idx","batches_scanned":1,"candidate_count":0,"exhausted":true,"sample_first_key":null,"sample_last_key":null,"write_performed":false}]}
$ node app/server/scripts/retention-cleanup-check.mjs --apply
{"ok":false,"task":"42C-2","error":{"code":"RETENTION_CLEANUP_POLICY_UNDECIDED","retryable":false}}
exit=1
```

`--check` 只读计数（`write_performed=false`）；`--apply` 固定拒绝且不打开连接池。清理器未注册到任何调度器。
