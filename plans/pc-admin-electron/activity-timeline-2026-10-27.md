# 处理记录时间线调整

日期：2026-10-27（Asia/Shanghai）。按用户提供的 [Gr8r Activity 页面](https://gr8r-taskmanagement.vercel.app/) 调整 PC 卡片详情页。基线为 `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 的原有未提交工作区，未提交或推送。发布沿本会话已批准的 `cd3120.mobimedical.cn` PC 配套范围，不新增真实试单或测试发送。

## 变化与保留

- 处理记录按北京时间分为今天、昨天、本周、更早，周一作为周起点；同组头像之间显示细竖线，分组之间断开。继续沿服务端新到旧顺序，加载更早记录时合并同组。
- 时间靠右显示，七天内使用分钟／小时／天，较早记录显示月日，跨年补年份。悬停保留完整北京时间，并提供带 `+08:00` 的语义时间。
- 原始报修、内部记录、报修人可见标识以及实际正文保持；状态变化使用较轻的文本呈现。继续使用原有正文可见性、当前 READ 核验、已读命令、分页、空态和拒绝清理流程。未改变 API、数据库、身份、责任或发送链路。
- 使用既有字体、头像、颜色和间距，无新增依赖。桌面客户端仍为 0.1.2，无须重装；先保存正在编辑的内容，再按 Ctrl+R 重新加载整个工作台页面读取新资源。

## 验证与问题清单

- 时间边界检查覆盖北京时间午夜、周一、跨年、相对时间阈值和跨分页分组。
- 正式编译页面的合成 GET 场景验证 1440 完整页、900 抽屉、七条记录跨页合并、四个时间分组、完整时间提示和无横向溢出；无 POST。截图与结果位于 `.local/electron/activity-timeline/`。
- 定向注册入口：`tests/workbench-activity-time.test.mts`、`tests/web01-workbench.browser.test.mjs`、`tests/t35-normal-web-visible.browser.test.mts`、`tests/t35-normal-long-material.browser.test.mts`、`tests/t35-read-page-denial.browser.test.mts`。
- 首次构建拒绝未登记的 `.mts` 编译入口，补入 `tsconfig.migration.json`；第二次拒绝测试中的非空断言，改为显式元组类型。原日志分别保留为 `build.log`、`build-final.log`。
- 首次测试调用遗漏隔离库声明，入口执行前被拒绝，五个入口均未运行；保留 `tests-final.log` 和 `plan-preflight-refusal.json`。
- 初始正式候选运行结果为 13 PASS / 1 FAIL。T35 拒绝用例假定只会有一个回执查询；实际两个可见正文副本可能查询同一个 UUID，或提前恢复 ACK。诊断还保留缩短视口及切换材料选择的失败尝试。最终测试在已准入的请求发出后模拟页面转入后台，直到明确前台步骤才继续恢复，并等待存在挂起回执；额外断言两个正文副本只产生一个初始已读命令。原撤权隔离、其他事项恢复与命令 UUID 断言保留，业务已读代码未改动。
- 诊断原件：`.local/electron/activity-timeline/diagnose-read-denial*.log`；初始正式报告：`D:/CodexEvidence/workbench-activity-timeline-final-20261027-1793035158665/`。最终候选及结果见下节。旧失败不覆盖。

## 最终候选与发布

- 状态：**IMPLEMENTED_AND_DEPLOYED**。最终 manifest：`37d8926b69b52aa5d219c27695ee8a0e55d93d8d7118dd84c65725ff4e318607`；source input：`b67c1dd60cceb984cd32c0ffc2687b80a92dd55c8206d94644d14923c29ef513`。Node.js 24，886 个 typed、351 个 legacy、2661 个输出；严格类型、负向类型、制品核验通过。
- 五个注册入口 **14/14 PASS**，无 FAIL、SKIP、NOT_RUN。最终报告：`D:/CodexEvidence/workbench-activity-timeline-final-20261027-1793036476317/01/summary.json`，合并入口记录位于同目录上级的 `batch.json`。最终候选的合成视觉确认通过；文档工具 **19/19 PASS**，设计检测无发现。
- 已部署 `human-workbench-20261027-pc-timeline-02`，路径 `/opt/fault-reporting-wecom/p2-g2/pc-timeline-20261027-02/runtime`。服务器隔离组件 **30/30 PASS**，发布后 **30 项 ready 全部通过**、重启次数为 0；桌面入口仍为官方扫码跳转，匿名 API 仍拒绝。
- 发布前后 42 个私有配置文件、8 个媒体文件不变；10 个受理、10 张工单、20 条媒体记录、12 次沟通尝试、0 次通知尝试不变。Ticket 全行、资料快照及身份／角色／团队摘要保持，未新增迁移、真实试单或测试发送。
- 上一实际服务 `human-workbench-20261027-pc-assignee-01` 已停止并保留回退。两个本轮上传目录和未激活的 `pc-timeline-20261027-01` 运行副本已清理；其原 manifest、准备日志和回执保留到当前 release 的 `superseded-preparation-01/`，本地冻结归档亦保留。
- 本轮 PG18 的 52684 端口、PID 4204 已核验关闭，库清单回到四个基线库、无其他连接。删除该测试数据目录的操作被自动审批拒绝，仅返回 `blocked by policy`；未绕过拒绝，数据目录及日志保留。未强制刷新用户当前客户端或丢弃未提交编辑。
- 本地证据入口：`.local/electron/activity-timeline/`；部署／回退脚本和回执：`.local/electron/deploy-timeline-20261027-02/`。发布、发布后核验和服务器暂存清理分别记录在 `activate-01.json`、`postflight-01.json`、`cleanup-01.json`。

P2-G2-LIVE、P2-008、P2-G3、P3 维持原停止线；本轮不运行 full/certify 或远端 CI，不代表业务 Gate 或用户体验验收。功能修补与必要验证已完成；待用户重新加载页面后确认体验，测试数据库目录清理受审批策略阻止。
