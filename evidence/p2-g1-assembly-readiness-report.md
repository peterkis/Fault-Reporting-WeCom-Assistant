# P2-G1 Assembly Readiness Report

- 当前状态：READY_FOR_LIVE_E2E
- 基线：`1c18d5653b17e4368b5fa057d513e1af1a8b4622`
- 授权分支：`phase2/gate-p2-g1-human-only`
- 数据库结构变更：P2-G1 无 DDL、无 migration 022；001 至 021 文件未修改
- Live WeCom Evidence：NOT PERFORMED
- 60 分钟现场资源观察：NOT PERFORMED
- 项目负责人 Gate 批准：NOT PRESENT
- Gate 结论：NOT PASSED / NOT GO

## 装配结果

P1 入站先独立提交 Channel Message、Service Intake、Unified Ticket 与既有通知事实；P2 投影失败不回滚 P1。持久投影协调器从已提交事实解析 Thread/Session，并通过 P2-002 Item/Binding/Checkpoint 与 P2-003 caller-owned transaction 在同一事务追加 Timeline Item 和 Realtime Event。Channel Message、Ticket Event、Communication Message、Communication Delivery 与 Control Event 使用独立 stream，批次上限为 20；乱序重建需求隔离到单 Session。

真实测试 WeCom Gateway 保证单活动 WSClient，并以 authenticated 事件控制 Ready 与 Sender 可用性。Sender 只读取持久 Delivery 的目的地，只允许 `WECOM_AIBOT` 文本/Markdown，且 target hash 必须命中进程配置 Allowlist；显式 `errcode=0` 才是 ACK，未知结果进入对账语义。内部备注只形成 Message、Timeline 与 Realtime，不形成 Outbox、Delivery 或 Sender 调用。

Test Authentication 只接受 Server-side Pilot Principal，逐请求确认 active 与非 REPORTER 角色；Cookie 为短期内存值、HttpOnly、SameSite=Strict，无 Login Route 或 URL token。App 绑定 loopback，HTTP 连接上限 128，SSE 上限 32，单投影/通信 Worker，批次 20，配置 Pool 上限 4。`/health/live`、`/health/ready` 和无标识符的资源指标均已验证。

## 自动化 Evidence

| 类别 | 结果 |
|---|---|
| P2-G1 Unit | 8/8；真实模式保险丝、单 Gateway、Sender ACK/拒绝/UNKNOWN、Allowlist、Test Auth、DB 故障脱敏、默认无真实发送 |
| P2-G1 PostgreSQL Integration | 4/4；P1→Conversation→Realtime→Workbench、投影恢复、参与者隔离、接管竞争、内部备注、12 路重复回复、Gateway 恢复、UNKNOWN 对账、Runtime Ready、容量与 Catalog |
| P2-G1 System Browser | 1/1；移动视口重复提交只调用一次、XSS 未执行、无横向溢出、Polling fallback |
| P2-001 至 P2-006 Unit | 138/138 |
| P2-001 至 P2-006 Integration / Browser | 47/47 |
| P1-009 / P1-011 / P1-012 Integration | 59/59 |
| Architecture | validator 318 checks；test 14/14 |
| 全仓串行 | 417/417；fail 0；cancelled 0；skipped 0 |

关键计数：明确报修 Ticket 漏单 0；重复 Channel Message 的 Ticket/Item 增量 0；两个群聊参与者 Session 相互隔离；并发接管成功数 1；Internal Note 为 Message/Outbox/Delivery `1/0/0`；12 路同命令 Human Reply 为 `1/1/1`；Gateway 未调用 Provider 时保持 PENDING，恢复后 Provider 调用 1；UNKNOWN 为 `RECONCILIATION_REQUIRED`；AI/OCR 调用 0。

容量验证使用隔离 PostgreSQL、Pool max 4、Projector/Delivery batch 20：1000 条合成入站全部投影，500 条 Communication Delivery 全部发送到 Mock Sender，OOM 0，前后 Catalog 一致。P2-003 既有回归验证 32 SSE Client、拒绝第 33 个并提供 Polling fallback、Last-Event-ID 与 App restart PostgreSQL 补放；P2-002/P2-004 既有回归验证真实 Worker kill/restart 与无盲目重发；残留检查为 0。

## Migration 与 Catalog

首次 `p2:g1:check` 诚实记录为失败：配置的本地 Pilot PostgreSQL 尚缺已完成任务的 migration 012、020、021 关系。三份既有 migration 先通过事务回滚检查，再应用到本地配置库；没有新增或修改 migration。之后检查结果为 `ok=true`、001 至 021 所需关系齐全、Catalog identity count 1090。隔离 Assembly 用例在迁移基线后取前后快照并证明一致，因此 P2-G1 本身没有 Schema、Table、Column、Constraint、Index、Function、Trigger 或 Extension 变更。

## 未完成的独立 Gate Evidence

- 真实企业微信 WSS 入站与至少 20 个获批样本：NOT PERFORMED；
- 真实人工回复在企业微信客户端显示与恰好一次人工观察：NOT PERFORMED；
- 真实客户端确认内部备注不可见、重复回复为 0：NOT PERFORMED；
- 真实 Gateway 断线/重认证现场：NOT PERFORMED；
- 至少 60 分钟的 App 现场资源观察：NOT PERFORMED；`p2:g1:resource --check` 仅证明 15 项指标工具和 3600000 ms 最小时长约束可用，不能替代观察；
- 项目负责人 P2-G1 Gate 批准：NOT PRESENT。

因此本报告只支持 `READY_FOR_LIVE_E2E`。它不支持 `PASSED`、`GO`、生产/临床启用、P2-G2 或 P2-007 授权。

## Comments

- 2026-09-01：创建 Evidence 边界；未创建 live JSONL、Gate Pass 报告或项目负责人批准文件。
- 2026-09-01：保留首次 migration readiness 失败，并在只应用既有 012/020/021 后重试成功。
- 2026-09-01：自动化 Assembly 与授权回归完成；状态收敛到 `READY_FOR_LIVE_E2E`，真实现场执行保持未授权。
