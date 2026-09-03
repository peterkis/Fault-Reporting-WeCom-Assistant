# 37. 并行开发与 Assembly Gate 验收 V1.4

## 1. 原则

P1-012 与 Phase 1 已完成并取得 `GO`。P2-001 至 P2-007、P2-G1、ARCH-005、ARCH-006 已完成。当前无活动 Lane；下一候选 P2-015 未授权。P2-015、P2-016、P2-012、P2-008 及以后 Runtime、P2-G2 至 P2-G5 和 P3 均须另行授权。所有 Feature Flag 默认关闭，完成架构重基线不等同于生产、临床、最终生产前端或 AI 自动回复批准。

## 2. P2 Lanes

| Lane | 架构范围 | 当前授权 |
|---|---|---|
| P2-A | Conversation Core、Timeline、Realtime Event Log | P2-001/P2-002/P2-003 已完成并冻结 |
| P2-B | Communication Outbox、Handoff、Workbench | P2-004/P2-005/P2-006 已完成；P2-016 未授权 |
| ASSEMBLY | P1 与 P2-001 至 P2-006 Human-only 组装 | P2-G1 `PASSED`；当前无活动 Assembly |
| P2-C | Rules、Journey/Manual Review、DeepSeek、Context/Memory | P2-007 已完成；P2-015/P2-008+ 未授权 |
| P2-D | Human-confirmed Incident、Media/OCR、Metrics | P2-012/P2-011/P2-013 未授权 |

### P2-002 独立交付边界

P2-002 只交付可重建的持久 Timeline 读模型：

```text
read-only Source Fact / future fixture
→ normalized safe Source Record
→ Conversation Item + Source Binding
→ Projection Checkpoint
```

- migration 010 继续独占 Thread/Session 的权威物理结构；
- migration 011 只创建 Item、Item Source Binding、Projection Checkpoint 及直接索引/约束；
- migration 021 只创建 Assignment、Handoff、Read Cursor、Control Event 及直接索引/约束；
- 本任务只存在一个命名为 `CONVERSATION_TIMELINE` 的 Projector；
- Source Binding 用 Projector、Stream、Source Type/ID、Variant、Session 完整身份保证幂等；
- 同一 Session 通过数据库 transaction-level advisory lock 分配连续 sequence；
- 只有增量 `projectBatch` 才把 Checkpoint 与相应 Item/Binding 同事务 CAS 推进；Checkpoint
  不是事实源；
- 乱序增量失败为 `CONVERSATION_TIMELINE_REBUILD_REQUIRED`，只能经显式单 Session
  事务 Rebuild 处理；
- 单 Session Rebuild 锁住所涉 Checkpoint Key 与 Session，但保留全局 Checkpoint，返回
  `checkpoint_updated=false`；锁内以完整 Binding identity/hash/privacy/retention fence
  拒绝 stale snapshot，并在提交前核验持久化 Timeline Hash；
- Audience 必须显式声明，External/Internal/Restricted 在数据库查询层裁剪；
- Projector 默认关闭；单 Worker、默认 batch 20、无事务内外部调用。

详细 Contract 和运行协议见 `docs/38_p2_002_timeline_projector.md`。P2-002 已以 39/39
Contract/Unit 和 13/13 PostgreSQL Integration 完成独立验收，包括真实 `SIGKILL`、stale
rebuild race、only-011 CLI 与 2,001 Item 有界批次；完整回归数字、资源和残留检查见
`evidence/p2-002-timeline-projector-report.md`。

### P2-003 独立交付边界

P2-003 只交付 durable Realtime Event Log、SSE replay、授权裁剪、heartbeat、slow-client
隔离、fallback contract 与 retention。它读取 P2-001/P2-002 安全 Contract/fixture，但不自动
连接 Projector；append 支持未来与业务事实同事务提交，SSE 只在 commit 后通过 PostgreSQL 补放。
Wakeup Hub 不携带事件且不是 broker。详细 Contract 见
`docs/39_p2_003_realtime_event_log_sse.md`，执行结果仅以
`evidence/p2-003-realtime-event-log-sse-report.md` 为准。

### P2-G1 Human-only Conversation Center（PASSED）

- 实时查看消息；
- 人工接管、分配和回复；
- 内部备注隔离；
- SSE 重连补放；
- 重复命令不重复发送；
- AI 全关时完整可用。

P2-G1 已在 P2-001 至 P2-006 独立完成后完成自动化 Assembly、真实企业微信 Evidence、
隔离 Replay Gap、60 分钟现场资源观察与项目负责人批准，并于 2026-09-02 更新为 `PASSED`。
该结果不授权 P2-007、P2-G2、生产、临床、AI/Media/Incident 或 P3。

### Assembly Contract 消费（P2-001 至 P2-006 已完成）

- P2-003 已冻结独立 append/replay Contract；P2-G1 未来组装仍不得把 Projection Checkpoint
  当作 `Last-Event-ID`，也不得让 Realtime Event 反向拥有 Timeline。
- P2-004 已在独立授权下提供 Communication Message / Outbox / Delivery 事实，并把
  P2-002 的 fixture Mapper 替换为真实只读 Adapter；Communication 事务不能绕过 Source
  Record/Binding，也不能让 Projector 直接调用 WeCom SDK。
- P2-005/P2-006 只能通过显式 Audience Query Port 读取投影，不得由浏览器参数提升
  Restricted 权限。

这些消费关系现在只在 P2-G1 授权范围内用于 Human-only 组装，不授权 P2-007、AI、Media、
Incident、P3 或任何生产启用。

### P2-G2 规则优先、人工兜底的完整服务闭环

依赖 P2-G1、ARCH-005、P2-007、P2-015、P2-016、P2-012。全部 AI/OCR Flag 关闭、模型调用为 0；验证三入口先持久化、确定性安全路由覆盖率至少 90%、Manual Review 100% 可达、完整 Ticket Action UI、双责任、Reporter-safe Timeline、可靠通知和人工确认 Incident。真实 PostgreSQL、批准的真实企业微信测试范围、至少 60 分钟 controlled observation、2C4G、资源清理和项目负责人批准均为 Gate 条件。

### P2-G3 AI Shadow

依赖 P2-G2、P2-008、P2-009。只记录后台 AI Run，不参与受理、Ticket、Incident 或通知正确性；验证脱敏、上下文、Schema、成本和 Generation Fence。AI 停止时 P2-G2 仍完整通过。

### P2-G4 Copilot + Media

依赖 P2-G3、P2-010、P2-011。人工审核草稿，媒体/OCR 可关闭；Incident 已在 AI 之前由 P2-012/P2-G2 完成人工路径，不再依赖本 Gate。

### P2-G5 Controlled Auto + Phase 2 Go

只对白名单低风险场景放量。过期 AI、不安全回复、患者数据外泄、内部备注外泄和重复回复均必须为 0。

## 3. P3 Lanes

| Lane | 范围 |
|---|---|
| P3-A | UnifiedTicket Facade、Source Registry、Inbox、Outbox、Binding、Cursor、Reconciliation |
| P3-B | Hospital Identity、Organization、Connector、mTLS |
| P3-C | Intranet Portal、Hospital API、Monitoring Source Adapters |
| P3-D | Unified Workbench、Projection、Operations、Stage Acceptance |

### P3-G1 Contract + Outbound Transport

- Contract Version 冻结；
- mTLS、签名、最小权限；
- Connector Cursor/Spool；
- Source 隔离；
- 模拟 Receiver E2E；
- 不连接真实生产来源。

### P3-G2 First Intranet Source E2E

- 选择一条新的内网来源；
- 从提交请求到本地 Ticket 创建完整通过；
- 返回本地 Ticket 编号和状态投影；
- 重复事件不重复建单；
- 身份映射失败进入隔离队列；
- Connector 断开后可续传。

### P3-G3 Multi-source Operations + Fault/Security/Reconciliation

- 第二类 Source Simulator；
- Workbench 来源筛选和 Connector 健康；
- 网络分区、进程终止、证书撤销、事件乱序、ACK 丢失；
- 2C4G 积压恢复；
- Reconciliation 无未解释差异；
- 不覆盖本地 Ticket 状态。

### P3-G4 First Production Source Onboarding + Phase 3 Go

- 第一条真实内网来源获批；
- Feature Flag 小范围启用；
- 生产身份、网络、审计和备份验收；
- 运行观察窗口通过；
- 回退方式是关闭该 Source，不影响企业微信和 Unified Ticket Core；
- 业务、安全、运维责任人批准 Go。

## 4. 明确删除的验收项

V1.4 不再要求历史数据 dry run、未完结工单切换、最终增量、旧系统冻结或退役证明。

## P2-G1 授权后的并行边界

P2-B 的 P2-004、P2-005、P2-006 均已独立完成，P2-C 的 P2-007 已完成，P2-G1 已通过，ARCH-006 已完成重基线，当前无活动 Lane。下一候选 P2-015 以及 P2-016、P2-012、P2-G2、P2-008、AI/Media、P3 和生产启用仍须另行授权。
