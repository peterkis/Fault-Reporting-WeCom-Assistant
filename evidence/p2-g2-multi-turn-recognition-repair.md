# P2-G2 多轮及critical受理有限修复

2026-09-08，沿用`p2-g2-gold-repair-authorization.md`的最小确定性识别修复范围，不改变原语料、迁移、阈值或Ticket/Incident状态机。另发现的跨Intake聚合能力保持停止，见`p2-g2-cross-reporter-correlation-gap.md`。

## 原始多轮与图片

新增13条同Reporter原文多轮，经真实Frame→Inbox/Intake→Worker→PostgreSQL。图片占位符适配为真实image类型的合成媒体引用，未下载、未OCR、不拼造图片内容。各回合独立持久化并在Worker前断言尚无新Decision，来源顺序保留；没有等待原offset时长，不算时间窗口或60分钟观察证明。

发现C033首句“医保审核不了”没有Ticket，以及C087自述图片有患者检查结果但Review=0。独立Spec复核确认源依据；C087的原P2-015 TICKET_ELIGIBLE/manual=false与P2-007 REQUIRES_HUMAN_REVIEW相冲突，已在独立裁决表保留原期望和裁决理由。

新增SYM-012只识别当前医保审核/审方操作不可用；否定、假设、材料政策反例保持非故障。RISK-009仅凭患者结果图片的明确文字自述进入人工安全复核，不声称读懂图片或患者身份。rule_set_version为0.1.2-g2。

C033首轮即断言Ticket=1并记录ID，恢复后仍是同一Ticket且没有自动解决/关闭。所有适用Review均通过实际HTTP读取和处理。多轮普通故障不得全部降级人工来提高分数。

76条单文本另补逐案实际Action状态、reason、Provenance元数据、safe_result hash和Inbox/Intake/Ticket/Review/Message/Outbox/Delivery/Incident差量。已完成的独立裁决表为89条；余下113条仍待逐案适配/验证。

G2图片无文字入口须单独批准`[图片]`且Reporter显式列入manifest，Bot/群仍限定；真实媒体事实原样落库，不伪造测试标签。未批准图片、未批准Reporter拒绝。正常无OCR结果为NEEDS_DESCRIPTION、Ticket0。

## Critical Action一致性

X035“急诊唯一叫号终端坏了”已有INCIDENT_REPORT和CRITICAL_REVIEW_REQUIRED，但没有细分symptom。既有Action建议包含建单，ticket_creation_recommended却为false，导致UNKNOWN Intake后续建单失败，整笔Decision/Ticket/Review回滚。已将推荐布尔值与原Action条件对齐，policy_version为1.0.2-g2。没有新增Action或改变状态机。

实际PG GREEN从UNKNOWN Intake开始，保留先入站事实，产生Ticket1、URGENT Review1、Incident/Candidate0；Review经HTTP处理成功。保留独立Reviewer修复前JSONL，不能把其exit0复现命令误称通过。

## 实际结果

| 范围 | 结果与目录 | result.tap SHA-256 |
|---|---|---|
| 单文本新增Action断言初次 | 58/77，exit1；`tmp/p2-g2-tests-eb4e8267-13a1-4c95-9b4a-c48cb1a7c0d3`。18子例是测试误把已完成的REPLAYED分类当失败；保留原日志 | `745ad9cba178b8ac61cf5f7d30f1d545dab0deab84ce60e6ba2f196d4c80ef68` |
| 按既有EXECUTED/REPLAYED完成语义修正断言 | 77/77，exit0；`tmp/p2-g2-tests-84b912fe-6045-4e81-941e-0757dc6a2046` | `bc676befab7e7a3af9c46dd0724bd2cea260911b91aabbe9b8f6b40576fe6758` |
| 多轮C033/C087修复前 | 11/14，exit1；`tmp/p2-g2-tests-d0558123-b553-436f-b5d9-a20060e583f7` | `bbaba4839d1a51cc061e7ec11defded67bdcd7dea149c2993aface9f4910349d` |
| 多轮、单文本、规则反例和图片入口联合 | 98/98，exit0；`tmp/p2-g2-tests-89def093-cac5-459c-9849-031de06dc80f` | `8f17c7ee26a40c18c381859af669f4ad7ae4a3ab885ee45afd69ab075721e342` |
| 多轮裁决文件绑定及同Ticket ID加强 | 14/14，exit0；`tmp/p2-g2-tests-09a38c4f-f30f-41fc-b78d-357868898305` | `fcfa12f17566eaa1d23cdde8c0c8de2523fee7488e5c3d7f4bb64e4840985efb` |
| X035真实PG修复前 | 0/1，exit1；`tmp/p2-g2-tests-df9e66f2-485c-49e3-b6a0-5f0f0c18152c` | `c927ad381115934e9ca33251d19276a0e8663a41956e362f1f8609688ce20756` |
| X035、识别反例、既有P2-015编排unit/PG联合 | 18/18，exit0；`tmp/p2-g2-tests-1174fb98-ab2a-413a-8bd8-7dc8d111c853` | `b52901844a3dc7b7cb5fb41fc5888def82d5b6062deecd7a7ddd0128ae23b238` |

通过批次的fail/skipped/cancelled/todo均0，参数与测试源hash在同目录run.json。所有Provider调用均为Mock或0，实际隔离库、HTTP和Worker清理断言通过。独立Spec实跑新增识别边界5/5；未冒充其独立跑98项或最终全仓回归。无真实发送、候选第二提交或Gate关闭。

## 本次停止前定向回归

全部新增G2测试，加既有P1 Intake、P2-015编排unit/PG、P2-016通知及P2-012订阅通知，合计236/236，exit0，fail/skipped/cancelled/todo均0。原始TAP：`tmp/p2-g2-tests-cd4fece0-024c-444c-bc8d-a5a8d78a0d1b/result.tap`，SHA-256 `53e7d2a9290a45f0ac34f1c1b8a72035f2b49f5b464a4322b5439f8dd7be21a8`；参数与具体测试文件清单见同目录`run.json`。这不是完整≥577基线回归，不证明尚未实现的多Reporter聚合或剩余金标已通过。

Standards对X035布尔值/Action对齐、Controller锁/关闭和实际SDK前审批复核给出限定源码PASS；未独立跑该236项。新领域聚合能力仍等待独立授权，准备状态为BLOCKED_BY_DOMAIN_GAP。
# 多渠道续项（2026-09-08，持续授权）

原 X002 的 `@故障助手` 因显示名含“故障”被当作新故障建单；X034 的“收费记录不一致”未被识别而漏受理。正常 Frame/真实隔离 PG RED：`tmp/p2-g2-tests-0110caaa-0f9a-4659-a6b4-b5846800a8dd/result.tap`，SHA256 `8ac6bc857aa34c5df5f42063f6615dac5f95291fd66ec1e88378d9e6ece246b3`，11/13、exit1。其中实际三角色/浏览器场景已通过，两失败均为原语料业务反例。

冻结最小修复：仅在群消息规则评价文本中剥离开头的显示名 mention；持久 Inbox、原消息关联和 source hash 保留原文。只 @ 不建单，有描述仍评价描述。收费/费用记录明确不一致记录 DATA.MISMATCH 并沿用既有数据风险人工复核；否定、假设、一般“费用问题”不推断数据故障。
