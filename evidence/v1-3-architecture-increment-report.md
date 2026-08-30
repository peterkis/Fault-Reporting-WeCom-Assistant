> Historical V1.3 evidence. Superseded by V1.4 for P3 scope; do not use its historical-ticket requirements as executable tasks.

# V1.3 架构增量交付报告

- 生成日期：2026-08-30
- 来源仓库：`peterkis/Fault-Reporting-WeCom-Assistant`
- 生成基线提交：`8fcb6c1b6d7552d62ac859760c81ca4fba357626`
- 增量类型：文档、计划、契约、概念 Schema、配置和架构校验
- 代码运行阶段：仍为 P1/P1-012
- 生产迁移：未执行
- 真实 DeepSeek/医院内网/旧工单连接：未执行

## 1. 纠偏结果

### 旧方向

```text
Pilot Ticket Core → Hospital Tickets
Hospital Tickets → sole long-term source of truth
```

### 新方向

```text
Enterprise WeCom / Intranet Sources / Legacy Tickets
                         ↓
                 Unified Ticket Core
                         ↓
          One status/event/notification truth
```

ADR-0007 已 Superseded，ADR-0010 成为新的长期事实源决策。

## 2. P2 调整

P2 从单纯 AI/OCR 扩展为：

- Conversation Thread/Session；
- Timeline Projector；
- Realtime Event Log/SSE；
- Communication Outbox；
- Handoff/Assignment/Read Cursor；
- Web Workbench；
- DeepSeek Provider；
- Context/Memory/AI Job；
- Shadow/Copilot/Controlled Auto；
- Media/OCR；
- Incident；
- Metrics；
- Assembly/2C4G/Security Go-No-Go。

## 3. P3 调整

P3 从“迁出到旧 Hospital Tickets”改为：

- Unified Ticket Core Facade；
- Integration Source Registry；
- Inbox/Outbox/Binding/Cursor/Reconciliation；
- Hospital Identity；
- Intranet Connector；
- 旧工单历史/未完结迁入；
- 内网门户和未来来源 Adapter；
- 多来源 Workbench；
- 通知所有权切换；
- 旧系统冻结和退役。

## 4. 并行开发

定义了八条 Lane 和八个 Assembly Gate。所有未来功能默认 Flag 关闭，允许使用模拟依赖
并行开发，但不得在 P1 活跃期间连接真实生产依赖。

## 5. 2C4G 约束

采用：

- Node App/API/SSE；
- Node Worker；
- 单活 WeCom Gateway；
- 单 PostgreSQL；
- AI concurrency 1；
- PostgreSQL durable queues。

不把 Chatwoot、Dify、LangBot、Redis、MinIO、Kafka、Elasticsearch、Kubernetes、
本地 LLM 或重型 OCR 设为同机前置。

## 6. 自动校验

新增：

```text
npm run validate:architecture:v1.3
npm run test:architecture:v1.3
```

检查内容包括：

- P1/P1-012 当前状态；
- Unified Ticket Core 权威；
- 旧 ADR Superseded；
- P2/P3 任务和 Gate；
- 所有未来 Flag 默认关闭；
- package 依赖版本不变；
- 2C4G 限制；
- 不创建第二套 Ticket Core。

## 7. 应用影响

覆盖的是架构和计划文件；不删除现有代码、迁移、测试和 Evidence。应用后需要由 Git
检查差异，再按项目流程提交。生产运行行为不会因文档本身自动变化。
