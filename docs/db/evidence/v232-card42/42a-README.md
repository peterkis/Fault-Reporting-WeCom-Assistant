# Card 42A · 看板查询重写证据

归档摘要和同目录主语句计划来自同一次人工工作台压测。八个受控场景均通过延迟、读取数和执行计划检查。每次运行的 PostgreSQL 版本、配置、逐项 P95 及判定见同目录摘要，`42a-explain-*.txt` 是该次运行的主语句计划。[已归档运行摘要](42a-perf-board.txt)

## 改了什么

| 卡片条目 | 做法 | 主要位置 |
|---|---|---|
| 42A-1 读取时钟 | 查询构造器接收显式的纪元和上海本地时间。看板选页、单卡读取及等待后的最终 READ 各自在语句内取时，使 Journey 和受理事项的保留期在取数时生效 | `web01-workbench-query.mts`、`workbench-card-projections.mts` |
| 42A-2 终态时间 | 075 将 `terminal_at` 按**整秒**存储，同时维护 `terminal_epoch_ms`、状态与时间 CHECK、同步触发器和三个部分索引（含 `ticket_terminal_idx`）。首次应用拒绝终态列上的默认表达式，并逐张核对终态工单已有或待回填的时间。RESOLVED / COMPLETED 取最近一次对应的状态变更事件，DISMISSED 取有效关闭记录的 `ended_at`。缺少证据或已有值与证据矛盾时回滚 | `075_ticket_terminal_at.sql`、`ticket-terminal-at-migrate.mts` |
| 42A-3 终态写入 | 进入或离开终态时，在推进 `version` 的同一条 UPDATE 中写入或清空时间对。dismiss 取得工单行锁后采样一次上海本地墙钟，关闭记录复用该值，跨日等待按解锁后的日期归档。状态事件沿用事务开始时间 | `p1-006-ticket-state-actions.mts`、`service-closure-records.mts` |
| 42A-4 选页与来源 | Ticket / Review / Intake 分支先按范围、权限和游标选键，再补全当页卡片。待处理 Intake 按唯一来源键查找关联 Ticket，大批已完成 Intake 用 Ticket 来源 ID 集合排除。来源绑定分别用原始 Intake ID、渠道腿的来源 Intake ID 和 Review 主键查 Journey，去重后检查唯一性和保留期，再按主键读取原始 Intake。报修人仍优先取直接来源的已解析资料 | `web01-workbench-query.mts`、`workbench-source-groups.mts`、`workbench-search.mts` |
| 42A-5 翻页游标 | 按 `(order_group, order_at, kind, id)` 比较排序键，搜索最终排序显式使用 `matched.order_at` 和 `matched.id`，与续页条件同用整秒时间戳和 UUID。看板游标编码保持逐字节一致，可在新旧实现间双向续页 | `buildBoardKeysSql`、`workbench-search.mts` |
| 42A-6 投影与复核 | 每页执行一次主选页查询。搜索在同一只读 `REPEATABLE READ` 快照内完成选页和卡片读取，装饰完成后独立复核当前会话、权限、匹配行和其余卡片字段的签名。详情、关注和附件分块下载用窄查询复核当前身份与 READ。开启关注时，详情等待后复核 Review 来源，最后一条语句同时核验 Web 绑定和详情正文。服务证据按页匹配已解决审核，展开后每卡保留至多 101 行以检测溢出。已处理列终检在同一语句内复用当前已完成 Intake 集合，核对总数及含第 n+1 条记录的有序页 | `readSearchCards`、`workbench-search.mts`、`workbench-card-projections.mts` |
| 42A-7 关闭 JIT | `npm run db:role:settings -- --role <应用连接角色> --apply` 为应用连接角色设置 `jit=off`。`--check` 优先读取当前数据库对该角色的覆盖值，`--reset` 可撤销全局角色设置。`--apply` 先核对角色全局值，再核对当前数据库的有效值。若数据库覆盖值使 JIT 仍为 on，`--apply` 输出 `PENDING` 并以状态码 1 退出。设置对新连接生效，应用连接池需要重启 | `db-role-settings.mts` |

## 人工工作台验收配置

压测直接读取人工工作台角色的配置，装配来源群、补充跟进、人工审核、人工报修和个人已读。搜索启用相同的来源群、补充、人工报修与人工审核能力。Follow 和跟进计划沿用角色默认关闭值。夹具使用合成管理员会话，并显式启用搜索。耗时覆盖服务调用到返回的全过程。[人工工作台入口](../../../../app/server/scripts/human-workbench-role.mts) · [压测实现](../../../../app/server/scripts/perf-board.mts)

8 个受控场景各计时 30 次。验收在原 100 ms 上限内要求每项 P95 ≤ 75 ms，并记录整个预热、计时期间每个请求的最高读语句数。压测对 P95 请求中每条读取语句运行原执行计划与 JIT 检查，也检查其他样本在同一位置出现的不同 SQL。任何受控语句检查失败都会使进程退出失败。摘要列出每个场景的最慢语句及其耗时。全年文本搜索继续单列。

## 合并目录读取前的历史基线

| 场景 | 基线运行 A P95 (ms) | 基线运行 B P95 (ms) | 基线读取数 | 当前验收读取上限 |
|---|---:|---:|---:|---:|
| 待处理首页 | 38.76 | 39.18 | 37 | 18 |
| 处理中首页 | 29.75 | 29.16 | 37 | 18 |
| 已处理近期首页 | 52.29 | 51.10 | 37 | 18 |
| 已处理全年首页 | 97.56 | 97.98 | 37 | 18 |
| 已处理全年第 2 页 | 99.95 | 97.53 | 37 | 18 |
| 单卡 | 16.15 | 17.36 | 32 | 13 |
| 已处理近期搜索 | 97.98 | 76.05 | 71 | 33 |
| 近期文本搜索 | 92.38 | 93.39 | 71 | 33 |

计数口径为同一 `annual-board` 夹具上一份请求的应用读取语句，事务控制另计。基线的一次补充跟进准备态检查用了 26 条语句。合并目录读取后，在每个原检查点以 7 条语句核对相同迁移记录、回执结构及补充跟进结构。看板页和单卡各检查一次，搜索检查两次。

## 精简配置的历史实测

精简配置当时的 PG18 回归覆盖 169 个文件，142 个通过，27 个失败均由编排方在干净 main `5bc972fb` 上复现。

| 证据 | 文件 | 结果 |
|---|---|---|
| 075 迁移执行日志 | [42a-migration-075.log](42a-migration-075.log) | 已有记录覆盖 check / rollback / apply / 重复 apply，四张样例工单在重新回填后与原写入值一致 |
| 075 与写路径 | [ticket-terminal-at-migration.integration.test.mts](../../../../tests/ticket-terminal-at-migration.integration.test.mts) | 2/2 通过，覆盖默认值与历史证据漂移、回填与回滚、状态写入、持锁等待后的关闭时间，以及恢复后清空终态时间对 |
| 新旧对拍 | [42a-parity.md](42a-parity.md) | 1/1 通过，覆盖看板、单卡、关注、提醒、搜索及游标兼容 |
| T35 切换账号 | [t35-account-switch.browser.test.mts](../../../../tests/t35-account-switch.browser.test.mts) | 两次复跑均通过（2/2）。原账号的写入收到 403，两位阅读者的位置均保持为 0 |
| 静态扫描与参数 | [card42a-sql-contract.test.mts](../../../../tests/card42a-sql-contract.test.mts) | 6/6 通过 |


本次通过共享容量夹具的 `annual-board` 配置生成带「（合成）」标记的数据。计时前核验了 56,000 个 Intake，各有一个 Journey、一条来源渠道腿和一份已解析的报修人资料。库中有 50,400 张工单、302,235 条工单事件和 3,356 条关闭记录。11,200 项人工审核中有 22 项待审，10,068 项已解决并关联工单。每个场景预热 3 次、计时 30 次，计时连接实测 `jit=off`。下表对应当时的精简配置。看板省略了来源群和补充跟进装饰，搜索的六个可选读取能力全部关闭。[容量夹具](../../../../tests/helpers/capacity-dataset.mts)

| 场景 | P50 (ms) | P95 (ms) |
|---|---:|---:|
| 待处理列首页 | 21.55 | 22.44 |
| 处理中列首页 | 12.13 | 12.55 |
| 已处理列首页（`recent`） | 34.61 | 35.95 |
| 已处理列首页（全年） | 77.04 | 80.61 |
| 已处理列第 2 页（全年） | 77.56 | 79.40 |
| 单卡 `item()` | 0.90 | 1.09 |
| 搜索（已处理，`recent`） | 41.81 | 43.51 |
| 文本搜索（`recent`） | 58.41 | 63.51 |
| 文本搜索（全年，仅记录） | 491.60 | 597.58 |

8 个验收场景的主计划均通过原计划检查。每个 Ticket 全表扫描节点最多执行 1 次，每个 Ticket 节点执行少于 1,000 次，每个计划节点执行少于 50,000 次，生成的 JIT 函数为 0 个。待处理页对 50 个候选 Intake 使用 `ticket_source_intake_id_key` 做 50 次索引查找。全年已处理页一次扫描 50,400 张 Ticket 构建来源集合，排除已有工单的 Intake。当前归档的逐语句测量见[性能摘要](42a-perf-board.txt)。

## 已知限制

负责人确认，文本搜索的 100 ms 验收门槛适用于默认 `recent` 范围，精简配置当时的 P95 为 **63.51 ms**。该精简配置的全年子串搜索（`column=all&range=all&q=…`）P95 为 **597.58 ms**，合并目录读取前的完整配置第一次为 **548.99 ms**。两轮计划中的 `Aggregate` 执行了 56,000 次。该场景的延迟和高循环提示单列记录。按已确认的范围，42A 沿用现有索引，trigram / FTS 索引不在本次范围内。[全年文本搜索计划](42a-explain-search-text-all.txt)

**CI 与生产的已知差异。** CI 测试库沿用 PostgreSQL 默认的 `jit=on`，夹具不执行 `db-role-settings`。生产应用连接角色配置为 `jit=off`，`perf:board` 单独在自建压测库设置 `jit=off`。第 29 轮在分支和主线重放会话主题分页，最高计划成本均为 219.12，远低于 `jit_above_cost=100000`。该配置差异可接受的结论限于这组分页计划。

**主线已有缺陷（不在 42A 修复）。** 以下两个缺陷在 `5bc972fb`、main `89121df1` 和 42A 上行为一致，由单独的 `cursor-scope-fix` PR 修复：

- 关联会话游标的 `readable_scope` 是读者全部可读会话 ID 的哈希，之后才按联系人筛选。后台投影器每 1,000 ms 为其他联系人补建会话，可读集合一变，同一联系人的历史页游标就返回 `400 WORKBENCH_CURSOR_INVALID`。PG18 重放中，游标在约 0.59 秒时有效，约 1.13 秒时失效；`8db4ea57` 与 `e15305fb` 都在约 1.14 秒首次出现。CI 较慢，`conversation-inbox.browser` 第 6 例因此失败。
- 前端收到游标无效的 400 后清空本地游标，再次点击会重新进入历史页，而不是回到首页，私聊入口不再出现。

## 范围边界

- 没有新增 `076_*`；没有改动保留期清理、`realtime_event` 过期索引、`platform.local_now()` 的定义（以上属于 42C）。
- 没有改动 advisory lock、超时、`FOR SHARE`、outbox（以上属于 42B）。

## 复跑

```bash
npm run migration:typecheck && npm run migration:build
node --test .build/runtime/tests/card42a-sql-contract.test.mjs
TS_MIGRATION_TEST_DB_ISOLATED=1 PILOT_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/<own-db> \
  node --test .build/runtime/tests/ticket-terminal-at-migration.integration.test.mjs
TS_MIGRATION_TEST_DB_ISOLATED=1 PILOT_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/<own-db> \
  node --test .build/runtime/tests/card42a-board-query-parity.integration.test.mjs
# 自建并删除 ticket_card42a_perf_board_* 库；写证据时要求 PG18 且至少 30 次计时
PILOT_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/<own-db> npm run perf:board -- --diag-dir=tmp/perfdiag-board --write-evidence docs/db/evidence/v232-card42
# 发布后核对摘要与九份计划的 run_id；此检查可离线运行
node .build/runtime/app/server/scripts/perf-board.mjs --check-evidence docs/db/evidence/v232-card42
```

每个运行使用独立的证据目录，重试时复用原目录。新发布的文件首行带有同一个 `run_id`，摘要最后替换。替换中断时，检查会报告 `PERF_BOARD_EVIDENCE_MIXED_GENERATION`；首次发布尚缺文件时报告 `PERF_BOARD_INCOMPLETE_EVIDENCE`。重新完成一次压测即可补齐。历史归档没有运行编号，检查会报告 `PERF_BOARD_EVIDENCE_RUN_ID_MISSING`。
