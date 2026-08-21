# Architecture Baseline Status

- 基线版本：V1.2
- 生效日期：2026-08-21
- 状态：ACTIVE
- 当前阶段：G0 / READY
- 当前首个可执行任务：G0-001（尚未开始）
- 已完成前置任务：ARCH-001 Architecture Baseline Cleanup

## 1. 当前唯一有效架构

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

约束：

- Phase 1 在公网试点环境运行；
- Pilot Ticket Core 是 Phase 1 工单事实源；
- Phase 1 不依赖或直连 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox；
- 企业微信 Frame 只属于 Channel 层，不能成为 Ticket 业务模型；
- 明确报修先持久化、先受理，AI/OCR 后置；
- Ticket 状态、事件和通知保持事务与审计一致性。

### Phase 2：AI 增强

- 媒体、OCR、规则、AI分类、字段抽取、人工修正和 Incident 候选运行在异步链路；
- AI 失败或关闭时，Phase 1 核心链路继续运行；
- AI 不直接写 Ticket/Incident 状态，不执行生产操作。

### Phase 3：医院融合

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

约束：

- Ticket Adapter 负责契约隔离、幂等、状态/人员/附件映射、迁移和对账；
- 使用 `ticket_external_mapping` 保留 Pilot 与 Hospital Ticket 的可审计关系；
- 切换完成后 Hospital Tickets 成为唯一长期工单事实源；
- Pilot Ticket Core 按批准方案停止正式写入并转为只读或归档；
- 禁止长期双写、双编号、双状态或双通知事实源。

## 2. 已废弃架构

以下内容已废弃，不得作为实现依据：

1. Phase 1 直接调用或复用医院现有 Tickets；
2. Phase 1 依赖医院 SSO、Hub、灵动岛或院内 Outbox；
3. “Hospital Tickets 从项目第一阶段起就是唯一事实源”；
4. 旧路线 `G0 → P1可靠受理 → P2闭环 → P3 OCR → P4 AI → P5 Incident → P6试点`；
5. 旧任务 `P1-007 对接现有Tickets创建接口`；
6. 在 Phase 3 前实现 Ticket Adapter、Hospital Tickets 同步或生产双写；
7. 把 Pilot Ticket Core 建成长期第二套工单系统。

ADR-0002 已标记为 Superseded；当前执行 ADR 为 ADR-0007。

## 3. 当前 Phase

当前仍为 `G0：企业微信 WebSocket 能力验证`：

- ARCH-001 已完成，但不改变产品阶段；
- G0-001 尚未执行；
- 所有 G0 任务仍为 TODO；
- Gate 0 只验证连接和平台能力，不实现 Pilot Ticket Core；
- 未通过 G0-008 不得进入 Phase 1。

## 4. 后续迁移路径

1. G0 验证真实企业微信能力并冻结 SDK/连接策略；
2. Phase 1 在公网构建 Pilot Ticket Core，完成无AI可靠闭环和试点评审；
3. Phase 2 在 Pilot Core 之上异步增加 AI/OCR、Incident 和指标；
4. Phase 3 盘点 Hospital Tickets 真实契约并冻结映射 ADR；
5. 实现 Ticket Adapter 与 `ticket_external_mapping`；
6. 执行幂等迁移、状态/附件/通知对账和回滚演练；
7. 正式切换 Hospital Tickets 为唯一长期事实源；
8. Pilot Ticket Core 停止正式写入并按批准方案只读或归档。

## 5. 文档权威顺序

发生冲突时按以下顺序处理：

1. `AGENTS.md` 的绝对规则；
2. 本文件的架构状态；
3. Accepted 且未被取代的 ADR；
4. `plans/current_phase.json` 与 `plans/roadmap.md`；
5. 其他详细文档、Contract、Schema、示例和历史来源。

发现下层资料冲突时，必须先修正文档或提出 ADR，不得自行选择旧架构实现。

## 6. 历史与废弃文件处理

- `source/` 保留原始来源，只用于追溯，不是执行基线；
- ADR-0002 保留但明确标记 Superseded；
- 旧 P1–P6 计划和任务文件已删除，由 P1/P2/P3 新文件替代；
- V1.0 静态哈希清单已废弃，发布时应基于最终 Git 提交重新生成校验清单；
- `database/schema_draft.sql` 属于旧架构草案，未在本次文档任务中改写可执行 SQL；在 P1-005 前不得实施。
