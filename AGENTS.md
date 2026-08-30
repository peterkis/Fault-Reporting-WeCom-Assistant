# AGENTS.md
# 医院信息故障智能报修与统一工单平台开发规范 V1.4

## 1. 唯一有效基线

`AGENTS.md`、`README.md`、`docs/architecture_baseline_status.md` 和 Accepted ADR 共同构成 V1.4 执行基线。冲突时必须先修正文档或新增 ADR，再实现代码。

上一阶段结论固定为：

```text
P1 / P1-012 / DONE / GO
```

当前阶段状态固定为：

```text
P2 / P2-001 / DONE / AWAITING_SEPARATE_AUTHORIZATION
```

V1.4 不改变 G0/P1 已完成事实。项目负责人已于 2026-08-30 独立授权启动 Phase 2，本轮授权的 ARCH-004 和 P2-001 均已完成。当前无活动实施任务；P2-002 及以后任务和全部 P3 任务仍须另行授权。所有 Feature Flag 保持关闭。本授权不等同于生产上线、临床上线或 AI 自动回复批准。

## 2. 长期事实源

本仓库 Unified Ticket Core 是唯一长期 Ticket 编号、状态、责任和事件事实源。

当前 `pilot_ticket.*` 是其第一阶段兼容实现。必须通过 `UnifiedTicketCommandPort`、`UnifiedTicketQueryPort` 和 `UnifiedTicketEventPort` 逐步消除临时命名耦合，禁止复制第二套 Ticket 表长期双写。

## 3. P3 绿地前提

当前没有历史业务 Ticket，也没有需要兼容或退役的旧工单系统。P3 明确禁止把以下内容重新加入范围：

- 历史 Ticket 导入；
- 未完结 Ticket 切换；
- 旧编号、旧状态和旧附件兼容；
- 双系统并行运行；
- 最终增量窗口；
- 旧系统冻结、归档或退役；
- 为不存在的数据设计批量迁移和回滚。

未来内网门户、医院 API、监控告警或其他新入口只能作为新的 Integration Source 接入 Unified Ticket Core。

## 4. 阶段边界

### Gate 0：企业微信能力验证

已完成并冻结。只作为 SDK、WSS、消息、媒体、卡片、主动发送、重连和单活能力依据。

### Phase 1：企业微信外网试点

```text
Enterprise WeCom
→ WeCom Gateway
→ Channel Message
→ Service Intake
→ Pilot Ticket Core compatibility implementation
```

P1：

- 不依赖医院 SSO、人员、组织、内网门户、医院 API 或内网 Connector；
- 不启用生产 AI/OCR；
- 不启用完整 Conversation Center；
- P1-012 真实 E2E 和 Go/No-Go 已完成，Phase 1 结论为 `DONE / GO`。

### Phase 2：Conversation Center 与 AI 协作

P2 已于 2026-08-30 获项目负责人独立授权并进入 `IN_PROGRESS`；P2-A 的 P2-001 已完成。当前无活动实施任务，其他 Lane 只可读取冻结 Contract；P2-002 及以后任务和 P2-G1 组装不得启动，所有 Feature Flag 保持 `false`。

P2 必须按以下顺序：

```text
Human-only Conversation Center
→ AI Shadow
→ Copilot
→ Controlled Auto
```

AI：

- 可完全关闭；
- 不决定明确报修是否受理；
- 不直接修改 Ticket/Incident；
- 不直接调用企业微信 SDK；
- 必须经过脱敏、Schema、Generation Fence 和 Communication Outbox；
- 人工接管后旧结果必须标记 STALE，禁止发送。

### Phase 3：医院内网接入与统一运营

```text
New Intranet Source
→ Intranet Connector
→ Integration Inbox
→ Service Intake / Ticket Command
→ Unified Ticket Core
→ Integration Outbox / Projection
```

P3 只建设面向未来的 Source Registry、身份映射、Connector、内网入口、投影、重放、统一工作台和一致性核验。

## 5. 领域绝对规则

1. 企业微信 Frame 不得成为业务模型。
2. Channel Message、Conversation、Service Intake、Ticket、Incident 必须分层。
3. 明确报修先落库、先受理，AI 后置。
4. AI/OCR 失败不能导致漏单。
5. Ticket 状态只能通过显式 Action 变化。
6. 状态变化必须产生追加式 Ticket Event。
7. 外部可见通知必须经过 Outbox/Delivery。
8. 内部备注不得进入任何外部 Delivery。
9. 所有外部事件和用户命令必须幂等。
10. 外部来源没有 Ticket 状态所有权。
11. 禁止共享数据库直写集成。
12. Redis、SSE 和投影都不是事实源。
13. 群聊 AI 上下文必须按参与者和 Intake 隔离。
14. 不能为不存在的历史数据建立产品主线。

## 6. 2C4G 约束

同机基线：

- App/API/SSE：1 进程；
- Worker：1 进程；
- WeCom Gateway：1 个活动连接；
- PostgreSQL：1 实例；
- AI concurrency：1；
- Communication concurrency：1；
- Integration concurrency：1；
- SSE clients：默认 32；
- 应用数据库连接池总量建议不超过 8。

同机非前置：Chatwoot、Dify、LangBot、Kafka、RabbitMQ、Elasticsearch、Kubernetes、本地 LLM、常驻重型 OCR 和完整 Prometheus/Grafana。

## 7. 并行开发纪律

允许使用独立分支、模拟依赖和关闭状态的 Feature Flag 并行开发：

```text
phase2/conversation-core
phase2/realtime-workbench
phase2/ai-orchestrator
phase2/media-incident
phase3/integration-core
phase3/identity-connector
phase3/intranet-sources
phase3/unified-operations
```

每条 Lane 必须：

- 先冻结输入/输出 Contract；
- 使用独立数据库迁移编号段；
- 使用 Stub/Simulator，不连接真实生产依赖；
- 保持功能开关默认关闭；
- 单独完成 Contract、Unit 和数据库集成测试；
- 只在 Assembly Gate 组装。

## 8. Assembly Gates

### P2

- P2-G1：Human-only Conversation Center；
- P2-G2：AI Shadow；
- P2-G3：Copilot + Media + Incident；
- P2-G4：Controlled Auto + Phase 2 Go。

### P3

- P3-G1：Contract + Outbound Transport；
- P3-G2：First Intranet Source E2E；
- P3-G3：Multi-source Operations + Fault/Security/Reconciliation；
- P3-G4：First Production Source Onboarding + Phase 3 Go。

## 9. 每个任务的完成标准

每个任务必须包含：

- 输入和输出；
- Schema/Contract；
- 数据库变更或明确“无数据库变更”；
- Unit/Contract/Integration tests；
- 安全与隐私检查；
- 资源上限；
- Feature Flag；
- Evidence；
- Rollback 或关闭方式；
- Backlog 状态更新。

禁止把“代码写完”作为完成标准。

## 10. 禁止行为

- 跨阶段连接真实生产依赖；
- 把不存在的历史 Ticket 兼容重新加入 P3；
- 新建第二套 Ticket Core；
- 浏览器或 AI Worker 直接调用 WeCom SDK；
- AI 自动执行生产运维操作；
- 内部备注外发；
- 无期限双写或双状态所有权；
- 以 2C4G 环境为由牺牲入站持久化、人工回复或可靠通知；
- 未通过 Gate 就启用真实内网 Connector。
