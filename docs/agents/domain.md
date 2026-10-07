# Domain Docs

本仓库使用单一词汇入口和一套ADR目录。逻辑上有多个业务上下文，运行与代码仍为模块化单体；本次不因这些逻辑边界创建多套词汇或事实源。

## 探索与写票前读取

- [CONTEXT.md](../../CONTEXT.md)：实际统一语言入口，等同这些技能所称的根 GLOSSARY；使用定义和Avoid约束。
- [AGENTS.md](../../AGENTS.md)、[README](../../README.md)、[架构基线](../architecture_baseline_status.md)和根目录 adr/ 中与任务相关的 Accepted ADR。
- [领域设计导航](../domain-modeling/README.md)：目标设计与当前实现的区别。
- 涉及会话身份、投影/重建、回放、通信、控制、受理编排或工单命令时，必须读 [Conversation Center 变更前置](../domain-modeling/conversation-context-reference.md)及它指向的契约文档。
- 人工工作台任务另读 [已确认实施计划](../../plans/admin-workbench-integration/README.md)、来源工作包与验收组；实际HTTP以 [接口导航](../api/README.md)及真实handler/Schema为准。

## 文档布局与权威

不新建 GLOSSARY.md、GLOSSARY-MAP.md、docs/adr/ 或每个模块的重复词汇表。新增词汇在既有 CONTEXT.md 捕捉，ADR 在根 adr/ 追加；尊重原有Accepted ADR、Schema和业务/运行边界。

词汇定义只解释概念，不包含代码位置或实现完成结论。遇到ADR与目标行为冲突，先指出并处理文档/合同，不静默覆盖。设计提案、模拟原型、任务ready-for-agent和本地测试不能升级为现有HTTP、真实送达、生产/临床或Gate批准。
