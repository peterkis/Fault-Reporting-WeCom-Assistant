# ADR-0012：P3 采用绿地内网接入，不建设历史 Ticket 兼容

- 状态：Accepted
- 日期：2026-08-30
- 补充：ADR-0010
- 取代：V1.3 中关于历史 Ticket 导入、未完结切换和旧系统退役的 P3 设计

## 背景

项目当前处于起步开发阶段，只完成 Gate 0 和 Phase 1 目标，没有历史业务 Ticket，也没有需要继续使用的旧工单系统。为不存在的数据设计迁移、兼容和切换会增加无效表结构、任务、测试、运维流程和安全面。

## 决策

P3 固定为绿地建设：

```text
New Intranet Source
→ Intranet Connector
→ Integration Inbox
→ Service Intake / Ticket Command
→ Unified Ticket Core
→ Integration Outbox / Projection
```

P3 首个生产目标是接入一条新的医院内网来源，而不是导入历史记录。

## P3 明确非目标

- 历史 Ticket 导入；
- 未完结 Ticket 迁入；
- 旧编号、旧状态、旧事件或旧附件兼容；
- 双系统并行期；
- 最终增量窗口；
- 旧系统冻结、归档、退役；
- 面向历史数据的批量迁移、差异修复和回滚。

## 保留的通用能力

`ExternalReferenceBinding`、`SyncCursor`、`ReconciliationRun` 仍保留，但用途仅是：

- 新来源的幂等关联；
- 断点续传；
- 外部投影确认；
- 运行时一致性核验；
- 故障后重放与审计。

它们不得演化为历史工单迁移框架，除非未来出现真实业务需求并重新通过 ADR。

## 后果

- P3 范围显著缩小；
- 数据模型不再包含迁移批次、最终切换或旧系统生命周期字段；
- P3-G2 改为第一条内网来源 E2E；
- P3-G4 改为第一条生产来源接入和阶段 Go/No-Go；
- 后续若产生真实历史数据需求，必须以新的证据和 ADR 重新立项，不能默认恢复旧设计。
