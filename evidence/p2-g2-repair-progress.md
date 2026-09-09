# P2-G2 修复进度与新的冻结范围阻塞

最新状态（2026-09-09）：准备工作仍为 `IN_PROGRESS`。新增三入口、默认两类单聊通知、群关闭 Webhook、显式续接、群内活动会话及原始报修时间修复；通知定向 56/56、三进程 Webhook 1/1、入口与来源 47/47，详见 `p2-g2-notification-policy-repair.md` 和 `p2-g2-explicit-continuation-repair.md`。下文保留此前定向修复快照。76条原始单文本及21项会话边界已有实际PostgreSQL验证，见 `p2-g2-recognition-repair.md` 和 `p2-g2-direct-session-repair.md`。仍非 READY，没有第二个候选提交或完整回归结论。

2026-09-08。Gate 仍为 `IN_PROGRESS`，准备结果为 `BLOCKED_BY_FROZEN_GOLD`，不是 `READY_FOR_LIVE_E2E`。保留本地授权提交 `d7311cdbfe30c66f37d22a553a3e8f0e04e27cd1`；本次修复尚未形成第二个候选提交。

## 已实现并定向验证

- 状态查询与业务咨询复用既有 Manual Review/Safe Action；保留原 Decision，审核可见、可处理，12 路同 ID 决议仅一次提交，审核写入失败回滚并可恢复。没有新增数据库迁移。
- Worker 固定群引导和人工 Review 引导复用现有 PERSON Authorizer。无 Direct Leg 不生成私人 artifact；首条批准单聊可进入；有 Leg 后的新事件可通知，旧事件不回补。数据库 Authorizer 异常回滚后恢复已验证。
- Incident 工作台只对已知稳定回滚收据提示“业务未提交”。通用 5xx/响应未知保留原命令 ID 和请求体供核对重放。浏览器测试真实提交 START_REVIEW 后替换响应为代理通用 503，重放得到 `replayed=true`，数据库版本保持 2。原三个尺寸的 Incident 浏览器回归仍通过。
- 新的配置、证据格式和纯 Gate evaluator 有定向测试。evaluator 拒绝缺失源验证、旧 Gate、候选变更、缺现场/人工证据、NOOP、缺数值 ACK、UNKNOWN、未解释死信、59 分钟、休眠、缺关键指标和更换观测时钟。正向数据仅存在于标注的内存测试夹具，没有生成实际 PASS 或负责人批准文件。

## 本次执行记录

| 范围 | 结果 | 原始 TAP | SHA-256 |
|---|---|---|---|
| 提交后通用503浏览器 RED | 1 test / 0 pass / 1 fail，exit 1；失败点为错误提示业务未提交 | `tmp/p2-g2-tests-dd027ae2-4d47-4d94-b05b-2b34c903cb2c/result.tap` | `3950dff9ae6af49b90b3b39fe496c8461c21c03588c547e87b09abd552de8c85` |
| 新浏览器恢复 + 原三个尺寸 | 4/4，exit 0 | `tmp/p2-g2-tests-ef124b84-eb84-4446-899a-e3278514a357/result.tap` | `32cdf16685326993708e23e4e7bfef1dc07015a63ffe5dfc57b38d4411427e87` |
| evaluator 缺真实人工证据反例 RED | 27 tests / 24 pass / 3 fail，exit 1；新正向人工观察暴露旧“任一来源即可”的不足及两项新反例 | `tmp/p2-g2-tests-31849ebe-9f67-4ff2-8551-84aab6ec8269/result.tap` | `8a784c461572bada5446d57329f43be2474b054a67af4f69bcb77245c2601270` |
| 当前六个新测试文件联合定向 GREEN | 48/48，fail/cancelled/skipped/todo=0，exit 0 | `tmp/p2-g2-tests-d50ae462-f804-4473-87ca-a17857470df9/result.tap` | `bb44217d9409c63c8ca2335cdb914494a4eac1f90bd94618db697b8c16620d54` |

联合 GREEN 对应 `p2-g2-gate-evaluator`、`p2-g2-validation-config`、`p2-g2-evidence`、`p2-g2-direct-leg.integration`、`p2-g2-service-route-readiness.integration`、`p2-g2-command-outcome-browser` 六个根目录测试文件。独立冻结金标两例仍是 RED，**没有包含进这个绿色子集，也没有被删除/skip**。完整回归尚未运行，48 不是全仓通过数。

Runner 使用现有最小环境及独立本地测试库生命周期；浏览器在 finally 中关闭，Runtime停止，测试库由既有隔离 harness 删除。保留原始日志。本轮未更改云端停止态部署、`.env.pilot`、冻结的202条语料、P2-007实现或001–032迁移；没有真实发送、正式60分钟观察、Gate关闭、push/merge/tag。

## 继续所需裁决与剩余工作

`p2-g2-frozen-gold-audit.md` 记录两个真实数据库反例：C001源故障意图与引用标签冲突；C007当前只有待补充，Ticket/Review均为0。原提示§5.2冻结P2-007 Runtime/语料/阈值，当前补充授权只覆盖两条已知领域缺口。需要明确授权新的独立裁决表和经裁决确认的最小必要识别修复；原202条语料与历史证据保留。

仍需完成三角色G2装配/运行命令、合成完整矩阵、独立源证据读取适配、资源采集/现场运行防护、全部金标实际验证、PR #6十条不变量映射、完整577基线加新增回归、候选审查和第二个本地提交。当前 evaluator 是纯判定模块；其源验证回调要求验证底层事实与记录绑定，不能用文件哈希相等冒充事实核验。CLI适配尚未完成，不能据此启动现场。
