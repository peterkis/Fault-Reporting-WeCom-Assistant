# TypeScript 增量迁移执行入口

## 当前交接（2026-10-02）

PR #37 已合并：发布 head `5ea7982bad2dc8d2236f36b25ce5a9c7427199bf`，merge `78fc466af50c6d4c27850998267510fb1592157b`。独立复审与当前 head CI 已用于本次授权合并；各轮回执仍保留原测试身份，不重绑。随后历史研究归档合并为 `562a96ffdd7148d729ab0eed9d215abe894f12c2`。T04-05 合并收口；T05-01 不自动启动。

当前严格 readiness 恢复作为 [独立任务](../yxx-current-readiness-implementation.md) 执行，按 [ADR-0027](../../adr/0027_yxx_current_readiness.md) 区分当前限定 Web 技术准备与历史 SS009 验收。在取得新候选完整证据之前，保持 NOT_READY。下文是合并前各轮实际记录，不表示 PR #37 仍处于 OPEN。

## T04-05 合并前的历史交接记录

T00 至 T04-04 已合并。PR #36 发布 head `8eb71fb14dfda2c885d0edf53408fc38979aea23` 的迁移与 Evidence-history CI 成功，GitHub 确认 merge 为 `87de2bc9e8835882cd390b024a04e2865cd367f9`。原 T04-04 与 HTTP 修补回执保持其被测祖先及历史状态。

当前批次为 [T04-05](T04-05.md)，迁移 Foundation、首确认、加密备份及 P1 E2E 四个模块。上一轮发布源候选 `8f929b73084690c46190d6cf4968b2801894b2ae` 的[当前 CI](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36851491429) 六批次均通过，T04-05 为 50/50 文件、340/340，两个平台工具检查各 59/59，1,438 份 TAP/stderr 哈希已核验。用户提供的独立远端复审确认三个公开 raw-input 函数属性边界已修复，上一轮 P2 关闭，已核查范围没有新的已确认 P1/P2；见 [复审回执](receipts/T04-05-rereview.json) 和 [终局核验记录](verification/T04-05-rereview.md)。额外本地复跑最终为 FAIL：47/50 个文件记录，46 文件通过、1 个架构子进程 240 秒超时、3 个未运行；300/300 已完成 TAP 测试不代表全批通过。临时 PostgreSQL 已核对正常停止、数据目录删除及无端口监听。机器人仍返回代码审查额度限制，没有 GitHub APPROVE。本文档后继不改变运行候选，既有复审与 CI 仍绑定 8f929b7，后继 head 的已配置 CI 单独记录。[原回执](receipts/T04-05.json) 及完整 213 文件快照仍绑定 `60a0265`（1342/1344、两项已复现基线失败），其他旧回执也不重绑；严格 readiness 仍为 KNOWN_BASELINE_NOT_READY。[PR37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37) 未合并，T04-05 保持 IN_PROGRESS，T05-01 未授权。

后继文档 head `f8e209e` 的 CI 36876787453 实际失败于 T04-02 的 SS-009 浏览器清理检查（业务断言已通过，CDP socket 尚未 CLOSED）。测试辅助函数修补 `ef99c7e` 增加有界关闭完成等待，原实现回归 RED，修补后生命周期 5/5、本地 50 文件 / 341 测试及 Windows tooling 59/59 通过；261 个生产输出字节不变。见 [关闭修补记录](verification/T04-05-browser-close.md) 和 [新回执](receipts/T04-05-browser-close.json)。新发布 head 的完整 CI 待运行，既有 CI/复审及原测试执行身份不重绑。

当前发布 f9cd40d 的 CI 36891280424 再次失败于两个浏览器清理入口。完整传输修补 dca2180 使用已有锁定版本的测试专用 ws 连接，关闭握手停滞时终止自有 TCP 并确认 CLOSED；真实 Chrome/CDP 回归 RED 后 GREEN 6/6，本地扩展批次 52/52 文件、391/391 及 tooling 59/59 通过。六个完整批次改为独立 PG18 环境、最多三个并行，原 baseline/strict/historical/cleanup/双平台检查均保留；未削减覆盖。历史健康 CI 为 93m18s，预计并行后约 40 分钟（新 CI 实测待确认）。见 [传输与 CI 记录](verification/T04-05-browser-transport-ci.md) 和 [新回执](receipts/T04-05-browser-transport-ci.json)。

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

独立 CI 数据库初始化补齐：首轮并行 head bd08081 在原 P1 通知/运维测试暴露空库缺少 ARCH-005 基线；后继 bb4ad85 在每个空的自有 PG18 服务先运行既有编译产物迁移，再执行原批次。真实空库通知 RED1/4 → GREEN4/4、运维6/6；无 SQL/产品源码/断言变化，747 输出不变。见 [初始化回执](receipts/T04-05-ci-isolation.json) 和 [补齐记录](verification/T04-05-browser-transport-ci.md#independent-database-bootstrap-follow-up)。新完整 CI 待确认。
