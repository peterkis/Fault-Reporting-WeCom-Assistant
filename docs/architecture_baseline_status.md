# Architecture Baseline Status

本文件记录业务架构与 Gate 事实；带日期的测试数字与候选是其历史快照。TypeScript 迁移进度只在 [迁移执行入口](../plans/typescript-migration/README.md) 维护。PR #38 的认证仅属于其被测对象，P01 合并或新迁移候选检查通过均不等于新候选 READY 或生产批准。

2026-09-15 历史增量：ADR-0019 身份映射修补及 ADR-0020 定向建单模式本地验证完成，1056/1056、171测试文件及两轴独立审查通过。当前候选见 plans/current_phase.json 的 p2_g2_current_readiness（creation-v2 报告）。mapping-v1 的1053/1053与下文PR #8的1044/1044均为历史快照。A/B官方转换对应已证明；定向建单启动及工单结果以本次独立运行证据为准，A/B本人读取、他人拒绝及退出后新OAuth恢复已验证，云端已回退OAuth-only；多标签及旧Grant卡片现场未运行，结论见evidence/p2-g2-yxx-targeted-live-summary.json；完整P2-G2-LIVE/P2-008继续停止。


2026-09-11 历史记录：P2-G2-YXX-TICKET-ENTRY 本地实现与隔离自动化完成：当前候选1044/1044、166测试文件及两轴独立审查通过。PR #7的976项仅为历史输入；交接先读 `evidence/p2-g2-yxx-entry-report.json`、父就绪报告及 `docs/runbooks/yixiaoxiu-member-ticket-entry.md`。真实身份对应仍未证明（IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING），定向现场及P2-G2-LIVE未授权/未运行，P2-008继续阻断。

2026-09-11 历史增量说明：用户授权实施医小修网页 OAuth，任务见 `tasks/P2-G2_wecom_web_oauth.md`，证据见 `evidence/p2-g2-wecom-web-oauth.md`。当前准备候选以 `evidence/p2-g2-automated-readiness-report.json` 及其引用证据为准，原 954 项报告单独保留为历史快照。OAuth-only 云端入口已部署（代码默认关闭、独立运行配置启用），用户确认认证成功，服务端成功回调及成功页各 1；完整 G2 业务运行保持停止，不推进任何 Gate。

- 基线版本：V1.4
- 生效日期：2026-08-30
- 状态：ACTIVE
- 当前阶段：P2 / IN_PROGRESS
- 当前活动 Lane：ASSEMBLY
- 最后完成任务：P2-012（2026-09-07）
- 最后完成 Gate：P2-G1（2026-09-02）
- 已完成任务：G0 全部冻结项；P1-001 至 P1-012；ARCH-004；P2-001 至 P2-007；P2-015；P2-016；P2-012；P2-G1
- 最后完成架构任务：ARCH-006（2026-09-03）
- 当前活动任务与 Lane：P2-G2 / ASSEMBLY
- 当前 Gate：P2-G2 / IN_PROGRESS；最后完成 Gate 为 P2-G1 / PASSED
- 最近完成任务：P2-012（`DONE`）；当前 P2-G2 仅准备授权
- P2-G2 当前业务修订：三种入口均有效；群内最终闭环 @ 原报修人，单聊默认仅接单及最终关闭两次模板推送，其余节点可配置且默认关闭。故障受理不依赖资料补充成功。目标契约见 `evidence/p2-g2-three-entry-business-profile.md`，原976项为PR #7历史结果；当前成员入口及1044项完整回归已验证，证据已绑定；真实现场未运行。
- P2-G1：PASSED（不是 Phase 2 GO、生产或临床批准）
- P2/P3 Feature Flags：全部 `false`
- P3：TODO / 未启动
- 上一基线：V1.3
- 关键决策：ADR-0010、ADR-0011、ADR-0012、ADR-0017

ARCH-005 于 2026-09-03 完成 Asia/Shanghai 时间契约和目标现场重验；P2-007 同日完成纯确定性领域实现，ARCH-006 随后完成规则优先重基线，P2-015 已完成持久化规则编排、Contact Journey、continuation_ref 与 Manual Review。P2-016 已于 2026-09-04 完成并获负责人最终批准；DeepSeek、OCR、P2-008、P2-G2-LIVE/P3 与生产/临床启用仍未授权。

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
- 以既有任务完成为由启动 P2-008 及以后任务、P2-G2 及以后 Gate 或任何 P3 任务；
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

P2 保持 `IN_PROGRESS`，Phase 启动 Evidence 为 `evidence/p2-phase-start-authorization.md`。P2-001 至 P2-007、P2-015、P2-016 与 P2-012 均已完成；P2-G1 Human-only Assembly 于 2026-09-02 通过，ARCH-005、P2-007、ARCH-006、P2-015 于 2026-09-03 完成，P2-016 于 2026-09-04 完成。P2-012 已于 2026-09-07 经真实定向现场、回归、客户端确认和负责人批准完成。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。P2-008 及以后 Runtime 和 P2-G3 至 P2-G5 仍须另行授权。所有 Feature Flag 默认关闭。

固定顺序：

```text
Human-only Conversation Center
→ Rule-first Orchestration + Manual Review
→ Full Ticket Lifecycle + Reporter Timeline + Reliable Notification
→ Human-confirmed Incident
→ P2-G2 Deterministic Full Service Loop
→ AI Shadow
→ Copilot + Media
→ Controlled Auto + Phase 2 Go
```

人工和 AI 回复使用同一 Communication Outbox；Generation Fence 防止过期回复；内部备注不可外发；AI 不直接改 Ticket/Incident。规则与人工是主路径，`base_service_ready` 不依赖模型密钥、Provider 网络或 `ai_enhancement_ready`。Conversation Assignment 与 Ticket Assignment 是两个独立权威事实。

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

架构上定义八条产品 Lane。P2-A 的 P2-001/002/003、P2-B 的 P2-004/005/006/P2-016、P2-C 的 P2-007/P2-015、P2-D 的 P2-012 已完成；P2-G1 已通过，ARCH-005 与 ARCH-006 已完成。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。P2-008 仅在 P2-G2 `PASSED` 后才可成为候选。

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

本次 P2-G1 独立授权以提交 `1c18d5653b17e4368b5fa057d513e1af1a8b4622` 为工作基线。旧 P3 文件保留为 Superseded 指针，避免自动化引用失效；其内容不能作为任务来源。
