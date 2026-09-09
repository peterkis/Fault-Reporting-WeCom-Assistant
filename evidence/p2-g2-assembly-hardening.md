# P2-G2 有限装配修复记录

## Direct Leg：修复前实际反例与范围

在原生Inbox/Intake、真实隔离PostgreSQL、实际HTTP与既有P2-012只读PERSON Authorizer下，Worker群澄清和App人工审核REQUEST_DESCRIPTION各生成1个GROUP与1个PERSON Delivery，虽然尚无Direct Leg。两项新增测试均RED（2/2失败，exit1）；原始记录：`tmp/p2-g2-tests-51e36979-5551-43ba-86ef-c754f206336a/result.tap`，SHA-256 `1b524f66fa2b8d846eac362b915f09fee5bcb4bd5b5524fc8eb0b5784a475abf`。

按原Prompt§8.2/8.3，修改仅涉及P2-016 Worker适配器、Runtime参数贯通、ManualReview固定澄清分支、既有P2-012 Worker参数注入及对应测试。复用createP2012PersonDestinationAuthorizer，不复制Direct Leg SQL。群提示改为要求先打开机器人单聊并发送消息，不声称已经私聊。

兼容性：Authorizer参数缺省null时保留旧未注入装配行为；本Gate装配必须显式注入并由配置检查拒绝遗漏。P2-012 App已有Authorizer，现贯通至ManualReview；Worker同一Authorizer供Ticket通知与固定澄清使用。没有Direct Leg时新群引导不生成PERSON三件套；已有历史Delivery不删除、不补发。Sender继续在发送前独立验证。首条批准的Direct入站仍先持久化并建立Leg，不以前置Leg阻止入站。

两条领域修复另见 `p2-g2-domain-repair-authorization.md`；历史RED、云端停止态部署和旧任务完成证据不改写。后续实际GREEN、错误恢复及完整回归分别归集，不以本文件的设计说明代替执行证据。

2026-09-08 后续定向GREEN及通用503浏览器修复见 `p2-g2-repair-progress.md`。新的冻结金标裁决阻塞与原两条领域缺口分别记账；当前没有READY或完整回归结论。
