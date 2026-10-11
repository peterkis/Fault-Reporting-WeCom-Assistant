# 服务接口导航

本目录是前端、后端和 Agent 查找交互接口的统一入口。先从 [完整 HTTP 索引](endpoint-index.md) 找到 `METHOD + PATH`，再阅读对应模块的请求、响应、权限和失败处理。路径必须连同宿主、装配模式一起使用。

初始清单核对日期：2026-10-07（Asia/Shanghai），源码基点：`3cf707945afac7392806f7d8dca3dfb6be94caad`。后续接口接入与验收见各模块文档及[逐票实施记录](../../plans/admin-workbench-integration/execution.md)。现场部署、开关、批准范围须另查当前运行配置和授权记录；接口已实现不表示已启用或允许真实发送。

## 按业务查找

| 要做什么 | 文档 |
| --- | --- |
| 搜索所有 HTTP 方法和路径 | [HTTP 索引](endpoint-index.md) |
| 确定宿主、认证、JSON、错误、时间、幂等、版本 | [公共约定与宿主](conventions.md) |
| 会话列表、消息、接管、转派、内部备注、通信投递 | [会话工作台](workbench/conversations.md) |
| 集中获权服务主题、独立沟通责任、当前浏览器回复恢复与专用安全收据 | [集中会话（T22，默认关闭）](workbench/conversations.md#集中服务会话工作区wbint-t22默认关闭) |
| 工单列表、详情、状态动作、双责任、通知投递 | [工单生命周期](workbench/tickets.md) |
| 工单共享下次行动（T37，本地定向验证完成，默认关闭） | [共享跟进时间](workbench/follow-up-schedules.md) |
| Bot单聊每轮首次责任／完工通知与真实隔离送达状态（默认关闭） | [轮次节点通知](workbench/tickets.md#bot-原报修人轮次通知读取wbint-t24)／[T24本地七项证据](../../plans/admin-workbench-integration/execution/t24.md) |
| 本人同时承接工单与明确选择的真实沟通、保留原沟通人、24h恢复与安全核对（默认关闭） | [关联沟通承接](workbench/tickets.md#明确选择关联沟通的本人承接wbint-t05) |
| 24h当前浏览器备注恢复、原UNKNOWN操作的只读核对 | [草稿与只读核对](workbench/tickets.md#当前浏览器草稿与只读核对wbint-t03) |
| 人工复核、Contact Journey 与确定性决策 | [人工复核](workbench/manual-reviews.md) |
| 工作人员电话／现场未核实身份代录（默认关闭） | [代录报修](workbench/manual-reports.md)；[T17本地隔离验收与集成证据](../../plans/admin-workbench-integration/execution/t17.md)已核对，目录核实／一步处理由T18／T19继续实施 |
| 公共故障候选、人工确认、报告关联、订阅 | [公共故障](workbench/incidents.md) |
| React 管理端三列看板与详情 | [WEB01 看板](workbench/board.md) |
| 获权事项的已保存报修附件（默认关闭） | [附件读取](workbench/attachments.md) |
| 完整人工工作台怎样分批接入、有哪些后端缺口 | [实施计划](../../plans/admin-workbench-integration/README.md)／[能力映射](../../plans/admin-workbench-integration/capability-map.md)；其中候选路径尚未挂载 |
| 管理员检索／分页维护群名、工单显示具体来源群（默认关闭） | [来源群名称接口](workbench/source-groups-design.md) |
| 成员新报修、补充、我的报修、命令恢复、服务目录 | [医小修成员自助](member/self-service.md) |
| 机器人卡片工单详情、旧 Grant 与成员读取 | [Reporter 访问](member/reporter-access.md) |
| 登录、回调、退出、页面入口、健康检查、历史试点 | [认证与平台入口](platform/auth-health.md) |
| SSE 重放、正式管理端授权重读与轮询降级 | [实时事件](platform/realtime.md) |
| 后端调用的企业微信、人员目录和通道 SDK | [外部服务](integrations/external-services.md) |
| 群内 @Bot 回调的群ID/群名称、来源识别与本次现场验证 | [企业微信消息回调](integrations/wecom-message-callback.md) |
| 没有 REST 入口的进程内 Port、事件、Worker | [内部接口](integrations/internal-ports.md) |
| 设计接口、模拟前端、契约与实现差异 | [设计与差异](design-and-gaps.md) |
| 新增/变更接口时如何同步、核对与回滚文档 | [维护规则](maintenance.md) |

## 人与 Agent 的阅读顺序

1. 确定调用方：内部坐席、企业微信成员、Reporter、Worker 或外部系统。
2. 在 HTTP 索引搜索完整路径或业务名，读取宿主编号和实现状态。
3. 阅读模块文档和公共约定；版本值、身份和能力从对应 bootstrap/detail 获取。
4. 跟随相对链接核对 `src/*.mts`、`contracts/`、前端调用点和测试。运行产物导入保持 `.mjs`，源码链接使用 `.mts`。
5. 找不到实现时，查设计与差异、外部服务和内部接口；不要自行把内部函数包装成已有 URL。

本目录沿用 [V1.4 权威顺序](../architecture_baseline_status.md#11-文档权威顺序) 和 [AGENTS.md](../../AGENTS.md)。Accepted ADR、Contract/Schema 与实际 handler 不一致时，记录差异并按既有规则解决；本目录不创建新的业务状态或覆盖 Accepted ADR。所有示例均为合成数据，凭据只用占位符。

## 范围与完成边界

覆盖仓库中的 HTTP REST、SSE、OAuth/页面入口，以及外部调用和内部接口索引。设计路径、默认关闭接口、兼容模式和合成原型都有明确标记。静态资源按宿主列出路径范围，不作为业务 REST API。

初次接口盘点为文档整理：没有数据库、运行时代码或Feature Flag变更。后继[来源群名称增量](workbench/source-groups-design.md)和[已保存附件读取](workbench/attachments.md)有独立本地实现状态；[人工工作台接入计划](../../plans/admin-workbench-integration/README.md)中的其他候选路径不据此列为现有。资源上限、Gate、旧证据、认证与现场授权保持原约束。验证记录和后续维护方式见[维护规则](maintenance.md)。
