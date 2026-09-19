# SS-009 本地验收

本阶段只生成本地自动化候选，不批准 SS-010、SS-011、父 P2-G2 或真实发送。
开始基线是 PR18 合并后的 `375d47b013017edb858206cc5f3475c9aed77dfd`。
父状态、历史证据和 migrations 001–034 保持冻结，所有持久 Feature Flag 默认 false。

## 入口与绑定

- `node scripts/validate-yxx-self-service.mjs`：结构检查，允许 NOT_RUN，不产生 READY。
- `node scripts/p2-g2-synthetic-e2e.mjs --suite=full`：Node24、隔离本地 PostgreSQL、串行、`--expose-gc`。
- `node scripts/validate-yxx-self-service.mjs --require-ready`：仅在当前报告完整后执行，证明 SS009 本地验收。

完整入口同时输出 TAP 和 Node 原始测试事件的安全投影 `cases.jsonl`；后者包含执行文件、名称、行号、结果及 skip/todo。
两份输出都由 run.json 摘要绑定。场景不得靠另一文件的同名测试、注释、测试文件存在或摘要 PASS 取得通过。
测试源码、SQL、契约及 UI 指纹仍沿用原 candidate inventory；报告和台账不纳入源码指纹以避免自引用。
报告绑定源代码提交和 tree；最后的证据提交不在报告内写自身 SHA。

PR #19 后续审查指出 AC-022 与 AC-039 原映射未证明带既有 Bot 关联的升级及实际部分写入回滚。当前验收入口改用 `evidence/yxx-ss-009-r2-*` 后继证据，旧 `yxx-ss-009-*` 报告和运行保留为原候选快照，不再作为当前完成依据。新证据要求迁移前已填充的 032 Bot 图在 check、apply、重复迁移后保持原列值和关系，并能重放原命令；规则失败夹具必须先在 SAVEPOINT 内观察到真实写入，再验证该写入回滚且人工兜底提交。缺少任一实际收据时，严格校验拒绝完成。

随后补齐完成态门禁，当前入口使用 `evidence/yxx-ss-009-r3-*`，r2 亦保留为历史快照。普通 `--require-ready` 同时要求报告 `status=IMPLEMENTATION_AND_AUTOMATION_COMPLETE` 与 `local_verification=PASS`，且仍逐项验证全部原始证据。Binder 的 `LOCAL_AUTOMATION_VERIFIED_PENDING_STRICT_GATE` 状态不能直接通过。`preTamper` 仅用于内部证据准备，返回 `SS009_CORE_EVIDENCE_VALID_NOT_COMPLETE`，不授予完成。

发布顺序为：冻结并完成回归/审查 → Binder 生成待完成报告 → 内部正向对照与 22 类变造验证 → 确认所有证据收口后设置上述完成字段 → 执行普通严格入口。若普通严格入口失败，不能发布完成结论。缺字段、待完成或失败字段均应拒绝，不能通过跳过字段检查解决中断恢复。

当前后继证据为 `evidence/yxx-ss-009-r4-*`，反向验证增至 23 类。SS-009 在默认结构检查、普通严格检查和内部准备检查中，都必须存在且通过 `plans/yxx-self-service-validation-scope.json`。通用读取函数为其他旧调用保留的“缺失返回 null”行为不等于 SS-009 授权；SS-009 调用方必须拒绝该返回值。该作用域负责锁定父阶段、Backlog、项目摘要、迁移和历史证据，删除它不能解除这些保护。新增用例在独立 worktree 删除作用域并篡改父 Gate，要求专用拒绝码；不改真实父阶段或放宽其冻结要求。

### 提交历史与合并方式

`--require-ready` 的输入不仅是文件快照，还包括完整 Git 祖先关系。先通过 GitHub PR 元数据取得实际 `head.sha`，核对本地 `git rev-parse HEAD`；再运行 `git merge-base <报告 tested_head> HEAD`，结果必须等于报告中的 `tested_head`。浅克隆须先补全所需历史；只有补全后仍不满足祖先关系，才是发布历史绑定不匹配。不能把另一个临时提交的结果归到 PR HEAD。

本候选若要沿用现有证据，后续经独立授权合并时必须保留被测提交的祖先链，例如使用 merge commit；不能直接 squash/rebase 后仍宣称当前报告可复现。仓库启用某种合并按钮不等于该方式适用于本候选。若明确选择改写历史，须先撤销当前候选完成声明，针对改写后的被测提交重新生成并审核证据，再发布完成状态；禁止仅修改 `tested_head` 或删除祖先断言。

审查系统若将变更重建为一个直接以基线为父的提交，该快照会按设计被严格模式拒绝。这不证明实际已发布分支具有同样的父链，也不授予快照 READY。应分别报告“快照无法验证”和“实际 PR HEAD 的验证结果”，用完整克隆及 GitHub commit/compare 数据定位差异。GitHub 的 `refs/pull/<编号>/merge` 可用于只读检查预期合并结果，其 checkout 不代表执行 PR 合并。生产或现场许可仍须另行取得。

## 迁移校验修复

SS009 的真实 PG 负向测试证明原片段匹配可接受弱化的 CHECK。
新目录契约从不可变 033/034 分别应用到隔离 032 基线得到，覆盖三辅助表和全部受影响共享表的列、约束、索引及关系属性。
033 中间态与 034 最终态显式区分；不存在“两个快照任一匹配就通过”的最终态降级。
校验器变更不修改迁移 SQL，也不添加新迁移。

## 容量与夹具根因

两个 profile 分别执行 500 报修、2000 补充、100 审核、32 并发读和另一次十二路同命令竞争。
共享规则为高风险明确故障先创建最小 Ticket 并保留人工审核，不应把人工审核项都视为无 Ticket。
数据组为 200 普通明确故障、100 待描述、50 高风险、50 明确要求人工跟进的投诉、100 非报修。
审核对无 Ticket 的 50 项批准成单，对已有最小 Ticket 的 50 项进行审核分类处理；最终另加并发对照受理，总计 501 root、2501 source/receipt、301 Ticket。

早期 FULL 夹具错误使用非 `p2_015_g2…` 名称，Worker 的自有数据库保护拒绝启动；修复仅调整自有库命名。
之后统一 60 秒等待在 FULL 不适用：原 Worker 每 250ms 为 Web 保留一项，500 个 root 的完整处理约需至少 125 秒。
失败时约65秒处理252项、余248项，Worker 健康且 failure_count=0。
独立 SPEC 预审确认采用180秒排空总限加10秒无进展拒绝是夹具修正；整体360秒上限、负载及断言不变。
此结论不是性能 SLA，也不构成2C4G、自然GC或60分钟现场证明。

## 资源与保留

App pool<=4、Worker<=2；未启动 Gateway 时记0，控制器 pool 单独列示。
仅强制终止自有测试子进程或所属隔离库 backend，绝不停止共享数据库服务。
数据库、进程、浏览器和 profile 均由 finally 清理；失败日志、TAP、截图和原运行目录保留诊断。
原始外部身份、真实患者资料或 secret 不进入公共输出；模拟 Provider 调用与真实网络调用分别记录。
