# Card 35C 逐文件验证

最终构建输入为 `7c82d44b7b09021079e71dfec7c547e748fe62c8e989b3880c7356451118bbe3`；制品身份（原件已移出仓库；本地归档 T01）。最终 CI 与最终相关回归共同覆盖当前所有选择，后者去掉已在最终 CI 的重复入口。额外定向和重复矩阵另列，不用重复次数增加唯一文件计数。

所有浏览器/数据库文件均沿现有 runSelection 与路由执行：保留宿主、编译制品、V8 来源、case trace 和自有资源检查。失败后的文件继续单独执行。原件保留 FAIL/NOT_RUN，未把补跑通过写回旧记录。首轮通过 TAP 位于 first-pass-taps.tar.gz（原件已移出仓库；本地归档 T02）；更完整的早期报告见归档（原件已移出仓库；本地归档 T03）/索引（原件已移出仓库；本地归档 T04）。最终通过报告、case trace、原 TAP 见最终原件索引（原件已移出仓库；本地归档 T05）；失败 TAP 另展开。

## 汇总

CI 路由选测（79 个测试入口及 8 项工具/调度）有 **2 FAIL**：`wbint-t15-review-start-restoration-boundaries.browser.test.mts`、`web01-workbench.browser.test.mjs`。两者也在纯 `30eb2fc8` 的本地 macOS 运行中失败；对照评审反馈中 main 的 Linux CI 为绿，优先怀疑本地 macOS harness 差异，根因尚未确认。下表及历史 FAIL/NOT_RUN 保留原结果，不改写为 PASS。

| 范围 | 唯一文件数 | PASS | FAIL / 其他 |
| --- | ---: | ---: | ---: |
| CI 路由选测（含工具/调度） | 87 | 85 | 2 |
| 首轮（含工具） | 227 | 189 | 38 |
| 最终浏览器/单元/集成及 source-host | 222 | 190 | 32 |
| 最终工具与调度 | 8 | 8 | 0 |

最终 FAIL 保持为 FAIL；30eb 同文件失败并不表示本卡通过。基线错误逐项比对见错误文本对照（原件已移出仓库；本地归档 T06）。30 个最初对照中 28 个在纯 30eb 也失败，27 个错误文本相同；Card16 是同类位置断言但数值不完全相同。另补跑的 Web01 在纯 30eb 的第13用例复现同一阶段列断言，H5 flow 在纯30eb通过。T28 storage初轮失败，基线与未改断言重跑均通过，保留为间歇结果；detail restructure按O25/O27更新加载标记与成功纯空区预期后通过。

## 每个文件

case 列依次为 pass / fail / skipped；“最终阶段”说明最近一次运行，首轮源码/执行摘要及具体哈希仍保留在原 JSON。工具进程没有聚合 counts 时以 TAP 为准。

| 文件 | 首轮 | 最终阶段 / 结果 | case | 30eb 复现 | 原件 |
| --- | --- | --- | --- | --- | --- |
| [tests/all43-follow-up-conflict.browser.test.mts](../../../../../tests/all43-follow-up-conflict.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/all43-incident-draft-transient.browser.test.mts](../../../../../tests/all43-incident-draft-transient.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/arch-006-rule-first-service-loop.test.mjs](../../../../../tests/arch-006-rule-first-service-loop.test.mjs) | FAIL | 最终相关回归 / FAIL | 6/2/0 | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T07） / [最终 TAP](taps/fail/arch-006-rule-first-service-loop.tap) |
| [tests/conversation-inbox.browser.test.mts](../../../../../tests/conversation-inbox.browser.test.mts) | PASS | 最终相关回归 / PASS | 12/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/migration-canary.test.mts](../../../../../tests/migration-canary.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T08） |
| [tests/mvp-application-members.integration.test.mts](../../../../../tests/mvp-application-members.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T09） |
| [tests/mvp-group-replies.integration.test.mts](../../../../../tests/mvp-group-replies.integration.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T10） |
| [tests/mvp-notification-policy.integration.test.mts](../../../../../tests/mvp-notification-policy.integration.test.mts) | PASS | 最终 CI / PASS | 8/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T11） |
| [tests/p2-003-realtime-event-log.integration.test.mjs](../../../../../tests/p2-003-realtime-event-log.integration.test.mjs) | PASS | 最终 CI / PASS | 11/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T12） |
| [tests/p2-007-staff-directory-process-options.test.mjs](../../../../../tests/p2-007-staff-directory-process-options.test.mjs) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T13） |
| [tests/p2-007-staff-directory-process-role.test.mjs](../../../../../tests/p2-007-staff-directory-process-role.test.mjs) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T14） |
| [tests/p2-007-staff-directory-sync.test.mjs](../../../../../tests/p2-007-staff-directory-sync.test.mjs) | PASS | 最终 CI / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T15） |
| [tests/p2-007-staff-directory-worker.test.mjs](../../../../../tests/p2-007-staff-directory-worker.test.mjs) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T16） |
| [tests/p2-007-third-party-current-profile-query.test.mjs](../../../../../tests/p2-007-third-party-current-profile-query.test.mjs) | PASS | 最终 CI / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T17） |
| [tests/p2-007-third-party-reporter-directory.test.mjs](../../../../../tests/p2-007-third-party-reporter-directory.test.mjs) | PASS | 最终 CI / PASS | 17/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T18） |
| [tests/p2-007-third-party-staff-directory.integration.test.mjs](../../../../../tests/p2-007-third-party-staff-directory.integration.test.mjs) | PASS | 最终 CI / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T19） |
| [tests/p2-007-third-party-staff-directory.test.mjs](../../../../../tests/p2-007-third-party-staff-directory.test.mjs) | PASS | 最终 CI / PASS | 30/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T20） |
| [tests/p2-015-contact-journey.test.mjs](../../../../../tests/p2-015-contact-journey.test.mjs) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T21） |
| [tests/p2-015-manual-review.test.mjs](../../../../../tests/p2-015-manual-review.test.mjs) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T22） |
| [tests/p2-015-rule-first-orchestration.integration.test.mjs](../../../../../tests/p2-015-rule-first-orchestration.integration.test.mjs) | PASS | 最终 CI / PASS | 5/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T23） |
| [tests/p2-015-rule-first-orchestration.test.mjs](../../../../../tests/p2-015-rule-first-orchestration.test.mjs) | PASS | 最终 CI / PASS | 7/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T24） |
| [tests/p2-015-worker-restart.integration.test.mjs](../../../../../tests/p2-015-worker-restart.integration.test.mjs) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T25） |
| [tests/p2-015-worker.test.mjs](../../../../../tests/p2-015-worker.test.mjs) | PASS | 最终 CI / PASS | 7/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T26） |
| [tests/p2-016-live-cluster.integration.test.mjs](../../../../../tests/p2-016-live-cluster.integration.test.mjs) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T27） |
| [tests/p2-016-schema-contract.test.mjs](../../../../../tests/p2-016-schema-contract.test.mjs) | PASS | 最终 CI / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T28） |
| [tests/p2-016-ticket-lifecycle.integration.test.mjs](../../../../../tests/p2-016-ticket-lifecycle.integration.test.mjs) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T29） |
| [tests/p2-016-workbench-auth.integration.test.mjs](../../../../../tests/p2-016-workbench-auth.integration.test.mjs) | PASS | 最终 CI / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T30） |
| [tests/p2-016-workbench-http.integration.test.mjs](../../../../../tests/p2-016-workbench-http.integration.test.mjs) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T31） |
| [tests/p2-016-workbench-wecom-auth.test.mjs](../../../../../tests/p2-016-workbench-wecom-auth.test.mjs) | PASS | 最终 CI / PASS | 5/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T32） |
| [tests/p2-g2-yixiaoxiu-delegated-identity.integration.test.mjs](../../../../../tests/p2-g2-yixiaoxiu-delegated-identity.integration.test.mjs) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T33） |
| [tests/pc-admin-card12-review.browser.test.mts](../../../../../tests/pc-admin-card12-review.browser.test.mts) | PASS | 最终 CI / PASS | 7/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T34） |
| [tests/pc-admin-card12.browser.test.mts](../../../../../tests/pc-admin-card12.browser.test.mts) | PASS | 最终相关回归 / PASS | 18/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/pc-admin-card13.browser.test.mts](../../../../../tests/pc-admin-card13.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 6/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T35） / [最终 TAP](taps/fail/pc-admin-card13.browser.tap) / [30eb TAP](taps/base-30eb/pc-admin-card13.browser.tap) |
| [tests/pc-admin-card16-arrivals.browser.test.mts](../../../../../tests/pc-admin-card16-arrivals.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 4/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T36） / [最终 TAP](taps/fail/pc-admin-card16-arrivals.browser.tap) / [30eb TAP](taps/base-30eb/pc-admin-card16-arrivals.browser.tap) |
| [tests/pc-admin-card16.browser.test.mts](../../../../../tests/pc-admin-card16.browser.test.mts) | PASS | 最终 CI / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T37） |
| [tests/pc-admin-card29.browser.test.mts](../../../../../tests/pc-admin-card29.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T38） / [最终 TAP](taps/fail/pc-admin-card29.browser.tap) / [30eb TAP](taps/base-30eb/pc-admin-card29.browser.tap) |
| [tests/pc-admin-card31.browser.test.mts](../../../../../tests/pc-admin-card31.browser.test.mts) | PASS | 最终相关回归 / FAIL | 0/1/0 | PASS | 首轮 原件索引（原件已移出仓库；本地归档 T04） / [最终 TAP](taps/fail/pc-admin-card31.browser.tap) / 30eb TAP（原件已移出仓库；本地归档 T39） |
| [tests/pc-admin-card34a-toast-modal.browser.test.mts](../../../../../tests/pc-admin-card34a-toast-modal.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/pc-admin-card34b-detail.browser.test.mts](../../../../../tests/pc-admin-card34b-detail.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/pc-admin-card34c-copy.browser.test.mts](../../../../../tests/pc-admin-card34c-copy.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/pc-admin-card35a-states.browser.test.mts](../../../../../tests/pc-admin-card35a-states.browser.test.mts) | PASS | 最终相关回归 / PASS | 10/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/pc-admin-card35c-states.browser.test.mts](../../../../../tests/pc-admin-card35c-states.browser.test.mts) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / [最终 TAP](taps/35c/ci.tap) |
| [tests/pc-admin-copy-terms.test.mts](../../../../../tests/pc-admin-copy-terms.test.mts) | PASS | 最终 CI / PASS | 8/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T40） |
| [tests/pc-admin-design-foundation.test.mts](../../../../../tests/pc-admin-design-foundation.test.mts) | PASS | 最终 CI / PASS | 75/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T41） |
| [tests/pc-admin-legacy-retirement.browser.test.mts](../../../../../tests/pc-admin-legacy-retirement.browser.test.mts) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T42） |
| [tests/platform-boundary-contracts.test.mts](../../../../../tests/platform-boundary-contracts.test.mts) | PASS | 最终 CI / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T43） |
| [tests/platform-postgres-callback.integration.test.mts](../../../../../tests/platform-postgres-callback.integration.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T44） |
| [tests/platform-postgres-time.integration.test.mjs](../../../../../tests/platform-postgres-time.integration.test.mjs) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T45） |
| [tests/platform-time-contract.test.mjs](../../../../../tests/platform-time-contract.test.mjs) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T46） |
| [tests/t04-self-handling.browser.test.mjs](../../../../../tests/t04-self-handling.browser.test.mjs) | FAIL | 最终相关回归 / FAIL | 4/2/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T47） / [最终 TAP](taps/fail/t04-self-handling.browser.tap) / [30eb TAP](taps/base-30eb/t04-self-handling.browser.tap) |
| [tests/t05-conversation-handling.browser.test.mjs](../../../../../tests/t05-conversation-handling.browser.test.mjs) | FAIL | 最终相关回归 / FAIL | 15/2/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T48） / [最终 TAP](taps/fail/t05-conversation-handling.browser.tap) / [30eb TAP](taps/base-30eb/t05-conversation-handling.browser.tap) |
| [tests/t06-assignment-memory-recovery.browser.test.mts](../../../../../tests/t06-assignment-memory-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T49） / [最终 TAP](taps/fail/t06-assignment-memory-recovery.browser.tap) / [30eb TAP](taps/base-30eb/t06-assignment-memory-recovery.browser.tap) |
| [tests/t06-assignment-recovery.browser.test.mts](../../../../../tests/t06-assignment-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 4/3/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T50） / [最终 TAP](taps/fail/t06-assignment-recovery.browser.tap) / [30eb TAP](taps/base-30eb/t06-assignment-recovery.browser.tap) |
| [tests/t06-assignment-restoration-boundaries.browser.test.mts](../../../../../tests/t06-assignment-restoration-boundaries.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t06-assignment-target-restoration.browser.test.mts](../../../../../tests/t06-assignment-target-restoration.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t06-assignment.browser.test.mts](../../../../../tests/t06-assignment.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t06-selected-communication.browser.test.mts](../../../../../tests/t06-selected-communication.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t07-atomic-start.browser.test.mts](../../../../../tests/t07-atomic-start.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t07-draft-recovery.browser.test.mts](../../../../../tests/t07-draft-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 1/3/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T51） / [最终 TAP](taps/fail/t07-draft-recovery.browser.tap) / [30eb TAP](taps/base-30eb/t07-draft-recovery.browser.tap) |
| [tests/t07-late-recovery.browser.test.mts](../../../../../tests/t07-late-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t07-legacy-recovery.browser.test.mts](../../../../../tests/t07-legacy-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 2/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T52） / [最终 TAP](taps/fail/t07-legacy-recovery.browser.tap) / [30eb TAP](taps/base-30eb/t07-legacy-recovery.browser.tap) |
| [tests/t07-restoration-boundaries.browser.test.mts](../../../../../tests/t07-restoration-boundaries.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t10-atomic-rollback.integration.test.mts](../../../../../tests/t10-atomic-rollback.integration.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T53） |
| [tests/t10-cancel.browser.test.mts](../../../../../tests/t10-cancel.browser.test.mts) | PASS | 最终相关回归 / PASS | 8/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t10-capability-recovery.browser.test.mts](../../../../../tests/t10-capability-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t10-current-authority-wait.integration.test.mts](../../../../../tests/t10-current-authority-wait.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T54） |
| [tests/t10-late-session.browser.test.mts](../../../../../tests/t10-late-session.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t10-privacy-boundaries.browser.test.mts](../../../../../tests/t10-privacy-boundaries.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 1/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T55） / [最终 TAP](taps/fail/t10-privacy-boundaries.browser.tap) / [30eb TAP](taps/base-30eb/t10-privacy-boundaries.browser.tap) |
| [tests/t10-purpose-expiry.browser.test.mts](../../../../../tests/t10-purpose-expiry.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t10-unknown-recovery.browser.test.mts](../../../../../tests/t10-unknown-recovery.browser.test.mts) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T56） |
| [tests/t10-vendor-resume.browser.test.mts](../../../../../tests/t10-vendor-resume.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t10-waiting.browser.test.mts](../../../../../tests/t10-waiting.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t11-completion.browser.test.mts](../../../../../tests/t11-completion.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 7/2/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T57） / [最终 TAP](taps/fail/t11-completion.browser.tap) / [30eb TAP](taps/base-30eb/t11-completion.browser.tap) |
| [tests/t11-completion.integration.test.mts](../../../../../tests/t11-completion.integration.test.mts) | PASS | 最终 CI / PASS | 8/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T58） |
| [tests/t12-crosspage-selection.browser.test.mts](../../../../../tests/t12-crosspage-selection.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t12-draft-recovery.browser.test.mts](../../../../../tests/t12-draft-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 1/3/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T59） / [最终 TAP](taps/fail/t12-draft-recovery.browser.tap) / [30eb TAP](taps/base-30eb/t12-draft-recovery.browser.tap) |
| [tests/t12-late-and-confirmation.browser.test.mts](../../../../../tests/t12-late-and-confirmation.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t12-opaque-recovery.browser.test.mts](../../../../../tests/t12-opaque-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t12-production-form.browser.test.mts](../../../../../tests/t12-production-form.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t12-purpose-and-late-storage.browser.test.mts](../../../../../tests/t12-purpose-and-late-storage.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t12-raw-off-unknown.browser.test.mts](../../../../../tests/t12-raw-off-unknown.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T60） / [最终 TAP](taps/fail/t12-raw-off-unknown.browser.tap) / [30eb TAP](taps/base-30eb/t12-raw-off-unknown.browser.tap) |
| [tests/t12-targets-read-loss.browser.test.mts](../../../../../tests/t12-targets-read-loss.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 2/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T61） / [最终 TAP](taps/fail/t12-targets-read-loss.browser.tap) / [30eb TAP](taps/base-30eb/t12-targets-read-loss.browser.tap) |
| [tests/t20-member-origin-hint.browser.test.mts](../../../../../tests/t20-member-origin-hint.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t20-staff-first.browser.test.mts](../../../../../tests/t20-staff-first.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t20-staff-hint-first.browser.test.mts](../../../../../tests/t20-staff-hint-first.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t20-staff-post200-context503.browser.test.mts](../../../../../tests/t20-staff-post200-context503.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T62） / [最终 TAP](taps/fail/t20-staff-post200-context503.browser.tap) / [30eb TAP](taps/base-30eb/t20-staff-post200-context503.browser.tap) |
| [tests/t20-staff-raw-off-after-opaque-failed.browser.test.mts](../../../../../tests/t20-staff-raw-off-after-opaque-failed.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t20-staff-recovery-boundaries.browser.test.mts](../../../../../tests/t20-staff-recovery-boundaries.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t20-staff-recovery-first.browser.test.mts](../../../../../tests/t20-staff-recovery-first.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t20-staff-unknown.browser.test.mts](../../../../../tests/t20-staff-unknown.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 1/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T63） / [最终 TAP](taps/fail/t20-staff-unknown.browser.tap) / [30eb TAP](taps/base-30eb/t20-staff-unknown.browser.tap) |
| [tests/t24-formal-nonpending-delivery-states.browser.test.mts](../../../../../tests/t24-formal-nonpending-delivery-states.browser.test.mts) | 未包含 | 最终相关回归 / PASS | 1/0/0 | 未包含 | 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t24-formal-round-status-and-authority.browser.test.mts](../../../../../tests/t24-formal-round-status-and-authority.browser.test.mts) | 未包含 | 最终相关回归 / PASS | 1/0/0 | 未包含 | 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t24-round-notification-identity.integration.test.mts](../../../../../tests/t24-round-notification-identity.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T64） |
| [tests/t24-round-notifications.browser.test.mts](../../../../../tests/t24-round-notifications.browser.test.mts) | 未包含 | 最终相关回归 / PASS | 2/0/0 | 未包含 | 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t24-synthetic-sender-unknown.integration.test.mts](../../../../../tests/t24-synthetic-sender-unknown.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T65） |
| [tests/t25-app-delivery-http-recovery.integration.test.mts](../../../../../tests/t25-app-delivery-http-recovery.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T66） |
| [tests/t26-formal-dual-route-status.browser.test.mts](../../../../../tests/t26-formal-dual-route-status.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-actions.browser.test.mts](../../../../../tests/t28-followup-actions.browser.test.mts) | PASS | 最终相关回归 / PASS | 9/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-bigint.browser.test.mts](../../../../../tests/t28-followup-bigint.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-destination.browser.test.mts](../../../../../tests/t28-followup-destination.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-draft.browser.test.mts](../../../../../tests/t28-followup-draft.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-handler-late-receipt.browser.test.mts](../../../../../tests/t28-followup-handler-late-receipt.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-handler.browser.test.mts](../../../../../tests/t28-followup-handler.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-input.browser.test.mts](../../../../../tests/t28-followup-input.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T67） / [最终 TAP](taps/fail/t28-followup-input.browser.tap) / [30eb TAP](taps/base-30eb/t28-followup-input.browser.tap) |
| [tests/t28-followup-late-readers.browser.test.mts](../../../../../tests/t28-followup-late-readers.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-late-receipt.browser.test.mts](../../../../../tests/t28-followup-late-receipt.browser.test.mts) | PASS | 最终相关回归 / PASS | 11/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-notifications.browser.test.mts](../../../../../tests/t28-followup-notifications.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-realtime.browser.test.mts](../../../../../tests/t28-followup-realtime.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-receipt.browser.test.mts](../../../../../tests/t28-followup-receipt.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-recovery-off-authority.browser.test.mts](../../../../../tests/t28-followup-recovery-off-authority.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-storage-boundaries.browser.test.mts](../../../../../tests/t28-followup-storage-boundaries.browser.test.mts) | FAIL | 最终相关回归 / PASS | 5/0/0 | PASS | 首轮 TAP（原件已移出仓库；本地归档 T68） / 最终 原件索引（原件已移出仓库；本地归档 T05） / 30eb TAP（原件已移出仓库；本地归档 T69） |
| [tests/t28-followup-versions-and-authority.browser.test.mts](../../../../../tests/t28-followup-versions-and-authority.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t28-followup-windows.browser.test.mts](../../../../../tests/t28-followup-windows.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t35-account-switch.browser.test.mts](../../../../../tests/t35-account-switch.browser.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T70） |
| [tests/t35-current-authority-wait.integration.test.mts](../../../../../tests/t35-current-authority-wait.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T71） |
| [tests/t35-unknown-read.browser.test.mts](../../../../../tests/t35-unknown-read.browser.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T72） |
| [tests/t36-supplement-production.browser.test.mts](../../../../../tests/t36-supplement-production.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t37-follow-up-post-refusal.browser.test.mts](../../../../../tests/t37-follow-up-post-refusal.browser.test.mts) | PASS | 最终相关回归 / PASS | 5/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t37-follow-up-recovery-boundaries.browser.test.mts](../../../../../tests/t37-follow-up-recovery-boundaries.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t37-follow-up-recovery-competition.browser.test.mts](../../../../../tests/t37-follow-up-recovery-competition.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t37-follow-up-recovery-first.browser.test.mts](../../../../../tests/t37-follow-up-recovery-first.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/t37-shared-follow-up-drawer.browser.test.mts](../../../../../tests/t37-shared-follow-up-drawer.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T73） / [最终 TAP](taps/fail/t37-shared-follow-up-drawer.browser.tap) / [30eb TAP](taps/base-30eb/t37-shared-follow-up-drawer.browser.tap) |
| [tests/t37-shared-time-card-list.browser.test.mts](../../../../../tests/t37-shared-time-card-list.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T74） / [最终 TAP](taps/fail/t37-shared-time-card-list.browser.tap) / [30eb TAP](taps/base-30eb/t37-shared-time-card-list.browser.tap) |
| [tests/visual-regression.test.mts](../../../../../tests/visual-regression.test.mts) | PASS | 最终 CI / PASS | 14/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T75） |
| [tests/wbint-t14-review.browser.test.mts](../../../../../tests/wbint-t14-review.browser.test.mts) | PASS | 最终相关回归 / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t15-review-start-recovery.browser.test.mts](../../../../../tests/wbint-t15-review-start-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts](../../../../../tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts) | PASS | 最终 CI / FAIL | 5/1/0 | FAIL | 首轮 原件索引（原件已移出仓库；本地归档 T04） / [最终 TAP](taps/fail/wbint-t15-review-start-restoration-boundaries.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t15-review-start-restoration-boundaries.browser.tap) |
| [tests/wbint-t15-review-start-team-window.browser.test.mts](../../../../../tests/wbint-t15-review-start-team-window.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t15-review-start-wide.browser.test.mts](../../../../../tests/wbint-t15-review-start-wide.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t15-review-start.browser.test.mts](../../../../../tests/wbint-t15-review-start.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t16-attachments.browser.test.mts](../../../../../tests/wbint-t16-attachments.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 3/2/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T76） / [最终 TAP](taps/fail/wbint-t16-attachments.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t16-attachments.browser.tap) |
| [tests/wbint-t17-manual-authority.browser.test.mts](../../../../../tests/wbint-t17-manual-authority.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t17-manual-form.browser.test.mts](../../../../../tests/wbint-t17-manual-form.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t17-manual-receipts.integration.test.mts](../../../../../tests/wbint-t17-manual-receipts.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T77） |
| [tests/wbint-t17-manual-review.browser.test.mts](../../../../../tests/wbint-t17-manual-review.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t17-manual-unknown.browser.test.mts](../../../../../tests/wbint-t17-manual-unknown.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t18-normal-verified-form.browser.test.mts](../../../../../tests/wbint-t18-normal-verified-form.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t19-manual-self-handling-authority.integration.test.mts](../../../../../tests/wbint-t19-manual-self-handling-authority.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T78） |
| [tests/wbint-t19-manual-self-handling-contracts.test.mts](../../../../../tests/wbint-t19-manual-self-handling-contracts.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T79） |
| [tests/wbint-t19-manual-self-handling-denial.browser.test.mts](../../../../../tests/wbint-t19-manual-self-handling-denial.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t19-manual-self-handling-risks.integration.test.mts](../../../../../tests/wbint-t19-manual-self-handling-risks.integration.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T80） |
| [tests/wbint-t19-manual-self-handling-unknown.browser.test.mts](../../../../../tests/wbint-t19-manual-self-handling-unknown.browser.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T81） |
| [tests/wbint-t19-manual-self-handling.browser.test.mts](../../../../../tests/wbint-t19-manual-self-handling.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-authority-stage.browser.test.mts](../../../../../tests/wbint-t22-authority-stage.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-boundary.browser.test.mts](../../../../../tests/wbint-t22-boundary.browser.test.mts) | FAIL | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T82） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-conversations.browser.test.mts](../../../../../tests/wbint-t22-conversations.browser.test.mts) | FAIL | 最终相关回归 / PASS | 7/0/0 | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T83） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-draft-coexist.browser.test.mts](../../../../../tests/wbint-t22-draft-coexist.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-draft-races.browser.test.mts](../../../../../tests/wbint-t22-draft-races.browser.test.mts) | PASS | 最终相关回归 / PASS | 17/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-outcome.browser.test.mts](../../../../../tests/wbint-t22-outcome.browser.test.mts) | FAIL | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T84） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t22-realtime-tracer.browser.test.mts](../../../../../tests/wbint-t22-realtime-tracer.browser.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T85） |
| [tests/wbint-t27-bounded-pages.browser.test.mts](../../../../../tests/wbint-t27-bounded-pages.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T86） / [最终 TAP](taps/fail/wbint-t27-bounded-pages.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t27-bounded-pages.browser.tap) |
| [tests/wbint-t27-candidate-detail.browser.test.mjs](../../../../../tests/wbint-t27-candidate-detail.browser.test.mjs) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-candidate.browser.test.mjs](../../../../../tests/wbint-t27-candidate.browser.test.mjs) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-crosstab.browser.test.mts](../../../../../tests/wbint-t27-crosstab.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-current-authorization.browser.test.mts](../../../../../tests/wbint-t27-current-authorization.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-current-csrf.browser.test.mts](../../../../../tests/wbint-t27-current-csrf.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-direct-ack.browser.test.mts](../../../../../tests/wbint-t27-direct-ack.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-discard-unknown.browser.test.mts](../../../../../tests/wbint-t27-discard-unknown.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-draft.browser.test.mts](../../../../../tests/wbint-t27-draft.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-expired-operation.browser.test.mts](../../../../../tests/wbint-t27-expired-operation.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-explicit-replay.browser.test.mts](../../../../../tests/wbint-t27-explicit-replay.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-known-failure.browser.test.mts](../../../../../tests/wbint-t27-known-failure.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-late-command-authority.browser.test.mts](../../../../../tests/wbint-t27-late-command-authority.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-late-receipt-authority.browser.test.mts](../../../../../tests/wbint-t27-late-receipt-authority.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-none.browser.test.mts](../../../../../tests/wbint-t27-none.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-off.browser.test.mts](../../../../../tests/wbint-t27-off.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-primary-null.browser.test.mts](../../../../../tests/wbint-t27-primary-null.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-purpose-revocation.browser.test.mts](../../../../../tests/wbint-t27-purpose-revocation.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-realtime-candidate.browser.test.mts](../../../../../tests/wbint-t27-realtime-candidate.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-reject.browser.test.mts](../../../../../tests/wbint-t27-reject.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-restoration-authority.browser.test.mts](../../../../../tests/wbint-t27-restoration-authority.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t27-unknown.browser.test.mts](../../../../../tests/wbint-t27-unknown.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t29-owner-transfer.browser.test.mts](../../../../../tests/wbint-t29-owner-transfer.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t29-production-owner-transfer.browser.test.mts](../../../../../tests/wbint-t29-production-owner-transfer.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t29-purpose-loss.browser.test.mts](../../../../../tests/wbint-t29-purpose-loss.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t29-recovery.browser.test.mts](../../../../../tests/wbint-t29-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t30-internal-note.browser.test.mts](../../../../../tests/wbint-t30-internal-note.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t30-recovery.browser.test.mts](../../../../../tests/wbint-t30-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 11/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t30-review-recovery.browser.test.mts](../../../../../tests/wbint-t30-review-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t31-public-progress.browser.test.mts](../../../../../tests/wbint-t31-public-progress.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t31-purpose-loss.browser.test.mts](../../../../../tests/wbint-t31-purpose-loss.browser.test.mts) | PASS | 最终相关回归 / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t31-recovery-results.browser.test.mts](../../../../../tests/wbint-t31-recovery-results.browser.test.mts) | PASS | 最终相关回归 / PASS | 9/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t32-exception-authorization.browser.test.mts](../../../../../tests/wbint-t32-exception-authorization.browser.test.mts) | FAIL | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T87） / 最终 TAP（原件已移出仓库；本地归档 T88） |
| [tests/wbint-t32-exception-compatibility.integration.test.mts](../../../../../tests/wbint-t32-exception-compatibility.integration.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T89） |
| [tests/wbint-t32-exception-contract.test.mts](../../../../../tests/wbint-t32-exception-contract.test.mts) | PASS | 最终 CI / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T90） |
| [tests/wbint-t32-notification-exceptions.browser.test.mts](../../../../../tests/wbint-t32-notification-exceptions.browser.test.mts) | PASS | 最终相关回归 / PASS | 5/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t32-notification-exceptions.integration.test.mts](../../../../../tests/wbint-t32-notification-exceptions.integration.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T91） |
| [tests/wbint-t32-session-exceptions.integration.test.mts](../../../../../tests/wbint-t32-session-exceptions.integration.test.mts) | PASS | 最终 CI / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T92） |
| [tests/wbint-t33-incident-delivery-production.browser.test.mts](../../../../../tests/wbint-t33-incident-delivery-production.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t33-incident-delivery-reload-recovery.browser.test.mts](../../../../../tests/wbint-t33-incident-delivery-reload-recovery.browser.test.mts) | PASS | 最终相关回归 / PASS | 4/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t33-incident-delivery-response-loss.browser.test.mts](../../../../../tests/wbint-t33-incident-delivery-response-loss.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t33-incident-delivery-scoped-rebase.browser.test.mts](../../../../../tests/wbint-t33-incident-delivery-scoped-rebase.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t33-incident-delivery-state-not-purpose.browser.test.mts](../../../../../tests/wbint-t33-incident-delivery-state-not-purpose.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t34-follow-production.browser.test.mts](../../../../../tests/wbint-t34-follow-production.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T93） / [最终 TAP](taps/fail/wbint-t34-follow-production.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t34-follow-production.browser.tap) |
| [tests/wbint-t34-follow-recovery.browser.test.mts](../../../../../tests/wbint-t34-follow-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 4/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T94） / [最终 TAP](taps/fail/wbint-t34-follow-recovery.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t34-follow-recovery.browser.tap) |
| [tests/wbint-t40-reminder-first.browser.test.mts](../../../../../tests/wbint-t40-reminder-first.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T95） / [最终 TAP](taps/fail/wbint-t40-reminder-first.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t40-reminder-first.browser.tap) |
| [tests/wbint-t40-reminder-locate.browser.test.mts](../../../../../tests/wbint-t40-reminder-locate.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T96） / [最终 TAP](taps/fail/wbint-t40-reminder-locate.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t40-reminder-locate.browser.tap) |
| [tests/wbint-t40-reminder-preferences.browser.test.mts](../../../../../tests/wbint-t40-reminder-preferences.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/2/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T97） / [最终 TAP](taps/fail/wbint-t40-reminder-preferences.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t40-reminder-preferences.browser.tap) |
| [tests/wbint-t40-reminder-recovery.browser.test.mts](../../../../../tests/wbint-t40-reminder-recovery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/3/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T98） / [最终 TAP](taps/fail/wbint-t40-reminder-recovery.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t40-reminder-recovery.browser.tap) |
| [tests/wbint-t42-board-complete-reopen.browser.test.mts](../../../../../tests/wbint-t42-board-complete-reopen.browser.test.mts) | PASS | 最终相关回归 / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/wbint-t43-incident-delivery.browser.test.mts](../../../../../tests/wbint-t43-incident-delivery.browser.test.mts) | FAIL | 最终相关回归 / FAIL | 0/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T99） / [最终 TAP](taps/fail/wbint-t43-incident-delivery.browser.tap) / [30eb TAP](taps/base-30eb/wbint-t43-incident-delivery.browser.tap) |
| [tests/web01-workbench.browser.test.mjs](../../../../../tests/web01-workbench.browser.test.mjs) | FAIL | 最终 CI / FAIL | 13/1/0 | FAIL | 首轮 TAP（原件已移出仓库；本地归档 T100） / [最终 TAP](taps/fail/web01-workbench.browser.tap) / [30eb TAP](taps/base-30eb/web01-workbench.browser.tap) |
| [tests/web01-workbench.integration.test.mjs](../../../../../tests/web01-workbench.integration.test.mjs) | PASS | 最终 CI / PASS | 17/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T101） |
| [tests/web01-workbench.test.mts](../../../../../tests/web01-workbench.test.mts) | PASS | 最终 CI / PASS | 9/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T102） |
| [tests/workbench-detail-media.browser.test.mts](../../../../../tests/workbench-detail-media.browser.test.mts) | PASS | 最终 CI / PASS | 1/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T103） |
| [tests/workbench-detail-restructure.browser.test.mts](../../../../../tests/workbench-detail-restructure.browser.test.mts) | FAIL | 最终 CI / PASS | 2/0/0 | PASS | 首轮 TAP（原件已移出仓库；本地归档 T104） / 最终 TAP（原件已移出仓库；本地归档 T105） / 30eb TAP（原件已移出仓库；本地归档 T106） |
| [tests/yxx-h5-admin-contracts.test.mts](../../../../../tests/yxx-h5-admin-contracts.test.mts) | PASS | 最终 CI / PASS | 7/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T107） |
| [tests/yxx-h5-application-auth.test.mts](../../../../../tests/yxx-h5-application-auth.test.mts) | PASS | 最终 CI / PASS | 8/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T108） |
| [tests/yxx-h5-flow.integration.test.mts](../../../../../tests/yxx-h5-flow.integration.test.mts) | FAIL | 最终 CI / PASS | 1/0/0 | PASS | 首轮 TAP（原件已移出仓库；本地归档 T109） / 最终 TAP（原件已移出仓库；本地归档 T110） / 30eb TAP（原件已移出仓库；本地归档 T111） |
| [tests/yxx-h5-frontend.test.mts](../../../../../tests/yxx-h5-frontend.test.mts) | PASS | 最终 CI / PASS | 81/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T112） |
| [tests/yxx-h5-http.test.mts](../../../../../tests/yxx-h5-http.test.mts) | PASS | 最终 CI / PASS | 22/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T113） |
| [tests/yxx-h5-media.integration.test.mts](../../../../../tests/yxx-h5-media.integration.test.mts) | PASS | 最终 CI / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T114） |
| [tests/yxx-h5-media.test.mts](../../../../../tests/yxx-h5-media.test.mts) | FAIL | 最终 CI / PASS | 14/0/0 | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T115） / 最终 TAP（原件已移出仓库；本地归档 T116） |
| [tests/yxx-h5-migrate.integration.test.mts](../../../../../tests/yxx-h5-migrate.integration.test.mts) | PASS | 最终 CI / PASS | 11/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T117） |
| [tests/yxx-h5-page-runtime.test.mts](../../../../../tests/yxx-h5-page-runtime.test.mts) | PASS | 最终相关回归 / PASS | 61/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 原件索引（原件已移出仓库；本地归档 T05） |
| [tests/yxx-h5-runtime.test.mts](../../../../../tests/yxx-h5-runtime.test.mts) | PASS | 最终 CI / PASS | 19/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T118） |
| [tests/yxx-h5-static.test.mts](../../../../../tests/yxx-h5-static.test.mts) | PASS | 最终 CI / PASS | 14/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T119） |
| [tests/yxx-h5-v2-contract.test.mts](../../../../../tests/yxx-h5-v2-contract.test.mts) | PASS | 最终 CI / PASS | 8/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T120） |
| [tests/yxx-h5-v2.integration.test.mts](../../../../../tests/yxx-h5-v2.integration.test.mts) | PASS | 最终 CI / PASS | 3/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T121） |
| [tests/yxx-ss-007-native-http-errors.test.mjs](../../../../../tests/yxx-ss-007-native-http-errors.test.mjs) | PASS | 最终 CI / PASS | 15/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T122） |
| [tests/yxx-ss-009-http-recovery.integration.test.mjs](../../../../../tests/yxx-ss-009-http-recovery.integration.test.mjs) | PASS | 最终 CI / PASS | 2/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T123） |
| [tests/yxx-ss-010-runtime.integration.test.mjs](../../../../../tests/yxx-ss-010-runtime.integration.test.mjs) | PASS | 最终 CI / PASS | 6/0/0 | 未包含 | 首轮 原件索引（原件已移出仓库；本地归档 T04） / 最终 TAP（原件已移出仓库；本地归档 T124） |
| [tools/ts-migration/backend-layout.test.mts](../../../../../tools/ts-migration/backend-layout.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T125） / 最终 TAP（原件已移出仓库；本地归档 T126） |
| [tools/ts-migration/check-agent-docs.test.mts](../../../../../tools/ts-migration/check-agent-docs.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T127） / 最终 TAP（原件已移出仓库；本地归档 T128） |
| [tools/ts-migration/design-system.test.mts](../../../../../tools/ts-migration/design-system.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T129） / 最终 TAP（原件已移出仓库；本地归档 T130） |
| [tools/ts-migration/h5.test.mts](../../../../../tools/ts-migration/h5.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T131） / 最终 TAP（原件已移出仓库；本地归档 T132） |
| [tools/ts-migration/hosts.test.mts](../../../../../tools/ts-migration/hosts.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T133） / 最终 TAP（原件已移出仓库；本地归档 T134） |
| [tools/ts-migration/pr-plan.test.mts](../../../../../tools/ts-migration/pr-plan.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T135） / 最终 TAP（原件已移出仓库；本地归档 T136） |
| [tools/ts-migration/t02-expiry.test.mts](../../../../../tools/ts-migration/t02-expiry.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T137） / 最终 TAP（原件已移出仓库；本地归档 T138） |
| [tools/ts-migration/tooling.test.mts](../../../../../tools/ts-migration/tooling.test.mts) | PASS | 最终 CI / PASS | —/—/— | 未包含 | 首轮 TAP（原件已移出仓库；本地归档 T139） / 最终 TAP（原件已移出仓库；本地归档 T140） |

## 新浏览器测试的重复矩阵

机器矩阵（原件已移出仓库；本地归档 T141）记录两项新区域测试及扩展附件诊断测试。普通 CPU 3 次、CDP 4 倍 3 次，CDP 在每个被测导航之前生效。1440 主轮截图见 [states](README.md#1440-截图)。

| 轮次 | CPU | 文件 | 结果 | case | 原件 |
| --- | ---: | --- | --- | --- | --- |
| normal-1 | 1 | pc-admin-card35c-states.browser.test.mts | PASS | 2/0/0 | [TAP](taps/35c/normal-1.tap) |
| normal-1 | 1 | workbench-detail-media.browser.test.mts | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T142） |
| normal-2 | 1 | pc-admin-card35c-states.browser.test.mts | PASS | 2/0/0 | [TAP](taps/35c/normal-2.tap) |
| normal-2 | 1 | workbench-detail-media.browser.test.mts | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T143） |
| normal-3 | 1 | pc-admin-card35c-states.browser.test.mts | PASS | 2/0/0 | [TAP](taps/35c/normal-3.tap) |
| normal-3 | 1 | workbench-detail-media.browser.test.mts | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T144） |
| cpu4-1 | 4 | pc-admin-card35c-states.browser.test.mts | PASS | 2/0/0 | [TAP](taps/35c/cpu4-1.tap) |
| cpu4-1 | 4 | workbench-detail-media.browser.test.mts | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T145） |
| cpu4-2 | 4 | pc-admin-card35c-states.browser.test.mts | PASS | 2/0/0 | [TAP](taps/35c/cpu4-2.tap) |
| cpu4-2 | 4 | workbench-detail-media.browser.test.mts | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T146） |
| cpu4-3 | 4 | pc-admin-card35c-states.browser.test.mts | PASS | 2/0/0 | [TAP](taps/35c/cpu4-3.tap) |
| cpu4-3 | 4 | workbench-detail-media.browser.test.mts | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T147） |

早期被构建输入变化守卫拒绝的六次调用没有可执行制品，仍记为 NOT_RUN：原记录（原件已移出仓库；本地归档 T148）。先前通过矩阵另保留为历史矩阵（原件已移出仓库；本地归档 T149），不代替最终构建。

## 指定易抖动入口

- conversation-inbox 的 topic history：以每个文件表的最终实跑为准；不跳过该用例。
- T28 personal snapshot / t28-followup-input：保留最终失败断言及30eb对照；storage boundaries 的初轮失败与通过重跑分别保留。
- pc-admin-card12-review 与 t37-shared-time-card-list：保留原断言，表内给出最终状态与30eb对照。

## 环境与限制

本机 darwin-chrome / Node24 / PostgreSQL18；环境沿用户指定 SOURCE_ROOT、loopback PG 和隔离标记。FFmpeg/FFprobe 使用受控真实可执行路径，临时根去除 `/var` 符号链接，不放宽存储守卫。PyYAML 固定为 workflow 的 6.0.2，位于本卡自有临时 venv。CPU4 是本机限速，不等同于 Linux CI。

现有全局数据库清理谓词要求 postgres/template/migration_ci 以外无库；此机器原有业务/其他测试库，因此不满足全局空机条件。按前后清单核对本卡自有资源，没有删除预存库；见清理记录（原件已移出仓库；本地归档 T150）。

arch-006 的 CURRENT_SCOPE_INVALID 是冻结 scope 中 .env.example 摘要与 HEAD 已有内容不一致，非35C改动，仍报告 FAIL；对照证据（原件已移出仓库；本地归档 T151）。未变更冻结规则、35A A01–A08 或旧权限/native-disabled断言以消除红灯。


## 新观察到的间歇失败复核

主 CI / 相关回归中的 FAIL 保持原结果，复跑通过不会覆盖主轮。T15 保留固定100ms与原始UUID断言；在线同事保留原板卡不重渲染断言，没有放宽或跳过。T15 在纯30eb的同一断言也失败一次；当前三次复跑通过。Card31 的当前/基线观察按下表记录。

| 入口 | 对象 | 次数 | 结果 | case | TAP |
| --- | --- | ---: | --- | --- | --- |
| wbint-t15-review-start-restoration-boundaries.browser.test.mts | T15 当前 | 1 | PASS | 6/0/0 | TAP（原件已移出仓库；本地归档 T152） |
| wbint-t15-review-start-restoration-boundaries.browser.test.mts | T15 当前 | 2 | PASS | 6/0/0 | TAP（原件已移出仓库；本地归档 T153） |
| wbint-t15-review-start-restoration-boundaries.browser.test.mts | T15 当前 | 3 | PASS | 6/0/0 | TAP（原件已移出仓库；本地归档 T154） |
| wbint-t15-review-start-restoration-boundaries.browser.test.mts | T15 纯30eb | 1 | FAIL | 5/1/0 | [TAP](taps/base-30eb/wbint-t15-review-start-restoration-boundaries.browser.tap) |
| wbint-t15-review-start-restoration-boundaries.browser.test.mts | T15 纯30eb | 2 | PASS | 6/0/0 | TAP（原件已移出仓库；本地归档 T155） |
| wbint-t15-review-start-restoration-boundaries.browser.test.mts | T15 纯30eb | 3 | PASS | 6/0/0 | TAP（原件已移出仓库；本地归档 T156） |
| pc-admin-card31.browser.test.mts | Card31 当前 | 1 | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T157） |
| pc-admin-card31.browser.test.mts | Card31 纯30eb | 1 | PASS | 1/0/0 | TAP（原件已移出仓库；本地归档 T39） |

基线使用重新建立的干净30eb隔离检出，构建输入再次匹配初次基线的 `3dba6720d8b540b3faceb0bd67bb63e03145149f6a54fca14571ca01ee3788fa`；身份（原件已移出仓库；本地归档 T158）、清理（原件已移出仓库；本地归档 T159）。当前分支没有切换。

## 移出仓库的原件

原件已移出仓库，结果和历史文字仍按原轮次保留。本地归档目录：`/private/tmp/claude-501/-Users-petervans-Projects-ticket/172774c8-e578-406d-b0a5-c4c9c8c86f82/scratchpad/35c-evidence-archive`；完整文件哈希见该目录的 `MANIFEST.txt`。以下路径相对原证据目录，均为纯文本定位，不是仓库链接。

| 引用 | 原件 | 本地归档 SHA-256 |
| --- | --- | --- |
| T01 | `artifact-identity-final.json` | `1b49757b28a65fa71c3b984c6aeae4731c65c771b3ccc77be15f8d51d87b0138` |
| T02 | `first-pass-taps.tar.gz` | `4143cd9f410a214e5ca7207b2450c341554b22b7b189a58e21fd9d38cd4d8fa8` |
| T03 | `earlier-test-reports.tar.gz` | `0eeaf43b6b8330077a188043e4382b0bad2f0fa0d3c86f43d4148552622ceb2a` |
| T04 | `earlier-test-reports-index.json` | `d95f4ca9ef793398f2152e041dd47104407ce3cce7f6c00ea47b884f40d10ed6` |
| T05 | `final-test-reports-index.json` | `f2b3ac10544c2708558cbc815ed0e5b52c86b849323caa0340fe0e9fb5bdc204` |
| T06 | `baseline-error-comparison.json` | `b205967041a528ffc661000076493db99a4bb9961ca8ca93167fa4111e6f6bda` |
| T07 | `checks/t081.tap` | `42b5c1589c1d6604686978cad22d56dbdc1f7cfe47161f0934053265c52f33d6` |
| T08 | `ci-7c82d44b/c001.tap` | `66cbe249a2a927be4e41e3721bc82ab94f96f1ccb86a5e4ac899accc124dca25` |
| T09 | `ci-7c82d44b/c002.tap` | `5cf7d9044a7571207e8a7f01ba48cab5d71769de7bbf33f8605a4d00667ef057` |
| T10 | `ci-7c82d44b/c003.tap` | `d90402c9e75e5e96fc8308b626685d593d15f7640c712f70398c40d3c406fcc8` |
| T11 | `ci-7c82d44b/c004.tap` | `f8831fd9a823cb3cc78905d77e9493c9dae89600382418fd6c9eca82dacb36cb` |
| T12 | `ci-7c82d44b/c005.tap` | `0fe1fee404e3e8f6c86115ed00fac6bf0602a598d2a22e0b03749a154b199a83` |
| T13 | `ci-7c82d44b/c006.tap` | `9091af128a63b7a6167429a2da19694c0796d8ed146f83a241e170cc2c8a78b7` |
| T14 | `ci-7c82d44b/c007.tap` | `200532c21401b3ebc5e43fd4e44b39860a85879e3451d35f70b542977e883598` |
| T15 | `ci-7c82d44b/c008.tap` | `4ebb153fdfa2480732ad34fe6ac3df4119dff193a87d64eebad42313ea809975` |
| T16 | `ci-7c82d44b/c009.tap` | `2f28172a7cea7eccde25d2b653b3c29b2f27ca360f9af594510d35ff45f465b1` |
| T17 | `ci-7c82d44b/c010.tap` | `52bfa6ff8a7bf0085f03bab55d6d274f8facc19fd79828c3073b950f3d70edbe` |
| T18 | `ci-7c82d44b/c011.tap` | `5c2ce88b24faba0cd18c66fee314c8b4c6f973ef962a4103d8c849db36918a51` |
| T19 | `ci-7c82d44b/c012.tap` | `7b542c0061fd18f221733da5746c3d0687cef2033fabe3fa82e905b1d77dc3ab` |
| T20 | `ci-7c82d44b/c013.tap` | `18a450349394a62a53afecf31400e1ffb246543d151e85d5c2425f2440d01426` |
| T21 | `ci-7c82d44b/c014.tap` | `e92059ec87a319c95fe04d2fbd5941d538145ba1f90521359f836b01146df491` |
| T22 | `ci-7c82d44b/c015.tap` | `05169ef054ec1bb12852f25c322543b95a33aa2cb127b519d378160bb2ae44a8` |
| T23 | `ci-7c82d44b/c016.tap` | `de9b77764d89296ee63b9ac027f03b9da3728b9a808e72526b03ee1833c5c10b` |
| T24 | `ci-7c82d44b/c017.tap` | `6dc7b9e2cb1ef9459eeea19a66bff208052a7d6836442261892fcfef5b0fd186` |
| T25 | `ci-7c82d44b/c018.tap` | `4ab5c75055abf56873e66929a9bef3b064d8726eeaaf98763c7c9f9d5d318588` |
| T26 | `ci-7c82d44b/c019.tap` | `09e514ce927f1ba0ea2365565fa01029d557a4151924e2b4d0e3527528a72b79` |
| T27 | `ci-7c82d44b/c020.tap` | `037c8c884aa0549073ab098aa85edf3a128dd02ba1b21c1a8f982af180c237a4` |
| T28 | `ci-7c82d44b/c021.tap` | `b56403d9175d596a3b2d373e2e03d9a7a678c04d65734764d4310d75e35a9c56` |
| T29 | `ci-7c82d44b/c022.tap` | `c555a663c5900fc9357b6a410a4bb19d000d336af3671e0e44547b702783a8eb` |
| T30 | `ci-7c82d44b/c023.tap` | `0d4a4a51b3db1b93572e05d88dcd1aabab8f830b3929df02a3d3ad2dfed5edc0` |
| T31 | `ci-7c82d44b/c024.tap` | `63b0bf87a72cd2d7f486a9a163a59db6591ed529e7f85d661d7143dffb988c40` |
| T32 | `ci-7c82d44b/c025.tap` | `2c3b33b621710e6316b893f0b58851b0681f13c47556bb7b5faa74aa9f7b093d` |
| T33 | `ci-7c82d44b/c026.tap` | `5c9ba44a44abb7d83d154d4226ee3af27e23eb5cec83b93234a1ab535e357f63` |
| T34 | `ci-7c82d44b/c027.tap` | `151499faad91ba2d2bb6c2b2f4f475ed0587a89c76ef84cb16509044cdc55506` |
| T35 | `checks/t084.tap` | `05da4f71b309269bf51fc9dac840aef907e6e63a316720301a3362193d43a7fa` |
| T36 | `checks/t085.tap` | `dca594103300eee3affae030f64e6a4769a3cc74a3b95c0200f77433fc2761d4` |
| T37 | `ci-7c82d44b/c028.tap` | `dc8a836789f060e3220c8dad3a838000164699580837578d938032325024c8c1` |
| T38 | `checks/t086.tap` | `60132ee8f012fd3b8bd7ae8acf270ba1536752ef0d83e0ff79b66a2badbafd1e` |
| T39 | `card31-recheck/baseline-1.tap` | `de6f06ca0a9282c39c2b0049b38fac78aabca55c03ff82ceea54c90b546d51b2` |
| T40 | `ci-7c82d44b/c030.tap` | `d44af1fd94dd0df51523adf537bfd74f741a053914c9f549e90c39a81583702e` |
| T41 | `ci-7c82d44b/c031.tap` | `4456e7989225f4077c38b3977005255be5ffe15c684acf2b834c3e97e14b54a5` |
| T42 | `ci-7c82d44b/c032.tap` | `0bb0f1cd9f7fbac395b1c9229d8537d339b286e4b46caebeb3b02225e948e940` |
| T43 | `ci-7c82d44b/c033.tap` | `d74847950fc4979289efcd32b6421e0fac9c8326fe405c473e063d8af0aa969f` |
| T44 | `ci-7c82d44b/c034.tap` | `b6272be1af214a5668bd5d0422f074133fe230f01530b55efa4680992e6ba817` |
| T45 | `ci-7c82d44b/c035.tap` | `15dc04316a96ad7c6e198611468d3deff4400d444c0e653280fe155f2e261cdf` |
| T46 | `ci-7c82d44b/c036.tap` | `56ab74543e3ca26ffa4bc63e40b5955564b68b1fabb5bb6e71c901ea52fd61cf` |
| T47 | `checks/t092.tap` | `5ef81da0631ab269c72a3d1207dc62d93af7e5c626affdcbde47508ea4682a10` |
| T48 | `checks/t093.tap` | `3d76d5305ad07828f4ceb5cc15079c7f86aad4efbc42fba05b1564623cce06d4` |
| T49 | `checks/t094.tap` | `35c2266091fc6d86a21089556368ca22f8d49aa03bc8aa305af2d2b66df2f18f` |
| T50 | `checks/t095.tap` | `3f43fa31d9db243a96fbd7b0bdbefe9815e3a9fc90dc84b64c04e87acb33015e` |
| T51 | `checks/t101.tap` | `c341752d6c889e15651f47dd9d2758e103320bfa4afb285684a7f4f580a4983e` |
| T52 | `checks/t103.tap` | `2c64bdee360ecab347edb2381c32241622a8055cd400e13fb9836b78cc32774c` |
| T53 | `ci-7c82d44b/c037.tap` | `b325fbcd5a80cf747a5ab5696285d556e8ebda5c8148756522d802cc185acbc6` |
| T54 | `ci-7c82d44b/c038.tap` | `227948ae35a87f5f0e412d47205cbf4879dc53f9ee99f45361a9355cce86b3e1` |
| T55 | `checks/t108.tap` | `a8054bc2dc6be2dad29edfdea19fb8c724a7ca4ba23d3d3d0effcc0341767955` |
| T56 | `ci-7c82d44b/c039.tap` | `9baf1d8d9ec2788664134ad9b3c21e31d0b5ad1e7e26125c0d2cd7f62328fc4b` |
| T57 | `checks/t112.tap` | `25ea6a5ea2be47b5bde70cf1f63b0b08b23aeff2499b1290634f4e998922a9d4` |
| T58 | `ci-7c82d44b/c040.tap` | `b18beefe493d2f40e83fcb42c3af8d1fca80b6b70578586109eaa9c03d206b4f` |
| T59 | `checks/t114.tap` | `c4e23b5d9502aa149f6da7a32a5876c2a0e84a31dc7474ec97c37bff101d1978` |
| T60 | `checks/t119.tap` | `bca496eca1d456cdb9fb47dbd68c319fc82f9447dc4dbf1d552531471a2ee2c8` |
| T61 | `checks/t120.tap` | `c530bcc648e75f3a0504e83d913441c4ca1378c87367616310caea8b244f1e7e` |
| T62 | `checks/t124.tap` | `e28518ed2688a4000ff45267ac1787dbbe521a07dbd18fb08bc798c9fece2f99` |
| T63 | `checks/t128.tap` | `511e3d9cfdb957e54f64e217803b68efedfc998e6af070f7057caddc706305d6` |
| T64 | `ci-7c82d44b/c041.tap` | `2313bd2c41aad2d64e85d230a715acae6f978c6102966670964f3971c0635270` |
| T65 | `ci-7c82d44b/c042.tap` | `d3dd70a730551cf06d03caf8184942f7142b93eff743d19f9f440e962ee4581b` |
| T66 | `ci-7c82d44b/c043.tap` | `a33cb0beaeebce849a30f617a1dc64b39407dbab017198fc895efdb3b83f4766` |
| T67 | `checks/t136.tap` | `2eb138cb41d35780380c6b7d19b44e0e269e7fe853e5cbca7ec44e78f6c7e689` |
| T68 | `checks/t143.tap` | `0b5cc49e13f622dd1c900a0d0a5aa4f4df10b9be023a0ac0a211b4180499417b` |
| T69 | `baseline-checks/b018.tap` | `dac2786397c05458e1e461983dc111fb87d121834a29b2eacab9f040fbc6e00f` |
| T70 | `ci-7c82d44b/c044.tap` | `15e91d8cedd50bec05cca481fcddcded6242a0968054f4a690cd4ca6321ec233` |
| T71 | `ci-7c82d44b/c045.tap` | `a9e9744adaa3ba9d6ce3e69368e777c66fb1c18d3d9243155e670b4f30884f2b` |
| T72 | `ci-7c82d44b/c046.tap` | `88d1ab7fae2a78bd321ace995f240ee71c7fa8b017ae69982e7909ff11320b6f` |
| T73 | `checks/t151.tap` | `67766bcc1bc3dbb88c6204190d092b6c1228f625bdeb1c2a5fca0550aacbb683` |
| T74 | `checks/t152.tap` | `5cf43de0b086baf2a047e0e775d9212bc4f922a1cbb5ade0982ca5a3d527fc7e` |
| T75 | `ci-7c82d44b/c047.tap` | `a549b7f3011400bfa6267600b2d6b6f83f434e03eba77b1a577bcf7834a94280` |
| T76 | `checks/t158.tap` | `5dd740534b41533987fb226f64c634dca79e4c75708ed6a45db2c8e95b7e35f6` |
| T77 | `ci-7c82d44b/c049.tap` | `2da77f8eb34fb3d2b5ad14fd98a73fd939f1b81a21843d95872bd3f3634aefe4` |
| T78 | `ci-7c82d44b/c050.tap` | `969cb776771be0857ee2b8e817eadffd07eb6a71db72723338b00f50daf920c6` |
| T79 | `ci-7c82d44b/c051.tap` | `22cc64612428d2afcf015fc315821c394ccf36eadee4c5e22714e41982a25690` |
| T80 | `ci-7c82d44b/c052.tap` | `bbc3b53558c50319f4d8e404b9fdeb71d7be9f17493f96bfb66726af4383d6d6` |
| T81 | `ci-7c82d44b/c053.tap` | `203f46f0b4d39be9464ccbf50d5afb986b7e063dd434595a1e07c329f76be1d8` |
| T82 | `checks/t167.tap` | `fdbe4d181cca2054e08c3f926d6d6da25020c5ab59ddba4ce47d9c4b5ece9d0d` |
| T83 | `checks/t168.tap` | `5f95e3c99aa67aff14806c6e853ec1e334bfb3fd76141ec50df68645ee019c48` |
| T84 | `checks/t171.tap` | `cbfc198bbdeb830f54e0471cc92b2745a5cec0dd16ce031269cdde5b86d80874` |
| T85 | `ci-7c82d44b/c054.tap` | `706e7c2d33aedf7a73db3c46961669df0d4dda925fb510ecd4afa42b2ebbde8d` |
| T86 | `checks/t172.tap` | `053c15249194c150aeaf6a86ce48f5c01a8bf9cd02e7b5d814ab4c85c882f8e7` |
| T87 | `checks/t055.tap` | `c82614f13f174f59b0b12371e9aa3cbb1c4a23e3c32fc307448acd4a34850efb` |
| T88 | `ci-7c82d44b/c055.tap` | `b4275872a73ccca0507088d89740d36c465fb3dcc241232f3862a451eac10fbd` |
| T89 | `ci-7c82d44b/c056.tap` | `5adc4db0486b68a1242710bea8bae56ebddd8b290220a59c9e2949ac2ace6dc4` |
| T90 | `ci-7c82d44b/c057.tap` | `f148bb815c5a7db0352015278be7e6209cbc66996d5105acf1dc74fabc713f8b` |
| T91 | `ci-7c82d44b/c058.tap` | `052cc4843ff473efc3c3847736ed7c7a269029be2efc67784754f49e9f48b49a` |
| T92 | `ci-7c82d44b/c059.tap` | `918ee85a90fc871767ffab445c391ccaa98e07ac4938551f9254e916ab0c2671` |
| T93 | `checks/t210.tap` | `7a0538a9efb15ebd44dcd5c31e36887956b2cb8e1788308efa2685d62097b369` |
| T94 | `checks/t211.tap` | `5710dd91d9ad56a01ca1c200996a3a11f12b9eaa250cfcd65fc3ea0676c87dff` |
| T95 | `checks/t212.tap` | `20506b68dcb2f23fcece2853e5d8eadc667fcaa032c1cdaa8d2fdae0f5622192` |
| T96 | `checks/t213.tap` | `676385beb99840b6f58e4c26e5c617ba01bb9ee57edf579e3348b7946a248bd0` |
| T97 | `checks/t214.tap` | `581086003eef3f3b30d75807108811e1df1b47a99974fe1d296dffeca51b713c` |
| T98 | `checks/t215.tap` | `15f1745edc81e79f7cef1365e1b6f7ce071c07ed4148f2a7208a226d6e9bea89` |
| T99 | `checks/t217.tap` | `0a30821df5404d36b63f06e12b3df994c983d679d685bdda2ca20a21a0fdc523` |
| T100 | `checks/t060.tap` | `f630601d4e6c38b5f60c3907a3c8709219d491844d870bd1c879a4b30da2aed9` |
| T101 | `ci-7c82d44b/c061.tap` | `23d75ab33ce72e4a617a0a9f95995950c2206d7e2778aadfd302c5645298d212` |
| T102 | `ci-7c82d44b/c062.tap` | `a8c29e4ca5b443c0d5dd912187bfe38e6cc5465f31c3223a354f0985cef7e3b4` |
| T103 | `ci-7c82d44b/c063.tap` | `18f30f217ded02d2de7550b8f97e2fdc5d41f8739275764c7a4c2b0f244e1831` |
| T104 | `checks/t218.tap` | `9dda4163a90dff2bf9621dece47ef78ce61c24256b36823beb5caf57107546dc` |
| T105 | `ci-7c82d44b/c064.tap` | `7f668836ddfa5612ef2ceec698fcea78f838e3c8dc4df75b50b6d889b4e3104d` |
| T106 | `baseline-checks/b030.tap` | `5ec7d93fb1f3c84113bc8856ad2242a5224058028a31d76516a732e4db7a0719` |
| T107 | `ci-7c82d44b/c065.tap` | `5d99d8d4ee255176fc63615fd97bfd29be8fa4c4b49ca70eec066d411c9d8d5d` |
| T108 | `ci-7c82d44b/c066.tap` | `522fc02b1a3d05ef417cdca2221fb69c5918a3aa13ff2e384a64d7850e66b7cd` |
| T109 | `checks/t066.tap` | `234b39a9ff67d56caa9b90806273dc8ec01e70b42de59898aa7adb9713fc2d9c` |
| T110 | `ci-7c82d44b/c067.tap` | `179f84b3a28407c340b0c910f2ff13cb534e9ec07c3fe46b8616fb3bd9bdf09a` |
| T111 | `base-extra/e002.tap` | `e1a5345095ac3614c28bc32accb7bd427bf271c637c03e785d64651665c97700` |
| T112 | `ci-7c82d44b/c068.tap` | `77996f64a5748d79dcd9d5a02d3c6dfe3e3d8cd7ade79d943455d9c4e8c3cded` |
| T113 | `ci-7c82d44b/c069.tap` | `fd0d3e039d02a97ddfe70c74c81d65f2c25b09fb0da7cc37460bd0f7a99e14f9` |
| T114 | `ci-7c82d44b/c070.tap` | `ab8df9a7a63eef1a5db00d6937bed6bdc02228c70a87cb617c85b65ba05845a2` |
| T115 | `checks/t070.tap` | `06b2729396d830450dbf2d7a8081911753533625fd3111f8da85056c28b5d21c` |
| T116 | `ci-7c82d44b/c071.tap` | `3e00b1e8cb91be8b22d11979070a2e97665c87b982373ca89b592fd155eadef2` |
| T117 | `ci-7c82d44b/c072.tap` | `b07de230566c2e2890fbc62ef8590bcad59a1fa702dba1f530fe202c4bf75a70` |
| T118 | `ci-7c82d44b/c073.tap` | `26e680787696bd32c970c0d1e7d795e0f32e3da16486b1e68e1e2f0b35f95fd1` |
| T119 | `ci-7c82d44b/c074.tap` | `020c15076fcf16a3f3b6af7cd1636823eeda0ac7bb104dbb2b66d87dd49e514a` |
| T120 | `ci-7c82d44b/c075.tap` | `03c3d69e50eedc2cdf58366fd55985201dd5b767cb36184bb8eaea309e060d77` |
| T121 | `ci-7c82d44b/c076.tap` | `06ddb6e4d3d7cc59f63764fc8e8d6af74d8ec80d7bcce856bb552d27d348bc19` |
| T122 | `ci-7c82d44b/c077.tap` | `849a2cfb3e797c3c7e4775ba5a601856f34f0a1f2f7ead172eedb7901ea3bd49` |
| T123 | `ci-7c82d44b/c078.tap` | `e21f103834db5a0297ca1a7acf992657438afee118c340fe371744333cadbdcd` |
| T124 | `ci-7c82d44b/c079.tap` | `3ab733ca16ffd03d365b9527c885cfe0d216c917eb53f0696695dd421bb49a7c` |
| T125 | `checks/tool-backend-layout.test.tap` | `9729dabdb6f3f849403603d330981f3ec083a9d55fddf736f06e4c44296cd2f9` |
| T126 | `ci-7c82d44b/tool-backend-layout.test.tap` | `1af8b3169f1348fe2a54824c5eec388e3da40c7fc572d2c8a09b25fffa07e8d8` |
| T127 | `checks/tool-check-agent-docs.test.tap` | `9aa602de642061a25ba267ab7a6c67b756e7c43795fe72d1db75547458d9752a` |
| T128 | `ci-7c82d44b/tool-check-agent-docs.test.tap` | `a8a20af85d5c321c0884f2e7c708b5a7b6bacd216ca0d823a6975b42b31bee8d` |
| T129 | `checks/tool-design-system.test.tap` | `74cebb4504fe4120fd7ec538e2060250f976aa5cd896496bb6d7b5e3be6548a3` |
| T130 | `ci-7c82d44b/tool-design-system.test.tap` | `92b78db9f2e406065728e58f78044e2c4fce197c4f97ce16e64ca432f772ff4f` |
| T131 | `checks/tool-h5.test.tap` | `16058bd9f0bdef2e707223dda6f7b18b2ebc3be29c77c4e3ca5718ddb9e676d6` |
| T132 | `ci-7c82d44b/tool-h5.test.tap` | `208f6daf1d082708e6dca9939686e2981c1924b2b26a873a36f866aa7328f16a` |
| T133 | `checks/tool-hosts.test.tap` | `716f7e70a6da6687eb95d07ed2d6255ed5f05fde4f32b4647aea58b9d2ff8eb0` |
| T134 | `ci-7c82d44b/tool-hosts.test.tap` | `aa33620887cd2d094a8d524cd86b943a601a196f3d9756cf4846e227b7ad80c9` |
| T135 | `checks/tool-pr-plan.test.tap` | `5bfad696564c1d5c9098c442569b20f5d8ed97f0085ccd6ecd170daa608fb8b2` |
| T136 | `ci-7c82d44b/tool-pr-plan.test.tap` | `8ef49294c40f01b33625d2bd189aaa9ee9ea90880680530a09dfc945cc875692` |
| T137 | `checks/ci-policy-scheduling.tap` | `2f4daa8009a52eb09abd53aa072105ef2324ecc17dcbe956cfdeb219c487273b` |
| T138 | `ci-7c82d44b/scheduling.tap` | `e08bda2bfcb0f781010789f186fae39f79ae2e92c6057937210e89f33e876f66` |
| T139 | `checks/tool-tooling.test.tap` | `c0a888f08b11d567f4b860f977b1bac4d53995795afed27446b6d27db4583b83` |
| T140 | `ci-7c82d44b/tool-tooling.test.tap` | `86662bac8accc3cadd90b0de96142a43aa2a41b5d62f38b9b4a19f5326728568` |
| T141 | `matrix-7c82d44b-results.json` | `c5287af2e1b50167022b5dbd2ebb95c51a27d57c91741e0e1069efd28a708300` |
| T142 | `matrix-7c82d44b/normal-1-2.tap` | `aa2c2555393cb2bae6f50ada5bc732cee0db098581f13fb0ac8af73bcdeb0430` |
| T143 | `matrix-7c82d44b/normal-2-2.tap` | `47fe8a376d3e175ba73bf99453f31c28953fb24bdd0291f073cdb994d2b9f0a4` |
| T144 | `matrix-7c82d44b/normal-3-2.tap` | `7a1d1f207adb205a9d952f230dbce0960ef664a5609ef970441ec5ee2dd7bd7a` |
| T145 | `matrix-7c82d44b/cpu4-1-2.tap` | `227b03dea00bcfd247e15832b1599f48b5edb94afc0c7f7c6087400f688c4226` |
| T146 | `matrix-7c82d44b/cpu4-2-2.tap` | `0885c403af97e31b48dd89a883b0bafff6b85d4c7016375a86808b28c75165c2` |
| T147 | `matrix-7c82d44b/cpu4-3-2.tap` | `c57cbccc92c9cebd98e66971be09fbb4125ebba0cdbf551eb6c7e9d39d2966ad` |
| T148 | `matrix-rejected-build-results.json` | `3fc9021608effa3ceb29dfae669feedd09127686004402a3acab64227fb245be` |
| T149 | `matrix-acceptance-results.json` | `11f02b17b92a42150e8371506e54aeb62a89ae0e1b997a7dc4b35c1068e7214e` |
| T150 | `resource-cleanup.json` | `73b7502d769676b9cec405cd7bd042ef35d7c0af38c4bb50cd69267d028d12c5` |
| T151 | `arch-006-scope-mismatches.json` | `04e1bfa9c738636543b5bbd4d93382b1caabf7f49ca1e6ba740ae68b3fca62bf` |
| T152 | `t15-recheck/current-1.tap` | `cae1b674bb1846225921de06a56d3cefddc29e440f4de4c369f18ee162bff541` |
| T153 | `t15-recheck/current-2.tap` | `978cd33f1f41493f67c62aac4b59726aed00c2f3bc17f3e802f92a6f802fc6bb` |
| T154 | `t15-recheck/current-3.tap` | `73a23ef024f11554743295f063d929517cf01d95eecdc0341576926e59f54753` |
| T155 | `t15-recheck/baseline-2.tap` | `4f458ab519952e4407f9d59c19c4174e99dc7cfe912b6d75e2f329e9e4c3d051` |
| T156 | `t15-recheck/baseline-3.tap` | `748615edb3604d4b369c24add7f3a40ae31a288322ba5b93564796b44488a5d5` |
| T157 | `card31-recheck/current-1.tap` | `42226723c1e308385f9fc97942b0757ec22fd32e69321289392da016320be01a` |
| T158 | `t15-baseline-proof.json` | `b3df3602fc156613f43ef85673c89eea5ad519cb343bd035b65a3a20e92d3d59` |
| T159 | `t15-baseline-cleanup.json` | `2d29db42c9da8ea823c9f192912f55bf01a1dde19e0b852c8d6cdef9625f1b0c` |
