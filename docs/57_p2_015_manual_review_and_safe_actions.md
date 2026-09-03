# P2-015 Manual Review 与安全动作

## Manual Review

`MANUAL_REVIEW_REQUIRED` 是安全成功路由，不是失败或忽略。歧义、冲突、临床高风险、规则/配置不可用、多 Journey 无法消歧、状态查询身份不明和动作不安全均必须建立 `intake.manual_review_item`。同一 Decision 最多一个活动 Review；队列按授权 Journey 在 SQL 中先裁剪，再按创建时间和 ID 做 keyset pagination，默认 30、最大 100，不使用 OFFSET。

内部 Query/Command Port 提供 `listManualReviews`、`getManualReviewDetail`、`resolveManualReview`、`getContactJourney`、`listJourneyLegs`、`listJourneyDecisions`、`processPersistedIntake`、`processDueBatch`、`replayDecision`。默认授权拒绝，必须注入 Authorizer。本轮没有 REST、Workbench Route 或 Web 文件。

resolve 使用 `expected_row_version + client_command_id + command_hash`。同命令同 Hash replay，同 ID 异 Hash conflict；行锁和版本条件保证两坐席并发最多一次有效决议。人工决议新增 `HUMAN_OVERRIDDEN` Decision，不覆盖原 Decision。`KEEP_INCIDENT_REVIEW_CANDIDATE` 仍不创建 Incident。

## Safe Action Executor

安全动作先作为 `intake.safe_action_suggestion` 与 Decision 同事务持久化。Executor 只接受：`ServiceIntakeDecisionPort`、现有 Ticket Core Adapter、P2-004 Communication Service、ManualReviewStore，以及未来显式注入的 Conversation Port。禁止 SQL 直写 Ticket/Communication、Sender、WeCom SDK、Incident Store 或 AI Provider。

`ServiceIntakeDecisionPort` 只锁定 Intake、验证允许映射、更新 request_type/status、递增版本并追加安全 Intake Event；它不写 Ticket。明确故障与 Service Request 随后调用现有 Ticket Core，12 路同源并发依靠现有 source_intake 唯一性和 Decision replay 只建一单。

固定澄清一次只问一个问题，使用固定 template code、`sender_kind=SYSTEM` 和 text/markdown；相同 action key replay 不重复 Message/Outbox/Delivery。Communication Port 失败会标记动作失败并建立 Manual Review，不伪造发送成功；Sender 调用始终为 0。内部 Review 不外发，template_card 不执行。

## 数据库与时间

权威结构是 `database/migrations/030_p2_015_rule_first_intake_orchestration.sql`，只创建六张 `intake.*` 表并扩展既有 Intake Event Check；不创建 Trigger、持久 Function、Extension、ORM、Redis 或 Broker。业务时间为 `YYYY-MM-DD HH:mm:ss`，TTL/claim/deadline 使用 BIGINT epoch 且 Node 保持 string；同秒顺序依赖 message sequence、leg/decision/action ordinal 与 row_version。
