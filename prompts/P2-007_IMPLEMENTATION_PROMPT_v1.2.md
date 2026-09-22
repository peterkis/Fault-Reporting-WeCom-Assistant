# P2-007 完整实施 Prompt v1.2

你正在处理仓库：

```text
D:\Projects\Fault-Reporting-WeCom-Assistant
```

外部决策包：

```text
D:\Projects\Fault-Reporting-WeCom-Assistant_P2-007_hospital-it-domain-decisions_v1.2
```

当前分支：

```text
phase2/ai-orchestrator
```

冻结基线：

```text
358d9f69392141401c4ca3b7ba46294541d2a696
phase-p2-g1-passed-v1.4
```

============================================================
一、本轮授权边界
============================================================

项目负责人仅授权执行 P2-007：

- 医院 IT 服务目录与别名；
- 确定性规则；
- 对话结构化字段；
- Fact Provenance；
- 冲突处理；
- 多渠道 Entry/Contact Journey/Channel Leg 契约；
- 人员身份与 Profile Snapshot 契约；
- Incident Candidate；
- Notification Recommendation / Ticket Card ViewModel；
- 脱敏固定语料和纯函数测试。

本轮不授权：

- P2-008 / DeepSeek / 任何模型调用；
- OCR；
- 真实企业微信组织目录网络调用；
- 真实群回执、主动单聊或 template_card 发送；
- Reporter Portal；
- 真实 Incident / ReporterSubscription；
- Ticket 状态修改；
- 数据库 Migration；
- P2-G2；
- push / merge / tag / release。

所有 Feature Flag 必须保持 false。

============================================================
二、开始门禁
============================================================

执行：

```powershell
git branch --show-current
git status
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git rev-parse "phase-p2-g1-passed-v1.4^{commit}"
git rev-list --left-right --count origin/main...HEAD
git diff --check
```

要求：

- 分支 `phase2/ai-orchestrator`；
- 初始 HEAD、origin/main、标签均为 `358d9f69392141401c4ca3b7ba46294541d2a696`；
- 工作树干净；
- P2-G1=PASSED；
- last_completed_task=P2-006；
- last_completed_gate=P2-G1；
- P2-007 未授权；
- P2-G2=NOT_STARTED；
- 全部 Feature Flag=false。

不满足立即停止，不猜测修复。

============================================================
三、必须读取的权威材料
============================================================

仓库：

```text
AGENTS.md
CONTEXT.md
docs/domain-modeling/conversation-context-reference.md
README.md
MANIFEST.json
project_summary.json
plans/current_phase.json
plans/master_backlog.json
plans/parallel_workstreams.json
plans/phase_2_ai_enhancement.md
tickets/P2_ai_enhancement_tasks.md
docs/architecture_baseline_status.md
docs/33_conversation_center_and_handoff.md
docs/40_p2_004_unified_communication.md
docs/41_p2_005_assignment_handoff_generation_fence.md
docs/42_p2_006_realtime_web_workbench.md
evidence/p2-g1-project-owner-approval.md
```

`CONTEXT.md` 提供全项目业务词汇；`docs/domain-modeling/conversation-context-reference.md` 保留既有 Conversation Center 技术定义与变更前置要求，两者必须一起阅读。涉及投影/重建、实时回放、通信、控制、受理编排或工单命令时，继续读取参考文件指向的对应实现文档。其中历史阶段/验收状态不作为当前 readiness 依据，当前状态按架构基线、Accepted ADR 和当前计划核验。

外部包：

```text
README.md
SOURCE_BASIS.md
DOMAIN_REVIEW_CHECKLIST.md
repository_increment/adr/*
repository_increment/docs/*
repository_increment/evidence/*
repository_increment/config_examples/*
repository_increment/contracts/*
repository_increment/tests/fixtures/p2-007/*
```

四份原始群聊不得复制进仓库，也不得进入测试快照、日志、Prompt 或 Evidence。

============================================================
四、提交 1：P2-007 独立授权
============================================================

只更新治理状态和授权 Evidence，形成：

```text
chore(p2): authorize P2-007 service catalog and rules
```

提交 1 不得包含 src、contracts、config_examples、tests、数据库或外部包资产。

终态应暂时为：

```text
phase=P2 / IN_PROGRESS
last_completed_task=P2-006
last_completed_gate=P2-G1
active_task=P2-007
active_lane=P2-C
next_task_candidate=P2-007
next_task_authorized=true
implementation_authorization_status=P2_007_AUTHORIZED
P2-G2=NOT_STARTED
all feature flags=false
```

============================================================
五、导入 v1.2 决策资产
============================================================

提交 1 后，从外部包运行：

```powershell
D:\Projects\Fault-Reporting-WeCom-Assistant_P2-007_hospital-it-domain-decisions_v1.2\install\install-v1.2-increment.ps1 `
  -RepoPath D:\Projects\Fault-Reporting-WeCom-Assistant `
  -Apply
```

如目标文件已存在且内容不同，停止并做语义合并，禁止强制覆盖。

============================================================
六、必须实现的核心语义
============================================================

## A. 人员身份

```text
canonical person key = internal SYSTEM_PERSON_ID
current profile authority = WECOM_DIRECTORY
WeCom userid = external identity binding
lookup failure = accept intake and defer
snapshot at report time = true
multiple departments = supported
future person master = add binding, no destructive rekey
```

P2-007 只能定义 Port/Contract 和 Mock，不得真实调用企业微信目录。

## B. 三种入口

```text
GROUP_MENTION_INLINE
GROUP_MENTION_TO_DIRECT_GUIDED
DIRECT_ORGANIC
```

origin_channel 不可变，current_channel 可变。

## C. HYBRID 跨渠道关联

Provider Context 用于回调去重、同渠道回复和传输证据；continuation_ref 是跨渠道权威关联。

禁止：

```text
same userid + nearby time = same fault
```

多个开放 Journey 时必须产生 ASK_USER_TO_SELECT，不自动选最近一条。

## D. 分段描述

- 每条消息先持久化；
- 纯函数增量归约；
- 防抖 3–15 秒；
- P1 90 秒窗口不能充当 Direct Session 强制分界；
- 一次只问一个高信息量问题；
- 记录 failed workaround，避免重复建议；
- 明确否定优先于旧推断。

## E. Ticket 建立建议

明确技术故障可推荐“尽早创建最小 Ticket / WAITING_USER”，但 P2-007 不直接创建或修改 Ticket。

## F. 多坐席审计

复用 P2-004/P2-005 事实，建立只读 lifecycle audit view；不创建第二套 Assignment/Handoff/Delivery 所有权。

## G. Incident Candidate

- 阈值只触发人工复核；
- human_confirmation_required=true；
- automatic incident creation/linking/broadcast=false；
- reporter 按 internal person_id 跨渠道去重；
- 实际 Incident 属于 P2-012。

## H. 通知推荐

P2-007 只输出 Recommendation/ViewModel，不发送：

```text
GROUP_RECEIPT
DIRECT_GUIDANCE
TICKET_CREATED_CARD
TICKET_STATUS_CARD
INCIDENT_INTERNAL_ALERT
INCIDENT_GROUP_NOTICE
INCIDENT_PRIVATE_NOTICE
```

群强 @ 必须保持 UNVERIFIED。

工单卡片：

- `template_card / text_notice`；
- 四位尾号只展示；
- Ticket commit 后才 eligible；
- Timeline 用 opaque ref + authentication；
- current sender capability=IMPLEMENTATION_PENDING。

============================================================
七、安全与确定性
============================================================

所有不可信对象：

- 只接受 ordinary plain JSON；
- 拒绝 Proxy、accessor、symbol、toJSON、非普通 prototype、循环与污染键；
- 限制文本、数组、深度和节点数；
- stable canonical JSON/hash；
- 同输入、同目录/规则版本结果一致；
- 错误码不带原文、userid、chatid、token、IP、患者、Cookie、Secret。

continuation_ref：

- 原值不进普通日志；
- 落库契约只含 token_hash；
- reporter/bot-bound；
- 单用途、过期、撤销和消费；
- 不是身份认证凭证。

============================================================
八、数据库边界
============================================================

默认不创建 migration 030。

配置、Schema、pure functions 和 fixtures 足以完成 P2-007。若发现真实持久化必须前置，停止并报告，不擅自建表。

============================================================
九、测试
============================================================

必须纳入并通过外部包 64 条 fixture，另外覆盖：

- duplicate ID / alias / rule；
- config drift；
- malicious JSON；
- Unicode normalization；
- key ordering；
- continuation wrong reporter/bot/expired/replay；
- multiple open journeys；
- directory deferred；
- reporter dept vs occurrence location；
- fragmented turns and explicit new issue；
- Incident thresholds and cross-channel reporter dedupe；
- candidate no external notification；
- four-digit suffix not authorization；
- no P2-007 external seam calls；
- 2,000 synthetic turns bounded batch；
- 2C4G no unbounded queue/heap trend。

硬门槛：

```text
privacy leak=0
raw provider identifier leak=0
same-user-time-only false link=0
auto Incident creation=0
auto Ticket linking=0
P2-007 SDK/model/OCR/directory network calls=0
four-digit suffix authorization=0
determinism mismatch=0
```

回归：

```powershell
npm run validate:architecture:v1.4
npm run test:architecture:v1.4
node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs
```

要求 fail/cancelled/skipped/todo 全为 0。

============================================================
十、终态、提交与停止
============================================================

完成后：

```text
last_completed_task=P2-007
last_completed_gate=P2-G1
active_task=null
active_lane=null
next_task_candidate=P2-008
next_task_authorized=false
implementation_authorization_status=P2_007_DONE_AWAITING_SEPARATE_AUTHORIZATION
P2-G2=NOT_STARTED
all feature flags=false
```

形成第二个提交：

```text
feat(p2): implement P2-007 hospital IT service catalog and rules
```

最终严格只有两个本地提交。不得 push、merge、tag、release、启动 P2-008 或 P2-G2。

最终返回：

1. 分支、HEAD、两个提交 SHA；
2. 变更路径；
3. 目录/别名/规则/Schema/fixture 数；
4. 64 条决策测试结果；
5. continuation、identity、Incident、notification 关键断言；
6. privacy / determinism / no-side-effect 结果；
7. migration 030 未创建证明；
8. 全仓测试和 2C4G 结果；
9. 残留检查；
10. 明确声明未启动 P2-008、未接 DeepSeek、未创建 Incident、未外发、未 push。
