# 看板 N+1 查询修复记录

日期：2026-10-26。状态：**PASS_DEPLOYED / OWNED_TEST_RESOURCES_CLOSED**。本记录接续[界面修补](ui-refinement-2026-10-26.md)中的性能问题；其中 664→321 次 SQL 和约 4.5–5→1.9 秒是中间结果，不代表 N+1 已修复。原记录及失败原件保留。

执行对象为 `codex/pc-admin-electron-mvp`，基线 HEAD `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加当前工作区差异。保留既有用户及本轮之前的未提交内容；本次不提交、推送、创建或关闭 GitHub Issue，不改变既有 Gate。

## 根因与修复

旧 `attentionMany()` 在应用层逐项 `await authorize()`；每张卡片重复读取 principal、完整卡片、源受理和关注锚点，外层还逐项查询处理／沟通关系。先前只移出重复结构检查，仍留下 `21 + 6 × 卡片数` 次数据库调用。

本轮首先在真实 PG18、正式编译 Runtime 和真实回环 HTTP 上重现，再修改实现：

| 返回卡片数 | 修复前 SQL 次数 | 同轮基线 HTTP 耗时 |
| --- | ---: | ---: |
| 1 | 27 | 88.01 ms |
| 10 | 81 | 232.30 ms |
| 50 | 321 | 900.97 ms |

该基线已经过夹具准备与初始读取，不能称为磁盘冷读。它与此前 1,940 ms 是不同轮次，分别保留，不拼成同一次测量。原件：`.local/electron/nplus1/baseline.json`、`baseline-red.log`；原查询次数断言真实失败。

改动包括：

- [关注投影](../../app/server/src/workbench-follow.mts)：整页一次重新解析当前 principal，集合查询同时核验规范卡片 READ、本人处理／沟通关系和关注锚点。复用页面的 kind/id/intake_id，不逐卡回读来源 ID。锚点按原顺序去重，保留 false tombstone、row_version、100 个锚点上限及原 hash 输入。混合 Review 页仅额外检查一次可选 WEB 存储是否存在，保留材料保留期、人工来源开关和转换冲突边界。
- [看板装饰](../../app/server/src/web01-workbench-query.mts)：列表的关注投影放在所有异步装饰之后。关注关闭时，也按整页重新解析当前权限并核验 READ；等待期间失权则整页拒绝，不能返回已读出的旧卡片。权限过滤及规范去重仍在分页前。
- [人工代录资料](../../app/server/src/workbench-manual-report-source.mts)：整页一个 `ANY(uuid[])` 查询，沿用同一来源快照校验及姓名／部门投影。
- [补充材料提示](../../app/server/src/workbench-supplement-follow-up.mts)：整页一个获权 Ticket 集合查询，复用原材料范围和已送达／已处置证明谓词；结构检查和 principal 读取按请求执行，不随卡片数增加。

关注 POST、取消所有来源锚点、CAS、receipt lock 后的再授权和原 UUID 重放继续使用原写入路径。本轮无数据库迁移、默认开关、超时或权限缓存变更。

## 测量口径

原 321 次复现场景启用 Follow 和跟进安排；正式 `HUMAN_WORKBENCH_OPTIONS` 入口启用人工代录、来源群和补充材料提示，Follow 默认关闭。因此分别验证两种读投影组合，不将前者的查询次数直接称为线上入口次数。

最终测量运行独立 Node 24 进程，每个页面大小先记录首次看板请求，再记录 10 次重复请求。数据库／操作系统缓存未清空，首次请求在隔离建库及材料准备之后；“首次”不表示磁盘冷读。SQL 次数与驱动累计等待来自实际请求；`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 在计时请求之后单独执行，规划／执行总量按该请求实际语句次数加权，不能与 HTTP 或驱动计时混称。

最终候选测量如下。每行11次HTTP（首次1次＋热请求10次），共66次；两组的查询次数在不同页大小及冷热请求中均固定。

| 读投影组合 | 卡片数 | SQL 次数 | 首次 HTTP | 热 HTTP 中位数 | 热 HTTP P95／最大值 | 单独 EXPLAIN 规划合计 | 单独 EXPLAIN 执行合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 原 Follow＋跟进安排复现场景 | 1 | 22 | 252.83 ms | 91.56 ms | 109.93 ms | 23.93 ms | 27.19 ms |
| 同上 | 10 | 22 | 298.87 ms | 92.85 ms | 132.48 ms | 29.64 ms | 31.41 ms |
| 同上 | 50 | 22 | 366.87 ms | 136.79 ms | 166.18 ms | 28.02 ms | 31.71 ms |
| 人工代录＋来源群＋补充材料，Follow 关闭 | 1 | 23 | 100.77 ms | 49.40 ms | 56.75 ms | 11.95 ms | 14.40 ms |
| 同上 | 10 | 23 | 112.18 ms | 58.30 ms | 64.80 ms | 13.76 ms | 19.94 ms |
| 同上 | 50 | 23 | 148.65 ms | 77.24 ms | 93.79 ms | 16.08 ms | 39.36 ms |

50卡片的批量关注SQL单次规划7.257 ms、执行3.188 ms；批量补充材料SQL单次规划4.167 ms、执行17.867 ms。对应HTTP热请求的数据库驱动累计耗时中位数分别为107.75 ms／67.36 ms；驱动计时包含规划、往返、排队和解析，不能称为纯SQL执行时间。10次样本按nearest-rank计算P95，数值等于本组最大值。

原件：`.local/electron/nplus1/benchmark-{follow,manual}-{1,10,50}.json`、`benchmark-summary.json`，包含每次HTTP、SQL分组、真实参数和完整执行计划，参数仅来自本次隔离合成数据。`benchmark-{1,10,50}.json` 是中间候选的较早测量，保留但不替代上表最终结果。

受控本机热请求检查上限为500 ms，两组均通过，跨页大小SQL次数差为0。这不是生产容量或网络SLA。人工组合覆盖正式入口相关投影，但未启动真实OAuth或H5 Runtime，不能把23次直接等同于线上含认证、H5催促投影的请求总次数。

## 检查与保留的失败

第一轮构建曾因新数组缺少显式类型失败，已补充真实返回类型，没有类型逃逸。第一次定向回归中的两项失败保留在 `D:/CodexEvidence/workbench-nplus1-20261026-1793016522814/`：

1. 新人工代录组合夹具同时开启旧准备选项，重复执行 P2-012 迁移而触发 `P2_012_SCHEMA_DRIFT`。改为复用一次正确前置，再启动组合 Runtime；原迁移检查不变。
2. T40 撤权用例已经移除目标卡片，但用全页“通用标题是否消失”判断目标；多个合成 Ticket 共用该标题，较快的看板读取使这一断言失效。改为验证目标唯一 Ticket 编号消失，保留真实撤权、卡片清除、零自动 POST、原请求重试和不自动打开详情的检查。

最终定向集合包含看板合同／HTTP／浏览器、H5 投影、关注／取消／重放／结构漂移、人工资料及失权、补充材料处置、跟进安排和提醒定位。新增真实 HTTP 的 1／10／50 页大小检查，以及初始页面或人工资料等待之后撤权的整页拒绝检查。

当前同候选 **15 个注册入口、58／58 项 PASS，0 FAIL／CANCELLED／SKIP／TODO**。原件：`D:/CodexEvidence/workbench-nplus1-20261026-1793017574304/01/summary.json`；完整路径清单在 `.local/electron/nplus1/regression-plan.json`。这不是活动全集、full 或 certify。

人工代录＋来源群＋补充材料组合在 Follow 关闭时，1／10／50 卡片均为 23 次 SQL；再开启 Follow 时均为 37 次。每页人工快照只读一次，两种组合在人工资料读取后撤销 principal 都返回403且无旧卡片。另一项整页测试在分页查询后撤销团队 READ，返回404且无旧卡片。

候选 manifest SHA-256：`8bc423a3928b9aa4678c5051f2eafcd4aa1853bc80e88891d53697ffda610ddd`；输入 SHA-256：`16eeeaf07d8ab4a9f8880314312d985d5896c382c0829a445ed35fab42ef4dfb`。880 typed、351 retained legacy、2648 outputs，严格类型、负向类型及制品校验PASS；文档工具19／19 PASS。源代码与被测对象一致；文档追加不改变运行输出。

## 发布及资源

沿本聊天对 `cd3120.mobimedical.cn` 的具名PC配套部署授权，2026-10-26 20:38（Asia/Shanghai）已发布上述同一候选：

- 新实例：`human-workbench-20261026-pc-board-01`；发布目录 `/opt/fault-reporting-wecom/p2-g2/pc-board-20261026-01/runtime`。
- 上一实例 `human-workbench-20261026-pc-ui-01` 停止并保留，未删除旧运行树或历史回退版本。
- 服务器无网络、无实际业务配置的隔离组件检查28／28 PASS；切换后及独立复查均29／29 ready、0 restart、无OOM。
- 桌面入口302到企业微信登录、匿名API401、H5入口及上一代资源200。配置42文件、媒体8文件哈希不变；10受理、10Ticket、20媒体记录及通信／通知计数保持；26个迁移记录与校验和不变。未新增真实试单、测试发送或迁移。
- 冻结归档8,171,256 bytes，SHA-256 `0e7d6cda379acb8fd779c5f04d8304802af4899eebed55b214c49aff96514cd8`。原件位于 `.local/electron/deploy-board-20261026/` 的identity、prepare、activate、postflight JSON；真实凭据不写入本报告或归档。

自有PG18端口52680已关闭。关闭前核验原PID、创建时刻、可执行文件及数据路径；数据库仅剩原4库，其他客户端0；关闭后pg_ctl状态码3、端口监听0、原PID消失。回执 `.local/electron/nplus1/pg-closure.json`；数据目录和日志保留。浏览器夹具已关闭其进程、profile、socket和timer，构建／测试Node进程均已结束。首次关闭预检因PowerShell将JSON时间自动解析为DateTime，字符串比较不相等而停止；按相同UTC ticks重新精确核对后才执行关闭，未绕过进程所有权检查。

客户端仍为 0.1.2，本轮不产生新安装包。上述毫秒数来自合成隔离库，不冒充真实业务库的 50 卡片容量测量。
