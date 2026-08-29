# P1-005 至 P1-010 Pilot Ticket Core 闭环验收报告

- 验收日期：2026-08-29
- 环境：Windows 本机、Node.js `24.18.0`、本机 PostgreSQL
- 结论：DONE（本机 PostgreSQL 集成验收；非公网、非真实企业微信发送/卡片、非客户端可见、非临床试点验收）
- 后续任务：P1-011 保持 TODO，未在本轮启动

## 1. 授权与范围

项目负责人明确要求使用 `implement` skill 完成 P1-005 至 P1-010。本轮只实现独立
Pilot Ticket Core 及其 Phase 1 闭环：Ticket 建立与编号、显式 Action/事件、Pilot
Outbox/Delivery、提交后首次确认、Pilot-local 权限工作台、补充和关闭/重开。

未实现或连接 Hospital Tickets、Ticket Adapter、医院 SSO、医院人员主数据、医院 Hub、
院内 Outbox、AI/OCR 或生产同步。企业微信发送器与卡片均通过注入式/合成实现边界测试；
没有凭借其成功推断真实租户 ACK、客户端显示、播放、点击、提醒或临床人员观察。

## 2. 交付物与关键不变量

| 任务 | 交付 | 已验证的不变量 |
|---|---|---|
| P1-005 | `pilot_ticket.ticket`、编号、Intake 关联 | 双向一对一、编号唯一、重放不重复建单、回滚不遗留关联。 |
| P1-006 | 命名 Action 与 `ticket_event` | 合法转换、版本冲突、顺序审计、内外部备注隔离；拒绝未建 Incident 的关联动作。 |
| P1-007 | Outbox、Delivery、Attempt Worker | 状态/事件/Outbox 同事务；矩阵、逐目标限流、租约、重试、死信与目标幂等。 |
| P1-008 | 首次确认编排 | 仅提交后尝试；重放不重复发送；暂时失败只返回真实临时信息。 |
| P1-009 | Pilot principal/role/team/workbench | 注入认证、按角色/处理组授权、申报人不见内部备注、人工端不可自动关闭。 |
| P1-010 | 补充、卡片任务/回执、关闭重开 | actor/过期/重放保护；关闭前提醒；`AUTO_TIMEOUT` 与用户确认可区分。 |

## 3. 实际核验

### 3.1 迁移

```text
npm run p1:010:migrate
```

结果：成功，输出 `pilot_ticket.ticket_supplement`、
`pilot_ticket.ticket.auto_close_reminder_at`、`notification.card_action_task` 与
`notification.card_action_receipt`；该命令按顺序应用 P1-003 至 P1-010 的增量迁移，含
P1-010 的既有数据/约束复核迁移。

### 3.2 P1-005 至 P1-010 串行 PostgreSQL 回归

```text
node --env-file=.env.pilot --test --test-concurrency=1 \
  tests/p1-005-pilot-ticket-core.test.mjs \
  tests/p1-006-ticket-state-actions.test.mjs \
  tests/p1-007-notification-outbox.test.mjs \
  tests/p1-008-first-acknowledgement.test.mjs \
  tests/p1-009-pilot-access-workbench.test.mjs \
  tests/p1-010-ticket-closure.test.mjs
```

结果：`18/18` 通过，`0` 失败、`0` 跳过。覆盖编号冲突、创建回滚、双向 Intake/Ticket
约束、并发接单、拒绝未建 Incident 的关联动作、Outbox 回滚、发送超时与重试、并发 Worker 租约、
死信、可执行矩阵和并发安全的逐目标限流、提交后确认与临时失败回复、重放、越权/内部备注隔离、
人工端禁止自动关闭、移动端 viewport、补充、错误/过期/重复卡片、关闭前提醒、确认关闭、
自动关闭和重开。

### 3.3 全仓串行回归与静态检查

```text
node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs
```

结果：`147/147` 通过，`0` 失败、`0` 跳过。P1-005 至 P1-010 的 source、迁移脚本和
测试通过 `node --check`；任务状态 JSON 均可解析；`test:g0:008` 同步验证当前任务指针
为 `last_completed_task=P1-010`、`next_task=P1-011`。

## 4. 结论限制

这些结果支持 P1-005 至 P1-010 的本机 PostgreSQL 集成验收和任务状态更新；不支持
“公网已上线”“企业微信客户端已收到/显示卡片”“用户已点击按钮”“临床闭环通过”或
Phase 1 Go/No-Go。P1-011 的安全、可观测性、备份恢复和运行基线仍须单独实施与验收。

## 5. Code Review 与 TDD 复核

- Standards 初审指出目标限流的并发竞争和工作台 `auto-close` 路由组合依赖；修复为
  PostgreSQL 目标事务锁、有效 `SENDING` 配额预留、核心 `SYSTEM` actor 限制与路由硬拒绝，
  最终复审为 `No findings`。
- Spec 初审还指出未建立 Incident 事实即进入 `DUPLICATE_LINKED`；P1 已拒绝该 Action，
  将 Incident 关联状态/事件留给 Phase 2。双轴最终复审均为 `No findings`。
