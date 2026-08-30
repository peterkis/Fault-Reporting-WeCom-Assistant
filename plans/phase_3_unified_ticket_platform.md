# Phase 3：Unified Ticket Platform 医院内网绿地接入

## 阶段目标

在 P2 完成后，将现有 Ticket Core 通过稳定 Port 正式提升为 Unified Ticket Core，并接入新的医院内网门户、医院 API、监控告警和身份组织能力。

当前没有历史业务 Ticket。P3 不包含历史导入、未完结切换、旧系统兼容或退役。

## 固定架构

```text
New Intranet Portal / Hospital API / Monitoring Alert
                         ↓
              Intranet Connector Agent
                         ↓
                  Integration Inbox
                         ↓
       Service Intake / Authorized Ticket Action
                         ↓
                Unified Ticket Core
                         ↓
          Integration Outbox / Projection
```

## 进入条件

- P2-014 完成；
- UnifiedTicket Port 已稳定；
- 第一条内网来源的业务责任人、接口责任人和数据边界明确；
- 网络、mTLS、身份和审计方案获批；
- 真实数据处理审批完成；
- 2C4G 云端容量基线通过。

## 并行 Lane

| Lane | 内容 |
|---|---|
| P3-A | Unified Ticket Facade、Source、Inbox、Outbox、Binding、Cursor、Reconciliation |
| P3-B | Identity Binding、Intranet Connector、mTLS、网络边界 |
| P3-C | Intranet Portal、Hospital API、Monitoring Adapter |
| P3-D | 多来源 Workbench、投影、运行状态和阶段验收 |

## 任务总览

| ID | 标题 | Lane | 依赖 | Gate |
|---|---|---|---|---|
| P3-001 | Pilot Ticket Core 兼容升级为 Unified Ticket Core Facade | P3-A | P2-014 | P3-G1 |
| P3-002 | Integration Source Registry 与版本化契约 | P3-A | P2-014 | P3-G1 |
| P3-003 | Integration Inbox、幂等、重放与隔离失败队列 | P3-A | P3-002 | P3-G1 |
| P3-004 | Integration Outbox、External Binding、Cursor 与 Reconciliation | P3-A | P3-001, P3-003 | P3-G2 |
| P3-005 | 医院 SSO、人员、组织、院区与处理组映射 | P3-B | P3-002 | P3-G2 |
| P3-006 | 医院内网 Connector Agent、mTLS 与断点续传 | P3-B | P3-003, P3-005 | P3-G1 |
| P3-007 | 内网报修门户 Source Adapter | P3-C | P3-004, P3-005, P3-006 | P3-G2 |
| P3-008 | 医院 API、监控告警与未来来源 Adapter Template | P3-C | P3-004, P3-005, P3-006 | P3-G3 |
| P3-009 | 多来源统一 Workbench、查询与 Connector 状态 | P3-D | P3-004, P3-007, P3-008 | P3-G3 |
| P3-010 | 外部投影、ACK、通知去重与来源运营 | P3-D | P3-004, P3-007, P3-008 | P3-G3 |
| P3-011 | 故障、安全、容量、重放与一致性核验演练 | ASSEMBLY | P3-009, P3-010 | P3-G3 |
| P3-012 | 第一条生产内网来源接入与 Phase 3 Go/No-Go | ASSEMBLY | P3-011 | P3-G4 |

## Gates

### P3-G1 Contract + Outbound Transport

- Contract Version 冻结；
- mTLS、签名、Source-scoped 凭据；
- Connector Cursor/Spool；
- 模拟 Receiver E2E；
- 不连接真实生产来源。

### P3-G2 First Intranet Source E2E

- 选择一条新的内网报修来源；
- 请求提交、本地 Intake/Ticket 创建、编号返回和状态投影完整通过；
- 重复事件不重复建单；
- 身份映射失败可隔离和重放；
- Connector 中断后可续传。

### P3-G3 Multi-source Operations + Fault/Security/Reconciliation

- 第二类 Source Simulator 或受控测试来源；
- 多来源 Workbench；
- 网络分区、证书撤销、进程终止、事件乱序和 ACK 丢失；
- 2C4G 积压恢复；
- 运行时一致性核验无未解释差异；
- 外部投影不覆盖本地 Ticket。

### P3-G4 First Production Source Onboarding + Phase 3 Go

- 第一条真实内网来源获批并小范围启用；
- 生产身份、网络、安全、备份和运维验收通过；
- 观察窗口通过；
- 关闭 Source 即可回退，不影响企业微信和 Unified Ticket Core；
- 业务、安全和运维负责人批准 Go。

## 退出条件

- Unified Ticket Core 保持唯一正式 Ticket 事实源；
- 企业微信和首条内网来源查询同一 Ticket；
- Source、Connector、Inbox、Outbox、Binding 和 Cursor 可审计；
- 重复事件不重复建单；
- 外部投影不产生重复用户通知；
- 故障后可重放；
- 身份和附件边界通过；
- 第一条生产来源完成受控接入。
