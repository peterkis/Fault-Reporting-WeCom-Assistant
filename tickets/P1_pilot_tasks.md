# Phase 1 任务明细：企业微信外网试点

固定工单核心：Pilot Ticket Core。所有任务均不得依赖 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox。

## P1-001 建立 Pilot 工程骨架与配置校验

- 状态：DONE（本机受控验收；非公网试点验收）
- 依赖：G0-008
- 输入：Gate 0 能力结论、锁定 SDK、Pilot 运行环境约束。
- 输出：最小工程骨架、分层配置、启动校验和依赖边界说明。
- 测试：配置缺失、非法值、Secret 日志扫描、启动/退出测试。
- 验收：配置只声明 Pilot 依赖；不存在 Hospital Tickets 运行依赖。

### 启动记录

- 启动日期：2026-08-28
- 启动授权：项目负责人确认 Gate 0 结论并授权开始下一阶段。
- 执行边界：只建立 Pilot 工程骨架和配置/依赖边界校验；不实现 WeCom SDK Adapter、Channel Message 持久化、Ticket、AI 或 Hospital Tickets 集成。

### 当前验收记录

- 已完成：`src/p1-001-pilot-foundation.mjs`、`docs/20_p1_pilot_foundation.md` 和 4 项 P1-001 自动化测试；全量本地回归为 58/58 通过。
- 已完成：真实 `.env.pilot` 预检、独立空的本机 `pilot_ticket_core` 数据库创建/连接验证、本机 `GET /healthz` 及 `/tickets` 404 路由边界验证；未记录或输出凭据。
- 项目负责人确认：当前没有公网 IP，以本机作为 P1-001 受控验收标注。该决定不构成真实公网试点、安全边界、企业微信连通性或临床试点验收。
- 当时后续限制：交接时 P1-002 尚未获得单独启动授权；项目负责人随后于 2026-08-28 明确要求依据交接文档继续开发 P1-002，该限制已按任务粒度解除。
- 状态：P1 保持 `IN_PROGRESS`；P1-001 的本机受控验收不替代公网试点验收。

## P1-002 WeCom SDK Adapter 与标准消息契约

- 状态：DONE（本地 Contract 验收；非公网/真实 WSS 试点验收）
- 依赖：P1-001
- 输入：Gate 0 脱敏 Frame 与 SDK 版本。
- 输出：WeCom SDK Adapter、Normalized Message 契约和稳定错误码。
- 测试：文本、图片、mixed、重复 Frame、非法 Frame Contract Test。
- 验收：业务模块不依赖 SDK 原始类型。

### 启动记录

- 启动日期：2026-08-28
- 启动授权：项目负责人明确要求“根据该文档，继续开发 P1-002”。
- 执行边界：只实现 SDK Frame 转换、Normalized Message、媒体敏感引用隔离和稳定错误；不启动真实长连接，不持久化消息，不创建数据库表、Service Intake、Ticket、Outbox、AI/OCR 或 Hospital Tickets 集成。

### 当前验收记录

- 已完成：`src/p1-002-wecom-sdk-adapter.mjs`、`contracts/normalized_wecom_message.schema.json`、`docs/21_p1_wecom_sdk_adapter.md` 和 P1-002 Contract Test。
- 已覆盖：文本、图片、mixed 顺序、同 `msg_id` 重放、非法 Frame、机器可读 Schema、引用，以及 Gate 0 已验证的文件、语音和视频 Frame；定向测试 10/10 通过。
- 已确认：成功结果不包含 SDK `cmd/headers/body`、媒体 URL、AES Key 或 `response_url`；语音转写标记为 `VOICE_TRANSCRIPT`；`req_id` 不参与业务幂等。
- 已确认：重复 Frame 只得到相同 `WECOM_AIBOT:{msg_id}` 幂等键，Adapter 不丢弃也不宣称可靠去重；数据库唯一约束和原结果返回仍属于 P1-003。
- 全量本地回归：68/68 通过。该结果仅是本地纯转换与回归，不构成公网边界、真实 WSS、数据库幂等、临床试点或 Phase 1 Go/No-Go。
- 历史限制：P1-003 当时尚未获得单独授权；项目负责人随后于 2026-08-28 明确要求“执行P1-003”，该限制已按任务粒度解除并完成本机数据库验收。

### 2026-08-29 Code Review / TDD 复核

- 状态保持 `DONE（本地 Contract 验收）`。通过唯一公共接口 `adaptWeComSdkFrame` 对非法接收时间、NFKC 后长度、非消息事件分流、Unicode/NUL 存储边界和公开导出面逐项建立失败测试并修复。
- Normalized Message 文本 Schema 现同时拒绝 NUL 与孤立代理项，并保留合法 astral Unicode；定向 Contract Test 为 14/14 通过。
- Standards 与 Spec 两轴终局复审均为 `No findings`；带库全量回归 129/129 通过。结论仍不扩大为真实 WSS、公网或临床试点验收。

## P1-003 Channel Message Inbox 与数据库幂等

- 状态：DONE（本机 PostgreSQL 集成验收；非公网/临床试点验收）
- 依赖：P1-002
- 输入：标准消息契约、隐私与留存规则。
- 输出：Channel Message 持久化、`provider + msg_id` 唯一约束和重复请求原结果返回。
- 测试：并发重复、事务回滚、进程重启和数据库暂时不可用。
- 验收：同一消息只保存一次且不产生重复业务处理。

### 启动记录

- 启动日期：2026-08-28
- 启动授权：项目负责人明确要求“执行P1-003”。
- 执行边界：只创建 `channel.message_inbox`、迁移入口和数据库事务幂等；不创建 Service Intake、Pilot Ticket、Event、Outbox、AI/OCR 或医院系统集成。

### 当前验收记录

- 已完成：独立可重入迁移、严格 Normalized Message/隐私/留存输入、`(provider, msg_id)` 唯一约束、事务首次处理和 JSON 原结果快照。
- 已覆盖：12 路并发重复、首次处理回滚、事务提前提交防护、两个独立 Node 进程重启、数据库不可用、调用方密文字节和迁移范围；定向真实 PostgreSQL 测试 9/9 通过。
- 已确认：并发重复只保存一行且只执行一次处理器；失败事务不留半完成行；重启后重复请求返回首个已提交 `channelMessageId/result`。
- 全量本机回归：77/77 通过；测试合成记录已精确清理，目录核验为一个唯一约束、零条 `p1-003-*` 测试残留。
- 限制：Inbox 只保存 `retention_until`，未实现到期删除/备份生命周期；可选 raw payload 只接受调用方提供的字节，不能自行证明密码学加密。该任务验收时 P1-004 尚未启动；项目负责人随后已单独授权并完成 P1-004 本机验收。

### 2026-08-29 Code Review / TDD 复核

- 状态保持 `DONE（本机 PostgreSQL 集成验收）`。通过 `createChannelMessageInbox(...).accept` 与 `applyChannelMessageInboxMigration` 公共接缝补齐不可变输入快照、纯 JSON/Proxy 防护、事务查询生命周期与会话控制、PostgreSQL 时间边界和迁移目录失败关闭。
- 定向真实 PostgreSQL 测试为 35/35 通过；P1-004 兼容回归 22/22、带库全量回归 129/129 均通过。
- 验收后 `p1-003-*`/`p1-004-*` Channel Message、Intake、关系、事件和隔离数据库残留均为 0；主键 1、唯一约束 1、检查约束 16、生成列 0，留存索引为有效 btree；数据库仍不存在 Pilot Ticket 表。
- Standards 与 Spec 两轴终局复审均为 `No findings`。本次没有启动 P1-005，也没有实现 Ticket、通知、AI/OCR 或医院系统集成。

## P1-004 Service Intake 创建与消息聚合

- 状态：DONE（本机 PostgreSQL 集成验收；非公网/临床试点验收）
- 依赖：P1-003
- 输入：Channel Message、90秒聚合规则和请求类型规则。
- 输出：Service Intake、消息关系、补充/澄清关联和审计事件。
- 测试：单条、多条补充、新报修、纯图片和并发聚合。
- 验收：消息与 Intake 分层；补充消息不错误新建工单。

### 启动记录

- 启动日期：2026-08-28
- 启动授权：项目负责人明确调用 `implement` 并要求执行 `P1-004`。
- 执行边界：只创建/追加 Service Intake、消息关系和 Intake 审计事件；不创建 Pilot Ticket、Incident、Notification Outbox、AI/OCR 或任何医院系统集成。

### 当前验收记录

- 已完成：独立可重入迁移、P1-003 同事务处理器、90 秒同上下文聚合、显式新报修/另一工单分流、确定性请求类型、纯图片等待澄清和补充/澄清关系。
- 已覆盖：单条、多条补充、显式新报修、另一工单引用、纯图片、图片后澄清、12 路不同消息并发、普通与显式边界逆序获锁及边界后回挂、八类请求类型与分句否定/感谢、聚合隐私与留存、旧结构升级/旧快照失败关闭、CLI 稳定错误映射、90 秒边界、上下文隔离、重放、整笔回滚、五位数编号、事件顺序和迁移/契约范围；定向真实 PostgreSQL 测试 22/22 通过。
- 全量本机带库回归：99/99 通过；`p1-004-*` 合成 Channel Message、Intake、关系和事件残留均为 0。
- 已确认：Channel Message 与 Intake 分表；每条消息最多属于一个 Intake；并发补充只形成一个 Intake；所有结果的 `ticket_id` 与 `incident_id` 为空，数据库不存在 Pilot Ticket、Incident、Outbox 或 Hospital 表。
- P1-004 的限定：规则分类不是 AI 结论；该任务本身未实现 Ticket、回复或通知，因此不证明“客户端已收到工单”或临床闭环。后续 P1-005 至 P1-010 的本机实现不改变该 P1-004 验收边界。

## P1-005 Pilot Ticket Core 模型与编号

- 状态：DONE（本机 PostgreSQL 集成验收）
- 依赖：P1-004
- 输入：Service Intake、Pilot 服务目录和编号规则。
- 输出：Pilot Ticket、编号、处理组、版本、内外部备注和迁移标识。
- 测试：幂等创建、编号冲突、Intake 一对一主工单约束和回滚。
- 验收：明确报修无需 AI 即可创建 Pilot Ticket；不调用 Hospital Tickets。
- 结果：`pilot_ticket.ticket` 与 `intake.service_intake` 通过互相一致的外键和双向延迟约束形成一对一关系；提交时拒绝只写单侧的 Ticket/Intake 关联。编号为 `IT-YYYYMMDD-NNNN`，冲突稳定映射为 `PILOT_TICKET_NUMBER_CONFLICT`。真实 PostgreSQL 定向测试覆盖创建/重放、回滚、冲突后 Intake 未关联及单侧关联失败；未调用 Hospital Tickets、AI/OCR。2026-08-29 修正票号碰撞测试的 `BIGINT` 字符串/`BigInt` 转换，并在空 Ticket 表上复位测试序列；定向回归 4/4、全库串行回归 189/189 通过。

## P1-006 Pilot Ticket 状态机、Action 与事件

- 状态：DONE（本机 PostgreSQL 集成验收）
- 依赖：P1-005
- 输入：状态枚举、合法转换、权限和乐观锁规则。
- 输出：Action API、Ticket Event、真实对外状态和版本冲突处理。
- 测试：全状态路径、非法转换、重复点击、并发接单和重开。
- 验收：每次状态变化都有事件；不能通过通用 PATCH 绕过 Action。
- 结果：`createTicketActionService` 仅接受命名 Action，并以 `expectedVersion`、行锁和追加式 `pilot_ticket.ticket_event` 实现状态转换、事件顺序和版本冲突；内部备注与外部说明分离。`CLOSED -> REOPENED -> IN_PROGRESS` 为显式闭环；P1 明确拒绝未有 Incident 事实的 `link-incident`，`DUPLICATE_LINKED` 留待 Phase 2 受权实现。

## P1-007 Notification Outbox 与 Delivery

- 状态：DONE（本机 PostgreSQL 集成验收）
- 依赖：P1-006
- 输入：Ticket Event、通知矩阵、企业微信发送能力。
- 输出：Pilot Outbox、Delivery、重试、限流、去重、死信和送达审计。
- 测试：事务失败、发送超时、重复 Worker、断线积压和部分成功。
- 验收：状态、事件和 Outbox 同事务；发送失败不回滚工单事实。
- 结果：`notification.outbox`、`notification.delivery` 和 `notification.delivery_attempt` 以 Ticket Event 为幂等源；动作、事件与 Outbox 同事务，Worker 使用租约、`SKIP LOCKED`、指数重试、死信审计及按 `(channel, target_key)` 的持久化窗口限流。可执行矩阵使内部备注只发 Pilot 处理组。sender 为注入式测试边界，未发送真实企业微信消息。

## P1-008 首次确认与可靠回执

- 状态：DONE（本机 PostgreSQL 集成验收）
- 依赖：P1-007
- 输入：持久化结果、Pilot Ticket 编号和通知模板。
- 输出：事务提交后的首次回复、临时失败文案和发送时间指标。
- 测试：提交失败、超时、重复消息、Gateway 重连和通知拒绝。
- 验收：不在提交前回复；不虚构工单号或“处理中”状态。
- 结果：首次确认只在 Inbox 事务成功返回后尝试投递，重复消息不重复发送；投递失败保留 `PENDING` 并返回只含真实编号/状态且标明临时性的 `TICKET_CREATED_DELIVERY_PENDING`，无工单不伪造编号或“处理中”事实，并记录首次确认投递延迟。该结果不证明客户端收到或展示。

## P1-009 最小处理端与 Pilot 权限

- 状态：DONE（本机 PostgreSQL 集成验收）
- 依赖：P1-006
- 输入：Pilot 用户/角色配置、处理组和 Action API。
- 输出：最小待办、接单、处理和备注入口及审计。
- 测试：未授权、越权、并发操作、内部备注泄漏和移动端基础可用性。
- 验收：使用 Pilot 身份边界，不要求医院 SSO 或 Hub。
- 结果：新增 Pilot-local principal、角色与处理组成员关系；所有数据/API 入口都通过注入认证器，提供待办、受限 Ticket 视图和 Action 路由，申报人视图不泄漏内部备注，人工处理端不暴露系统 `auto-close`。根页面只提供无数据的静态壳并含移动端 viewport；未接入医院 SSO、人员主数据或 Hub。

## P1-010 补充、解决确认、关闭与重开

- 状态：DONE（本机 PostgreSQL 集成验收）
- 依赖：P1-008, P1-009
- 输入：卡片能力、状态机、Outbox 和申报人关联。
- 输出：请求补充、解决卡片、确认关闭、自动关闭标识和重开闭环。
- 测试：过期/重复卡片、错误用户、超时关闭、仍未恢复和通知失败。
- 验收：申报人可完成闭环契约；自动关闭不冒充用户确认。
- 结果：补充消息以持久化 Channel Message 关联到 Ticket 且拒绝跨 Intake 伪关联；本地卡片任务按 actor、过期时间、事件请求号和快照去重，解决后先记录并入队一次 `ticket.auto_close_reminder`，再可由 `SYSTEM` 在到期后以 `AUTO_TIMEOUT` 关闭。卡片任务为本地契约，未证明真实企业微信卡片展示或点击。

## P1-011 Pilot 安全、可观测性与运维基线

- 状态：DONE（本机 PostgreSQL 集成与本机加密备份恢复演练；非公网/临床试点验收）
- 依赖：P1-007
- 输入：公网试点威胁模型、日志规范、留存和备份要求。
- 输出：权限、Secret、日志脱敏、指标、告警、备份、恢复和 Runbook。
- 测试：Secret/患者信息扫描、依赖故障、恢复、限流和审计访问。
- 验收：公网 Pilot 数据受控；Redis/AI等非关键依赖失败不漏单。
- 结果：`createPilotOperationalIntake` 将真实 Inbox→Intake→Ticket→Outbox 组合接入普通日志、就绪检查和提交后的可降级增强，Redis/AI 失败不回滚已提交工单；日志/指标/告警均只含固定字段或 HMAC 摘要。`operations` schema 追加不可变审计、加密备份检查点、恢复成功/失败记录和固定恢复告警；本机成功完成 AES-256-GCM 逻辑备份、隔离临时恢复库校验和清理。Pilot Workbench 改为同源 CSP 与外置 CSS/JS。演练临时工件不等同于长期生产备份，且未验证公网、真实患者数据、医院密钥系统或临床试点。

## P1-012 Phase 1 E2E、故障演练与试点 Go/No-Go

- 状态：IN_PROGRESS（本机受控 E2E 接缝与 PostgreSQL 集成演练已通过；旧版测试群短客户端回执探针、历史非写入显示观察和一次带逐次 HMAC `run_id` 的非写入短回执显示闭环均已完成；完整建单、图片、故障窗口和试点评审待完成）
- 依赖：P1-010, P1-011
- 输入：Phase 1 全部交付物、已配置机器人/测试群/allowlist 测试账号、本机 Pilot PostgreSQL 与试点验收指标；主机须可经 DNS、TCP 443、TLS 稳定出站访问企业微信 WSS。
- 输出：E2E报告、故障演练、性能/安全证据和试点评审结论；真实长连接不要求公网 IP 或公网入站监听。
- 测试：文字/图片降级、100条突发、断线、数据库/Outbox故障、AI关闭占位场景。
- 验收：漏单0、重复单0、10秒目标、状态真实、通知可追溯，且有 allowlist 测试账号的测试群真实消息往返与客户端观察；提供方 ACK 或 SDK 成功不能替代客户端观察。HTTP/Webhook 回调、外部 Workbench 或独立公网 Web/API 网关才需要单独公网入口审批；完整证据经项目负责人明确批准后方可进入 Phase 2。
- 当前结果：`src/p1-012-pilot-e2e.mjs` 将 allowlist 测试账号的真实 WSS callback、受控 Adapter、Inbox→Intake→Ticket→Outbox、显式提供方回执、被动回复和首个 Delivery 接缝组合起来；`scripts/p1-012-live-e2e.mjs` 提供只出站的配置预检、文字/图片测试群运行、WSS 重连、仅本机群 ID 捕获和非写入短回执探针。企业微信[回复消息（101836）](https://developer.work.weixin.qq.com/document/path/101836)要求消息 callback 使用流式或模板卡片回复，因此 P1-012 已固定为完成流式回复并记录数值 `provider_errcode`；不保留 `errmsg`。企业微信[接收消息（101834）](https://developer.work.weixin.qq.com/document/path/101834)显示群聊回调保留首部 `@机器人`，故 `GROUP_REPLY_PROBE` 现同时校验机器人 ID、测试群、测试账号；callback 保留该前缀时只在一个普通 ASCII 空格后的剩余 2–3 字符精确匹配，只有适配层已省略前缀时才接受裸标记。它不建立数据库连接。现场已完成 WSS 重认证、脱敏群 ID 捕获和一次旧版三字符文字回执：Pilot Intake 在 51 ms 内受理、完成流式回复取得 `errcode=0`，测试账号确认客户端显示；该短消息保持 `WAITING_DESCRIPTION`，未创建 Ticket，不能替代明确报修文字回环。旧版字面匹配窗口曾安全超时；修正后的探针现已通过 P1-012 集成 37/37 和全库串行 195/195。早期显示观察源回执早于逐次 HMAC `run_id`，故只保留历史事实；随后已完成带有效 `run_id` 的新一轮真实测试群回环，完成流式回复取得 `provider_errcode=0`、`ACKED`，测试账号确认客户端显示，且 `p1_012_client_display_observed` 以 HMAC 来源关联值独立记录。成功源结果追加与观察的选源、复核及追加共用跨进程证据链独占声明；来源在声明前过期会返回 `P1_012_CLIENT_OBSERVATION_SOURCE_STALE`，竞争 live 探针会在调用被动回复前以 `P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS` 失败闭合，故不会产生无源回执；硬超时会释放声明，晚到结果不追加成功源证据。声明记录随机 owner、PID、主机名与创建时间；双重一次性批准、同一主机、至少 60 秒且 owner PID 已确认不存活的受控恢复会先审计 quarantine、删除成功后才审计 removed；删除失败可在阈值后续跑，异常多标记或不可解析状态保持 fail-closed 运维对账。全程没有数据库连接或业务写入。带库受控演练已覆盖重复消息、图片降级、100 条突发、Outbox `RETRY_SCHEDULED` 记录与重试、以及 AI/OCR 关闭。它仍不替代完整文字建单、图片客户端观察、实际群内突发、隔离 PostgreSQL 故障窗口或试点负责人 Go/No-Go 批准。
