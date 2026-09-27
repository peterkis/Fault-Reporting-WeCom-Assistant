# TypeScript 迁移 · T00 政策与基线

**状态：BASELINE_INCOMPLETE；本 PR 为可审阅草案，不是 T00 验收通过。**
本次只执行用户授权的 T00；T01 及以后未开始。运行源码、依赖、SQL、历史 Evidence、现有 workflow 和业务阶段状态均不修改。

## 1. 读取顺序与事实源

先读根 [AGENTS.md](../../AGENTS.md)、[技术栈](../../docs/03_technology_stack.md) 和
[ADR-0026](../../adr/0026_typescript_strict_incremental_migration.md)，再读取以下本批文件：

| 文件 | 用途 |
|---|---|
| [baseline.json](baseline.json) | 外部获取的 main SHA、tree、计划与归档来源、2072 个文件的内容核对 |
| [scope.json](scope.json) | 181 个命名目标、34 个文件批次、G0 和现有脚本保留边界 |
| [test-routing.json](test-routing.json) | 207 个测试入口、42 个支持文件、宿主分类初稿；不是可执行路由 |
| [baseline-tests.json](baseline-tests.json) | 当前人员目录 CI 的 17 个测试文件选择集及缺失环境 |
| [progress.json](progress.json) | 全部批次 PLANNED；当前只准备 T00，禁止越过未完成门禁 |
| [receipts/T00.json](receipts/T00.json) | 会话隔离副本的实际执行结果、失败和未执行项 |

上游交付包：`WeCom_TypeScript_Migration_Plan_v1_20260927.zip`，其 SHA-256 与两份提示词摘要记录于 baseline.json。
完整原计划未复制进仓库，以避免把 39 份提示词和所有历史清单重复当成实施产物；后续仍从该 ZIP 的 `prompts/00_DISPATCHER.md`、对应阶段提示词及 `tools/verify_baseline.py` 读取。解压在仓库外，记该根目录为 PLAN_ROOT。

权威起点是 GitHub main `9cb71da1370781670faedbc5a24668720e8df0be`，tree `42201d12279dc9c95b64912f13cc72284388c514`。
本批内容盘点使用 PR #23 最终 CI 的 `fe69cac7...` 源码归档；全部 Git blob 和 tree 与 main 一致。
**这证明文件内容一致，不证明无 Git 的归档具有真实祖先链或能通过当前 readiness。** 用户本机和生产服务器未被访问。

## 2. 当前已完成与未完成

已准备政策、181 个精确迁移目标和 legacy 清单，核对 160 个 npm scripts，以及 207 个测试入口的静态分类。
`tests/` 下 247 个 MJS 中，205 个为测试入口、42 个为支持文件；再加 `.github/review/` 下 2 个测试入口，合计 207。
G0 不是全部脱离运行：`g0-002-sdk-lifecycle.mjs` 的 logger 仍在 Gateway 链路中，T05 必须验证其窄类型边界。

会话实际环境为 Node 22.16.0，不满足 Node 24。无 PostgreSQL 18；离线锁定依赖安装返回 ENOTCACHED。
架构检查 407 项通过、时间契约 4/4 通过；目录试跑报告 57 项中 55 通过、2 个文件因缺少 pg 加载失败。
随包 Git 核验器在无 .git 的归档上返回 BLOCKED_BASELINE，未制造临时父提交或伪造真实 checkout。
这些只属于 **ARCHIVE_SNAPSHOT 的诊断记录**，不是本 PR 的 Node24/PG18 基线通过。

当前缺项：完整 Git 上的原计划 baseline 工具、Node24/PG18 下的 17 文件选择集、当前版本的 --require-ready、P2-016 独立历史入口。
现有 SS009 PR workflow 可验证新 head 的身份和其选中的当前源码回归，并另外验证冻结历史对象；其结果在 PR 中关联真实 head。
人员目录 workflow 使用源码路径过滤，不会由 T00 纯文档修改触发。不得修改源码、创建一次性写入工作流或扩大 T00 范围来诱导执行。

## 3. 在合适环境补齐基线

以下是**后续执行步骤，不是本次已执行记录**。使用用户批准的隔离 Node24/PG18 环境和完整 Git checkout，不读取真实 .env.pilot、不连接正式 Provider。
日志写仓库外的 LOG_ROOT，保留原始 exit、测试计数、skipped、环境和外部确认的被测 SHA。不要把日志重写入冻结 Evidence。

1. 读取 GitHub 当前 main 和本 PR head 的完整 SHA；检查当前分支、工作树、浅克隆和已有用户内容。未经授权不 reset、clean、stash、删除分支或更改生产配置。
2. 首次原始基线：在独立完整 checkout 中检出原 main `9cb71da...`，执行原计划工具的 `--mode exact`。用的是 ZIP 的 data/baseline.json，不是本目录的事实记录文件。

```text
python <PLAN_ROOT>/tools/verify_baseline.py --repo <BASELINE_CHECKOUT> --baseline <PLAN_ROOT>/data/baseline.json --mode exact
```

3. 本 PR 的后继提交不能冒充最初 main。对完整 PR checkout 使用 descendant 并传外部 GitHub 已确认的 SHA：

```text
python <PLAN_ROOT>/tools/verify_baseline.py --repo <PR_CHECKOUT> --baseline <PLAN_ROOT>/data/baseline.json --mode descendant --expected-head <GITHUB_PR_HEAD_SHA>
node .github/review/verify-published-history.mjs --expected-head <GITHUB_PR_HEAD_SHA>
```

4. Node 主版本必须为 24，按原 lockfile 安装依赖。PG 必须为独立测试实例；环境变量只指向该实例。沿用现有隔离库 harness 的创建、回滚和残留校验；不能把数据库用例改成 mock 或 skip。
5. 在上述真实 SOURCE_HOST 逐条执行 baseline-tests.json 的 5 条选择命令及架构检查。收集 Node 测试报告实际 test/pass/fail/cancelled/skipped/todo 数量，不硬填旧 CI 的 59/6/23。
6. 在身份核验通过后继续执行以下两个不同的检查，分别留日志与退出码：

```text
node scripts/validate-yxx-self-service.mjs --require-ready
npm run validate:p2:016:historical
```

当前 --require-ready 非零时保留原错误。只有真实当前对象已跑出具体失败，才可另记 KNOWN_BASELINE_NOT_READY；不能把无 Git、缺 pg 或历史测试通过变换成该结论。
不得修改 tested_head、接受仅同 tree 的祖先替代、放宽旧验证器、修改冻结证据或改变 P2-G2 的完成状态。

## 4. 关闭本批与后续

补齐环境基线后更新本目录的回执与 progress，仍不改原业务 backlog。
自审检查最终 diff 必须仅包含 T00 允许路径；types/build 是 NOT_APPLICABLE_T00，类型逃逸例外保持为空。
提交后绑定实际 GitHub head 及相应 CI；满足 T00 门禁后再发起独立 `@codex review`。当前草案不宣称自审通过、外审通过或可合并。

仅在 T00 基线记录完成、独立审查及用户授权合并之后，T01 才以新的 main 为起点。
T01/T02 建立类型管线和测试宿主；T03 起才迁移既有模块。T00 的政策生效不代表编译器已经安装或有自动禁止 JS 的 CI。

## 5. 回滚与边界

未合并时保留草案及日志，不推进下一批。已合并后只通过独立 revert PR 回滚本政策，不重写用户历史、不清理用户目录。
不自动合并、部署、发送企业微信消息、访问正式人员接口或写生产库；不改变开关、资源上限、唯一 Ticket Core 和任何现场批准。
