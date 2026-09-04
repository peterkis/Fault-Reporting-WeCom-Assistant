# P2-016 完整工单生命周期工作台、上报人时间线与可靠通知

- Status: DONE
- Completed at: 2026-09-04
- Completion evidence: `evidence/p2-016-ticket-lifecycle-workbench-report.md`
- Owner approval: `evidence/p2-016-project-owner-approval.md`
- Authorized at: 2026-09-04
- Authorization evidence: `evidence/p2-016-start-authorization.md`
- Phase: P2
- Lane: P2-B
- Target Gate: P2-G2
- Depends on: P2-015, P1-006, P2-004, P2-005, P2-006
- Migration: 031（六张辅助表；隔离自动化库和临时现场库已核验，现场库已清理；原配置库未迁移）
- Feature Flags: `TICKET_LIFECYCLE_WORKBENCH_ENABLED=false`, `REPORTER_TIMELINE_ENABLED=false`, `WECOM_TEMPLATE_CARD_ENABLED=false`

## Objective

让 Workbench 经现有 TicketActionService 完成 queue、accept、start、request-information、resume、wait-vendor、resolve、confirm、reopen、cancel、auto-close、add-note 的完整闭环；区分 Conversation Assignment 与 Ticket Assignment；提供 Manual Review UI、Reporter-safe Timeline、群安全回执、主动单聊、Ticket 创建/状态模板卡片和基于 Ticket Event 的可靠通知。AI 完全关闭。

## Inputs and outputs

- Input：P2-015 decisions/review items、P1-006 Ticket Action/Event、P2-004 Communication、P2-005 Conversation Control、P2-006 Workbench。
- Output：认证授权的 Ticket Query/Command API、双责任视图、完整状态 UI、Reporter Audience、Notification Policy、Communication intents 和受控 Sender adapter。
- 所有写命令强制 Authentication、Authorization、If-Match、Idempotency-Key、TicketActionService、Ticket Event；需要通知时同事务提交 Communication Outbox。

## Acceptance

- 文档 52 的完整 Ticket 生命周期、取消、并发接单、版本冲突、转派、拒绝解决、自动关闭、发送失败全部真实 UI 通过；
- 全部普通坐席 Ticket Action 可经 UI 完成并在刷新后与权威状态一致；auto-close 仅由既有 SYSTEM policy 执行并单独测试；
- Conversation/Ticket 双责任不互相覆盖，复合接管/接单全成或全败；
- 内部备注、审核意见、Read Cursor、权限失败、Reconciliation、其他上报人数据外泄为 0；
- Reporter Timeline 使用 opaque ref + 身份/绑定会话授权；尾号不作凭证；
- 群回执、主动单聊、模板卡片和状态通知幂等；状态通知恰好一次；UNKNOWN 不盲重发；
- template_card 默认关闭，启用前有真实 Provider ACK 和客户端验证；群强 @ 保持 UNVERIFIED；
- 发送失败不回滚 Ticket；AI/模型调用为 0；
- Unit/Contract/PostgreSQL Integration/UI/真实企业微信受控测试、隐私、安全、2C4G 和关闭回滚 Evidence 完整。

## Rollback

保持三个 Flag 为 false；关闭新增 Route/Policy/Sender，既有 P1/P2 Human-only 链继续。追加事实保留，不修改历史迁移。

## Stop line

最新进展：负责人操作的定向现场技术检查与 2,780,329 ms 观察已完成；测试库已删除，现场后全量回归 533/533。详见 `evidence/p2-016-targeted-live-validation.md` 与 `evidence/p2-016-post-live-regression-report.md`。负责人已明确批准；任务收口为 DONE，实施提交仅限既定第二个本地提交。

当前 P2-016 为 DONE，无活动任务或 Lane。现场、回归及负责人批准见完成报告；所有默认 Flag 为 false。P2-016 完成也不授权 P2-012、P2-G2 或 P2-008。
