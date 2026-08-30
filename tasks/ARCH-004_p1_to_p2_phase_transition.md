# ARCH-004 P1 → P2 阶段状态切换

## 状态

`DONE`（2026-08-30）

## 输入

- P1-012 `DONE / GO` 结论及项目负责人批准 Evidence；
- 项目负责人对 Phase 2 的独立启动授权；
- V1.4 权威架构基线、Accepted ADR 与机器可读 Backlog。

## 输出

- 当前阶段切换为 `P2 / IN_PROGRESS`；
- `last_completed_task` 保持 `P1-012`，`active_task` 设置为 `P2-001`；
- 仅 `P2-001` / `P2-A` 获授权，P2-002 至 P2-014 以及全部 P3 任务保持 `TODO`；
- 全部 P2/P3 Feature Flag 保持 `false`；
- P1 退出结论、完成日期与 Evidence 路径原样保留。

## Schema / Contract / 数据库

- 无业务 Schema 或 Contract 变更；
- 无数据库变更、无迁移、无数据库连接；
- 本任务只切换架构和计划状态，P2-001 契约实现由 P2-001 自身负责。

## 验证

- V1.4 架构静态校验；
- V1.4 架构基线测试；
- G0-008 冻结回归测试，确认历史完成事实未被改写；
- JSON 可解析性、文档边界和 Feature Flag 默认关闭检查。

## 安全、隐私与资源上限

- 未读取或修改 `.env.pilot`；
- Evidence 不记录 Secret、数据库密码、Bot ID、用户 ID、群 ID或患者信息；
- 不连接真实模型、企业微信真实外发、医院内网或任何生产/临床依赖；
- 不新增常驻进程，2C4G 资源上限不变。

## Feature Flag

所有 P2/P3 Feature Flag 继续为 `false`。阶段授权本身不构成启用授权。

## Evidence

- `evidence/p2-phase-start-authorization.md`
- `evidence/p1-012-project-owner-go-approval.md`

## Rollback / 关闭方式

在未开始后续获授权实现且未产生外部副作用的前提下，可由项目负责人撤销 Phase 2 授权，并通过新的受审状态变更将当前阶段恢复为等待授权状态。禁止以回滚为由改写 P1 `DONE / GO` 事实或删除 Evidence。

## 停止线

ARCH-004 完成后只允许继续本轮已授权的 P2-001。P2-001 完成后必须停止；不得启动 P2-002 或 P2-G1。
