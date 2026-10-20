# PR #108 首轮审查修复

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
- 最终本地候选 14 的严格类型、构建、制品及完整运行时归档均通过。其生产输出和其他测试字节与候选 12 相同，仅浏览器验收文件更新；`publication/candidate-12-to-14-delta.json` 保存对比，最终候选 manifest 为 `1b7f6ff28d4f53e9f234af89d411bd0e4568c233ffcc9e7f4fa90e7cc406b09a`。
- `publication/review-green-01.log` 保留一次私聊夹具命中既有同人预置单的失败。现使用独立合成报修人，不删除旧断言或放松生产保护。
- `publication/review-expanded-01.log` 保留浏览器旧断言等待“先建立投递再取消”的超时。新合同在自动动作执行前取消，现直接核对全部动作 CANCELLED、无新增外发 Message／Delivery、Journey 不变及零发送；未延长超时，原投递前保护的独立回归继续保留。
- `publication/review-browser-final-01.log` 保留一次在原 Session／Journey 绑定完成前捕获版本的失败。现等待真实绑定完成再保存比较基线，继续保留版本不变断言，不提高超时或暂停正常绑定维护。
- `publication/build-review-01-red.log` 保留新增测试的可空计数编译错误；后续改为核实际结果行数。隔离 PG 重启时遗漏端口参数的环境失败、纠正后的 loopback 配置和原始日志均保留。

本修复不部署、不迁移现场库、不修改现场发送开关、不执行 full／certify 或推进 Gate。所有构建与失败原件保留；`h5/docs/` 中新加入的用户设计素材不纳入本 PR，不移动或清理。
