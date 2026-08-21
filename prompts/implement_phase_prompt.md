# Agent 单任务实施 Prompt

```text
请执行任务：{{TASK_ID}}。

执行规则：
1. 先读取 plans/master_backlog.json 中该任务及所有依赖；
2. 读取对应 tickets 文档、ADR、Contract、Schema和验收场景；
3. 只实施该任务，不跨阶段；
4. 先输出实施计划和最小变更范围；
5. 编写实现和测试；
6. 运行格式化、静态检查、单元测试、Contract Test及相关集成测试；
7. 检查Secret和敏感数据；
8. 更新任务状态和CHANGELOG；
9. 如改变核心边界，停止并提出ADR，不直接实现。

完成回复必须包含：
- 修改文件；
- 实现摘要；
- 逐条验收结果；
- 执行过的命令和测试结果；
- 降级/失败路径；
- 遗留风险；
- 下一项可执行任务。

必须保持：
- persist before ack；
- provider + msg_id唯一；
- AI不在关键路径；
- Phase 1/2由Pilot Ticket Core承载工单事实；
- Phase 1不得依赖Hospital Tickets；
- Phase 3只能通过Ticket Adapter融合，切换后Hospital Tickets为唯一长期事实源；
- 状态与Outbox同事务；
- 不按“同类别+时间”自动合并。
```
