# TypeScript 迁移 · T00 政策与基线

**状态：POLICY_BASELINE_RECORDED；T00 必要基线已实际记录，最终自审、Codex 复审与合并状态以 PR #24 为准。**
本次只执行用户授权的 T00；T01 及以后未开始。运行源码、依赖、SQL、历史 Evidence、现有 workflow 和业务阶段状态均不修改。

## 1. 读取顺序与事实源

先读根 [AGENTS.md](../../AGENTS.md)、[技术栈](../../docs/03_technology_stack.md) 和
[ADR-0026](../../adr/0026_typescript_strict_incremental_migration.md)，再读取以下本批文件：

| 文件 | 用途 |
|---|---|
| [baseline.json](baseline.json) | 外部获取的 main SHA、tree、计划与归档来源、2072 个文件的内容核对 |
| [scope.json](scope.json) | 181 个命名目标、34 个文件批次、G0 和现有脚本保留边界 |
| [test-routing.json](test-routing.json) | 207 个测试入口、42 个支持文件、宿主分类初稿；不是可执行路由 |
| [baseline-tests.json](baseline-tests.json) | 固定的 17 个测试文件选择集及本轮实际结果 |
| [progress.json](progress.json) | T00 基线已记录；其余批次 PLANNED，T01 未开始 |
| [receipts/T00.json](receipts/T00.json) | 本轮完整 SOURCE_HOST 执行及原失败回执的精确引用 |

上游交付包：`WeCom_TypeScript_Migration_Plan_v1_20260927.zip`，其 SHA-256 与两份提示词摘要记录于 baseline.json。
完整原计划未复制进仓库，以避免把 39 份提示词和所有历史清单重复当成实施产物；后续仍从该 ZIP 的 `prompts/00_DISPATCHER.md`、对应阶段提示词及 `tools/verify_baseline.py` 读取。解压在仓库外，记该根目录为 PLAN_ROOT。

权威起点是 GitHub main `9cb71da1370781670faedbc5a24668720e8df0be`，tree `42201d12279dc9c95b64912f13cc72284388c514`。
本批内容盘点使用 PR #23 最终 CI 的 `fe69cac7...` 源码归档；全部 Git blob 和 tree 与 main 一致。
最初归档只证明文件内容一致；本轮另外在完整 Git checkout 执行了原计划核验器及原历史身份预检，未用同 tree 冒充祖先。用户本机和生产服务器未被访问。

## 2. 当前已完成与未完成

已准备政策、181 个精确迁移目标和 legacy 清单，核对 160 个 npm scripts，以及 207 个测试入口的静态分类。
`tests/` 下 247 个 MJS 中，205 个为测试入口、42 个为支持文件；再加 `.github/review/` 下 2 个测试入口，合计 207。
G0 不是全部脱离运行：`g0-002-sdk-lifecycle.mjs` 的 logger 仍在 Gateway 链路中，T05 必须验证其窄类型边界。

### 本轮已补齐的执行

验证运行 [36359328367](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36359328367)；被测 PR 提交为 `ae296330e742cffd810094d46c79c64acc6f05ce`，不是承载只读验证工具的 `bb042ddd...` 提交。
完整结果与原始日志 SHA-256 见 [verification/T00-baseline.json](verification/T00-baseline.json)。

| 检查 | 实际结果 |
|---|---|
| 原计划工具：原 main exact / PR descendant | 均 exit 0；完整历史，工作树干净 |
| 原发布对象身份预检 | exit 0，仅身份/祖先，不是 readiness |
| Node24/PG18 的 17 文件选择集 | 59 + 6 + 23 + 6 + 2 = 96/96，零失败、零跳过 |
| 架构检查 | 407 checks，exit 0 |
| 当前原始 --require-ready | exit 1，YXX_VERIFICATION_REJECTED |
| 原 main 的相同 --require-ready | 同样 exit 1；二者内部守卫均 YXX_LOCAL_VALIDATION_SCOPE_INVALID |
| 原 P2-016 独立历史入口 | exit 0；原 8c332710... REF、core.autocrlf=true |
| 隔离资源清理 | 其他数据库和客户端连接均为 0；原 main worktree 已移除 |

当前严格验收的实际结果保留为 **KNOWN_BASELINE_NOT_READY**，不是通过，也不是无环境而跳过。T00 的原任务要求如实记录已存在的非就绪结果，不允许为变绿重写冻结 Evidence、SQL 或验证器。types/build 为 NOT_APPLICABLE_T00。

原会话 Node22 的目录加载失败、离线 ENOTCACHED 和归档无 Git 错误，仍保留在 `ae296330...:plans/typescript-migration/receipts/T00.json` 及原交付包中；这些旧失败没有被重标成通过。本轮必要执行缺口已闭合，96 项目标测试不代表全部 207 个测试入口或生产验收。

验证工具仅位于不合入主线的 `codex/typescript-t00-validation-only` 分支，工作流权限为 contents/read 与 pull-requests/read。它通过 GitHub API 确认 PR head，再独立 checkout 被测对象；无正式密钥、真实 Provider 或写远端能力。本 PR 的 `.github/`、业务源码及原有 CI 均保持零变更。

原始 ZIP：`T00-PR24-baseline-36359328367.zip`，artifact `10945495484`，SHA-256 为 `f5c5c22299a4e557cc1992980e907ab01c3476b4dc1eace639c92552c1eef4c7`。Actions 保留 30 天，已取回用于交接；需要长期复核时保存交付 ZIP，不依赖过期链接。最终记录提交仍须按新的真实 head 复跑并在 PR 回填，不能拿本次旧 head 记录套所有后继提交。

## 3. 复核与后继提交的执行方式

以下是可复用的复核步骤；本轮已执行结果以第 2 节及 verification 记录为准。使用用户批准的隔离 Node24/PG18 环境和完整 Git checkout，不读取真实 .env.pilot、不连接正式 Provider。
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

本目录已记录必要环境基线，未改变原业务 backlog。文档更新后的最终 head 还须完成独立验证与审查，不能由回执自我批准。
自审检查最终 diff 必须仅包含 T00 允许路径；types/build 是 NOT_APPLICABLE_T00，类型逃逸例外保持为空。
提交后绑定实际 GitHub head 及相应 CI；满足 T00 门禁后再发起独立 `@codex review`。自审/外审/合并状态由 PR #24 的真实记录确认，不由本文件预填。

仅在 T00 基线记录完成、独立审查及用户授权合并之后，T01 才以新的 main 为起点。
T01/T02 建立类型管线和测试宿主；T03 起才迁移既有模块。T00 的政策生效不代表编译器已经安装或有自动禁止 JS 的 CI。

## 5. 回滚与边界

未合并时保留草案及日志，不推进下一批。已合并后只通过独立 revert PR 回滚本政策，不重写用户历史、不清理用户目录。
本次用户授权仅在 T00 门禁、自审和 Codex 复审满足后合并 PR #24；未满足条件时不得合并。不部署、发送企业微信消息、访问正式人员接口或写生产库；不改变开关、资源上限、唯一 Ticket Core 和任何现场批准。
