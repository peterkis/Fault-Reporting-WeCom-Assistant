# ADR-0002：复用现有 Tickets 作为唯一工单事实源

- 状态：Accepted
- 日期：2026-08-20

## 决策

不新建第二套 FastAPI 工单系统。企业微信项目增加 Channel、Intake、Incident 和 Notification 能力，通过内部 API 使用现有 Tickets。

## 原因

- 避免双工单编号、双状态和双权限；
- 复用现有 SSO、Hub、Outbox 和管理页面；
- 降低 1—2 人维护负担；
- 统一统计和审计。

## 后果

- 需补齐 Tickets Action API；
- Gateway 不得直接写 Tickets 数据库；
- 现有状态模型需与本规格对齐。
