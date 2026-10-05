# YXX-UI-001 我的报修来源筛选

状态：IMPLEMENTED_WAITING_REVIEW。授权：2026-10-05 用户“按照你的推荐进行推进 /implement”，承接仓库外 R00 的推荐候选 A。实现与两项定向 TDD 已完成；最终候选的直接回归、普通 CI 和资源结果以本 PR HANDOFF 为准，此状态不声明发布 readiness、合并或现场通过。

## 输入、输出与既有合同

- 输入：已核验成员在原生“我的报修”页面选择全部、网页报修或企业微信工单。
- 输出：该成员所选来源的服务端分页结果；切换来源从第一页重新查询。
- 沿用 `GET /api/yixiaoxiu/my-reports?source=WEB|BOT&cursor=...&limit=20`；全部来源不传 source。
- Schema：沿用 `contracts/yxx_self_service.openapi.yaml` 与 `yxx_self_service_report_page.schema.json`，不新增响应字段。
- 无数据库变更；不更改 source-bound HMAC cursor、本人授权或 Ticket 状态。

## 已授权的验证边界

R00 推荐与本次授权已确认以下公开 seam：真实浏览器操作原生页面及其 same-origin HTTP 请求；既有成员 Query 集成入口验证本人隔离和 source/cursor 绑定。浏览器夹具使用合成 OAuth/查询数据，成员 Query 使用任务自有 loopback PG18，不连接真实 Provider。

- 浏览器证明三种来源、重置/延续分页、快速切换、晚到响应、空结果和错误可见。
- 退出、会话变化及跨标签退出清除旧列表/选择；不写浏览器持久存储。
- 直接入口：既有 SS-007 native-ui browser/acceptance、SS-005 member-queries；保留 v3-p09 跨域 smoke。
- 普通 PR 完成 strict types、最终候选一次构建、制品核验与任务自有数据库/浏览器/进程清理。TDD 诊断构建与最终候选检查分别记账。

## 安全、资源与关闭

复用当前 operation/generation fence 和 AbortController。新来源加载前清空旧列表/cursor；晚到响应不得覆盖新来源或新成员。单次 limit=20，不预取全部来源、不增加轮询/连接池/后台进程；控件可键盘操作。

既有 self-service/my-reports Feature Flag 默认 false，不新增 Flag。关闭沿用原入口开关；源码回退用后继修补或独立 revert PR。

## 交付与停止

最小范围为原生 HTML/JS/CSS、直接浏览器测试、局部 runbook、此增量与 ticket-plan 记录；迁移 README 仅补 P09 合并收口说明。

真实验证结果、被测 SHA、构建指纹、资源清理和日志位置放在本 PR HANDOFF 及仓库外 `D:/Agent-State/wecom-yxx-source-filter-20261005/`。状态不以“代码写完”收口。

不迁移 D01，不改 ACTIVE_SELECTION、181 分母、SQL、历史 Evidence、业务 Gate 或默认开关。发布止于业务 PR；不自动合并、full/certify、R01、C10/C11、真实 OAuth/企业微信、医院数据库、部署或发送。
