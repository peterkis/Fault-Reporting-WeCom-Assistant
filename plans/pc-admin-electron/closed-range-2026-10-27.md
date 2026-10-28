# 主界面说明与关闭日期范围

日期：2026-10-27（Asia/Shanghai）。按用户要求移除主界面底部接单说明及范围下方的日期／待确认提示，并完善关闭范围选择。现有预设原本已经可选；发出可选澄清后，已说明按增加自定义起止日期实施，保留全部原有预设。沿本会话既有 `cd3120.mobimedical.cn` PC 配套发布授权，不新增真实试单或测试发送。未提交或推送。

## 变化

- 删除主界面“展示当前身份获权的服务记录。打开详情后，请点击‘我来处理’接单。”以及范围下方的重复说明。清理不再使用的范围提示样式，保留来源群页面独立使用的说明样式。
- “已关闭范围”保留今天和昨天、全部完结记录、已取消，增加自定义日期。使用原生日期输入，选择开始、结束日期后点击应用；缺失或倒序日期不能提交。
- 服务端接纳 `range=custom&closed_from=YYYY-MM-DD&closed_to=YYYY-MM-DD`，验证真实日历日期及顺序，按北京时间计算包含开始日和结束日的窗口。按原真实完结事件时间筛选；未完成和已解决待确认事项保留，取消事项继续使用原专项范围。
- 自定义范围绑定分页游标的两端日期，切换日期不复用旧游标；看板／列表、团队／个人范围和页面重载保留日期。预设沿原 v1 游标，自定义使用 v2。独立高级搜索保持原预设合同，显式提交搜索时清除主看板的自定义日期参数。
- 无数据库迁移、权限扩张、新依赖或配置修改；已启用的“与我有关”保持。

## 验证与历史问题

本轮使用真实编译产物、隔离 PG18 和真实浏览器验证。新增入口 `tests/web01-closed-range.browser.test.mts` 覆盖闰日、开始日零时、结束日最后一秒、次日排除、非法／缺失／重复参数、当前 READ、未完成保留、双边游标绑定、实际日期输入、应用、范围／视图切换、重载、预设恢复、零业务 POST 及宽窄窗口。

相关入口为 `tests/web01-workbench.integration.test.mjs`、`tests/web01-workbench.browser.test.mjs`、`tests/wbint-t34-follow-production.browser.test.mts`、`tests/wbint-t34-explicit-follow.integration.test.mts`、`tests/t41-search-contract.test.mts`、`tests/t41-search-production.browser.test.mts`。

- 初次构建在前端精确可选属性检查中失败：显式传入 undefined 与可选 dates 属性不匹配，已改为明确的 `dates | undefined` 输入类型；未关闭严格检查。原件 `.local/electron/closed-range/build.log` 保留。
- 首个完整候选 manifest `db29edfdadad96b12789c6cd3fddf2fc1e8564ec656640c949df4e1a504354d5` 的新增两例均通过，但截图目录／文件名未符合既有归档白名单，入口记 ERROR；其余六入口19例通过。已改用原有 `web01-ui-<UUID>` 和标准截图命名，没有放宽归档工具。原报告 `D:/CodexEvidence/workbench-closed-range-final-20261027-1793040567103/`、首次1440／900截图及失败日志保留，不能将该轮称为全部通过。
- 视觉检查：首次1440／900窗口中日期控件清楚可见，无横向溢出，两处文案已消失；最终使用标准1920／900截图确认。设计检测无发现。

## 最终候选与发布

候选基线为 `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 的原有未提交工作区。最终 source input：`1b622b998ac77ce28ea14cf8bb9f91e68ba78e86cdcf7d0758ed359173af1455`；manifest：`dd5efe2199d61fc990f6bd482c4c42d86a4c13baa7d9f5396a82a93e5591112e`。887 个 typed、351 个 legacy、2663 个输出。

状态：**IMPLEMENTED_DEPLOYED_AND_DESKTOP_VERIFIED**。严格类型、负向类型、制品核验、文档工具19例及设计检测通过。

最终候选的7个入口共21例中，整轮为20 PASS／1 FAIL；失败是 T34 正式浏览器的 `P2_006_BROWSER_COMMAND_TIMEOUT`。保持源码、制品和超时不变，单独复测该入口取得1 PASS；21例均已在同一候选上取得通过结果。保留原超时，不将自然复测通过称为修复了浏览器超时。整轮报告：`D:/CodexEvidence/workbench-closed-range-final-20261027-1793041330562/`；单项复测：`D:/CodexEvidence/workbench-closed-range-follow-recheck-20261027-1793041708696/`；合并证据索引为 `.local/electron/closed-range/final-verification.json`。

已发布 `human-workbench-20261027-pc-range-02`，目录 `/opt/fault-reporting-wecom/p2-g2/pc-range-20261027-02/runtime`。服务器隔离组件42例通过；发布后及实际客户端检查后均为31项 ready 全部通过、重启次数0。当前配置沿用已启用个人分组的原副本，42个私有文件逐字节不变，8个媒体文件不变；10个受理、10张工单、20条媒体记录、12次沟通尝试、0次通知尝试及27个迁移不变，Ticket／资料快照／身份与权限摘要保持。未新增业务写入、迁移或真实测试发送。

已安装客户端实际确认两处文案消失，范围菜单的四个选项和原生日期日历可用。通过日历选择10月19日，应用10月19日至27日后团队显示10项；通过日期字段数字键改为10月26日，应用26日至27日后显示7项，关闭列从3项变0项，未完成的4＋3项保留。现场截图只用于当次检查，交付目录仅保存脱敏日期、数量及路径，不另存业务正文截图。检查后已恢复原来的“与我有关”卡片看板、今天和昨天预设及最大化窗口，显示3项。

上一服务 `human-workbench-20261027-pc-related-01`、配置和回退脚本保留。未激活的本轮01运行副本及两个上传目录已按归属、挂载和哈希检查后清理；其准备日志和 manifest 保留到当前 release 的 `superseded-preparation-01/`，本地原冻结归档也保留。自有 PG18（52686／PID 25464）已关闭，恢复四个基线库、无其他连接、进程不存在且监听0；数据目录和日志保留。

本地工作与收口证据在 `.local/electron/closed-range/`，部署／回退及回执在 `.local/electron/deploy-range-20261027-02/`。本次功能请求已完成；历史类型、归档与浏览器超时失败保持。P2-G2-LIVE、P2-008、P2-G3、P3 维持原停止线；本轮不运行 full/certify 或远端 CI。
