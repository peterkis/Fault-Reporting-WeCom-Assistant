# V1.2 最新架构边界说明

完整状态见 `docs/architecture_baseline_status.md`。

## Phase 1：企业微信外网试点

企业微信 IT 助手先在纯外网环境验证临床接受度、消息闭环、服务流程和通知效果，因此建设轻量、独立的 Pilot Ticket Core。

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

Phase 1 不直连或依赖 Hospital Tickets。Pilot Ticket Core 是试点期工单事实源，但不是长期第二套医院工单系统。

## Phase 2：AI 增强

OCR、规则、分类和字段抽取异步增强 Pilot Ticket，不得成为建单门槛。

## Phase 3：医院融合

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

Adapter 负责幂等、映射、迁移、对账和回滚。切换完成后 Hospital Tickets 是唯一长期工单事实源，Pilot Ticket Core 停止形成长期正式工单。

## 核心对象

- Channel Message：企业微信原始消息；
- Service Intake：一次服务受理上下文；
- Ticket：Phase 1 为 Pilot Ticket，Phase 3 切换后为 Hospital Ticket；
- Incident：公共故障；
- Reporter Subscription：通知关系；
- Notification Outbox/Delivery：可靠发送事实；
- Ticket External Mapping：Phase 3 的跨系统可审计映射。

## 禁止

- Phase 1 直接复用医院 Tickets；
- Phase 3 前生产同步医院工单；
- 长期 Pilot Ticket + Hospital Ticket 双事实源；
- 用企业微信消息模型替代业务领域模型；
- 让 AI 决定明确报修是否受理。
