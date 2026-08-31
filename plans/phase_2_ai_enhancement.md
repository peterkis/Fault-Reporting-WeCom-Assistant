# Phase 2：Conversation Center 与 AI 协作

> 文件名为兼容既有索引保留。V1.4 的 P2 已不只是 AI Enhancement。

> 状态（2026-08-31）：Phase 2 保持 `IN_PROGRESS`，P2-A 的 P2-001、P2-002 与随后独立授权的 P2-003 均已完成。当前无活动任务或 Lane；P2-004 至 P2-014 和其他 Lane 实现保持 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，其他 Lane 只能只读使用冻结 Contract。所有 P2/P3 Feature Flag 保持 `false`，P2-G1 为 `NOT_STARTED`。本完成不等同于生产上线、临床上线、SSE 生产开放或 AI 自动回复批准。

## 阶段目标

在 P1 已验证的 Channel Message、Service Intake、Ticket Core 和 Outbox 之上，建设：

- Durable Conversation Thread / Session；
- 可重建的实时 Timeline；
- REST + SSE 坐席 Workbench；
- 人工接管、分配、已读游标和内部备注；
- 人工、AI 和系统通知统一可靠出站；
- DeepSeek 多轮上下文、摘要和结构化记忆；
- Shadow、Copilot、Controlled Auto；
- 私有媒体/OCR；
- Incident 和运营指标。

## 进入条件

- P1-012 完成并批准 Go；
- 生产数据使用与模型边界已批准；
- Workbench 访问边界已批准；
- 2C4G 基准监控可用；
- 所有 P2 Feature Flag 默认关闭。

## 并行 Lane

| Lane | 内容 | 可独立开发方式 |
|---|---|---|
| P2-A | Thread、Session、Timeline、SSE | PostgreSQL + fixture Channel Message |
| P2-B | Communication Outbox、Handoff、Workbench | mock Conversation API / mock WeCom sender |
| P2-C | Rules、DeepSeek、Context、Memory、AI Mode | 脱敏固定集 + mock Provider |
| P2-D | Storage/OCR、Incident、Metrics | 测试对象存储 + 合成数据 |

## 任务总览

当前完成项为 P2-001、P2-002、P2-003；当前无活动任务。下表的依赖和目标 Gate 只表达
规划关系，不构成后续任务或 Assembly Gate 的启动授权。

| ID | 标题 | Lane | 依赖 | 目标 Gate |
|---|---|---|---|---|
| P2-001 | Conversation Thread、Session 与控制模式契约 | P2-A | P1-012 | P2-G1 |
| P2-002 | 持久化 Timeline Projector 与可重建投影 | P2-A | P2-001 | P2-G1 |
| P2-003 | Realtime Event Log、SSE 补放与慢客户端治理 | P2-A | P2-001 | P2-G1 |
| P2-004 | 统一 Communication Message / Outbox / Delivery | P2-B | P2-001 | P2-G1 |
| P2-005 | 坐席分配、Read Cursor、Handoff 与 Generation Fence | P2-B | P2-001, P2-004 | P2-G1 |
| P2-006 | 实时 Web Workbench、REST Command 与权限 | P2-B | P2-002, P2-003, P2-005 | P2-G1 |
| P2-007 | 服务目录、确定性规则与对话字段模型 | P2-C | P1-012 | P2-G2 |
| P2-008 | DeepSeek Provider Adapter、脱敏与安全闸门 | P2-C | P2-007 | P2-G2 |
| P2-009 | Context Builder、Rolling Memory、AI Job 与 AI Run | P2-C | P2-001, P2-008 | P2-G2 |
| P2-010 | AI Shadow、Copilot、受控自动回复与评估 | P2-C | P2-006, P2-009 | P2-G4 |
| P2-011 | 私有媒体、StoragePort、OCR 与敏感文本处理 | P2-D | P1-012 | P2-G3 |
| P2-012 | Incident、Reporter Subscription 与人工确认 | P2-D | P2-007 | P2-G3 |
| P2-013 | Conversation、AI、Ticket、Incident 运营指标与月报 | P2-D | P2-006, P2-010, P2-012 | P2-G4 |
| P2-014 | P2 组装、2C4G 性能、安全、降级与 Go/No-Go | ASSEMBLY | P2-010, P2-011, P2-012, P2-013 | P2-G4 |

## Gate 验收

### P2-G1 Human-only Conversation Center

- AI/OCR 全部关闭；
- 真实数据库；
- 企业微信消息投影到 Workbench；
- 人工接管和回复；
- 内部备注不外发；
- SSE 断线补放；
- 重复点击、并发接管和发送失败通过；
- 2C4G 无 OOM。

### P2-G2 AI Shadow

- DeepSeek 只产生后台结果；
- 脱敏和出域审查；
- Context/Memory 可追溯；
- generation fence；
- 固定评估集；
- AI 停止不影响 G1。

### P2-G3 Copilot + Media/Incident

- AI 草稿必须人工确认；
- 草稿编辑差异可审计；
- 媒体/OCR 可降级；
- Incident 默认人工确认；
- 群聊不同申报人隔离；
- 敏感附件不外泄。

### P2-G4 Controlled Auto

- 仅批准低风险意图；
- 白名单和小流量；
- stale/unsafe/patient leak 均为 0；
- 一键关闭；
- 24 小时资源浸泡；
- 真实企业微信客户端验证；
- 项目负责人和安全责任人批准。

## 退出条件

- Human-only 工作台可独立生产运行；
- AI 全停时核心链路 100% 可用；
- 人工接管后过期 AI 发送为 0；
- 内部备注外泄为 0；
- 患者敏感数据出域为 0；
- 所有模型调用可追溯；
- 2C4G 性能和恢复通过；
- P2-014 evidence 完整。
