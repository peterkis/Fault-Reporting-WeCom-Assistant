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

独立工作树上的 `3316792` 完整运行另记录 976/969/7：包含上面两个已知测试问题；两项原始字节校验因 Windows 自动转 CRLF 失败；三项旧 CLI 子进程因独立工作树没有 `.env.pilot` 在 Node 参数阶段退出 9。该运行保留为失败，不作为当前主工作树就绪依据。仅为原本按原始 Git 字节冻结的 001–009 SQL 与 P2-012 场景 JSONL 添加 `-text` 属性，未修改迁移内容；恢复 Git 原始字节后的两项静态校验 2/2 PASS。当前完整回归在原主工作树运行，其候选指纹已逐文件验证与 Git 提交内容一致。

最终主工作树完整回归：源码提交 `a03e7ad141777537207902124b32d2ce2e30445c`，候选 `64c5a08a11bb4d140b02cf0c5e43758ea57d01e76f6bfaa3b34f819c188d249e`，976/976 PASS、158 文件，退出 0、无跳过/取消、候选未变。新完整记录、202 条来源审计、37 场景、10 条 PR #6 约束、分类指标和两轴独立审查以 `p2-g2-pr7-*` 文件单独保存；旧954项源文件保留，旧就绪报告另存为 `p2-g2-pre-oauth-readiness-report.json/md`。

当前 `requirePreparedG2Candidate()` 已验证通过，解决 comment `3985236756` 的旧候选绑定问题。基线覆盖明确区分 92 个根目录测试和 2 个子目录测试，共 94 个；全部包含在这次158文件运行中。完整运行历史见 `p2-g2-pr7-regression-history.json`。这些证据更新不改变业务源码候选，不构成 G2 现场或负责人 Gate 批准。

第二工作树核验还发现两份既有 PowerShell 脚本在 Windows 检出时被转为 CRLF，而既有候选算法按原始字节记录 `.ps1`。为 `/scripts/*.ps1` 添加字节保留属性；不改脚本或候选算法。主工作区源码和 Git 字节对应的候选仍为同一 `64c5a08a…`；按该属性重新检出的两份脚本逐字节匹配 Git，第二工作树也通过同一候选的17项就绪校验，STANDARDS 已独立复核。第二工作树未重新执行完整数据库回归。
