# SS-009 PR19 第二版验收证据

状态：**IMPLEMENTATION_AND_AUTOMATION_COMPLETE / SS009_LOCAL_VERIFICATION_COMPLETE**。本轮冻结候选完整回归、两轴独立审查、证据绑定、八个既有验证器、20 类实际篡改检查及严格入口全部通过。当前候选远端 Codex review 仍待请求与返回，不能将本地结果称为远端批准。

源码提交：`8f2270878fdab62ef6ecd2c49dcebca1521e8a0c`；tree：`d5646ba43e3874c41d50d2a8baa23c8fee1050b7`。
当前候选指纹：`674127ee770f471bad3c50e55ad276f05730f55cbe6bd2e024dffae4a642ba62`。

## 两项 P2 修复

- **AC-022 / discussion_r4051497527**：原映射仅验证空库升级和目录，未证明既有 Bot 数据保留。新测试在 032 上通过原 Bot orchestration 建立四个群聊/单聊 Intake，覆盖 Inbox、Intake、消息关系、事件、Journey、Leg、Decision、Action、Review、Ticket、Message、Outbox、Delivery 共 13 张非空表。记录全部 032 原有列；check 回滚、应用 033/034、重复应用后逐行比较，再验证关联 JOIN 和原命令重放。实际删除既有关联行的临时 mutant 被断言拒绝。
- **AC-039 / discussion_r4051497529**：原立即抛错测试只能证明人工兜底。新事务包装夹具在实际 SAVEPOINT 内更新 Intake summary，并在当前事务观察到该写入后让规则抛错；真实 rollback 后原值恢复，接受事实保留，唯一兜底 Decision/Review 提交，重放不重复。临时 mutant 跳过实际 rollback 后被原值比较断言拒绝。该写入仅为测试故障注入，不声称生产规则引擎会写数据库。
- 矩阵绑定两条精确新测试及 catalog/fault 专用收据；严格校验拒绝缺少“已填充 Bot 图升级”和“实际部分写入回滚”的证明。

## 证据边界

当前严格入口与 binder 使用 `evidence/yxx-ss-009-r2-*`，旧 `yxx-ss-009-*` 运行、审查、报告、失败诊断保持原字节，作为旧候选快照。旧完成报告不再充当当前候选完成依据。测试源码变更后重新运行原完整入口，不以旧全量替代本轮验证。

针对性验证为 8/8；预期 RED 分别为关联丢失、缺少 rollback、旧校验器接受缺失 populated-upgrade 收据。它们的原始输出与实际 GREEN 分别保留。

原入口完整回归为 **1178/1178、191 个文件、exit 0**，fail/cancelled/skipped/todo 全为 0，运行期间候选未变化；上一候选全部 190 个文件均仍覆盖，历史 183/171 覆盖保留。两种 profile 的 500 报修、2000 补充、100 审核、32 并发读及十二路同命令竞争均通过。13 份本轮清理收据的登记资源残留为 0。390/1440 真实浏览器截图已查看，显示合成报修及同一已关闭 Ticket。

本轮 AC-022 的原始收据记录 4 个 Inbox/Intake/消息关系/Journey/Leg/Decision，9 个 Intake Event、9 个 Action、1 个 Review、2 个 Ticket，以及各 1 个旧 Bot Message/Outbox/Delivery；既有行值和关联保持，重放不重复。这些是隔离夹具内的 Bot 排队产物，不是 Web 外发或真实发送。AC-039 收据记录实际部分写入已观察、已回滚，最终保留 1 个兜底 Decision 和 1 个 Review。

本轮 SPEC/STANDARDS 对同一源码提交、指纹及完整执行分别审查，未解决 P1/P2 为 0。两份原始记录明确审查当时发布门禁尚待执行；随后实际执行的门禁由独立收据证明。20 类变造全部被拒绝，正向对照通过，临时 worktree 移除；其中旧提交不存在当前矩阵的 git 错误是预期拒绝诊断。严格入口最终 exit 0，未授予现场许可或推进父 Gate。

## 当前证据入口

- `yxx-ss-009-r2-report.json`：本轮候选、原始运行、矩阵及审查引用。
- `yxx-ss-009-r2-acceptance.json`：AC-001～090 PASS；AC-091～102 仍 NOT_RUN，其中 SS-011 未授权。
- `yxx-ss-009-r2-full.tap`、`full-run.json`、`full-cases.jsonl`：本轮原始执行，按完整文件名前缀定位。
- `yxx-ss-009-r2-catalog.json`、`yxx-ss-009-r2-fault.json`：含本次两项新增真实数据库证明。
- `yxx-ss-009-r2-spec-review.json`、`yxx-ss-009-r2-standards-review.json`：两轴实际结论与修复对应。
- `yxx-ss-009-r2-strict-negative.json`、`yxx-ss-009-r2-strict-validation-receipt.json`：实际负向/严格门禁结果。
- `yxx-ss-009-r2-publication-audit.json`：新增证据敏感信息扫描、旧发布证据保护及 `.gitignore` 字节/index 核验。

不修改业务 Runtime、001–034 迁移或持久开关。原 202 来源的历史语义限制保留；不扩大为正式 2C4G、自然 GC 或 60 分钟现场认证。SS-010 仍 PLANNED，SS-011 仍 NOT_AUTHORIZED，父 Gate 与 P2-008/AI/真实发送停止线不变。

本轮只创建自有隔离数据库与验证资源。此前因自动审批拒绝删除而保留的 `tmp/ss009-pr19-history-verification` 克隆为预存诊断资源，本轮不再尝试删除；不能把该目录宣称为已清零。
