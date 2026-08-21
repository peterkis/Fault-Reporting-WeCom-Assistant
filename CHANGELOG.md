# Changelog

## [1.2.0] - 2026-08-21

### Architecture Baseline Cleanup

- 冻结唯一阶段模型：`G0 → Phase 1 公网试点 → Phase 2 AI增强 → Phase 3 医院融合`。
- Phase 1 工单事实源改为独立 Pilot Ticket Core，不依赖医院内网 Tickets。
- Phase 3 通过 Ticket Adapter 映射、迁移并切换至 Hospital Tickets。
- ADR-0002 原“Phase 1 直接复用现有 Tickets”决策标记为 Superseded。
- 旧 G0–P6 计划和任务编号撤销执行资格，重建 V1.2 路线图与 Backlog。
- 新增 `docs/architecture_baseline_status.md` 作为架构状态入口。

### Constraints

- 本次仅整理架构文档、计划、任务和配置说明；未修改应用实现，未进入 G0-001。

## [1.0.0] - 2026-08-20

### Added

- 将原始方案整理为 Agent 可执行的 PRD 开发规格包。
- 增加 `AGENTS.md`、分阶段路线图、任务明细和机器可读 Backlog。
- 增加 Service Intake、Incident、Reporter Subscription 领域模型。
- 增加企业微信 WebSocket Gate 0 能力验证计划。
- 增加消息识别、字段抽取、工单转换和公共故障关联详细规则。
- 增加 OpenAPI、JSON Schema、数据库草案、配置示例和验收场景。
- 增加安全合规、数据生命周期、可观测性和故障演练要求。

### Changed（已被 V1.2 部分取代）

- WebSocket 长连接作为主接入方案，公网 HTTP 回调仅作为备选。
- AI 从建单前置环节调整为异步增强。
- “5 分钟同类别并单”调整为 Incident 候选关联。
- 群内全量状态广播调整为“群内公共信息 + 单聊个人进度”。
- 原计划在首期复用医院现有 Tickets、Hub、SSO、API 平台和 Outbox；该首期拓扑已被 V1.2 的 Pilot Ticket Core 方案取代。Hospital Tickets 延后至 Phase 3 融合。

### Source Preservation

- 原始文档保留在 `source/企业微信智能机器人方案.docx`。
