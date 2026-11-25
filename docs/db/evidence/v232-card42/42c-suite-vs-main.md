# 42C 全量测试与 main 基线对照（本机 PG18.6）

- 环境：macOS（Apple Silicon）、Node v24.18.0、PostgreSQL 18.6、本机 Chrome；`TMPDIR` 指向非符号链接目录，`H5_MEDIA_FFMPEG` / `H5_MEDIA_FFPROBE` 已设置。
- 分支库：`ticket_card42c`；基线库：`ticket_card42c_main`（干净 main `5bc972fb` 的独立 worktree 与独立构建）。测试工具从这两个连接为每个用例另建临时库，共享库 `postgres` 未被使用。
- 范围：CI `pr-plan` 为本 PR 选中的 106 个文件，加上全部 `pc-admin-*` UI 套件（含 36A–39C），以及使用本次改动过的夹具（web01 / t43 / full-schema / SS-009 / SS-010 / T11 / T20）的全部测试，共 349 个文件，每个文件单独进程运行。
- 分支最终一轮：306 个文件通过，43 个文件失败。

## 由 42C 引起并已修复

| 文件 | 原因 | 修复 |
| --- | --- | --- |
| pc-admin-card32d/34a/34b/34c/35a/35c、wbint-t43-competition-recovery、wbint-t43-material-projection | 全量夹具在 049 之前执行退回派单迁移，缺 057 回执，详情返回 503 `P2_016_RETURN_TO_DISPATCH_UNAVAILABLE` | 夹具先装 049 再执行退回派单迁移；复跑全部通过 |
| human-workbench-process（缺少个人已读 schema 用例） | 076 检查在角色内先抛错，父进程未汇总 | 三个角色的 schema 失败按 APP、Worker、Gateway 顺序去重汇总 |
| wbint-t17-manual-risks（默认关闭、无 033/042 用例） | 夹具装上了 042 | 前置夹具恢复为部分 schema，另加全量 schema 覆盖 |
| t20-feedback-defaults、yxx-ss-010-runtime（42C 新增用例） | 占位迁移号不符合 ID 约束；健康检查请求的 Host 未带端口 | 修正占位 ID；改用带端口的 scopedBrowser |
| pc-admin-card32d-toast（分支上 7 次中 3 次失败） | 两次对话框截图之间详情在后台刷新 | 截图前先等详情空闲、三条提示可见；仅在截图窗口内发生刷新时重试（最多 3 次）；阈值不变。修复后 7/7 通过 |

`workbench-detail-media` 在全量并发运行中失败一次，单独复跑 3/3 通过，main 上也通过，判定为负载抖动。

## main 上同样失败（已存在，未在本卡修复）

下表文件在分支和干净 main 上都失败，且分支上失败的用例都在 main 的失败用例里，没有新增失败用例。多数是 macOS 本机环境或时序问题。T34 并发 CAS（503≠409）与 SS-010 在默认 macOS `TMPDIR` 下的 `SS010_STATE_SYMLINK` 也已单独在 main 上复现。

| 文件 | 分支 | main |
| --- | --- | --- |
| `human-workbench-process.browser.test.mts` | FAIL pass=2 fail=2 | FAIL pass=2 fail=2 |
| `p2-016-schema-contract.test.mjs` | FAIL pass=4 fail=2 | FAIL pass=4 fail=2 |
| `pc-admin-card13.browser.test.mts` | FAIL pass=6 fail=1 | FAIL pass=6 fail=1 |
| `pc-admin-card16-arrivals.browser.test.mts` | FAIL pass=2 fail=3 | FAIL pass=2 fail=3 |
| `pc-admin-card32b.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `t04-self-handling.browser.test.mjs` | FAIL pass=2 fail=4 | FAIL pass=2 fail=4 |
| `t05-conversation-handling.browser.test.mjs` | FAIL pass=13 fail=4 | FAIL pass=13 fail=4 |
| `t06-assignment-memory-recovery.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `t06-assignment-recovery.browser.test.mts` | FAIL pass=4 fail=3 | FAIL pass=4 fail=3 |
| `t07-legacy-recovery.browser.test.mts` | FAIL pass=2 fail=1 | FAIL pass=2 fail=1 |
| `t10-cancel.browser.test.mts` | FAIL pass=7 fail=1 | FAIL pass=7 fail=1 |
| `t10-privacy-boundaries.browser.test.mts` | FAIL pass=1 fail=1 | FAIL pass=1 fail=1 |
| `t11-completion.browser.test.mts` | FAIL pass=7 fail=2 | FAIL pass=7 fail=2 |
| `t20-staff-post200-context503.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `t20-staff-unknown.browser.test.mts` | FAIL pass=1 fail=1 | FAIL pass=1 fail=1 |
| `t25-manual-bot-feedback-boundary.integration.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `t36-team-and-recovery.browser.test.mts` | FAIL pass=0 fail=3 | FAIL pass=0 fail=3 |
| `t41-search-acceptance.integration.test.mts` | FAIL pass=3 fail=1 | FAIL pass=1 fail=3 |
| `t41-search-final-scope.integration.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `t41-search-pending-hint.browser.test.mts` | FAIL pass=0 fail=2 | FAIL pass=0 fail=2 |
| `t41-search-refresh-and-long-pages.browser.test.mts` | FAIL pass=0 fail=2 | FAIL pass=0 fail=2 |
| `wbint-t15-review-start-atomic-boundaries.integration.test.mts` | FAIL pass=5 fail=1 | FAIL pass=5 fail=1 |
| `wbint-t17-manual-report.integration.test.mts` | FAIL pass=2 fail=1 | FAIL pass=2 fail=1 |
| `wbint-t17-manual-risks.integration.test.mts` | FAIL pass=16 fail=1 | FAIL pass=16 fail=1 |
| `wbint-t22-conversations.browser.test.mts` | FAIL pass=6 fail=1 | FAIL pass=6 fail=1 |
| `wbint-t34-explicit-follow.integration.test.mts` | FAIL pass=1 fail=1 | FAIL pass=1 fail=1 |
| `wbint-t34-follow-production.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `wbint-t34-follow-recovery.browser.test.mts` | FAIL pass=4 fail=1 | FAIL pass=4 fail=1 |
| `wbint-t34-follow-risks.integration.test.mts` | FAIL pass=10 fail=1 | FAIL pass=10 fail=1 |
| `wbint-t39-related-review-activity.integration.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `wbint-t42-board-authority-navigation.browser.test.mts` | FAIL pass=2 fail=1 | FAIL pass=2 fail=1 |
| `wbint-t43-four-source-first.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `wbint-t43-four-source-service-loop.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `wbint-t43-incident-delivery.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `workbench-activity-actors.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `workbench-desktop-session-auth.browser.test.mts` | FAIL pass=5 fail=1 | FAIL pass=5 fail=1 |
| `workbench-startup.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `workbench-toast-feedback.browser.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `yxx-current-migrations.integration.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `yxx-h5-flow.integration.test.mts` | FAIL pass=0 fail=1 | FAIL pass=0 fail=1 |
| `yxx-h5-media.test.mts` | FAIL pass=13 fail=1 | FAIL pass=13 fail=1 |
