# P2-G2 新发现的 Direct Session 关联缺口

后续：负责人已独立授权本方案，见`p2-g2-direct-session-repair-authorization.md`；实际修复及复核记录见`p2-g2-direct-session-repair.md`。以下保留发现时的RED和停止决定。

Preparation gate: `BLOCKED_BY_DOMAIN_GAP`；Gate生命周期仍为IN_PROGRESS。已授权的识别修复、Direct Leg和其他准备工作保留。本记录不改历史202语料，也不代表当前已修复。

## 已完成的数据库复现

`tests/p2-g2-direct-session-boundary.integration.test.mjs` 使用真实Frame、原Inbox/Intake、P2-016 Worker及隔离PostgreSQL；仅该测试Assembly的消息接收时钟可控，宿主机/PostgreSQL时钟不改。不seed Ticket、Journey或成功Decision，不执行Provider发送。

| 来源/输入 | 期望 | 实际 |
|---|---|---|
| D12-030：主动单聊“打印不了”，120秒后“补充：仍然打印不了”；未结束、未声明新问题 | 2 Message、1 Journey、1 Ticket、同一Direct Session | 2 Message、2 Journey、2 Ticket；同一Thread内产生2个Session，原Session已被后一个替代 |
| D12-031：首条“打印不了”，1秒后“另外门诊系统也登录不了” | 独立新故障，2 Journey、2 Ticket | 1 Journey、1 Ticket，第二问题进入原报修 |
| 原有明确分界对照：首条“打印不了”，1秒后“另一个问题，处方提交不了” | 2 Journey、2 Ticket、2个历史Session且仅1个活跃 | 实际符合，对照PASS |

最终3 tests / 1 pass / 2 fail，exit1：`tmp/p2-g2-tests-9183eb6a-e664-478c-97e6-3f160f2f1767/result.tap`，SHA-256 `2ac276de98cbcc86aa2512489094749867aa6b11db7fff20b0b1b46449d3e79a`。

首次测试错误地要求新故障后同时有两个活跃Session；实际契约是保留两个历史Session、同一Thread只有一个活跃Session。已独立纠正该测试断言，对照转绿；前两项真实失败仍在。首轮原始TAP保留于 `tmp/p2-g2-tests-60139c42-dd3b-4930-934b-32dbb5f6dca0/result.tap`，不把测试假设错误当作业务缺口。

## 契约与最小修复范围

原提示G2-E05、D12-030/031要求活动Direct Session不以P1 90秒碎片窗口强制切新问题，明确新故障必须独立。当前 `createServiceIntakeProcessor` 仅以同provider/bot/chat/reporter和90秒窗口查旧Intake；`NEW_REPORT_PATTERN` 仅包含“新报修/另一个问题/重新报修”。后续Journey/Session无法无损纠正已落错的聚合分界。

最小修复需在入站持久化的既有事务内，依据同身份、同Bot、未过期且活动的Direct Session/既有绑定选择原Intake；明确新故障则跳过续接。必须保留不跨人、不跨Bot、不猜多个候选、不恢复过期/结束会话的条件，复用现有Intake追加与Ticket命令，不新增权威表或双写。单纯把90秒改成长时间不是正确修复。

这涉及P1 Intake与P2 Direct Session的关联/分界语义，超出此前仅针对P2-007文本识别和既有人工降级的补充授权。原提示§5.2要求涉及新的领域行为时先保留复现和最小方案；因此尚未改这些关联行为。其他独立Gate准备可继续，完整候选不能先标READY。
