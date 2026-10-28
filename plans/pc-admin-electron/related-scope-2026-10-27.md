# 启用“与我有关”

日期：2026-10-27（Asia/Shanghai）。状态：**IMPLEMENTED_ENABLED_AND_VERIFIED**。按用户要求恢复草稿中已有的团队／个人分组；沿本会话已授权的 `cd3120.mobimedical.cn` PC 配套发布范围实施，不新增真实试单或测试发送。既有未提交改动保留，未提交或推送。

## 原因与实现

正式前端已经按 bootstrap 的 `workbench_follow_enabled` 显示“团队工作／与我有关”，后端也已有 T34 查询、关注与取消关注。当前 `human-v1` 的配置解析、App 角色配置及实际 Runtime 装配没有接通该选项，因此运行时沿默认 false，入口被隐藏。

新增运行配置 `workbenchFollowEnabled`，缺省及示例仍为 false；只传给 App，并在父配置和 App 子配置验证布尔类型。Worker／Gateway 不接收该选项，非法角色注入被拒绝。当前部署的独立配置副本显式置 true；没有修改默认策略、前端布局、API、业务查询算法或旧 SQL。

“与我有关”沿原合同：**当前 READ ∩（本人处理责任 ∪ 本人当前沟通责任 ∪ 本人明确关注）**。同一规范事项去重后分页；团队可见本身不构成个人关系。关注不改变负责人、状态、版本或通知事实，也不扩大读取权限。原跨刷新草稿恢复仍关闭。

## 验证

最终候选基于 `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 的未提交工作区；source input 为 `97c6e66893d4bb32a87acab3b04d97f1d11a543cc6f218658bfc9966730fdd81`，manifest 为 `d0c1484a343198d5f8b98aa6f0ca8b55659f9321aaa61d20ce9cb5c655cc8f01`。Node.js 24，886 个 typed、351 个 legacy、2661 个输出；一次构建、strict／negative types、制品核验通过。

| 注册入口 | 用例 | 结果 |
| --- | ---: | --- |
| `tests/human-workbench-configuration.test.mts` | 11 | PASS：默认关闭、配置类型及角色隔离 |
| `tests/human-workbench-process.browser.test.mts` | 4 | PASS：正式父进程及三个子进程、真实认证／HTTP／PG／编译页面；关注进入一次、取消后退出、责任不变 |
| `tests/wbint-t34-follow-contracts.test.mts` | 3 | PASS |
| `tests/wbint-t34-follow.integration.test.mts` | 1 | PASS：真实沟通责任并集 |
| `tests/wbint-t34-explicit-follow.integration.test.mts` | 2 | PASS：关注、幂等与有界集合查询 |
| `tests/wbint-t34-follow-risks.integration.test.mts` | 10 | PASS：默认关闭、schema 漂移、CAS、权限、规范去重与转交 |
| `tests/wbint-t34-follow-production.browser.test.mts` | 1 | PASS：正式页面、看板／列表与重载 |
| `tests/wbint-t34-follow-recovery.browser.test.mts` | 5 | PASS：UNKNOWN、失权、迟到回执与会话拒绝 |

合计 **8 个入口、37/37 PASS**，无 FAIL／SKIP／NOT_RUN。报告：`D:/CodexEvidence/workbench-related-scope-final-20261027-1793037603582/01/summary.json`，入口汇总为上级 `batch.json`。文档工具 19/19 PASS。服务器无网络的隔离组件检查 42/42 PASS。

已安装客户端也已验证：先确认位于主界面且无未保存表单，再重新加载；“与我有关”入口出现。当前“今天和昨天”完结日期范围内，团队加载 7 项（待受理4／处理中3／已关闭0），个人分组加载 3 项（0／3／0）；列表仍为3项，新文档重载后保留 `scope=related&view=list`，最终恢复至 `scope=related&view=board`，窗口恢复原最大化状态。记录数仅指当次当前范围，并非全库总数。未在现场点击关注、取消关注或任何业务提交。

## 发布、保全与关闭

- 已启用 `human-workbench-20261027-pc-related-01`，运行目录 `/opt/fault-reporting-wecom/p2-g2/pc-related-20261027-01/runtime`。发布前使用真实配置进行只读核验：044 schema 完整、现有关注／回执权限足够；无需迁移或授权扩张。
- 发布后及客户端检查后均为 **31 项 ready 全部通过**，包含 `workbench_follow_schema=true`，重启次数0。官方扫码入口和匿名 API 拒绝边界保持。
- 原42个私有配置文件逐字节保留；新副本中41个保持相同，只有 `runtime.json` 的 `workbenchFollowEnabled` 配置值新增为 true。8个媒体文件、10个受理、10张工单、20条媒体记录、0条关注关系、12次沟通尝试、0次通知尝试及27个迁移保持；Ticket、资料快照、身份／角色／团队及关注关系摘要均未改变。
- 上一服务 `human-workbench-20261027-pc-timeline-02` 和原配置保留回退。可按当前 release 的回退脚本恢复；后续仅关闭该功能时，应将显式配置恢复 false 后沿相同受控启动流程重启，保留个人关系与操作回执。
- 本轮上传目录已核验归属和归档哈希后清理。自有 PG18（52685／PID 13968）已关闭，四个基线库恢复、其他连接0、进程不存在、监听0；测试数据目录与日志保留。客户端安装包无变化。
- 本地证据：`.local/electron/related-scope/`；发布、配置变更、回退及现场回执：`.local/electron/deploy-related-20261027/`。实际客户端检查仅保存脱敏计数与路径，不另存业务正文截图。

本次用户请求已完成。未运行 full/certify 或远端 CI，不变更 P2-G2-LIVE、P2-008、P2-G3、P3 的停止线，也不将定向检查替代业务 Gate。
