# ARCH-006 启动授权 Evidence

- Architecture Task：`ARCH-006`
- 名称：AI-Optional Rule-First Full Service Loop Rebaseline
- 授权日期：2026-09-03
- 固定起点分支：`main`
- 固定起点提交：`0a163528a94a15c5cbe6bc5e1e2063f5e0d746de`
- 固定标签：`phase-p2-007-complete-v1.5`
- 工作分支：`arch/ai-optional-rule-first-service-loop`
- 授权 Lane：`ARCHITECTURE`
- 状态：`IN_PROGRESS`

## 授权范围

本轮只授权架构、计划、任务、Gate、索引、机器状态、Validator、Architecture Test、Mermaid 图和新增 ARCH-006 Evidence 的重基线。允许定义 P2-015、P2-016，并调整尚未开始的 P2-012、P2-008 至 P2-014 与 P2-G2 至 P2-G5 的未来顺序和依赖；这些未来任务与 Gate 均不得在本轮执行。

## 冻结事实

- P1 保持 `DONE / GO`；
- P2-001 至 P2-007 保持 `DONE`；
- P2-G1 Human-only 保持 `PASSED`；
- ARCH-005 保持 `DONE`；
- `last_completed_task=P2-007`；
- `last_completed_gate=P2-G1`；
- P2-008 及以后任务、P2-G2 及以后 Gate 均未获执行授权；
- 所有已存在和本轮新增的 Feature Flag 默认值均为 `false`。

## 明确禁止

本授权不允许修改业务 Runtime、Unified Ticket Core 状态机、migration 001 至 022、任何数据库 Migration、真实 Incident、企业微信 Sender、模板卡片 Sender、Reporter Portal、DeepSeek 或其他模型接入，也不允许发送企业微信消息、启动未来任务/Gate、启用 Feature Flag、改写历史 Evidence、处理 `archive/`、push、merge、tag 或 release。

## 提交边界

本 Evidence 与把 ARCH-006 标记为唯一活动架构任务的最小治理状态构成第一提交：

```text
chore(arch): authorize ARCH-006 rule-first service loop
```

ARCH-006 的架构产物、完成 Evidence 和终态机器状态必须进入且仅进入第二提交。
