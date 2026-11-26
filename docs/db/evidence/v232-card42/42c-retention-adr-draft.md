# Card 42C-2 数据留存决策与干跑清理器

- **留存决策。** Peter 于 2026-11-25 决定永久保留生产工单及全部关联数据行，不删除、不匿名化。未建单的业务数据行目前也原样保留。当前没有具体的生产合规要求。三个备选方案的取舍和原有八项问题的结论见 [ADR-0060（Accepted）](../../../../adr/0060_data_retention_and_cleanup_policy.md)。
- **H5 媒体文件例外。** 既有 H5 Worker 启用时继续清理到期的原件、播放副本和缩略图，包括已绑定到工单的文件。上传记录的 `expires_epoch_ms` 初始为预留时间加 24 小时，绑定时改为传入的留存截止时间与绑定、提交、受理三条记录留存截止时间中的最早值。数据库物理时间达到或超过该值且 `purged_epoch_ms` 为空时，文件进入清理范围。Worker 删盘后在上传记录写入清理时间，工单及全部关联数据行继续保留。[媒体清理实现](../../../../app/server/src/yxx-h5-media.mts)
- **清理器骨架实现**：
  - 核心骨架：[retention-cleanup-skeleton.mts](../../../../app/server/src/retention-cleanup-skeleton.mts)
  - 干跑检查 CLI：[retention-cleanup-check.mts](../../../../app/server/scripts/retention-cleanup-check.mts)
  - 为后续干跑报告保留到期扫描索引。[077 扫描索引迁移](../../../../database/migrations/077_retention_and_time_contract.sql)
- **当前运行状态与安全边界**：
  - 清理器**默认禁用且未注册**：`createRetentionCleanupWorker` 为进程内 `runOnce` / 单飞 / `close` 骨架（无定时器、未在 `human-workbench-role.mts` / `p2-016-process-role.mts` / `p2-016-runtime.mts` 注册、无持久化开关）；
  - **只读候选计数。** 扫描目标来自内置冻结的 11 表目录，SQL 按表别名 `r` 的原生列过滤与排序。传入连接池时，每批在只读事务内扫描最多 1,000 行。`--apply` 和可执行策略插件均返回既有错误码 `RETENTION_CLEANUP_POLICY_UNDECIDED`。默认报告标识 `ADR_0060_UNDECIDED` 同样沿用原名。
  - 今后如需扩大删除范围或引入匿名化，须另立 ADR 并单独建任务。
- **扫描范围（共 11 张持有 `retention_until*` 的表）**：
  - `channel.message_inbox`、`intake.service_intake`、`operations.backup_checkpoint`、`conversation.item`、`communication.message`、`intake.contact_journey`、`incident.incident`、`intake.web_submission`、`intake.web_request_binding`、`intake.web_report_urge`、`intake.web_report_evaluation`。
