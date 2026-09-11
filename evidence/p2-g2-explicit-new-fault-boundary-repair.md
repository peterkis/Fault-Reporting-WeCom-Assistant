# P2-G2 明确新故障声明的渠道边界

正常Frame反例证明两处缺口：`另外一个故障：测试诊室断网。`仍复用旧Direct Intake；即使新Intake边界已明确，Journey选择仍可能消费同人的旧群引导。

- 首个RED：`tmp/p2-g2-tests-a7c80067-760d-46cd-967d-0b148f420d25`，22项中21通过，明确新故障仍为1个Journey/Ticket而非2。TAP SHA256 `06b2603aea87ce98a562aae04b2b2b8db08ae2015796fafd5a905eee4df0d557`。
- 旧引导反例RED：`tmp/p2-g2-tests-d765f693-83ab-4333-aeba-209983a7c6d5`，23项中22通过；旧群引导与明确新Direct故障仍只有一个Journey。TAP SHA256 `ea6e790141686cf5895d9ef4d73b5fa9fec13895d1555c6f5e4085136f665416`。

修复仅识别开头明确的新故障/新报修标题与分隔符，将正文继续交给原规则/人工管线；标题不直接创建Ticket。否定、普通补充和无描述正文不被当作确定性故障。P2-G2测试标签仍在边界判定前按原批准规则移除。

首次Journey选择优先处理显式工单续接引用；没有续接引用且Intake持久事件明确为EXPLICIT_USER_NEW_TOPIC时，新建自身Journey，不消费旧引导。已有Leg重放保留原绑定。新增决定来源方法EXPLICIT_USER_NEW_TOPIC，策略版本更新为`p2-015-safe-route/1.0.9-g2`；无迁移、无阈值变更、无自动Incident确认。

本修复属于已批准的三入口/明确新故障原目标。最终GREEN、完整回归及独立审查绑定以最终readiness报告为准。
