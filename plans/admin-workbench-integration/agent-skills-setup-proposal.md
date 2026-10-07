# Agent skills 仓库配置记录

状态：CONFIGURED，2026-10-07已确认并写入。已选择GitHub Issues和五个默认triage标签。以下保留当时审阅的配置正文；AGENTS原有15699字节完整保留，仅追加最后的Agent skills区块。实际规则以docs/agents三份配置为准；领域布局沿用CONTEXT与根ADR。

## AGENTS.md 追加内容

```markdown
## Agent skills

### Issue tracker

任务与规格使用本仓库的 GitHub Issues；发布前核对已批准拆分，按真实阻塞关系领取。操作规则见 [任务跟踪器](docs/agents/issue-tracker.md)。

### Triage labels

使用五个默认 triage 标签；ready-for-agent 表示任务描述可执行，阻塞未完成时仍不得开始。映射见 [标签词汇](docs/agents/triage-labels.md)。

### Domain docs

沿用单一仓库词汇入口 CONTEXT.md、根目录 adr/ 及现有领域变更前置文档，不新建平行词汇表。读取规则见 [领域文档](docs/agents/domain.md)。
```

## docs/agents/issue-tracker.md

```markdown
# Issue tracker: GitHub

本仓库任务与规格使用 [GitHub Issues](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues)。仓库：`peterkis/Fault-Reporting-WeCom-Assistant`。使用 gh CLI；Git 操作保持 HTTPS。

## 发布与读取

- 发布前完成 to-tickets 的粒度与阻塞关系确认，一票一个 Issue，按依赖顺序创建；采用已配置 triage 标签。
- 多行正文写入临时文件并用 `--body-file` 提交，不把正文拼接进 shell 参数。未知发布结果先按稳定票号/标题查询，禁止盲目重复创建。
- 读取票的完整正文、标签、状态和评论；本地清单/缓存不能代替 GitHub 当前结果。
- 来源是已存在 Issue 时，按其子 Issue 关系登记；来源仅为计划文档时不另造父 Issue。不得自行修改或关闭父 Issue。
- 没有授权时不对外回复评论；本次 to-tickets 授权只覆盖批准的任务发布和必要标签/阻塞关系。

## 阻塞与领取

优先使用 GitHub 原生 Issue Dependencies。读取阻塞对象时区分真实 Issue number、数据库 id 和 node_id；添加关系使用 blocker 的数据库 id。若当前服务不支持原生依赖，正文明确列 `Blocked by: #number` 作为 fallback，并记录未建原生边的原因。

从 frontier 领取：Issue 未关闭、未被领取、triage 为 ready-for-agent，且全部阻塞 Issue 已完成；依赖票仅有PR或代码并不等于已完成。领取和执行状态、证据、关闭沿仓库完成标准；不要因所有票都带 ready-for-agent 而全部并行启动。

技能所需标签不存在时仅按实际发布需要创建，不覆盖同名已有标签。标签词汇见 [triage-labels](triage-labels.md)。

## PRs as a request surface

**PRs as a request surface: no.** 本次不把外部 PR 纳入 triage 队列，不修改现有 PR、保护规则或发布流程。

## 规格与本地导航

长期业务依据仍使用既有 plans/docs/Accepted ADR，GitHub Issue 是逐票执行状态与阻塞关系事实源。本地导航记录票号、链接和来源映射；其中状态必须注明快照日期，执行前重新读取 GitHub。不得将票关闭解释为部署、现场或后续 Gate 批准。
```

## docs/agents/triage-labels.md

```markdown
# Triage Labels

采用五个默认 triage 角色与同名标签；这是任务准备程度，不是业务执行状态、验收或发布授权。

| 技能角色 | 本仓库标签 | 含义 |
| --- | --- | --- |
| needs-triage | needs-triage | 等待负责人判断范围和优先级 |
| needs-info | needs-info | 缺少必要信息 |
| ready-for-agent | ready-for-agent | 描述充分，可由Agent执行；仍须全部阻塞已完成 |
| ready-for-human | ready-for-human | 需要人类处理 |
| wontfix | wontfix | 不实施 |

to-tickets 发布已批准票时使用 ready-for-agent。Issue open/closed、领取人、原生阻塞关系与实际证据单独核对；标签不代表已实现或已批准真实运行。已存在同名标签保留，缺失标签按实际需要创建。
```

## docs/agents/domain.md

```markdown
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
```

## 当前实际核对

- GitHub仓库Issues已启用，当前gh可读取并管理该仓库。
- 未发现已有Agent skills配置或同前缀WBINT票；不会重复添加配置块或任务。
- 已有wontfix标签保留。本次发布需要ready-for-agent；若默认标签获确认且不存在，仅按实际使用创建所需标签。
- 无根workspaces、packages或pnpm-workspace；不配置多词汇表的monorepo布局。
- 43票拆分见[ticket-breakdown-proposal](ticket-breakdown-proposal.md)。配置与票拆分均已获最终确认；Issue发布与复查完成，实际编号/依赖见[正式任务清单](tickets.md)。
