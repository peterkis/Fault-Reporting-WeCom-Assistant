# P2-007 Implementation Prompt v1.2.1 时间契约覆盖补丁

本文件必须置于原
P2-007_IMPLEMENTATION_PROMPT_v1.2.md
之前，并具有更高优先级。

前置条件：

- ARCH-005 已完成并合并；
- 标签 arch-asia-shanghai-local-time-v1.0 已验证；
- main、origin/main、该标签解引用一致；
- phase2/ai-orchestrator 已快进到 ARCH-005 后的新 main；
- 工作树干净；
- P2-007 仍未授权。

时间契约：

1. BUSINESS_TIMEZONE=Asia/Shanghai。
2. LocalDateTime 只能是：
   YYYY-MM-DD HH:mm:ss
3. LocalDateTime 禁止：
   T、Z、UTC、offset、小数秒、IANA 名称。
4. P2-007 所有 reported_at、occurred_at、observed_at、
   fetched_at、issued_at、expires_at 等业务字段必须引用
   contracts/local_datetime.schema.json。
5. 禁止使用 JSON Schema format: date-time。
6. continuation_ref、timeline action 等 expiry 必须另有
   authoritative `expires_epoch_ms` 字符串；
   本地 `expires_at` 只用于业务显示和审计。
7. 所有 BIGINT/epoch 通过 API 返回 string。
8. 禁止 Date、toISOString()、Date.parse(localDateTime)、
   new Date(localDateTime)。
9. 当前时间必须由注入 Clock 或 platform time helper 提供。
10. pg 读取时间结果保持 string。
11. 同秒顺序依靠 sequence/ordinal/稳定 tie-break。
12. P2-007 本身仍为纯函数：
    - 不访问数据库；
    - 不调用模型；
    - 不调用企业微信；
    - 不创建 Incident；
    - 不修改 Ticket。

导入 v1.2 决策包时，必须把以下文件视为“语义来源但时间格式待迁移”：

- p2_007_contact_journey.schema.json
- p2_007_continuation_ref.schema.json
- p2_007_lifecycle_audit_view.schema.json
- p2_007_reporter_profile_snapshot.schema.json
- p2_007_reporter_timeline_action.schema.json
- p2_007_decision_contracts.d.ts
- 所有包含时间的 fixture、文档和示例。

不得原样提交其中的 format: date-time。

完成后必须证明：

- P2-007 范围内 format: date-time 数量为 0；
- Z/+08:00/UTC 时间样例数量为 0；
- LocalDateTime 非法值全部失败关闭；
- expires_epoch_ms 与 expires_at 同秒一致；
- 不同进程/浏览器时区的结果一致；
- 固定语料 canonical hash 稳定；
- 全仓测试 0 fail/skip/cancel/todo。

P2-007 完成状态仍按原 Prompt 执行：

last_completed_task=P2-007
last_completed_architecture_task=ARCH-005
last_completed_gate=P2-G1
active_task=null
active_lane=null
next_task_candidate=P2-008
next_task_authorized=false
P2-G2=NOT_STARTED
all feature flags=false
