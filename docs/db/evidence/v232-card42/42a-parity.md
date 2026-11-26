# Card 42A · 新旧 SQL 对拍结果

## 结论

dev8 后，编排方在 PostgreSQL 18.6 上用同一份合成数据（「（合成）」）运行旧实现（main `5bc972fb`）与新实现。看板、单卡、关注、提醒和搜索的对拍通过（1/1）。各项比较字段及游标规则见下表。

## 旧实现从哪里来

旧实现不是手写的“近似 SQL”，而是 `5bc972fb` 上这 10 个模块的原样拷贝：[tests/fixtures/card42a-legacy/](../../../../tests/fixtures/card42a-legacy/)。拷贝只改写了相对 import 路径，使其能在当前仓库里解析；每个文件头部都有说明。这些模块在 `5bc972fb` 与当前合并基线 main `1dfcdb08` 之间没有改动（`git diff 5bc972fb 1dfcdb08` 为空），因此拷贝仍等同于 main 的现行实现。被拷贝的模块：

- `web01-workbench-query`、`workbench-card-projections`、`workbench-search`、`workbench-follow`、`workbench-reminders`
- `workbench-source-groups`、`workbench-supplement-follow-up`、`workbench-actor-avatars`、`workbench-attachments`、`workbench-web-report`

旧卡片投影从 `service-closure-records` 引用关闭原因词表，旧单卡查询从 `ticket-reporter-profiles` 引用报修人资料读取函数。关闭记录的写入路径由 075 与写路径测试另行覆盖。

## 对拍范围

测试文件：[card42a-board-query-parity.integration.test.mts](../../../../tests/card42a-board-query-parity.integration.test.mts)。

| 项 | 内容 | 比较方式 |
|---|---|---|
| 看板列表 | 待处理 / 处理中 / 已处理；`recent` / `all` / `custom`；`team` / `related`；管理员、处理人、外部人员；每页 3 条翻到底 | 每页 `items`、`group_counts`、`range` 逐字段相等，`next_cursor` 编码逐字节相等。所有页拼接后再比较卡片列表 |
| 游标兼容 | 旧游标交给新实现、新游标交给旧实现 | 下一页 `items` 相等 |
| 单卡 | 已重开工单、已关闭工单、待复核、已完成受理事项；外部人员 404 | `deepEqual` |
| 关注 | `attentionMany` | `deepEqual` |
| 提醒 | 管理员关注的工单在两个基线之前处理完成，基线之后重开，由运行时自己的实时投影器发布事件 | 增量页必须包含 `RELATED_REOPEN`；`items`、原因、顺序、身份逐字段相等；基线令牌比较除 `f`（请求瞬间）和 `e`（墙钟过期时间）以外的字段 |
| 搜索 | 7 组条件（含文本、已处理、仅关闭、关注、自定义日期），每页 4 条翻到底 | `items`、`range` 相等；游标比较位置字段（窗口、`at`、`order_group`、`kind`、`id`、条件摘要）。`binding` 和签名使用每个实例自己的 HMAC 密钥，跨实例不可能相同 |
| 单次执行 | 新 `list()` 每页恰好执行 1 条含 `page_keys` CTE 的主查询，且不再执行旧的全量 `WITH cards AS` | 记录实际发出的 SQL |

## 运行方式

```bash
npm run migration:build
TS_MIGRATION_TEST_DB_ISOLATED=1 PILOT_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/<own-db> \
  node --test .build/runtime/tests/card42a-board-query-parity.integration.test.mjs
```

测试通过现有夹具自建隔离库，结束后自动删除。
