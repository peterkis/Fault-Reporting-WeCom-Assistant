# P2-002 独立启动授权 Evidence

- 授权日期：2026-08-30
- 授权角色：项目负责人
- 授权任务：仅 `P2-002`（持久化 Timeline Projector 与可重建投影）
- 执行 Lane：`P2-A`
- 基线提交：`a30dced5fc62fa62ace1ebe1b86cd765f9f73310`
- 基线标签：`phase-p2-001-complete-v1.4`
- 状态：`AUTHORIZED / IN_PROGRESS`

## 授权原文

> 项目负责人正式、独立授权启动 P2-002。完成 P2-002 后必须停止。
> P2-003 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。

## 授权范围

本次只允许实现持久化、幂等、可重建的 Conversation Timeline 投影，包括安全的
Timeline Source Record Contract、当前 P1 事实源只读 Mapper、Conversation Item、
Source Binding、Projection Checkpoint、Projector Worker、显式 Rebuild、受限迁移入口、
测试、文档和脱敏 Evidence。

## 明确停止线

- `P2-003` 至 `P2-014` 继续为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`；
- `P2-G1` 未授权且不得启动；
- 所有 P2/P3 Feature Flag 继续为 `false`；
- 不新增企业微信真实入站或出站路径，不监听真实企业微信；
- 不接入 DeepSeek 或任何模型，不启用 AI；
- 不接入医院身份、医院内网或任何 P3 Source；
- 不实现 SSE、Realtime Event Log、Workbench、Communication Outbox、Handoff、Assignment 或 Read Cursor；
- 不等同于生产上线、临床上线、Conversation Center 启用或 P2-G1 通过；
- 不推送、合并、打标签或发布远端。

## 长期事实所有权

Unified Ticket Core 继续是唯一长期 Ticket 编号、状态、责任和事件事实源。Channel
Message、Ticket Event 与 Delivery 保持各自权威；Conversation Item 只是可以删除和
重建的读模型，Source Binding 与 Checkpoint 均不拥有上游事实。
