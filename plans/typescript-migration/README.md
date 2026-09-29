# TypeScript 增量迁移执行入口

## 当前交接

T00、T01、T02、T03-01 及其前置/PG callback 修补、T04-01 均已合并。T04-02 已通过 PR #32 合并，主线基线为 `cc1299ea3b30c92f5356258b31963f0c67e7e7ae`。
当前批次为 [T04-03 P1 运维核心严格类型迁移](T04-03.md)，[PR #33](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/33) 已创建。被测实现 `a5e7ed73454805b07f1488a2fec60b4e281b07a0` 的本地 96 文件、581/581 测试、52/52 工具测试及两轴审查通过；远端 CI 因账户计费/额度未启动，外部审查状态以当前 PR 和回执为准，不能声明整批 PASS 或 MERGE_READY。

先读根 AGENTS.md、CONTEXT.md、ADR-0026，再读 [当前迁移说明](T04-03.md)、[进度](progress.json) 和 [迁移回执](receipts/T04-03.json)。前序说明和回执只描述其绑定的历史批次，不覆盖当前结果。
原计划包 `WeCom_TypeScript_Migration_Plan_v1_20260927.zip` 的 `prompts/00_DISPATCHER.md`、`prompts/T04-03.md` 是本批执行输入。T04-03 只迁移 `src/p1-011-pilot-operations-baseline.mjs` 到 `.mts`；支持类型与工具修补按回执登记，不重做 181 个迁移目标。
本批完成后停止。T04-04 未授权启动；不得自动合并、部署或把历史现场批准用于新制品。

## 两类根目录与历史对象

生产模块和测试子进程只从 `.build/runtime` 加载；源码检查仍读取真实 Git checkout。
`test-routing.json` 是所有 211 个当前入口的显式宿主注册表（207 个原入口、T01 金丝雀、PG callback 回归、平台边界回归和 T04-03 运维兼容回归），不是“211 个测试全部通过”的宣称。
`SOURCE_HOST` 用于实际源码/治理检查；`STAGED_RUNTIME` 用于编译制品；`MIXED_EXPLICIT_ROOTS` 只通过测试专用 helper 读取真实源码文本，不能回退加载源码实现。
固定历史验证继续由原 P2-016 wrapper 在独立完整 checkout 中运行，不能将当前源码覆盖进历史工作树。

## 常用命令

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run migration:gate
node --test .build/tools/tooling.test.mjs .build/tools/hosts.test.mjs .build/tools/batches.test.mjs
npm run migration:gate -- --batch T04-03 --report-dir <repo-external-report-dir>
node .build/tools/run-tests.mjs --selection t02-time
```

当前 PowerShell 主机使用 `npm.cmd` 传递 `--batch` 等参数；工具编译由 `premigration:gate` 执行。
数据库用例要求独立 PostgreSQL 18，先在专用合成库通过现有 `migrateCurrentBaseline` 初始化当前基线；显式设置 `TS_MIGRATION_TEST_DB_ISOLATED=1` 和 loopback `PILOT_DATABASE_URL`，不读取真实 `.env.pilot`。
浏览器可显式设置测试专用 `TS_MIGRATION_BROWSER_EXECUTABLE`；找不到浏览器必须失败，不能跳过。
CLI 的 `--report-dir` 必须在仓库之外。旧 72 个 npm 测试别名保留原选择和参数，由编译运行路由执行；生产/部署/迁移操作 CLI 不在本批授权范围。

## 原基线的非就绪结果

当前原 `--require-ready` 仍为 `YXX_VERIFICATION_REJECTED` / `YXX_LOCAL_VALIDATION_SCOPE_INVALID`。
ARCH-006 原 validator 在 T01 合并基线也返回相同两个 scope/READY 错误；本批保留原测试断言和失败，由 CI 在真实基线及当前源码分别运行、逐字节比较，绝不将它计入 PASS。
ARCH-005 对部分冻结 SQL 使用原 CRLF 检出字节。CI 在 checkout 前设置原检出策略，不修改 SQL 或冻结哈希。

## 历史记录与边界

T00 的 baseline.json、baseline-tests.json、verification 和原回执继续描述它们原本绑定的提交。T01 回执亦不重写旧 tested_head。
各批次最终结果以对应 PR 精确 head、实际 CI、自审及外部审查结果为准；当前 T04-03 仍受 CI 额度阻塞。
当前业务状态、Evidence、SQL 和现场批准不变。影子构建不是生产激活；没有调用正式 Provider、生产写库或真实企业微信发送。

批次登记见 [batches.json](batches.json)：T04-03 登记 9 个直接测试、69 个反向影响测试、17 个保留 baseline 和 12 个 supplemental；当前批次去重后执行 96 个文件。SOURCE_HOST 读取真实 checkout，运行实现由已验证制品加载。当前严格 CLI 需要先构建；缺失制品不能算已知非就绪。历史与当前基线兼容结果分开记录，旧回执不改写。
