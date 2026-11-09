# 卡27C 遗留测试债与两处真实缺陷

本地交付：2026-11-09（Asia/Shanghai）。分支 `codex/v224-card27c-test-debt`，基线 `main` `618bea02`。

起因：卡32C-D（#172）改动核心代码后，CI 按路径选中了一批在 `main` 上本来就失败的测试。CI 遇到第一个失败就停，所以只能逐个暴露。根源大多是卡27C 引入 071（统一关闭记录）后，夹具和断言没有跟进；另有少数断言落后于卡29（完成文字）、卡32B（「⋯」菜单）。本 PR 先在 `main` 上清掉这些问题，#172 之后再合并本 PR。

## 两处产品缺陷（随测试暴露）

| 位置 | 问题 | 修复 |
| --- | --- | --- |
| `app/pc-admin/src/features/personal-read/foreground-text.ts` | 卡27C 的关闭 / 恢复对话框（`.ds-closure-dialog`）不在阅读位置的「前景模态」名单里。对话框打开时，背后的材料仍被计为可见并推进已读 | 名单加入 `[role=dialog].ds-closure-dialog`；t35 「模态背后的可见材料保持未读」恢复通过 |
| `app/pc-admin/src/features/ticket-waiting/ClosureActions.tsx` | 卡32B B3 的焦点归还只在点按钮关闭时生效；按 Escape 关闭时，模态的焦点还原发生在背景仍为 inert 的时刻，焦点落到 `<body>` | 打开时记住归还目标；关闭后若焦点丢失，回到「⋯」触发器一次 |

## 测试夹具（缺 071）

- p1-004：改为每次运行自建独立数据库，迁移到当前 schema（含 071），结束后删除；不再在共享 `PILOT_DATABASE_URL` 上原地迁移。系统关闭的闲聊 Intake 断言 `intake.received` 与 `intake.closed` 两个事件和一条系统关闭记录。
- t08、t37、p2-g2-process-assembly、human-workbench-process、yxx-ss-006（生命周期用例）：在其它迁移之后应用 071。
- p2-g2 运行时夹具（`p2-g2-runtime-harness`）：两条 schema 路径都应用 071。同批 31 个使用它的测试中，direct-leg、inbound-label、single-text-gold 在原夹具上同样失败（single-text-gold 原为 34 个失败，现为 4 个），openapi-routing 本地缺 Python；这四个不在任一 PR 的 CI 选择范围内，未处理。
- yxx-ss-008 就绪用例：真实数据库中 033 / 034 永远先于 071，而 071 之后再跑旧迁移器会触发 P2-012 目录校验漂移（单独 071 即可复现，属卡27C 遗留）。改为一次建好含 033 / 034 / 071 的完整 schema，用改名登记行模拟 Web 迁移缺失（就绪只读登记表）；不改迁移器。

## 断言更新（不放宽）

- t08、t37、yxx-ss-006：关闭改用六个有效原因之一（原为自编原因码）。
- wbint-t14：「标记非 IT 范围」带上 `NOT_IT_SCOPE` 与次级原因；同一命令的「改变意图」重放改关闭说明，仍须得到 409。
- wbint-t41：关闭时刻随关闭记录一起移动；「来源不明」的关闭事项按 ADR-0056 断言等于其关闭记录的时间（投影对无记录的关闭事项返回 503，`null` 已不存在）。
- wbint-t21、t25：已完成工单的报修人状态为「已完成」（卡29）。
- t21-bot-feedback-pc-happy：固定中文浏览器（与同组夹具相同的 `t21ChineseBrowser`），并改用「已完成」「等待重新承接」。
- t24-formal-nonpending：通知行显示共用的北京短时间；新增断言核对每行 `<time datetime>` 的完整时刻与「发送于 / 产生于」前缀。
- t10-purpose-expiry：取消用途自卡27C 起走统一关闭，核对提交后显示关闭成功提示。
- t35：按卡32B B3，打开对话框后「⋯」菜单收起、触发器仍可见；关闭后焦点回到「⋯」。
- web01 集成：Journey 过期前等到 `reported_at` 之后的下一秒（`contact_journey_time_check` 为秒精度，约五分之一的运行会冲突）。

## 未处理（环境相关）

- yxx-h5-flow、yxx-h5-media（两个）：本机无 FFmpeg；CI 安装。
- yxx-ss-010、arch-006 的两个用例：本机 macOS `/var` 符号链接与非 `core.autocrlf=true` 检出影响路径 / 对象核验；CI 检出方式不同。
- human-workbench-process 的两个用例：子进程不继承 `TMPDIR`，macOS 下轨迹写到 `/tmp`；Linux CI 已通过。

## 验证

本机 macOS、Node 24、PostgreSQL 18；不是 Linux / Windows 验收。

- 按 `pr-plan --base origin/main` 选出 70 个测试文件，逐个单独运行：65 个通过。另外 4 个本机失败属上节「环境相关」（human-workbench-process 两个用例、yxx-h5-flow、两个 yxx-h5-media），它们在 Linux CI 已通过或由 CI 安装 FFmpeg。第 5 个 t35 在全量运行中因焦点归还时序失败一次，改为等待焦点后单独连跑 3 次均通过。
- 另跑 31 个使用 p2-g2 运行时夹具的测试：除上节列出的 4 个既有失败外全部通过；yxx-ss-008 通过。
- web01 集成：修复前约五分之一的运行失败；修复后 15 次连跑全部通过，整文件 17 / 0。
- PC `typecheck`、`lint:features` 通过；构建 0 个 TS 错误。

## 回退

还原本 PR 的提交即可；不含迁移、合同或配置变更。
