# AGENTS.md
# 医院信息故障智能报修助手开发规范 V1.2

## 唯一有效架构

本文件、`README.md`、`docs/architecture_baseline_status.md` 和 Accepted ADR 共同构成 V1.2 执行基线。发生冲突时，必须停止实现并先修正文档或新增 ADR。

## 阶段边界

### Gate 0：企业微信能力验证

- 只验证网络、SDK认证、消息类型、媒体、主动推送、卡片、重连和单活；
- 不建设完整业务；
- 未通过退出条件不得进入 Phase 1。

### Phase 1：企业微信外网试点

```text
Enterprise WeCom
    ↓
WeCom Gateway
    ↓
Channel Message
    ↓
Service Intake
    ↓
Pilot Ticket Core
```

- 独立 Pilot Ticket Core；
- 快速验证临床使用价值和服务闭环；
- 不依赖、也不直连医院内网 Tickets、SSO、Hub 或院内 Outbox；
- Pilot Ticket Core 是 Phase 1 工单事实源。

### Phase 2：AI 增强

- OCR、规则、分类、字段抽取和人工修正；
- AI 只产生建议，不改变核心受理事实；
- AI/OCR 关闭时 Phase 1 核心链路必须继续运行。

### Phase 3：医院融合

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

- 通过 Ticket Adapter 对接医院现有 Tickets；
- 保留可审计的 `ticket_external_mapping`；
- 完成迁移和切换后，Hospital Tickets 是唯一长期工单事实源；
- 禁止创建长期双工单体系。

## 绝对规则

1. 不允许把企业微信消息模型直接作为业务模型。
2. Channel Message、Service Intake、Ticket、Incident 必须分层。
3. 明确报修必须先受理，再 AI 增强。
4. AI 失败不能导致漏单。
5. AI 只能辅助分类，不得直接操作生产系统。
6. 所有消息必须幂等。
7. 所有状态变化必须产生事件。
8. 所有通知必须经过可靠发送机制。
9. Phase 1 不得依赖医院 Tickets。
10. Phase 3 前不得实现 Hospital Ticket Adapter 或生产同步。

## 开发要求

每个任务必须：

- 明确输入输出；
- 编写测试；
- 输出验收结果；
- 更新任务状态。

禁止：

- 跨阶段提前开发；
- 引入未经评估的大型基础设施；
- 创建长期双工单体系；
- 把历史或已废弃计划当作可执行任务来源。
