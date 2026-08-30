# 02. V1.4 总体技术架构

## 1. 架构目标

- 企业微信连接稳定且可验证；
- 消息先持久化再回复；
- Channel Message、Conversation、Service Intake、Ticket、Incident 分层；
- Unified Ticket Core 是唯一长期工单事实源；
- P2 形成 Human-only 可用的 Conversation Center，再逐步启用 AI；
- P3 接入新的医院内网来源，不处理历史 Ticket 兼容；
- 适合 1—2 人维护和 2 核 4GB 云服务器。

## 2. 当前 P1 架构

```text
Enterprise WeCom
→ WeCom SDK Adapter
→ Channel Message Inbox
→ Service Intake
→ Pilot Ticket Core compatibility implementation
→ Ticket Event + Notification Outbox
```

P1 不依赖医院 SSO、人员、组织、内网门户或 Connector。

## 3. P2 Conversation Center

```text
Committed Channel/Integration Message
→ Conversation Projector
→ Thread / Session / Timeline
→ REST + SSE Workbench
→ Human Assignment / Handoff / Internal Note
→ Communication Outbox
→ WeCom Delivery
```

AI 路径：

```text
Committed Session
→ Redaction + Context Builder
→ DeepSeek Provider
→ AI Run / Structured Memory
→ Shadow / Copilot / Controlled Auto
```

### P2 不变量

- Human-only 必须独立可用；
- 人工和 AI 回复走同一 Outbox；
- `generation_version` 使过期 AI 结果失效；
- 内部备注不能外发；
- AI 不直接改 Ticket/Incident；
- 群聊按参与者和 Intake 隔离上下文。

## 4. P3 绿地内网接入

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

P3 建设：

- UnifiedTicket Port；
- Integration Source Registry；
- Inbox、Outbox、Binding、Cursor、重放和一致性核验；
- SSO、人员、组织、院区和处理组映射；
- 内网主动出站 Connector；
- 新内网来源 Adapter；
- 多来源统一 Workbench；
- 第一条生产内网来源接入与 Go/No-Go。

P3 不建设：历史导入、未完结切换、旧状态兼容、双系统并行、最终增量或旧系统退役。

## 5. 服务职责

### WeCom Gateway

只负责连接、认证、心跳、重连、消息接收、回复和主动发送。不得承载 Ticket 状态机或 AI 业务决策。

### Channel Message Inbox

保存不可变渠道事实并按 `provider + msg_id` 幂等。

### Conversation Center

负责 Thread、Session、Timeline、坐席分配、Handoff、Read Cursor、AI Generation Fence 和实时事件。

### Service Intake

负责一次服务受理和消息聚合，决定是否需要创建 Ticket，但不依赖 AI。

### Unified Ticket Core

负责 Ticket 编号、Action、状态、责任、事件、内部备注、外部结果、关闭与重开。

### Communication Outbox / Delivery

负责人工、AI 和 Ticket 通知的统一可靠投递。

### Integration Hub

负责新内网来源的认证、幂等、映射、Cursor、投影和运行时一致性核验。不得通过共享数据库修改 Ticket。

## 6. 故障边界

| 故障 | 行为 |
|---|---|
| AI/OCR 不可用 | Human-only 正常运行 |
| SSE 不可用 | 轮询回退，数据库事实不丢 |
| 企业微信断线 | Outbox 保留，恢复后继续发送 |
| 媒体不可用 | 文字仍受理，媒体重试/人工补充 |
| Connector 不可用 | 云端 Ticket 正常，内网投影积压 |
| 身份映射失败 | 事件隔离待审，不丢原始请求 |
| 新来源重复事件 | Inbox 幂等，不重复建单 |
| 外部投影不一致 | Reconciliation 告警，不覆盖本地状态 |

## 7. 明确不采用

- 第二套 Ticket Core；
- 共享数据库直写；
- AI 前置建单；
- 历史 Ticket 迁移框架；
- 浏览器/AI Worker 直连 WeCom SDK；
- 2C4G 同机部署 Chatwoot、Dify、LangBot 全套；
- Kafka、Kubernetes 和复杂多 Agent 编排。
