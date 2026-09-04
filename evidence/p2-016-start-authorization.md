# P2-016 启动授权 Evidence

- Task：`P2-016`
- 名称：完整工单生命周期工作台、上报人时间线与可靠通知
- 授权日期：2026-09-04（Asia/Shanghai LocalDate）
- 固定起点分支：`phase2/p2-016-ticket-lifecycle-workbench`
- 固定起点提交：`b1b8e4deb14e6290ca45aea12d92baaef4728c11`
- 固定标签：`phase-p2-015-complete-v1.5`
- 授权 Lane：`P2-B`
- 状态：`AUTHORIZED`

## 授权依据与范围

项目负责人明确要求执行 P2-016 独立完整实施 Prompt，并在状态一致性门禁发现漂移后，明确允许把下述历史状态账本纠偏纳入第一个 P2-016 授权提交。

本轮只授权 P2-016：装配既有 P2-015 Manual Review / Contact Journey / Safe Action、P1 TicketActionService、P2-005 Conversation Control、P2-006 Workbench 和 P2-004 Communication，提供 Manual Review REST/UI、完整 Ticket 生命周期和转派、双责任视图、原子接管会话并接单、持久命令幂等、Reporter-safe Timeline 绑定访问会话、群安全回执、主动单聊引导、Ticket Event 通知和 template_card Sender。

本提交仅记录授权与状态一致性，不包含上述 Runtime 实现，不宣称 P2-016 已实现、已验收或已完成。

## 固定前置事实

- `P1 / P1-012 / DONE / GO`；
- P2-001 至 P2-007、P2-015 `DONE`；P2-G1 `PASSED`；ARCH-005、ARCH-006 `DONE`；
- `last_completed_task=P2-015`、`last_completed_gate=P2-G1`、`last_completed_architecture_task=ARCH-006`；
- fetch 后 `HEAD=main=origin/main=phase-p2-015-complete-v1.5^{commit}=b1b8e4deb14e6290ca45aea12d92baaef4728c11`；
- 授权变更前工作树洁净，ahead/behind=`0 0`，`git diff --check` 通过，status 无 archive/。

## Historical ledger reconciliation

发现：`tickets/P2_ai_enhancement_tasks.md` 的 P2-015 章节仍写为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，落后于该文件当前状态摘要、独立任务文件、完成报告和所有机器状态。初次门禁因此停止，未猜测修复。

依据：

- `tasks/P2-015_rule_first_intake_orchestration_manual_review.md` 已记录 `DONE` 和完成日期 2026-09-03；
- `evidence/p2-015-rule-first-intake-orchestration-report.md` 明确记录 Migration 030、Runtime、测试、Validator、完成 Evidence 和 DONE 机器状态已完成；
- 原实现提交：`aa1153881fdf9f692d497b1850feda70c0ed45b8`；
- 原实现标题：`feat(p2): implement P2-015 rule-first intake orchestration`；
- 初次只读架构验证：387 checks 通过；架构回归：14/14，fail/cancelled/skipped/todo 均为 0；
- 历史 P2-015 完成报告记载全仓回归 462/462；这是原完成证据，不是本轮重新运行或重新验收的结果。

判断：该差异属于任务账本漂移（state ledger drift），不属于 P2-015 实现缺失或未完成。本提交仅同步 P2-015 章节的完成状态、日期、完成 Evidence、原实现提交和已实现 Migration 030 的账本描述。P2-015 原完成日期、实现及历史完成 Evidence 全部不变；没有重新完成 P2-015。

## 授权后机器状态

```text
phase=P2 / IN_PROGRESS
last_completed_task=P2-015
last_completed_gate=P2-G1
last_completed_architecture_task=ARCH-006
active_task=P2-016
active_lane=P2-B
p2_015_status=DONE
p2_016_status=AUTHORIZED
implementation_authorization_status=P2_016_AUTHORIZED
next_task_candidate=P2-016
next_task_authorized=true
P2-012=TODO_REQUIRES_SEPARATE_AUTHORIZATION
P2-G2～P2-G5=NOT_STARTED
P2-008=TODO_BLOCKED_BY_P2_G2
all feature flags=false
```

## 提交边界与停止线

第一提交标题：`chore(p2): authorize P2-016 ticket lifecycle workbench`。

第一提交仅限授权 Evidence、当前治理状态/索引/任务文档和架构 Validator/Test；不包含 src/、web/、database/、contracts/、scripts/p2-016*、tests/p2-016*。不修改 P2-015 实现或历史完成 Evidence。

自动化通过后先停在 `READY_FOR_TARGETED_LIVE_VALIDATION`，不标记 DONE、不创建第二提交。真实企业微信发送必须由负责人另行明确配置三项 P2_016 live 审批变量和批准的测试目标、HTTPS origin、URL host allowlist、HMAC Secret；本授权与账本纠偏不代替现场审批、客户端观察或负责人验收。

只有真实现场验证、全部回归和清理通过后，才形成唯一第二提交 `feat(p2): implement P2-016 full ticket lifecycle workbench and notifications`。仍严格只有两个本地提交；不 push、PR、merge、tag 或 release。

P2-012、P2-G2、P2-008、P3、AI/DeepSeek/OCR、真实 Incident/Reporter Subscription、医院 SSO/内网、生产或临床启用均未授权。所有 Feature Flag 提交默认值保持 false；不创建第二 Ticket Core 或第二责任事实源；不修改 migration 001～030。

## 本轮验证

授权状态与账本纠偏后的实际结果：

- `npm run validate:architecture:v1.4`：395 checks，通过；
- `npm run test:architecture:v1.4`：16/16，通过，fail/cancelled/skipped/todo 均为 0；
- 新增章节级一致性断言，以及只在内存中恢复 P2-015 陈旧 TODO 状态的负向测试；验证器明确拒绝该漂移，原文件未被测试修改；
- 显式 allowlist 审查：19 个文件（18 个修改、1 个新增授权 Evidence），禁止路径变更为 0；
- src/、web/、database/、contracts/、P2-015 独立任务文件及原完成 Evidence diff=0；`git diff --check` 通过；
- 提交前再次 fetch 后，固定 HEAD/main/origin/main/完成标签仍一致。

提交后仍须运行 `git diff --check HEAD~1..HEAD` 并核验仅一个本地授权提交、工作树洁净；不以本授权 Evidence 代替 P2-016 实现或现场验证报告。
