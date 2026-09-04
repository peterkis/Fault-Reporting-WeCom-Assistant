# P2-016 完成报告

- Task：P2-016；状态：DONE；日期：2026-09-04（Asia/Shanghai）。
- 范围：Internal Beta、规则与人工主运行路径、AI/OCR 关闭；不是 P2-G2、Phase 2 Go、生产/临床上线或最终品牌前端。
- 分支：`phase2/p2-016-ticket-lifecycle-workbench`。
- 基线：`b1b8e4deb14e6290ca45aea12d92baaef4728c11`。
- 授权提交：`3599fa479c752ed75cd4652e5ffdaee2b212ad24` — `chore(p2): authorize P2-016 ticket lifecycle workbench`。
- 实现提交：包含本报告的唯一第二个本地提交 — `feat(p2): implement P2-016 full ticket lifecycle workbench and notifications`。自引用提交 SHA 不写回本文件；用 `git log --format=fuller origin/main..HEAD` 解析，最终交付另报完整 SHA。
- 负责人已直接回复“批准”；依据：`evidence/p2-016-project-owner-approval.md`。
- 收口全量回归：535/535，fail/cancelled/skipped/todo=0，exit=0，443441.2863 ms。新增的两个用例校验完成态证据与冻结输入；最终静态门禁记录在同名 JSON。

## 输入、输出与实现边界

两个提交合计153文件：新增101、修改52；第二提交152文件：新增100、修改52。分组（新增/修改）：root 0/8、contracts 16/4、database 1/1、docs 4/4、evidence 22/0、plans 0/5、scripts 5/4、src 24/16、tasks 0/2、tests 23/5、tickets 0/1、web 6/2。授权提交的历史账本纠偏未改P2-015实现；旧完成Evidence修改0。

输入为已持久化 P2-015 Journey/Decision/Manual Review、P1-006 Ticket Action/Event、P2-005 Conversation Assignment、P2-004 Communication 和 P2-006 Workbench Auth/SSE。输出为原生内部 UI 与 REST、显式 Ticket Command、双责任视图、Reporter 绑定只读时间线和可靠模板通知。

没有第二套 Ticket Core/Conversation Assignment、前端框架、打包器、CDN、ORM、Broker 或模型。普通 UI/HTTP 不直写 Ticket/Communication，统一通过授权 Command Facade 与既有 TicketActionService；需要通知的事实同事务提交。SDK 只在批准的 Gateway/Sender 边界调用。

Manual Review 提供授权后 keyset 列表、详情、Journey/Leg/Decision/Provenance 和明确决议；决议与 Safe Action 同事务全部成功或全部回滚。历史 Decision 保留，覆盖追加。`LINK_EXISTING_JOURNEY` 禁用，因为现有 Store 不支持迁移已绑定 Leg；不把该限制隐藏为完成的能力。Incident 候选仅供人工审核，不创建 Incident。

Ticket REST 包含列表、详情、追加事件、责任、候选处理人、投递，以及固定动作、转派、复合接管接单、重试/核对。每个写命令校验 Authentication、Authorization、Origin/CSRF（Cookie）、If-Match/expected version 和 principal-scoped Idempotency-Key；授权先于幂等收据读取。12 路同命令、不同 body 冲突、响应丢失重放、过期版本和权限失败均由真实数据库测试覆盖。

## 完整状态矩阵

| 起点 | Action | 结果 |
| --- | --- | --- |
| NEW | queue | QUEUED |
| QUEUED | accept | ACCEPTED |
| ACCEPTED / REOPENED | start | IN_PROGRESS |
| IN_PROGRESS | request-information | WAITING_REQUESTER |
| IN_PROGRESS | wait-vendor | WAITING_VENDOR |
| WAITING_REQUESTER / WAITING_VENDOR | resume | IN_PROGRESS |
| IN_PROGRESS | resolve | RESOLVED |
| RESOLVED | confirm | CLOSED |
| RESOLVED / CLOSED | reopen | REOPENED |
| QUEUED / ACCEPTED | cancel | CANCELLED |
| RESOLVED | auto-close（既有 SYSTEM policy） | CLOSED |
| 既有允许状态 | add-note | 状态不变，追加事件 |

普通坐席没有 auto-close HTTP 动作。转派只修改原 Ticket 处理责任及审计 metadata，校验 active/团队/角色/版本，不覆盖沟通负责人。复合接管+接单复用两个事实源及 caller-owned transaction：任一失败全部回滚。UI 并列展示两种责任，不复制所有权。

## Migration 031 与 Contract

031 必需的新增持久化为六张辅助表：`ticket_command_receipt`、`reporter_public_ref`、`reporter_access_grant`、`reporter_access_session`、`reporter_access_event`、`communication.ticket_notification_binding`。另为原 Ticket Event 扩展 assignment metadata 与必要词汇/索引，不新增 Ticket 表。

精确 catalog：84 columns、145 constraints、38 indexes、24 FK、0 user triggers；catalog SHA-256 `5521c4fc34481ef22e46cab4e0f3e1fdea232c995cef2f823008d0ea9142fb20`。fresh/existing、check rollback、重复 no-op 与七类 drift 拒绝均通过；历史 migration 001–030 不变。原 `.env.pilot` 配置库未迁移，只有授权的临时测试库应用后删除。

闭合 JSON Schema/TypeScript Contract 和 OpenAPI 已更新，时间为 ARCH-005 offset-free Asia/Shanghai 字符串与 BIGINT epoch；拒绝非规范版本、Proxy/accessor/pollution/超限结构，稳定错误不携带 SQL/Provider/正文/Token。

## 通知与 Reporter

Ticket Event → Notification Policy → Message → Outbox → Delivery；通知自然键、唯一约束和命令收据保证重放不增量。外部网络不处于 Ticket 提交事务内，发送失败不撤销工单。此处是幂等投递和 UNKNOWN 人工核对保证，不承诺任意外部网络下无条件 exactly-once。

群创建回执只有安全受理提示及尾号，详细进展发原上报人单聊。纯唤醒先群提示/主动私聊，引导后的 group/direct 是一个 Journey 的两个 Leg，不按 userid+邻近时间猜测。群强 @ 为 UNVERIFIED，不是成功前置条件。

模板固定 `text_notice`、醒目后四位、固定标题/状态/Asia-Shanghai 时间和“查看处理进度”。仅 numeric errcode=0 视为 ACK；拒绝、缺失 ACK 与网络不确定性分开处理。Provider 已调用但结果未知进入 Reconciliation，不盲重发。人工 CONFIRMED_SENT 只追加核对审计；NOT_ATTEMPTED 才可安全重试。

Reporter public_ref 192 bit，尾号/UUID 不作授权。每条卡片独立 Grant，经批准 HTTPS fragment 进入页面后清除并单次交换为 HttpOnly/Secure/SameSite 绑定会话；数据库只存哈希与 HMAC 重建材料。API 每次核对单工单绑定，只读固定里程碑，内部备注/Review/身份/患者/IP/Provider 错误不返回。真实点击与刷新已由负责人确认，未使用 query-token、Token 手工注入或 TLS 绕过。

## 浏览器、安全、Realtime 与恢复

原生 HTML/CSS/ES Modules，1440×900/390×844，键盘/focus-visible、无横向溢出；XSS/CSRF、认证过期、刷新与提交编辑围栏均测试。正文/令牌不入 storage。内部 durable SSE 上限 32，Last-Event-ID、Replay Gap 与 5 秒轮询有界；Reporter 独立认证和有界轮询，不复用内部 SSE。

真实进程 kill/restart 覆盖提交后响应丢失、UNKNOWN 保留、确认未发后一次重试、ACK 后不再发送。Legacy P1/P2 测试持续覆盖窄兼容接口；具体 seam 和群入口修正见自动化就绪与修复报告。P2-007 Runtime、P2-015 等历史完成 Evidence 不变。

## 真实现场、回归与资源

现场 Run `3bdbe965-c4df-414b-bd5a-05d5f010ad53`：负责人亲自操作真实企业微信和原生工作台；报告逐步区分人工客户端观察与独立数据库核验。实际观察 2,780,329 ms / 180 样本，1 Ticket、11 Event（1 内部备注）、10 Reporter 里程碑、1 Journey/2 Leg、13 Delivery 全 SENT。Pending/dead-letter/UNKNOWN 最终均 0。

实际验证创建、接单、处理、等待厂商/上报人、恢复、解决、关闭、重新打开；内部备注不外发；受控 Gateway 断开/重认证后未调用 Provider 的通知恢复；唯一一次本机 IPC ACK 丢失进入 UNKNOWN，人工核对后不重发。该故障是受控 IPC 演练，不伪称自然供应商故障。取消、转派、复合命令、Manual Review、并发及自动关闭完整分支由自动化原生浏览器/数据库覆盖，不冒称本现场全部重复执行。

批准前现场后全量：533/533、零 fail/cancelled/skipped/todo、exit=0，555687.2561 ms。容量：500 Tickets、5000 Events、200 Review、500 Cards+400 Group receipts、100 Reporter sessions、32 SSE，单池 max4；heap 峰值 88286656，回落至 19168656 bytes，自动化真实 SDK calls=0。

最终收口全量：535/535、零 fail/cancelled/skipped/todo、exit=0，443441.2863 ms；同容量下 heap 峰值67841600、最终19411704 bytes，SSE停止后0。此前一轮被Windows Modern Standby打断，实际535/532 pass/1 fail/2 cancelled、exit=1，保留在 `evidence/p2-016-closeout-regression-interruption.md`。醒来后未修改业务代码、测试超时或断言，相关诊断3/3通过，再执行上述535/535全量通过；不以子集替代全量。

现场 App/Worker/Gateway 三角色及控制器/TLS 一个进程，角色池 4/2/1+控制器1；独立只读审计短连接 max1，采样总连接峰值7。业务 RSS 峰值247738368、含控制器峰值326844416 bytes；Timer 峰值4/2/3、Socket 峰值14/2/3，停止后所属进程/监听为0。资源结果不是24小时 soak 或真实2C4G硬件认证。

## 收口一致性与清理

负责人批准的现场候选为 `3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`。在收口前冻结377个输入文件清单；此后仅三个治理 Validator 与四个治理测试文件变化，业务 Runtime/HTTP/UI/SQL/Contract/Sender/其余测试均不变。最终全输入指纹在同名 JSON，完成态 Validator 比对精确文件集合和未放行文件哈希；允许差异列表硬编码，不由 Evidence 自行扩大。

最终静态门禁全部exit=0：P2-016 142项（DONE完成Evidence检查=true）、V1.4 397项及16/16测试、ARCH-006 260项；ARCH-005日期格式/偏移泄漏/直接pg工厂绕过/时区显示/排序违规均0。提交前diff --check通过；冻结migration001–030、P2-007 Runtime、旧完成Evidence、archive及.env.pilot变更均0。153个交付文件扫描6个本地敏感值（含连接URL的密码分量），命中0；报告不记录敏感值。

现场测试库已彻底删除；原配置库保留。收口回归后18:40:56独立只读复核：测试数据库/连接、测试子进程、所属浏览器进程、43116/43117监听、本轮browser profile均0；测试记录SSE停止后0，审计池已关闭。原配置库只读status仍为P2_016_REQUIRES_030（预期exit=1，未迁移）。旧策略阻止的目录/profile、非profile临时根目录保留，未换方式删除；三次收口/诊断根分别保留3/0/5个非profile项目，不声称完整文件系统清理。脱敏证据保留，企业微信合成消息和用户应用未删除。

关闭方式：所有默认 Feature Flag=false；停止新增 Route/Policy/Sender/Worker，保留原有人工服务链，不执行破坏性 down migration。无生产/临床开关开启。

## 最终机器状态与停止线

P2 继续 IN_PROGRESS；last_completed_task=P2-016，last_completed_gate=P2-G1，last_completed_architecture_task=ARCH-006；active_task/active_lane=null；下一候选P2-012，next_task_authorized=false。P2-012仍TODO_REQUIRES_SEPARATE_AUTHORIZATION，P2-G2及以后NOT_STARTED，P2-008仍TODO_BLOCKED_BY_P2_G2，P3未启动。

没有未解决的P2-016现场功能阻塞；已列明的Internal Beta/强身份/群强@/旧临时目录限制保持可见。AI/DeepSeek/OCR调用=0，Incident创建/关联/广播=0；所有持久默认Feature Flag=false。唯一第二本地提交后立即停止；未push、PR、merge、tag或release。
