# ADR-0052：工作台服务分类与状态起始时间的只读投影

Status: **Accepted for local implementation — 用户于 2026-11-02 明确确认事实来源表与本 ADR。不是部署、现场或 Gate 批准。**

日期：2026-11-02。范围：v2.1 卡 11。核查基线：`fff6aaa2c0ae00c727746516923bc34bb5bfd2ac`。

工作台需要从已存在的报修、确定性判定和 Ticket 状态事件中展示服务类别与当前状态起点。将其作为只读投影：服务优先采用有明确服务代码的人工确认、报修人初始 Web 提交的显式代码、当前确定性服务事实；未解决冲突、未确认建议、失效来源或当前 Catalog 中禁用/不存在的代码返回 `null`。名称与大类仅由当前生效的同一 ServiceCatalog 解析。普通人工复核只确认诉求分类，复制原服务候选的 `HUMAN_OVERRIDDEN` 不升级为人工服务确认；本卡不补写缺失事实。

`stage_entered_at` 取 Unified Ticket Core 当前状态的最近一次真实进入事件，按事件版本和序号排序，使用原北京时间格式。挂起与恢复分别重置，备注及同状态责任变化不重置；无法证明或非 Ticket 事项返回 `null`。三列看板不构成第二套状态机，`updated_at` 不代替状态事件。

新增内部工作台只读 `GET /api/workbench/service-catalog`，仅向当前有效内部 Principal 返回闭合的版本、大类及启用服务代码/名称，使用 no-store；目录不可用为 503，认证/授权错误保持原 401/403。它不复用成员 Cookie/Reporter Grant 授予内部权限，不暴露责任组、别名、规则、哈希，不产生外部请求或发送。

这是独立的内部读边界，故新建 ADR，引用 [ADR-0021](0021_yixiaoxiu_self_service_contracts.md) 中已有 Web 显式选择事实，沿用 [ADR-0029](0029_admin_workbench_frontend_boundaries.md) 的服务端事实边界。代价是部分事项仍可能未分类；这比把候选当已确认事实更可靠，也避免新增写入流程和持久化结构。旧搜索解析器拒绝未知卡片字段，因此本卡只扩展 board/detail，搜索响应保持原形状。

完整事实来源、尚不存在的人工服务确认写入、已确认合同预算、兼容方式及验证要求见[卡 11 核查方案](../docs/ui/design-system-v2.1-card11-source-audit.md)。先改正式合同/Schema/API 文档，再实现只读查询。无数据库迁移、Ticket 写命令/状态机、规则引擎、责任路由或默认 Flag 变化；不授权部署、现场写库、真实发送、后续阶段或 Gate。


审查澄清：最终只读证明在同一 SQL 快照核验当前会话、角色/团队集合、规范事项 READ 及来源指纹，证明后不再异步等待。会话证明复用既有 currentSessionPredicate，不能通过重新认证刷新登录时间。等待期间来源失效使 service 为 null；技术指纹不成为业务事实或公开字段。
