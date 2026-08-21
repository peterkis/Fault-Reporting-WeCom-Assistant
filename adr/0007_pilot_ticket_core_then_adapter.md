# ADR-0007

## 决策
由于企业微信外网试点阶段无法直接访问医院内网Tickets，
允许建设独立Pilot Ticket Core。

## 约束
- 不长期形成双工单体系；
- 领域模型独立；
- 保留ticket_external_mapping；
- 正式阶段通过Adapter融合医院Tickets。

## 原则
快速验证业务价值，避免基础设施阻塞创新验证。
