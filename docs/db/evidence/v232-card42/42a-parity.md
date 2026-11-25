# Card 42A 查询对拍（Parity）验证矩阵

状态：**待 PG18 环境执行**（当前构建沙箱无法连接 `127.0.0.1:5432`，已完成 TypeScript strict 编译与 `.build/runtime` 产物生成）。

## 对拍覆盖范围

测试文件：[card42a-board-query-parity.integration.test.mts](../../../../tests/card42a-board-query-parity.integration.test.mts)
传统基准 SQL 夹具：[card42a-legacy-card-sql.mts](../../../../tests/fixtures/card42a-legacy-card-sql.mts)

1. **看板列表 `list()`**：
   - 列：`pending`、`active`、`handled`
   - 时间范围：`recent`、`all`、`custom`（含 `RESOLVED` 不受 `recent/custom` 窗口截断规则）
   - 范围：`team` 与 `related`（含处理人、会话指派、显式关注）
   - 权限角色：`ADMIN`、`HANDLER`（仅授权组）、非授权 `outsider`
   - 分页与游标：小页宽逐页遍历至 `next_cursor = null`，校验 `items`、`group_counts`、`range` 全字段一致，并验证新旧游标双向兼容。
2. **单项详情 `authorizedItem()`**：`ticket`、`review`、`intake`（含已关闭 `intake`）及越权 `404`。
3. **关注与提醒**：`follow.attentionMany()`、`reminders.page()`。
4. **搜索 `search()`**：`all`/`pending`/`active`/`handled`、`recent`/`all`/`custom`、关键词、关单类型、关注范围与多页分页。
5. **单次执行约束**：拦截连接池查询，断言每次 `list()` 仅执行 1 次 `WITH page_keys AS` 主查询且不再触发旧版全量 `WITH cards AS` 或 `decorate()` 内逐卡循环查询。

## 执行命令

```bash
TS_MIGRATION_TEST_DB_ISOLATED=1 PILOT_DATABASE_URL="postgresql://petervans@127.0.0.1:5432/ticket_card42a" \
  node --test .build/runtime/tests/card42a-board-query-parity.integration.test.mjs
```
