# P2-005 Assignment、Handoff、Read Cursor 与 Generation Fence

## 1. 范围与非目标

P2-005 在 P2-B 内实现四类 PostgreSQL 控制事实和显式服务端 Port：当前 Assignment、独立
Handoff 生命周期、每 Principal/Session Read Cursor、append-only Control Event、Generation
Fence、Pilot Principal 授权兼容、P2-004 Communication Authorizer 以及未装配的 Timeline/
Realtime Mapper。实现基线为 `7e9a41498c471be4deca235439440ea7f157bdd4`。

本任务不实现 P2-006 Workbench、HTTP Route、页面、登录、SSE 生产路径、真实 Sender、企业微信
SDK 调用、模型、AI Job、Media/OCR、Incident、医院内网或 P3。P2-G1 保持 `NOT_STARTED`，所有
P2/P3 Feature Flag 保持 `false`。

## 2. 为什么不修改 Session 列

`conversation.session` 继续唯一拥有 `control_mode`、`generation_version` 和 `row_version`。
Assignment 是可变当前责任状态，Handoff 是独立生命周期，Cursor 是每坐席视图状态；把这些列
塞入 Session 会混淆聚合边界、无法表达多 Principal Cursor，并使审计历史丢失。migration 021
因此只新增四表，不 `ALTER conversation.session`。

## 3. Pilot Principal 兼容边界

`ConversationControlAuthorizationPort` 默认全部拒绝。当前 Pilot Adapter 只读复用
`pilot_ticket.pilot_principal`、`pilot_principal_role`、`pilot_team_member` 和 Unified Ticket Core
当前处理组；不复制 display name，不在 `conversation.*` 存储外部用户标识，也不创建第二套
Principal、Role 或 Team。HANDLER 受处理组限制，DISPATCHER 可普通分配，只有 ADMIN 可显式
force transfer；inactive actor/target 均失败关闭。

## 4. Assignment 与 Handoff

`conversation.assignment` 每 Session 一行，只保存 `UNASSIGNED/ASSIGNED`、内部 Principal FK、
版本和时间。`conversation.handoff` 的持久状态为：

```text
REQUESTED → ACCEPTED → RELEASED
         └→ CANCELLED
```

`NONE` 由无行表达；同一 Session 通过部分唯一 B-tree 最多一个 REQUESTED/ACCEPTED Handoff。
Takeover 在 Session 行锁、expected row version 与后端授权下完成；一个命令无论改变 Assignment、
Handoff 和 mode 多少子状态，Session generation/row version 都只各增加一次。Release 只解除
Assignment，Session 保持 HUMAN；任何转入 COPILOT/AUTO 的 release 请求失败关闭。

## 5. Control Event 与命令幂等

`conversation.control_event` 是追加式审计和命令幂等事实；`(idempotency_scope,
client_command_id)` 与 `(session_id,event_ordinal)` 唯一。event ordinal 在 Session 行锁内分配。
command hash 覆盖命令类型、Session/expected version、actor/target/handoff、Cursor、reason、force
和目标 mode。相同 identity/hash 返回既有安全状态，异 hash 返回
`CONVERSATION_CONTROL_COMMAND_CONFLICT`；重放不增加任何版本或 Realtime Event。

## 6. Read Cursor 与未读数

Cursor 主键为 `(principal_id,session_id)`，只允许 actor 更新自己并单调前进；no-op 不增加 Cursor
版本，也不改变 Session row/generation。请求 sequence 不得超过当前授权可见 Item 的最大 sequence。
未读数使用可见 Item 的 SQL `COUNT(sequence_no > last_read_sequence)`，不做数字相减，不存储全局
unread count。WORKBENCH 排除 RESTRICTED；只有后端确认的 RESTRICTED_ADMIN 可见全部级别。

## 7. Generation Fence

Fence 从数据库捕获当前 Session generation；未来 AI append 必须在同一事务重新锁定并验证
generation 与允许 mode。版本不一致返回 STALE；HUMAN 模式返回 AI forbidden。人工接管、转派、
释放、Handoff 请求/取消和显式关键事实失效都会推进 generation。P2-005 不创建 AI 表、不调用
模型；当前 AI Flag 全关，真实 AI 外发始终拒绝。

## 8. Communication Authorizer

P2-004 在 caller-owned transaction 内把 transaction 注入授权 seam。AGENT HUMAN_REPLY/
INTERNAL_NOTE 只允许 active 且当前被分配 actor，或经后端再次验证的 ADMIN override。AI_REPLY
要求 AI Flags、非 HUMAN mode 和当前 Fence；当前全部拒绝。SYSTEM_NOTIFICATION 仍由 P2-004
trusted server Port 管理。

## 9. Realtime 与 Timeline

控制状态、Control Event 和 Realtime Event 在同一事务提交；Realtime append 失败使控制事务回滚。
SSE 写失败不反向影响已提交事务。Realtime payload 只含状态和版本，不含 Principal、正文、目标或
内部备注。Assignment/Handoff Control Event 可由纯 Mapper 形成 INTERNAL HANDOFF_EVENT Timeline
Source Record；Read Cursor 不进入 Timeline。P2-G1 才允许正式组装 Projector/SSE/Communication/
Workbench。

## 10. Migration 021、隐私与资源

migration 021 只创建 `conversation.assignment`、`handoff`、`read_cursor`、`control_event` 及直接
约束/索引；可重入并对列、约束、唯一键、B-tree 顺序和 predicate 漂移失败关闭为
`P2_005_SCHEMA_DRIFT_REMEDIATION_REQUIRED`。CLI pool `max=1`，`--check` 事务回滚。

运行不新增 Worker、Redis、broker、ORM、Socket.IO、本地模型或缓存；测试 pool `max<=4`，查询
limit `<=200`。容量证据覆盖 500 Assignment、500 Handoff、32 Principal Cursor、2,000 Cursor
更新和分段 heap 采样；这不是 24 小时 soak。

## 11. Feature Flag、关闭与回滚

服务 `enabled=false` 时在数据库调用前返回 `CONVERSATION_CONTROL_DISABLED`。运行回滚首选保持
全部 Feature Flag 为 `false` 并停止调用 P2-005 Port；四表保留审计，不改写 migration 021。
结构修复只能使用新的受审迁移。P1 入站、Unified Ticket Core 与 notification 链路不依赖本模块。

## 12. 后续消费

P2-006 已在独立授权下通过 Query/Command Port 构建默认关闭的 Internal Alpha Workbench，并保留
P2-005 Port 与事实所有权。P2-G1 仍只能在独立 Assembly 授权后装配真实入站、Timeline、Realtime、
Communication Worker 与页面；P2-006 完成不构成该 Gate 的启动授权。
