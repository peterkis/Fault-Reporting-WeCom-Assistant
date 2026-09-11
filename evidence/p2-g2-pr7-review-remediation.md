# PR #7 review 处理记录

日期：2026-09-11。首轮审查提交：`ded873eae9bfd864497ad5c3be3f3919ac6b81f3`。PR：`https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/7`。

## 修复与核验

1. GitHub comment `3985165158` / P1：高风险显式续报经人工 `CONFIRM_TICKET_ELIGIBLE` 后重复创建 Ticket。真实 HTTP + 隔离 PostgreSQL 回归先复现原 1 张 Ticket 变为 2 张；将既有自动执行路径的关联 Ticket 来源查询集中到 `p2016TicketSourceIntake`，人工与自动路径共用。修复后原 Ticket、Journey 绑定、审核原始 Decision 和通知数量保持，命令重放不建第二单。
2. GitHub comment `3985165162` / P1：认为合法内部备注会导致 `internal_note_leaks>0`。在未修改对账生产代码时添加真实 PostgreSQL 回归：通过授权 HTTP 创建内部备注，实际 message=1、关联 Outbox=0、只读对账 leaks=0。现有 `INNER JOIN communication.outbox` 与 `appendCommunication` 的内部备注提前返回已满足要求；此条为已验证误报，仅保留回归，不削弱泄漏判定。
3. 本地 SPEC/STANDARDS 两轴 / P2：目录接口非成功 HTTP 响应未取消流。两个用例先 RED；修复失败响应取消与 Directory Port 的最终 signal 中止。成功、失败、超时均清理，挂起提供商的单并发隔离保留。

定向验证：`p2-g2-directory-resource`、`p2-g2-member-directory`、`p2-g2-pr7-review.integration`、`p2-016-manual-review.integration` 共 10/10 PASS，包含真实隔离 PostgreSQL，清理检查通过。验证只使用本地测试库及模拟外部提供商，无真实消息发送。

最初发布提交上的完整回归在原工作树运行；修复在独立工作树完成，避免修改正在验证的候选。完整回归与最终 review 状态通过 PR 追加记录，不能把旧树结果表述为新树的完整验证。

这些修复未更改云端六文件 OAuth-only 发布内容，已验证的实际成员认证保持原部署；不改变数据库迁移、持久业务开关、P2-G2-LIVE 或 Gate 批准。
