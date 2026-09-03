# 医院信息故障智能报修与统一工单平台 Agent 开发包 V1.4

本仓库当前唯一有效架构基线为 V1.4。权威状态见 `docs/architecture_baseline_status.md`。

## 当前阶段

- `P1：企业微信外网试点` 已于 2026-08-30 完成并取得项目负责人正式 `GO`；
- G0 已完成并冻结；
- P1-001 至 P1-011 保持既有验收结论；
- P1-012 已完成真实测试群 E2E、客户端观察、故障演练和 Go/No-Go，状态为 `DONE`；
- Phase 2 保持 `IN_PROGRESS`；`P2-001` 至 `P2-005` 均已完成；
- P2-001 至 P2-007、P2-G1、ARCH-005、ARCH-006 已完成。ARCH-006 已将 Phase 2 重排为规则优先、人工兜底、AI 后置；当前无活动任务或 Lane，下一候选 P2-015 未授权。P2-015、P2-016、P2-012、P2-008 及以后 Runtime 任务、P2-G2 至 P2-G5 与全部 P3 任务均须单独授权，所有 Feature Flag 默认 `false`；
- 本次 Phase 2 启动授权不等同于生产上线、临床上线或 AI 自动回复批准，不启用真实外发、SSE、模型、OCR、医院身份连接或内网 Connector。

## V1.4 核心纠偏

本项目当前没有任何历史业务 Ticket，也不存在需要继续兼容、迁移或退役的旧工单系统。因此，P3 不再包含历史 Ticket 导入、未完结 Ticket 切换、旧状态映射、双系统并行或旧系统退役。

本系统自身的 Unified Ticket Core 从现在起就是唯一长期工单事实源。当前 `pilot_ticket.*` 物理 Schema 是其第一阶段兼容实现，不进行大爆炸式重命名，也不复制第二套核心表。

## 最终架构

```text
企业微信 / 内网报修门户 / 医院 API / 监控告警 / 未来服务入口
                              ↓
                 Channel / Integration Adapter
                              ↓
                   Durable Inbox + Idempotency
                              ↓
                  Conversation Thread / Session
                              ↓
                        Service Intake
                              ↓
                     Unified Ticket Core
                              ↓
       Ticket Event + Communication Outbox / Integration Outbox
                              ↓
        企业微信 / Web 工作台 / 内网状态投影 / 运营与对账
```

核心分层：

- `Channel Message`：企业微信原始消息事实；
- `Conversation Thread / Session`：多轮通信、人工接管和 AI 上下文；
- `Service Intake`：一次服务受理；
- `Unified Ticket Core`：唯一工单编号、状态、责任和生命周期事实源；
- `Incident`：公共故障聚合，不删除个人 Intake；
- `Communication Outbox / Delivery`：人工、AI 和工单通知的统一可靠发送；
- `Integration Inbox / Outbox`：未来内网来源的幂等接入与状态投影。

## Phase 1：企业微信外网试点

```text
Enterprise WeCom
→ WeCom Gateway
→ Channel Message
→ Service Intake
→ Pilot Ticket Core compatibility implementation
```

P1 保持零医院内网依赖；真实企业微信闭环和试点评审已完成，阶段结论为 `DONE / GO`。

## Phase 2：Conversation Center 与 AI 协作

P2 保持 `IN_PROGRESS`。P2-001 至 P2-007 均已完成；P2-006 是默认关闭的 Human-only Internal Alpha，P2-007 仅是确定性纯函数。P2-G1 已通过，ARCH-006 已完成重基线。现有结论不授权生产、临床、最终生产前端、P2-015、P2-016、P2-012、P2-008、P2-G2、DeepSeek、AI/OCR 或真实 Incident Runtime。后续能力仍须另行授权。

```text
Persisted Channel Message / Service Intake
→ Contact Journey / Deterministic Rule / Manual Review
→ Unified Ticket Core full lifecycle
→ Reporter-safe Timeline / Reliable Notification
→ Human-confirmed Incident
→ Optional DeepSeek / AI Shadow → Copilot → Controlled Auto
```

AI 始终是可关闭增强能力。AI 失败不能影响消息保存、受理、建单、人工审核、完整 Ticket 生命周期、Incident 人工确认、人工回复和通知。`base_service_ready` 与 `ai_enhancement_ready` 必须独立。

## Phase 3：医院内网接入与统一运营

```text
内网报修门户 / 医院 API / 监控告警 / 未来来源
                          ↓
              Intranet Connector Agent
                          ↓
                  Integration Inbox
                          ↓
                  Service Intake
                          ↓
                Unified Ticket Core
                          ↓
          Integration Outbox / Projection
```

P3 是绿地接入阶段：只接入新的内网来源和身份能力，不处理历史 Ticket 兼容或迁移。

## 2 核 4GB 部署原则

生产基线采用轻量模块化单体：

- Node.js 24 + PostgreSQL；
- 单活 WeCom Gateway；
- 一个低并发 Worker；
- 原生 REST + SSE 工作台；
- DeepSeek 外部 API，默认并发 1；
- PostgreSQL durable queue；
- Redis、Chatwoot、Dify、LangBot、MinIO、Elasticsearch 和完整监控栈均不是同机必需依赖；
- 不在 2C4G 云服务器运行本地大模型或常驻重型 OCR。

## 核心纪律

1. 先落库，再触发 AI，再发送回复。
2. Channel Message、Conversation、Service Intake、Ticket、Incident 必须分层。
3. Unified Ticket Core 是唯一 Ticket 状态事实源。
4. 人工接管后，所有旧 AI 生成任务必须失效。
5. AI 和人工回复必须进入同一可靠出站链路。
6. 内部备注永远不能发送到企业微信。
7. 所有外部消息、命令和投影事件必须幂等。
8. 所有 Ticket 状态变化必须产生追加式事件。
9. 外部来源不可通过共享数据库直接修改 Ticket。
10. 并行开发必须契约先行、隔离运行、统一 Gate 后再组装上线。
