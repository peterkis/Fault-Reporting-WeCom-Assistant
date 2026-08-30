# ADR-0007：公网 Pilot Ticket Core，Phase 3 通过 Adapter 融合医院 Tickets

- 状态：Accepted
- 日期：2026-08-21
- 取代：ADR-0002 的首期直接复用现有 Tickets 决策

## 背景

企业微信外网试点无法把医院内网 Tickets 作为可用依赖，但项目需要先验证临床接受度、可靠受理、状态闭环和通知效果。

## 决策

Phase 1 采用：

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

Phase 3 采用：

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

## 约束

- Phase 1 不依赖或直连 Hospital Tickets；
- Channel Message、Service Intake、Ticket、Incident 保持领域分层；
- Pilot Ticket Core 必须使用稳定业务契约，不能耦合企业微信 Frame；
- 从 Phase 1 起保留可迁移标识；Phase 3 建立可审计的 `ticket_external_mapping`；
- Adapter 必须幂等、可对账、可重放并支持受控回滚；
- 切换完成后停止创建长期双工单，Hospital Tickets 成为唯一长期事实源。

## 后果

- Phase 1 可以在纯外网环境快速验证业务价值；
- Phase 3 必须承担状态、事件、人员、附件和编号映射；
- 旧的“Phase 1 直接复用医院 Tickets”计划、任务、配置和接口说明全部失效。
