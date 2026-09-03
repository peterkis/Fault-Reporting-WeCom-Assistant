# P2-015 规则优先受理编排完成报告

- Task：`P2-015`
- 状态：`DONE`
- 完成日期：2026-09-03（Asia/Shanghai LocalDate）
- 授权起点：`55a99e768643423a2bfaf5190266ee46b39e6090`
- 授权 Evidence：`evidence/p2-015-start-authorization.md`
- 实现提交：`feat(p2): implement P2-015 rule-first intake orchestration`
- Feature Flags：`RULE_FIRST_ORCHESTRATION_ENABLED=false`、`MANUAL_REVIEW_QUEUE_ENABLED=false`；全部其他 Feature Flag 仍为 `false`

## 精确提交范围

第二提交只包含 P2-015 migration、Contract、Runtime Adapter/Orchestrator/Worker、内部 Query/Command Port、测试/fixture、迁移/对账/Validator、文档、本完成 Evidence，以及把 P2-015 收口为 DONE 的机器状态与后继状态兼容校验。未修改 migration 001 至 022、`src/p2-007-*`、P1 Runtime、P2-004 Communication Core、真实 WeCom Sender、Web UI 或历史完成 Evidence。

## Migration 030 catalog

权威文件：`database/migrations/030_p2_015_rule_first_intake_orchestration.sql`。fresh 001→022→030、existing 022→030、重复 apply no-op、`--check` rollback 和五类 drift 均通过。

- 表（6）：`intake.contact_journey`、`intake.channel_leg`、`intake.continuation_ref`、`intake.deterministic_decision`、`intake.manual_review_item`、`intake.safe_action_suggestion`；
- catalog Constraint：198（含 PostgreSQL 18 的 NOT NULL catalog constraints）；
- catalog Index：33；
- FK：24；
- 显式关键 Index（13）：Journey reporter/status/activity、evaluation due；Leg journey/ordinal、session、source message；Continuation active purpose、expiry；Decision source window、result/review；Review pending priority keyset、one-pending-per-decision；Safe Action state/created、result ref；
- FK 目标：既有 `intake.service_intake`、`conversation.thread/session`、`pilot_ticket.ticket/pilot_principal`、`channel.message_inbox` 和六表内部关系；
- 新 Trigger=0、持久 Function=0、Extension=0、时区类型=0、第七张业务表=0。

## 功能与确定性

- 三入口通过：`GROUP_MENTION_INLINE`、`GROUP_MENTION_TO_DIRECT_GUIDED`、`DIRECT_ORGANIC`；
- 群/单 Thread 不合并：每个 Channel Leg 保留独立 Thread/Session FK，跨渠道仅由 Journey 关联；同 reporter+时间不会形成关联，多个候选返回 `ASK_USER_TO_SELECT`；
- continuation_ref：首次原 token 仅返回调用方，数据库仅存 SHA-256；reporter/bot/purpose 绑定、最大 120 分钟 TTL、wrong binding、expired、revoked、second consume 均失败关闭；相同 issue key 返回同一 ref，不增行；
- 分段窗口：最多 50 turns / 20,000 字符；超限进入 Manual Review；
- 金标覆盖冻结来源案例 96 + 42 + 64 = 202，ID-only、不复制原消息；`deterministic_safe_route_coverage=202/202=100%`；
- 十类分布：TICKET_ELIGIBLE 66、NEEDS_DESCRIPTION 21、MANUAL_REVIEW_REQUIRED 37、RELATED_FOLLOW_UP 27、STATUS_QUERY 1、SERVICE_REQUEST 1、BUSINESS_CONSULTATION 6、ACKNOWLEDGEMENT 6、OUT_OF_SCOPE 3、INCIDENT_REVIEW_CANDIDATE 34；
- `explicit_incident_report_missed=0`、`clinical_high_risk_missed=0`、`real_fault_auto_ignored=0`、`unsupported_root_cause_confirmed=0`、`manual_review_reachable=100%`、`same_user_time_only_false_link=0`、`determinism_mismatch=0`、`model_provider_calls=0`。

## Ticket、Review 与 Communication

- 明确故障和 Service Request 只经 `ServiceIntakeDecisionPort` + 既有 `createPilotTicketCore().createForIntakeInTransaction()`；12 路同 source 结果为 Ticket=1，重复 Decision/Journey/Ticket=0；
- P1 已有 Ticket 返回 replay；action failure 不伪造 Ticket；P2-015 未包含 Ticket INSERT、编号或状态机复制；
- ambiguity/config failure/high-risk/multiple journey 均可入队；授权裁剪在 LIMIT 前、keyset 分页默认 30/最大 100、默认拒绝；
- 两坐席不同 command 并发 resolve 仅 1 个成功；同 command replay；Human resolution 新增 1 条 `HUMAN_OVERRIDDEN` Decision，原 Decision 未覆盖；
- 固定澄清 replay 后 Communication Message/Outbox/Delivery 各 1；Sender 调用=0，template_card 调用=0；Communication Port 失败进入 Review，不伪造外发；内部 Review 外发=0；
- Incident create/link/broadcast/subscription=0。

## Worker、2C4G 与恢复

- Worker count=1、Pool max=4、默认 batch=20、最大 batch=100、recovery poll=5 秒；PostgreSQL `FOR UPDATE SKIP LOCKED`，无持久内存队列；
- 受控真实子进程：crash before commit 后 Journey/Decision/Ticket=`0/0/0`；crash after commit 后为 `1/1/1`；重启 `processed=0` 且重复增量=0；
- 短时容量/恢复（不是 24 小时 soak）：500 Journeys、2,000 Turns、500 Decisions、100 Manual Review Items，三入口混合；
- 最终全仓回归中的分段 heap bytes：`11067536, 16429888, 23633472, 33420000, 27799712, 25840992`，峰值后回落，`heap_fall_or_stable=true`；
- Timer/child/socket/backend/临时数据库残留=0；Redis/Broker/ORM/本地 LLM=0。

## 安全、隐私与回归

- ordinary plain JSON fence 拒绝 Proxy、accessor、symbol、toJSON、非普通 prototype、cycle 和污染键；错误仅返回稳定 code；
- 新表 raw provider userid/chatid/continuation token/患者标识/内部 IP 泄漏=0；profile public view 隐藏 Snapshot；
- migration 001 至 022 diff=0；`src/p2-007-*` diff=0；P2-007 fixture diff=0；真实 Sender/AI Provider/OCR/Incident Store/P2-016 UI/Route/archive/.env.pilot diff=0；
- P2-015 Unit 命令：18/18；P2-015 Integration：7/7；Architecture V1.4：14/14；
- 全仓最终回归：462/462，fail=0、cancelled=0、skipped=0、todo=0；覆盖 P1-004/005/006/012、P2-001 至 P2-007、P2-G1、ARCH-005、ARCH-006。

## 未解决问题与停止线

未解决产品范围：P2-016 完整 Ticket 生命周期 UI/REST、P2-012 真实 Incident、P2-G2 真实三入口完整服务闭环现场 Gate、template_card、Reporter Portal、AI/DeepSeek/OCR 均未实现或未启动。真实三入口与完整服务闭环留给后续 P2-G2 统一现场验收。

P2-015 完成后立即停止。P2-016 是下一候选但未授权；P2-012、P2-G2、P2-008 均未启动。所有 Feature Flag 保持 `false`；未 push、merge、tag、PR 或 release。
