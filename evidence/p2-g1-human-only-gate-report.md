# P2-G1 Human-only Conversation Center 现场 Gate 报告

- 执行日期：2026-09-01 至 2026-09-02
- 当前最新候选：`16a02a56e60bd3cdb845b069caa4e6847d3fff52`
- 仓库基线状态：`READY_FOR_LIVE_E2E`
- 本次现场技术结论：`AWAITING_PROJECT_OWNER_APPROVAL`
- 项目负责人批准：`NOT PERFORMED`
- 生产、临床、AI、OCR、Incident、P2-007、P3 授权：无

本报告只记录专用测试 Bot、专用测试群、测试账号、两个 active Pilot Principal、真实 PostgreSQL Pilot 数据库和合成故障数据上的 P2-G1 现场执行。Replay Gap 使用隔离 PostgreSQL 测试数据库，未修改 Pilot 现场事件或 retention floor。本报告不是生产稳定性证明、临床负载证明或 24 小时 soak。

## 自动化基线

最新候选完成以下验证：

- 全量串行回归：427/427 PASS，0 fail、0 skipped；
- P2-G1 定向验证：12 个 unit、7 个 integration、3 个 browser 测试全部 PASS；
- V1.4 架构校验：318 checks PASS；
- P2-G1 Gate、Replay Gap 和资源工具 `--check`：全部 PASS；
- Replay Gap 最终现场运行：PASS；
- 60 分钟 controlled observation：PASS。

一次全量回归中的既有 P1-012 Gateway 重认证用例在高负载下触发 10 秒超时；该用例单独复验通过，随后最终全量 427/427 通过。失败结果未被用作候选通过证据。

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
| G2 | SSE Replay Gap | PASS | 隔离 PostgreSQL 测试数据库；cursor 早于 floor 后实际 HTTP 410；Workbench 通过 Last-Event-ID 触发 fallback，并重新获取列表、Detail 和 Timeline；重复 Timeline 为 0；Pilot 数据未改变 |
| H | Gateway 断线重连 | PASS | 断开时 Readiness 降级；Message/Outbox/Delivery 各 +1，Provider 0；重连认证后 Provider 1、ACK、SENT；Unknown/新增 Dead Letter/Reconciliation 均为 0；客户端显示 1 次 |
| I | 60 分钟资源观察 | PASS | 3 个独立 Node 进程、2 个 Edge 会话、61 次采样；总 RSS P95 224,878,592 bytes、最大 230,768,640 bytes；数据库连接利用率最大 6%；无 OOM、持续单调内存增长、积压、未解释 Dead Letter/Reconciliation 或清理残留 |
| J | 项目负责人批准 | NOT PERFORMED | 技术条件已完成，等待项目负责人独立核对和明确决定；批准文件不存在 |

## 独立修复周期

现场执行发现的问题均保留原失败记录，并以独立提交修复：

- `8a4e9c8fc4be7c308d7f389f32b62fe275d42ca4`：修复真实回复传输与发送许可耦合；
- `1f6dbb7daefe9851d1a631e0e78791ba253cd846`：修复 Delivery Timeline 投影类型；
- `85e20da4c512a1867bafdbc19c127bbd5459a954`：稳定命令重放哈希；
- `d39e0652e9878750dcc6264c0b80a1ea3b5afc44`：恢复原生 SSE 重连；
- `25d91e2ab42f759e0e629282cbfc6a92d8f78746`：增加受控 SSE 断开接缝；
- `3ab0b852927785873ecfa547a6a26e7707c13cdf`：增加受控 Gateway 断开和重连接缝；
- `8e1dba29722499b274c110e5c655531246ec329e`：增加隔离 Replay Gap、三进程运行和分进程资源遥测；
- `16a02a56e60bd3cdb845b069caa4e6847d3fff52`：为浏览器控制增加超时，并将周期性观察负载改为有界本机 HTTP 路径。

第一次 60 分钟观察运行在约 20 分钟时因第二次浏览器控制命令无界等待而受控停止。该次 `BLOCKED` Evidence 保留，所有测试进程、Edge 会话和监听端口均已清理。修复后使用新运行标识、修复后的 HEAD 和完整 3,600,000 ms 时长重新执行并通过。

## Replay Gap 结果

- 运行标识：`P2G1-20260902134406-693542`；
- 数据库范围：隔离 PostgreSQL 测试数据库；
- 迁移数量：13；
- HTTP 状态：410；
- Last-Event-ID：实际使用；
- fallback：重新获取会话列表、Detail 和 Timeline；
- Timeline 项：1，重复项：0；
- 完整浏览器刷新：不需要；
- App、Worker、Gateway：3 个独立进程；
- Edge 会话：2；
- Pilot 数据或 retention floor 修改：否；
- 浏览器、进程和隔离数据库清理：完成。

## 60 分钟 controlled observation

- 运行标识：`P2G1-20260902134444-895364`；
- 实际时长：3,600,037 ms；
- 采样次数：61；
- 进程：App、Worker、Gateway 各 1，数据库连接池上限分别为 4、2、1；
- 周期性合成内部备注：5 次，Message +5，Outbox/Delivery +0；
- SSE 客户端最小值：2；
- Projection backlog 和 Communication backlog 最大值：0；
- PostgreSQL 连接利用率最大值：6%；
- 历史 Dead Letter 基线：1，本轮增量：0，未解释增量：0；
- Reconciliation Required 基线和增量：0；
- OOM、内部备注外泄、重复人工回复、明确报修漏单：0；
- AI、OCR、Incident、Integration 调用：0；
- 异常持续单调内存增长：否；
- Gateway 结束时已认证：是；
- 浏览器和进程清理：完成。

| 指标 | P50 | P95 | P99 / 最大 | 首次 | 末次 |
|---|---:|---:|---:|---:|---:|
| App RSS bytes | 78,348,288 | 81,723,392 | 88,657,920 | 88,657,920 | 79,740,928 |
| Worker RSS bytes | 74,747,904 | 75,202,560 | 75,337,728 | 71,045,120 | 71,680,000 |
| Gateway RSS bytes | 66,949,120 | 67,969,024 | 71,065,600 | 71,065,600 | 66,715,648 |
| Total RSS bytes | 219,115,520 | 224,878,592 | 230,768,640 | 230,768,640 | 218,136,576 |

该结果只能表述为 `60-minute P2-G1 controlled observation`。

## 安全与清理

- Evidence 不记录原始 userid、chatid、target、Principal UUID、Secret、Token、Cookie、数据库连接串、完整消息正文或 Provider 原始错误文本；
- 消息只以 SHA-256、状态、计数、时延和客户端 `VISIBLE/NOT_VISIBLE` 结论表示；
- 真实发送许可仅在获批的现场发送子进程中存在，进程退出后已清理；
- 最终 App、Worker、Gateway、两个测试 Edge 会话和监听端口均已清理；
- Pilot 当前活动 Delivery backlog 为 0，Dead Letter 为已知历史基线 1，Reconciliation Required 为 0；
- 没有创建或提交截图；
- 没有 push、merge、tag 或 main 更新。

## Gate 决定

技术场景 A 至 I（含 Replay Gap）均已通过，证据引用最新候选 `16a02a56e60bd3cdb845b069caa4e6847d3fff52`。项目负责人 Gate 决定尚未执行，因此仓库基线继续保持 `READY_FOR_LIVE_E2E`，本报告状态为 `AWAITING_PROJECT_OWNER_APPROVAL`。

在项目负责人明确核对并批准前，不得创建 `evidence/p2-g1-project-owner-approval.md`，不得把 P2-G1 更新为 `PASSED`。原始结构化记录见 `evidence/p2-g1-live-e2e.jsonl` 和 `evidence/p2-g1-resource-observation.jsonl`。
