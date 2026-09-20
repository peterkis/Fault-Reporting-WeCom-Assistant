# AGENTS.md

## Git 历史相关审核：先确认被审对象

涉及 `tested_head`、祖先链、merge-base 或“证据与提交历史不一致”的审核，必须先区分已发布提交与审核环境临时重建的快照。详见 `.github/review/README.md`。

- 权威 `expected_head` 必须取自 GitHub 本次 PR 事件或审核元数据的完整 SHA，不得使用本地 `HEAD` 自证，也不得把未知临时 SHA 称为已发布提交。
- 在完整、干净的 checkout 执行 `node .github/review/verify-published-history.mjs --expected-head <权威完整SHA>`。GitHub merge preview 还须显式传入同一事件的 `--expected-merge` 与 `--expected-base`；不能自行制造单父提交代替。
- `REVIEW_CHECKOUT_IDENTITY_MISMATCH`、浅克隆、replace/graft 或对象缺失属于审核环境/对象来源未确认。应获取本次权威提交的完整历史再验证；不能直接由该环境推导已发布 PR 存在 P1 祖先链缺陷。无法获取时如实说明本项未验证，继续检查其他可验证代码问题。
- 预检通过只表示历史身份核验通过，永远不是 readiness/验收通过。必须继续执行原命令 `node scripts/validate-yxx-self-service.mjs --require-ready`；在身份确认后的真实发布对象上出现的断链或验收失败仍须报告并修复。
- 禁止为了通过审核修改 `tested_head`、接受“同 tree 即合法祖先”、跳过祖先断言、伪造 PASS、重写旧证据或把临时快照的父提交改造成发布事实。真正 squash/rebase 改写交付历史时仍须保留真实被测祖先或重新生成证据。
- 仅增加审核工具/文档的后继提交不等于候选源变化；不得仅因 PR head 前移就重绑已正确记录的被测提交。候选内容、完成态和原严格门禁仍按原实现核验。

本规则是审核对象来源核验，不是忽略历史问题或免除业务测试的规则。

2026-09-15 当前增量：ADR-0019 身份映射修补及 ADR-0020 定向建单模式本地验证完成，1056/1056、171测试文件及两轴独立审查通过。当前候选见 plans/current_phase.json 的 p2_g2_current_readiness（creation-v2 报告）。mapping-v1 的1053/1053与下文PR #8的1044/1044均为历史快照。A/B官方转换对应已证明；定向建单启动及工单结果以本次独立运行证据为准，A/B本人读取、他人拒绝及退出后新OAuth恢复已验证，云端已回退OAuth-only；多标签及旧Grant卡片现场未运行，结论见evidence/p2-g2-yxx-targeted-live-summary.json；完整P2-G2-LIVE/P2-008继续停止。


2026-09-11 P2-G2-YXX-TICKET-ENTRY 本地实现与隔离自动化完成：当前候选1044/1044、166测试文件及两轴独立审查通过。PR #7的976项仅为历史输入；交接先读 `evidence/p2-g2-yxx-entry-report.json`、父就绪报告及 `docs/runbooks/yixiaoxiu-member-ticket-entry.md`。真实身份对应仍未证明（IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING），定向现场及P2-G2-LIVE未授权/未运行，P2-008继续阻断。
# 医院信息故障智能报修与统一工单平台开发规范 V1.4

## 1. 唯一有效基线

`AGENTS.md`、`README.md`、`docs/architecture_baseline_status.md` 和 Accepted ADR 共同构成 V1.4 执行基线。冲突时必须先修正文档或新增 ADR，再实现代码。

上一阶段结论固定为：

```text
P1 / P1-012 / DONE / GO
```

当前阶段状态固定为：

```text
P2 / P2-012 / DONE / P2-G2 READY_FOR_LIVE_E2E
```

V1.4 不改变 G0/P1 已完成事实。P2-G1 于 2026-09-02 更新为 `PASSED`；ARCH-005、P2-007、ARCH-006 与 P2-015 已于 2026-09-03 完成；P2-016 已于 2026-09-04 完成。P2-012 已于 2026-09-07 经真实定向现场、现场后与完成态全量回归、客户端确认和负责人批准完成。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。P2-G3 及以后 Gate 和全部 P3 未启动。所有 Feature Flag 默认关闭。上述状态均不等同于 Phase 2 Go、生产上线、临床上线、最终生产前端或 AI 自动回复批准。

## 2. 长期事实源

P2-016 完成或交接核验时，读取 `evidence/p2-016-ticket-lifecycle-workbench-report.md` 与 `evidence/p2-016-project-owner-approval.md`。P2-012 交接时读取 `evidence/p2-012-human-confirmed-incident-report.md`、`evidence/p2-012-project-owner-approval.md` 与 `evidence/p2-012-targeted-live-validation.md`。P2-012 已完成，PR #6 七个提交由 8c332710dad9b6cf3f6796f3344c04d1c710ddf3 合并。P2-G2交接先读取 `evidence/p2-g2-automated-readiness-report.json`、其中 `source_evidence` 指向的当前矩阵和独立审查，以及 `prompts/P2-G2_rule_first_service_loop_runbook.md`；核对当前候选，不沿用旧现场批准。P2-G2 授权与停止线见 `evidence/p2-g2-start-authorization.md` 和 `tasks/P2-G2_rule_first_service_loop_gate.md`。所有 Feature Flag 默认关闭，P2-G2-LIVE/P2-008 保持停止线。

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

P2 保持 `IN_PROGRESS`；P2-001 至 P2-007、P2-015、P2-016、P2-012、P2-G1、ARCH-005、ARCH-006 均已完成。P2-012 于 2026-09-07 经真实定向现场、回归、客户端确认和负责人批准完成。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。

P2 必须按以下顺序：

```text
Human-only Conversation Center
→ Rule-first Orchestration + Manual Review
→ Full Ticket Lifecycle + Reporter Timeline + Reliable Notification
→ Human-confirmed Incident
→ Deterministic Full Service Loop Gate
→ AI Shadow
→ Copilot + Media
→ Controlled Auto
```

AI：

- 可完全关闭；
- 不决定明确报修是否受理；
- 不直接修改 Ticket/Incident；
- 不直接调用企业微信 SDK；
- 必须经过脱敏、Schema、Generation Fence 和 Communication Outbox；
- 人工接管后旧结果必须标记 STALE，禁止发送。

Readiness 必须分为 `base_service_ready` 与 `ai_enhancement_ready`。核心服务就绪不得要求模型密钥或 Provider 网络；后者失败不得反向把前者置为失败。

`Conversation Assignment` 是谁负责与用户沟通；`Ticket Assignment` 是谁负责解决故障。两者是独立权威事实，禁止复制第二套所有权。复合接管/接单命令必须同事务全部成功或全部失败。

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
- P2-G2：规则优先、人工兜底的完整服务闭环；
- P2-G3：AI Shadow；
- P2-G4：Copilot + Media；
- P2-G5：Controlled Auto + Phase 2 Go。

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
