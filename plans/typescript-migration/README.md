# TypeScript 增量迁移执行入口

## 当前交接

T00 至 T04-04 已合并。PR #36 发布 head `8eb71fb14dfda2c885d0edf53408fc38979aea23` 的迁移与 Evidence-history CI 成功，GitHub 确认 merge 为 `87de2bc9e8835882cd390b024a04e2865cd367f9`。原 T04-04 与 HTTP 修补回执保持其被测祖先及历史状态。

当前批次为 [T04-05](T04-05.md)，迁移 Foundation、首确认、加密备份及 P1 E2E 四个模块。公开受理接口和 E2E `handleFrame` 的参数变异修补已保留，见 [类型边界回执](receipts/T04-05-inbound-variance.json)。后继发布 `0d05ed3` 的完整 CI 在原 SS-009 浏览器用例暴露既有启动竞态：目标 URL 已发布时实际文档仍可能是 about:blank。测试夹具现等待真实文档就绪，保留原超时、取消和导航断言。干净 `67b5a8f` 实际通过 50 文件、340/340、严格类型/金丝雀、确定性构建、制品验证、59/59 工具测试及两轴独立审查；见 [当前回执](receipts/T04-05-browser-startup.json) 和 [浏览器修补记录](verification/T04-05-browser-startup.md)。261 个生产代码/脚本产物与上一候选逐字节相同，修补只改变两个测试产物。原 [47 文件回执](receipts/T04-05.json) 与完整 213 文件结果继续绑定 `60a0265`：1342/1344，两个失败已在干净基线复现，严格 readiness 仍为 KNOWN_BASELINE_NOT_READY；既有回执均不重绑。[PR37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37) 的新候选仍须取得新的发布 head CI 和外部复审，旧 CI 与额度拒绝不替代这些结果，本批不宣称完成。

Foundation 的 `p1:preflight` / `p1:serve` 先验证制品，再运行 `.build/runtime` 内同名模块；缺失或过期制品失败，需单独构建。现有运行脚本保持 `.mjs` 导入，在运行树加载唯一实现。

本批完成后停止，T05-01 不自动启动。无数据库变更，制品保持 STAGED_NOT_ACTIVATED。

## 两类根目录与历史对象

生产模块和测试子进程只从 `.build/runtime` 加载；源码检查仍读取真实 Git checkout。
`test-routing.json` 是所有 213 个当前入口的显式宿主注册表（207 个原入口、T01 金丝雀、PG callback 回归、平台边界回归、T04-03 运维兼容回归及 T04-05 CLI/兼容回归），不是“211 个测试全部通过”的宣称。
`SOURCE_HOST` 用于实际源码/治理检查；`STAGED_RUNTIME` 用于编译制品；`MIXED_EXPLICIT_ROOTS` 只通过测试专用 helper 读取真实源码文本，不能回退加载源码实现。
固定历史验证继续由原 P2-016 wrapper 在独立完整 checkout 中运行，不能将当前源码覆盖进历史工作树。

## 常用命令

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run migration:gate
node --test .build/tools/tooling.test.mjs .build/tools/hosts.test.mjs .build/tools/batches.test.mjs
npm run migration:gate -- --batch T04-05 --report-dir <repo-external-report-dir>
node .build/tools/run-tests.mjs --selection t02-time
```

当前 PowerShell 主机使用 `npm.cmd` 传递 `--batch` 等参数；工具编译由 `premigration:gate` 执行。
数据库用例要求独立 PostgreSQL 18，先在专用合成库通过现有 `migrateCurrentBaseline` 初始化当前基线；显式设置 `TS_MIGRATION_TEST_DB_ISOLATED=1` 和 loopback `PILOT_DATABASE_URL`，不读取真实 `.env.pilot`。
浏览器可显式设置测试专用 `TS_MIGRATION_BROWSER_EXECUTABLE`；找不到浏览器必须失败，不能跳过。
CLI 的 `--report-dir` 必须在仓库之外。旧 72 个 npm 测试别名保留原选择和参数，由编译运行路由执行；生产/部署/迁移操作 CLI 不在本批授权范围。

## 原基线的非就绪结果

当前原 `--require-ready` 仍为 `YXX_VERIFICATION_REJECTED` / `YXX_LOCAL_VALIDATION_SCOPE_INVALID`。
ARCH-006 原 validator 在 T02 合并基线返回两个 scope/READY 错误；本批还因原规则不识别已授权 P1 TypeScript 迁移而返回第三个 runtime-delta 错误。CI 保留原 validator 的 exit 1，分别精确核验两份完整诊断；历史九/十路径变体及本批四模块改名的精确八/九/十路径变体可分类为已知非就绪。本批九路径额外支持为 p1-007 的原始 Delivery ID 类型边界，十路径再包含 p1-003 的公开 Inbox 受理类型边界；其他路径或诊断仍失败。原始输出不改写、不计入 readiness PASS。
ARCH-005 对部分冻结 SQL 使用原 CRLF 检出字节。CI 在 checkout 前设置原检出策略，不修改 SQL 或冻结哈希。

## 历史记录与边界

T00 的 baseline.json、baseline-tests.json、verification 和原回执继续描述它们原本绑定的提交。T01 回执亦不重写旧 tested_head。
各批次最终结果以对应 PR 精确 head、实际 CI、自审及外部审查结果为准；T04-03 的历史 [CI 对照修补记录](verification/T04-03-ci-repair-20260930.md) 不替代旧实现回执或新 head 的远端结果。
当前业务状态、Evidence、SQL 和现场批准不变。影子构建不是生产激活；没有调用正式 Provider、生产写库或真实企业微信发送。

批次登记见 [batches.json](batches.json)：T04-05 保留五个直接测试、七个反向影响测试、全部 P1 阶段入口及前批 baseline/supplemental。SOURCE_HOST 读取真实 checkout，运行实现由已验证制品加载。缺失制品不能算已知非就绪；历史与当前结果分开记录。
