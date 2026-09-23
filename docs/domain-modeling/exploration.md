# 项目探索与目标差异

## 核验范围

2026-09-22 在 `D:/Projects/Fault-Reporting-WeCom-Assistant` 探索。开始时工作区干净，分支 `codex/workbench-auth-review-fixes`，本地 HEAD `87b12ab6d0929fc069326a58159917cda075a4a4`，origin 为 `peterkis/Fault-Reporting-WeCom-Assistant`。该 SHA 只标识此次本地设计输入，不是 GitHub 审核对象或被测发布头证明。

已对 Git 跟踪文件做全项目目录盘点：176 个 src 文件、254 个 tests 文件、126 个 contracts 文件、22 个 database 文件、16 个 web 文件、22 个 ADR、11 个架构图、92 个原有 docs 文件。扫描模块依赖与企业微信调用位置，重点阅读架构基线、既有词汇、身份、跨渠道关联、规则路由、工单状态/责任、通知发送、网页自助编排、补充和成员访问边界。

这是全项目结构探索加核心业务纵向抽查，不是逐行审计全部代码；254 个测试文件不是 254 项测试通过。1128 个 evidence 文件仅盘点并定位引用，没有重新验证其历史结论。未读取运行密钥，未访问云数据库，未重新执行历史 readiness 或现场流程。

发布说明：用户后续授权提交、推送、新建 PR 和请求 Codex review。本工作包单独发布于 `codex/domain-language-design`，以 GitHub main 的 `627d5f72959b4b2a085d734c311712363f87a3f8` 为起点；上述探索 SHA 仍保留为真实阅读输入，不包含 PR #21 的后继修复提交。

## 目录职责

| 范围 | 当前职责 | 设计处理 |
| --- | --- | --- |
| `src/g0-*`、`source/` | 企业微信能力探测、冻结依据 | 保护历史能力边界；不能当业务运行入口 |
| `src/p1-*` | SDK 转换、Inbox、受理、工单、通知、权限与关闭 | 保留真实事实源；逐步抽取边界 |
| `src/p2-001` 至 `p2-006` 相关模块 | 会话、投影、实时、通信、控制、工作台 | 归入会话协作、可靠通信及接口层 |
| `src/p2-007-*`、`p2-015-*` | 确定性分析、旅程、关联、人工复核与安全动作 | 归入受理编排；区分纯规则和持久化应用服务 |
| `src/p2-016-*` | 工单工作台、双责任、报修人访问、模板卡片 | 拆清工单用例、查询投影、通知策略和发送适配 |
| `src/p2-012-*` | 人工确认公共故障及订阅 | 保持独立领域边界 |
| `src/p2-g1-*`、`p2-g2-*` | 运行装配、OAuth、身份映射、验证 | 按真实职责定位，不能全归入 domain |
| `src/yxx-self-service-*` | 原生网页报修、补充、成员查询、编排与验证 | 医小修入口复用受理和工单核心 |
| `src/platform/` | 时间、PostgreSQL 等通用设施 | 是通用基础的种子，不承担业务规则 |
| `web/p2-workbench/`、`web/p2-reporter/` | 现有内部工作台、报修人页面 | 双体验的现有起点；不是已完成的 Notion/Tauri 产品 |
| `contracts/`、`database/`、`tests/` | 契约、持久化约束、分层验证 | 接口演进同步更新；不重写旧迁移 |
| `adr/`、`architecture/`、`docs/` | 决策、结构和运行说明 | 区分现行决策与历史文本 |
| `plans/`、`tasks/`、`tickets/`、`prompts/` | 阶段、任务、授权和交接 | 本次不推进既有任务/Gate 状态 |
| `scripts/`、`.github/`、`evidence/` | 工具、CI、审核和验收证据 | 不属于业务领域，不借设计工作重建历史证据 |
| `config_examples/`、`examples/` | 配置契约和样例 | 承载可配置策略，不决定业务事实 |

## 代码证据与差异

| 主题 | 当前可核验依据 | 目标与缺口 |
| --- | --- | --- |
| 单一工单事实源 | [ADR-0010](../../adr/0010_unified_ticket_core_source_of_truth.md)、[工单动作](../../src/p1-006-ticket-state-actions.mjs) | 已有基础；禁止另建长期双写 Ticket |
| 四条路径 | [ADR-0014](../../adr/0014_p2_007_hybrid_provider_context_continuation_ref.md)、[ADR-0021](../../adr/0021_yixiaoxiu_self_service_contracts.md)、[网页编排](../../src/yxx-self-service-orchestrator.mjs) | 三种 Bot 旅程模式加 WEB_FORM；网页不伪造 Bot 会话 |
| 人工复核与最小工单 | [决策路由](../../src/p2-015-decision-router.mjs) | 已允许明确故障同时建最小 Ticket 和待复核项，不能改成低置信度一律不建单 |
| 解决与关闭 | [状态动作](../../src/p1-006-ticket-state-actions.mjs)、[生命周期说明](../59_p2_016_ticket_lifecycle_and_responsibility.md) | 已有 RESOLVED / CLOSED / REOPENED；需统一产品用词和 H5 操作 |
| 责任分配 | [转派](../../src/p2-016-ticket-assignment.mjs)、[命令门面](../../src/p2-016-ticket-command-facade.mjs) | 已有接单、转派；独立派单、撤销派单语义尚需新契约，不能用 cancel 代替 |
| 通知时机 | [通知策略](../../src/p2-016-ticket-notification-policy.mjs) | 默认仅 accepted / closed；目标 assigned / resolved / 重开后 assigned 是行为变更 |
| 通知渠道 | [现有发送器](../../src/p2-016-wecom-sender.mjs) | 现有模板卡片通过 WECOM_AIBOT 和 gateway client.sendMessage；不是医小修应用消息通道 |
| 来源路由（用户后续决定） | [ADR-0023](../../adr/0023_origin_based_notification_routing.md) | Bot 来源私聊；H5 来源应用模板消息；群来源含转单聊采用“消息推送”强 @ 加 Bot 私聊；Bot 收到群 @ 后仅私聊回复。能力选择已明确，项目接入与现场效果本次未测 |
| 网页不外发 | [ADR-0021](../../adr/0021_yixiaoxiu_self_service_contracts.md) | APP_ONLY 明确不生成 Message/Outbox/Delivery；新通知需求须先形成后继决策，不能默认启用 |
| 身份映射 | [ADR-0013](../../adr/0013_p2_007_wecom_directory_person_identity_authority.md)、[ADR-0019](../../adr/0019_yixiaoxiu_delegated_identity_mapping.md)、[映射实现](../../src/p2-g2-yixiaoxiu-delegated-identity.mjs) | 长期 Person 已有设计，运行仍有绑定/快照/Principal 等不同表示；不能声称完整人员主数据已落地 |
| 成员与员工认证 | [成员授权](../../src/p2-g2-yixiaoxiu-authorizer.mjs)、[工作台认证](../../src/p2-016-workbench-wecom-auth.mjs) | 同一个自然人不代表同一权限会话；H5 成员 Cookie 不能获得工作台角色 |
| 补充和反馈 | [补充手册](../runbooks/yixiaoxiu-self-service-supplement.md)、[网页补充](../../src/yxx-self-service-supplement.mjs)、[H5 HTTP](../../src/yxx-self-service-native-http.mjs) | 已有补充和终态限制；已有底层 confirm/reopen 不等于已交付 H5 反馈、确认、申请重开闭环 |
| 可靠外发 | [Sender Port](../../src/p2-004-communication-sender-port.mjs) | 已区分 ACKNOWLEDGED / REJECTED_NOT_APPLIED / UNKNOWN；API 接受不是用户已读 |
| 企业微信基础能力 | [Token](../../src/p2-g2-wecom-app-token.mjs)、[SDK Gateway](../../src/p2-g1-wecom-gateway.mjs)、OAuth/身份/工作台认证模块 | 已有局部封装；SDK、HTTP 处理和业务组装仍散布于阶段命名模块，尚未形成目标模块布局 |

## 已发现的文档歧义

- 用户进一步明确“消息推送”承担来源群强 @，Bot 群内接收 @ 后仅私聊回复。旧 ADR-0016 的群内即时回复/WSS 群回复方向与本次目标不同，由 ADR-0023 记录后继设计；历史参考原文保持不变，不作为新方案的群回复实现依据。

- 旧 CONTEXT.md 同时包含词汇、投影算法、认证端口和阶段交接，且仍有过时状态快照。本次原文保留在 [参考文件](conversation-context-reference.md)，根词汇表只承担领域语言。
- [旧状态说明](../06_ticket_state_and_notification.md) 开头仍写“Phase 3 迁移到 Hospital Tickets”，与 V1.4 和 ADR-0010/0012 冲突；其 `DUPLICATE_LINKED` 也不能被误当已启用动作。本次不据此增加状态或旧系统迁移范围。
- “template_card”描述载荷形式，不能证明发送者是医小修应用。“已发送”不能覆盖未知结果、平台接受、用户已读等不同事实。
- README / 基线文档同时保留多次历史快照，不能用旧测试数量判定当前就绪。本次只使用其领域和阶段约束，不复述为新验收。

## 尚需产品定稿的细节

默认建议是“解决后通知、报修人确认关闭；未恢复可申请重开”，超时关闭窗口不在本次擅定。实施前需冻结：关闭窗口、撤销派单权限与进行中处理方式、重开自动批准条件、转派是否外发。来源群的状态 @ 加 Bot 私聊已由用户明确，不再列为待定；消息推送的安全文案、项目接入与强 @ 现场验收仍需落实。默认草案见设计正文；这些问题不阻碍分层和统一语言落稿。

## 本次验证

仅文档变更：核对文件路径、相对链接、词汇与现有契约差异、Git diff 和原 CONTEXT 保存一致性。未运行运行时/数据库/浏览器测试，不声称现有能力通过新的验收；无数据库变更、Feature Flag 变更或外部写入。
