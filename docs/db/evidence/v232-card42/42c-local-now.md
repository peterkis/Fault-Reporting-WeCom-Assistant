# Card 42C-3 `platform.local_now()` 内联安全性评估与契约变更

## 1. 现状与问题

[022_arch_005_asia_shanghai_time_contract.sql](../../../../database/migrations/022_arch_005_asia_shanghai_time_contract.sql) 定义了：

```sql
CREATE OR REPLACE FUNCTION platform.local_now()
RETURNS timestamp without time zone
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_local_now$
    SELECT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')::timestamp without time zone
$arch005_local_now$;
```

PostgreSQL 优化器（`inline_function()`）规定：**只要函数带有任何 `SET` 配置参数（`pg_proc.proconfig IS NOT NULL`），即使函数体只有一条简单的 `SELECT` 且标为 `LANGUAGE sql STABLE`，也无法被内联展开**。在查询条件、投影或边界比较中调用 `platform.local_now()` 时，只能走函数调用开销，无法参与常量折叠或索引下推。

## 2. 改为可内联实现的安全性论证

[077_retention_and_time_contract.sql](../../../../database/migrations/077_retention_and_time_contract.sql) 将其替换为：

```sql
CREATE OR REPLACE FUNCTION platform.local_now()
RETURNS timestamp without time zone
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $card42c_local_now$
    SELECT pg_catalog.date_trunc('second', pg_catalog.timezone('Asia/Shanghai', pg_catalog.transaction_timestamp()))::timestamp without time zone
$card42c_local_now$;
```

结论：**安全，且与原定义在返回类型、事务稳定性和数值语义上 100% 等价**：

1. **权限安全（`SECURITY INVOKER`）**：函数保持 `SECURITY INVOKER`（`prosecdef = false`），不提升调用方权限，不存在特权提升面。
2. **完全消除 `search_path` 劫持风险**：
   - 函数体内不引用任何自定义 Schema（连 `platform` 自身也不引用）；
   - 每个函数调用都显式限定为 `pg_catalog`：`pg_catalog.transaction_timestamp()`、`pg_catalog.timezone('Asia/Shanghai', ...)`、`pg_catalog.date_trunc('second', ...)`；
   - `::timestamp without time zone` 是 SQL 标准内建类型语法，由语法解析器直接解析为 `pg_catalog.timestamp`，不经过 `search_path` 查找。
   - 即使调用会话执行 `SET search_path = ''` 或在 `search_path` 首位放置恶意同名的 `date_trunc` / `timezone` / `transaction_timestamp` 函数，也不会改变任何解析路径（`tests/retention-and-time-contract-migration.integration.test.mts` 已包含 `SET LOCAL search_path = ''` 实测断言）。
3. **语义等价性**：PostgreSQL 语法解析器原本就将 `ts AT TIME ZONE 'Asia/Shanghai'` 翻译为 `pg_catalog.timezone('Asia/Shanghai', ts)`；返回类型仍为 `timestamp without time zone`，易变性仍为 `STABLE`（`provolatile = 's'`），事务内多次调用返回同一秒精度北京时间。
4. **内联条件满足**：去掉 `SET search_path` 后 `pg_proc.proconfig IS NULL`、`lanname = 'sql'`、`provolatile = 's'`、非 `STRICT`（`NOT proisstrict`）、非集合返回（`NOT proretset`）、单条无 `FROM` 的纯表达式 `SELECT`，满足 PostgreSQL SQL 函数内联条件。
5. **`platform.physical_epoch_ms()` 不改动**：`platform.physical_epoch_ms()` 调用 `clock_timestamp()`，语义必须为 `VOLATILE`（每次调用推进物理毫秒，用于租约、重试、超时与耗时）；保持不变，并由 42A-1 的扫描断言禁止其直接出现在看板查询投影 SQL 中。

## 3. 漂移守卫与兼容检查核对

| 检查点 | 文件 | 处理方式 |
| --- | --- | --- |
| 冻结迁移完整性 | `database/migrations/022_arch_005_asia_shanghai_time_contract.sql` | 保留原文件不改（遵守历史迁移不可变原则） |
| ARCH-005 静态验证 | `app/server/scripts/validate-arch-005-time-contract.mjs` | 当前检出工作区中，该脚本在 `010`、`011`、`012`、`020`、`021` 上报告已核实的预存 LF/CRLF 字节摘要差异（工作文件字节与基线 `5bc972fb` 完全一致，将其 LF 转 CRLF 后匹配登记摘要；其余全部硬检查包括 `direct_pg_factory_bypass_count` 均为 0） |
| 077 迁移守卫 | `database/migrations/077_retention_and_time_contract.sql` | `$card42c_local_now_contract$` `DO` 块强校验 `lanname = 'sql'`、`provolatile = 's'`、`NOT prosecdef`、`NOT proisstrict`、`NOT proretset`、`proconfig IS NULL`、`prorettype = 'timestamp without time zone'::regtype`、**精确归一化函数体（含 `'Asia/Shanghai'` 与 `'second'`）**，以及 `physical_epoch_ms()` 保持 `VOLATILE` / `bigint` / `NOT proretset` |
| 077 迁移器与运行就绪检查 | `app/server/scripts/retention-and-time-contract-migrate.mts`、`app/server/scripts/human-workbench-role.mts`、`app/server/src/p2-016-runtime.mts` | `retentionTimeContractSchemaReady` 在每次迁移 check/noop 与运行时角色启动 / `/health/ready` 时均复用上述精确归一化函数体、时区、精度与 `physical_epoch_ms()` `VOLATILE` 校验 |
| 077 集成与漂移测试 | `tests/retention-and-time-contract-migration.integration.test.mts` | 验证 `proconfig IS NULL`、`SET LOCAL search_path = ''` 下结果一致、篡改 `'UTC'` 或 `'day'` 精度触发 `RETENTION_TIME_CONTRACT_SCHEMA_DRIFT` 拒绝，以及 PG18 `EXPLAIN (VERBOSE)` 内联展开 |

## 4. PG18 查询计划实测

PG18.6 上回滚 077 后，`EXPLAIN (VERBOSE) SELECT platform.local_now()` 的 `Output` 为 `platform.local_now()`。重新应用 077 后，`Output` 展开为 `date_trunc('second'::text, timezone('Asia/Shanghai'::text, transaction_timestamp()))`，可直接看到上海时区转换和秒精度截断。[PG18 回滚与重新应用的执行记录](42c-pg18-execution.md)
