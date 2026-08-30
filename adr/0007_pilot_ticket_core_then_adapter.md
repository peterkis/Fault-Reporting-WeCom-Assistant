# ADR-0007：公网 Pilot Ticket Core，Phase 3 通过 Adapter 融合医院 Tickets

- 状态：Superseded
- 日期：2026-08-21
- 取代者：ADR-0010、ADR-0012

## 历史说明

该 ADR 曾规划将 Pilot Ticket Core 在后续阶段迁往另一个医院工单系统。当前项目事实已变化：本系统自身是长期 Unified Ticket Core，且项目尚无历史业务 Ticket，也没有需要兼容、迁移或退役的旧工单系统。

## 仍然有效的原则

- P1 保持零医院内网依赖；
- Channel Message、Service Intake、Ticket、Incident 保持分层；
- Adapter 必须隔离外部契约；
- 外部事件必须幂等、可重放、可审计；
- 禁止共享数据库直写。

## 已失效内容

- 把其他工单系统作为最终 Ticket 事实源；
- 历史或未完结 Ticket 的兼容与导入；
- 双系统切换和旧系统退役；
- 面向旧数据的状态、编号和附件映射。

当前执行依据见 ADR-0010 和 ADR-0012。
