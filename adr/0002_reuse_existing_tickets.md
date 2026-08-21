# ADR-0002：首期直接复用现有 Tickets

- 状态：Superseded
- 日期：2026-08-20
- 取代者：ADR-0007
- 取代日期：2026-08-21

## 原决策

原计划不建设试点工单核心，由企业微信项目通过内部 API 直接使用医院现有 Tickets。

## 废弃原因

Phase 1 是企业微信外网试点，无法把医院内网 Tickets、SSO、Hub 或院内 Outbox 作为可用依赖。继续执行原决策会阻塞试点，并与 V1.2 阶段边界冲突。

## 当前有效决策

- Phase 1 使用独立 Pilot Ticket Core；
- Phase 1 不直连医院 Tickets；
- Phase 3 通过 Ticket Adapter 对接 Hospital Tickets；
- Phase 3 切换完成后，Hospital Tickets 成为唯一长期工单事实源。

当前决策详见 ADR-0007。本 ADR 仅保留历史追溯，不得作为实施依据。
