# P2-016 实现前能力盘点

- 基线：`3599fa479c752ed75cd4652e5ffdaee2b212ad24`（独立授权提交）；原 P2-015 主线 `b1b8e4deb14e6290ca45aea12d92baaef4728c11`。
- 本盘点是源码、编号 Migration 与当前 Contract 的装配差距记录，不是自动化通过、现场验收或完成 Evidence。
- P2-015 历史账本漂移已在授权提交纠偏；原实现和完成 Evidence 不变。

## 已有权威能力

1. **ticket_core** — `src/p1-005-pilot-ticket-core.mjs`：createForIntakeInTransaction creates/replays one Ticket per Intake; creation currently enters QUEUED, not NEW.
2. **ticket_actions** — `src/p1-006-ticket-state-actions.mjs`：Twelve explicit actions, appendTicketEvent, aggregate version/ordinal, authorize callback, performInTransaction and afterAction already exist; transfer-assignment absent.
3. **conversation_control** — `src/p2-005-conversation-control.mjs`：Assignment/Handoff and control-event idempotency exist; takeoverSession owns its transaction, no public caller-owned takeover seam.
4. **communication** — `src/p2-004-communication-core.mjs`：appendCommunication uses caller-owned transaction and creates Message/Outbox/Delivery; public service rejects template_card as media not yet authorized.
5. **delivery** — `src/p2-004-communication-delivery-worker.mjs`：Existing lease/retry/attempt/reconciliation worker is the delivery authority; no new delivery state owner is permitted.
6. **workbench** — `src/p2-006-workbench-http.mjs`：Native internal reference UI, Cookie/Bearer boundary, CSRF, durable SSE and polling shell exist; no full Ticket or Manual Review routes.
7. **manual_review** — `src/p2-015-manual-review.mjs`：Store list/get/resolve, version conflict and appended HUMAN_OVERRIDDEN Decision exist; resolve takes a caller transaction, query-service wrapper owns a transaction.
8. **safe_action** — `src/p2-015-safe-action-executor.mjs`：Injected Intake/Ticket/Communication ports execute stored safe actions; fixed-send failure produces failed_safe result and review, so P2-016 atomic facade must reject it and roll back.
9. **sender** — `src/p2-g1-wecom-sender.mjs`：Real text/markdown sender uses target hash allowlist, explicit errcode=0 ACK and UNKNOWN; text maps to SDK markdown.
10. **card_probe** — `src/g0-006-template-card.mjs`：G0 card probe exists; not an assembled P2-016 sender or P2-016 client validation.
11. **sdk** — `node_modules/@wecom/aibot-node-sdk/dist/index.d.ts`：Installed package 1.0.6: sendMessage(chatid, SendMsgBody); msgtype=template_card; template_card.card_type=text_notice, source/main_title/emphasis_content/sub_title_text/horizontal_content_list/jump_list/card_action/task_id.
12. **time** — `docs/48_arch_005_asia_shanghai_time_contract.md`：Business LocalDateTime strings and timestamp without time zone; BIGINT epoch strings and explicit same-second source ordering.

## 必须补齐的缺口

1. **manual_review_rest_ui**：Authenticated bounded list/detail/resolve and Journey views absent.
2. **atomic_resolution**：Resolve plus resolution-specific stored Safe Action absent; command hash must include target/required input; failure must roll back resolution.
3. **ticket_workbench**：Ticket keyset list/detail/events/responsibility/deliveries and all legal action controls absent.
4. **command_receipt**：Durable browser Ticket command receipt with scope/id/hash and crash replay absent.
5. **transfer**：No current Ticket transfer action; narrowly add authoritative assignment/version/event behavior without second assignment table.
6. **dual_responsibility**：Conversation and Ticket assignment not displayed independently together.
7. **combined_command**：Atomic takeover plus accept absent; needs narrow backward-compatible caller-owned Conversation seam.
8. **notification_binding**：No versioned Ticket Event to Communication identity/binding; preserve P1 notification facts and avoid duplicate dispatch.
9. **card_sender**：No P2-016 composite card Sender; first version PERSON only and gated false by default.
10. **reporter_access**：No opaque public ref, one-time reconstructable HMAC grant, bound HttpOnly session, audit or Reporter page.
11. **suffix_authorization**：Need tests proving suffix never acts as key, identity or authorization and public ref alone cannot grant access.
12. **group_direct**：Journey/Safe Action guidance is not a proven atomic, idempotent group-safe receipt plus proactive person flow.
13. **targeted_live**：No P2-016 live WeCom/card/fragment evidence or owner approval; must stop after automated readiness before real sends.

## 持久化判断

需要新增 migration 031，最多六张表：

- `pilot_ticket.ticket_command_receipt`
- `pilot_ticket.reporter_public_ref`
- `pilot_ticket.reporter_access_grant`
- `pilot_ticket.reporter_access_session`
- `pilot_ticket.reporter_access_event`
- `communication.ticket_notification_binding`

Command receipt 仅持有命令收据；notification binding 仅持有事件到 Message 的幂等映射；Reporter 表仅持有绑定访问能力，不成为身份主表。Ticket、Conversation Assignment 和 Delivery 仍保留各自唯一事实源。

允许在 031 狭窄扩展 Ticket Event check 与 nullable 安全 metadata；不修改 migration 001～030、不改写历史行、不新增 Trigger/持久 Function/Extension、Ticket/Delivery/Assignment 副本或时区类型。

## 装配注意事项

- 既有 Ticket 创建结果是 QUEUED；NEW→queue 只验证既有合法 Action，不擅自改变创建语义或增加 NEW→WAITING_REQUESTER 捷径。
- Conversation 接管、Ticket accept、命令收据、事件和通知需要同一事务；任何旧服务返回失败对象都必须转为事务失败，不能把部分成功返回 UI。
- Human Override 不直接沿用原 Decision 的建议动作；P2-016 必须按 resolution code 产生允许的动作，并保留原 Decision。
- P2-015 store.resolve 已有 transaction 参数；避免为一个已存在的接口重复创建 seam。
- P2-G1 Sender 的 text/markdown 行为保持不变；卡片须通过新的受控 Composite Sender。
- Context7 搜索没有对应 Node SDK 条目（只返回其他语言/相关库）；没有用这些结果替代安装的 Node 1.0.6 API。
- 旧文档中的 Incident 通知仅属后续规划；本轮真实 Incident 创建/关联/广播与 Reporter Subscription 均为 0。

## 验证与停止线

本盘点未运行 P2-016 实现测试、未调用 Sender、模型或 OCR，未连接真实企业微信。后续必须完成 Prompt 的 Migration、事务/幂等、权限、Reporter、Sender、浏览器、容量/恢复和全仓回归矩阵。自动化全通过后停在 READY_FOR_TARGETED_LIVE_VALIDATION；现场审批和真实客户端观察之前不标记 DONE、不创建第二提交。
