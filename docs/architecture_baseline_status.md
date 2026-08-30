# Architecture Baseline Status

- 基线版本：V1.4
- 生效日期：2026-08-30
- 状态：ACTIVE
- 当前阶段：P2 / IN_PROGRESS
- 当前执行任务：无
- 当前活动 Lane：无
- 最后完成任务：P2-002（2026-08-30）
- 已完成任务：G0 全部冻结项；P1-001 至 P1-012；ARCH-004；P2-001；P2-002
- 当前授权：已授权任务均已完成；等待 P2-003 或后续任务的独立授权
- 下一任务候选：P2-003 / 未授权
- P2-G1：NOT_STARTED
- P2/P3 Feature Flags：全部 `false`
- P3：TODO / 未启动
- 上一基线：V1.3
- 关键决策：ADR-0010、ADR-0011、ADR-0012

## 1. V1.4 变化

V1.4 是 V1.3 的累计修订，保留 Conversation Center、Unified Ticket Core、2C4G 和并行 Gate 设计，同时纠正 P3 范围：

1. 项目没有历史业务 Ticket；
2. P3 不再建设历史导入、未完结切换和旧系统兼容；
3. P3 改为医院内网新来源的绿地接入；
4. Integration Binding、Cursor 和 Reconciliation 仅服务新来源运行一致性；
5. P3-G2 改为 First Intranet Source E2E；
6. P3-G4 改为 First Production Source Onboarding + Phase 3 Go。

## 2. 当前唯一有效架构

```text
Enterprise WeCom / New Intranet Portal / Hospital API / Monitoring Alert
                                ↓
                    Channel / Integration Adapter
                                ↓
                 Durable Inbox + Idempotency + Audit
                                ↓
                  Conversation Thread / Session
                                ↓
                         Service Intake
                                ↓
                      Unified Ticket Core
                                ↓
     Ticket Event + Communication Outbox / Integration Outbox
                                ↓
             WeCom / Workbench / Source Projection
```

## 3. 权威边界

| 事实 | 权威对象 |
|---|---|
| 企业微信原始消息 | Channel Message Inbox |
| 多轮通信和接管 | Conversation Center |
| 一次服务受理 | Service Intake |
| 工单编号、状态、责任和生命周期 | Unified Ticket Core |
| Ticket 状态变化 | Append-only Ticket Event |
| 应发送内容 | Communication/Notification Outbox |
| 实际送达 | Delivery / Attempt |
| 公共故障 | Incident |
| AI 建议与成本 | AI Run / Memory |
| 新来源外部引用 | External Reference Binding |
| 新来源运行一致性 | Integration Inbox/Outbox/Cursor/Reconciliation |

## 4. 当前物理实现

`pilot_ticket.*` 和既有 P1 代码保持可执行。V1.4 通过逻辑 Port 提升为 Unified Ticket Core，不做大爆炸式重命名。

禁止：

- 创建另一套 `unified_ticket.ticket` 并双写；
- 重写既有 P1 迁移历史；
- 以已完成的 P2-002 授权为由启动 P2-003 及以后任务、P2-G1 组装或任何 P3 任务；
- 启用任何 P2/P3 Feature Flag、真实外发、SSE、模型、OCR 或医院内网连接；
- 让外部来源状态覆盖本地 Ticket；
- 引入历史 Ticket 兼容模型。

## 5. Phase 1

固定链路不变：

```text
Enterprise WeCom
→ WeCom Gateway
→ Channel Message
→ Service Intake
→ Pilot Ticket Core compatibility implementation
```

P1 退出条件为：漏单 0、重复单 0、状态/事件/通知一致、真实客户端证据、故障安全验收和负责人 Go。上述条件已于 2026-08-30 全部满足，正式批准见 `evidence/p1-012-project-owner-go-approval.md`。

## 6. Phase 2

P2 已于 2026-08-30 获项目负责人独立授权并保持 `IN_PROGRESS`，Phase 启动 Evidence 为 `evidence/p2-phase-start-authorization.md`。P2-001 已完成，Evidence 为 `evidence/p2-001-conversation-contracts-report.md`；项目负责人随后通过 `evidence/p2-002-start-authorization.md` 正式、独立授权仅启动 P2-002，P2-002 已于 2026-08-30 完成，验证结果见 `evidence/p2-002-timeline-projector-report.md`。当前无活动任务或 Lane；P2-003 及以后任务、P2-G1 组装和其他 Lane 实现仍须另行授权。所有 Feature Flag 保持关闭。

固定顺序：

```text
Human-only Conversation Center
→ AI Shadow
→ Copilot
→ Controlled Auto
```

人工和 AI 回复使用同一 Communication Outbox；Generation Fence 防止过期回复；内部备注不可外发；AI 不直接改 Ticket/Incident。

## 7. Phase 3

```text
New Intranet Source
→ Outbound Intranet Connector
→ Integration Inbox
→ Service Intake / Authorized Ticket Action
→ Unified Ticket Core
→ Integration Outbox / Projection
```

P3 目标：

- UnifiedTicket Port；
- Source Registry；
- Inbox/Outbox/Binding/Cursor/Reconciliation；
- SSO、人员、组织、院区和处理组；
- 新内网来源 Adapter；
- 多来源 Workbench；
- 第一条生产来源接入。

P3 非目标：历史导入、未完结切换、旧编号/状态/附件兼容、双系统切换、最终增量和旧系统退役。

## 8. 2 核 4GB

必需：Node.js 24、PostgreSQL、一个 App/API/SSE、一个 Worker、一个活动 WeCom Gateway、可选 Nginx。

非前置：Chatwoot、Dify、LangBot、Redis、MinIO、Kafka、RabbitMQ、Elasticsearch、Kubernetes、本地 LLM、常驻重型 OCR、完整监控栈。

## 9. 并行开发

架构上定义八条 Lane，P2-A 的 P2-001 与 P2-002 已完成，当前无活动 Lane。其他 Lane 只能读取冻结 Contract。P2-003 及以后任务和 P3 均未获授权，所有 Feature Flag 默认关闭，且不得提前启动任何 Assembly Gate。

## 10. 已废弃设计

1. 其他工单系统成为最终事实源；
2. 历史 Ticket 导入和未完结切换；
3. 旧状态、旧编号和旧附件兼容；
4. 双系统并行、最终增量和旧系统退役；
5. P2 只做 AI/OCR 而无人工通信控制面；
6. Chatwoot/Dify/LangBot 成为第二事实源；
7. 浏览器或 AI Worker 直连 WeCom SDK；
8. 内外网共享数据库直写。

## 11. 文档权威顺序

1. `AGENTS.md`
2. 本文件
3. Accepted ADR
4. `plans/current_phase.json`
5. `plans/master_backlog.json`
6. 阶段计划与任务明细
7. Contract / Schema / Config
8. 其他文档和 Evidence

## 12. 应用基线

本次 P2-002 独立授权以提交 `a30dced5fc62fa62ace1ebe1b86cd765f9f73310` 为工作基线。旧 P3 文件保留为 Superseded 指针，避免自动化引用失效；其内容不能作为任务来源。
