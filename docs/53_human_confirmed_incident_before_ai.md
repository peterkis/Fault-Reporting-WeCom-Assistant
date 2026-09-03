# 53. AI 之前完成的人工确认 Incident

## 1. 边界

P2-007 只产生 `INCIDENT_REVIEW_CANDIDATE`。P2-015 只持久化候选和安全动作建议。只有 P2-012 在单独授权后才可创建真实 Incident、Link、Subscription 和外部通知；模型调用必须为 0，AI 摘要、相似性解释或草稿永远不是 Incident 正确性的必要条件。

## 2. 状态机

```text
CANDIDATE
→ UNDER_REVIEW
→ CONFIRMED_LOCAL / CONFIRMED_CAMPUS / CONFIRMED_HOSPITAL_WIDE
→ INVESTIGATING
→ RESOLVED
→ CLOSED

或：REJECTED / UNLINKED
```

所有确认、拒绝、link、unlink、状态变更和订阅均需显式人工命令、Authentication、Authorization、expected version、Idempotency-Key 和追加式审计。禁止 Candidate 自动创建 Incident、自动链接或自动广播。

## 3. 身份、保留与解除

- 按 internal `person_id` 跨群/单聊渠道去重，不用原始 WeCom userid、姓名或手机号作为聚类键；
- 每个 Reporter 的 Intake 和 Ticket 保留，Incident 聚合不删除、不覆盖、不转移其事实所有权；
- 错误关联必须可 unlink，且 link/unlink 都保留审计；
- 一名用户恢复只更新其个人 Ticket/Subscription，不关闭共享 Incident；
- 每位 Reporter Subscription 独立、幂等、可审计；
- 群播报和主动单聊都必须经过 Communication Message/Outbox/Delivery。

## 4. Incident 验收矩阵

| 场景 | 预期 |
|---|---|
| Candidate 自动产生 | 允许，带规则/目录版本和安全聚类 Provenance |
| 自动创建 Incident | 0 |
| 人工确认 | Candidate → UNDER_REVIEW → 一个明确 confirmed scope |
| 错误关联 | 可 unlink；个人 Intake/Ticket 不删除 |
| 跨渠道同一上报人 | internal person 去重，Subscription 不重复 |
| 多用户共享故障 | 每人保留个人 Ticket；一人恢复不关闭共享 Incident |
| 通知 | 人工确认后按订阅经 Outbox；群与单聊目标隔离 |
| AI/Provider 不可用 | Incident 人工确认、解除、订阅和通知仍完整通过 |

## 5. P2-012 新依赖和顺序

P2-012 保留原 ID 与 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，依赖调整为 `P2-007 → P2-015 → P2-016`，并在 P2-008 之前执行。目标 Gate 改为 P2-G2。ARCH-006 不实现任何 P2-012 Runtime 或数据库结构。
