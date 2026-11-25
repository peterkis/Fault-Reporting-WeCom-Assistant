# Card 42A 看板查询重写与性能优化交付说明

## 范围说明

本目录记录 Card 42A（看板查询重写：参数化时间、`075_ticket_terminal_at` 终态时间列与部分索引、写入原子同步、分支下推与先选键后富化、`jit=off` 角色配置、单次主查询执行与传统 SQL 对拍）的验证证据与审阅执行入口。

> [!NOTE]
> 当前受控构建沙箱内无法连接本地 PostgreSQL（`127.0.0.1:5432` 返回 `EPERM`）且未安装 Chrome，因此本分支已完成全部静态扫描、TypeScript strict 编译、构建产物校验与无库单元测试；以下数据库迁移、SQL 对拍及 PG18 50.4k 压测/执行计划文件为待审阅执行占位，需在本地 PG18 环境按下方命令实际运行并回填。

## 与 42B / 42C 的边界

- **未改动 42B**：未修改 `realtime_projector` advisory lock、事务超时、`FOR SHARE` 或通信 outbox `SKIP LOCKED`。
- **未改动 42C**：未新增 `076_*`、未修改滞留清理规则与 `platform.local_now()` / `platform.physical_epoch_ms()` 定义、未修改 `database/schema_draft.sql`。

## 审阅端（PG18）一键复核命令

请先构建产物并设置回环 PostgreSQL 18 连接串（`PILOT_DATABASE_URL`）：

```bash
npm run migration:typecheck
npm run migration:build && node .build/tools/verify-artifact.mjs

# 1. 无库契约与静态扫描
node --test .build/runtime/tests/card42a-sql-contract.test.mjs

# 2. 075 迁移与全部工单状态写路径集成测试
TS_MIGRATION_TEST_DB_ISOLATED=1 PILOT_DATABASE_URL="postgresql://petervans@127.0.0.1:5432/ticket_card42a" \
  node --test .build/runtime/tests/ticket-terminal-at-migration.integration.test.mjs

# 3. 新旧看板 / 详情 / 关注 / 提醒 / 搜索 SQL 全字段对拍与单次查询执行断言
TS_MIGRATION_TEST_DB_ISOLATED=1 PILOT_DATABASE_URL="postgresql://petervans@127.0.0.1:5432/ticket_card42a" \
  node --test .build/runtime/tests/card42a-board-query-parity.integration.test.mjs

# 4. PG18 50.4k 工单压测并输出 EXPLAIN (ANALYZE, BUFFERS) 至本目录（创建并销毁 ticket_card42a_perf_board_*）
PILOT_DATABASE_URL="postgresql://petervans@127.0.0.1:5432/ticket_card42a" \
  npm run perf:board -- --write-evidence docs/db/evidence/v232-card42

# 5. 应用连接角色 jit=off 检查与设置（按实际环境角色名）
PILOT_DATABASE_URL="postgresql://petervans@127.0.0.1:5432/ticket_card42a" \
  npm run db:role:settings -- --role <app_role> --check
```

## 相关文件索引

- 迁移脚本：[075_ticket_terminal_at.sql](../../../../database/migrations/075_ticket_terminal_at.sql)
- 迁移执行器：[ticket-terminal-at-migrate.mts](../../../../app/server/scripts/ticket-terminal-at-migrate.mts)
- 数据库角色配置：[db-role-settings.mts](../../../../app/server/scripts/db-role-settings.mts)
- 看板主查询：[web01-workbench-query.mts](../../../../app/server/src/web01-workbench-query.mts)
- 搜索查询：[workbench-search.mts](../../../../app/server/src/workbench-search.mts)
- 压测脚本：[perf-board.mts](../../../../app/server/scripts/perf-board.mts)
- 无库静态扫描与参数检查：[card42a-sql-contract.test.mts](../../../../tests/card42a-sql-contract.test.mts)
- 075 与写路径集成测试：[ticket-terminal-at-migration.integration.test.mts](../../../../tests/ticket-terminal-at-migration.integration.test.mts)
- 对拍集成测试：[card42a-board-query-parity.integration.test.mts](../../../../tests/card42a-board-query-parity.integration.test.mts)
