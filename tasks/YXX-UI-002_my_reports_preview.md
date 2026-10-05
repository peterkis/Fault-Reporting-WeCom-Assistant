# YXX-UI-002 网页报修列表摘要和位置

状态：IMPLEMENTED_WAITING_REVIEW。2026-10-05 用户授权“按照建议，逐切片依次完成剩下的候选”；本切片承接 R00 候选 B，完成审查、合并后再执行 C。实际最终回归、审查和交付结果以 PR HANDOFF 为准。

输入为当前成员的本人列表请求；输出保留 source-bound cursor、编号、状态和时间，新增 `safe_summary`（string/null，最多 120 个 Unicode 字符）和 `safe_location`（string/null，最多 80 个 Unicode 字符）。只读取本人、同 corp/app、未撤销且 binding/intake 未过期的 WEB 初始 SUBMIT；SUBMIT 过期时两字段为 null，BOT 两字段始终 null。空文本为 null；补充、内部备注和 Bot 原文不进入预览。字段名不代表 AI 脱敏。

公开验证边界已由 R00 推荐及本次实施授权确认：成员 Query 真实数据库集成、原生 same-origin HTTP/浏览器操作、闭合 Schema 合同。每次一条行为测试 RED→GREEN；直接回归 SS-005、SS-002、SS-007 browser/acceptance，保留 v3-p09 四项 smoke、strict types、最终候选一次构建和制品检查。

无数据库结构或迁移变更；只扩展既有 SELECT 与 report-page/OpenAPI。前端纯文本显示，不逐卡请求详情、不存储正文。列表每页 20（服务端上限 50），沿用连接池、授权 recheck 与 operation fence，不新增进程/轮询/外部依赖。Feature Flag 默认 false；关闭原入口或独立 revert PR 回退。

实际被测 SHA、RED/GREEN、运行数、制品和自有 loopback PG18/浏览器清理记录在 PR HANDOFF 与仓库外 `D:/Agent-State/wecom-yxx-report-preview-20261005/`。ticket-plan 单列业务增量，不改历史完成态、Gate、Evidence、selection 或迁移分母。按已授权流程 @codex review，修复至无剩余问题后保留祖先合并、main 快进、选择性清理。无 full/certify、R01、生产/现场操作。
