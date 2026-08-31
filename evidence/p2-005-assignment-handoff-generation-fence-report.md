# P2-005 Assignment、Handoff、Read Cursor 与 Generation Fence 完成 Evidence

## 1. 结论与边界

- 基线：`7e9a41498c471be4deca235439440ea7f157bdd4`
- 分支：`phase2/realtime-workbench`
- 授权：仅 P2-005，授权 Evidence 为 `evidence/p2-005-start-authorization.md`
- 结论：P2-005 `DONE`；Phase 2 仍为 `IN_PROGRESS`
- 当前活动任务/Lane：无
- 下一候选：P2-006，未授权
- P2-G1：`NOT_STARTED`
- Feature Flag：全部 P2/P3 Flag 仍为 `false`

本 Evidence 只记录本地、合成、隔离 PostgreSQL 验收。没有执行生产、临床、真实客户端、真实
Sender、真实 SSE、模型或医院内网验证，也不把本结果解释为 P2-G1 或生产 Go。

## 2. 文件清单

新增：

- `contracts/conversation_assignment.schema.json`
- `contracts/conversation_handoff.schema.json`
- `contracts/conversation_read_cursor.schema.json`
- `contracts/conversation_control_command.schema.json`
- `contracts/conversation_generation_fence.schema.json`
- `contracts/conversation_control_contracts.d.ts`
- `database/migrations/021_p2_005_conversation_control.sql`
- `scripts/p2-005-migrate.mjs`
- `src/p2-005-conversation-control.mjs`
- `src/p2-005-conversation-control-projections.mjs`
- `tests/p2-005-conversation-control.test.mjs`
- `tests/p2-005-conversation-control.integration.test.mjs`
- `tests/helpers/p2-005-postgres-harness.mjs`
- `docs/41_p2_005_assignment_handoff_generation_fence.md`
- `evidence/p2-005-assignment-handoff-generation-fence-report.md`

更新：

- P2-005 授权/状态基线、Backlog、任务、索引与 Changelog；
- `CONTEXT.md`、P2 架构/阶段/并行文档和 `docs/33_*`、`docs/37_*`、`docs/40_*`；
- `contracts/domain_events.md`、`contracts/conversation_center.openapi.yaml`；
- `database/schema_draft.sql`、`config_examples/conversation_policy.example.json`、`package.json`；
- `src/p2-004-communication-core.mjs` 的 caller-owned transaction 授权注入；
- V1.4 Architecture Validator/Test 的 P2-005 双生命周期与完成 Artifact 检查。

既有 migration 005、010、011、012、020 和既有 Evidence 未修改。

## 3. Migration 021

只新增以下四表及其直接约束/索引：

1. `conversation.assignment`
2. `conversation.handoff`
3. `conversation.read_cursor`
4. `conversation.control_event`

首次执行、重复执行、受限 CLI、`--check` 回滚均通过。五类故意漂移均失败关闭：缺列、弱化
Check、错误 Unique、错误 Index Method、错误 Partial Predicate。Migration 检查还验证：

- migration 006/010/011/012/020 Catalog 不变；
- `conversation.session` 未增加 Assignment/Handoff/Cursor 列；
- 未创建第二套 Principal/Role/Team/Ticket 表；
- 无持久 Trigger、Function 或 Extension；
- 稳定失败码为 `P2_005_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。

## 4. 模型、幂等与授权结果

- Assignment 每 Session 一行，状态为 `UNASSIGNED/ASSIGNED`，当前责任与审计分离。
- Handoff 生命周期验证 `REQUESTED -> ACCEPTED -> RELEASED` 与
  `REQUESTED -> CANCELLED`；已接受后取消被拒绝，Release 保持 HUMAN。
- Read Cursor 以 `(principal_id, session_id)` 独立持久化，只单调前进；no-op 不增加 Cursor、
  Session 或 Generation 版本。
- Control Event 追加式写入；`event_ordinal` 连续；业务命令以
  `(idempotency_scope, client_command_id)` 幂等，同 Hash 重放、异 Hash 冲突。
- 默认 Authorization 全拒绝；Pilot Adapter 只读复用 P1 Principal/Role/Team 与当前 Ticket
  处理组事实。
- 两坐席并发 Takeover 只有一个成功；12 路相同命令只产生一个 Control Event，其余 11 路重放。
- ADMIN force transfer 成功；非 ADMIN force transfer、inactive target、wrong-team Handler、
  ENDED Session 和 stale expected version 均失败关闭。
- Request/Takeover/Transfer/Release/Cancel 每条业务命令最多使 Session generation/row version
  各增加一次。

## 5. Generation、Communication、Realtime 与 Timeline

Generation Race 验证：捕获 generation N，人工接管提交 N+1，旧 Fence 返回 STALE；
`appendCommunication` 调用数为 0，Communication Message/Outbox/Delivery 增量均为 0。
HUMAN 模式和全部 AI Flag 关闭时 AI Reply 默认拒绝。

Assigned Communication Authorizer 验证未分配/其他坐席默认拒绝，当前已分配 active actor 允许，
ADMIN override 必须由后端授权。P2-004 将 caller-owned transaction 注入授权 seam，Fence 检查与
未来 append 可共享同一事务；本任务未装配真实 Sender 或 Route。

控制状态、Control Event 与 Realtime append 在一个事务中验证；故意使 Realtime append 失败后，
Assignment/Handoff/Session/Control Event 全部回滚。安全 Realtime payload 不含身份或正文。
Timeline Mapper 只产生 INTERNAL `HANDOFF_EVENT` Source Record；Read Cursor 不进入 Timeline，且
Mapper 未自动调用 Projector 或 SSE。

## 6. Unit、Integration 与回归

专项最终结果：

- P2-005 Contract/Unit：11 tests，11 pass，0 fail，0 cancelled
- P2-005 PostgreSQL Integration：6 tests，6 pass，0 fail，0 cancelled
- Architecture Validator：290 checks，pass
- Architecture Test：12 tests，12 pass，0 fail，0 cancelled

P2 回归最终结果：

- P2-001 Unit 13/13；Integration 1/1
- P2-002 Unit 39/39；Integration 13/13
- P2-003 Unit 41/41；Integration 10/10
- P2-004 Unit 17/17；Integration 9/9
- P2-005 Unit 11/11；Integration 6/6

直接相关 P1 回归最终结果：

- P1-009 Integration 2/2
- P1-011 Integration 11/11
- P1-012 Integration 46/46

最终全仓串行结果：377 tests，377 pass，0 fail，0 cancelled，0 skipped，0 todo，
duration 88,245.6993 ms；P2-001 至 P2-005 Integration 与 P1-009/011/012 Integration 均真实执行。

一次收口前全仓运行曾在既有 P2-002 P1 source adapter 夹具的即时 Delivery claim 上得到空结果；
同一用例隔离复跑 1/1 通过，P2-002 Integration 全量复跑 13/13 通过。该观察不修改已冻结的
P2-002，实现树仍以最终全仓零失败结果作为提交门槛。

## 7. 2C4G、隐私与清理

- 容量：500 Assignment、500 Handoff、32 Principal Cursor、2,000 Cursor 更新；列表上限 200。
- Pool：测试 `max<=4`；迁移 CLI `max=1`。
- Heap：5 个分段采样，无持续单调增长；这不是 24 小时 Soak。
- 新增长驻 Worker/Timer/Child Process：0；新增 Redis/broker/ORM/Socket.IO/本地模型：0。
- 隔离随机数据库均删除；测试连接池全部关闭；无测试数据库、连接、Timer、Child Process、
  PID 或 Socket 残留。
- 测试只用合成身份与消息；Evidence 不记录身份原值、正文、连接信息、原始 Provider 错误或 Secret。

## 8. 关闭方式与剩余边界

关闭方式是保持全部 Feature Flag 为 `false` 并不调用 P2-005 Port；四张控制表保留审计，migration
021 不回写。结构修复必须使用后续受审迁移。

未实现/未启动：

- P2-006、真实 Web Workbench、真实 REST Route、真实登录权限；
- SSE 生产路径、真实企业微信 Sender、真实人工回复；
- DeepSeek、AI Job、AI 发送、Media/OCR、Incident；
- 医院内网、任何 P3 能力；
- P2-G1 组装或通过；
- push、merge、tag、release 或远端发布。
