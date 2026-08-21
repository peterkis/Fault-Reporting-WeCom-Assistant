# ADR-0003：引入 Service Intake

- 状态：Accepted
- 日期：2026-08-20

## 决策

在 ChannelMessage 与 Ticket 之间引入 Service Intake。

## 原因

一次报修可能包含多条文字、图片和补充；消息不等于工单。Intake 可保存原始受理证据、身份、位置和 AI 结果。

## 后果

- 增加 `service_intake` 和消息关系表；
- 需要 90 秒上下文聚合；
- Phase 1 Pilot Ticket 保存 `source_intake_id`；Phase 3 通过外部映射传递该追溯关系；
- 补充信息不再新建工单。
