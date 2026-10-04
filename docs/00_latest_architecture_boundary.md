# V1.4 最新架构边界说明

完整状态见 `docs/architecture_baseline_status.md`。

## 当前阶段

P1 / P1-012 已完成，阶段结论为 `DONE / GO`。业务架构与 Gate 状态以 [业务架构/Gate 状态](architecture_baseline_status.md) 与 `plans/current_phase.json` 及其引用的既有 Evidence 为准；迁移进度以 [TypeScript 迁移执行入口](../plans/typescript-migration/README.md) 为准。已完成任务的历史停止线不替代后续独立授权。本轮类型迁移不推进业务 Gate，也不等同于生产、临床、真实外发、SSE 生产开放或 AI 自动回复批准。

## 长期工单事实源

本仓库 Unified Ticket Core 是唯一长期工单事实源。当前 `pilot_ticket.*` 只是其第一阶段物理实现，不创建第二套核心表。

## Phase 2

P2-001 的 Conversation Thread、Session、Conversation Item 与控制模式契约已经冻结；P2-002 的持久 Timeline Projector 与可重建投影已经完成。后续业务实施与生产启用须按各自授权执行，所有持久 Feature Flag 默认关闭。已授权 TypeScript 迁移继续遵守既有业务契约。

建设 Conversation Thread/Session、实时 Workbench、人工接管、统一 Communication Outbox、多轮 DeepSeek、媒体/OCR、Incident 和运营指标。固定放量顺序：Human-only → Shadow → Copilot → Controlled Auto。

## Phase 3

项目没有历史业务 Ticket。P3 只接入新的医院内网来源：

```text
Intranet Portal / Hospital API / Monitoring Alert
                    ↓
          Intranet Connector Agent
                    ↓
             Integration Inbox
                    ↓
       Service Intake / Ticket Action
                    ↓
          Unified Ticket Core
                    ↓
       Integration Outbox / Projection
```

P3 不做历史导入、未完结切换、旧状态兼容、双系统切换或旧系统退役。

## 核心禁止

- AI 前置建单；
- 浏览器或 AI Worker 直连企业微信 SDK；
- 外部来源直接写 Ticket 数据库；
- 内部备注外发；
- 群聊共享无用户隔离的 AI 上下文；
- 为不存在的历史数据增加产品主线；
- 未经独立授权推进后续业务任务、Gate 或任何 P3 任务；
- 启用任何 P2/P3 Feature Flag 或生产功能。
