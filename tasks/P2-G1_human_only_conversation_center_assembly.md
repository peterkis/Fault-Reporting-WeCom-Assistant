# P2-G1 Human-only Conversation Center Assembly

- 状态：READY_FOR_LIVE_E2E
- 授权日期：2026-09-01
- 授权 Evidence：`evidence/p2-g1-start-authorization.md`
- 基线：`1c18d5653b17e4368b5fa057d513e1af1a8b4622`
- 分支：`phase2/gate-p2-g1-human-only`
- Lane：ASSEMBLY
- 依赖：P1、P2-001 至 P2-006 均已完成
- 数据库变更：无；migration 001 至 021 保持不可变
- Feature Flag：全部提交默认值继续为 `false`

## 输入与输出

输入是 P1 已提交的 Channel Message、Service Intake 与 Unified Ticket Core 事实，以及 P2-001 至 P2-006 冻结的 Conversation、Timeline、Realtime、Communication、Control、Workbench Contract。输出是 Human-only 的持久投影协调器、真实测试 WeCom Gateway/Sender Adapter、受控 Test Authentication、Runtime/Health/安全指标，以及 Gate Check、Synthetic、Live、Fault 和 Resource 工具。

## Schema / Contract

不新增或修改数据库 Schema、Table、Column、Constraint、Index、Function、Trigger、Extension 或 Migration。投影复用 P2-002 Source Binding 与 Checkpoint；Realtime 通过 P2-003 caller-owned transaction 接缝与 Timeline Item 原子追加；Gateway/Sender、Test Authentication 与 Health 只增加向后兼容的应用层 Port/Adapter。

## 验收

- P1 提交不受 P2 投影故障影响，恢复后可从持久事实补投影；
- Channel Message、Ticket Event、Communication Message/Delivery、Control Event 使用独立 source stream 和 `batch<=20`；
- 群聊参与者隔离，首次 Session 版本为 1，唯一后续用户消息各增一次，重复不增长；
- Internal Note 产生 Timeline/Realtime，但 Outbox、Delivery、Sender 增量均为 0；
- Human Reply 形成恰好一组 Message/Outbox/Delivery，只有 Delivery Worker 调 Sender；
- SSE PostgreSQL 补放、Gateway/Worker 恢复、并发接管、容量、故障、资源与 Catalog 不变均有自动化证据；
- AI/OCR/Incident/P3 调用始终为 0。

## 安全、资源与关闭

真实测试必须同时设置一次性进程级 `P2_G1_LIVE_TEST_APPROVED=true` 与 `P2_G1_TEST_SCOPE_CONFIGURED=true`；真实发送还必须设置 `P2_G1_REAL_WECOM_SEND_APPROVED=true`。Target 只能来自持久 Delivery 且 hash 命中测试 Allowlist。App/Worker/Gateway pool 上限分别为 4/2/1，单 Gateway、单投影 Worker、单 Communication Worker，SSE 最大 32，投影与 Delivery batch 最大 20。关闭方式是停止领取、排空或安全终止在途项、断开 Gateway、关闭 HTTP/Pool/Timer，并恢复全部进程开关为关闭。

## Exit condition

没有真实企业微信入站、真实人工回复、客户端人工观察、重连/资源现场证据和项目负责人明确批准时，P2-G1 最多到 `READY_FOR_LIVE_E2E`，不得写 `PASSED` 或 `GO`。P2-007 及以后任务、P2-G2 及以后 Gate、AI/OCR/Incident、P3、生产/临床启用、push/merge/tag 均不在本授权内。

## Comments

- 2026-09-01：项目负责人正式、独立授权启动 P2-G1 Human-only Assembly；`last_completed_task` 保持 P2-006。
- 2026-09-01：启动核验确认分支、干净工作树、HEAD、`origin/main`、完成标签与 divergence 全部满足固定基线要求。
- 2026-09-01：Human-only 自动化 Assembly、隔离 PostgreSQL、系统浏览器、故障/容量与既有 P1/P2 回归通过；状态更新为 `READY_FOR_LIVE_E2E`。真实企业微信与 60 分钟现场资源观察均未执行，P2-G1 不得标记 `PASSED / GO`。
