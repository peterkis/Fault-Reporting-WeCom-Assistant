# 医院信息故障智能报修助手 Agent 开发包 V1.2

本仓库的唯一有效架构基线为 V1.2。权威状态见 `docs/architecture_baseline_status.md`。

## 当前阶段

- 当前处于 `G0：企业微信 WebSocket 能力验证`；
- `G0-001` 尚未开始；
- 未通过 Gate 0 前不得进入 Phase 1。

## Phase 1：企业微信外网试点

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

Phase 1 不依赖医院内网系统，不直连医院 Tickets。Pilot Ticket Core 是公网试点期的工单事实源，用于验证临床接受度、可靠受理、处理闭环和通知效果。

## Phase 2：AI 增强

OCR、规则、分类和字段抽取均为异步增强。AI 失败不能影响消息保存、建单或通知，也不得直接操作生产系统。

## Phase 3：医院融合

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

Phase 3 完成映射、迁移、对账和切换后，由 Hospital Tickets 成为唯一长期工单事实源。禁止长期保留 Pilot Ticket 与 Hospital Tickets 两套并行事实源。

## 核心原则

- AI 不是工单入口；
- 消息必须先保存，再确认；
- 明确报修必须可靠受理；
- Channel Message、Service Intake、Ticket、Incident 必须分层；
- 所有消息必须幂等；
- 所有状态变化必须产生事件；
- 所有通知必须经过可靠 Outbox/Delivery 机制；
- 不允许跨阶段提前开发。
