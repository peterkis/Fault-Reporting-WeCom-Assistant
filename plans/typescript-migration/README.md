# TypeScript 增量迁移执行入口

## 当前交接

T00 已通过 PR #24 合并；T01 已通过 PR #25 独立审查并合并。
T02 已通过 PR #26 合并，merge 为 `7eefaa99591bfaa2e787701efd315ff701c51f35`。
[T03 前置补齐](T03-prerequisite.md) 已通过 PR #27 合并，merge 为 `16312fd6cc9149f89f6cad866da5e3cf7b3ba023`。
独立 [PG callback 边界修复](T03-pg-callback-fix.md) 已通过 PR #28 合并，merge 为 `d2d462c8b98b6a379584f0dbc6d1786011aad573`。当前实施 [T03-01 平台四模块迁移](T03-01.md)。
不要把工作区测试、历史回执或本文件当作最终 PR 审查结果。T03 四模块迁移须在阻断缺陷修复获授权合并后恢复；不自动合并或部署。

先读根 AGENTS.md、CONTEXT.md、ADR-0026，再读 [当前迁移说明](T03-01.md)、[进度](progress.json) 和 [迁移回执](receipts/T03-01.json)。T02 与前置回执保留为历史快照。
原计划包 `WeCom_TypeScript_Migration_Plan_v1_20260927.zip` 的 `prompts/00_DISPATCHER.md`、`prompts/T03-01.md` 是后续四模块迁移执行输入；当前从 PR #28 合并后的 main 执行四模块迁移，不重做 181 个迁移目标与 34 批次的 [scope.json](scope.json)。

## 两类根目录与历史对象

生产模块和测试子进程只从 `.build/runtime` 加载；源码检查仍读取真实 Git checkout。
`test-routing.json` 是所有 210 个当前入口的显式宿主注册表（207 个原入口、T01 金丝雀、PG callback 回归及平台边界回归），不是“210 个测试全部通过”的宣称。
`SOURCE_HOST` 用于实际源码/治理检查；`STAGED_RUNTIME` 用于编译制品；`MIXED_EXPLICIT_ROOTS` 只通过测试专用 helper 读取真实源码文本，不能回退加载源码实现。
固定历史验证继续由原 P2-016 wrapper 在独立完整 checkout 中运行，不能将当前源码覆盖进历史工作树。

## 常用命令

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run migration:gate
node --test .build/tools/tooling.test.mjs .build/tools/hosts.test.mjs .build/tools/batches.test.mjs
npm run migration:gate -- --batch T03-01
node .build/tools/run-tests.mjs --selection t02-time
```

数据库用例要求独立 PostgreSQL 18，显式设置 `TS_MIGRATION_TEST_DB_ISOLATED=1` 和 loopback `PILOT_DATABASE_URL`，不读取真实 `.env.pilot`。
浏览器可显式设置测试专用 `TS_MIGRATION_BROWSER_EXECUTABLE`；找不到浏览器必须失败，不能跳过。
CLI 的 `--report-dir` 必须在仓库之外。旧 72 个 npm 测试别名保留原选择和参数，由编译运行路由执行；生产/部署/迁移操作 CLI 不在本批授权范围。

## 原基线的非就绪结果

当前原 `--require-ready` 仍为 `YXX_VERIFICATION_REJECTED` / `YXX_LOCAL_VALIDATION_SCOPE_INVALID`。
ARCH-006 原 validator 在 T01 合并基线也返回相同两个 scope/READY 错误；本批保留原测试断言和失败，由 CI 在真实基线及当前源码分别运行、逐字节比较，绝不将它计入 PASS。
ARCH-005 对部分冻结 SQL 使用原 CRLF 检出字节。CI 在 checkout 前设置原检出策略，不修改 SQL 或冻结哈希。

## 历史记录与边界

T00 的 baseline.json、baseline-tests.json、verification 和原回执继续描述它们原本绑定的提交。T01 回执亦不重写旧 tested_head。
最终 T02 结果以 PR 精确 head、对应 CI 原始制品、自审及 Codex 实际回复为准。
当前业务状态、Evidence、SQL 和现场批准不变。影子构建不是生产激活；没有调用正式 Provider、生产写库或真实企业微信发送。

批次登记见 [batches.json](batches.json)：29 个直接、166 个反向影响测试加完整人员目录基线与补充项，去重后 181 文件。SOURCE_HOST 读取真实 checkout，运行实现由已验证制品加载。当前严格 CLI 需要先构建；缺失制品不能算已知非就绪。历史与当前基线兼容结果分开记录，旧回执不改写。
