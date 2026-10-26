# AGENTS.md

## 基线与停止线

- 执行基线为本文件、[README](README.md)、[架构状态](docs/architecture_baseline_status.md)与相关 Accepted ADR；有冲突先修文档/ADR，再改代码。详细规则按下表读取，效力与原 AGENTS 相同。
- Unified Ticket Core 是 Ticket 编号、状态、责任和事件的唯一长期事实源。沿既有命令/查询/事件 Port 扩展；新入口接入同一核心。术语使用 [CONTEXT.md](CONTEXT.md)，ADR 放根 `adr/`。
- 持久 Feature Flag 默认 `false`。P2-G2-LIVE、P2-008 继续停止，P2-G3 与 P3 不因本地验收、PR 合并或复盘自动启动。真实发送、现场业务写库、部署及 Gate 批准沿各自具名授权。
- 用户原件、未提交改动、历史 Evidence、被测祖先、stash 与恢复引用先保全；历史失败、SKIP、NOT_RUN 和证据缺口如实保留。只清理已确认自有且满足合并/停止条件的资源。
- Git 操作全部使用 HTTPS。任务状态与阻塞关系以 GitHub Issues 为准；依赖未完成时，`ready-for-agent` 仍不表示可执行。

## 按任务读取

只读取当前分支需要的文档；文档中的历史命令和批准不替代本次任务授权。

| 触发条件 | 必须读取 |
| --- | --- |
| 探索、写票或修改业务/接口 | [领域与合同入口](docs/agents/domain.md)；人工工作台另读[实施导航](plans/admin-workbench-integration/README.md)与[实际 API](docs/api/README.md) |
| 领取、发布或收口任务 | [Issue tracker](docs/agents/issue-tracker.md)、[标签词汇](docs/agents/triage-labels.md) |
| 修改代码、Schema、跨层装配、AI/集成或资源配置 | [开发边界与完成标准](docs/agents/development.md)；含领域绝对规则、2C4G、Lane 和 Gate 顺序 |
| TypeScript、测试范围、构建或认证 | [验证规则](docs/agents/validation.md)、[迁移执行入口](plans/typescript-migration/README.md)、[ADR-0026](adr/0026_typescript_strict_incremental_migration.md) |
| 历史身份、祖先链、重复审查意见或证据减量 | [.github/review/README.md](.github/review/README.md)；先取得 GitHub 本次权威完整 SHA，再核验对象 |
| 调试长任务、并行写入、发布或清理 | [会话运行与交付](docs/agents/session-operations.md)；先确认唯一写者、资源所有者和交接点 |
| 阶段交接、旧计数或现场批准 | [基线与历史交接](docs/agents/baseline-history.md)及其原始证据，不重绑旧 tested_head |
| 复盘或维护指令 | [复盘索引](docs/retrospectives/README.md)、[指令导航](docs/agents/README.md) |

## 编码与验证入口

- 后端新增源码使用 Node.js 24、TypeScript strict、ESM `.mts`；产物及相对运行时导入保留 `.mjs`。保留输入守卫、事务、身份、时间和哈希语义；不以类型逃逸或源码回退掩盖问题。
- 普通 PR 使用活动 selection 的 strict、一次构建、相关业务/工具测试、制品校验与自有资源清理。手动 full、当前 certify 与固定历史 certify 各有原合同；P00 仅创建 PR 后停止。具体命令见验证规则。
- 完成以合同、实际测试、隐私/资源、Evidence、关闭方式和 Backlog 更新齐备为准；采用[开发边界中的十项完成标准](docs/agents/development.md#9-每个任务的完成标准)。

## Code Review Rules

- 审查实际差异是否遵守合同：当前 READ 与各写/维护/投递权限分开核验，等待后与回执复用前保留原终检；内部备注和对外摘要隔离。
- 对 `tested_head`、祖先链或发布身份的意见，先按历史审查规范确认被审对象；身份预检与业务 readiness 分别报告。真实缺陷继续修复，已证明正确的重复意见引用适用证据。
- 机械格式、类型、路径与文档链接由现有 CI 检查。审查集中判断跨层一致性、范围、失败恢复和隐私语义；检查映射与近期经验见[复盘索引](docs/retrospectives/README.md)。
