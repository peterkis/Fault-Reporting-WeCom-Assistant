# PR #108 审查修复

审查对象为 `a2157b157b432cb696105b3c8806875056e4d39a`。本记录补充[初始实施快照](execution.md)，不改写候选 01–09 和旧验收报告。

## 已复现的问题与修复

- [P1：批次末尾致谢覆盖前面的故障](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/108#discussion_r4322701674)。原实现只看最后一条是否致谢。现在先取上次已处理的消息边界；仅当本批所有新增消息均为纯致谢时，才使用致谢输入，其余情况保留整个有界故障窗口。
- [P1：人工接管后规则仍写业务状态](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/108#discussion_r4322701682)。原实现只取消固定群消息，未阻止分类、建单、Journey 状态及复核动作。现在在共享控制锁下核对持久接管／交接记录，取消全部自动业务动作并留审计，释放后仍暂停。固定致谢沿单独的原消息判定与模板绑定产生，不恢复其他回应。

执行端和发送端共用原主题暂停判定。独立处理命令沿控制锁先于 Intake 锁的顺序，Worker 继续使用原 claim 顺序。MVP 决策策略前向升为 `mvp-safe-route/2`，不改旧 Decision、责任、Message 或 Delivery。

## 回归与证据

证据根目录为 `D:/wecom-workbench-evidence/mvp-notifications-h5-20261020`。

新增用例通过实际 Gateway／Worker／控制 HTTP 接口覆盖：批量故障后紧跟致谢；群聊及私聊接管后不自动建单；释放后继续暂停；重复扫描不改变业务状态。原固定致谢、普通消息静默和投递前保护继续核对。

- `review-red-02/summary.json`：未修复生产实现上，原 2 项通过，新增 2 项按目标症状失败。第一次环境连接失败另存 `review-red-01/`，不计为复现。
- `review-green-02/summary.json`：修复后 4 个相关入口、20 项通过，包含新增用例、既有规则编排、Worker 和会话投递准入。
- 扩大通知、群路由及分路恢复的 10 个入口、35 项通过，原件为 `review-expanded-01/summary.json`；其中原浏览器失败另留原样，最终 4 项浏览器回归在 `review-browser-final-02/summary.json` 全部通过。合计 15 个相关入口、59 项适用结果通过，逐入口源码／执行字节核对见 `publication/repair-validation-summary.json`。
- 首轮本地最终候选 14 的严格类型、构建、制品及完整运行时归档均通过。其生产输出和其他测试字节与候选 12 相同，仅浏览器验收文件更新；`publication/candidate-12-to-14-delta.json` 保存对比，该候选 manifest 为 `1b7f6ff28d4f53e9f234af89d411bd0e4568c233ffcc9e7f4fa90e7cc406b09a`。
- `publication/review-green-01.log` 保留一次私聊夹具命中既有同人预置单的失败。现使用独立合成报修人，不删除旧断言或放松生产保护。
- `publication/review-expanded-01.log` 保留浏览器旧断言等待“先建立投递再取消”的超时。新合同在自动动作执行前取消，现直接核对全部动作 CANCELLED、无新增外发 Message／Delivery、Journey 不变及零发送；未延长超时，原投递前保护的独立回归继续保留。
- `publication/review-browser-final-01.log` 保留一次在原 Session／Journey 绑定完成前捕获版本的失败。现等待真实绑定完成再保存比较基线，继续保留版本不变断言，不提高超时或暂停正常绑定维护。
- `publication/build-review-01-red.log` 保留新增测试的可空计数编译错误；后续改为核实际结果行数。隔离 PG 重启时遗漏端口参数的环境失败、纠正后的 loopback 配置和原始日志均保留。

本修复不部署、不迁移现场库、不修改现场发送开关、不执行 full／certify 或推进 Gate。所有构建与失败原件保留；`h5/docs/` 中新加入的用户设计素材不纳入本 PR，不移动或清理。

## 第二轮：资格查询与旧通知恢复

审查对象为 `982cbcb497e776dcc8c8c4542293dde385797b39`。

- [P2：临时成员查询故障导致通知不可恢复](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/108#discussion_r4323057153)。查询不可用现在与明确无资格分开。新 H5 读取遇到查询不可用返回既有 503；应用通知在 SDK 发送前沿原 Worker 有界重试。原生收件资格查询使用两秒预算，早于原 Worker 五秒发送期限；不延长期限、不放松实际发送后的 UNKNOWN 核对。
- [P2：旧未尝试死信阻止实际接单通知](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/108#discussion_r4323057163)。复用既有 Delivery 取消转换与追加式尝试审计，在已锁定的原轮次内退役 `DEAD_LETTER + NOT_ATTEMPTED` 旧首责通知。每次至多处理 20 条。SENT、UNKNOWN 及人工取消但副作用仍为 UNKNOWN 的旧记录继续阻止自动替代；Message／Outbox 正文和原收件绑定不变。

`review2-red-app-01/` 复现了临时 HTTP 失败后错误进入死信；`review2-red-upgrade-01/` 复现了旧未尝试死信阻止新通知，并补充人工取消 UNKNOWN 仍不能自动替代的反例。候选 16 的四个 MVP 入口、17 项核心回归通过，随后扩大共用投递、T24／T25／T26 和浏览器的 52 个入口、113 项通过。原件分别为 `review2-green-core-01/` 与 `review2-expanded-01/`，不重绑为后续候选的执行结果。

同类诊断在实际 Bot 私聊成员核验路径也复现了零 SDK 调用后进入死信。现将同一不可用／拒绝区分用于 Bot 私聊、固定群回应和 Webhook 提及核验；出站查询使用两秒预算，沿用原有单操作队列。入站仍使用原五秒 fail-closed 准入，不新增人员名单、队列或配置开关。诊断原件 `publication/diagnose-bot-qualification-red.log` 仅作诊断；已注册的群回应和通知策略回归分别核对同一 Delivery 从 PENDING 恢复为 SENT、零重复发送及正确原群提及。

最终候选 17 的 16 个相关入口、66 项适用结果通过，逐入口源码／执行字节证明见 `publication/second-repair-validation-summary.json`。`review2-outbound-final-01/` 保留 65 项通过与一项三进程启动就绪超时；相同源码和构建在 `review2-browser-confirm-02/` 的四项浏览器复核全部通过。该次启动超时原因未确定，不称为已修复，也不删除失败或提高超时。候选 17 的严格类型、制品校验及 2427 项输出归档哈希核对通过，manifest 为 `fdda6d861ec9597d45bb8b99e050bd8c69dde14dc5d7e7c13030653b58f08694`。

## 第三轮：发送前本地终检故障

审查对象为 `848b841a6d2a1f212eeff0f7ecf4e6b9c446bc5b`。

- [P2：Bot 个人通知终检异常被判为永久拒绝](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/108#discussion_r4323462319)。成员核验与原绑定终检分别处理；确认为原绑定缺失或变化时拒发，本地查询不可用时保留同一 Delivery 重试。
- [P2：固定群回应终检异常被判为发送结果不明](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/108#discussion_r4323462333)。固定群回应、Webhook 和应用通知均在实际发送前捕获本地读取异常，返回可重试的未发送结果。实际 SDK／Webhook 调用后的 UNKNOWN 处理不变。

复用 Sender Port 的小型等待工具，将本地准备和终检限制在四秒内，早于原 Worker 五秒发送期限；工具不能执行真实发送。超时后即使原查询迟到返回，也不能进入 SDK。新成员资格的两秒预算、原数据库池上限和旧应用资格查询期限保持原样。不新增队列、服务或持久开关。

`review3-red-01/` 和 `review3-red-bot-01/` 分别在原实现上复现了错误进入待核对与死信；`review3-red-app-01/` 复现应用通知的同类死信。测试通过实际 Worker 注入成员核验后的数据库异常，并覆盖个人／原群终检超时、迟到查询与同一 Delivery 恢复。

候选 19 的回归发现旧“来源过期”夹具可能命中 `message_inbox_retention_check`：秒级时间精度令测试更新失败，旧捕获把异常误当成拒发。现在按原消息接收时间等待合法过期边界，确认实际更新成功，再精确断言原绑定失效与零 SDK。`publication/diagnose-expired-final-check*.log` 仅作诊断，`review3-green-core-01/` 的失败保留，不算通过。

候选 20 的重试夹具曾因数据库／JavaScript 时钟精度差导致领取为空。现只将合成投递的 `next_attempt` 置于明确过去，不改生产时钟、租约或终检。`review3-final-01/` 保留原失败，后续报告使用新目录。最终候选 21 的 manifest 为 `03c5877325bf96584c65a8f6e1b34e1866a9066ba37580e52ab38bd186aed913`；最终验证结果另记 `publication/third-repair-validation-summary.json`。

最终候选 21 的 55 个相关入口、126 项全部通过，零失败、取消、跳过和 NOT_RUN。包含三个 MVP 集成入口、原 T24／T25／T26、三进程浏览器和共用投递回归。严格类型、构建、制品、文档检查与 2427 项输出归档哈希核验通过。构建编译错误保留于 `publication/build-review-11-third-green.log`，后续正常修复类型与测试夹具，不增加类型逃逸、放宽生产保护或原 SDK 超时。
