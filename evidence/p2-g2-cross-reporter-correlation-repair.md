# P2-G2 跨 Reporter 聚合修复

本地合成输入、真实隔离 PostgreSQL。授权及实现契约见同目录 continuing-gap-repair-authorization 和 cross-reporter-correlation-contract。无迁移、AI、真实发送或自动 Incident confirm/link。

生产接入：现有 Incident Worker 在普通受理提交之后调用 `createIncidentCorrelationWorker`，读取最新原始 Decision/实际 Inbox 时间/可信 Reporter 哈希，生成冻结 P2-007 候选，经现有 Candidate Source Adapter 和 Candidate Review Store 持久化。独立事务及聚合 advisory lock 支持失败重试；原始 Ticket 保留。部门/地点未知时分别为 0，不能声称全院影响。

实际 RED：X031 三人分别正常 Frame 入站并完成 Worker，Candidate=0（期望1）。`tmp/p2-g2-tests-8e543da1-ada0-431b-9d9b-db7a56bbd823/result.tap`，SHA256 `2059e2de5fd6cf849e8b6b047be1afc737d834f16441accff5a4e17d585abde1`，exit1。

独立 Spec 复核发现：只限制最早锚点会纳入晚于观察时刻的最新补充。新增完整入站 RED，`tmp/p2-g2-tests-d24f7ba0-dc9a-4b42-9948-c26e18a12659/result.tap`，SHA256 `c2ab19bc4ed6cede86ccbce1751057b7d0bfaed51e710f33603f2d734058c739`，4/5、exit1。修复为同时校验最新 Decision 结束消息 received_epoch_ms；不回退旧 Decision。

GREEN：`tmp/p2-g2-tests-4f81d71b-d6f0-4e34-a49a-d7487eb94d20/result.tap`，SHA256 `618808fb6125565b19c754ba6d8cadcb5b889a0f87e3c0859a3c5ac903c489b3`，5/5、exit0、skip/cancel/todo=0。覆盖三真实 Reporter→1 Candidate/3独立Ticket、12并发重放，同人群/私聊排重与Frame重放，不同服务/症状，120000ms包含边界/过期/未来，关闭与重新创建Worker的重放，以及最新未来Decision排除。全部使用隔离库清理、Worker停止和HTTP关闭断言。

该记录只是本修复的定向验证；202条金标、完整Gate矩阵、最终全仓回归和就绪候选提交尚待完成，不代表 READY/PASSED 或客户端真实送达。

续项 X029：独立来源核对显示“工作台全空白”是可观察界面故障，但没有足够事实绑定为其他 Reporter 的门诊服务。先冻结修复为 UI.BLANK 症状、独立 Ticket；禁止推导跨人服务身份。否定/假设及纸张空白仍不建故障单。定向 RED 为 6/7、exit1：`tmp/p2-g2-tests-2dc78c95-dd7d-4861-97ac-f9cb4f08fcd0/result.tap`，SHA256 `8b98f3e8311ef0ae1064635bd03b3c71ee25e638fa413e5ec1c5cae62b1dd0d6`。
