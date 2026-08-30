# V1.4 最新架构边界说明

完整状态见 `docs/architecture_baseline_status.md`。

## 当前阶段

当前仍为 P1 / P1-012。V1.4 不改变 G0/P1 已完成成果，也不授权提前启用 P2/P3。

## 长期工单事实源

本仓库 Unified Ticket Core 是唯一长期工单事实源。当前 `pilot_ticket.*` 只是其第一阶段物理实现，不创建第二套核心表。

## Phase 2

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
- 在 P1-012 完成前启用生产 P2/P3 功能。
