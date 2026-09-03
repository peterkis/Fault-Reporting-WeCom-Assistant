# ADR-0015：Incident Candidate 与人工确认边界

- 状态：`ACCEPTED_FOR_P2_007_DESIGN`
- 日期：2026-09-03
- 真正 Incident 所属任务：P2-012

## 背景

历史群聊存在短时间内大量用户同时报告登录失败、系统卡死、断网、患者列表消失和病人等待的事件风暴，但也存在：

- 同一系统不同问题；
- 同一用户跨渠道重复报告；
- 单终端先恢复、其他终端仍失败；
- 用户把猜测当根因；
- 仅一个关键终端故障但临床风险很高。

## 决策

P2-007 只能产生 `IncidentCandidate` 和相关性解释，不能创建 Incident、自动并单、自动关联 Ticket 或对外广播。

所有升级均要求人工确认：

```text
NONE
→ CANDIDATE
→ UNDER_REVIEW
  ├── CONFIRMED_LOCAL
  ├── CONFIRMED_BUILDING
  ├── CONFIRMED_CAMPUS
  ├── CONFIRMED_HOSPITAL_WIDE
  ├── REJECTED
  └── EXPIRED
```

确认后的真实 Incident 状态、IncidentReport、ReporterSubscription、link/unlink 与公共通知由 P2-012 实现。

## 初始人工复核触发阈值

阈值只触发人工审核，不触发自动升级：

|候选|初始复核条件|
|---|---|
|局部|5 分钟内至少 3 名不同上报人，服务与症状兼容|
|跨科室|5 分钟内至少 5 名不同上报人，至少 2 个科室|
|全院|5 分钟内至少 8 名不同上报人，至少 3 个科室或 2 栋楼|
|监控候选|权威监控确认核心公共服务异常，可不受人数下限限制，但仍须人工确认|

阈值必须版本化，并在真实 Bot 试点后重新校准。

## 去重与证据

- reporter 以 `person_id` 去重；群聊、私聊和重复消息只算一名上报人。
- 原始 Intake/Ticket 永远保留。
- 一名用户确认恢复，不关闭共享 Incident Candidate。
- 患者 ID、姓名、原始 IP 和完整正文不得进入聚类签名。

## 权限建议

- HANDLER：建议关联、补证据；
- DISPATCHER：确认局部/跨科室；
- ADMIN / INCIDENT_MANAGER：确认任意范围并解除错误关联。
