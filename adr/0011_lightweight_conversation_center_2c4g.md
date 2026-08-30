# ADR-0011：2 核 4GB 下建设原生轻量 Conversation Center

- 状态：Accepted
- 日期：2026-08-30

## 背景

项目需要：

- 在 Web 工作台实时查看企业微信消息；
- 让人工客服直接回复用户；
- 保存多轮对话和 AI 上下文；
- 支持 AI、人工接管、分配、未读和内部备注；
- 与现有 Service Intake、Ticket、Outbox 形成闭环。

Chatwoot、Dify、LangBot 等项目提供了重要参考，但当前云服务器只有 2 核 4GB，
且仓库已经具备 Ticket Core、Outbox、权限和最小 Workbench。再部署完整客服平台会：

- 引入第二套联系人、会话、消息和权限事实；
- 增加 Rails/Sidekiq、多个数据库或大量容器；
- 与现有 Ticket 状态和通知产生双写；
- 超出一到两人运维能力。

## 决策

### 1. 原生增量实现

在当前 Node.js 24 + PostgreSQL 架构内建设：

```text
Conversation Thread
Conversation Session
Conversation Item Projection
Agent Assignment
Read Cursor
Handoff
AI Job / AI Run / Memory
Communication Outbox / Delivery
Realtime Event Log
```

### 2. 数据权威

Conversation Center 是通信聚合和控制面：

- Channel Message 仍是入站原始事实；
- Ticket Event 仍是工单状态事实；
- Delivery 仍是发送事实；
- Conversation Item 是可回放投影，可重建，不覆盖上游事实。

### 3. 实时协议

- REST API：查询、接管、回复、备注、分配和模式切换；
- SSE：消息、状态、分配、已读和投递变化；
- 不要求浏览器 WebSocket；
- SSE 断线使用 `Last-Event-ID` 补放；
- PostgreSQL Realtime Event Log 作为可恢复源。

### 4. 出站统一

人工回复、AI 回复和 Ticket 通知都进入统一的 Communication Outbox。
不允许从浏览器或 AI Worker 直接调用 WeCom SDK。

### 5. AI 控制

会话模式：

```text
AUTO
COPILOT
HUMAN
```

放量级别：

```text
SHADOW
COPILOT
CONTROLLED_AUTO
```

每个 Session 持有 `generation_version`。以下行为必须递增版本：

- 用户新增消息；
- 人工接管；
- 会话转交；
- 新 Session；
- Ticket 关键状态变化；
- 管理员取消生成。

AI 结果发送前必须重新验证版本和模式。

### 6. 2C4G 运行形态

同机推荐：

```text
process 1: app-api + SSE + workbench static assets
process 2: worker (outbox + AI jobs + maintenance)
process 3: WeCom Gateway active connection
service  : PostgreSQL
optional : Nginx
```

可合并 Gateway 与 App，但保持代码端口边界。

限制：

- AI 并发默认 1；
- Worker 总并发默认 1～2；
- DB pool 默认不超过 8；
- SSE 客户端初始不超过 32；
- 最近消息默认不超过 20 条；
- 单次模型上下文默认不超过 8K tokens；
- 不在同机运行本地 LLM、常驻重型 OCR、Chatwoot、Dify、LangBot、Kafka 或 Elasticsearch。

### 7. 外部组件边界

未来如部署 Chatwoot 或其他客服前端，只能作为可替换 Workbench Adapter：

- 通过公开 API/Event Contract 接入；
- 不直写本系统数据库；
- 不拥有 Ticket 状态；
- 不绕过 Communication Outbox；
- 可随时移除而不丢核心事实。

## 后果

- 资源占用与现有技术栈匹配；
- 复用 P1 已完成能力；
- 需要自行实现有限的通用客服 UI；
- 不追求全渠道营销、呼叫中心等无关能力；
- 后续可以按模块拆分，而不在早期承担微服务成本。
