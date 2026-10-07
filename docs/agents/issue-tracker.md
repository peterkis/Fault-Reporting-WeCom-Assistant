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
