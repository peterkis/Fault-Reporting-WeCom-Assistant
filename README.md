# 医院信息故障智能报修与统一工单平台 Agent 开发包 V1.4

PC 媒体读取与预览优化：默认关闭的员工媒体入口、服务端视频封面和原生播放，合同见[员工媒体接口](docs/api/workbench/employee-media.md)，实施状态见[交付清单](plans/pc-admin-electron/media-employee-read-2026-10-28.md)。

PC Electron MVP：Windows x64 桌面外壳、固定员工扫码入口及托盘提醒，见[使用与 D 盘开发环境](app/pc-admin/desktop/README.md)和[交付记录](plans/pc-admin-electron/README.md)。服务器业务仍沿原核心与授权；本地安装包不代表现场部署或发送批准。

2026-10-25 首批候选后继已收口T35测试前提和G2当前复现，最终同候选定向验证通过，完整G2连续3轮通过。见[后继交付](plans/app-layout/candidate-followup-2026-10-25.md)；旧失败与未完成全集保持，真实外部/部署/Gate仍需原具名批准。

2026-10-25 按用户修订目标，先交付通过关键门槛、可增量回退的 human-v1 小范围候选；完整回归停止于322/741入口，G2投递失败保留。候选范围、限制和回退见[首批候选报告](plans/app-layout/first-gray-candidate-2026-10-25.md)，不代替完整认证或上线批准。

应用目录按 [整体布局](app/README.md) 分步整理为 `app/pc-admin`、`app/h5`、`app/server`。正式 PC 前端位于 [app/pc-admin](app/pc-admin/README.md)，新 H5 已迁至 [app/h5](app/h5/README.md)，继续使用根统一依赖、构建及既有运行制品位置；后端按 [ADR-0044](adr/0044_server_application_layout_and_logical_source_identity.md) 迁至 [app/server](app/server/README.md)。2026-10-24 源码迁移及本地验证执行已收口；保留失败和工具 rename NOT_RUN，不代表无保留验收通过。实际结果见[后端迁移记录](plans/app-layout/server-migration-2026-10-23.md)，整体范围见[应用整理记录](plans/app-layout/README.md)，不改变业务架构或 Gate。

H5 性能改造按 [ADR-0036](adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)前向实施：页面引导聚合、路由与数据并行、私有图片预览和获权渐进播放；新增性能配置默认关闭。实际范围、预算、测试结果及未运行项见[实施记录](plans/yixiaoxiu-h5-performance/README.md)与[接口合同](docs/api/member/h5-performance.md)，不改变原 Gate 或现场授权。

新版医小修 H5 使用 Vite、TypeScript、React、React Router、TanStack Query、shadcn/ui 和 Lingui React 国际化，按 Stitch“医院IT工单报修系统”的八屏固定基线实现浅色／深色页面。源码与合成预览见 [H5 入口](app/h5/README.md)，实际接口见 [V2 合同](docs/api/member/h5-v2.md)，原实现范围见 [重做记录](plans/yixiaoxiu-h5-rebuild/README.md)与 [ADR-0035](adr/0035_yixiaoxiu_h5_multimedia_and_member_service.md)，路由与预编译国际化前向修订见 [ADR-0041](adr/0041_h5_react_router_shared_shell_and_interaction_readiness.md)。新增功能与公开进度写入独立默认关闭，本地实现不改变部署或现场发送状态。

MVP 群回应、实际接单／完工通知及应用成员后端的原交接见 [实施记录](plans/mvp-notifications-h5/README.md)与 [ADR-0034](adr/0034_mvp_notifications_and_application_members.md)。

新版人工工作台运行接线：[显式 human-v1 配置、能力依赖、编译入口与停止方法](docs/runbooks/human-workbench-runtime.md)。默认关闭，本地验证不授予真实发送、部署或 Gate 批准。

前后端交互服务接口统一入口：[docs/api/README.md](docs/api/README.md)。可按 [HTTP方法与完整路径](docs/api/endpoint-index.md) 检索实际宿主、认证、请求/响应、版本与错误；外部服务、内部Port及设计接口另有索引。新增或变更接口时同步该目录，维护方法见 [接口文档维护规则](docs/api/maintenance.md)。

PC 管理端完整人工业务接入：[实施计划与导航](plans/admin-workbench-integration/README.md)，包括现有接口／后端缺口、17个工作包和验收矩阵，已拆为[43票GitHub任务清单](plans/admin-workbench-integration/tickets.md)。2026-10-07 的计划快照为已确认并发布任务、业务接入尚未执行。后继于2026-10-16完成43票本地验收收口，并经[PR #99](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99)合并；范围与逐票证据见[最终复核](plans/admin-workbench-integration/execution/all43-final-review.md)。实际服务入口仍以 docs/api 为准，此结果不推进现场或业务Gate。

Agent按任务读取[指令导航](docs/agents/README.md)；会话经验与可检索来源见[复盘索引](docs/retrospectives/README.md)。历史段落中的“当前”及计数只绑定所记日期、候选与原始Evidence。

2026-09-15 当前增量：ADR-0019 身份映射修补及 ADR-0020 定向建单模式本地验证完成，1056/1056、171测试文件及两轴独立审查通过。当前候选见 plans/current_phase.json 的 p2_g2_current_readiness（creation-v2 报告）。mapping-v1 的1053/1053与下文PR #8的1044/1044均为历史快照。A/B官方转换对应已证明；定向建单启动及工单结果以本次独立运行证据为准，A/B本人读取、他人拒绝及退出后新OAuth恢复已验证，云端已回退OAuth-only；多标签及旧Grant卡片现场未运行，结论见evidence/p2-g2-yxx-targeted-live-summary.json；完整P2-G2-LIVE/P2-008继续停止。


2026-09-11 P2-G2-YXX-TICKET-ENTRY 本地实现与隔离自动化完成：当前候选1044/1044、166测试文件及两轴独立审查通过。PR #7的976项仅为历史输入；交接先读 `evidence/p2-g2-yxx-entry-report.json`、父就绪报告及 `docs/runbooks/yixiaoxiu-member-ticket-entry.md`。真实身份对应仍未证明（IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING），定向现场及P2-G2-LIVE未授权/未运行，P2-008继续阻断。

本仓库当前唯一有效架构基线为 V1.4。权威状态见 `docs/architecture_baseline_status.md`。

2026-09-11 医小修网页授权增量已完成一次真实成员认证，独立授权的 OAuth-only 云端入口运行中，代码默认关闭。PR #7 的当前准备候选以就绪报告及其引用证据为准，旧 954 项报告单独保留，不推进完整 G2 业务运行；网页认证验证见 [网页授权记录](evidence/p2-g2-wecom-web-oauth.md)。

## 当前阶段

- `P1：企业微信外网试点` 已于 2026-08-30 完成并取得项目负责人正式 `GO`；
- G0 已完成并冻结；
- P1-001 至 P1-011 保持既有验收结论；
- P1-012 已完成真实测试群 E2E、客户端观察、故障演练和 Go/No-Go，状态为 `DONE`；
- Phase 2 保持 `IN_PROGRESS`；`P2-001` 至 `P2-005` 均已完成；
- P2-001 至 P2-007、P2-015、P2-016、P2-012、P2-G1、ARCH-005、ARCH-006 已完成。P2-012 已于 2026-09-07 经真实定向现场、完整回归、客户端确认和负责人批准完成。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。P2-008 及以后 Runtime、P2-G3 至 P2-G5 与全部 P3 任务均须单独授权，所有 Feature Flag 默认 `false`；
- 本次 Phase 2 启动授权不等同于生产上线、临床上线或 AI 自动回复批准，不启用真实外发、SSE、模型、OCR、医院身份连接或内网 Connector。

## V1.4 核心纠偏

P2-G2准备已达 `READY_FOR_LIVE_E2E`：1044/1044全仓、166测试文件（原976/158为历史结果）、202来源分账、37项矩阵与10项PR修复映射，SPEC/STANDARDS均PASS。当前就绪依据为 `evidence/p2-g2-automated-readiness-report.json`，现场操作见 `prompts/P2-G2_rule_first_service_loop_runbook.md`。云端停止态部署与真实现场分别记账，正式WeCom/60分钟/负责人Gate批准均未执行。

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

P2 保持 `IN_PROGRESS`。P2-001 至 P2-007 与 P2-015 均已完成；P2-006 是默认关闭的 Human-only Internal Alpha，P2-007 是确定性纯函数，P2-015 是默认关闭的持久化装配。P2-G1 已通过，ARCH-006 已完成重基线。现有结论不授权生产、临床、最终生产前端、P2-008、P2-G2 现场、DeepSeek、AI/OCR 或生产 Incident 启用。后续能力仍须另行授权。

P2-016 的独立授权见 `evidence/p2-016-start-authorization.md`；其默认关闭的完整工单/人工复核工作台、双责任、Reporter-safe Timeline 和可靠通知已经负责人批准并收口为 DONE。P2-012 的人工确认 Incident、Reporter Subscription 和可靠通知也已于 2026-09-07 完成，见 `evidence/p2-012-human-confirmed-incident-report.md` 与 `evidence/p2-012-project-owner-approval.md`。PR #7 的 P2-G2 / ASSEMBLY 历史候选已达 READY_FOR_LIVE_E2E，历史自动化976/976及两轴独立审查通过；本轮成员入口候选1044/1044及两轴独立审查通过，准备状态READY_FOR_LIVE_E2E，真实身份对应/定向现场仍待独立证明与授权；最后完成 Gate 仍为 P2-G1。云端停止态部署按独立授权记录；P2-G2-LIVE 真实发送、现场业务写库、正式观察及负责人 Gate 批准仍须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。不构成 Phase 2 Go。

自动化报告：`evidence/p2-016-automated-readiness-report.md` / `.json`。内部视图为 `/workbench/lifecycle`，原 `/workbench/` 会话入口保留。受控现场配置、命令、HTTPS 隔离和停止线见 `docs/61_p2_016_wecom_notifications_template_card.md`；未配置审批和目标库时，`npm run p2:016:live:check` 应失败关闭，不会自动发送。

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
