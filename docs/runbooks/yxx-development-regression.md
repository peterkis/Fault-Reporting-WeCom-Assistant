# YXX 指定开发版本自动化回归

## 授权与结论边界

本方案依据 2026-09-30 用户确认及后续实施授权。仅验证现有 YXX 自助报修闭环、035 工作台认证，以及 036 安装兼容、关闭态和已有模拟目录流程。项目无实际业务数据，环境为专用隔离 PostgreSQL、合成数据和模拟 Provider。

交付限于本方案、现有测试路由中的 `yxx-dev-current` 选择集和一份精简结果记录。不新增 readiness 校验器、通用验收框架或归档平台，不修改生产实现、历史 scope、原验收入口、旧证据或 SQL。

结果只证明记录所指开发版本的所选自动化回归；不是全仓测试、SS009/SS010 readiness PASS、现场准入、业务 Gate、生产批准或下一批 TypeScript 迁移授权。历史任务状态和旧现场批准不扩展本次权限。

## 被测对象

每次获得独立执行授权时，从 GitHub 核实最新已合并 main，记录完整 commit/tree 和查询时间，随后冻结该对象。未合并 PR 不纳入，不为回归推进合并，不对两个候选重复运行完整选择集。

本次冻结 main：`cc1299ea3b30c92f5356258b31963f0c67e7e7ae`（PR #32 merge）。查询时 PR #33 仍 OPEN，因此不包含 T04-03。

实际测试先在该提交的干净、完整 CRLF checkout 执行。为保持已合并对象不变，首次执行从仓库外的精确选择清单调用已有 `runSelection`；交付时才把同一清单登记为 `yxx-dev-current`。结果同时记录清单哈希和测试源码哈希，不能将后补路由宣称为已在被测提交中存在。后续版本可直接使用已登记的选择集。

## 四类证据分开记账

| 类别 | 对象及用途 | 本方案处理 |
| --- | --- | --- |
| 历史 SS009 | PR #19 最终发布 head `41edd855e7bc55149facb6a4b2e0076776c22e66`；r7 的 tested_head 为 `8b74de2eb63ea90e3ca23dabcdbc8f5afdadd7e5` | 保持原 scope、哈希、祖先、批准和严格 CLI；复验沿用 `.github/workflows/ss009-evidence-history.yml` 的固定完整 CRLF checkout |
| 当前开发回归 | 本次 GitHub 冻结的 main，实际编译制品及本选择集 | 单独记录实际运行结果，不继承历史 PASS |
| 现场业务验收 | 另行批准的候选、窗口、人员、数据库和操作范围 | 本轮 NOT_RUN，不把历史部分现场记录提升为当前结果 |
| 生产批准 | 负责人对明确版本和环境的独立批准 | 本轮 NOT_AUTHORIZED |

`readYxxLocalValidationScope` 绑定 SS008 基点 `2d9fda2065b1303620f247a9e4d9754f0a3472d9`。其第 30 行要求迁移目录精确相等：历史 20 个文件为 001–012、020–022、030–034；当前还有 035、036。035 首次加入于 `627d5f72959b4b2a085d734c311712363f87a3f8`，036 首次加入于 `19d123c0798eb13281c056a619cb117ff3b87559`，均早于本次 main。

原命令 `node scripts/validate-yxx-self-service.mjs --require-ready` 的历史范围拒绝单独保留为非零结果。SS010 入口也调用该历史结构检查，不能作为绕过入口。不得删除 SQL、允许任意新增文件、改写旧证据或捕获错误后返回 PASS。发布身份预检只证明对象/祖先，不证明 readiness。

## 当前测试范围

精确文件清单见 `plans/typescript-migration/test-routing.json` 的 `selections.yxx-dev-current`；每个文件继续使用原宿主、Node 参数和隔离要求。本次共 43 个现有文件。

| 责任 | 复用测试 | 主要正向及负向覆盖 |
| --- | --- | --- |
| 身份与本人访问 | `p2-g2-yixiaoxiu-*`、SS001/002、SS005 | 模拟 OAuth/委托身份对应、本人读取、他人拒绝、会话/退出/保留期、旧授权不得绕过；既有成员安全 Incident 投影只做隔离防回归 |
| 网页闭环 | SS003–008 的 Schema、编排、查询、补充、UI、边界与装配测试 | 来源落库、幂等、明确报修与人工复核、补充修订、原工作台、本人时间线、读写关闭与 UI 恢复 |
| 恢复与边界 | SS009 的 browser/capacity/catalog/crash/http-recovery/review-regressions | 事务/保存点回滚、进程中断和响应丢失、同命令恢复、单 Ticket、catalog 漂移、资源清理；容量只是既有合成本机回归，不是正式 2C4G/60 分钟证明 |
| 有限运行控制 | SS010 contract/runtime/browser | 模板非授权、配置/人员/窗口/预算变化拒绝、App/Worker 角色限制、撤销与恢复、零外发；只执行合成测试，不启动现场控制器 |
| 035 | `p2-016-workbench-wecom-auth.test.mjs`、`p2-016-workbench-auth.integration.test.mjs` | 模拟扫码/状态消费/会话、限流、审计、迁移原子性、重入、check 回滚和 Schema |
| 036 | 八个人员目录 Provider/Store/同步/角色/查询测试 | 模拟目录解析、本地读取、发布失败保留旧快照、失效绑定拒绝、默认关闭、App/Worker 所有权、036 安装与重入 |
| 核心服务降级 | `p1-011-pilot-operations-baseline.test.mjs` | 必需依赖与可选依赖分离，AI/日志失败不推翻已提交受理 |
| 证据防伪 | SS009 evidence/evidence-history/governance、成员 readiness 单元测试 | 合成伪造/缺失/篡改结果被拒绝，保留当前历史范围拒绝；不是重新颁发旧验收 |

`tests/yxx-ss-008-validation-scope.test.mjs` 不在当前业务选择集：它要求当前根目录也处于固定 SS008 范围，属历史专属正向断言。原文件及注册项不变；不把其未执行计成 PASS。当前的 scope 拒绝由原 CLI 及现有 SS009 负向测试另行观察。其他未选全仓测试不计为已执行。

现有测试中的旧 Schema/Bot 图数据全部为即时生成的合成夹具，仅用于验证既有约束和不丢事实；不代表新增历史业务数据导入、生产切换或旧系统兼容工作。ADR-0023/0024 中尚未实现的新业务设计不属于本次验收。

## Schema 与配置

源代码清单精确包含当前 22 个 SQL，记录各文件哈希，不按“至少 20 个”放宽匹配。数据库安装组合由原测试夹具决定并分别记账：

- YXX 测试通过 `migrateCurrentBaselineWithYxx` 使用既有基础链与 033/034。
- 035 测试使用原工作台迁移入口；036 测试沿 035 前置链调用原 036 入口。
- `migrateCurrentBaselineWithYxx` 不会自动安装 035/036，不能从仓库含 22 个文件推导任一测试库已安装全部文件。
- 本结果不额外声称一个同时安装全部 22 个 SQL 的单一数据库端到端组合已通过；若未来部署配置要求该组合，另行确认这个具体覆盖缺口后再增补测试。

全部持久 Feature Flag 默认值不变。个别测试在自己拥有的临时数据库/模拟配置内启用功能以覆盖行为，不能成为部署配置或现场授权。036 的网络为本地假服务或 Stub，不连接正式 Provider。AI 增强执行结果独立为 NOT_RUN；核心降级测试通过不表示 AI 增强已通过。

## 运行方式

下面命令只在独立、完整、干净的已冻结 checkout 和获授权的合成环境中执行。不得在有用户改动的主工作区重置、清理或直接跑数据库迁移。

```powershell
# EXPECTED_HEAD 来自本次 GitHub main 元数据，不能用本地 HEAD 自证。
node .github/review/verify-published-history.mjs --expected-head <authoritative-full-sha>
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run migration:gate

# 测试专用回环库，不加载 .env.pilot；浏览器必须显式可用。
$env:TS_MIGRATION_TEST_DB_ISOLATED = '1'
$env:PILOT_DATABASE_URL = '<owned-loopback-test-database-url>'
$env:TS_MIGRATION_BROWSER_EXECUTABLE = '<absolute-browser-path>'
node .build/tools/run-tests.mjs --selection yxx-dev-current --report-dir <new-repo-external-directory>
node .build/tools/verify-artifact.mjs
node scripts/validate-yxx-self-service.mjs --require-ready
```

专用控制库如需既有时间契约基础链，仅对本次空合成库调用编译后的 `migrateCurrentBaseline`。迁移 `--check` 包含事务性 DDL，不是离线检查。不得对已有服务、医院数据或生产数据库执行上述步骤。

已有 runner 按文件串行执行，记录实际加载的运行模块、TAP、stderr、哈希、计数、退出码及未运行文件；失败时停止。保留失败尝试，诊断后只对有依据的受影响范围重跑，最终记录必须披露原失败和重跑理由。不能跳过失败测试、更改阈值或把清单当作执行证明。

本次发现 SS007 原生 UI acceptance 测试把 `390x844.png`、`1440x900.png` 留在 `.build/runtime/tmp/ss007-ui/`，原制品校验会报 `MIGRATION_UNDECLARED_OUTPUT`。在该文件回执已经 PASS 后，由操作者将这两个确定属于本次运行的文件复制到仓库外 artifacts，核对前后 SHA-256，再移除临时原文件；记录该动作及清理前的失败。必须在后续 SOURCE_HOST/最终制品核验前完成。不得删除未知文件、忽略整个 tmp 目录或放宽制品清单。命令本身没有自动截图归档能力，因此本次是带有明确产物整理步骤的回归，不宣称单命令无人值守通过。

## 证据和状态规则

最小绑定为：GitHub main SHA/tree → 干净被测源码及当前候选摘要 → build manifest/输入输出哈希 → 精确测试选择 → 分文件实际结果 → 精简报告。保留 Node/TS/PG/浏览器版本、隔离配置、原始文件索引、失败尝试和清理结果。

源码、Schema、配置语义、测试选择或构建制品变化使原结果对新对象不再适用。历史结果保留，不自动重绑 tested_head。后继交付须保留真实祖先；同 tree/输出相同不能替代祖先。后补文档、路由和结果记录的差异明确披露，不伪称被测版本已包含它们。

| 状态 | 判定 |
| --- | --- |
| PASS | 本选择集全部实际通过，fail/skip/cancelled/todo/not_run 为 0，候选/制品未漂移，原始证据完整且清理成功；只称“指定开发版本所选回归 PASS” |
| FAIL | 实际测试、绑定、哈希、隔离或清理断言失败；保留原始失败记录 |
| BLOCKED | 必需环境或证据不可用、对象来源不明或缺必要授权；不能由静态检查替代 |
| NOT_RUN | 项目尚未执行；必需项未执行时整体不能 PASS |

若首轮失败而原样定向复核通过，分别列出两次结果，不能覆写首轮或使用一个无条件 PASS 掩盖不稳定性。资源清理失败即使业务断言通过也必须保留；不能仅凭后来未观察到进程，就声称原清理断言通过。

Git 只新增 `evidence/yxx-development-regression-20260930.json` 精简记录。原始日志、分文件回执、manifest、候选清单及哈希索引保存在 `C:/Users/zqpet/.codex/artifacts/yxx-dev-regression-20260930-cc1299e`，由现有项目维护者保管，至少保留至后继验收完成且不再被引用。缺失、损坏或无法取回时，该记录不能被继续用作已验证依据。日志不得包含凭据、真实个人资料或正式数据库连接串。

## 停止与撤销

发现对象变化、真实依赖、非本次数据库、未经批准的网络调用、已有资源被影响或证据漂移立即停止并记录。完成后停止本次 PG，确认临时库/连接及测试浏览器等拥有资源已清理；原始日志不删除。

本次无生产代码或数据库 Schema 变更。撤销仅删除新命名选择集和本方案入口；已经形成的结果记录按历史记录保留，不覆写为另一版本结果。无 down migration、部署、合并、真实发送、T04-04、P2-G2-LIVE、P2-008 或 P3 推进。
