# Phase 3：医院融合

## 阶段目标

通过 Ticket Adapter 把 Pilot Ticket Core 的试点工单映射、迁移并切换至 Hospital Tickets，最终形成单一长期工单事实源。

## 固定迁移路径

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

## 进入条件

- P2-010 完成；
- Hospital Tickets API、状态、身份、附件、事件和权限契约已提供；
- 切换责任人、窗口、备份和回滚权限已确认。

## 任务总览

| ID | 标题 | 依赖 | 状态 |
|---|---|---|---|
| P3-001 | 盘点 Hospital Tickets 与医院身份契约 | P2-010 | TODO |
| P3-002 | 冻结映射、同步和切换 ADR | P3-001 | TODO |
| P3-003 | Ticket Adapter 契约与 external mapping | P3-002 | TODO |
| P3-004 | 身份、组织与处理组映射 | P3-003 | TODO |
| P3-005 | Hospital Ticket 幂等创建与关联 | P3-003, P3-004 | TODO |
| P3-006 | 状态、事件、备注与附件映射 | P3-005 | TODO |
| P3-007 | 历史 Pilot Ticket 迁移与对账 | P3-006 | TODO |
| P3-008 | 通知归属和事实源切换 | P3-007 | TODO |
| P3-009 | 故障、性能、安全与回滚演练 | P3-008 | TODO |
| P3-010 | 正式切换并终止长期双工单 | P3-009 | TODO |

## 退出条件

- 每个迁移对象都有稳定 `ticket_external_mapping`；
- 创建和同步幂等，对账无未解释差异；
- 状态、事件、人员、附件和通知语义一致；
- 回滚演练通过；
- 新正式工单只在 Hospital Tickets 形成；
- Pilot Ticket Core 历史按批准方案只读或归档；
- Hospital Tickets 成为唯一长期工单事实源。
