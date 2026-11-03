# Agent 文档导航

根 [AGENTS.md](../../AGENTS.md) 只保留跨任务边界和触发指针。本目录按实际任务读取，不要求每次加载所有文件。

当前从[人工首版范围](../../plans/mvp-release-simplification/README.md)和[风险驱动验证](validation.md)进入；历史执行过程只在具体交接/认证/证据问题触发时读取。[ADR-0053](../../adr/0053_mvp_delivery_and_test_policy.md) 是本次前向默认规则。

| 任务 | 入口 | 主要内容 |
| --- | --- | --- |
| 领域探索、写票、接口变更 | [domain.md](domain.md) | CONTEXT、Accepted ADR、Conversation Center 前置、工作台/API 导航 |
| Issue 发布与领取 | [issue-tracker.md](issue-tracker.md)、[triage-labels.md](triage-labels.md) | 授权、依赖 frontier、状态与标签 |
| 业务实现与装配 | [development.md](development.md) | 唯一核心、阶段、隐私、2C4G、Lane、Gate、按影响完成 |
| TypeScript 与检查 | [validation.md](validation.md) | 差异计划、单构建、风险/停止条件、候选验收、full/certify 与历史复现 |
| 长任务调试与交付 | [session-operations.md](session-operations.md) | 实际装配诊断、来源身份、凭据、单写者、异步测试、工具输出、发布预检与清理 |
| 阶段或历史交接 | [baseline-history.md](baseline-history.md) | 原阶段快照、具名证据、r7 与历史适用范围 |
| 历史身份与审查收口 | [历史审查规范](../../.github/review/README.md) | 权威 SHA、真实祖先、审核快照、严格 ready 的适用范围 |
| 回顾已发生的错误 | [复盘索引](../retrospectives/README.md) | 事故、证据、已补防线及尚未实施事项 |
| 修改指令本身 | [本次拆分映射](refactor-20261016.md) | 原条款去向、官方依据、兼容点与验证范围 |

规则只在对应权威入口维护。状态读取实际计划/Issue/Evidence，命令读取 `package.json` 与工作流，测试集合读取 `test-routing.json`；本索引不缓存计数或批准。
