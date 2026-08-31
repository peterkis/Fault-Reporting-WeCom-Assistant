# P2-004 统一 Communication Message / Outbox / Delivery

- 状态：DONE
- 授权日期：2026-08-31
- 授权 Evidence：`evidence/p2-004-start-authorization.md`
- 完成日期：2026-08-31
- 完成 Evidence：`evidence/p2-004-communication-outbox-delivery-report.md`
- 基线提交：`2b4548888882ce895a85f513d0a5bb57d9920b91`
- Lane：P2-B
- 目标 Gate：P2-G1（本任务不启动 Assembly Gate）
- 依赖：P2-001；只读消费 P2-002/P2-003 冻结 Contract

## 输入

- 冻结的 Conversation Thread、Session、Item 与 Realtime Contract；
- 当前 P1 `notification.*` 权威结构和既有 Delivery Worker；
- 服务端解析的目标、注入式授权与合成 Sender；
- 有界、纯 JSON、业务命令级幂等的 Communication Command。

## 输出

- `communication.message`、`communication.outbox`、`communication.delivery`、
  `communication.delivery_attempt` 四张追加式事实/审计表；
- caller-owned transaction CommunicationPort 与 standalone Service；
- P1 Notification 只读/委托兼容 Adapter；
- Mock-only Sender Port、单并发 Delivery Worker、显式 Reconciliation Port；
- 不自动落库的 Timeline/Realtime Projection Mapper。

## 绝对边界

- Unified Ticket Core 继续是唯一 Ticket 事实源；`notification.*` 继续承载已验证 P1 通知事实；
- 不迁移、不回填、不复制、不删除、不重命名、不双写 `notification.*`；
- 浏览器、AI 和 Ticket Service 都不能直接调用 Sender；事务内不调用外部服务；
- Internal Note 只创建 Message，绝不创建 Outbox/Delivery 或调用 Sender；
- P2-005、P2-006、P2-G1、AI、Media、Incident、P3 和任何真实依赖均不在范围；
- 所有 P2/P3 Feature Flag 始终保持 `false`。

## 完成标准

- Contract、migration 020、runtime、compatibility、worker、reconciliation 和 mapper 均通过
  Unit/Contract/PostgreSQL Integration 测试；
- 浏览器双击、Human/AI 隔离、事务原子性、lease/retry/unknown/dead-letter、gateway reconnect、
  worker kill/restart、P1 只读兼容和 500 Delivery 有界资源场景均有可复核证据；
- P1、P2-001/002/003、架构和全仓串行回归为零失败、零取消；
- 无测试数据库、连接、Worker、Timer 或 Child Process 残留；
- 只有上述验收全部通过后才可改为 DONE。

项目负责人正式、独立授权启动 P2-004。完成 P2-004 后必须停止。
P2-005 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。
