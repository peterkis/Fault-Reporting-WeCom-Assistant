# P2-001 Conversation Thread、Session 与控制模式契约

## 状态

`DONE`（2026-08-30）

Phase 2 已获项目负责人独立授权；本任务完成后无活动实施任务。P2-002 及以后仍须另行授权。

## 输入

- V1.4 架构基线与 Accepted ADR-0010、ADR-0011、ADR-0012；
- P1 已持久化的 Normalized Channel Message 与 Service Intake 契约；
- `evidence/p2-phase-start-authorization.md` 的范围和停止线。

## 输出与 Contract

- Conversation Thread：以 `provider + channel_account_id + chat_type + external_thread_key` 为无歧义自然身份，并生成不回显外部标识的稳定 `thread_key`；
- Conversation Session：按 Thread 与 Participant 保证单个活动 Session，可空引用 Service Intake，不复制 Ticket 状态；
- Session 创建同幂等键、同规范化输入返回原记录；同键不同输入返回稳定冲突；
- Conversation Item：只冻结 JSON Schema/TypeScript vocabulary，持久化、投影和顺序实现保留给 P2-002；
- 新 Session 默认 `HUMAN`；`COPILOT` 需要后续 AI Flag，`AUTO` 在 P2-001 中始终因缺少 P2-010/P2-G4 授权而失败关闭；
- Session 状态为 `OPEN / WAITING_USER / ENDED`，`ENDED` 不可复活；
- 唯一用户消息、真实控制模式变更与结束才推进 generation/row version，重复与 no-op 不推进；
- 公共失败只返回稳定 `CONVERSATION_*` 错误码，不回显 SQL、原始异常或外部标识。
- 公共 Workbench Session 视图排除 Participant key、scope digest 与创建幂等键。

## 数据库变更

- 新增 `database/migrations/010_p2_001_conversation_contracts.sql`；
- 只创建 `conversation.thread` 与 `conversation.session`；
- Thread 自然身份和 `thread_key` 均唯一；
- Session 创建命令幂等键唯一，scope 可复用且不唯一；
- 同一 `(thread_id, participant_key)` 只允许一个非 `ENDED` Session；
- `service_intake_id` 为可空、受外键约束的引用；
- Schema、约束和索引漂移返回 `P2_001_SCHEMA_DRIFT_REMEDIATION_REQUIRED` 并失败关闭。

## 测试与验收

- Contract/Unit：覆盖单聊、群聊、多 Bot、参与人/Intake 隔离、边界、状态机、控制模式、版本、错误映射、Flag 关闭和迁移停止线；
- PostgreSQL Integration：使用随机命名隔离数据库验证重复迁移、唯一性、单活、多个历史 Session、幂等创建、外键和 Schema 漂移；
- 架构回归：验证 P1 `DONE / GO` 保留、P2-002+ 与 P3 仍为 `TODO`、所有 Feature Flag 为 `false`；
- 证据：`evidence/p2-001-conversation-contracts-report.md`。

## 安全、隐私与资源上限

- Thread/Session 派生键使用 SHA-256 opaque digest，测试和 Evidence 不记录 Bot ID、用户 ID、群 ID、患者信息、数据库 URL 或 Secret；
- Feature Flag 关闭时不会调用数据库或外部 seam；
- 无真实企业微信外发、模型、医院内网、生产或临床连接；
- 不新增常驻进程，迁移运行器连接池上限为 1，2C4G 边界不变。

## Feature Flag

所有 P2/P3 Feature Flag 保持 `false`。P2-001 只冻结契约，不启用 Conversation Center 或 AI 能力。

## Rollback / 关闭方式

- 运行时关闭方式是保持全部相关 Feature Flag 为 `false`，P1 路径不依赖新表；
- 本轮数据库验证只在隔离数据库执行并完成清理；未对生产或临床数据库执行迁移；
- 如未来授权环境需撤销空表，必须另立受审迁移，不使用破坏性临时命令，也不改写既有迁移。

## 停止线

P2-001 完成即停止。不得启动 P2-002、P2-G1 或任何本轮未授权能力。
