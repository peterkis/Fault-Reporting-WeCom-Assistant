# Architecture Baseline Status

2026-10-28 PC员工媒体优化按[ADR-0050](../adr/0050_pc_media_employee_read_and_server_previews.md)前向实施：独立默认关闭的员工读取、请求级到期及服务端视频封面；H5原授权保持。实现/验证状态见[交付清单](../plans/pc-admin-electron/media-employee-read-2026-10-28.md)，不表示云端部署或Gate批准。

2026-10-25 首批候选后继修正T35可见材料上界及G2同步核验造成的当前发送截止复现，保持原SDK终检、5秒超时、默认开关与业务边界。精确身份和本地验证见[后继交付](../plans/app-layout/candidate-followup-2026-10-25.md)，不重绑历史或批准Gate。

2026-10-25 本地交付目标修订为关键门槛、可回退的小范围候选；human-v1当前装配已完成定向验证，旧G2首次SENT失败和未完成全集均保留。范围与证据见[首批候选报告](../plans/app-layout/first-gray-candidate-2026-10-25.md)。不改变任何历史tested_head、默认开关、完整readiness合同或业务Gate。

2026-10-24 后端目录整理当前状态：按 [ADR-0044](../adr/0044_server_application_layout_and_logical_source_identity.md) 完成 `app/server`、根 `shared` 及 PC 专属模块归属，采用统一编译的原生目录输出。源码迁移及本地验证执行已收口；全部失败及工具 rename NOT_RUN 保留，不代表无保留验收通过。实际结果见[后端迁移记录](../plans/app-layout/server-migration-2026-10-23.md)，分步导航见[应用整理记录](../plans/app-layout/README.md)；不改变业务合同、历史身份、私有配置或任何 Gate。

2026-10-23 H5 目录前向整理：按用户批准的第二步计划，将根 H5 工程及原件整体迁至 `app/h5`，继续共享根依赖、锁文件和统一构建；运行制品及同源地址保持。PC、H5 已完成本地迁移和验收，后端待实施。迁移与验收状态见[应用整理记录](../plans/app-layout/README.md)，不改变业务、默认开关、历史 tested_head 或 Gate；主工作区私有配置保持原位。

2026-10-23 通知页面前向修订：[ADR-0043](../adr/0043_h5_notification_entry_and_legacy_ui_retirement.md)规定机器人／经核实代录的原卡片链接由新 React H5 承接，保留原成员／Grant 权限、独立 Bot 反馈及原 UUID 核对。旧成员页面在替代验证后退役；新自助 H5 关闭时页面失败关闭，V1 API 及业务开关不自动扩大。实际验证与清理见[应用整理记录](../plans/app-layout/README.md)，不改变历史 tested_head 或 Gate。

2026-10-22 应用源码目录整理：目标为 `app/pc-admin`、`app/h5`、`app/server`，第一步仅迁移正式 PC 前端；详见[应用目录](../app/README.md)与[迁移记录](../plans/app-layout/README.md)。继续使用根统一依赖和构建，保留现有同源入口及运行制品位置；H5 与后端后续分步迁移。此项不改变模块化单体、角色分工、业务合同或任何 Gate 事实。

2026-10-22 部署后加载体验反馈沿 [ADR-0042](../adr/0042_h5_continuous_navigation_and_silent_entry.md) 前向修订：移除骨架、保留切换前视图、独立顶部进度条、同范围旧缓存后台复核及首次静默认证；外部浏览器显示企业微信打开指引。输入反例、候选验证与交付状态见 [连续展示记录](../plans/yixiaoxiu-h5-performance/loading-continuity-2026-10-22.md)，不改写上一候选的验收或真机状态。

2026-10-22 H5 路由与交互前向修订：[ADR-0041](../adr/0041_h5_react_router_shared_shell_and_interaction_readiness.md)沿既有SPA接入官方React Router、统一共享页头，将纯导航与写就绪分别控制，并修正原生起录确认前的提示时序。英文工单／日期、分时欢迎语、同秒展示顺序和延迟骨架保持原事实及120KiB预算；本轮实测、失败和NOT_RUN边界见[路由交互记录](../plans/yixiaoxiu-h5-performance/router-ux-2026-10-22.md)。

2026-10-22 H5 单入口录音前向修订：[ADR-0040](../adr/0040_h5_single_voice_capture_and_optional_transcription.md)按最新用户要求移除方式选择，以清晰Blob作为唯一回听／上传材料，同手势企业微信采集仅辅助转写，下限改为2秒。此项替代ADR-0038的手动双模式及3秒规则，原权限、上传预算、草稿归属与资源清理保持；真机双路效果单独保持NOT_RUN，实际候选与验证见[本轮记录](../plans/yixiaoxiu-h5-performance/unified-voice-2026-10-22.md)。

2026-10-22 H5 本人资料前向修复：[ADR-0039](../adr/0039_h5_member_display_profile.md)将已验证的官方姓名／主部门读取接入独立异步展示，复用原 BASE 有界核验，保留会话及返回前终检；不从展示名称授予科室 READ，不修改身份或历史快照。实际复现、验收和交付回执入口见[本轮记录](../plans/yixiaoxiu-h5-performance/member-profile-2026-10-22.md)，原失败及实机 NOT_RUN 保留。

2026-10-21／22 H5客户端修订：[ADR-0037](../adr/0037_h5_session_resume_and_navigation.md)规定有限滑动会话、静默恢复与当前成员范围内的温导航；[ADR-0038](../adr/0038_h5_voice_capture_and_transcript_lifecycle.md)按用户选择继续默认企业微信录音，限定整数时长、转写归属、试听清理与可选浏览器录音。当前权限、等待后终检、留存、Ticket事实及持久开关默认值保持。不同候选的本地、CI、云端与实机结论分别见[会话验收](../plans/yixiaoxiu-h5-performance/resume-navigation-2026-10-21.md)及[录音续作](../plans/yixiaoxiu-h5-performance/voice-followup-2026-10-21.md)，合成测试不代替实机音质或Gate批准。

2026-10-20 H5 性能前向修订：[ADR-0036](../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)规定最小页面聚合读、受控缓存与媒体资源预算，新增性能读取独立默认关闭，原 V1/V2、当前权限终检、Ticket Core 与留存不变。2026-10-21续作允许有限封闭在途批次共同执行相同获权关系的来源扫描，每HTTP的Provider、初始投影及新语句／外层READ终检仍独立；实际物理SQL和每请求参与阶段双账记录，原2C4G与1.5秒预算不变。06完整大库时延仍FAIL后，进一步前向限定性能entry当前成员核验与BASE共用APP总2实际／32项，BASE仍最多1、默认及Bot／Gateway／发送规则保持；每HTTP实际核验、5秒含队列和底层实际settle占槽不变。07最终manifest `4b0fe5e35cb4305b4c98f63e61b2d0b2cae7d084e21ebd3438aa574604d2a7ce`已通过25入口197测试、原2CPU／4GiB下完整600正式＋90预热，home／request／department p95为1041.179／624.560／1204.216ms；首页整页从6 SELECT降为3，终检保留。同身份浏览器80样本及QA38通过，实机仍NOT_RUN，注册轮conhost回收及旧失败分别保留。用户仅在H5根目录本地配置显式开启，持久默认值仍false。本地实施及量化／未运行边界见[本轮记录](../plans/yixiaoxiu-h5-performance/README.md)；此记录不升级任何历史测试、部署或 Gate 事实。

本文件记录业务架构与 Gate 事实；带日期的测试数字与候选是其历史快照。TypeScript 迁移进度只在 [迁移执行入口](../plans/typescript-migration/README.md) 维护。PR #38 的认证仅属于其被测对象，P01 合并或新迁移候选检查通过均不等于新候选 READY 或生产批准。

2026-10-20 H5 前向修订：[ADR-0035](../adr/0035_yixiaoxiu_h5_multimedia_and_member_service.md)增加 React 双主题／双语言页面、Web 多媒体受理、催单事实、完成轮次评价和有限科室投影；沿统一 Ticket Core 扩展。064／065 增量迁移须显式执行，新开关默认关闭，原件保留和人员映射均按既有作用域约束。实现与实际验证入口见 [H5 执行记录](../plans/yixiaoxiu-h5-rebuild/README.md)；不授权部署、真实外联或 Gate 推进。

2026-10-20 前向业务修订：[ADR-0034](../adr/0034_mvp_notifications_and_application_members.md)规定 human-v1 群固定回应、每轮实际接单／开始与工作人员完工通知、按原群 Webhook 完工原生提及，以及 H5 应用可见成员自动身份和持久通知绑定。使用 063 增量迁移；兼容模式与持久 flags 默认值保持。实施和本地证据见[本轮记录](../plans/mvp-notifications-h5/README.md)，不改变下文历史 tested head、Gate 或现场批准。

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
- P2-G2 历史业务修订（前向调整见 ADR-0034）：三种入口均有效；群内最终闭环 @ 原报修人，单聊默认仅接单及最终关闭两次模板推送，其余节点可配置且默认关闭。故障受理不依赖资料补充成功。目标契约见 `evidence/p2-g2-three-entry-business-profile.md`，原976项为PR #7历史结果；当前成员入口及1044项完整回归已验证，证据已绑定；真实现场未运行。
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
