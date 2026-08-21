# ADR-0005：公共故障使用 Incident，不采用简单时间类别并单

- 状态：Accepted
- 日期：2026-08-20

## 决策

多个申报通过 Incident 关联。禁止“5分钟 + 同类别”直接自动合并。

## 原因

同一 HIS 类别可能同时存在登录、打印、数据和接口问题。错误并单会隐藏独立故障并损害审计。

## 后果

- 每个 Intake 保留；
- 增加 IncidentReport 和 Subscription；
- 初期人工确认；
- 自动关联需 Precision ≥ 99% 和可回滚。
