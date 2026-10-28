# 待受理卡片占位内容精简

日期：2026-10-27（Asia/Shanghai）。状态：**IMPLEMENTED_DEPLOYED_AND_DESKTOP_VERIFIED**。按用户要求移除待受理卡片左下角“等待领取”及对应空头像图形；原业务数据、未提交工作和历史证据保留，未提交或推送。

## 变化

- 只在待受理且没有处理人姓名的卡片上省略 Owner 占位节点；更新时间保持右对齐。
- 已领取、尚未开始的工单仍可能位于待受理列，继续显示实际处理人姓名。处理中、已关闭卡片及详情／列表的责任信息保持原行为。
- 生产改动仅为 `app/pc-admin/src/app/App.tsx` 的卡片显示条件与 `style.css` 的时间对齐；无 API、数据库、业务状态、配置或依赖变更。

## 验证与发布

候选基线为 `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 的原有未提交工作区；source input 为 `8354d09a831ae47350d555c2748b1c5c3c7fc79f87a4942cc0e227645720cf00`，manifest 为 `a625e89d4510166f0af053737d00e44db8a467f503271eb12c1263f956f56567`。一次构建、严格／负向类型、制品核验与文档检查通过。

- 既有 `tests/web01-workbench.browser.test.mjs` 9例、`tests/t04-self-handling.browser.test.mjs` 6例，合计 **15/15 PASS**，无 FAIL／SKIP／NOT_RUN。报告：`D:/CodexEvidence/workbench-pending-owner-final-20261027-1793061163555/01/summary.json`。未为这次可逆显示修改新增维护性测试。
- 正式编译页面的合成 GET 场景在1440和900宽度通过：两个无人负责的待受理卡片无占位内容，一个已领取卡片保留姓名，处理中／已关闭的三张卡片保留姓名，时间右对齐且无横向溢出；业务 POST 为0。截图与结果位于 `.local/electron/pending-owner/`。
- 设计检测无发现，文档工具19/19 PASS，服务器隔离组件42/42 PASS。
- 已部署 `human-workbench-20261027-pc-card-01`，目录 `/opt/fault-reporting-wecom/p2-g2/pc-card-20261027-01/runtime`。发布后及客户端检查后31项 ready 全通过、重启次数0。
- 已安装客户端重新加载前可见“等待领取”，新文档加载后文字和空头像均消失；更新时间与处理中负责人保留。用户原团队看板、默认日期、最大化状态及7项加载范围保持，没有点击任何业务操作。
- 42个私有配置文件和8个媒体文件不变；10个受理、10张工单、20条媒体记录、12次沟通尝试、0次通知尝试及27个迁移保持，Ticket／资料快照／身份与权限摘要不变。当前配置继续使用已启用“与我有关”的原副本。
- 上一服务 `human-workbench-20261027-pc-range-02` 保留回退；本轮上传目录已核验后清理。自有 PG18（52687／PID 11320）已关闭，四个基线库恢复、无其他连接、进程不存在且监听0；数据目录与日志保留。

发布及回退回执位于 `.local/electron/deploy-card-20261027/`，工作与客户端脱敏验证记录位于 `.local/electron/pending-owner/`。本次用户请求已完成；未运行 full/certify 或远端 CI，不改变既有业务 Gate 停止线。
