# P2-005 坐席分配、Read Cursor、Handoff 与 Generation Fence

- 状态：DONE
- 授权日期：2026-08-31
- 授权 Evidence：`evidence/p2-005-start-authorization.md`
- 完成日期：2026-08-31
- 完成 Evidence：`evidence/p2-005-assignment-handoff-generation-fence-report.md`
- 基线提交：`7e9a41498c471be4deca235439440ea7f157bdd4`
- Lane：P2-B
- 目标 Gate：P2-G1（本任务不启动 Assembly Gate）
- 依赖：P2-001、P2-004；只读消费 P2-002/P2-003 冻结 Contract

## 输入

- 冻结的 Conversation Session、Timeline、Realtime 与 Communication Contract；
- P1 Pilot Principal、Role、Team 权威事实；
- 服务端解析身份、注入式授权和合成依赖；
- 有界、纯 JSON、业务命令级幂等的 Conversation Control Command。

## 输出

- `conversation.assignment`、`conversation.handoff`、`conversation.read_cursor`、
  `conversation.control_event`；
- Conversation Control Service、Pilot Authorization Adapter 和 Generation Fence；
- P2-004 Assigned Communication Authorizer；
- 不自动装配 Timeline/SSE 的安全 Projection Mapper。

## 绝对边界

- Unified Ticket Core 继续是唯一 Ticket 事实源；
- 不向 `conversation.session` 增加 Assignment/Handoff/Cursor 列；
- 不创建第二套 Principal、Role、Team、Ticket 或 AI 表；
- 事务内不调用 HTTP、Sender、企业微信、模型或对象存储；
- P2-006、P2-G1、AI、Media、Incident、P3 和任何真实依赖均不在范围；
- 所有 P2/P3 Feature Flag 始终保持 `false`。

## 完成标准

- Contract、migration 021、runtime、authorization、fence、communication adapter 和 mapper
  均通过 Unit/Contract/PostgreSQL Integration 测试；
- 并发接管、幂等、Handoff 生命周期、Read Cursor、未读计算、Generation Race、Realtime
  原子回滚和 2C4G 有界容量均有可复核 Evidence；
- P1、P2-001/002/003/004、架构和全仓串行回归零失败、零取消；
- 无测试数据库、连接、Timer 或 Child Process 残留；
- 只有上述验收全部通过后才可改为 DONE。

项目负责人正式、独立授权启动 P2-005。
完成 P2-005 后必须停止。
P2-006、P2-G1 和后续生产功能仍须另行授权。
