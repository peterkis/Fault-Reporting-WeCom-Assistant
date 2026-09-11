# P2-G2 两条领域缺口的独立修复授权

日期：2026-09-08。负责人明确授权修复状态查询和业务咨询缺少人工降级的两条已复现缺口，优先复用现有Manual Review和安全动作机制；完成契约核对、RED/GREEN后继续原P2-G2准备、Direct Leg修复、完整自动化回归和就绪候选提交，停在READY_FOR_LIVE_E2E。

当前分支 `phase2/gate-p2-g2-rule-first-service-loop`，HEAD `d7311cdbfe30c66f37d22a553a3e8f0e04e27cd1`，冻结merge仍为 `8c332710dad9b6cf3f6796f3344c04d1c710ddf3`。已存在的诊断、云端准备、手册及其未提交文件全部保留，不reset/stash/clean。原阻塞报告及RED输出作为修复前事实保留。

## 契约核对与最小实现

依据Accepted ADR-0017、docs51/54/57：未知关联/政策必须有持久、可处理的人工降级。现有QUERY_AUTHORIZED_STATUS与ROUTE_BUSINESS_CONSULTATION均为HUMAN_CONFIRM_REQUIRED，但执行器只留下PROPOSED。授权在 `createSafeActionExecutor` 中复用现有ManualReviewStore，将这两条安全路由落实为Review；使用原Decision/reason、自然键和事务，不新增自动状态查询/政策回答、第二队列或业务表。

Action的EXECUTED结果引用MANUAL_REVIEW，只表示路由已入队，不表示已经查询状态、回答政策或完成了人工审核。分类Decision与P2-007/202条冻结语料不改写；实际审核队列以manual_review_item为事实源，与既有通信失败降级保持同一机制。队列失败回滚规则事务，已提交Message/Intake仍可恢复。

已确认的测试接缝沿用原Prompt及本次授权：正常Frame/Inbox/Intake → 真实隔离PostgreSQL → Worker/Safe Action → 实际HTTP Review查询/决议；验证持久化先后、并发幂等、失败恢复、人工处理和无虚构Ticket/通知。无需重新请求相同接缝授权。

这次额外授权仅覆盖上述两条执行语义；不扩展其他领域规则。保持AI关闭，不启动P2-008，不真实发送，不关闭Gate，不push/merge/tag。云端现有原生PG与停止态包保留；本地修复不会自动激活它们。准备候选必须完成全部原测试与新增矩阵后才能提交，不把局部GREEN记作READY。
