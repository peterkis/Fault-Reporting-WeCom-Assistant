# 工单来源与人员资料长期保存修复

状态：**IMPLEMENTED_AND_DEPLOYED**。用户于2026-10-26要求修复Bot资料采集、补全及留存问题，并明确来源、姓名、部门在完结后随工单持续保存。2026-10-27 00:23（Asia/Shanghai）沿本次已具名授权的 `cd3120.mobimedical.cn` PC配套发布完成；没有新增真实试单或测试发送。依据[ADR-0048](../../adr/0048_ticket_reporter_profile_lifecycle.md)。GitHub未发布本轮任务，以下为本地完成清单，不替代Issue或Gate状态。

## 问题与完成项

| 项目 | 结果 |
| --- | --- |
| Bot Worker未装配人员读取 | 已装配现有企业微信身份转换与成员资料读取Port。真实编译Gateway→Worker→Ticket测试覆盖私聊、群聊、新发送人和去重，不创建工作人员权限 |
| 首次失败后没有补全 | 新增持久补全状态、最多8次尝试、单并发、退避与领取令牌；超时不阻断受理，重启不重置次数，迟到结果不覆盖新结果 |
| Ticket资料被原消息24小时留存遮蔽 | migration 067增加专用资料表，覆盖Bot、H5、人工代录。必要来源、姓名、部门随Ticket保存；完结、取消、重复关联、重开均不按30天或其他时间自动清理 |
| 历史快照与后来资料混淆 | 保留原Journey快照；原有资料投影为REPORT_SNAPSHOT，后来补得资料记录LATER_LOOKUP与实际获取时间 |
| 读取权限 | 原始正文、会话、媒体保持原留存；工单资料按当前Ticket READ读取，等待后再次核验；撤权后页面清除资料 |
| 默认与回退 | 通用配置 `workbenchReporterProfilesEnabled=false`；只在具名发布的新配置中开启。原版本、原配置和新资料表均保留 |

## 现场只读核对

`IT-20261019-0003`：仍为IN_PROGRESS，来源WECOM_DIRECT／企业微信私聊；资料状态RESOLVED，姓名和部门均已落库，实际获取时间已记录，来源标记LATER_LOOKUP。Ticket原Intake及Reporter HMAC对应一致。原来源仍已过期，原Journey仍为DEFERRED且快照为空，未伪造或覆盖原始报修时资料。

现有10张工单均已投影必要来源资料：Bot 2条、H5 6条及人工代录1条资料完整；另一张已关闭人工代录 `IT-20261019-0002` 保留了原姓名和电话代录来源，其原件没有部门，因此部门仍为空、状态UNAVAILABLE，不猜填，也不调用人员Provider替代人工核实。这个原始资料缺口已记录，不能把10条投影称为10条资料完整。

现场核对只输出存在性、状态、计数与摘要，不输出姓名、部门原值、身份、证明或凭据。证据：`.local/electron/deploy-reporter-20261027/reporter-proof-01.json`、`unavailable-proof-01.json`。

## 候选与验证

分支 `codex/pc-admin-electron-mvp`，HEAD `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加当前工作区差异；原有未提交改动保留，未提交或推送。

- manifest SHA-256：`bb428ddaf98243ae0acc81078049c7684faf4d4a8c65bd1c285bbba6d6958978`。
- source input SHA-256：`ba91cd238ff7ebc704e85100163ee4abc437db61825fa2f7e93709004b2429c4`。
- 统一构建：884 typed、351 retained legacy、2657 outputs。strict、负向类型、制品与差异空白检查均通过；067 SQL已纳入显式资源清单。
- 11个已注册入口 **68/68 PASS**，0 FAIL／SKIP／NOT_RUN。分别为：`ticket-reporter-profiles` 7、`human-workbench-configuration` 10、`yxx-h5-v2.integration` 3、`human-workbench-process.browser` 4、`p2-015-contact-journey` 2、`p2-015-rule-first-orchestration` 7、同名integration 5、`p2-016-orchestration.integration` 1、`p2-007-third-party-reporter-directory` 17、`web01-workbench.integration` 3、`web01-workbench.browser` 9。完整路径与计数见正式报告 `D:/CodexEvidence/workbench-reporter-lifecycle-final-20261027-1793031395719/`。
- 真实编译HTTP／PG／Chrome页面验证：关闭Ticket且原来源过期后，姓名、部门、群聊来源仍显示；撤销当前工作人员权限后资料从页面清除。该例人员Port为明确合成边界，不冒充现场人员获取。截图及收据：`.local/electron/reporter-lifecycle/retained-ticket-1280.png`、`ui-proof.json`。
- 文档检查通过，文档工具19/19；服务器新目录内隔离组件28/28。

保留中间失败：首次strict发现两处类型问题；初版构建漏收067 SQL，首批为14 PASS／9 FAIL；修补资源后第二批为20 PASS／3 FAIL，其中H5持久资料读取仍误用原入口留存门禁，另两项为浏览器超时。修复H5读取及等待后的READ终检后，第三批为22 PASS／2 FAIL；实际请求证明浏览器超时来自外部接口替身缺少当前坐席资料、返回401触发退出保护，补齐测试边界后最终通过。新增撤权测试的泛型返回类型曾导致strict失败，已修正。另一次测试启动早于构建封存而缺少manifest、一次独立UI夹具违反Journey时间约束，均保留原日志且不计为通过。原始记录位于 `.local/electron/reporter-lifecycle/`，没有用最终PASS覆盖原失败。

## 发布与保全

发布目录 `/opt/fault-reporting-wecom/p2-g2/pc-reporter-20261027-01/runtime`，唯一活动容器 `human-workbench-20261027-pc-reporter-01`。显式check／apply／再次check仅执行 `067_ticket_reporter_profiles`；历史迁移校验和保持。**30项ready通过、重启0次**，桌面入口302到官方扫码地址，匿名API401，H5页面与上一版资源200。

原42个私有配置文件保持原字节；新发布复制42个文件，只在新runtime.json中开启资料能力。8个媒体文件保持原字节。前后均为10条Intake、10张Ticket、20条媒体记录，communication发送尝试12、notification发送尝试0；Ticket整行摘要和原Journey资料摘要一致。新增的是资料投影及067迁移回执，没有试单、测试发送或工单状态写入。

旧容器 `human-workbench-20261026-pc-navigation-01` 已停止并保留，原配置、上一版静态资源、监督配置和回退脚本均留存。回退程序／配置不删除新资料。发布收据位于 `.local/electron/deploy-reporter-20261027/`；回退脚本为同目录 `rollback.py`，只在另行要求回退时执行。

自有PG18端口52682已恢复4个初始库、0其他客户端后关闭；核对PID及创建时间，pg_ctl status=3、原进程消失、监听0。数据目录与日志保留，不称全部文件已删除。收据：`.local/electron/reporter-lifecycle/pg-closure.json`。

客户端仍为0.1.2，无需新安装包。保留用户已打开窗口及未保存输入，重新加载服务器页面后获得新展示。full／certify、远端CI／审查及Gate批准均NOT_RUN；不推进P2-G2-LIVE、P2-008、P2-G3或P3。
