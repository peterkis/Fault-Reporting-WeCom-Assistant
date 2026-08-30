# 37. 并行开发与 Assembly Gate 验收 V1.4

## 1. 原则

P1-012 与 Phase 1 已完成并取得 `GO`。项目负责人已独立授权启动 P2，P2-A 的 P2-001 已完成；当前无活动实施任务，P2-002 及以后任务、其他 Lane 实现、P2-G1 组装和 P3 均未授权。其他 Lane 只能读取 P2-001 冻结的 Contract，不得据此启动开发。所有 Feature Flag 保持默认关闭，本授权不等同于生产、临床或 AI 自动回复批准。

## 2. P2 Lanes

| Lane | 范围 |
|---|---|
| P2-A | Conversation Core、Timeline、Realtime Event Log |
| P2-B | Communication Outbox、Handoff、Workbench |
| P2-C | Rules、DeepSeek Provider、Context/Memory、Rollout |
| P2-D | Media/OCR、Incident、Metrics |

### P2-G1 Human-only Conversation Center

- 实时查看消息；
- 人工接管、分配和回复；
- 内部备注隔离；
- SSE 重连补放；
- 重复命令不重复发送；
- AI 全关时完整可用。

### P2-G2 AI Shadow

只记录 AI Run，不发送给用户。验证脱敏、上下文、Schema、成本和 Generation Fence。

### P2-G3 Copilot + Media + Incident

人工审核草稿；媒体/OCR 可关闭；Incident 默认人工确认。

### P2-G4 Controlled Auto

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
