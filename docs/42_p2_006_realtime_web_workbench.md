# P2-006 Human-only Workbench Internal Alpha

## 定位与范围

P2-006 提供可运行的 Human-only Conversation Center 内部 Alpha 和 Reference Client，用于验证 REST、数据库授权、Timeline、P2-004 Communication、P2-005 Control 与 P2-003 SSE 的闭环。它不是最终生产前端，不冻结框架、组件库、Design Token、品牌、发布流水线或全院 UX。

P2-006 没有数据库结构变更，不存在 migration 022，不建立登录、Workbench Session、用户偏好、浏览器 Cursor、AI、附件或 Incident 表。migration 006/010/011/012/020/021 保持权威且未改写。

## HTTP 与认证

`createConversationWorkbenchHttpServer` 使用 Node 原生 HTTP。构造时必须注入 `WorkbenchAuthenticationPort.authenticate`；未认证或过期返回 401，不存在、停用或非内部工作角色返回 403。Cookie 写请求要求 Public Origin 精确匹配、`Sec-Fetch-Site` 非 cross-site、常量时间 CSRF 比较；Bearer 只接受 Authorization Header，URL token 一律拒绝。

API 响应使用严格 CSP、nosniff、DENY frame、no-referrer、Permissions Policy 和 no-store。写请求只接受 JSON，正文上限 32 KiB，URL/查询参数、字段集合、Idempotency-Key 与 If-Match 均受限。原始异常不进入公开错误。

## 数据面授权

`createPilotWorkbenchAuthorizationAdapter` 每次从 Pilot Principal/Role/Team 读取当前身份，不信任浏览器角色、团队或显示名：

| 角色 | 数据范围 | 特权 |
| --- | --- | --- |
| ADMIN | 全部 Pilot Conversation | force transfer、显式 Reconciliation |
| DISPATCHER | 全部 Pilot Conversation | 普通分配/转派，不得伪装 ADMIN |
| HANDLER | 分配给自己或其 Team 有权接管的 Session | 不得跨组、force transfer 或 Reconciliation |
| REPORTER/停用身份 | 不得进入内部 Workbench | 统一拒绝 |

Session 无可判断 Team 的 Ticket 时，HANDLER 默认拒绝；ADMIN/DISPATCHER 按 Pilot 明确策略访问。列表 SQL 在 `ORDER BY/LIMIT` 前裁剪权限，浏览器只收到内部 principal id、display name 和动作集合。

## Query、分页与状态

列表支持 `open`、`waiting_human`、`mine`、`unassigned`、`waiting_user`、`failed_delivery`、`ended`。默认 30、最大 100，按 `last_activity_at DESC, session_id DESC` 稳定排序；opaque base64url cursor 仅含规范时间与内部 Session id，不使用 OFFSET，也不作为授权依据。

Timeline 默认 50、最大 200，支持互斥的 `before_sequence`/`after_sequence`。普通 Workbench 只读 EXTERNAL/INTERNAL，RESTRICTED 仅 ADMIN 可见。前端数组分别限制为 200 个会话和 400 个 Item。

Ticket Panel 只读 Unified Ticket Core。Incident 与附件返回 `available=false`，相应路由使用稳定 unavailable 错误，不伪造事实或 URL。

## 命令与投递

Workbench Command Facade 不直接写领域表：接管、Handoff、转派、释放、Read Cursor 调用 P2-005；人工外部回复与内部备注调用 P2-004。外部回复在 Message/Outbox/Delivery 提交后返回 202，不等待 Sender；内部备注返回 201 且不创建 Outbox/Delivery。

Delivery Adapter 对 PENDING 采用幂等 no-op，对 `DEAD_LETTER + NOT_ATTEMPTED` 允许受控 requeue；UNKNOWN/RECONCILIATION_REQUIRED 禁止普通 retry，只有 ADMIN 可作显式 reconciliation。浏览器双击依赖冻结的 client command idempotency，不以按钮禁用替代服务端幂等。

## SSE 与 Polling

`/api/realtime/events?scope=workbench` 复用 P2-003 Handler 和授权范围。SSE 不接受 query token，到认证过期时间主动断开；授权失败不伪装成 polling。容量、临时不可用或断线时 Reference Client 切换到单个 5 秒 Poll Timer，并在恢复数据后按 Detail/Timeline refetch 收敛。

## UI、安全与可访问性

三栏桌面布局在 390×844 切换为列表/会话单屏和抽屉详情。原生 HTML/CSS/ES Module 使用语义标题、label、live region、44px 控件、键盘 focus-visible 和 reduced-motion。所有不可信文本经 `textContent/createTextNode` 渲染；源码不使用 `innerHTML`、`eval`、inline script/style。

浏览器刷新只在 sessionStorage 保存 filter 与内部 selected session id，不保存正文、身份表、Cursor 或外部标识。选中会话变化会中止旧请求；页面只维护一个 EventSource 和一个 Poll Timer。

## 2C4G、预览与关闭

实现不增加常驻 Worker、Redis、消息队列、ORM、构建进程、Socket.IO 或模型。测试 Pool `max<=4`；应用建议总连接不超过 8。`p2:006:preview:check` 只做静态自检；`p2:006:preview` 必须显式设置 `P2_006_PREVIEW_APPROVED=true`，只绑定 `127.0.0.1` 并使用合成端口。

TypeScript 迁移后，先运行 `npm run migration:build`；两个预览命令均先校验当前制品，再执行 `.build/runtime/scripts/p2-006-preview.mjs`。制品缺失或与源码不匹配时须重新构建，命令不会回退到源码执行。

回滚/关闭方式是保持 `HUMAN_WORKBENCH_V2_ENABLED=false`、`CONVERSATION_CENTER_ENABLED=false` 与 `CONVERSATION_REALTIME_SSE_ENABLED=false`。关闭时 API 零数据库访问、零命令写入、零 SSE、零 Worker/Sender 调用，并返回安全 Disabled 页面或 503。

## 停止线

P2-006 DONE 只表示内部 Alpha 的 API、权限和 Human-only 流程具备 P2-G1 候选条件。P2-G1 仍为 `NOT_STARTED / REQUIRES_SEPARATE_AUTHORIZATION`；P2-007、生产前端、真实入站 Projector、真实 Sender、医院身份、AI、Media/OCR、Incident 与 P3 均未启动。
