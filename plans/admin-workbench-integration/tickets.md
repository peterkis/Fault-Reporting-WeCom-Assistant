---
document_id: WBINT-GITHUB-TICKETS
publication_status: COMPLETE
execution_status: IN_PROGRESS
tracker: GITHUB_ISSUES
snapshot_on: 2026-10-14
timezone: Asia/Shanghai
issue_count: 43
native_blocking_edges: 76
---

# 人工工作台 GitHub 任务清单

43票已发布为 **#56–#98**，76条原生阻塞关系已核对，每票带 `ready-for-agent`；发布时快照全部开放且未领取，业务实现尚未开始。GitHub是逐票状态和阻塞关系的事实源，本文保留发布快照；执行前重新读取正文、评论、领取人和依赖。

2026-10-07 用户随后授权 implement-spec 完成全部43票，详见[实施记录](execution.md)。首次T01核查时43票均OPEN、76边与发布记录一致；该发布快照保留在机器可读记录中。2026-10-08父任务实时核对后，T01／T02／T03／T04／T05／T11／T14／T16／T23已集成并在GitHub关闭，共9／43票。以下勾选仅表示已核实的Issue关闭状态，不表示发布、部署或整个工作包验收；其他票仍以执行前的GitHub状态为准。

发布时frontier只有 [T01 / #56：确认接入基线与共同合同](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)。其实际完成和GitHub收口核验后，再从当前无阻塞票中领取；票号顺序是依赖先于依赖者的编号，不要求所有分支排成一条链。

2026-10-09当前已核实关闭12／43票：T01／T02／T03／T04／T05／T06／T11／T14／T16／T17／T23／T38。T06派单与显式转派已验收、集成并[GitHub收口](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61#issuecomment-6083677579)；历史零字节浏览器profile保留为清理例外，详情见[七项证据与关闭方式](execution/t06.md)。

2026-10-10恢复核查：GitHub已关闭13／43票，剩余30票OPEN；在上述12票之外，T27公共故障候选已按原七项验收、合入本地集成分支并[收口](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/82#issuecomment-6088472390)，见[原对象与分组证据](execution/t27.md)。T28的原生blocker #82已CLOSED；下一串行验证窗口为T22。A09整组仍未完成。

2026-10-10最新恢复核查：GitHub已关闭14／43票，剩余29票OPEN；T22集中会话原七项已完成父独立核对、合入本地集成并[收口](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/77#issuecomment-6089929089)，见[实际对象、原报告与关闭方式](execution/t22.md)。WBINT-07／A07本地完成；T35的原生blockers #69／#77均已关闭。下一串行验证窗口为T08；其它已准备源码不计验收。

2026-10-10 T08收口后实际快照：已关闭15／43票，剩余28票OPEN。T08撤销未开始派工的原七项经父独立核对，交付`697bfd6f014fc174eecd951c484eff98babbaa90`已安全快进到本地集成分支，[#63完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/63#issuecomment-6093445782)，见[合同、原被测对象与分组证据](execution/t08.md)。T09的#58／#63已关闭；下一串行验证为T20。T15／T18／T19／T20／T28／T34／T35以及T10／T39源码已准备，尚未验收；WBINT-02／A02整组仍待T07／T09／T10。

2026-10-10 T20收口后实际快照：已关闭16／43票，剩余27票OPEN。T20完整原七项与原始分组证据经父独立核对，交付`722f1d0a5b82d0455fc9cf2939bc8e70207e97ad`已安全快进；[#75完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75#issuecomment-6098167571)，见[合同、被测祖先与关闭方式](execution/t20.md)。原被测`0f9af956…`保持原制品，文档后继guard1如实记录，1142输入／1332原输出字节核对相同。T21／T37依赖现已满足，须先核对领取；T09合入最新源码准备，T24／T18下一原首验证仍未完成，WBINT-06／A06仍待T21。

2026-10-11 T24 本地整票验收完成：原七项及真实被测祖先证据已核对，源码 `18d8aa71f91a156397348232b28c6a122fb8e464` 安全快进；见[轮次通知合同、原始证据与关闭方式](execution/t24.md)。[#79已完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/79#issuecomment-6102767418)，实际17／43 CLOSED、26 OPEN；本地交付不代表发布或真实外发。T25／T26 和 WBINT-08／A08 整组继续按原生依赖推进。上文快照保留各自历史日期。

2026-10-11 T18 整票收口：七项本地验收、两轴增量审查和资源释放已核对，c6e2ba27 安全快进；[#73 已关闭并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73#issuecomment-6105209273)，实际 **19／43 CLOSED、24 OPEN**。见[当前 API、真实被测祖先与历史失败](execution/t18.md)。文档后继的严格制品身份拒绝原样保留，不将后继冒称已被测试。T25 依赖已满足，WBINT-05／A05 仍待 T19。

2026-10-11 T21 整票收口：原七项与各真实被测对象已父核，ba55a23f安全快进；[#76完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76#issuecomment-6106118749)，当前 **20／43 CLOSED、23 OPEN**，WBINT-06／A06本地完成。见[合同、原始失败与保全](execution/t21.md)。后续T35／T26／T25等继续按原生依赖和单一运行窗口推进；SOURCE_READY不计整票验收。

2026-10-11 T35 整票收口：原七项、逐被测祖先结果、两轴修补及保全／清理后继已父核，e7ebc2e8安全快进；[#90完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90#issuecomment-6108623843)，当前 **21／43 CLOSED、22 OPEN**。见[当前合同、历史失败与真实记录](execution/t35.md)。T26接续整票，T36的原生#90已关闭；WBINT-12／A12仍待T34／T36，默认关闭与现场停止线保持。

2026-10-11 T26 整票收口：原七项、8f7fb416同制品40／40、适用工具18／18、两轴修补、完整保全及人工tmp清空实际读回均父核，308b9a9d安全快进；[#81完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81#issuecomment-6109979192)，当前 **22／43 CLOSED、21 OPEN**。见[合同、原失败与真实被测祖先](execution/t26.md)。WBINT-08／A08仍待T25，其原生#66／#73已关闭；默认关闭，真实强@、客户端送达与现场授权保持独立。

2026-10-12 T25 整票收口：原七项、334ab203业务28／28、ef62c657定向工具18+1、两轴增量审查、4411保全及813原窗口字节、人工清理与有限最终资源审计均父核，8e34df31安全快进；[#80完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80#issuecomment-6115603975)，当前 **23／43 CLOSED、20 OPEN**。见[原应用通知合同、真实被测对象与原失败](execution/t25.md)。WBINT-08／A08本地完成；下一串行整票为T28，#82已关闭，SOURCE_ONLY准备不计验收，默认关闭与现场停止线保持。

2026-10-12 T28 整票收口：原七项、cb5c8484的35／35及相关19／19、必要tooling／hosts54项和具名retired-T02、两轴源码收口、200原始输出及8回执、16冻结输入与精确自有清理均父核；8095d05a安全快进，[#83完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83#issuecomment-6118553402)。当前 **24／43 CLOSED、19 OPEN**，见[合同与实际被测祖先](execution/t28.md)。扩大batches诊断69／64／5和15／13／2均exit1，FAIL保留；活动155项全集未跑。WBINT-09／A09本地完成，下一连续整票为T07；T29／T30已解除#83阻塞，但尚未实施。T29目标必须已有该Incident读取权、交接不扩权的用户决定独立记录，不改写旧确认事实。全43最终审查／工作树清理仍待完成，默认关闭与现场停止线保持。

2026-10-12 T07 整票收口：原七项、3454ed05的严格0／0／0、本票33／33及受影响浏览器13／13、工具54／54含具名retired、两轴修补和最终字节／自有清理均父核；c5898b85安全快进，[#62完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62#issuecomment-6123961995)。当前 **25／43 CLOSED、18 OPEN**，见[实际被测祖先及历史失败](execution/t07.md)。WBINT-02／A02仍待T09／T10；下一连续整票T09，T12／T13已解除#62依赖，SOURCE准备不计验收。默认关闭，全43最终审查及工作树清理继续待完成。

2026-10-12 T09 整票收口：原七项、c638e931严格0／0／0与当前同制品23 PASS、两轴修补收口、54原件和143raw／9PNG／10诊断保全、精确自有清理均父核；a58bd2bf保留真实被测祖先安全快进，[#64完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/64#issuecomment-6126429394)。当前 **26／43 CLOSED、17 OPEN**，见[合同、原始失败及逐项结论](execution/t09.md)。原selected UI两FAIL和五RED未重标；未变工具原54PASS按同blob复用。WBINT-02／A02仍待T10，其原生阻塞仅#58／#59且已关闭；T12／T13与T29／T30的SOURCE准备不计验收。默认关闭，全43最终审查及工作树清理继续待完成。

2026-10-13 T10整票收口：原七项、真实69d5619e同制品严格0／0／0与41 PASS、适用工具外层20 PASS／native0、独立两轴及最终文档复核、3193项归档和精确自有停止均父核；70ceb31d安全快进，[#65完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/65#issuecomment-6131558408)。当前 **27／43 CLOSED、16 OPEN**，见[执行记录](execution/t10.md)。原业务失败、汇总器FAIL、observer错误及5d逐原SHA恢复限制保留。WBINT-02／A02所属T02、T04–T10八票均本地交付、原生CLOSED/completed；此前逐票“A02仍未完成”记载为当次历史，当前来源工作包本地完成。下一连续整票T12；其它SOURCE准备不计验收，默认关闭，全43最终审查与工作树清理继续待完成。

2026-10-13 T12 原七项经父独立核对，82729c90由独立合并代理安全快进，[#67完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/67#issuecomment-6137509105)。d279本票21入口／36 PASS及关联前六入口21 PASS保留原被测身份；c9受影响10 PASS与build／strict／artifact原生0／0／0、适用工具20 PASS及独立retired1 PASS已核对，111／113扫描失败、118缺依赖setup FAIL与全部旧RED／NOT_RUN保持。最终纯文档两轴无新增问题、归档原件和精确自有停机已核验。当前 **28／43 CLOSED、15 OPEN**，见[逐项执行记录](execution/t12.md)。WBINT-03／A03已完成T11／T12切片，仍待T13；下一连续整票T13，其唯一原生阻塞#62已完成，#67仅为运行排程前序。默认关闭，全43最终审查和工作树清理继续待完成。

2026-10-13 T13 原七项已父验收，69afe5c1由独立合并代理安全快进，[#68完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/68#issuecomment-6140905877)。真实被测c6ec52保留040严格／build／artifact原生0、042本票17 PASS、相关五文件71项经两窗口通过和044工具外层27 PASS；原043超时FAIL、045字节比较误判及启动观察器整体exit1均保留。两轴源码及最终文档无未解决行动项，原件与精确自有清理已核。当前 **29／43 CLOSED、14 OPEN**，见[接单与交接链执行记录](execution/t13.md)。WBINT-03／A03所属T11–T13均本地交付；下一连续整票T30／#85，其唯一原生#83已完成。默认关闭，全43最终审查和工作树清理仍待。

2026-10-13 T30 原七项经父验收，13872854由独立合并代理安全快进，[#85完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/85#issuecomment-6144089454)。真实被测b44cdc保留039严格／build／artifact原生0及040单轮9文件14 PASS；029相关12 PASS仍属61f1，不改绑。两轴源码修补和最终四MD复核收口，1495源码／1921制品、冻结原件及精确自有清理均核实，原FAIL／NOT_REACHED／CONNECT UNKNOWN保留。当前 **30／43 CLOSED、13 OPEN**，见[内部处置与原命令恢复记录](execution/t30.md)。WBINT-10／A10已完成T30，T29／T31仍待；#86唯一原生#85已completed，下一连续整票T31按独立人工安全摘要、预览确认、仅定向有效未暂停个人的既定规则推进。默认关闭，全43最终审查与工作树清理继续待完成。

2026-10-14 T31 原七项已父验收，dd270af3由独立合并代理安全快进，[#86完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/86#issuecomment-6149728080)。实际功能被测84093163的严格／一次build／artifact及目的403／真实401、原三例恢复已核对；各窗口保留原对象与范围，全部旧FAIL、044清理UNKNOWN／NOT_REACHED保持。源码及文档两轴、3478件保存文件和精确自有清理收口，详见[本票记录](execution/t31.md)。当前 **31／43 CLOSED、12 OPEN**；WBINT-10／A10已完成T30／T31，仍待T29。下一连续整票T32／#87，fresh原生#80／#81／#86均CLOSED/completed，已领取；T33仍待#87。默认关闭，全43最终审查与工作树清理继续待完成。

2026-10-14 T32 原七项已父验收，b2cfff8b由独立代理安全快进，[#87完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/87#issuecomment-6153988160)。功能3f51／MF7e360的040严格／build／artifact原生0、042正式浏览器2PASS和052两个冻结API首例2PASS已核；Incident022按完整未变查询复用，各窗口不合计full。25＋8路径及三MD两轴、3929原保存与7050新增源／制品、134原保护对象及精确自有停机收口，见[执行与历史限制](execution/t32.md)。原失败、物化差异和证据类型边界保留，未重绑文档后继。当前 **32／43 CLOSED、11 OPEN**；WBINT-11／A11已交付T32，T33原生依赖已解除但普通Incident重试角色仍待人类选择。下一连续整票T29／#84，唯一#83已completed，目标已有精确Incident读取权、交接不扩权。默认关闭，全43最终审查及工作树清理继续待完成。

2026-10-14 T29 原七项已父验收，d5f6abc8由独立代理唯一安全快进，[#84完成并读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/84#issuecomment-6156993035)。[Incident已有读取权交接、当前授权与原操作恢复](execution/t29.md)已接入；有效人员／团队和精确Incident读取权同事务核验，责任本身不扩权，个人Ticket状态与通知事实独立。实际功能28230562／MF14719保持029严格／一次build／artifact原生0、030本票13 PASS、031相关16 PASS和032适用工具21 PASS，各窗口不合称full。40路径／18提交的源码与终稿两轴、完整归档／冻结原件和精确自有清理已收口，原RED／FAIL／NOT_REACHED及启动观察器outer1保留。当前 **33／43 CLOSED、10 OPEN**；WBINT-10／A10所属T29／T30／T31均已本地交付。下一连续整票T34／#89，fresh唯一#60已completed；T33普通Incident重试角色仍待人类决定。默认关闭，全43最终审查与工作树清理继续待完成，现场及Gate停止线保持。

## 导航与配置

- [GitHub任务列表](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues?q=is%3Aissue%20label%3Aready-for-agent%20WBINT)
- [完整实施计划](README.md)／[页面与接口映射](capability-map.md)／[工作包详情](implementation-plan.md)／[验收矩阵](acceptance-matrix.md)
- [GitHub跟踪器规则](../../docs/agents/issue-tracker.md)／[标签词汇](../../docs/agents/triage-labels.md)／[领域文档读取规则](../../docs/agents/domain.md)
- [批准的拆分与逐票正文](ticket-breakdown-proposal.md)／[setup配置记录](agent-skills-setup-proposal.md)
- [机器可读发布记录](github-ticket-publication.json)：实际Issue/数据库id、来源映射、逐票原生blockers、标签和正文核对；保留只读连接中断及恢复记录。

原WBINT-00–16保留为业务工作包和验收来源；拆分后的精确启动条件以各Issue原生依赖为准，不将整包中的独立事项硬设为阻塞。规划／发布时没有commit/push；本轮输入已纳入本地集成516b4dce…，来源群仍未部署／启用。其他checkout执行前读取[执行基线](execution-baseline.md)，不从远端缺文件推导重复开发。

## 按依赖顺序领取

- [x] **T01** — [#56 确认接入基线与共同合同](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)
  - **Blocked by:** 无
  - **来源：** WBINT-00 / A00
  - **本地执行：** LOCAL_VERIFIED（文档），见[共同基线与证据](execution.md)；已集成、关票。

- [x] **T02** — [#57 从事项详情执行可靠的内部备注](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **Blocked by:** [#56](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)
  - **来源：** WBINT-01 / A01；WBINT-02 / A02

- [x] **T03** — [#58 恢复当前浏览器中的24小时草稿](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **Blocked by:** [#57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **来源：** WBINT-01 / A01
  - **本地状态：** [LOCAL_VERIFIED／固定候选与七项证据](execution/t03.md)；已集成、关票，原制品与实际被测祖先保留，未发布／启用。

- [x] **T04** — [#59 一键承接并开始处理无会话工单](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **Blocked by:** [#57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **来源：** WBINT-02 / A02
  - **本地执行：** [LOCAL_VERIFIED：原子承接、轮次、整合验证与清理](execution/t04.md)；已集成、关票，未发布／启用；A02整组仍未完成。

- [x] **T05** — [#60 一键同时承接工单与关联沟通](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)
  - **Blocked by:** [#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **来源：** WBINT-02 / A02

- [x] **T06** — [#61 将工单派给同事或显式转派](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)
  - **Blocked by:** [#60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)
  - **来源：** WBINT-02 / A02
  - **本地执行：** [LOCAL_VERIFIED：派单／转派、明确沟通原子交接、轮次、草稿与七项证据](execution/t06.md)已集成、关票。历史零字节profile清理受自动审批拒绝，已保全并如实记录。

- [x] **T07** — [#62 接管获权可见的跨团队工单](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)
  - **Blocked by:** [#61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)
  - **来源：** WBINT-02 / A02
  - **本地执行：** [原七项LOCAL_VERIFIED、原子本人接管／沟通／开始及真实被测祖先](execution/t07.md)已父核、c5898b85集成并关票；历史失败保留，无新增SQL。A02仍待T10，未发布／启用。

- [x] **T08** — [#63 撤销尚未开始的派工](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/63)
  - **Blocked by:** [#61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)
  - **来源：** WBINT-02 / A02
  - **本地执行：** [LOCAL_VERIFIED：默认保留沟通、显式原子交接、有界当前责任段、原UUID核对与七项证据](execution/t08.md)已集成、关票；本票32、直接兼容106和原工具27通过，原失败与采集更正保留。默认关闭、未发布／启用；A02仍未完成。

- [x] **T09** — [#64 停止处理并退回待安排](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/64)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)、[#63](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/63)
  - **来源：** WBINT-02 / A02
  - **本地执行：** [原七项LOCAL_VERIFIED、停止退回及显式原子交接](execution/t09.md)已父核、a58bd2bf集成并关票；真实tested c638祖先、原FAIL／NOT_REACHED及54冻结原件保留。默认关闭，A02仍待T10，未发布／启用。

- [x] **T10** — [#65 执行等待、恢复和合法取消](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/65)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)、[#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **来源：** WBINT-02 / A02
  - **本地执行：** [原七项LOCAL_VERIFIED、等待／恢复／独立合法取消](execution/t10.md)已父核，70ceb31d安全快进并[关票读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/65#issuecomment-6131558408)，真实tested69祖先与历史失败保留；41 PASS及工具外层20 PASS，原汇总器FAIL单独解释。WBINT-02／A02本地完成，默认关闭、未发布／启用。

- [x] **T11** — [#66 工作人员记录内外结果并完工关闭](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)、[#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)
  - **来源：** WBINT-03 / A03
  - **本地执行：** [LOCAL_VERIFIED：七项验收、独立摘要、原子关闭与恢复承诺](execution/t11.md)已整票集成并[关票](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66#issuecomment-6051952458)，未发布／启用；T12／T13及A03整组另行验收。

- [x] **T12** — [#67 同事接管并完工关闭](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/67)
  - **Blocked by:** [#62](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)、[#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **来源：** WBINT-03 / A03
  - **本地执行：** [LOCAL_VERIFIED：七项验收、原子接管关闭与原操作恢复](execution/t12.md)已集成并[关票](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/67#issuecomment-6137509105)，原RED／被测身份／自有清理保持；未发布／启用。当次收口时T13与A03整组仍待，当前A03已随T13完成。

- [x] **T13** — [#68 查看完整接单与交接链](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/68)
  - **Blocked by:** [#62](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/62)
  - **来源：** WBINT-03 / A03
  - **本地执行：** [原七项LOCAL_VERIFIED及真实被测证据](execution/t13.md)已父核、69afe5c1集成并[关票读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/68#issuecomment-6140905877)；原失败、当前权限与精确自有清理保持。A03本地完成，默认关闭、未发布／启用。

- [x] **T14** — [#69 在同一事项中阅读并处置人工复核](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-04 / A04
  - **本地执行：** [LOCAL_VERIFIED：七项验收、真实业务34与工具19、原制品和资源清理](execution/t14.md)；已集成、关票，未发布／启用；T15及A04整组仍未完成。

- [ ] **T15** — [#70 确认明确故障并立即开始处理](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/70)
  - **Blocked by:** [#60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)、[#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)
  - **来源：** WBINT-04 / A04
  - **本地执行：** 2026-10-09 实读完整正文／评论／标签及原生依赖，两项 blocker 已 CLOSED；领取给 peterkis，独立分支准备明确故障的原子确认并开始。当前未验证、未集成，A04 整组未完成。

- [x] **T16** — [#71 安全查看已有报修附件](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/71)
  - **Blocked by:** [#56](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56)
  - **来源：** WBINT-04 / A04
  - **本地执行：** [LOCAL_VERIFIED：真实附件、逐项验收及资源清理](execution/t16.md)；已集成、关票，未发布／启用；A04整组仍未完成。

- [x] **T17** — [#72 手工代录电话或现场报修](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)
  - **Blocked by:** [#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)
  - **来源：** WBINT-05 / A05
  - **本地执行：** [七项验收、当前合同与分阶段证据](execution/t17.md)已核对；交付1828b60安全快进，[收口评论](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72#issuecomment-6077295469)及CLOSED已读回。默认关闭、未发布／启用；T18／T19及A05整组未完成。

- [x] **T18** — [#73 选择经核实成员并代录](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)
  - **Blocked by:** [#72](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)
  - **来源：** WBINT-05 / A05
  - **本地执行：** [七项本地验收、当前 API 与证据](execution/t18.md)已完成，c6e2ba27 保留真实 95a 被测祖先并安全快进；[#73 关闭读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73#issuecomment-6105209273)。默认关闭，未发布／启用。
  - **领取记录（历史）：** 2026-10-09已实读完整正文／空评论／ready标签及原生blocker #72 CLOSED，领取给peterkis；当时仅准备候选合同。

- [ ] **T19** — [#74 代录后由本人立即处理](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/74)
  - **Blocked by:** [#59](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/59)、[#72](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/72)
  - **来源：** WBINT-05 / A05
  - **执行：** 2026-10-09已实读完整正文／空评论／ready标签及原生blockers #59／#72 CLOSED，领取给peterkis；独立准备同事务受理与本人开始合同，运行与整票验收尚未完成。

- [x] **T20** — [#75 Web原报修人反馈仍未解决](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)
  - **执行：** [原七项、当前REST与分组证据](execution/t20.md)已由父核对；交付722f1d0a安全快进，[完成评论与CLOSED](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75#issuecomment-6098167571)已读回。原被测0f9及全部FAIL／NOT_REACHED保留，默认关闭、未发布／启用；T21与A06整组未完成。
  - **Blocked by:** [#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **来源：** WBINT-06 / A06

- [x] **T21** — [#76 Bot原报修人反馈仍未解决](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76)
  - **Blocked by:** [#75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)
  - **来源：** WBINT-06 / A06
  - **本地执行：** [原七项、真实被测祖先与分组证据](execution/t21.md)已父核并安全快进ba55a23f，[GitHub收口已读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/76#issuecomment-6106118749)，WBINT-06／A06本地完成；默认关闭、未发布／启用。

- [x] **T22** — [#77 集中查看会话并人工回复](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/77)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-07 / A07
  - **本地执行：** [原七项、本地隔离验证与资源释放](execution/t22.md)已由父核对；交付882e384c安全快进，GitHub CLOSED已读回。真实被测06f3c880保持原manifest和证据身份；默认关闭、未发布／启用。

- [x] **T23** — [#78 检索并维护来源群显示名称](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/78)
  - **Blocked by:** [#57](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/57)
  - **来源：** WBINT-00 / A00；WBINT-15 / A15
  - **本地执行：** [LOCAL_VERIFIED：当前候选、逐项验收、RED／GREEN与资源清理](execution/t23.md)；已集成、关票，未发布／启用。

- [x] **T24** — [#79 按Bot来源可靠通知原报修人](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/79)
  - **本地执行：** [LOCAL_VERIFIED：原七项、正式详情、意图恢复、默认关闭与独立证据](execution/t24.md)，未发布／启用；GitHub 关票读回见[实施记录](execution.md)。
  - **Blocked by:** [#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)
  - **来源：** WBINT-08 / A08
  - **领取记录（历史）：** 父读取当前正文／评论／依赖后领取给peterkis，#66已CLOSED；当时为独立实施准备，当前验收以本票执行记录为准。

- [x] **T25** — [#80 通知H5与已核实代录报修人](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80)
  - **Blocked by:** [#66](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/66)、[#73](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)
  - **来源：** WBINT-08 / A08

- [x] **T26** — [#81 群来源强@与Bot私聊独立投递](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81)
  - **Blocked by:** [#79](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/79)
  - **来源：** WBINT-08 / A08

- [x] **T27** — [#82 人工复核并确认公共故障候选](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/82)
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-09 / A09
  - **本地执行：** [LOCAL_VERIFIED：原七项、独立Incident、材料与命令恢复、分组证据及清理](execution/t27.md)已核对；交付aac2d438已安全快进，GitHub CLOSED已读回。真实被测源6607ace4及早先分组各保留原身份，未发布／启用；T28现已独立收口，A09本地完成。

- [x] **T28** — [#83 跟进公共故障及关联个人报修](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83)
  - **Blocked by:** [#82](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/82)
  - **来源：** WBINT-09 / A09
  - **本地执行：** [LOCAL_VERIFIED：原七项与独立事实、精确版本、输入／UNKNOWN恢复、源审及清理](execution/t28.md)经父核；8095d05a已安全快进，GitHub CLOSED已读回。cb5c实际35／35及相关19／19、必要工具按适用范围记录，扩大batches FAIL和活动全集NOT_RUN保持。WBINT-09／A09本地完成，不推进现场或Gate。

- [x] **T29** — [#84 交接公共故障负责人](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/84)
  - **Blocked by:** [#83](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83)
  - **来源：** WBINT-10 / A10
  - **本地执行：** [原七项LOCAL_VERIFIED、当前调用者／目标读取权、并发与草稿／UNKNOWN恢复证据](execution/t29.md)已父核；d5f6abc8由独立代理唯一快进，[#84完成读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/84#issuecomment-6156993035)。功能28230562与原MF不改绑，历史失败、资源清理和证据限制保留；WBINT-10／A10本地完成，默认关闭、未发布／启用。

- [x] **T30** — [#85 记录公共故障内部处置](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/85)
  - **Blocked by:** [#83](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/83)
  - **来源：** WBINT-10 / A10

- [x] **T31** — [#86 显式发布公共故障安全进展](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/86)
  - **Blocked by:** [#85](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/85)
  - **来源：** WBINT-10 / A10

- [x] **T32** — [#87 查看获权通知异常队列](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/87)
  - **Blocked by:** [#80](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80)、[#81](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/81)、[#86](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/86)
  - **来源：** WBINT-11 / A11

- [ ] **T33** — [#88 受控重试或核对通知结果](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/88)
  - **Blocked by:** [#87](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/87)
  - **来源：** WBINT-11 / A11

- [ ] **T34** — [#89 明确关注并查看与我有关](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/89)
  - **执行：** 2026-10-09 已核对完整正文／空评论／ready标签与原生blocker #60 CLOSED，领取给peterkis；独立准备明确关注与获权责任并集合同，尚未验证。
  - **Blocked by:** [#60](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/60)
  - **来源：** WBINT-12 / A12

- [x] **T35** — [#90 实际阅读后推进个人已读](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)
  - **当前本地执行：** [原七项LOCAL_VERIFIED](execution/t35.md)已父核、e7ebc2e8安全快进并GitHub关闭；实际来源／会话、本人可见正文、单调位置、规范映射、授权与UNKNOWN恢复证据及原失败保留。保全工作字节和全部自有清理已核对；A12仍待T34／T36。
  - **历史准备：** 2026-10-10 实读完整正文／空评论／ready标签及原无assignee，原生blockers #69／#77均CLOSED后领取给peterkis；独立工作树已冻结跨来源个人位置合同与原真实HTTP／production浏览器tracer，8个自有文件及原副本逐SHA核对。SOURCE_READY／NOT_BUILT_NOT_RUN；等待串行窗口，不计A12验收。
  - **Blocked by:** [#69](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/69)、[#77](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/77)
  - **来源：** WBINT-12 / A12

- [ ] **T36** — [#91 明确处置报修补充待跟进](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/91)
  - **Blocked by:** [#90](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)
  - **来源：** WBINT-12 / A12

- [x] **T37** — [#92 维护工单共享跟进时间](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/92)
  - **本地执行：** 2026-10-11 原七项完成，a2cfce93 保留真实被测 7ec7b3ec 祖先并安全快进；最终相关 23/23、两轴无剩余问题，[证据与历史失败](execution/t37.md)、[关闭读回](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/92#issuecomment-6104234195)。当前总计18／43 CLOSED、25 OPEN；默认关闭，WBINT-12／A12 仍待 T34／T35／T36。
  - **Blocked by:** [#61](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/61)、[#75](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/75)
  - **来源：** WBINT-12 / A12

- [x] **T38** — [#93 通过SSE更新真实工作台事实](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93)
  - **执行：** 2026-10-09 CLOSED；七项证据、真实被测祖先与分层结果见[实施记录](execution/t38.md)及[收口评论](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/93#issuecomment-6073463450)。本地集成，尚未发布。
  - **Blocked by:** [#58](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/58)
  - **来源：** WBINT-13 / A13

- [ ] **T39** — [#94 提示当前查看与编辑活动](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/94)
  - **执行：** 2026-10-09 已核对完整正文／空评论／ready标签及原生blocker #93 CLOSED，领取给peterkis；准备基于当前integration的独立实施，尚未验证。
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
