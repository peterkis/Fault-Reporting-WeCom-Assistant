# ADR-0010：本系统 Unified Ticket Core 为唯一长期工单事实源

- 状态：Accepted
- 日期：2026-08-30
- 取代：ADR-0007 的外迁终局
- 补充：ADR-0012 明确 P3 为绿地内网接入，不包含历史 Ticket 兼容

## 背景

本项目已经完成 Channel Message、Service Intake、Ticket 编号、显式 Action、追加式事件、Outbox/Delivery、Pilot 权限和关闭重开闭环。继续把它定位为临时系统会浪费已完成的领域资产并造成事实源漂移。

## 决策

```text
Unified Ticket Core in this repository
= 唯一长期 Ticket 编号、状态、责任和事件事实源
```

当前物理实现继续使用：

```text
pilot_ticket.ticket
pilot_ticket.ticket_event
pilot_ticket.resolver_team
pilot_ticket.pilot_principal
notification.outbox / delivery
```

V1.4 不要求立即重命名 Schema，也不创建第二套核心表。

升级顺序：

1. 引入 `UnifiedTicketCommandPort`、`UnifiedTicketQueryPort`、`UnifiedTicketEventPort`；
2. 现有 P1 实现作为默认 Adapter；
3. 新模块只依赖统一 Port；
4. 逐步消除界面和文档中的临时语义；
5. 物理重命名只有在收益明确且回归充分时才单独决策。

## 外部来源定位

未来内网门户、医院 API、监控告警和其他服务入口统一抽象为：

```text
IntegrationSource
IntegrationInbox
ExternalReferenceBinding
IntegrationOutbox
SyncCursor
ReconciliationRun
```

外部来源只提交请求、消息、告警或投影确认，不拥有 Ticket 状态权威。

外部命令路径：

```text
External Event
→ Integration Inbox
→ Authentication / Mapping / Validation
→ Local Service Intake or Ticket Action
→ Local Ticket Event
→ Integration Outbox
→ External Projection / Acknowledgement
```

## 约束

1. 禁止新建第二套长期 Ticket Core。
2. 禁止共享数据库直写。
3. 禁止外部状态覆盖本地 Ticket。
4. 禁止外部编号替代本地 Ticket ID/编号。
5. 所有同步必须幂等、可重放、可审计。
6. P1 当前行为和验收不因本 ADR 自动改变。
7. P2/P3 生产启用必须经过独立 Gate。
8. 不得为不存在的历史数据增加兼容主线。

## 后果

正面：

- 保护 P1 已完成投资；
- 状态、通知、统计和审计口径收敛；
- 支持企业微信和未来内网入口共享同一工单；
- Integration Hub 可以服务新入口而不侵入 Ticket Core。

成本：

- 本项目承担长期备份、升级、权限和运维责任；
- 需要建立稳定 Port、Connector Contract 和一致性核验；
- 需要按 2C4G 约束控制并发与依赖数量。
