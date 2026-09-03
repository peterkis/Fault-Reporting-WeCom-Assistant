# ADR-0017：AI 可选、规则优先的完整服务闭环

- 状态：Accepted
- 日期：2026-09-03
- 架构任务：ARCH-006
- 依赖：P2-G1、ARCH-005、P2-007
- 取代：P2-G2 以 AI Shadow 作为完整人工服务闭环前置项的旧顺序

## 背景

P2-G1 已证明 Human-only 会话链可用，P2-007 已提供纯确定性目录、别名、规则、Provenance、冲突、澄清和 Incident Candidate。但两者之间仍缺少持久化规则编排、Contact Journey、人工审核、完整 Ticket Action 工作台、Reporter-safe Timeline、事件通知以及真实 Incident 人工确认。若继续把 AI Shadow 放在这些能力之前，模型 Provider 会被错误地塑造成核心服务闭环的结构性前置依赖。

## 决策

规则与人工是主运行路径；模型只提供可关闭、可替换、可降级的增强。以下约束适用于后续全部 P2/P3 任务：

1. 所有 `AI_*` Feature Flag 为 `false` 时，报修识别、人工审核、Ticket 全生命周期、Incident 人工确认和通知必须完整可用。
2. 启动、`base_service_ready`、入站持久化、Ticket Action、Workbench、Incident 和通知不依赖模型密钥或 Provider 网络；`ai_enhancement_ready` 独立报告。
3. AI 输出只能是带 Provenance 的候选事实、摘要、草稿或建议，不能直接创建、修改或关闭 Ticket/Incident。
4. AI 不得绕过 Authentication、Authorization、Generation Fence、TicketActionService、Communication Outbox、Delivery 或人工确认。
5. Provider 禁用、欠费、超时、熔断、非法结果或网络不可达不得造成漏单、重复建单、状态丢失或通知中断。
6. 任一未来 AI Gate 必须再次证明 AI 全关时规则与人工路径仍完整通过。

## 新顺序

```text
P2-G1 Human-only Conversation Center（PASSED）
→ P2-015 规则优先受理编排、跨渠道接触旅程与人工审核
→ P2-016 完整工单生命周期工作台、上报人时间线与可靠通知
→ P2-012 Incident、Reporter Subscription 与人工确认
→ P2-G2 规则优先、人工兜底的完整服务闭环
→ P2-008 / P2-009
→ P2-G3 AI Shadow
→ P2-010 / P2-011
→ P2-G4 Copilot + Media
→ P2-013 / P2-014
→ P2-G5 Controlled Auto + Phase 2 Go
```

P2-008 只有在 P2-G2 `PASSED` 后才可成为下一候选。P2-015、P2-016、P2-012、P2-008 和 P2-G2 均须单独授权；本 ADR 不执行它们。

## 事实所有权

- Channel Message：入站原始事实，先持久化；
- Service Intake：一次服务受理和消息聚合；
- Contact Journey / Channel Leg：跨渠道接触关联，不合并或重写原始 Thread；
- Conversation Assignment：谁负责与用户沟通；
- Unified Ticket Core / Ticket Assignment：谁负责解决故障；
- Ticket Event：Ticket 版本化状态和审计；
- Communication Message / Outbox / Delivery：全部外部通知；
- Incident：只能由 P2-012 在人工确认后创建和推进；
- AI：非权威候选与草稿。

禁止复制第二套 Ticket 状态或所有权。复合命令 `TAKEOVER_CONVERSATION_AND_ACCEPT_TICKET` 可以规划，但两项必须在同一事务全部成功或全部失败。

## 数据库与运行边界

ARCH-006 不创建 SQL，不修改 migration 001 至 022。P2-015 仅保留 migration `030` 号和概念表设计；P2-016 仅在确有新持久化需要时保留 `031`。所有新增 Feature Flag 默认 `false`。

## 后果

- P2-G2 改为确定性完整服务闭环 Gate；
- 原 P2-G2、P2-G3、P2-G4 顺延为 P2-G3、P2-G4、P2-G5；
- Incident 从 AI/Copilot Gate 解耦，在 AI 之前以人工确认完成；
- “90%”仅表示确定性安全路由覆盖率，不表示自动建单率或自动关闭率；
- `MANUAL_REVIEW_REQUIRED` 是合法、安全、可执行的成功路由结果。
