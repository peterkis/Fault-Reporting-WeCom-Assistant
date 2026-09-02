# P2-G1 Assembly Readiness Report

- 当前状态：READY_FOR_LIVE_E2E
- 基线：`1c18d5653b17e4368b5fa057d513e1af1a8b4622`
- 授权分支：`phase2/gate-p2-g1-human-only`
- 数据库结构变更：P2-G1 无 DDL、无 migration 022；001 至 021 文件未修改
- Live WeCom Evidence：PARTIAL / BLOCKED；第三次真实 Inbound Shadow 收到 20/20、两个 Workbench 路由与 SSE 连接正常，但具名 SSE 事件未触发新样本 refetch
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
| P2-G1 Unit | 10/10；真实模式保险丝、单 Gateway、Sender ACK/拒绝/UNKNOWN、Allowlist、双 Principal Test Auth、Safe run ID、DB 故障脱敏、默认无真实发送 |
| P2-G1 PostgreSQL Integration | 5/5；P1→Conversation→Realtime→Workbench、投影恢复、参与者与 Different Intake 边界、接管竞争、内部备注、12 路重复回复、Gateway 恢复、UNKNOWN 对账、Runtime Ready、容量与 Catalog |
| P2-G1 System Browser | 2/2；移动视口重复提交只调用一次、XSS 未执行、无横向溢出、Polling fallback；双隔离 Cookie 会话均请求冻结 `/workbench` 路由且未请求根路径 |
| P2-001 至 P2-006 Unit | 138/138 |
| P2-001 至 P2-006 Integration / Browser | 47/47 |
| P1-009 / P1-011 / P1-012 Integration | 59/59 |
| Architecture | validator 318 checks；test 14/14 |
| 全仓串行 | 421/421；fail 0；cancelled 0；skipped 0 |

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
- 2026-09-01：现场零副作用预检确认两个 active ADMIN Principal 与既有专用测试群/账号；在连接真实 WSS 前补强双 Principal Test Auth、Safe Ready/run ID 和独立浏览器会话接缝。该修复本身不构成 Live Evidence，状态仍为 `READY_FOR_LIVE_E2E`。
- 2026-09-01：补强后首次全仓串行为 418/419，唯一失败是 P2-006 HTTP 性能用例使用固定到期时间并在墙钟跨界后返回 401；改为每次测试生成五分钟短期身份后，定向 Integration 6/6、最终全仓串行 419/419。该失败与成功重试均保留，不将中间失败隐藏为通过。
- 2026-09-01：候选 `f77198bce81afa91b4c0750b1a09e0d946adc0b3` 首次真实 Inbound Shadow 完成 Gateway 认证且 Sender 关闭，但启动后发现 202 条既有 Channel Message backlog、累计 380 次 Projection failure；获批 run 样本为 0/20，受控停止并保持 Gate 未通过。
- 2026-09-01：脱敏诊断定位为同一参与者进入 `DIFFERENT_INTAKE` 时未先结束旧活动 Session，触发单活动 Session 唯一索引。修复后隔离 Integration 覆盖旧 Session 原子结束、新 Session 版本 1/1；本地既有事实在 13 个有界批次中补投影 398 个 Timeline/Realtime 结果，失败 0、剩余 backlog 0、Catalog 不变。新的真实候选仍须重新执行全部现场场景。
- 2026-09-01：边界修复、backlog/failure Readiness 与受控 stdin 停止接缝完成后，全仓串行 420/420，fail/cancelled/skipped 均为 0；仅允许以修复提交的新 HEAD 重启真实现场验证。
- 2026-09-01：候选 `fc00cc1c184a1a4f34e7441c6909962bb119f647` 的第二次 Inbound Shadow 收到 20/20，Channel Message/Timeline/Realtime 均为 20，Intake/Ticket/Session 为 2/2/2，Timeline P95 88.981ms，AI/OCR/真实发送均为 0；但 CDP 打开根路径而静态 Workbench 只服务 `/workbench`，两个客户端均观察到 `WORKBENCH_NOT_FOUND`、SSE Client 0，因此该 run 为 `BLOCKED`，不能作为可见性 PASS。
- 2026-09-01：浏览器导航修复后，双隔离 Cookie `/workbench` 真实路由回归 1/1、新增后的 P2-G1 Browser 合计 2/2、全仓串行 421/421；旧 run 不复用，新的真实候选必须重新采集 20 条入站及 Workbench/SSE Evidence。
- 2026-09-01：候选 `a531e42f0a1d7f3323011f2f84596d78f5a2c483` 第三次 Inbound Shadow 的 20 条入站全部形成 Channel Message/Timeline/Realtime，P1/Timeline P95 为 1.757/58.830ms，两个 `/workbench` 页面和 2 个 SSE Client 正常；但 P2-003 发出具名 `conversation.item.created`，UI 仅监听默认 `onmessage`，20 个样本均无可匹配 refetch，因此 run 为 `BLOCKED`。停止时浏览器已关闭、端口已释放，挂起的 Live Node 由验证后的精确 PID 终止，真实发送 0。
- 2026-09-01：Workbench 已覆盖全部冻结具名 Realtime Event Type；Live Browser 安全计时探针只输出事件类型、LIST/DETAIL/TIMELINE 分类、状态码与时间戳，并明确不访问 `Last-Event-ID` 或任何 Session ID。双隔离 Cookie 真实浏览器回归证明具名事件和 LIST 完成时间均可采集，P2-G1 聚焦回归 12/12，最终全仓串行回归 421/421，fail/cancelled/skipped 均为 0。
- 2026-09-01：候选 `53371c4df0f1e9ea996e8cc21bc6f9ee0d23a3b4` 第四次 Inbound Shadow 校准的两个授权测试入口共形成 2 个 Channel Message、2 个 Timeline Item 和 2 个 Realtime Event；但两浏览器首次 replay 各收到 459 个授权保留事件并分别产生 461/460 个 LIST 请求，Fetch P95 为 8981/8591ms，用户只能手动刷新后看见消息，因此 run 为 `BLOCKED`。Runtime/Browser 清理成功，随后精确终止仅因 stdin 引用未退出的 Live 子进程，真实发送 0。
- 2026-09-01：Realtime refresh 串行合并修复以 100 个连续具名事件验证，初始加载加 realtime LIST 总计 3 次；受控 stop 同时解除 stdin listener/reference。P2-G1 聚焦回归 12/12，最终全仓串行回归 421/421，fail/cancelled/skipped 均为 0；必须使用新 HEAD 重跑现场校准，旧 run 不升级为 PASS。
- 2026-09-01：候选 `d5b9cf1285e0c5b8acea4205ef975cfe6e37d111` 第五次 Inbound Shadow 的 1 条校准入站完成 Channel/P1/Timeline/Realtime 持久化，但两个既有 SSE 连接均未收到新事件，自动 refetch 为 0，用户 5 秒内未观察到自动显示，因此 run 为 `BLOCKED`。根因为连接时冻结的 461 个既有授权 Session 事件快照不包含随后创建的新 Session；受控 stop 2 秒内完成，真实发送 0。
- 2026-09-01：P2-G1 Runtime 显式启用默认关闭的动态 Realtime Authorization。数据库集成先建立空 Session 集合的 SSE，再创建新入站 Session，原连接成功收到具名 Item 事件；P2-G1 单元 10/10、定向数据库集成 1/1。必须以新 HEAD 重做现场校准。
- 2026-09-01：首次全仓串行回归中，既有 P2-003 5000 事件资源测试因整仓负载下 1 秒 recovery timer 多触发空批而仅有该项失败；未放宽 `replay_query_batch_count <= 101`。原样单测重跑为 5000/5000、100 批、无残留，随后完整串行回归 421/421，fail/cancelled/skipped 均为 0。
- 2026-09-02：候选 `02d4f33a41ba2d65a6d45d9b0a2de8e67ba1a34d` 第六次 Inbound Shadow 的正确选中 Session 批次为 Channel/Timeline/Realtime 20/20/20、重复 0，Agent A DOM 含 20 个样本，完整计时 20/20，端到端 P95 108ms；但用户观察的是未选中 Session 的 Agent B，未完成人工客户端可见确认。隔夜后两 Cookie 过期、SSE Client 0，旧缓存仅留在 Agent A；该运行未持续资源采样，不得称为资源观察或 soak，结果为 `BLOCKED`。
- 2026-09-02：受控浏览器检查发现无下一页时 `hidden=true`，但 `.load-more { display:block }` 仍使“加载更多会话”可见，且页面没有醒目的 A/B 标识。新增全局 `[hidden]` 规则、测试窗口 A/B 页内与标题标识及真实浏览器回归；必须用新 HEAD 重做现场验证。
