# P2-G2 准备阻塞：状态查询与业务咨询缺少安全处理路径

- Preparation result: `BLOCKED_BY_DOMAIN_GAP`。
- Gate lifecycle: `IN_PROGRESS`；尚未达到 `READY_FOR_LIVE_E2E`，没有就绪候选提交或现场批准。
- 冻结起点：`8c332710dad9b6cf3f6796f3344c04d1c710ddf3`。
- 已完成的独立授权提交：`d7311cdbfe30c66f37d22a553a3e8f0e04e27cd1`。
- 停止依据：负责人提示文件 §5.2：**“确需改变领域规则、数据库结构或新增能力才能闭环时：保留已完成工作，记 BLOCKED_BY_DOMAIN_GAP，返回复现、影响、最小独立修复建议。”**

## 实际数据库与 HTTP 复现

执行 `node scripts/p2-g2-route-preflight.mjs --run-local`，Node 24.18.0，本地 PostgreSQL 18.4。Runner 仅从 `.env.pilot` 读取本地数据库连接配置，子进程只接收 OS 白名单和 `PILOT_DATABASE_URL`；不继承旧现场许可或模型密钥。使用现有隔离库生命周期与001–032迁移，没有更改配置库的业务数据或结构。

业务输入全部经现有 `Runtime.assembly.handleFrame → SDK adapter → Inbox.accept → ServiceIntakeProcessor`。坐席身份为测试配置；Message、Intake、Journey、Decision、Review、Ticket 均未直接 seed。正常 Conversation 投影存在，每个输入恰有一个 Session。App 规则调度关闭，显式调用现有 Worker，防止两条测试调度竞争；Gateway/Sender 均关闭。HTTP 使用真实本地服务器与测试坐席鉴权。

| 用例 | 规则结果 | 持久 Action | 对应 HTTP Review | Ticket | 结论 |
|---|---|---|---|---:|---|
| 处方提交不了（对照） | TICKET_ELIGIBLE | 分类、建单 EXECUTED | 无需 Review | 1 | PASS |
| 急诊抢救患者处方提交不了（对照） | MANUAL_REVIEW_REQUIRED | 分类、建单、入队完成 | 可见 | 1 | PASS |
| 工单到哪一步了 | STATUS_QUERY | QUERY_AUTHORIZED_STATUS / PROPOSED | 不可见，DB数量0 | 0 | RED |
| 医保这个规则怎么理解 | BUSINESS_CONSULTATION | ROUTE_BUSINESS_CONSULTATION / PROPOSED | 不可见，DB数量0 | 0 | RED |

每条入站提交后、Worker前均实测 Message=1、Intake=1、Decision=0。两个失败样本均为独立 Reporter 的新单聊，`has_linked_ticket=false`、`profile_resolution_status=DEFERRED`、`requires_manual_review=false`；Action没有结果引用、错误或retryable标记。新建 Worker 实例再扫描 processed=0，Action未变化。这是同进程重建 Worker 对象的恢复检查，**不是三角色进程重启测试**。

最终 RED：四个叶子用例中2通过、2失败；Node把父测试失败另计，TAP总计5 tests / 2 pass / 3 fail / 0 cancelled / 0 skipped / 0 todo，exit=1。`evidence/p2-g2-service-route-red.tap` 和 `evidence/p2-g2-service-route-red-run.json` 保存输出与绑定信息。失败只发生在 `P2_G2_UNRESOLVED_ASSOCIATION_OR_POLICY_REVIEW_REQUIRED`；不能计为Gate通过。

首次试跑使用“无法安全判断”作为人工审核对照，实际分类为 NEEDS_DESCRIPTION，造成一个额外的测试预期错误。保留 `evidence/p2-g2-service-route-attempt1.tap`，不把该错误归因于领域缺口；随后改用明确临床高风险输入，对照通过。第二次保留为 `evidence/p2-g2-service-route-attempt2.tap`；最后增加未关联Ticket/目录DEFERRED的观测和明确契约断言，没有改变产品实现。

## 为什么不是参数漏传

当前有效 `docs/51_rule_first_intake_manual_review.md` 的 STATUS_QUERY 行明确要求“身份或关联不明时”人工审核、无授权时转人工；BUSINESS_CONSULTATION 行要求政策不明时人工审核，不猜政策。`docs/57_p2_015_manual_review_and_safe_actions.md` 要求相关异常建立 `intake.manual_review_item`。`docs/54_p2_g2_deterministic_full_service_loop_gate.md` 要求十类结果都有可执行下一步和失败降级。

实际实现：

- `src/p2-015-decision-router.mjs` 仅建议 QUERY_AUTHORIZED_STATUS / ROUTE_BUSINESS_CONSULTATION，标为 HUMAN_CONFIRM_REQUIRED；只有 MANUAL_REVIEW_REQUIRED 设置审核标记。
- `src/p2-015-safe-action-executor.mjs` 对这两类直接返回 `proposed_only: true`，不调用查询、固定指引、人工转接或 Review Port。
- `src/p2-015-worker.mjs` 已处理完整消息窗口后不再选中该输入，没有独立的这两类 Action 执行器。
- `src/p2-016-manual-review-facade.mjs` 只能处理已存在的 Review；`web/p2-workbench/lifecycle.js` 也依赖该队列。
- `src/p2-006-workbench-command-facade.mjs` 的通用人工 Reply 仍然可用，Conversation Session也确实存在；它只调用 Communication Service，不建立必需的Review或完成上述Action。因此本报告不声称“消息不可见”或“人工完全无法回复”。

搜索 src/web 的全部相关 Action 消费者，未发现可供App/Worker补一个参数就能启用的既有处理器。补授权查询、策略指引，或为这两类增加持久人工降级，将改变现有决策/动作执行语义，超过本次仅限参数、安全策略注入和 §8 Direct Leg 预检的装配修复。

## 最小独立修复建议（未执行）

先独立确定未知关联/政策的安全降级契约：保留来源、分类和幂等键，通过既有 ManualReviewStore 形成可处理的审核；原 Action 的执行结果须指向该审核，失败须回滚或按既有机制可恢复。明确有授权关联的状态查询如何复用权威 Query Port，并测试跨Reporter拒绝、重复消息、并发、规则失败和人工处理完成。不要新增第二Ticket/通信链，也不要默认查询“最近工单”。

现有冻结202条金标包含这两类 `manual_review_expected=false`，仅有分类通过不能证明上述降级满足契约。修复时应保留冻结语料，增加情境明确的新样本；如发现历史金标语义冲突，独立记录并解决，不能在本Gate改金标迎合实现。是否完全无需schema变更须由独立修复设计确认，本轮没有增加Migration033。

## 保留与未完成事项

授权提交和已有历史完成事实保留。当前新增的是局部链路盘点、可重跑的RED诊断及阻塞证据；`p2_g2_status=IN_PROGRESS` 仍表示Gate生命周期，任务卡的 preparation_result 明确为BLOCKED，不是READY或DONE。

未进行 Direct Leg 修复/GREEN、PR #6十条不变量的新候选全量验证、完整三入口/Ticket/Incident/Reporter三进程浏览器矩阵、202金标运行、577全量回归、现场许可/evaluator/资源工具或完整现场运行手册。没有伪造就绪清单，也没有形成第二个feat就绪提交。原577历史回归与本次局部RED分别记账。

本地诊断含 `--expose-gc`，不构成自然GC资源证据；本机16逻辑处理器、15.72GiB，不是2C4G证明。在本地阻塞判定时，真实企业微信、云主机、现场库写入、正式60分钟观察、负责人验收、P2-G2关闭均NOT_RUN，P2-008未启动。

随后负责人补充授权云服务器部署与运维指导。该新增范围单独记录在 `docs/runbooks/p2-g2-cloud-deployment-operations.md` 与 `evidence/p2-g2-cloud-deployment-record.json`：云主机已可只读核实，可进行停止态准备部署；不改变本报告的领域阻塞结论，不构成READY、真实发送或Gate通过。

隔离库在每次测试的finally内删除并核验；最终run的残留 database_count=0、backend_count=0，HTTP服务器已关闭。仅保留本次生成的日志，不删除既有进程、历史证据或其他临时目录。Runtime、Web、Contracts、所有迁移和持久Feature Flag未修改；没有push、merge、tag、release。
