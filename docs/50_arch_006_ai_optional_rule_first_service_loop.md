# 50. ARCH-006 AI-Optional Rule-First Full Service Loop

> 实施进展（2026-09-04）：P2-015 保持 DONE；P2-016 已经定向现场、回归和负责人批准收口为 DONE；当前无活动任务或 Lane。P2-012 与 P2-G2 仍未授权。本架构完成事实与历史 Evidence 保持不变。

## 1. 基线结论

ARCH-006 把 Phase 2 的主线重排为“规则优先、人工兜底、AI 后置”。ARCH-006 本身只冻结架构；后续独立授权的 P2-015 已完成，但本文件不授权 P2-016、P2-012、P2-008 或任一 Gate。

```text
durable Channel Message
→ Service Intake / 90 秒兼容聚合
→ deterministic rule orchestration
→ Contact Journey + Channel Leg + continuation_ref
→ minimal Ticket or one-question clarification or Manual Review
→ complete Ticket Action Workbench
→ Reporter-safe Timeline + reliable Notification
→ human-confirmed Incident
→ optional AI enhancement
```

三种一等入口：

```text
GROUP_MENTION_INLINE
GROUP_MENTION_TO_DIRECT_GUIDED
DIRECT_ORGANIC
```

群 Thread 与单聊 Thread 永不物理合并。Journey 只持久化业务关联；`continuation_ref` 不能由“同一用户 + 时间接近”替代。多个开放 Journey 必须展示安全摘要让用户选择。

## 2. 核心不变量

- 消息持久化成功后才能分类、提问、建单或发送；
- 明确技术故障即使服务、地点或根因不完整，也进入 `TICKET_ELIGIBLE`，尽早创建最小 Ticket，并可落在 `NEW / WAITING_REQUESTER` 后继续补充；
- “只 @Bot”“在吗”“系统不行”或只有图片进入 `NEEDS_DESCRIPTION`，保留 Journey/Intake，每次只问一个高信息量问题；
- 歧义、冲突、临床高风险或规则无法安全执行时进入一等 `MANUAL_REVIEW_REQUIRED`，不得静默忽略、猜测系统/根因或强行创建 Incident；
- 有活动上下文的“谢谢”追加原 Journey，不新建或自动关闭 Ticket；无活动上下文的问候/感谢可礼貌回应但不建单；
- 天气、闲聊和明显越界请求进入 `OUT_OF_SCOPE`，只返回固定职责说明，不调用外部天气或其他服务；
- 业务政策、操作指导和 IT 服务请求与 Incident 分流；
- AI 结果永远不是受理、Ticket、Incident 或通知的必要条件。

## 3. 权威边界

| 能力 | 权威对象 | 禁止替代 |
|---|---|---|
| 谁与用户沟通 | Conversation Assignment | Ticket assignee 副本 |
| 谁解决故障 | Unified Ticket Core Ticket Assignment | Conversation owner 副本 |
| Ticket 状态/版本 | Unified Ticket Core | UI、P2-007、AI、Incident |
| Ticket 审计 | append-only Ticket Event | Timeline 投影 |
| 外部通知 | Communication Message/Outbox/Delivery | HTTP Route 或 Sender 直接发送 |
| Incident 正确性 | P2-012 人工确认状态机 | P2-007 Candidate 或 AI 相似度 |

Workbench 可同时展示“当前沟通坐席、当前处理工程师、当前处理组”，但不得复制第二套所有权。复合接管/接单命令必须同事务全成或全败。

## 4. Feature Flag 与就绪

新增规划 Flag，默认均为 `false`：

```text
RULE_FIRST_ORCHESTRATION_ENABLED=false
MANUAL_REVIEW_QUEUE_ENABLED=false
TICKET_LIFECYCLE_WORKBENCH_ENABLED=false
REPORTER_TIMELINE_ENABLED=false
WECOM_TEMPLATE_CARD_ENABLED=false
```

继续使用 `INCIDENT_CORRELATION_ENABLED=false`，并保持所有既有 Flag 为 `false`。ARCH-006 不启用任何 Flag。

Readiness 必须拆分：

- `base_service_ready`：数据库、入站、规则/人工、Ticket、Workbench、Incident 人工确认和 Communication 主链可用；不得检查模型密钥或 Provider 网络。
- `ai_enhancement_ready`：只描述已授权 AI 增强的 Provider、配额、网络与策略就绪；失败不得把 `base_service_ready` 置为 false。

## 5. P2-G2 硬指标

```text
消息先持久化                         100%
deterministic_safe_route_coverage   >= 90%
explicit_incident_report_missed     0
clinical_high_risk_missed           0
real_fault_auto_ignored             0
unsupported_root_cause_confirmed    0
manual_review_reachable             100%
determinism_mismatch                0
model_provider_calls                0
```

“至少 90%”正式定义：在经人工标注的医院运维测试集中，至少 90% 的输入能够由确定性规则路由到一个安全、明确、可执行的下一步结果。分子是与人工金标一致且进入本基线十类结果之一、满足安全约束并产生明确下一动作的输入；分母是全部纳入评估且标注有效的输入。人工审核是合法安全结果，不算规则失败。该指标不是自动建单率，也不是自动关闭率。

## 6. 关闭 AI 的强制验收

以下条件必须同时成立：`AI_TRIAGE_ENABLED=false`、`AI_CONVERSATION_ENABLED=false`、`AI_AUTO_REPLY_ENABLED=false`、DeepSeek Key 不存在、模型网络不可达。此时启动、ready、报修受理、人工审核、完整 Ticket Action、Reporter-safe Timeline、Incident 人工确认和可靠通知仍全部通过，模型调用为 0。

## 当前授权状态（2026-09-08）

上文阶段授权描述保留其历史时点；当前 P2-007、P2-015、P2-016、P2-012 已完成。当前仅 P2-G2 / ASSEMBLY 获独立准备授权，执行到 READY_FOR_LIVE_E2E 后停止；真实发送、云主机变更、现场写库、正式观察及 Gate 批准均须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。依据 `evidence/p2-g2-start-authorization.md`；未改变本文件的领域契约或历史完成 Evidence。
