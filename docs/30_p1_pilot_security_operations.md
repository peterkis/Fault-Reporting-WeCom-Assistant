# 30. P1-011 Pilot 安全、可观测性与运维基线

- 状态：DONE（本机 PostgreSQL 集成与本机加密备份恢复演练；非公网、非临床试点验收）
- 运行时接缝：`createPilotOperationalIntake(...)`、`createPilotSecurityLogger(...)`、`createPilotReadinessService(...)`、`createCoreIntakeSafetyBoundary(...)`、`createPilotOperationsService(...)`

## 安全边界

普通运行日志仅允许事件、`trace_id`、`msg_id`、稳定状态/错误码、耗时和哈希化 actor/chat 标识。
任何 Secret、患者自由文本、媒体 URL、临时 `upload_id`/`media_id`、原始文件名与附件数据只能在
`details` 中被扫描后丢弃，不能进入输出记录。日志身份哈希密钥必须由运行环境受控注入，不能写入
仓库、浏览器、证据或告警。

最小处理端的 HTML、CSS、JavaScript 分离为同源静态资源；响应使用同源 CSP、`nosniff`、拒绝嵌入和
`no-referrer`。CSP 不使用 `unsafe-inline` 或 `unsafe-eval`。边缘 TLS、真实反向代理和生产身份认证
仍须在公网 Pilot 进入前独立验证。

`operations.audit_event` 是追加式审计表：metadata 只有备份/恢复/告警允许字段，不可放置原始文本、
媒体引用、路径、数据库 URL 或密钥。普通角色不能读取；`ADMIN` 读取会追加 `audit.accessed` 事件。
审计记录引用的 principal 不能被删除，以避免 `ON DELETE SET NULL` 反向修改不可变审计。
`event_key`、trace 和 metadata 都有数据库白名单/格式约束；ADMIN 授权、访问审计写入和读取在同一事务内完成，
避免角色撤销后的检查与读取分离。

## 可观测性与降级

`postgres`、`intake`、`outbox` 是核心就绪依赖；任一失败使 `pilot_core_readiness=0` 并激活 P1
`PILOT_CORE_UNAVAILABLE`。`redis`、`ai`、`ocr`、`object_storage` 仅能作为可降级依赖，失败记录
`pilot_optional_dependency_degraded_total{dependency}` 和固定 P2 告警，不能推翻已完成的核心受理结果。

`createPilotOperationalIntake(...)` 是实际的 `Channel Message Inbox → Service Intake → Pilot Ticket → Outbox`
组合入口：先提交核心受理事务，再执行可选增强；即使 Redis/AI 等增强失败，已提交的 Intake/Ticket 保持可返回。
普通日志只在该提交结果之后写入，且使用派生关联标识与 HMAC 身份摘要。日志写入器可同步或异步完成：异步
成功会清除、异步失败会激活固定 `PILOT_SECURITY_LOG_WRITE_FAILED`，两者均不会阻塞或回滚已提交工单。

敏感日志拦截产生 `PILOT_SENSITIVE_LOG_REJECTED`，告警范围只能是固定的脱敏分类，不能包含被拒绝的值。
所有 metric label 均为白名单，禁止把用户、群、工单、文件、媒体或 Secret 作为 label。

## 备份与恢复

`scripts/p1-011-backup-restore.mjs` 通过 `pg_dump` 的标准输出流直接写入 AES-256-GCM 加密工件；不会先把
明文 dump 写入磁盘。恢复时先以不落盘的丢弃流验证 GCM 认证标签，验证通过后才将加密工件解密到
`pg_restore` 标准输入，临时恢复库固定为
`p1_011_restore_<随机值>`，完成后删除。脚本只通过子进程环境传递 PostgreSQL 密码，不把密码置于命令参数、
证据或审计元数据。

加密工件生成后会先持久化安全检查点；恢复/核验/清理失败会追加稳定失败码（无检查点时仍追加失败审计）并激活
`PILOT_RESTORE_DRILL_FAILED`。`assessBackupFreshness({ maximumAgeMs })` 由获批的巡检计划按备份制度调用，
过期或缺失检查点才激活 `PILOT_BACKUP_STALE`。

运行环境必须安全注入下列变量，而非写进 `.env.example`、日志或命令历史：

- `PILOT_LOG_IDENTITY_HASH_KEY`
- `PILOT_BACKUP_ENCRYPTION_KEY`：Base64 编码的 32 字节密钥
- `PILOT_BACKUP_ENCRYPTION_KEY_ID`：不含密钥材料的标识
- `PILOT_BACKUP_RETENTION_DAYS`

可选 `PILOT_PG_BIN` 指向 PostgreSQL 工具目录，`PILOT_BACKUP_WORK_DIRECTORY` 指向受控临时目录。实际演练还
必须显式设置 `PILOT_BACKUP_RESTORE_DRILL_APPROVED=true`；这项保护避免误创建临时数据库。

```text
npm run p1:011:migrate
npm run test:p1:011:integration
npm run p1:011:backup-restore:check
$env:PILOT_BACKUP_RESTORE_DRILL_APPROVED = 'true'
npm run p1:011:backup-restore:drill
Remove-Item Env:PILOT_BACKUP_RESTORE_DRILL_APPROVED
```

备份检查点只保存 `backup_id`、SHA-256、字节数、密钥标识和留存截止时间；恢复演练只保存稳定的成功/失败码和
已核对对象数量。二者都不保存 dump 路径、对象 URL、密码、加密密钥或业务载荷。
本机演练工件会在清理时删除，因此检查点的留存字段是受控备份制度的接口元数据，并不证明存在长期保留的生产备份。

## Runbook

### 核心依赖不可用

1. 查看固定 P1 告警和 `pilot_core_readiness`，不从错误日志复制 Secret 或患者文本；
2. 仅在 Channel Message 已可靠落库的前提下维持待补建队列；没有真实 Ticket 不得伪造工单号；
3. 修复 PostgreSQL、Intake 或 Outbox 后重做就绪检查，并按幂等键补建/补发；
4. 核对 Channel Message、Intake、Ticket、Outbox 与 Delivery，保留审计事实。

### 疑似敏感日志

1. 停止相关日志导出和不必要的媒体访问；
2. 只读取 `PILOT_SENSITIVE_LOG_REJECTED` 的固定分类，不复制被拒绝内容；
3. 轮换可能暴露的 Secret，并修复调用点；
4. 由 `ADMIN` 查询追加式审计，完成脱敏回归测试后恢复。

### 恢复演练或恢复

1. 先执行 `p1:011:backup-restore:check`；
2. 明确获得演练授权并注入临时/受控加密密钥；
3. 运行恢复演练，核对稳定成功/失败码、对象数、固定告警和临时库清理结果；
4. 真实事故恢复仍须按医院备份制度、RTO/RPO 和变更审批执行，不能把本机演练当作生产恢复证明。

## 验收边界

本任务证明本机 Node/PostgreSQL 接缝、追加式运维审计、受控加密流和临时恢复库行为。它没有验证公网边缘、
真实企业微信客户端可见性、真实患者数据、医院密钥系统、对象存储、Redis/AI/OCR 服务或临床试点。P1-012
仍需单独执行 E2E、故障演练和 Go/No-Go。
