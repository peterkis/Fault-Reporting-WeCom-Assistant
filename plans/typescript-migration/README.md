# TypeScript 增量迁移执行入口

## 当前交接

T00 至 T04-03 已合并。PR #33 的发布 head `43ba7286d9509dea68b3bc02661fb0e9312430a8` 通过迁移 CI，merge 为 `c621845f66eb6d43cb69f00094fb18f2b19baefa`。旧 T04-03 回执保留原被测对象和当时执行状态。

当前批次为 [T04-04](T04-04.md)，只迁移 SDK Adapter、Service Intake 与 Pilot 权限工作台三个模块，必要支持类型和接线见 [回执](receipts/T04-04.json)。最终提交验证与审查仍进行中，不声明 PASS。

原计划包的 prompts/T04-04.md 是本批执行输入。本批完成后停止；T04-05 未授权启动。不得自动合并、部署或复用历史现场批准激活新制品。

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
npm run migration:gate -- --batch T04-04 --report-dir <repo-external-report-dir>
node .build/tools/run-tests.mjs --selection t02-time
```

当前 PowerShell 主机使用 `npm.cmd` 传递 `--batch` 等参数；工具编译由 `premigration:gate` 执行。
数据库用例要求独立 PostgreSQL 18，先在专用合成库通过现有 `migrateCurrentBaseline` 初始化当前基线；显式设置 `TS_MIGRATION_TEST_DB_ISOLATED=1` 和 loopback `PILOT_DATABASE_URL`，不读取真实 `.env.pilot`。
浏览器可显式设置测试专用 `TS_MIGRATION_BROWSER_EXECUTABLE`；找不到浏览器必须失败，不能跳过。
CLI 的 `--report-dir` 必须在仓库之外。旧 72 个 npm 测试别名保留原选择和参数，由编译运行路由执行；生产/部署/迁移操作 CLI 不在本批授权范围。

## 原基线的非就绪结果

当前原 `--require-ready` 仍为 `YXX_VERIFICATION_REJECTED` / `YXX_LOCAL_VALIDATION_SCOPE_INVALID`。
ARCH-006 原 validator 在 T02 合并基线返回两个 scope/READY 错误；本批还因原规则不识别已授权 P1 TypeScript 迁移而返回第三个 runtime-delta 错误。CI 保留原 validator 的 exit 1，分别精确核验两份完整诊断；第三项仅在本批九个精确源码路径（含三个旧 `.mjs` 删除）的精确源码差异下可分类为已知非就绪，其他路径或诊断仍失败。原始输出不改写、不计入 readiness PASS。
ARCH-005 对部分冻结 SQL 使用原 CRLF 检出字节。CI 在 checkout 前设置原检出策略，不修改 SQL 或冻结哈希。

## 历史记录与边界

T00 的 baseline.json、baseline-tests.json、verification 和原回执继续描述它们原本绑定的提交。T01 回执亦不重写旧 tested_head。
各批次最终结果以对应 PR 精确 head、实际 CI、自审及外部审查结果为准；T04-03 的历史 [CI 对照修补记录](verification/T04-03-ci-repair-20260930.md) 不替代旧实现回执或新 head 的远端结果。
当前业务状态、Evidence、SQL 和现场批准不变。影子构建不是生产激活；没有调用正式 Provider、生产写库或真实企业微信发送。

批次登记见 [batches.json](batches.json)：T04-04 登记 43 个直接测试、105 个反向影响测试、17 个保留 baseline 和 12 个 supplemental，去重执行 131 个文件。SOURCE_HOST 读取真实 checkout，运行实现由已验证制品加载。缺失制品不能算已知非就绪；历史与当前结果分开记录。
