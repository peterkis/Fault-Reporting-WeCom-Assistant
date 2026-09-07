# P2-012 完成报告

- Task：P2-012；状态：DONE；日期：2026-09-07（Asia/Shanghai）。
- 范围：Internal Beta、规则与人工主运行路径、AI/OCR 关闭；不是 P2-G2、Phase 2 Go、生产/临床上线或最终品牌前端。
- 分支：`phase2/p2-012-human-confirmed-incident`。
- 基线：`30a394e85973f5a300b841b23d2c358998796ba6`。
- 授权提交：`f8d29caf50816ab90f3debf14995085158460784` — `chore(p2): authorize P2-012 human-confirmed incident`。
- 实现提交：包含本报告的唯一第二个本地提交 — `feat(p2): implement P2-012 human-confirmed incident and notifications`。自引用提交 SHA 不写回本文件；用 `git log --format=fuller 30a394e85973f5a300b841b23d2c358998796ba6..HEAD` 解析。
- 负责人已明确批准，见 `evidence/p2-012-project-owner-approval.md`。
- 第二提交候选共 123 个文件：新增 79、修改 44、删除 0；其中 Evidence 新增 25 个，历史完成 Evidence 修改 0。

## 输入、输出与边界

输入为 P2-015 已持久化的 INCIDENT_REVIEW_CANDIDATE Decision、Provenance、Journey/Leg/Intake 与既有 Ticket；输出为独立 Candidate Review、人工确认 Incident、IncidentReport、ReporterSubscription、追加事件、可靠通知、内部 REST/UI 和 Reporter-safe 里程碑。旧摘要缺失的聚类计数、窗口和 hash 保持 null/UNKNOWN，没有从正文重算或编造。

Ticket、Conversation Assignment 与 Communication 继续使用既有权威事实源。HTTP/UI 只调用命令服务；人工确认在同一事务提交 Incident、选中 Report、Subscription、Event、通知事实与幂等收据，外部网络不在事务内。没有第二套 Ticket Core、Sender、Outbox/Delivery、前端框架、ORM、Broker 或模型依赖。

P2-007 仍只产生候选；创建、Link/Unlink、主 Ticket、范围、处理、恢复、解决和关闭均为显式人工命令。个人恢复不改变其他 Reporter、共享 Incident 或任何 Ticket；Incident resolve/close 不关闭个人 Ticket。

## Migration 032 与 Contract

032 只新增七张关系：`incident.candidate_review`、`incident.incident`、`incident.incident_report`、`incident.reporter_subscription`、`incident.incident_event`、`incident.command_receipt`、`communication.incident_notification_binding`。精确 catalog 为 135 columns、241 constraints、28 indexes；新增 Trigger、持久 Function、Extension 均为 0。001–031 和 P2-007 Runtime 保持冻结。

闭合 JSON Schema 2020-12、TypeScript 与两个 OpenAPI 文档已同步；业务时间为 offset-free Asia/Shanghai LocalDateTime，版本/deadline 使用明确 string contract。普通 JSON、数组上限、恶意 getter/Proxy/toJSON/cycle/pollution、CSRF/XSS、认证过期、权限和幂等冲突均有验证。

## 通知、订阅与工作台

固定事件通知只有 confirm 群/个人、investigating 个人、resolved 群/个人、closed 个人。自然键按 Event、audience binding、template 和版本去重；同群多 Reporter 只发一条公开通知，同 Reporter 多 Report 只发一条私人通知。UNKNOWN 进入 Reconciliation，不盲重发。

`/workbench/incidents` 提供候选、活动/完成 Incident、冻结来源证据、显式 scope/owner/Primary Ticket、Link/Unlink、个人恢复和订阅暂停/恢复。复用现有认证、CSRF、Idempotency-Key、If-Match、durable SSE 与第 33 个客户端 polling fallback。Reporter 只见本人仍 LINKED Ticket 的四种安全里程碑，不见内部原因、其他 Reporter、原始身份或 Provider 错误。

真实现场采用 `APPROVED_GROUP_PARTICIPANTS`：只配置批准群 hash，人员 hash 数为 0。成员必须先以带测试标签的批准群 Frame 建立事实；direct 入站和 PERSON Delivery 再按同一 Bot/Reporter 与实际 direct leg 回查，不形成全局 allowlist。

## 真实定向现场

Run `fd4c9d42-dcae-4f63-acdb-7750c747390a`，固定现场候选 `55b89664e18c761d31b073fc2e279991e8543507b99ef55080d2ed9f6e2e6740`。两名 Reporter 的 4 条真实入站报告被人工确认；每人具有群与 direct 路径。Incident 从 CONFIRMED_LOCAL 经 INVESTIGATING、RESOLVED 到 CLOSED；一个 Reporter 恢复不影响另一人。显式切换 Primary Ticket 后解除错误关联，原 Ticket 与 Intake 保留，个人 Ticket 自动关闭为 0。

Incident 通知 10/10 SENT：群 2、私人 8，pending/UNKNOWN/dead-letter 均为 0。负责人确认两次群公开通知和两名 Reporter 各自 Confirm、Investigating、Resolved、Closed 四次私人通知均可见。未选入 Incident 的第三位只发群消息参与者产生 1 条独立非 Incident PERSON dead-letter；负责人已明确接受，没有盲重试、删除或改写。

观察 `1,708,934 ms` / 112 个样本。三业务角色 RSS 峰值 `227,713,024 bytes`，heap used 峰值 `58,059,280 bytes`；SSE 峰值 2，投影积压/失败和 Reconciliation 峰值 0，连接利用率采样峰值 7%。Gateway 自动重连 1 次。该结果不是 24 小时 soak 或真实 2C4G 硬件认证。

## 自动化、恢复与资源

现场前完整回归 559/559，现场后完整回归 559/559，均为 exit=0 且 fail/cancelled/skipped/todo=0。容量构造 500 Candidates、200 Incidents、2000 Reports、1000 Subscriptions、5200 Events、550 bindings；550 条模拟通知全部送达，32 SSE 与第 33 个 polling fallback 通过，单池 max=4。

自动化覆盖 12 路人工确认并发/重放、Link/Unlink/relink、主 Ticket、个人恢复隔离、通知去重/失败/UNKNOWN、响应丢失、Worker 崩溃、ACK 后重启不重发、真实 PostgreSQL fresh/upgrade/check/no-op/drift、原生桌面/移动浏览器与隐私边界。自动化真实 SDK、模型、OCR、RAG 调用均为 0。

提交后自检发现 Validator 的新增文件枚举只在形成提交后触发，误把 Validator 自身和两个 Incident 页面判为越界。修正仅收紧本任务路径规则；随后第一次完整重跑为 561 tests / 560 pass / 1 fail，唯一失败是冻结 P1-012 RECONNECT_GROUP_TEXT 在 10 秒内超时，原始 TAP 只去除行尾空白后保存在 `evidence/p2-012-closeout-regression-failure.tap`（SHA-256 `ebe0765fff2da0135f0b4ca7a20448722df9293667acefda3fec30a6991b26bc`）。未修改业务代码、测试超时或断言；精确失败用例随后 1/1 通过，见 `evidence/p2-012-closeout-reconnect-diagnostic.tap`（SHA-256 `058d3c8e4801e009206b88c078ac6c799bfeb2e22fd3858aeabb88720415974e`）。

最终完成态全量回归 561/561 PASS，exit=0，fail/cancelled/skipped/todo=0，耗时 `652089.1098 ms`；TAP 为 `evidence/p2-012-closeout-regression.tap`，SHA-256 为 `ae33e5a7ad06537b2c26af81647d0d3e36a3dfba3632c9d4c2d50dc3f5df2b99`。完成态治理文件之外的 427 个现场候选输入按 `evidence/p2-012-validated-candidate-inventory.json` 冻结。完成态只允许 4 个 Validator 与 4 个治理测试变化，业务 Runtime、HTTP、UI、SQL、Contract、Sender 和其余测试保持现场候选内容。

## 清理与停止线

现场数据库与 backend、三个角色进程、43112–43114 监听、浏览器 profile 和 5 个现场临时文件均为 0。最终完成态回归后再次核验 P2-012 测试库、backend、所属 Node 进程、监听和 browser profile 为 0；单独 TEMP 根 `tmp/p2012-regression-closeout-final2-dc4d1011f551418c89cdc5e30d498d7f` 保留 7 个非 profile 项，不声称文件系统全部清理。六个现场/现场后 Evidence 对 10 个本机敏感配置值精确匹配为 0；完整候选中的两次配置匹配仅来自 `.env.example` 的公开 Provider endpoint，不包含密码、Secret、Token、HMAC 或目标 ID。

P2 继续 IN_PROGRESS；last_completed_task=P2-012，last_completed_gate=P2-G1，last_completed_architecture_task=ARCH-006；active_task/active_lane=null。下一候选 P2-G2，next_task_authorized=false；P2-008 继续被 P2-G2 阻断，P3 未启动。所有持久默认 Feature Flag=false。唯一第二个本地提交后立即停止；未 push、PR、merge、tag 或 release。
