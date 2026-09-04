# V1.4 分阶段路线图

- 当前阶段：P2 / P2-016 / AUTHORIZED / P2-B
- 当前唯一授权任务：P2-016；P2-012、P2-G2、P2-008 仍未授权；P3 / 未启动
- 长期事实源：Unified Ticket Core
- P3 前提：没有历史业务 Ticket，采用绿地内网接入

```text
Gate 0 企业微信能力验证（DONE）
→ Phase 1 企业微信外网试点（DONE / GO）
→ Phase 2 规则优先服务闭环与可选 AI 协作（IN_PROGRESS / P2-015 DONE / P2-016 AUTHORIZED / P2-B）
→ Phase 3 医院内网新来源接入与统一运营
```

| 阶段 | 目标 | Ticket 事实源 | 退出条件 |
|---|---|---|---|
| G0 | WSS、消息、媒体、卡片、主动发送、重连和单活 | 无 | 已完成并冻结 |
| P1 | 可靠受理、Ticket 闭环、通知和真实试点 | 当前 P1 实现 | 漏单0、重复单0、真实客户端证据、Go |
| P2 | Human-only Conversation Center、多轮 AI、媒体、Incident | Unified Ticket Core | Human-only独立可用，AI安全放量，2C4G通过 |
| P3 | 新内网来源、身份、Connector、多来源运营 | Unified Ticket Core | 首条生产内网来源受控接入并通过Go |

## P2 Gates

```text
P2-G1 Human-only Conversation Center（PASSED）
→ P2-015 Rule-first Orchestration + Manual Review
→ P2-016 Full Ticket Lifecycle + Reporter Timeline + Notification
→ P2-012 Human-confirmed Incident
→ P2-G2 规则优先、人工兜底的完整服务闭环
→ P2-008 / P2-009
→ P2-G3 AI Shadow
→ P2-010 / P2-011
→ P2-G4 Copilot + Media
→ P2-013 / P2-014
→ P2-G5 Controlled Auto + Phase 2 Go
```

## P3 Gates

```text
P3-G1 Contract + Outbound Transport
→ P3-G2 First Intranet Source E2E
→ P3-G3 Multi-source Operations + Fault/Security/Reconciliation
→ P3-G4 First Production Source Onboarding + Phase 3 Go
```

## 关键决策点

| 决策点 | 问题 |
|---|---|
| P2-D1 | Conversation Session 的结束和新话题判定 |
| P2-D2 | AI Shadow/Copilot/Auto 的评估门槛 |
| P2-D3 | 媒体和患者敏感数据处理边界 |
| P3-D1 | 第一条内网来源选择 |
| P3-D2 | Connector 协议、mTLS 和凭据管理 |
| P3-D3 | SSO/人员/组织的权威字段与有效期 |
| P3-D4 | 第二类来源 Adapter 的抽象边界 |
| P3-D5 | 第一条生产来源的观察窗口和关闭回退方式 |

## 阶段纪律

1. P1-012 已完成并保留 `GO`；P2-001 至 P2-007、P2-015、P2-G1、ARCH-005、ARCH-006 已完成；当前仅授权 P2-016；P2-012 及后续 Runtime、P2-G2 及以后 Gate 和 P3 仍须另行授权；
2. P2 必须先 Human-only，再完成 AI-off 规则/人工服务闭环；
3. AI 自动回复必须独立 Gate；
4. P3 先 Contract 和 Simulator，再真实来源；
5. P3 不建设历史 Ticket 兼容；
6. 每条来源可独立关闭，不影响 Unified Ticket Core；
7. 2C4G 资源门槛贯穿所有 Gate。
8. 所有 P2/P3 Feature Flag 保持 `false`；P2-008 只有在 P2-G2 `PASSED` 后才可成为下一候选。
