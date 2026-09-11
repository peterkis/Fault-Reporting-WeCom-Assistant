# PR #7 review 处理记录

日期：2026-09-11。首轮审查提交：`ded873eae9bfd864497ad5c3be3f3919ac6b81f3`。PR：`https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/7`。

## 修复与核验

1. GitHub comment `3985165158` / P1：高风险显式续报经人工 `CONFIRM_TICKET_ELIGIBLE` 后重复创建 Ticket。真实 HTTP + 隔离 PostgreSQL 回归先复现原 1 张 Ticket 变为 2 张；将既有自动执行路径的关联 Ticket 来源查询集中到 `p2016TicketSourceIntake`，人工与自动路径共用。修复后原 Ticket、Journey 绑定、审核原始 Decision 和通知数量保持，命令重放不建第二单。
2. GitHub comment `3985165162` / P1：认为合法内部备注会导致 `internal_note_leaks>0`。在未修改对账生产代码时添加真实 PostgreSQL 回归：通过授权 HTTP 创建内部备注，实际 message=1、关联 Outbox=0、只读对账 leaks=0。现有 `INNER JOIN communication.outbox` 与 `appendCommunication` 的内部备注提前返回已满足要求；此条为已验证误报，仅保留回归，不削弱泄漏判定。
3. 本地 SPEC/STANDARDS 两轴 / P2：目录接口非成功 HTTP 响应未取消流。两个用例先 RED；修复失败响应取消与 Directory Port 的最终 signal 中止。成功、失败、超时均清理，挂起提供商的单并发隔离保留。

定向验证：`p2-g2-directory-resource`、`p2-g2-member-directory`、`p2-g2-pr7-review.integration`、`p2-016-manual-review.integration` 共 10/10 PASS，包含真实隔离 PostgreSQL，清理检查通过。验证只使用本地测试库及模拟外部提供商，无真实消息发送。

最初发布提交上的完整回归在原工作树运行；修复在独立工作树完成，避免修改正在验证的候选。完整回归与最终 review 状态通过 PR 追加记录，不能把旧树结果表述为新树的完整验证。

这些修复未更改云端六文件 OAuth-only 发布内容，已验证的实际成员认证保持原部署；不改变数据库迁移、持久业务开关、P2-G2-LIVE 或 Gate 批准。

## 完整回归暴露的问题

发布提交 `ded873e` 的完整回归：972 tests / 970 pass / 2 fail，候选未变化，退出 1；原始记录保留于 `tmp/p2-g2-tests-eb67da09-1735-4dab-8c6d-7dd824f19151`。

- 冻结检查使用 `origin/main...HEAD`，此前在未提交工作树执行时漏看已获授权的规则引擎改动，提交后才失败。改为固定 `8c33271` 与当前工作树比较，只允许 `evidence/p2-g2-gold-repair-authorization.md` 明确授权的 `src/p2-007-rule-engine.mjs` 例外，其余 P2-007 模块及迁移保持冻结。历史 954 项实际执行结果保留，不追认为这条旧断言已覆盖未提交改动。
- D12-063 在第 3 个 Reporter 后后台已生成不可变的 3 人候选，但测试取列表第一项并传入 4 人旧引用，生产端正确返回 `P2_012_SOURCE_CONFLICT`。增加真实后台 tick 稳定复现 RED；测试随后明确选取 4 人候选，并通过该候选详情的 `report_sources` 提交有效引用。生产来源校验未修改，4 个订阅、1 群+4 私人通知和重放零增量断言保留。

上述两文件定向验证 10/10 PASS。GitHub comment `3985236756` 要求重新绑定当前就绪证据；必须等待包含这些修复的完整回归通过，再生成当前候选报告和独立审查引用。
