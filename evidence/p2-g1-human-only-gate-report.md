# P2-G1 Human-only Conversation Center 现场 Gate 报告

- 执行日期：2026-09-01 至 2026-09-02
- 当前最新候选：`3ab0b852927785873ecfa547a6a26e7707c13cdf`
- 仓库基线状态：`READY_FOR_LIVE_E2E`
- 本次现场执行结论：`LIVE_E2E_BLOCKED`
- 项目负责人批准：`NOT PERFORMED`
- 生产、临床、AI、OCR、Incident、P2-007、P3 授权：无

本报告只记录专用测试 Bot、专用测试群、测试账号、两个 active Pilot Principal、真实 PostgreSQL Pilot 数据库和合成故障数据上的 P2-G1 现场执行。它不是生产稳定性证明、临床负载证明或 24 小时 soak。

## 自动化基线

最新候选完成以下验证：

- 全量串行回归：423/423 PASS，0 fail、0 skipped；
- P2-G1 合成装配：15/15 PASS；
- P2-G1 故障演练：1/1 PASS；
- V1.4 架构校验：318 checks PASS；
- Catalog identity：1090；
- Catalog SHA-256：`4d8c2371971e6f114c749bd59f7c39c9001c064a23eb745699e9b5ab2690e0a0`；
- 资源工具 `--check`：工具可运行，最低时长 3,600,000 ms，但没有执行观察。

首次全量命令曾因遗漏 `.env.pilot` 导致 5 个数据库集成文件在装载阶段退出；该次不计为候选测试。加入正确 env-file 后，完整 423 项全部通过。

## 现场场景结果

| 顺序 | 场景 | 结果 | 关键事实 |
|---|---|---|---|
| A | Inbound Shadow | PASS | 20 callback、20 unique Channel Message、1 Intake、1 Ticket；漏单/重复 Ticket/重复 Timeline 均为 0；AI/OCR/真实发送均为 0 |
| B | Workbench 可见性与性能 | PASS | A/B 各可见 20 条；Workbench P95 分别 148 ms、151 ms；P1 commit P95 4.259 ms；Timeline commit P95 41.874 ms |
| C | 并发接管 | PASS | 两个独立 active Principal；1 次成功、1 次稳定 409；Assignment 唯一；generation/row version 和 Control Event 均只增 1 |
| D | 内部备注隔离 | PASS | Message +1，Outbox/Delivery/Sender +0；Workbench 两端可见；企业微信测试客户端刷新并观察 30 秒后不可见 |
| E | Human Live Reply | PASS | HTTP 202/14 ms；Message/Outbox/Delivery/Sender 各 +1；Provider 明确 ACK；Delivery SENT；客户端可见 1 次 |
| F | 回复幂等 | PASS | 首次 202，重复同键 202 replay；Message/Outbox/Delivery/Sender 总增量仍各为 1；客户端仍显示 1 次 |
| G | SSE 断线补放 | PASS | 受控断开 Agent A；断线期间事实持久化；重连请求实际使用 Last-Event-ID；A/B 各补放 1 条；无重复且无需全量刷新 |
| G2 | SSE Replay Gap | NOT PERFORMED | Pilot 数据库 retention floor 为 0；未删除、改写或提前清理 633 条现场实时事件来制造 HTTP 410 |
| H | Gateway 断线重连 | PASS | 断开时 Readiness 降级；Message/Outbox/Delivery 各 +1，Provider 0；重连认证后 Provider 1、ACK、SENT；Unknown/Dead Letter/Reconciliation 均为 0；客户端显示 1 次 |
| I | 60 分钟资源观察 | NOT PERFORMED | 当前现场 runtime 将 App/API/SSE、Worker、Gateway 合并为一个 Node 进程；工具不能提供要求的分进程 RSS/Heap、总 RSS、PostgreSQL 全局连接和开放 FD 证据 |
| J | 项目负责人批准 | NOT PERFORMED | Replay Gap 和 60 分钟资源观察未完成，禁止批准 |

## 修复与不可变失败记录

现场执行发现的问题均保留原失败记录，并以独立提交修复：

- `8a4e9c8fc4be7c308d7f389f32b62fe275d42ca4`：修复真实回复传输与发送许可耦合；
- `1f6dbb7daefe9851d1a631e0e78791ba253cd846`：修复 Delivery Timeline 投影类型；
- `85e20da4c512a1867bafdbc19c127bbd5459a954`：稳定命令重放哈希；
- `d39e0652e9878750dcc6264c0b80a1ea3b5afc44`：恢复原生 SSE 重连；
- `25d91e2ab42f759e0e629282cbfc6a92d8f78746`：增加受控 SSE 断开接缝；
- `3ab0b852927785873ecfa547a6a26e7707c13cdf`：增加受控 Gateway 断开和重连接缝。

每次修复后均运行全量或受影响自动化；受影响的真实场景使用修复后的候选重新执行。失败 Evidence 未被覆盖或改写。

## 阻塞项

### 1. Replay Gap 现场路径

当前 `conversation.realtime_stream_state` 的 retention floor 为 0，高水位为 633。HTTP 410 契约和 fallback 在隔离数据库自动化中已通过，但真实 Pilot 数据尚不存在合法的过期 cursor。需要一个不删除现场事实、不篡改 retention floor 的受控隔离现场路径，然后验证：

```text
cursor < retention floor
→ HTTP 410 / fallback
→ Workbench 重新获取列表、Detail 和 Timeline
→ 不把不完整事件流当作完整状态
```

### 2. 60 分钟分进程资源观察

当前 `scripts/p2-g1-resource-observation.mjs` 只从一个 `/health/metrics` 端点采 15 个合并指标。当前 `createP2G1Runtime` 又把 App、Worker、Gateway 置于同一个 Node 进程，因此无法满足既有 2C4G 基线所要求的分进程采样。

修复后至少应提供：

- App、Worker、Gateway 各自 RSS、Heap、CPU、Event Loop Delay、Socket/FD；
- 三个 Node 进程和 PostgreSQL 的总 RSS；
- PostgreSQL active/idle/max connections 及 75% 阈值判断；
- SSE clients、Projection backlog、Communication backlog；
- Dead Letter、Reconciliation Required、Gateway reconnect count；
- 60 分钟内的 P50/P95/P99、最大值、增长趋势和清理结果。

修复不能通过重复计算同一个进程 RSS、扩大阈值或缩短时长完成。

## 安全与清理

- Evidence 不记录原始 userid、chatid、target、Principal UUID、Secret、Token、Cookie、数据库连接串、完整消息正文或 Provider 原始错误文本；
- 消息只以 SHA-256、状态、计数、时延和客户端 `VISIBLE/NOT_VISIBLE` 结论表示；
- 真实发送许可只存在于 `human-live`、`duplicate-reply` 和 `reconnect` 子进程，进程退出后已清理；
- 最后一个 Gateway 现场进程和两个测试浏览器会话均正常清理；
- 没有创建或提交截图；
- 没有 push、merge、tag 或 main 更新。

## Gate 决定

由于 Replay Gap 现场验证和 60 分钟分进程资源观察均未执行，P2-G1 不得更新为 `PASSED`，不得创建 `evidence/p2-g1-project-owner-approval.md`。

应在独立修复提交中补齐上述两个阻塞项，重新运行 423 项全量回归、P2-G1 自动化和受影响现场场景。新的现场 Evidence 必须引用修复后的 HEAD。完成前仓库基线保持 `READY_FOR_LIVE_E2E`，本次现场执行结论保持 `LIVE_E2E_BLOCKED`。

原始结构化记录见 `evidence/p2-g1-live-e2e.jsonl`。
