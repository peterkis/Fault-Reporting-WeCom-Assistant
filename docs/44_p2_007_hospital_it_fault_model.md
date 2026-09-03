# P2-007 医院 IT 故障领域模型：v1.2 决策基线

## 1. 目标

P2-007 不只是故障关键词分类，而是建立可解释、可追溯的医院 IT 对话事实底座：

```text
入口与来源
→ Contact Journey / Channel Leg
→ 上报人身份与组织快照
→ 分段消息归约
→ 服务、模块、操作、症状、范围和地点
→ 临床影响、敏感性和根因状态
→ Fact Provenance / 冲突
→ Incident Candidate
→ 通知建议
```

## 2. 历史语料支持的事实

四份门诊工作联系群导出记录声明共 7311 条消息，时间覆盖 2025-08-01 至 2026-08-31。语料反复呈现：

- 图片先发，文字、IP、地点、尝试动作和影响后补；
- 同一问题被拆成多条消息；
- “系统、工作站、报告、审核、卡”等词高度歧义；
- 大故障时多名用户在数分钟内同时上报；
- 个别终端恢复与其他终端仍失败可以同时存在；
- 群内混有业务咨询、药品政策、后勤问题和 IT 故障。

这些记录来自传统人工识别群聊，不包含真实 Bot 私聊历史。因此群转私聊、continuation_ref 和模板卡片测试均属于“基于语料习惯与产品设计的合成场景”，不得伪称真实 Bot 证据。

## 3. 三种入口

|入口|来源|说明|
|---|---|---|
|`GROUP_MENTION_INLINE`|群聊|@Bot 后直接描述故障|
|`GROUP_MENTION_TO_DIRECT_GUIDED`|群聊|@Bot 后由 Bot 主动单聊引导|
|`DIRECT_ORGANIC`|单聊|用户以后直接单聊 Bot 报修|

`origin_channel` 不可变；`current_channel` 可随着 Journey 转入单聊。

## 4. 多轴故障结构

```text
request_nature
turn_function
service_domain / service / module
operation / transaction_stage
symptom / affected_object
scope / occurrence_location / asset
clinical_context / operational_priority / clinical_safety_risk
attempts / status / recurrence
root_cause_state
sensitivity
facts[] with provenance
incident_candidate
notification_recommendations
```

`UNKNOWN / NOT_APPLICABLE / CONFLICTED / REDACTED` 是一等状态。根因必须区分 `UNKNOWN / SUSPECTED / CONFIRMED / DISPROVED`。

## 5. 用户分段描述

每条消息先持久化，再增量归约；短防抖建议 3–15 秒。P1 的 90 秒 Intake 聚合窗口与 Direct Session 生命周期不是同一概念，不能仅因超过 90 秒就认定为新故障。

描述充分度：

```text
EMPTY
PARTIAL
SUFFICIENT_FOR_INTAKE
SUFFICIENT_FOR_ROUTING
SENSITIVE_MOVE_TO_PRIVATE
CONFLICTED
```

Bot 每次只问一个信息量高的问题，并明确告知用户可以分多条消息发送。

## 6. 明确报修尽早建单

当“技术故障意图”已经明确，即使地点或范围未知，也应先由 Unified Ticket Core 创建最小 Ticket，并进入 `WAITING_USER`。规则层不拥有 Ticket 状态，也不直接执行创建。

## 7. 责任边界

P2-007：目录、别名、规则、字段、来源、冲突、候选和推荐。

P2-008：DeepSeek Provider、安全出域和严格 Schema。

P2-012：真实 Incident、ReporterSubscription、人工确认、link/unlink 和公共通知。

现有 P2-004：Communication/Outbox/Delivery。

现有 P2-005：Assignment/Handoff/Read Cursor/Generation Fence。

现有 P2-006：内部坐席 Workbench；不是临床上报人 Timeline 门户。
