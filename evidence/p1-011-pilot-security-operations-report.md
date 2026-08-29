# P1-011 Pilot 安全、可观测性与运维基线验收报告

- 验收日期：2026-08-29
- 环境：Windows 本机、Node.js `24.18.0`、本机 PostgreSQL 18
- 结论：DONE（本机 PostgreSQL 集成与加密备份恢复演练；非公网、非真实企业微信客户端、非临床试点验收）

## 范围与实现

P1-011 仅实施 Phase 1 Pilot Ticket Core 的安全/运维基础：结构化脱敏日志、固定标签指标与告警、核心/可降级
依赖边界、ADMIN 审计访问、不可变审计、加密逻辑备份和隔离恢复演练。没有新增 Hospital Tickets、医院 SSO、
Hub、院内 Outbox、Ticket Adapter 或生产 AI/OCR。

`createPilotOperationalIntake(...)` 已把上述边界接入真实的 Channel Message Inbox→Service Intake→Pilot Ticket→Outbox
组合：核心事务先提交，之后可选 Redis/AI 等增强失败仅记录固定降级信号，不能回滚已提交 Intake/Ticket。

`operations.audit_event`、`operations.backup_checkpoint` 和 `operations.restore_drill` 通过
`009_p1_011_pilot_operations_baseline.sql` 建立。审计 metadata 白名单拒绝自由文本、媒体引用、路径、URL 和
Secret；UPDATE/DELETE 触发器返回稳定的 `P1_011_AUDIT_IMMUTABLE`。审计依赖的 principal 使用 `ON DELETE RESTRICT`，
避免外键副作用篡改历史。

## 自动化验证

以下定向用例覆盖：

- Secret、患者内容、媒体 URL 与身份原文不进入结构化日志；
- Redis/AI 等可选依赖失败只产生降级指标，已持久化核心受理结果仍返回；
- 真实 Inbox→Intake→Ticket→Outbox 组合在 AI 失败时仍创建 Ticket，普通日志不含原始消息、身份或 Secret；
  可选增强失败会产生固定降级告警，异步日志成功/失败分别清除/激活固定日志告警，均不回滚已提交 Ticket；
- 核心依赖失败和敏感日志拒绝只产生固定告警代码/范围；
- Pilot Workbench 使用同源 CSP 和外置 CSS/JS，无内联脚本；
- ADMIN 审计读取、非 ADMIN 拒绝、备份/恢复成功和失败检查点、备份过期告警及不可变审计；
- AES-256-GCM 工件不包含明文载荷，且仅在 GCM 认证通过后才可精确流式恢复；
- PostgreSQL 工具参数不含数据库密码，`--check` 不输出数据库密码或备份密钥；启动失败会产生固定恢复告警和无载荷失败上下文。

带库全量串行回归命令
`node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs` 结果为 `158/158` 通过、`0` 失败。
仓库的迁移集成测试共享同一个 PostgreSQL schema，因此使用串行并发度避免并行 DDL 相互等待；这不构成公网、客户端或临床验收结论。

## 本机恢复演练

受控演练成功输出（不含密钥、数据库 URL 或载荷）：

```json
{
  "event": "p1_011_backup_restore_drill_succeeded",
  "backup_id": "backup-9d980cb0-e715-4227-bcea-1191f6f06b64",
  "checksum_sha256": "34402116826dd7910b7036a8204355a20fa60abce452c7f2605ca277347a4908",
  "size_bytes": 85997,
  "restore_id": "restore-2f8d9c42-c121-4033-9b89-e3d51a09c25e",
  "verified_object_count": 13,
  "status": "SUCCEEDED"
}
```

演练后的只读核验：临时恢复数据库数为 `0`，最近恢复记录为 `SUCCEEDED`，对象核对数为 `13`。

## 结论限制

本机演练的加密工件会被清理，不代表医院生产备份留存制度、密钥托管、真实公网部署、客户端显示、真实附件、
Redis/AI/OCR、对象存储或临床验收。P1-012 仍须单独执行全链路、容量、安全和试点 Go/No-Go。
