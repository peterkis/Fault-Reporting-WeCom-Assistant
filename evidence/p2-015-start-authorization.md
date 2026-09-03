# P2-015 启动授权 Evidence

- Task：`P2-015`
- 名称：规则优先受理编排、跨渠道接触旅程与人工审核
- 授权日期：2026-09-03（Asia/Shanghai LocalDate）
- 固定起点分支：`phase2/p2-015-rule-first-intake`
- 固定起点提交：`55a99e768643423a2bfaf5190266ee46b39e6090`
- 固定标签：`arch-006-ai-optional-rule-first-service-loop-v1.0`
- 授权 Lane：`P2-C`
- 状态：`AUTHORIZED`

## 授权范围

本轮只授权 P2-015：把已完成且冻结的 P2-007 纯函数规则引擎装配到已持久化 Channel Message 与 P1 Service Intake 之后，建立持久 Contact Journey、独立 Channel Leg、安全一次性 continuation_ref、十类确定性 Decision、Fact Provenance、安全动作建议、一等 Manual Review 队列和 PostgreSQL 驱动的单 Worker。允许通过既有安全 Port 创建最小 Ticket 和固定 text/markdown Communication 事实；模型调用必须为 0。

## 固定前置事实

- `P1 / P1-012 / DONE / GO`；
- P2-001 至 P2-007 `DONE`；
- P2-G1 `PASSED`；
- ARCH-005、ARCH-006 `DONE`；
- `last_completed_task=P2-007`、`last_completed_gate=P2-G1`、`last_completed_architecture_task=ARCH-006`；
- `HEAD=main=origin/main=ARCH-006 tag=55a99e768643423a2bfaf5190266ee46b39e6090`；
- 工作树洁净，ahead/behind=`0 0`。

## 不变量

- P1 Channel Message 和 Service Intake 必须先独立提交，P2-015 失败不得回滚源事实；
- P2-015 后置扫描、可重放、从 PostgreSQL 恢复，不以内存队列作为正确性来源；
- 不直接写 `pilot_ticket.ticket` 或 `communication.*`，不复制 Ticket Core、Conversation Assignment 或 Sender；
- 不修改 migration 001 至 022、P2-007 Runtime/fixture/完成 Evidence、P2-G1/ARCH-005/ARCH-006 历史 Evidence；
- 所有 Feature Flag 默认值保持 `false`。

## 明确禁止

本授权不启动 P2-016、P2-012、P2-G2、P2-008 或 P3；不接入 DeepSeek、任何 AI Provider、OCR、真实企业微信目录、真实 Sender、模板卡片、Reporter Portal、完整 Ticket Workbench 或真实 Incident；不执行真实企业微信现场测试；不 push、merge、tag、PR、release。

## 提交边界

本 Evidence 与把 P2-015 标记为唯一活动任务、Lane `P2-C` 的治理状态构成第一提交：

```text
chore(p2): authorize P2-015 rule-first intake orchestration
```

第一提交不包含 `src/`、`database/`、`contracts/`、`scripts/p2-015*` 或 `tests/p2-015*`。P2-015 实现、测试、完成 Evidence 和终态机器状态必须进入且仅进入第二提交。
