# P2-004 Unified Communication Outbox / Delivery 完成 Evidence

- 日期：2026-08-31
- 分支：`phase2/realtime-workbench`
- 冻结基线：`2b4548888882ce895a85f513d0a5bb57d9920b91`
- 授权 Evidence：`evidence/p2-004-start-authorization.md`
- 结论：`P2 / P2-004 / DONE / AWAITING_SEPARATE_AUTHORIZATION`
- 数据：全部为合成数据；未连接真实企业微信新增 Sender、Workbench、模型、医院内网或生产依赖。

## 完成范围

Migration 020 只新增 `communication.message`、`communication.outbox`、
`communication.delivery`、`communication.delivery_attempt` 四张表，不迁移、回填、复制、删除、
重命名或双写 `notification.*`。Unified Ticket Core 继续拥有 Ticket 事实；P1 `notification.*`
继续拥有已验证的 P1 通知事实。全部 P2/P3 Feature Flag 保持 `false`。

实现冻结了 Message/Delivery/Internal Note/System Notification Schema、Communication 类型、
业务命令级幂等 Hash、Thread 权威目的地解析、caller-owned transaction/standalone Service、
只读 P1 Compatibility Adapter、Mock-only Sender、单并发有界 Delivery Worker、显式
Reconciliation Port 和不自动写库的 Projection Mapper。

## 数据库与故障闭合

- Migration 020 首次执行、重复执行、CLI 仅执行 020、`--check` 回滚均通过；
- migration 005/010/011/012 的 10 个冻结 relation catalog 前后相同；
- 缺列、弱化 Check、错误 Unique、错误 Index Method、错误 Index Predicate 五类 Drift 均以
  `P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED` 失败关闭；
- 无持久 Trigger 或 Function；四张表使用显式约束，七个业务 B-tree 索引按列顺序和 Predicate 校验；
- 12 路浏览器双击只形成 1 套 Message/Outbox/Delivery 事实，另 11 路为 replay；
- Human/AI 同正文按幂等作用域隔离；Internal Note 的 Outbox/Delivery/Sender 数均为 0；
- Single 由 Thread 解析为 `PERSON`，Group 解析为 `GROUP`；公共结果不包含目标；
- 12 路 Worker 竞争只产生 1 个 Claim 和 1 次 Sender 调用；
- ACK 才进入 `SENT`；明确未发送按退避重试；永久拒绝进入 `DEAD_LETTER`；
- Provider ACK 丢失或 Timeout 进入 `RECONCILIATION_REQUIRED`，不会盲重发；
- `CONFIRMED_SENT`、`CONFIRMED_NOT_SENT_REQUEUE`、`CANCEL` 三种显式决议均通过；
- Gateway unavailable 后重试并在 mock reconnect 后成功；
- 真实子进程 `SIGKILL`：`LEASED` 可重领并仅发送一次，`SENDING` 重启后进入 Reconciliation，盲重发数 0；
- P1 Adapter 只读快照不变、不会复制 P1 数据，并委托既有 P1 Worker；Communication 新增行数 0。

## 专项与回归数字

- P2-004 Contract/Unit：17 tests，17 pass，0 fail，0 cancelled，0 skipped；
- P2-004 PostgreSQL/Worker Integration：9 tests，9 pass，0 fail，0 cancelled，0 skipped；
- P2-001：Unit 13/13，Integration 1/1；
- P2-002：Unit 39/39，Integration 13/13；
- P2-003：Unit 41/41，Integration 10/10；
- 直接相关 P1：P1-007 Integration 4/4，P1-008 Integration 2/2，P1-011 Integration 11/11，P1-012 Integration 46/46；
- V1.4 架构 Validator：250 checks；架构测试：10/10；
- 最终全仓串行：358 tests，358 pass，0 fail，0 cancelled，0 skipped，耗时 78,175.4669 ms。

## 2C4G 与容量结果

500 Delivery 使用 `batch=20`，在 100 条后中断并续跑至 500，Sender 调用 500，最终全部
`SENT`。这是短时容量/恢复测试，不是 24 小时 Soak。最终全仓串行中的分段 Heap 样本为
`[12800368,13079688,13494008,16179552,16415512,16596240,15992744,11537256,18342264,16521808]`，
首末增长 3,721,440 bytes；分段回落且未观察到持续单调增长。P2-002 的 2,001 Item 场景为
101 批、最大批 20、峰值 Heap Delta 17,594,960 bytes、首末趋势 7,513,413 bytes。
P2-003 真实执行 32/33 客户端边界、5,000 Event、慢客户端、`SIGKILL`/重启和恢复场景。

## 清理与停止线

专项终态：测试数据库 0、Backend 0、Active Database 0、Worker Child 0、Worker 0、Timer 0、
Child Process 0。没有持久测试数据库、连接、Worker、Timer 或 Child Process 残留。

未启动 P2-005、Assignment、Read Cursor、Handoff、Workbench 或真实 REST Route；未把
Timeline/SSE 正式装配到真实发送路径；未通过 P2-G1；未接 DeepSeek/AI、医院内网或真实企业微信
新增 Sender；未启用任何 P2/P3 Feature Flag；未改变 Unified Ticket Core 事实所有权；未 push、
merge、tag 或 release。
