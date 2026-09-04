# P2-016 完整工单生命周期工作台、上报人时间线与可靠通知

- Status: AUTHORIZED
- Authorized at: 2026-09-04
- Authorization evidence: `evidence/p2-016-start-authorization.md`
- Phase: P2
- Lane: P2-B
- Target Gate: P2-G2
- Depends on: P2-015, P1-006, P2-004, P2-005, P2-006
- Migration reservation: 031（仅确有新持久化需要；ARCH-006 不创建 SQL）
- Feature Flags: `TICKET_LIFECYCLE_WORKBENCH_ENABLED=false`, `REPORTER_TIMELINE_ENABLED=false`, `WECOM_TEMPLATE_CARD_ENABLED=false`

## Objective

让 Workbench 经现有 TicketActionService 完成 queue、accept、start、request-information、resume、wait-vendor、resolve、confirm、reopen、cancel、auto-close、add-note 的完整闭环；区分 Conversation Assignment 与 Ticket Assignment；提供 Manual Review UI、Reporter-safe Timeline、群安全回执、主动单聊、Ticket 创建/状态模板卡片和基于 Ticket Event 的可靠通知。AI 完全关闭。

## Inputs and outputs

- Input：P2-015 decisions/review items、P1-006 Ticket Action/Event、P2-004 Communication、P2-005 Conversation Control、P2-006 Workbench。
- Output：认证授权的 Ticket Query/Command API、双责任视图、完整状态 UI、Reporter Audience、Notification Policy、Communication intents 和受控 Sender adapter。
- 所有写命令强制 Authentication、Authorization、If-Match、Idempotency-Key、TicketActionService、Ticket Event；需要通知时同事务提交 Communication Outbox。

## Acceptance

- 文档 52 的完整 Ticket 生命周期、取消、并发接单、版本冲突、转派、拒绝解决、自动关闭、发送失败全部真实 UI 通过；
- 全部 Ticket Action 可经 UI 完成并在刷新后与权威状态一致；
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

当前已独立授权，活动 Lane 为 `P2-B`；尚未实现或验收。自动化通过后先停在 `READY_FOR_TARGETED_LIVE_VALIDATION`，真实现场验证和负责人明确批准前不标记 DONE、不创建第二提交。P2-016 完成也不授权 P2-012、P2-G2 或 P2-008。
