# Phase 1：企业微信外网试点

- 当前状态：`IN_PROGRESS`；仅 P1-001“建立 Pilot 工程骨架与配置校验”已启动。模板预检和本地测试已通过，真实 `.env.pilot` 预检尚未执行；真实试点运行、WeCom Adapter、持久化和 Pilot Ticket Core 均尚未开始。

## 阶段目标

在不依赖医院内网系统的前提下，以 Pilot Ticket Core 完成可靠受理、处理闭环、通知和临床试点验证。

## 固定架构

```text
Enterprise WeCom
→ WeCom Gateway
→ Channel Message
→ Service Intake
→ Pilot Ticket Core
```

## 进入条件

- G0-008 完成；
- 企业微信能力矩阵和锁定 SDK 版本可用；
- 公网试点环境、安全边界、测试群和责任人已确认。

## 禁止依赖

- Hospital Tickets；
- 医院 SSO/人员接口；
- 医院 Hub/灵动岛；
- 院内 Outbox/Relay；
- Phase 2 AI/OCR 才能完成建单的设计。

## 任务总览

| ID | 标题 | 依赖 | 状态 |
|---|---|---|---|
| P1-001 | 建立 Pilot 工程骨架与配置校验 | G0-008 | IN_PROGRESS |
| P1-002 | WeCom SDK Adapter 与标准消息契约 | P1-001 | TODO |
| P1-003 | Channel Message Inbox 与数据库幂等 | P1-002 | TODO |
| P1-004 | Service Intake 创建与消息聚合 | P1-003 | TODO |
| P1-005 | Pilot Ticket Core 模型与编号 | P1-004 | TODO |
| P1-006 | Pilot Ticket 状态机、Action 与事件 | P1-005 | TODO |
| P1-007 | Notification Outbox 与 Delivery | P1-006 | TODO |
| P1-008 | 首次确认与可靠回执 | P1-007 | TODO |
| P1-009 | 最小处理端与 Pilot 权限 | P1-006 | TODO |
| P1-010 | 补充、解决确认、关闭与重开 | P1-008, P1-009 | TODO |
| P1-011 | Pilot 安全、可观测性与运维基线 | P1-007 | TODO |
| P1-012 | Phase 1 E2E、故障演练与试点 Go/No-Go | P1-010, P1-011 | TODO |

## 退出条件

- 明确报修漏单为 0；
- 同一消息重复建单为 0；
- 创建、接单、处理、待补充、解决、关闭和重开闭环通过；
- 状态、事件和通知一致；
- 依赖故障有可验证降级；
- 公网试点安全与运行验收通过；
- 形成 Phase 1 试点评审结论。
