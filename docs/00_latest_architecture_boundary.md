# V1.4 最新架构边界说明

完整状态见 `docs/architecture_baseline_status.md`。

## 当前阶段

P1 / P1-012 已于 2026-08-30 完成，阶段结论为 `DONE / GO`。项目负责人已独立授权启动 P2，当前状态为 `P2 / P2-001 / DONE / AWAITING_SEPARATE_AUTHORIZATION`。本轮授权的 ARCH-004 和 P2-001 均已完成；P2-002 及以后任务、P2-G1 和全部 P3 仍须另行授权。本授权不等同于生产上线、临床上线或 AI 自动回复批准。

## 长期工单事实源

本仓库 Unified Ticket Core 是唯一长期工单事实源。当前 `pilot_ticket.*` 只是其第一阶段物理实现，不创建第二套核心表。

## Phase 2

P2-001 的 Conversation Thread、Session、Conversation Item 与控制模式契约已经冻结。当前不实施其他 P2 内容；其余内容仍只是架构边界，不构成实施授权，所有 Feature Flag 保持关闭。

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
- 启动 P2-002 及以后任务、P2-G1 组装或任何 P3 任务；
- 启用任何 P2/P3 Feature Flag 或生产功能。
