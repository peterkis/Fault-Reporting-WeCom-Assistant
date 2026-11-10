# 旧版 H5（V1 自助）夹具测试退役

Issue：[179](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/179)。前置：旧页面 `web/p2-reporter` 已按 [ADR-0043](../../adr/0043_h5_notification_entry_and_legacy_ui_retirement.md) 从生产移除。此后仍有测试借助 `tests/fixtures/retired-self-service/` 和 `tests/helpers/retired-self-service-ui.mts` 重放旧 V1 自助页面。本次以新 H5（`app/h5`）和它实际调用的 V1/V2 API 为唯一依据，退役这些重放测试。做法参照 [绿色旧版管理端退役](legacy-workbench-retirement.md)：先补替代覆盖再删除；混合测试只保留 API 断言并改走 HTTP。

## 已确认决定（2026-11-10）

- 旧页面独有的交互（DOM、截图、标签页、旧客户端加密日志、旧客户端轮询与配额）不迁移，也不复刻。
- 根页面 `/wecom/yixiaoxiu/`：生产中新 H5 外壳不鉴权、直接渲染，且不含成员数据，鉴权由外壳调用的 entry/bootstrap API 负责。旧夹具会先拒绝第一次渲染以触发 V1 鉴权门，这只是在模拟 V1 行为。因此根页面这一处改为断言当前行为：返回 200 外壳、不含成员数据、API 仍关闭。`/reports/new` 与 `/reports/{ref}` 的鉴权门和归属终检断言保持不变。
- 不改生产代码。成员端 `/wecom/yixiaoxiu/feedback-recovery.js`、`/wecom/yixiaoxiu/recovery/*` 和 bootstrap 字段 `feedback_draft_recovery_enabled` 现在只有旧客户端使用（新 H5 不加载），列为后续单独处理。
- 冻结的 readiness 合同（`plans/yxx-current-readiness-acceptance*.json`、`plans/yxx-ss-009-acceptance.json`）、迁移批次与回执、`evidence/`、CHANGELOG 以及交付文档里的历史记录都不改。#145 的处理同样如此。

## 退役与替代覆盖

| 退役项 | 原断言 | 当前覆盖 |
| --- | --- | --- |
| `t20-feedback-first.browser` | 页面显示合法反馈控件；POST 只发一次（路径、`STILL_UNRESOLVED`、版本号）；同一张 Ticket 变为 REOPENED，负责人清空，轮次 +1；存储里不留 UUID | `wbint-t20-feedback.integration`：只 POST 一次，同票 REOPENED，负责人清空，轮次 +1，回执 COMMITTED；`human-workbench-process.browser`：真实网页报修人反馈。新 H5 前端连线由下面新增的单测覆盖 |
| `t20-feedback-unknown.browser` | 响应丢失后为 UNKNOWN，只用 GET 按原 UUID 核对，不重复 POST | `t20-feedback-races.integration`：没有回执时为 UNKNOWN、同 UUID 并发只提交一次、重放稳定；**新增** `yxx-h5-frontend` 用例 “H5 Web reporter feedback posts once…”：CSRF、`idempotency-key`、`if-match`、请求体只 POST 一次；丢失响应判为 UNKNOWN；恢复只 GET `/feedback/commands/{原UUID}`；回执确认必须同 UUID、同单号、同完成轮次且为 COMMITTED |
| `t20-feedback-recovery-first.browser` | 旧客户端反馈草稿恢复，同浏览器刷新后保留原操作 | 新 H5 网页反馈没有草稿恢复（旧客户端独有）。服务端的恢复与幂等覆盖同上 |
| `t20-member-privacy-store.browser` | 旧成员加密日志：24h 不续期、AES-GCM 不可导出、按账号/单号/用途隔离、损坏后保留 UUID、退出后 401 | 新 H5 网页反馈不使用这个日志。机器人那一路的同类断言在 `t21-bot-feedback-current-risks.browser`、`t21-bot-feedback-actor-authority.browser`；退出后 401 在 `yxx-ss-009-http-recovery.integration`、`yxx-ss-010-runtime.integration` |
| `t25-h5-member-card.browser` | 卡片链接指向原单号；独立 OAuth；只读档；本人看到安全投影；退出后 401；他人 404；只发送 1 次 | **改为** `t25-h5-member-card.integration`：保留全部 API 断言并改走真实 HTTP/PG，另增匿名 401；卡片页面先过归属终检再出外壳；他人在外壳渲染前即被拒（404） |
| `yxx-ss-007-native-ui.browser`（38 例） | 旧客户端：目录、筛选、轮询、CSRF 轮换保留草稿、持久恢复配额、GET-only 恢复、退出阻断、标签页隔离 | 新 H5 客户端行为：`yxx-h5-frontend`、`yxx-h5-page-runtime`、`yxx-h5-member-scheduler`；HTTP：`yxx-h5-http`。唯一的纯 HTTP 用例迁入 `yxx-ss-007-native-http-errors`，根页面按上文改为当前外壳行为，其余 API 断言不变 |
| `yxx-ss-007-native-ui-acceptance.browser`（7 例） | 旧页面多标签、状态文案、ETag 配对 | 同上；它依赖的 `yxx-ss-007-acceptance-fixture.mjs` 一并删除 |
| `yxx-ss-009-browser.integration` | 旧表单提交、补充、复核与工作台同一张 Ticket；存储无敏感值 | `yxx-h5-flow.integration`、`yxx-ss-009-http-recovery.integration`、`human-workbench-process.browser` |
| `yxx-ss-010-browser.integration` | SS011 单报修人表单、补充、退出；SS010 AC093 受限角色 | `yxx-ss-010-runtime.integration`（SS011 HTTP 流程含退出，AC092/AC093）、`yxx-h5-flow.integration` |

保留并改造：`yxx-ss-007-native-http-errors` 不再用旧夹具，改用测试专用的外壳桩 [`h5-shell-stub.mts`](../../tests/helpers/h5-shell-stub.mts)，模拟已启用的 `createYxxH5Static` 页面合同：每次都渲染，不含成员数据，不提供资源。V1 API 合同断言全部保留。

## 路由与工具

- `test-routing.json`：删去 9 个入口，新增 `t25-h5-member-card.integration`；v3-p09 由 251 项减为 246 项，yxx-dev-current 由 43 项减为 39 项，v3-p07 不变。
- 原 207 队列中的 `yxx-ss-007-native-ui`、`yxx-ss-007-native-ui-acceptance`、`yxx-ss-009-browser`、`yxx-ss-010-browser` 登记到 `retired_entries`（Issue 179）。登记使用新增类别 `LEGACY_V1_SELF_SERVICE_UI_RETIRED:`，加载器要求原文件在路由基线中驱动过 `/wecom/yixiaoxiu/` 页面（`launchSystemBrowser` 或 `createYxxBrowserFixture`）。两个类别不能互相借用，删掉登记会报 `LEGACY_TEST_REMOVED`，这些负例都在 `hosts.test.mts`。207 原队列数和 72 条原别名不变；`test:yxx:ss:007` 删除后仍匹配到 `native-http-errors`。
- `resources.json` 删去 3 个旧夹具；`run-tests.mts` 的 900s 超时名单去掉已删的 `native-ui`。
- [自助 API 文档](../../docs/api/member/self-service.md)不再链接已删的夹具。

## 验证

见 PR 描述。适用检查通过即停止扩验；不启动 full/certify、现场、真实发送、部署或 Gate。
