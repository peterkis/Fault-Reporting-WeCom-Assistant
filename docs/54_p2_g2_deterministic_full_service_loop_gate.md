# 54. P2-G2 规则优先、人工兜底的完整服务闭环 Gate

## 1. 状态与依赖

- 状态：`IN_PROGRESS / P2_G2_ASSEMBLY_AUTHORIZED`
- 准备结果（2026-09-09）：`READY_FOR_LIVE_E2E`；954/954全仓、两轴独立审查、202来源分账和37项矩阵均已绑定当前候选。源报告 `evidence/p2-g2-automated-readiness-report.json`；真实现场与负责人Gate批准为NOT_RUN。
- 独立授权：`evidence/p2-g2-start-authorization.md`；本轮任务：`tasks/P2-G2_rule_first_service_loop_gate.md`。准备完成即停在 READY_FOR_LIVE_E2E，现场另行批准。
- 依赖：`P2-G1`、`ARCH-005`、`P2-007`、`P2-015`、`P2-016`、`P2-012`
- 要求：全部 AI/OCR Flag 关闭；模型 Provider 调用为 0

ARCH-006 只定义本 Gate，不启动或执行它。

P2-016、P2-012 已独立收口为 DONE；其历史定向现场与本 Gate 分别记账。本 Gate 于 2026-09-08 获准备授权；正式通过仍须本候选独立现场批准、真实 2C4G 整栈、自然 GC 下至少 60 分钟完整闭环观察及负责人验收。577 历史回归使用 --expose-gc，不能替代正式资源证据。

## 2. 功能覆盖

1. 三入口 `GROUP_MENTION_INLINE`、`GROUP_MENTION_TO_DIRECT_GUIDED`、`DIRECT_ORGANIC` 全部先持久化；
2. 十类确定性结果均有金标、Provenance、稳定 reason code、可执行下一步和失败降级；
3. `MANUAL_REVIEW_REQUIRED` 队列 100% 可达；
4. Workbench 可完成全部既有 Ticket Action，并在刷新后与 Ticket/Event 事实一致；
5. Conversation Assignment 与 Ticket Assignment 分离；并发接单最多一人成功；Handoff/Transfer 全留痕；
6. Reporter-safe Timeline、群安全回执、主动单聊和模板卡片满足权限、幂等与隐私边界；
7. Incident Candidate 可自动产生，但真实 Incident 必须人工确认，错误关联可解除，个人 Ticket 不删除；
8. 所有外部通知经 Communication/Outbox/Delivery；发送失败不回滚 Ticket，ACK 不明不盲目重发。

## 3. 指标

```makefile
persist_before_route = 100%
deterministic_safe_route_coverage >= 90%
explicit_incident_report_missed = 0
clinical_high_risk_missed = 0
real_fault_auto_ignored = 0
unsupported_root_cause_confirmed = 0
manual_review_reachable = 100%
determinism_mismatch = 0
model_provider_calls = 0
internal_note_leak = 0
automatic_incident_creation = 0
```

覆盖率分母为经人工标注且有效的全部医院运维测试输入；分子为与金标一致地进入十类一等结果之一、满足安全约束并产生明确可执行下一步的输入。人工审核计入安全成功路由。禁止解释为“90% 自动建单”或“90% 自动关闭”。

## 4. Ticket / UI 场景

必须真实 UI 覆盖：

```text
NEW → QUEUED → ACCEPTED → IN_PROGRESS
→ WAITING_REQUESTER → IN_PROGRESS
→ WAITING_VENDOR → IN_PROGRESS
→ RESOLVED → CLOSED
→ REOPENED → IN_PROGRESS → RESOLVED → CLOSED
```

另覆盖 `QUEUED/ACCEPTED → CANCELLED`、并发接单、版本冲突、转派、用户拒绝解决、自动关闭、发送失败；全部 Ticket Action 可经 UI 完成，刷新后一致，状态通知恰好一次，失败可重试且不盲目重发。

## 5. AI-off / readiness

在以下同时成立时完整 Gate 仍通过：

```text
AI_TRIAGE_ENABLED=false
AI_CONVERSATION_ENABLED=false
AI_AUTO_REPLY_ENABLED=false
OCR_ENABLED=false
DeepSeek Key 不存在
模型网络不可达
```

`base_service_ready=true` 不依赖 `ai_enhancement_ready`；后者可以为 false。必须以真实 PostgreSQL、批准的真实企业微信测试范围、至少 60 分钟 controlled observation、2C4G、无 OOM/无界队列/Timer/Socket/Pool 残留和项目负责人批准完成 Gate。

## 6. 后续 Gate

- P2-G3 `AI Shadow`：依赖 P2-G2、P2-008、P2-009；只产生后台结果，不参与核心状态。
- P2-G4 `Copilot + Media`：依赖 P2-G3、P2-010、P2-011；Incident 不依赖此 Gate。
- P2-G5 `Controlled Auto + Phase 2 Go`：依赖 P2-G4、P2-013、P2-014；仍须重复 AI-off 完整闭环证明。

## 7. 现场前冻结的证据顺序与观察规则

准备阶段的纯判定器测试不产生实际 Gate PASS。正式记录必须绑定当前候选、同一现场 run、独立源事实验证和启动批准文件；输入绑定无效时返回稳定错误，不构造无候选身份的 GateResult。

就绪和2C4G核验、候选完整回归须先于观察。观察结束后依次完成只读对账、资源清理核对、最终完整回归及负责人批准。同一条完整对账/清理记录必须同时满足内容和时间条件，禁止用旧内容与新的空记录拼接。三入口、人工审核、处理、通知、Incident和恢复验证所需现场收据及客户端观察必须落在该观察窗口。

只有相邻两个样本都处于三角色就绪的STEADY状态时，其间隔才累计为有效观察时长；FAULT/RECOVERY及相邻转换区间不计入60分钟。首尾须就绪，稳定区间角色uptime须随物理时间连续推进。F01仅允许Gateway断连/不可用；F02仅允许App或Worker单角色重启；F03允许数据库故障导致Worker未就绪，不能据此豁免其他角色丢失。故障不得超出预先批准范围。

现场业务须贯穿观察。首次现场前固定最大业务活动间隔为15分钟（包含窗口两端），由可验证的现场业务收据证明；这是测试执行节奏约束，不是服务响应SLO，不能用心跳或单纯等待填满。采样仍为15秒，最大采样间隔严格小于30秒；sample_gap必须为有限数值。每个入口须有先持久化、后路由的自动化事实，出现相反事实即阻断。
