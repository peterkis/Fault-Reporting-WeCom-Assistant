# 基线、交接与历史适用范围

本页从重构前 AGENTS 提取交接与历史记录。日期、计数、被测 SHA 和授权继续只约束原对象，不成为新候选的新 PASS。任务当前状态先读 `plans/current_phase.json`、[架构基线](../architecture_baseline_status.md)及其引用的 Evidence；43票人工工作台另读[最终验收导航](../../plans/admin-workbench-integration/execution/all43-final-review.md)。

本次复盘和文档重排不推进 P2-G2-LIVE、P2-008、P2-G3 或 P3，不改变默认关闭及具名批准边界。

## 具名交接入口

P2-016 完成或交接核验时，读取 `evidence/p2-016-ticket-lifecycle-workbench-report.md` 与 `evidence/p2-016-project-owner-approval.md`。P2-012 交接时读取 `evidence/p2-012-human-confirmed-incident-report.md`、`evidence/p2-012-project-owner-approval.md` 与 `evidence/p2-012-targeted-live-validation.md`。P2-012 已完成，PR #6 七个提交由 8c332710dad9b6cf3f6796f3344c04d1c710ddf3 合并。P2-G2交接先读取 `evidence/p2-g2-automated-readiness-report.json`、其中 `source_evidence` 指向的当前矩阵和独立审查，以及 `prompts/P2-G2_rule_first_service_loop_runbook.md`；核对当前候选，不沿用旧现场批准。P2-G2 授权与停止线见 `evidence/p2-g2-start-authorization.md` 和 `tasks/P2-G2_rule_first_service_loop_gate.md`。所有 Feature Flag 默认关闭，P2-G2-LIVE/P2-008 保持停止线。

## 2026-09-15 与 2026-09-11 原记录

以下两段保留原有适用日期；09-11 的“尚未证明”不覆盖09-15已证明的定向事实，09-15的局部事实也不升级完整现场 Gate。

2026-09-15 当前增量：ADR-0019 身份映射修补及 ADR-0020 定向建单模式本地验证完成，1056/1056、171测试文件及两轴独立审查通过。当前候选见 plans/current_phase.json 的 p2_g2_current_readiness（creation-v2 报告）。mapping-v1 的1053/1053与下文PR #8的1044/1044均为历史快照。A/B官方转换对应已证明；定向建单启动及工单结果以本次独立运行证据为准，A/B本人读取、他人拒绝及退出后新OAuth恢复已验证，云端已回退OAuth-only；多标签及旧Grant卡片现场未运行，结论见evidence/p2-g2-yxx-targeted-live-summary.json；完整P2-G2-LIVE/P2-008继续停止。

2026-09-11 P2-G2-YXX-TICKET-ENTRY 本地实现与隔离自动化完成：当前候选1044/1044、166测试文件及两轴独立审查通过。PR #7的976项仅为历史输入；交接先读 `evidence/p2-g2-yxx-entry-report.json`、父就绪报告及 `docs/runbooks/yixiaoxiu-member-ticket-entry.md`。真实身份对应仍未证明（IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING），定向现场及P2-G2-LIVE未授权/未运行，P2-008继续阻断。

## V1.4 完成态与现场停止线原记录

V1.4 不改变 G0/P1 已完成事实。P2-G1 于 2026-09-02 更新为 `PASSED`；ARCH-005、P2-007、ARCH-006 与 P2-015 已于 2026-09-03 完成；P2-016 已于 2026-09-04 完成。P2-012 已于 2026-09-07 经真实定向现场、现场后与完成态全量回归、客户端确认和负责人批准完成。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。P2-G3 及以后 Gate 和全部 P3 未启动。所有 Feature Flag 默认关闭。上述状态均不等同于 Phase 2 Go、生产上线、临床上线、最终生产前端或 AI 自动回复批准。

原 Phase 2 段的 `IN_PROGRESS` 与上述完成/停止线并存；其重复交接内容已合并到本节，业务先后顺序和全部约束保留在[开发边界](development.md)。

## 历史审查及收口规则

## Git 历史相关审核：先确认被审对象

涉及 `tested_head`、祖先链、merge-base 或“证据与提交历史不一致”的审核，必须先区分已发布提交与审核环境临时重建的快照。详见 [历史审查规范](../../.github/review/README.md)。

- 权威 `expected_head` 必须取自 GitHub 本次 PR 事件或审核元数据的完整 SHA，不得使用本地 `HEAD` 自证，也不得把未知临时 SHA 称为已发布提交。
- 在完整、干净的 checkout 执行 `node .github/review/verify-published-history.mjs --expected-head <权威完整SHA>`。GitHub merge preview 还须显式传入同一事件的 `--expected-merge` 与 `--expected-base`；不能自行制造单父提交代替。
- `REVIEW_CHECKOUT_IDENTITY_MISMATCH`、浅克隆、replace/graft 或对象缺失属于审核环境/对象来源未确认。应获取本次权威提交的完整历史再验证；不能直接由该环境推导已发布 PR 存在 P1 祖先链缺陷。无法获取时如实说明本项未验证，继续检查其他可验证代码问题。
- 预检通过只表示历史身份核验通过，永远不是 readiness/验收通过。固定历史复现或发布认证必须继续执行原命令 `node scripts/validate-yxx-self-service.mjs --require-ready`；在身份确认后的真实发布对象上出现的断链或验收失败仍须报告并修复。
- 禁止为了通过审核修改 `tested_head`、接受“同 tree 即合法祖先”、跳过祖先断言、伪造 PASS、重写旧证据或把临时快照的父提交改造成发布事实。真正 squash/rebase 改写交付历史时仍须保留真实被测祖先或重新生成证据。
- 仅增加审核工具/文档的后继提交不等于候选源变化；不得仅因 PR head 前移就重绑已正确记录的被测提交。候选内容、完成态和原严格门禁仍按原实现核验。

本规则是审核对象来源核验，不是忽略历史问题或免除业务测试的规则。

## 审查收口与后续开发

真实可复现缺陷继续修复；已修复问题用当前适用证据收口；同一发布对象已验证正确的重复意见只作说明，不自动修改源码或生成新候选。处理重复意见、决定重跑范围或规划证据减量时，先读 [历史审查规范](../../.github/review/README.md) 的“审查结束条件与后续减量”。外部回复仍须用户授权。

PR #19 保留 r7，不因本次对象错配生成 r8。后续优先交付具体业务能力和补齐已授权的运行验证；新增验证机制须指出具体风险及现有测试缺口。历史证据保护与现场授权边界继续生效。
