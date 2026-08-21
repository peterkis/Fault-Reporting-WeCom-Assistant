# Source Notes

## 1. 用户原始资料

文件：

```text
企业微信智能机器人方案.docx
```

原文作为 V0.8/管理介绍草稿保留，不应被当作最终开发冻结版。

原始资料直接支持：

- 报修群约 800 名临床成员；
- 响应无感知、无留痕、状态黑盒和服务印象问题；
- 10 秒内确认、工单号、状态推送和月报目标；
- 纯 CPU；
- 企业微信机器人、工单、小程序/管理端、LLM/OCR；
- 用户角色和 F01—F19 功能清单。

## 2. 修订说明

本包不是对原文的机械拆分，而是结合后续技术讨论形成的 V1.1：

- WebSocket 主通道；
- Service Intake；
- 复用现有 Tickets；
- AI 异步；
- Outbox；
- Incident；
- 多申报人订阅；
- 群内/单聊通知分工；
- 数据最小化和患者信息保护；
- 分阶段 Agent 任务。

对照见 `docs/17_source_traceability.md`。

## 3. 外部技术资料

官方企业微信 Node.js SDK：

```text
https://github.com/WecomTeam/aibot-node-sdk
```

读取日期：2026-08-20。

本包只把官方资料用于连接和协议能力基线。所有实际能力必须在医院真实租户 Gate 0 验证。

## 4. 项目上下文资料

以下来自用户在项目讨论中提供的医院情况：

- 已有企业微信机器人和权限；
- 已有 Tickets/Hub/SSO/API 平台；
- PostgreSQL、Redis、MinIO；
- Next.js/Node.js 技术体系；
- 多院区；
- 1—2 人开发运维；
- 患者信息不出院；
- 无 GPU。

实施前由项目负责人对这些现状再次确认。
