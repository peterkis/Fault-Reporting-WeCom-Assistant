---
document_id: WBINT-GITHUB-TICKETS
publication_status: COMPLETE
execution_status: IN_PROGRESS
tracker: GITHUB_ISSUES
snapshot_on: 2026-10-07
timezone: Asia/Shanghai
issue_count: 43
native_blocking_edges: 76
---

# 人工工作台 GitHub 任务清单

43票已发布为 **#56–#98**，76条原生阻塞关系已核对，每票带 `ready-for-agent`；发布时快照全部开放且未领取，业务实现尚未开始。GitHub是逐票状态和阻塞关系的事实源，本文保留发布快照；执行前重新读取正文、评论、领取人和依赖。

2026-10-07 用户随后授权 implement-spec 完成全部43票，详见[实施记录](execution.md)。T01本地文档共同基线为LOCAL_VERIFIED，GitHub仍OPEN，由父任务集成核验后统一收口；本地完成不自行解除原生blockers。T01本次复查43票均OPEN、均有ready-for-agent，76边与发布记录一致，#56由peterkis领取且无blocker。以下未勾选表示未关闭Issue，不覆盖本地执行记录。

发布时frontier只有 [T01 / #56：确认接入基线与共同合同](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)。其实际完成和GitHub收口核验后，再从当前无阻塞票中领取；票号顺序是依赖先于依赖者的编号，不要求所有分支排成一条链。

## 导航与配置

- [GitHub任务列表](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues?q=is%3Aissue%20label%3Aready-for-agent%20WBINT)
- [完整实施计划](README.md)／[页面与接口映射](capability-map.md)／[工作包详情](implementation-plan.md)／[验收矩阵](acceptance-matrix.md)
- [GitHub跟踪器规则](../../docs/agents/issue-tracker.md)／[标签词汇](../../docs/agents/triage-labels.md)／[领域文档读取规则](../../docs/agents/domain.md)
- [批准的拆分与逐票正文](ticket-breakdown-proposal.md)／[setup配置记录](agent-skills-setup-proposal.md)
- [机器可读发布记录](github-ticket-publication.json)：实际Issue/数据库id、来源映射、逐票原生blockers、标签和正文核对；保留只读连接中断及恢复记录。

原WBINT-00–16保留为业务工作包和验收来源；拆分后的精确启动条件以各Issue原生依赖为准，不将整包中的独立事项硬设为阻塞。规划／发布时没有commit/push；本轮输入已纳入本地集成516b4dce…，来源群仍未部署／启用。其他checkout执行前读取[执行基线](execution-baseline.md)，不从远端缺文件推导重复开发。

## 按依赖顺序领取

- [ ] **T01** — [#56 确认接入基线与共同合同](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)
  - **Blocked by:** 无
  - **来源：** WBINT-00 / A00
  - **本地执行：** LOCAL_VERIFIED（文档），见[共同基线与证据](execution.md)；Issue收口待父任务集成核验。

- [ ] **T02** — [#57 从事项详情执行可靠的内部备注](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **Blocked by:** [#56](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)
  - **来源：** WBINT-01 / A01；WBINT-02 / A02

- [ ] **T03** — [#58 恢复当前浏览器中的24小时草稿](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **Blocked by:** [#57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **来源：** WBINT-01 / A01

- [ ] **T04** — [#59 一键承接并开始处理无会话工单](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **Blocked by:** [#57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **来源：** WBINT-02 / A02

- [ ] **T05** — [#60 一键同时承接工单与关联沟通](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)
  - **Blocked by:** [#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **来源：** WBINT-02 / A02

- [ ] **T06** — [#61 将工单派给同事或显式转派](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)
  - **Blocked by:** [#60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)
  - **来源：** WBINT-02 / A02

- [ ] **T07** — [#62 接管获权可见的跨团队工单](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)
  - **Blocked by:** [#61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)
  - **来源：** WBINT-02 / A02

- [ ] **T08** — [#63 撤销尚未开始的派工](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/63)
  - **Blocked by:** [#61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)
  - **来源：** WBINT-02 / A02

- [ ] **T09** — [#64 停止处理并退回待安排](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/64)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)、[#63](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/63)
  - **来源：** WBINT-02 / A02

- [ ] **T10** — [#65 执行等待、恢复和合法取消](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/65)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)、[#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **来源：** WBINT-02 / A02

- [ ] **T11** — [#66 工作人员记录内外结果并完工关闭](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)、[#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **来源：** WBINT-03 / A03

- [ ] **T12** — [#67 同事接管并完工关闭](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/67)
  - **Blocked by:** [#62](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)、[#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **来源：** WBINT-03 / A03

- [ ] **T13** — [#68 查看完整接单与交接链](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/68)
  - **Blocked by:** [#62](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)
  - **来源：** WBINT-03 / A03

- [ ] **T14** — [#69 在同一事项中阅读并处置人工复核](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-04 / A04

- [ ] **T15** — [#70 确认明确故障并立即开始处理](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/70)
  - **Blocked by:** [#60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)、[#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)
  - **来源：** WBINT-04 / A04

- [ ] **T16** — [#71 安全查看已有报修附件](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/71)
  - **Blocked by:** [#56](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)
  - **来源：** WBINT-04 / A04

- [ ] **T17** — [#72 手工代录电话或现场报修](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)
  - **Blocked by:** [#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)
  - **来源：** WBINT-05 / A05

- [ ] **T18** — [#73 选择经核实成员并代录](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)
  - **Blocked by:** [#72](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)
  - **来源：** WBINT-05 / A05

- [ ] **T19** — [#74 代录后由本人立即处理](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/74)
  - **Blocked by:** [#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)、[#72](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)
  - **来源：** WBINT-05 / A05

- [ ] **T20** — [#75 Web原报修人反馈仍未解决](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)
  - **Blocked by:** [#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **来源：** WBINT-06 / A06

- [ ] **T21** — [#76 Bot原报修人反馈仍未解决](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76)
  - **Blocked by:** [#75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)
  - **来源：** WBINT-06 / A06

- [ ] **T22** — [#77 集中查看会话并人工回复](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/77)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-07 / A07

- [ ] **T23** — [#78 检索并维护来源群显示名称](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/78)
  - **Blocked by:** [#57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **来源：** WBINT-00 / A00；WBINT-15 / A15
  - **本地执行：** [LOCAL_VERIFIED：当前候选、逐项验收、RED／GREEN与资源清理](execution/t23.md)；待父任务核验／集成／关票，未发布／启用。

- [ ] **T24** — [#79 按Bot来源可靠通知原报修人](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/79)
  - **Blocked by:** [#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **来源：** WBINT-08 / A08

- [ ] **T25** — [#80 通知H5与已核实代录报修人](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80)
  - **Blocked by:** [#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)、[#73](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)
  - **来源：** WBINT-08 / A08

- [ ] **T26** — [#81 群来源强@与Bot私聊独立投递](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81)
  - **Blocked by:** [#79](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/79)
  - **来源：** WBINT-08 / A08

- [ ] **T27** — [#82 人工复核并确认公共故障候选](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/82)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-09 / A09

- [ ] **T28** — [#83 跟进公共故障及关联个人报修](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83)
  - **Blocked by:** [#82](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/82)
  - **来源：** WBINT-09 / A09

- [ ] **T29** — [#84 交接公共故障负责人](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/84)
  - **Blocked by:** [#83](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83)
  - **来源：** WBINT-10 / A10

- [ ] **T30** — [#85 记录公共故障内部处置](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/85)
  - **Blocked by:** [#83](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83)
  - **来源：** WBINT-10 / A10

- [ ] **T31** — [#86 显式发布公共故障安全进展](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/86)
  - **Blocked by:** [#85](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/85)
  - **来源：** WBINT-10 / A10

- [ ] **T32** — [#87 查看获权通知异常队列](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/87)
  - **Blocked by:** [#80](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80)、[#81](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81)、[#86](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/86)
  - **来源：** WBINT-11 / A11

- [ ] **T33** — [#88 受控重试或核对通知结果](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/88)
  - **Blocked by:** [#87](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/87)
  - **来源：** WBINT-11 / A11

- [ ] **T34** — [#89 明确关注并查看与我有关](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/89)
  - **Blocked by:** [#60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)
  - **来源：** WBINT-12 / A12

- [ ] **T35** — [#90 实际阅读后推进个人已读](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)
  - **Blocked by:** [#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)、[#77](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/77)
  - **来源：** WBINT-12 / A12

- [ ] **T36** — [#91 明确处置报修补充待跟进](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/91)
  - **Blocked by:** [#90](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)
  - **来源：** WBINT-12 / A12

- [ ] **T37** — [#92 维护工单共享跟进时间](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/92)
  - **Blocked by:** [#61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)、[#75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)
  - **来源：** WBINT-12 / A12

- [ ] **T38** — [#93 通过SSE更新真实工作台事实](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-13 / A13

- [ ] **T39** — [#94 提示当前查看与编辑活动](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/94)
  - **Blocked by:** [#93](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93)
  - **来源：** WBINT-13 / A13

- [ ] **T40** — [#95 提供站内提醒、声音与个人偏好](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/95)
  - **Blocked by:** [#89](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/89)、[#90](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)、[#92](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/92)、[#93](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93)
  - **来源：** WBINT-13 / A13；WBINT-15 / A15

- [ ] **T41** — [#96 检索全部获权事项与组合筛选](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/96)
  - **Blocked by:** [#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)、[#73](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)、[#89](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/89)、[#91](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/91)、[#92](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/92)
  - **来源：** WBINT-14 / A14

- [ ] **T42** — [#97 用合法拖动执行真实业务动作](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/97)
  - **Blocked by:** [#62](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)、[#70](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/70)、[#75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)、[#93](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93)
  - **来源：** WBINT-15 / A15

- [ ] **T43** — [#98 完成完整人工工作台隔离验收与交接](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/98)
  - **Blocked by:** [#64](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/64)、[#65](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/65)、[#67](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/67)、[#68](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/68)、[#71](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/71)、[#74](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/74)、[#76](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76)、[#78](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/78)、[#84](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/84)、[#88](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/88)、[#94](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/94)、[#95](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/95)、[#96](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/96)、[#97](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/97)
  - **来源：** WBINT-16 / A16

## 原工作包与票号映射

一票可以引用多项原计划，来源关系不自动增加阻塞边；整包状态只作汇总，不建立第二份逐票状态表。

| 原工作包／验收组 | 对应GitHub票 |
| --- | --- |
| WBINT-00 / A00 | [T01 / #56](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)、[T23 / #78](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/78) |
| WBINT-01 / A01 | [T02 / #57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)、[T03 / #58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58) |
| WBINT-02 / A02 | [T02 / #57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)、[T04 / #59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)、[T05 / #60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)、[T06 / #61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)、[T07 / #62](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)、[T08 / #63](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/63)、[T09 / #64](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/64)、[T10 / #65](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/65) |
| WBINT-03 / A03 | [T11 / #66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)、[T12 / #67](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/67)、[T13 / #68](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/68) |
| WBINT-04 / A04 | [T14 / #69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)、[T15 / #70](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/70)、[T16 / #71](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/71) |
| WBINT-05 / A05 | [T17 / #72](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)、[T18 / #73](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)、[T19 / #74](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/74) |
| WBINT-06 / A06 | [T20 / #75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)、[T21 / #76](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76) |
| WBINT-07 / A07 | [T22 / #77](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/77) |
| WBINT-08 / A08 | [T24 / #79](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/79)、[T25 / #80](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80)、[T26 / #81](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81) |
| WBINT-09 / A09 | [T27 / #82](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/82)、[T28 / #83](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83) |
| WBINT-10 / A10 | [T29 / #84](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/84)、[T30 / #85](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/85)、[T31 / #86](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/86) |
| WBINT-11 / A11 | [T32 / #87](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/87)、[T33 / #88](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/88) |
| WBINT-12 / A12 | [T34 / #89](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/89)、[T35 / #90](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)、[T36 / #91](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/91)、[T37 / #92](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/92) |
| WBINT-13 / A13 | [T38 / #93](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93)、[T39 / #94](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/94)、[T40 / #95](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/95) |
| WBINT-14 / A14 | [T41 / #96](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/96) |
| WBINT-15 / A15 | [T23 / #78](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/78)、[T40 / #95](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/95)、[T42 / #97](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/97) |
| WBINT-16 / A16 | [T43 / #98](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/98) |

## 领取与收口

1. 读取GitHub当前Issue全文/评论和配置，确认实际对象、可写范围及未提交差异。
2. 只有未关闭、未领取、ready-for-agent且所有blockers完成的票才能启动。关闭原因不是完成、或缺少所需合同/证据的依赖，不可当作前置能力已可用。
3. 按每票Acceptance criteria完成窄业务链，输入/输出Schema、必要DB、权限/隐私、资源、默认关闭、测试、Evidence和关闭方式一起收口。变更接口同步统一API文档。
4. 实际执行、领取和关闭回写GitHub，工作包仅按完整交付汇总；本地勾选或PR存在不代替完成证据。
5. 发布本清单本身不启动业务工作；本轮追加implement-spec授权与本地集成范围见[实施记录](execution.md)。真实依赖/发送、真实库迁移、部署、full/certify、发布合并或Gate推进保持独立授权；原停止线、历史证据和持久Feature Flag默认false保持。

## 发布核验

43个Issue正文与批准稿一致，43个ready-for-agent标签存在，76条原生阻塞边与批准DAG一致，未使用正文fallback。最后复查曾在读取#87时发生EOF，已从该处只读续查完成，原错误记录保留；没有因此重新创建Issue或重发变更。发布进程与续查进程均已结束。
