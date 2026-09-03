# P2-015 规则优先受理编排

## 范围

P2-015 在已提交的 P1 Channel Message 与 Service Intake 之后运行。它消费冻结的 P2-007 纯函数输出，持久化确定性 Decision、Provenance 和安全动作建议，再经注入 Port 调用既有 Ticket Core 或 Communication Service。规则失败不会回滚 P1 事实，也不会静默忽略。

```text
committed Channel Message / Service Intake
→ PostgreSQL due scan
→ Contact Journey / independent Channel Leg
→ bounded message window
→ frozen P2-007 pure rule engine
→ deterministic safe route
→ Decision + Provenance + Safe Action in one transaction
→ injected safe Port
→ commit
```

P2-015 不在 P1 入站事务中运行，不使用内存队列作为事实源，不等待任何外部网络，不调用 Sender、企业微信 SDK、AI Provider、OCR 或 Incident Store。

## 十类结果

一等结果固定为：`TICKET_ELIGIBLE`、`NEEDS_DESCRIPTION`、`MANUAL_REVIEW_REQUIRED`、`RELATED_FOLLOW_UP`、`STATUS_QUERY`、`SERVICE_REQUEST`、`BUSINESS_CONSULTATION`、`ACKNOWLEDGEMENT`、`OUT_OF_SCOPE`、`INCIDENT_REVIEW_CANDIDATE`。每条结果包含版本、输入/结果 Hash、源引用、显式 message sequence window、Fact Provenance、已知/未知字段、冲突、临床风险、人工审核标记和安全动作建议。

明确技术故障优先于致谢和低风险分类；字段不完整不阻止最小 Ticket。高风险、冲突、规则不可用或无法安全执行时进入 Manual Review。Incident Candidate 只进入内部 Review，绝不创建或关联 Incident。

## 三入口与执行边界

- `GROUP_MENTION_INLINE`：群来源 Leg 保留，可创建最小 Ticket；
- `GROUP_MENTION_TO_DIRECT_GUIDED`：群来源 Leg 保留，生成一次性 continuation_ref 和固定单聊引导；真实 Direct 上下文到达前不创建 Direct Leg；
- `DIRECT_ORGANIC`：无可靠关联时建立新 Journey，不按同一 userid 加时间接近猜测关联。

Ticket 创建只调用现有 `createPilotTicketCore().createForIntakeInTransaction()` Adapter；P2-015 不包含 Ticket INSERT 或编号逻辑。固定澄清/致谢/范围通知只调用 P2-004 `appendCommunication()`，写 Message/Outbox/Delivery 但不调用 Sender，且只允许 text/markdown。

## Worker 与关闭方式

单 Worker、Pool `max<=4`、默认 batch 20、最大 100、恢复轮询默认 5 秒。每次从 PostgreSQL 扫描已提交事实并使用 `FOR UPDATE SKIP LOCKED`；crash before commit 不留下部分事实，crash after commit 重启得到 replay。停止时清理 Timer 并等待当前有界批次完成。

`RULE_FIRST_ORCHESTRATION_ENABLED=false` 或 `MANUAL_REVIEW_QUEUE_ENABLED=false` 时 Worker 不 claim。两个 Flag 与全部 AI/OCR Flag 的提交默认值均为 `false`。回滚方式是保持 Flag 关闭并停止 Worker，保留追加式审计；结构修复只能使用新 migration。
