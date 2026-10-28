# 接单后处理人显示默认名称修复

状态：**IMPLEMENTED_AND_DEPLOYED**。用户报告点击“我来处理”后处理人显示“信息科工作人员”。沿本次已有的PC配套部署授权，在 `cd3120.mobimedical.cn` 发布修复；未新增真实试单、测试发送或改派工单。

## 根因与修复

- 已用真实编译HTTP／PG复现：企业微信当前人员资料已返回合成实际姓名；执行 `take-and-start` 后assignee_id等于操作人员principal，但卡片assignee_name仍为“信息科工作人员”。原RED和后继GREEN见 `.local/electron/assignee-name/repro-red.log`、`repro-green.log`。
- 现场只读核对也确认，处理人、最近接单／开始事件及当前处理轮次主体一致。问题在名称来源：侧栏读取当前企业微信资料，工单、责任信息及人员候选读取内部principal.display_name，后者仍是初始化默认名称。
- 在既有 `currentDisplay` 成功核验员工资料后，窄更新该员工的显示姓名。写入再次核验当前会话、活动内部角色和启动时明确映射的原始企业微信ID。没有更换principal、身份ID、角色、团队或Ticket责任。
- 资料失败、姓名缺失／无效、返回身份不符、原身份映射变更或等待期间撤权时，不覆盖已有姓名。没有新增Schema、Feature Flag、Provider接口或依赖，也没有给看板增加逐卡片外部请求。

## 验证

候选为HEAD `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加当前差异，分支 `codex/pc-admin-electron-mvp`。原改动保留，未提交或推送。

- manifest：`19e34e5d55bb6cb93dd58f29a6ac17ac368d371b88d50e0d658decc12e611027`。
- source input：`6af56457ad224f6acf40838eb529c591cac3658ae43d145cb143ea724fbc5bfa`；884 typed、351 retained legacy、2657 outputs。
- 6个注册入口 **36/36 PASS**，0 FAIL／SKIP／NOT_RUN：WeCom auth单测4、auth integration 6、self-handling integration 13、self-handling browser 6、human-workbench process browser 4、web01 integration 3。精确路径和报告位于 `D:/CodexEvidence/workbench-assignee-name-final-20261027-1793033246622/`。
- strict与负向类型、制品、文档链接和差异检查通过；文档工具19/19，服务器隔离组件28/28。初版构建通过后，为撤权夹具补齐Schema要求的撤销时间字段并生成最终候选；原RED、初次构建与GREEN分别保留，不冒充同一候选。

## 发布与现场核对

活动容器 `human-workbench-20261027-pc-assignee-01`，运行目录 `/opt/fault-reporting-wecom/p2-g2/pc-assignee-20261027-01/runtime`。30项ready通过、重启0；官方桌面扫码重定向、匿名API拒绝、H5页面及上一版资源检查通过。没有执行迁移或修改配置。

已通过原始企业微信ID→应用ID明确转换及当前成员核验，对仍使用默认名称且已承担工单的1个批准员工刷新显示姓名。只写display_name及更新时间；没有伪造Cookie或会话，没有使用姓名猜测身份。现场修补的选择数1、成功1、资料不可用0、并发变化0；个人姓名、身份和凭据原值不输出。

只读复核 `IT-20261022-0009`、`IT-20261019-0003`、`IT-20261019-0001`：三者仍为IN_PROGRESS，姓名均已离开默认值，assignee_id仍与原接单／开始事件及处理轮次主体一致。人员身份／角色／团队摘要、Ticket整行摘要、原报修资料摘要与发布前一致；仍为10条Intake、10张Ticket、20条媒体记录、communication发送尝试12、notification发送尝试0。42个私有配置文件及8个媒体文件保持原字节。

旧容器 `human-workbench-20261027-pc-reporter-01` 已停止并保留；发布、核对和回退材料位于 `.local/electron/deploy-assignee-20261027/`。回退程序不把已核验姓名改回占位名称。客户端仍为0.1.2，无需重装；刷新工作台读取新名称即可。

自有PG18端口52683已恢复4个初始库、0其他客户端后关闭，PID／创建时间核对通过，pg_ctl status=3、原进程消失、监听0；数据和日志保留。收据 `.local/electron/assignee-name/pg-closure.json`。GitHub未发布本轮任务，本记录不替代Issue状态。full／certify、远端CI／审查与Gate批准NOT_RUN，既有停止线不变。
