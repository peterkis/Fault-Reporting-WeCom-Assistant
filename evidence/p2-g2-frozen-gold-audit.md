# P2-G2 冻结金标核对：新增的验收基线问题

本次已授权的状态查询/业务咨询人工降级和Direct Leg修复已经通过各自GREEN；本文件记录继续准备时新发现的问题，不回写旧P2-007/P2-015完成结论。

## 已完成的实际复现

使用冻结原文、正常Frame → Inbox/Intake → 当前Worker → 隔离PostgreSQL，没有替换规则输出或seed业务事实。`tests/p2-g2-frozen-gold.integration.test.mjs` 两例均RED，exit1：

| Source ID | 冻结源用例 | P2-015引用金标 | 实际持久化结果 | 问题 |
|---|---|---|---|---|
| P2-007-C001 | “老师，门诊系统打不开了，麻烦看一下。”；源domain_intent=INCIDENT_REPORT | SERVICE_REQUEST | TICKET_ELIGIBLE；INCIDENT Intake；Ticket=1 | 源用例的故障意图、docs51契约与引用标签不一致；不能为了匹配引用把故障改成服务申请 |
| P2-007-C007 | “开药走到最后一直转。”；源domain_intent=INCIDENT_REPORT | TICKET_ELIGIBLE，ticket_expected=true | NEEDS_DESCRIPTION；UNKNOWN/WAITING_DESCRIPTION；Ticket=0，Review=0 | 当前识别结果未满足冻结金标；需要独立裁决是否属于必须补齐的故障识别 |

两例均只有一个REPORTER文本回合，不存在多轮角色筛选或缺少图片文件造成的复现歧义。Provider调用为0。原始TAP：`tmp/p2-g2-tests-49180b1a-3b95-44e4-8b77-3c1576b81314/result.tap`，SHA-256 `fea468514ed6befd0a31e9beb332a4b2f4a3fb6dd484a073929704791336364d`。测试使用既有严格隔离库清理和HTTP停止流程。

## 不能沿用的旧指标解释

旧 `scripts/validate-p2-015-rule-first-intake.mjs` 的coverage计算是“expected_result_code是否属于合法枚举”的比例，没有读取源文本并执行规则。因此其100%只证明引用集合的枚举合法性，不能当作当前Gate的实际安全路由覆盖率。

已对202个引用做文本探测，但其中包括无直接文本的机制用例、多轮/渠道/前置事实用例；探测没有完整组装这些前置事实。探测结果仅用于定位核对项，**不是202例正式准确率、漏报率或Gate覆盖率**。原始诊断在本run的 `gold-text-probe.json`，未以它产生PASS。

## 继续所需的具体处理范围

1. 保留原202条引用、原始语料和历史Evidence。依据docs51和源材料逐案建立新的G2裁决表，记录原期望、前置事实、冲突、独立理由和可接受人工结果；不从当前实现反推标签。
2. 将标签冲突、测试适配缺失、真实识别缺口分开；无文本的机制用例通过其实际接口验证，不能随意删除来提高比例。
3. 对经裁决确认的漏受理，只做必要的确定性规则/词典或既有安全降级修复；不引入AI，不扩大服务范围。保留反例和完整回归。

原Prompt§5.2明确冻结“P2-007 Runtime/冻结语料/阈值”，而本次补充只授权两条已知领域缺口。故这里不自动改变P2-007规则，也不改金标、降低90%或把NEEDS_DESCRIPTION无条件算成已建单。若需修改被冻结的P2-007范围，必须取得进一步明确授权；其余独立Gate准备可继续，但不能先标READY。
