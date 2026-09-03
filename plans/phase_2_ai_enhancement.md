# Phase 2：Conversation Center 与 AI 协作

> 文件名为兼容既有索引保留。V1.4 的 P2 已不只是 AI Enhancement。

> 状态（2026-09-03）：Phase 2 保持 `IN_PROGRESS`，P2-001 至 P2-007、P2-G1、ARCH-005 与 ARCH-006 已完成。当前仅 P2-015 获独立授权并在 Lane `P2-C` 活动；P2-016、P2-012、P2-008 至 P2-014 及 P2-G2 至 P2-G5 均须单独授权，所有 Feature Flag 默认 `false`。

## 阶段目标

在 P1 已验证的 Channel Message、Service Intake、Ticket Core 和 Outbox 之上，建设：

- Durable Conversation Thread / Session；
- 可重建的实时 Timeline；
- REST + SSE 坐席 Workbench；
- 人工接管、分配、已读游标和内部备注；
- 人工、AI 和系统通知统一可靠出站；
- AI 完全关闭时可用的规则优先受理、人工审核、完整 Ticket 生命周期、Reporter-safe Timeline、可靠通知和人工确认 Incident；
- 可选的 DeepSeek 多轮上下文、摘要和结构化记忆；
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
| P2-B | Communication Outbox、Handoff、完整 Ticket Workbench/通知 | mock Conversation API / mock WeCom sender |
| P2-C | Rules、Journey、Manual Review、DeepSeek、Context、Memory、AI Mode | 脱敏固定集 + mock Provider |
| P2-D | Storage/OCR、Incident、Metrics | 测试对象存储 + 合成数据 |

## 任务总览

当前完成项为 P2-001 至 P2-007、P2-G1、ARCH-005、ARCH-006；当前仅 P2-015 / P2-C 活动，无活动 Gate。下表的依赖和目标 Gate 只表达
规划关系，不构成后续任务或 Assembly Gate 的启动授权。

| ID | 标题 | Lane | 依赖 | 目标 Gate |
|---|---|---|---|---|
| P2-001 | Conversation Thread、Session 与控制模式契约 | P2-A | P1-012 | P2-G1 |
| P2-002 | 持久化 Timeline Projector 与可重建投影 | P2-A | P2-001 | P2-G1 |
| P2-003 | Realtime Event Log、SSE 补放与慢客户端治理 | P2-A | P2-001 | P2-G1 |
| P2-004 | 统一 Communication Message / Outbox / Delivery | P2-B | P2-001 | P2-G1 |
| P2-005 | 坐席分配、Read Cursor、Handoff 与 Generation Fence | P2-B | P2-001, P2-004 | P2-G1 |
| P2-006 | 实时 Web Workbench、REST Command 与权限 | P2-B | P2-002, P2-003, P2-005 | P2-G1 |
| P2-007 | 服务目录、确定性规则与对话字段模型（DONE） | P2-C | P1-012 | P2-G2 |
| P2-015 | 规则优先受理编排、跨渠道接触旅程与人工审核 | P2-C | P2-G1, ARCH-005, P2-007, P1-004, P1-005, P2-004 | P2-G2 |
| P2-016 | 完整工单生命周期工作台、上报人时间线与可靠通知 | P2-B | P2-015, P1-006, P2-004, P2-005, P2-006 | P2-G2 |
| P2-012 | Incident、Reporter Subscription 与人工确认 | P2-D | P2-007, P2-015, P2-016 | P2-G2 |
| P2-008 | DeepSeek Provider Adapter、脱敏与安全闸门 | P2-C | P2-G2, P2-007 | P2-G3 |
| P2-009 | Context Builder、Rolling Memory、AI Job 与 AI Run | P2-C | P2-001, P2-008 | P2-G3 |
| P2-010 | AI Shadow、Copilot、受控自动回复与评估 | P2-C | P2-006, P2-009 | P2-G4 |
| P2-011 | 私有媒体、StoragePort、OCR 与敏感文本处理 | P2-D | P1-012 | P2-G4 |
| P2-013 | Conversation、AI、Ticket、Incident 运营指标与月报 | P2-D | P2-G4, P2-010, P2-012 | P2-G5 |
| P2-014 | P2 组装、2C4G 性能、安全、降级与 Go/No-Go | ASSEMBLY | P2-G4, P2-010, P2-011, P2-012, P2-013 | P2-G5 |

## Gate 验收

### P2-G1 Human-only Conversation Center

状态：`PASSED`（2026-09-02；真实现场 Evidence、60 分钟 controlled observation 和项目负责人批准已完成）。

- AI/OCR 全部关闭；
- 真实数据库；
- 企业微信消息投影到 Workbench；
- 人工接管和回复；
- 内部备注不外发；
- SSE 断线补放；
- 重复点击、并发接管和发送失败通过；
- 2C4G 无 OOM。

### P2-G2 规则优先、人工兜底的完整服务闭环

- 依赖 P2-G1、ARCH-005、P2-007、P2-015、P2-016、P2-012；
- 三种入口先持久化，确定性安全路由覆盖率至少 90%；
- 完整 Ticket Action UI、双责任、Reporter-safe Timeline 和通知链通过；
- Incident 只由人工确认，错误关联可解除；
- 全部 AI/OCR Flag 关闭，模型调用为 0；
- 真实 PostgreSQL、受控真实企业微信、至少 60 分钟观察和项目负责人批准。

### P2-G3 AI Shadow

- 依赖 P2-G2、P2-008、P2-009；
- DeepSeek 只产生后台结果，不参与受理、Ticket、Incident 或通知正确性；
- 脱敏、Schema、Context/Memory、成本和 Generation Fence 可追溯；
- AI 停止时 P2-G2 完整闭环继续通过。

### P2-G4 Copilot + Media

- 依赖 P2-G3、P2-010、P2-011；
- AI 草稿必须人工确认，编辑差异可审计；
- 媒体/OCR 可关闭和降级；
- Incident 已在 P2-G2 前完成人工路径，不依赖本 Gate；
- 敏感附件不外泄。

### P2-G5 Controlled Auto + Phase 2 Go

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
