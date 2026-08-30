# V1.2 分阶段路线图

- 架构基线日期：2026-08-21
- 当前阶段：P1（IN_PROGRESS；P1-001 已完成本机受控验收，P1-002 已完成本地 Contract 验收，P1-003 至 P1-011 已完成本机 PostgreSQL 集成验收；P1-012 正在执行真实测试群 E2E 接缝与故障演练。企业微信出站 WSS 不以公网 IP 为前置，注入式 sender/合成卡片仍不构成真实客户端或临床试点证据。）
- 已完成前置任务：ARCH-001 Architecture Baseline Cleanup

## 唯一有效顺序

```text
Architecture Baseline Cleanup（DONE）
→ Gate 0 企业微信能力验证
→ Phase 1 企业微信外网试点 / Pilot Ticket Core
→ Phase 2 AI增强
→ Phase 3 Ticket Adapter / Hospital Tickets 融合
```

## 阶段总览

| 阶段 | 目标 | 工单事实源 | 退出条件摘要 |
|---|---|---|---|
| G0 | 验证真实租户的 WSS、消息、媒体、推送、卡片、重连和单活能力 | 无 | 4小时30分钟稳定运行；能力矩阵和架构结论完成 |
| P1 | 通过企业微信公网控制面完成可靠受理、处理闭环和试点验证 | Pilot Ticket Core | 漏单0；重复建单0；完整状态闭环；通知可靠；试点Go/No-Go；长连接不要求公网入站 IP |
| P2 | 增加媒体、OCR、规则、AI影子分诊、人工修正、Incident候选和指标 | Pilot Ticket Core | AI关闭不影响核心链路；建议可评估；人工可撤销；敏感数据受控 |
| P3 | 通过 Ticket Adapter 映射、迁移和切换到医院工单体系 | 切换前 Pilot；切换后 Hospital Tickets | 对账通过；回滚演练通过；Hospital Tickets 成为唯一长期事实源 |

## Phase 1 固定拓扑

```text
Enterprise WeCom
    ↓
WeCom Gateway
    ↓
Channel Message
    ↓
Service Intake
    ↓
Pilot Ticket Core
```

Phase 1 不依赖医院 Tickets、医院 SSO、医院 Hub 或院内 Outbox。必要身份和处理组配置在 Pilot 范围内最小化实现。

## Phase 3 固定迁移路径

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

Phase 3 必须提供幂等映射、迁移、双向状态约束、对账和回滚方案；切换完成后不得继续形成长期双事实源。

## 阶段纪律

1. 不得跳过 G0；
2. P1 不接入 Hospital Tickets；
3. P2 的 AI/OCR 不进入关键受理路径；
4. P3 前不实现 Hospital Ticket Adapter 或生产同步；
5. 每个任务必须有输入、输出、测试、验收证据和状态更新；
6. 架构变化必须通过 ADR，不能只改代码或聊天结论。

## 关键决策点

| 决策点 | 决策问题 | 依据 |
|---|---|---|
| G0-D1 | 群聊是否必须 @ 机器人 | 真实租户 PoC |
| G0-D2 | 图片/mixed 是否可用 | 真实 Frame、下载和解密测试 |
| G0-D3 | 主动群消息、单聊和卡片表现 | 用户端实测 |
| P1-D1 | Pilot Ticket Core 最小状态、编号和处理入口 | 公网试点闭环需求 |
| P1-D2 | 临时回执、自动关闭和非工作时段策略 | 临床风险与试点规则 |
| P2-D1 | 是否扩大 AI 自动化 | 锁定评估集、风险和审批 |
| P2-D2 | Incident 候选是否允许自动关联 | Precision、可撤销性和审批 |
| P3-D1 | 状态、人员、附件和编号映射 | Hospital Tickets 实际契约 |
| P3-D2 | 切换窗口与 Pilot 退役方式 | 对账、回滚和业务连续性 |
