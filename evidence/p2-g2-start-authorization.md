# P2-G2 独立准备授权

- 日期：2026-09-08（Asia/Shanghai）。
- 来源：项目负责人要求完整执行 `P2-G2_Rule_First_AI_Off_Service_Loop_Complete_Codex_Prompt_v1.0.md`，本轮只形成授权提交和就绪候选提交，停在 `READY_FOR_LIVE_E2E`；随后明确回复“确认快进”。
- Prompt SHA-256：`84c09484345d20dedfa64a3ee7e2d3c9c58a9e0cfaeb0b84e51bbb18a63e5551`；864 行，完整读取。原文件位于仓库外的项目目录。
- 唯一冻结 merge commit：`8c332710dad9b6cf3f6796f3344c04d1c710ddf3`。
- 冻结 tree：`def07645be24d966a0e5110348dea517975734de`。
- PR #6 被审查 Head：`7767138ce1084ce03a3482f30cd31a523c8417f3`；PR 实现历史共七个提交，保留不重写。
- 分支：`phase2/gate-p2-g2-rule-first-service-loop`。

## 开始门禁

初检位于旧 P2-012 分支，HEAD 为被审查 Head，本地 main 为 `30a394e85973f5a300b841b23d2c358998796ba6`；fetch 后 origin/main 为冻结 merge。工作区与索引干净，但未满足 Prompt §3.1，实施暂停。负责人确认后，以旧 main 值作 compare-and-set，并先检查祖先关系，仅快进本地 main 引用，再从冻结 merge 创建 Gate 分支；未执行 merge、reset、stash、push 或 tag。

快进后的 HEAD/main/origin/main 均为冻结 merge，ahead/behind=0/0，工作区与索引干净。`phase-p2-012-complete-v1.5` 不存在，记 `MISSING_MILESTONE_TAG`；按 Prompt §3.2 使用完整 commit/tree 继续，不创建标签。冻结状态的 V1.4 403 checks、ARCH-006 260 checks 实际通过，exit=0。

本机实测 Windows 11 10.0.26200、Node 24.18.0、16 逻辑处理器、15.72 GiB 内存。此开发环境不是 2C4G 证明。既有 Node/PostgreSQL 进程不归本 run 所有，保留不动。云主机尚未连接或验证。

## 授权与停止线

`P2_G2_ASSEMBLY_AUTHORIZED` 仅授权：Gate 治理、契约与矩阵、能力链路盘点、有限装配修复、隔离数据库自动化、Mock Provider 三角色/HTTP/浏览器验证、候选冻结、现场工具和运行手册。

明确授权的修复接缝：`REQUEST_ONE_DESCRIPTION` 创建私人 Communication 前复用既有 `hasMatchingDirectLeg` / `personDestinationAuthorizer` 只读 Port，并贯通 Runtime、App、Worker；Gateway 继续独立复核。首条合规单聊入站不得要求已有 Direct Leg。无 Leg 的群输入仍持久化并最多一次群安全引导；PERSON Message/Outbox/Delivery/Grant 和 Provider PERSON call 均应为零。查询错误按既有事务/人工兜底路径可见，不伪装成永久无资格。

其他有限修复须先保存失败测试、最小路径和兼容性影响，只修参数/安全策略注入、重复装配、已实现查询/静态资产的契约或刷新连线。领域/数据库结构缺口记 `BLOCKED_BY_DOMAIN_GAP`，不得扩展实现。

无数据库结构变更；migration 001–032、P2-007 Runtime/语料/阈值、权威 Ticket/Incident 状态机和历史 Evidence 冻结。隔离自动化只在本 run 创建并拥有的测试库应用既有迁移；配置库与现场库不迁移、不写入。所有持久 Feature Flag 保持 false。

本轮不授权真实企业微信发送、云主机变更、现场数据库写入、正式 60 分钟观察、负责人验收批准或 P2-G2 关闭；不启动 P2-008/P3，不 push、PR、merge、tag 或 release。用户所指 `.env.pilot` 云配置仅是未来单独授权现场的目标来源，密码不输出、不入 Git。

## 验证边界与提交策略

测试接缝已由 Prompt 明确指定：真实 Inbox/Intake、规则 Worker/Safe Action、Manual Review、Ticket/双责任、人工 Incident/Subscription、Communication/Delivery、Reporter HTTP/浏览器、三角色故障与资源、许可和 Gate evaluator。观察持久差量与 Provider 调用，保留失败→通过；不更改冻结金标或弱化断言。

577 是冻结起点的历史回归数；最新历史命令带 `--expose-gc`。本候选须完整运行所有原测试和新增用例，fail/cancelled/skipped/todo=0。模型 Key 不进入子进程，AI/OCR/RAG 关闭。短时合成测试可调用 GC，不替代整个服务栈 2C4G、自然 GC、连续至少 3,600,000 ms 的单次正式现场证据。

1. `chore(p2): authorize P2-G2 rule-first service-loop gate`：仅治理、授权 Evidence、任务卡和对应架构检查；P2-G2 IN_PROGRESS。
2. `feat(p2): prepare P2-G2 AI-off service-loop validation`：自动化通过后冻结候选并再次检查；P2-G2 READY_FOR_LIVE_E2E，下一候选 P2-G2-LIVE 未授权。完成后停止。

不生成现场 PASS、Owner Approval 或第三个完成提交。历史 P1 GO、P2-G1 PASSED、P2-012 DONE 和完成日期保留。

## 说明性旧文案纠偏

AGENTS 的“唯一第二个本地提交”、架构状态顶部旧 P2-D Lane，以及 docs 48/50/51/52 中旧未授权说明均是早期阶段描述，与冻结 merge 的七提交历史及当前账本不一致。本授权仅同步现态说明或明确其历史时点；不修改旧完成 Evidence、测试数字、Owner Approval 或真实能力。

## 授权提交验证

V1.4 407 checks、ARCH-006 262 checks、治理测试24/24，所有子进程exit=0，fail/cancelled/skipped/todo=0。原有577测试尚未在本Gate重跑，不能将治理检查当作全量通过。日志：`evidence/p2-g2-authorization-checks.txt`，SHA-256 `89dcaa516e29a570246f3ddd2ecdf8d546f79443d672e8efab36693c7f5355f9`。

旧Validator尚未认识新授权状态时，23项中19通过/4失败（exit1）；`evidence/p2-g2-authorization-profile-red.tap`，SHA-256 `35b410f8c0855d1400176dd662fa584a35f64e62e36307d9d11f22793ba184d9`。修改仅新增精确授权/就绪状态及门禁，未减少原测试；当前为24/24。

提交前 diff --check 检出 RED TAP 中 Node 断言输出的空白行尾，未形成提交。仅对入Git副本规范化换行/行尾空白，原始文件保留在本run忽略目录；规范化副本SHA-256 `212f9b27c8aed497e375cfbf0d6b4e76470fb7a4f29550d1d7b59d4de0ef1221`。不修改失败结论。
