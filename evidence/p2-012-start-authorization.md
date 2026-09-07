# P2-012 独立启动授权

- 日期：2026-09-04（Asia/Shanghai）。
- 来源：项目负责人在本任务提供的《P2-012 独立完整 Codex 实施 Prompt》。本轮只授权 P2-012。
- 分支：`phase2/p2-012-human-confirmed-incident`（开始时已存在，未创建其他分支）。
- 基线：`30a394e85973f5a300b841b23d2c358998796ba6`。
- 完成标签：`phase-p2-016-complete-v1.5`。
- 已执行 `git fetch origin`；HEAD/main/origin/main/标签 commit 全部等于基线；ahead/behind=0/0；工作区与暂存区干净；`git diff --check` 通过。
- 机器账本：P2 IN_PROGRESS；P2-015/P2-016 DONE；last_completed_task=P2-016；last_completed_gate=P2-G1；last_completed_architecture_task=ARCH-006；active_task/active_lane=null；P2-012 TODO_REQUIRES_SEPARATE_AUTHORIZATION；next_task_candidate=P2-012；next_task_authorized=false；P2-G2 NOT_STARTED；P2-008 TODO_BLOCKED_BY_P2_G2。
- 所有受版本管理的 Feature Flag 默认 false，enabled 列表为空；当前进程无非 false 的业务开关。未输出任何 Secret 或实际目标。
- 已核对 P2-016 完成报告与项目负责人批准记录；历史 Evidence 不修改。

## 授权后的唯一活动任务

`P2-012 / AUTHORIZED / P2-D`。最后完成任务、Gate、架构任务指针保持 P2-016/P2-G1/ARCH-006；next_task_candidate=P2-012，next_task_authorized=true。

输入为冻结的 P2-007 候选、P2-015 持久 Decision/Manual Review 与现有 Ticket/Channel Leg 引用。实现独立 Candidate Review、人工确认的 Incident、IncidentReport、ReporterSubscription、命令收据、追加事件、Link/Unlink、个人恢复、公共/个人可靠通知、内部 Incident 工作台及 Reporter-safe milestone。

规则与人工是主运行路径。DeepSeek Key 缺失、模型网络不可达、全部 AI/OCR 开关关闭时仍须独立工作；model_provider_calls=0、OCR=0、RAG=0。不创建第二套 Ticket Core、Conversation Assignment、Identity 或 Delivery。

## 迁移与冻结边界

本次明确授权的唯一新增迁移为 `032_p2_012_human_confirmed_incident.sql`。它是 P2-D 针对本任务的编号例外；不改变其他 Lane 的预留编号，不修改 migration 001–031。原则上只允许六张 incident 表和一张 communication.incident_notification_binding；需要第八张业务表时停止报告。不新增 Trigger、持久 Function、Extension、ORM 或 Broker。

P2-007 Runtime、规则、阈值和历史完成 Evidence 冻结。ADR-0015 的 5 分钟与 Runtime 的 correlation_window_ms=120000 只记录漂移，不校准、不重建第二套阈值。cluster_key_hash 不是合并身份，Candidate identity 必须包含 Decision ID 与 result hash。

旧状态摘要与 Incident 图中的混层语义，在本任务文档中按负责人明确要求纠正：REJECTED 属于 Candidate Review，UNLINKED 属于 Report；真实 Incident 保留 LOCAL/BUILDING/CAMPUS/HOSPITAL_WIDE 确认范围。个人恢复与 Incident resolve/close 均不隐式改变个人 Ticket。

既有 P2-015/P2-016 只允许窄且向后兼容的接口扩展，并保留旧行为与回归证据。不得回填旧 Decision、重新解释旧哈希或重写旧 Evidence。

## 提交与现场停止线

第一提交仅为本授权、任务/账本/索引、AGENTS/CONTEXT/README、架构状态及 V1.4 Validator/Test：

`chore(p2): authorize P2-012 human-confirmed incident`

第一提交后先新增能力盘点，再实现 Runtime。完成自动化后只可进入 `READY_FOR_TARGETED_LIVE_VALIDATION`：active_task=P2-012、active_lane=P2-D、last_completed_task=P2-016、next_task_candidate=P2-012-LIVE、next_task_authorized=false。此时不创建第二提交，停止等待负责人明确批准真实测试。

真实测试须另获批准，仅限指定测试群/Reporter/数据库，五个 P2_012 live/send/public/private 审批环境变量全部满足才可执行。测试文案带【P2-012测试】；客户端观察、数据库核验、Provider ACK 与负责人批准分别记账，不能由合成测试代替。

现场通过、至少 15 分钟 controlled observation、负责人批准和最终全仓回归均通过后，才可创建唯一第二提交：`feat(p2): implement P2-012 human-confirmed incident and reporter subscriptions`。

完成后停止。P2-G2/P2-008、其他 P2 Runtime 与 P3 未授权；不得 push、PR、merge、tag、release、生产启用或开启持久 Feature Flag 默认值。自动 Incident 创建、自动 Ticket Link、按同用户时间关联、自动并单/关个人 Ticket 均为 0；群强 @ 不作成功依赖。
