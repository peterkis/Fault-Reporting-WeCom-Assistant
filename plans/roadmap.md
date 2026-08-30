# V1.4 分阶段路线图

- 当前阶段：P1 / P1-012 / IN_PROGRESS
- 长期事实源：Unified Ticket Core
- P3 前提：没有历史业务 Ticket，采用绿地内网接入

```text
Gate 0 企业微信能力验证（DONE）
→ Phase 1 企业微信外网试点（IN_PROGRESS）
→ Phase 2 Conversation Center 与 AI 协作
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
P2-G1 Human-only Conversation Center
→ P2-G2 AI Shadow
→ P2-G3 Copilot + Media + Incident
→ P2-G4 Controlled Auto + Phase 2 Go
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

1. P1-012 完成前不得启用生产 P2/P3；
2. P2 必须先 Human-only；
3. AI 自动回复必须独立 Gate；
4. P3 先 Contract 和 Simulator，再真实来源；
5. P3 不建设历史 Ticket 兼容；
6. 每条来源可独立关闭，不影响 Unified Ticket Core；
7. 2C4G 资源门槛贯穿所有 Gate。
