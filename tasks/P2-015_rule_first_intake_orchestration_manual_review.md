# P2-015 规则优先受理编排、跨渠道接触旅程与人工审核

- Status: TODO / REQUIRES_SEPARATE_AUTHORIZATION
- Phase: P2
- Lane: P2-C
- Target Gate: P2-G2
- Depends on: P2-G1, ARCH-005, P2-007, P1-004, P1-005, P2-004
- Migration reservation: 030（ARCH-006 不创建 SQL）
- Feature Flags: `RULE_FIRST_ORCHESTRATION_ENABLED=false`, `MANUAL_REVIEW_QUEUE_ENABLED=false`

## Objective

把 P2-007 纯函数装配到已持久化 Channel Message 与 Service Intake；支持 `GROUP_MENTION_INLINE`、`GROUP_MENTION_TO_DIRECT_GUIDED`、`DIRECT_ORGANIC`，建立 Contact Journey、Channel Leg、持久 `continuation_ref`、分段消息增量归约、可重放规则结果、一等人工审核队列和只经安全命令边界执行的动作建议。模型调用必须为 0。

## Inputs and outputs

- Input：已提交 Channel Message、P1 Service Intake/90 秒聚合事实、已有 Conversation/Ticket 引用、P2-007 目录/规则版本。
- Output：持久 Journey/Leg/continuation、deterministic decision、Manual Review item、Provenance、reason code 和 safe action suggestion。
- 不直接写 Ticket/Incident/Communication 表，不调用 Sender；只经 Unified Ticket Command/TicketActionService/Communication Service 等既有 Port。

## Acceptance

- 明确故障尽早创建最小 Ticket，不等待所有字段完整；
- 只 @Bot、问候、模糊描述或图片保留 Intake，并一次只问一个高信息量问题；
- 多开放 Journey 要求用户安全选择；
- 所有规则结果可重放且 determinism mismatch=0；
- `MANUAL_REVIEW_REQUIRED` 100% 可达，失败不静默忽略；
- 重放不重复建单、不重复通知；
- 模型、网络 Provider、真实 Incident 和直接 Sender 调用为 0；
- Unit/Contract/PostgreSQL Integration、隐私、安全、2C4G 有界队列和关闭回滚 Evidence 完整。

## Rollback

保持两个 Flag 为 false 并停止 Orchestrator/Review consumer；保留追加式审计。任何结构修复使用新迁移，不改写 030。

## Stop line

当前未授权、未实现。P2-015 完成也不授权 P2-016、P2-012、P2-G2 或 P2-008。
