# 51. 规则优先受理与人工审核结果契约

> 实施进展（2026-09-03）：本契约已由 P2-015 在默认关闭的 Feature Flag 后实现；完成 Evidence 为 `evidence/p2-015-rule-first-intake-orchestration-report.md`。P2-016、P2-012、P2-G2 与生产启用仍未授权。

## 1. 决策输入

所有输入必须引用已经持久化的 Channel Message、Service Intake、Journey/Leg 上下文、可选已有 Ticket/Incident Candidate、规则/目录版本和 ARCH-005 时间/显式顺序。输出必须持久化、带 `result_hash`、可重放且同输入产生同结果；规则层只产生安全动作建议。

## 2. 一等结果矩阵

| 结果 | 输入前置条件 | 最小 Ticket | 追加目标 | 自动回复 | 人工审核 | 通知建议 | Incident Candidate | 必记 Provenance | 稳定 reason code | 失败降级 |
|---|---|---|---|---|---|---|---|---|---|---|
| `TICKET_ELIGIBLE` | 明确技术故障现象；字段可不完整 | 是，尽早；`NEW/WAITING_REQUESTER` 均可 | 当前 Journey/Intake；命中既有 Ticket 时经授权追加 | 仅固定受理/单问题建议 | 冲突或高风险时是 | 创建/待补充建议 | 仅规则候选 | source ref、规则/目录版本、症状、已知/未知字段 | `RF_TICKET_ELIGIBLE` | 动作失败保留 Intake，进人工审核；不得丢单 |
| `NEEDS_DESCRIPTION` | 只 @Bot、问候、“系统不行”、图片无可用描述 | 否 | 保留并追加 Journey/Intake | 是；一次一个高信息量问题 | 超限、冲突或高风险时是 | 澄清建议 | 否 | 消息类型、已知字段、缺失字段、问题代码 | `RF_DESCRIPTION_REQUIRED` | 提问失败进入人工队列，原事实保留 |
| `MANUAL_REVIEW_REQUIRED` | 规则歧义、冲突、临床高风险、未知安全动作 | 否，除非已有明确故障已先建最小 Ticket | 当前 Journey/Intake/已有 Ticket | 仅固定“人工处理中”建议 | 必须，100% 可达 | 排队/确认建议 | 不自动创建；可保留候选 | 冲突双方、风险规则、禁止动作、来源 | `RF_MANUAL_REVIEW_REQUIRED` | 队列写入失败则整体事务失败并可重放，绝不静默忽略 |
| `RELATED_FOLLOW_UP` | 与一个活动 Journey/Intake/Ticket 有确定关联 | 否 | 确定的已有对象 | 可确认已补充 | 关联冲突时是 | 补充已记录建议 | 可更新候选证据，不创建 Incident | continuation_ref/引用、关联规则、目标版本 | `RF_RELATED_FOLLOW_UP` | 多开放 Journey 改为人工/用户选择 |
| `STATUS_QUERY` | 用户明确查询本人已有 Ticket/Incident 状态 | 否 | 查询审计；不改 Ticket | 仅基于权威状态安全视图 | 身份或关联不明时是 | 状态回复建议 | 否 | 身份绑定、opaque ref、查询版本 | `RF_STATUS_QUERY` | 无授权时不泄露并转人工 |
| `SERVICE_REQUEST` | 账号、权限、安装、配置等 IT 服务申请 | 是，按现有 Intake/Ticket 命令 | 当前 Journey/Intake | 固定受理/补充建议 | 授权或范围不明时是 | 创建/状态建议 | 否 | 服务目录命中、请求字段、来源 | `RF_SERVICE_REQUEST` | 动作失败保留 Intake 并进入人工审核 |
| `BUSINESS_CONSULTATION` | 医院业务政策/操作指导，非技术故障 | 否 | 当前 Journey/Intake | 仅批准的固定指引或人工转接 | 政策不明或敏感时是 | 转人工建议 | 否 | 分类规则、政策边界、来源 | `RF_BUSINESS_CONSULTATION` | 不猜政策，转人工 |
| `ACKNOWLEDGEMENT` | 问候/感谢；可有活动上下文 | 否 | 有上下文则追加原 Journey；无上下文只记录 | 可礼貌回应 | 否，除非含新故障信号 | 可选礼貌回应建议 | 否 | 活动上下文判定、文本功能规则 | `RF_ACKNOWLEDGEMENT` | 回复失败不影响原 Ticket，不自动关闭 |
| `OUT_OF_SCOPE` | 天气、闲聊或明显非本 Bot 职责 | 否 | 仅当前 Journey/Intake | 固定职责说明 | 边界不确定时是 | 固定说明建议 | 否 | 越界规则、来源 | `RF_OUT_OF_SCOPE` | 不调用外部服务；不确定则人工审核 |
| `INCIDENT_REVIEW_CANDIDATE` | 多报告或明确广域故障信号满足确定性候选规则 | 明确个人故障仍保留/创建个人 Ticket | 当前 Journey/Intake/Ticket 与 Candidate | 仅个人受理状态；不宣称 Incident | 必须由 P2-012 人工确认 | 内部复核建议 | 允许 Candidate，禁止 Incident | 聚类安全字段、每个来源、规则版本、去标识 reporter count | `RF_INCIDENT_REVIEW_CANDIDATE` | 候选失败不影响个人 Ticket；转人工且不广播 |

## 3. 安全动作编排

P2-015 只允许建议和调用既有边界：`UnifiedTicketCommandPort`、`TicketActionService`、Conversation Control、Communication Service。它不得直接写 Ticket/Incident/Outbox 表，也不得调用 Sender。每次规则结果与建议必须和输入引用、版本、reason code、Provenance、执行状态一起持久化；重放不得重复建单或重复发通知。

安全下限：人工审核结果不得静默忽略；`NEEDS_DESCRIPTION` 每次只问一个高信息量问题；`ACKNOWLEDGEMENT` 不自动关闭 Ticket；`OUT_OF_SCOPE` 不调用外部天气或其他服务；任何规则不得猜测系统、根因或强行创建 Incident。

## 4. Contact Journey

- `GROUP_MENTION_INLINE`：群内描述足够时在群 Leg 内处理，回复只含群安全信息；
- `GROUP_MENTION_TO_DIRECT_GUIDED`：先保留群 Leg，再经 Communication 建议主动单聊，Direct Leg 必须用一次性/有界 `continuation_ref` 关联；
- `DIRECT_ORGANIC`：直接创建或追加 Direct Journey；不得假定关联最近群消息；
- 多个开放 Journey：返回安全摘要选择，不暴露患者、IP、其他用户或内部错误；
- 每条分段消息先持久化，再做增量归约；3–15 秒短防抖与 P1 90 秒 Intake 聚合是不同时间边界。

## 5. 概念持久化（P2-015 / migration 030 保留）

仅冻结概念，不创建 SQL：`contact_journey`、`channel_leg`、`continuation_ref`、`deterministic_decision`、`manual_review_item`、`safe_action_suggestion`。所有表必须引用既有事实 ID，不复制 Ticket 状态或责任；具体 Schema、索引、约束和回滚须在 P2-015 独立授权后确定。

## 当前授权状态（2026-09-08）

上文阶段授权描述保留其历史时点；当前 P2-007、P2-015、P2-016、P2-012 已完成。当前仅 P2-G2 / ASSEMBLY 获独立准备授权，执行到 READY_FOR_LIVE_E2E 后停止；真实发送、云主机变更、现场写库、正式观察及 Gate 批准均须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。依据 `evidence/p2-g2-start-authorization.md`；未改变本文件的领域契约或历史完成 Evidence。
