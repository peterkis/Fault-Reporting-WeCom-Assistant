# Phase 3 任务明细：Unified Ticket Platform 医院内网绿地接入

> 固定方向：新的医院内网来源 → Unified Ticket Core。当前不存在历史 Ticket 兼容范围。

## P3-001 Pilot Ticket Core 兼容升级为 Unified Ticket Core Facade

- 状态：TODO
- Lane：P3-A
- Gate：P3-G1
- 依赖：P2-014

目标：引入 UnifiedTicket Command/Query/Event Port，使 P2/P3 模块停止直接依赖 Pilot 临时语义。

交付物：接口、现有 P1 Adapter、直接 SQL 依赖清单、兼容测试、命名决策记录。

测试：创建、Action、查询、事件、版本并发、现有 P1 全量回归。

验收：不创建第二套 Ticket 表；新模块只依赖 Port；P1 回归不退化。

## P3-002 Integration Source Registry 与版本化契约

- 状态：TODO
- Lane：P3-A
- Gate：P3-G1
- 依赖：P2-014

目标：建立新来源 Registry，声明 Source Type、方向、权威、数据级别、Connector Mode 和 Contract Version。

交付物：Source Schema、Lifecycle、Capability Matrix、配置引用和版本兼容策略。

测试：重复 Source Code、禁用来源、不支持版本、权威冲突、Secret 脱敏。

验收：每个来源的方向和状态所有权明确；不保存明文凭据；模型可复用。

## P3-003 Integration Inbox、幂等、重放与隔离失败队列

- 状态：TODO
- Lane：P3-A
- Gate：P3-G1
- 依赖：P3-002

目标：实现 `source + external_event_id` 幂等、签名和 Schema 校验、隔离失败、重试、重放和审计。

交付物：Inbox Schema、Adapter Interface、加密/脱敏 Payload、Hash、Quarantine、Replay Command、稳定错误码。

测试：并发重复、签名错误、Schema 不符、事件乱序、毒消息、映射修复后重放。

验收：重复事件不重复执行业务；非法事件不污染 Ticket；失败可修复后重放。

资源：默认 batch 20、单 Integration Worker。

## P3-004 Integration Outbox、External Binding、Cursor 与 Reconciliation

- 状态：TODO
- Lane：P3-A
- Gate：P3-G2
- 依赖：P3-001, P3-003

目标：实现新来源外部引用、状态投影、ACK、断点续传和运行时一致性核验。

交付物：Binding、Outbox、Cursor、Reconciliation Run/Item、Dead Letter、差异分类。

测试：重复 Binding、Cursor 提交丢失、Connector 超时、Outbox 重放、事件顺序、ACK 丢失。

验收：外部失败不回滚本地 Ticket；Binding 唯一；Cursor 可恢复；运行差异可解释。

## P3-005 医院 SSO、人员、组织、院区与处理组映射

- 状态：TODO
- Lane：P3-B
- Gate：P3-G2
- 依赖：P3-002

目标：映射 SSO、person、employee、任职、院区、科室、角色和处理组，保留有效期和快照。

交付物：IdentityBinding、Organization Snapshot、Actor Resolution、Resolver Team Mapping、未映射队列和权限契约。

测试：调科、离职、多任职、未知人员、重复 userid、缓存过期、权限撤销。

验收：申报人所属科室与故障发生科室分开；映射失败不丢请求；越权拒绝。

## P3-006 医院内网 Connector Agent、mTLS 与断点续传

- 状态：TODO
- Lane：P3-B
- Gate：P3-G1
- 依赖：P3-003, P3-005

目标：开发轻量内网 Agent，以主动出站 mTLS HTTPS/WSS、安全注册、Cursor、Spool 和白名单操作连接云端。

交付物：Connector Package、签名发布、mTLS、Source 凭据、本地 Cursor/Spool、健康/version、升级和回退 Runbook。

测试：网络分区、证书过期/撤销、云端不可用、进程终止、重复 Spool、磁盘满、非法命令、版本不兼容。

验收：无云端入站内网依赖；无任意 SQL/Shell；续传不重复；凭据可轮换；日志无敏感信息。

## P3-007 内网报修门户 Source Adapter

- 状态：TODO
- Lane：P3-C
- Gate：P3-G2
- 依赖：P3-004, P3-005, P3-006

目标：接入第一条新的内网报修入口，使其提交 Service Request、补充消息和附件，并查询本地 Ticket 投影。

交付物：Submit/Query Contract、Actor Binding、附件流程、幂等、状态投影和 Simulator。

测试：重复提交、认证过期、未映射人员、Source 离线、附件超限、查询越权、投影滞后。

验收：入口创建本地唯一 Ticket；返回本地 Ticket 编号；来源不自建主状态；企业微信和门户查询一致。

## P3-008 医院 API、监控告警与未来来源 Adapter Template

- 状态：TODO
- Lane：P3-C
- Gate：P3-G3
- 依赖：P3-004, P3-005, P3-006

目标：抽象第二类来源模板，覆盖 API 调用、监控告警和未来院区入口，但不一次性全部上线。

交付物：Adapter SDK/Template、Capability Declaration、Alert-to-Intake Contract、测试 Harness 和 Onboarding Checklist。

测试：告警风暴、重复事件、未知来源、限流、无用户告警、Source 停用、版本升级。

验收：新增来源不修改 Ticket Core；Source 可独立关闭；告警不直接绕过 Intake/Ticket Action。

## P3-009 多来源统一 Workbench、查询与 Connector 状态

- 状态：TODO
- Lane：P3-D
- Gate：P3-G3
- 依赖：P3-004, P3-007, P3-008

目标：扩展 Workbench 支持来源标签、外部引用、Connector 健康、积压、隔离事件、Binding 和 Reconciliation 差异。

交付物：来源筛选、健康面板、Retry/Replay、Binding 修正、服务端分页和权限边界。

测试：来源权限、大列表分页、同步滞后、失败 Binding、内部备注、CSV 注入、并发修正。

验收：不切换系统即可处理所有已接来源；同步状态与 Ticket 状态明确区分；人工修正可审计。

## P3-010 外部投影、ACK、通知去重与来源运营

- 状态：TODO
- Lane：P3-D
- Gate：P3-G3
- 依赖：P3-004, P3-007, P3-008

目标：统一外部状态投影和 ACK，确保用户通知仍由本系统唯一管理，来源仅展示受控投影。

交付物：Projection Templates、ACK Contract、Dedupe Window、Lag Indicator、失败补偿和 Source Runbook。

测试：ACK 丢失、重复投影、Connector 中断、用户偏好、来源重复发送通知、投影延迟。

验收：用户只收到一次语义一致通知；投影失败不影响本地状态；所有失败可追踪。

## P3-011 故障、安全、容量、重放与一致性核验演练

- 状态：TODO
- Lane：ASSEMBLY
- Gate：P3-G3
- 依赖：P3-009, P3-010

目标：对完整 P3 组合执行故障注入、安全、容量、备份恢复、重放和运行时一致性核验。

交付物：Full Assembly、Fault Matrix、Security Review、Capacity Report、Reconciliation Report、Recovery Runbook。

测试：网络分区、Connector Kill、证书撤销、事件乱序、数据库故障、附件失败、ACK 丢失、2C4G 积压。

验收：重放幂等；未解释运行差异为 0；无患者/内部数据泄漏；无 OOM；RTO/RPO 达标。

## P3-012 第一条生产内网来源接入与 Phase 3 Go/No-Go

- 状态：TODO
- Lane：ASSEMBLY
- Gate：P3-G4
- 依赖：P3-011

目标：将第一条真实内网来源按最小范围接入生产，并完成观察、回退和阶段验收。

交付物：批准记录、Feature Flag 范围、生产配置、观察报告、回退演练、最终验收和运营手册。

测试：真实提交、重复提交、补充消息、状态查询、Connector 重启、关闭 Source 后回退、审计查询。

验收：Unified Ticket Core 仍是唯一事实源；企业微信和内网来源查询一致；关闭 Source 不影响核心服务；负责人批准 Go。
