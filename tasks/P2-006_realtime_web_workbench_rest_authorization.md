# P2-006 Realtime Web Workbench, REST Command and Authorization

- 状态：DONE
- 授权日期：2026-09-01
- 完成日期：2026-09-01
- 授权 Evidence：`evidence/p2-006-start-authorization.md`
- 完成 Evidence：`evidence/p2-006-realtime-workbench-report.md`
- 基线：`6afe8157bfcae49d391d0f6e2aa5c60388377ea5`
- Lane：P2-B
- 目标 Gate：P2-G1（本任务不启动 Gate）
- 依赖：P2-002、P2-003、P2-005
- 数据库变更：无
- Feature Flag：全部继续为 `false`；隔离测试只允许构造参数注入 `enabled=true`

## 输入

- P2-002 持久 Timeline Query / visibility Contract；
- P2-003 durable Realtime Event Log 与 `createRealtimeSseHandler`；
- P2-004 Communication Message / Outbox / Delivery Port；
- P2-005 Assignment / Handoff / Read Cursor / Generation Fence Port；
- migration 006 的 Pilot Principal / Role / Team 兼容身份；
- Unified Ticket Core 只读事实。

## 输出

- Node 原生 HTTP REST API 和安全错误 Contract；
- 注入式 `WorkbenchAuthenticationPort` 与 Pilot 授权 Adapter；
- 会话列表、详情、Timeline、eligible principals 和安全 Delivery 查询；
- Takeover、Handoff、Transfer、Release、Read Cursor、人工回复、内部备注 Adapter；
- Delivery retry/reconciliation 控制面；
- 复用 P2-003 的 SSE Route 与安全 Polling fallback；
- 原生 HTML/CSS/ES Module Internal Alpha / Reference Client；
- Unit/Contract、PostgreSQL/HTTP、系统浏览器与容量/资源 Evidence。

## Schema / Contract

新增 Workbench bootstrap/page/detail/delivery/error JSON Schema、TypeScript declarations，并扩展 OpenAPI 3.1。不得改写 P2-001 至 P2-005 冻结 Contract 的语义。

## 数据库边界

不创建 migration 022，不 ALTER 既有表，不创建 Workbench/Auth/Principal/Session/User Preference/Browser Cursor 表，不创建 Function/Trigger/Extension。Catalog snapshot 必须证明 P2-006 前后 Schema、Table、Column、Constraint、Index、Function、Trigger、Extension 集合不变。

## 安全与隐私

- 服务构造必须注入 authenticate；Cookie 写命令校验精确 Origin、Sec-Fetch-Site 与常量时间 CSRF；Bearer 不接受 query token；
- 每次授权从数据库 Principal/Role/Team 重新裁剪，SQL 在 LIMIT 前完成权限过滤；
- 公开响应不含 provider/user/chat/target 标识、原始错误、秘密或患者信息；
- UI 只用安全 DOM API，不使用 `innerHTML`、`eval`、外部 CDN 或远程字体；
- 内部备注不得创建 Outbox/Delivery，浏览器不保存正文、Token 或 CSRF Secret。

## 资源上限

App/API/SSE 一个进程，无新增常驻 Worker、Redis、消息队列、ORM 或前端构建进程；应用 pool 建议不超过 8、测试 pool 不超过 4；会话页最大 100、Timeline 最大 200；单 EventSource、单 Poll Timer、请求可取消。

## 测试与 Evidence

必须完成 OpenAPI/Schema/Route、认证/CSRF/授权、keyset/timeline 分页、命令幂等、Delivery、SSE/Polling、XSS/a11y、无迁移 Catalog、500 Session/10,000 Item、性能和系统 Edge/Chrome 两个 viewport 的真实执行，并回归 P1-009/011/012 与 P2-001 至 P2-005。关键验收失败则保持 IN_PROGRESS。

## Rollback / 关闭

保持 `HUMAN_WORKBENCH_V2_ENABLED=false`、`CONVERSATION_CENTER_ENABLED=false` 和 `CONVERSATION_REALTIME_SSE_ENABLED=false`。关闭时 API/SSE 不访问数据库、不启动 Worker、不调用 Sender；删除/撤回 P2-006 Adapter 不影响既有 P1/P2 事实。

## 停止线

项目负责人正式、独立授权启动 P2-006。
完成 P2-006 后必须停止。
P2-G1 组装、P2-007 及以后任务和所有生产功能仍须另行授权。

## Comments

- 2026-09-01：P2-006 的 Contract、REST、授权裁剪、Human-only 命令、Delivery 控制、SSE/Polling、Reference Client、隔离 PostgreSQL/HTTP、系统 Edge 和全仓串行验收均已完成；状态更新为 `DONE`。
- 当前无活动任务或 Lane。P2-G1 保持 `NOT_STARTED / REQUIRES_SEPARATE_AUTHORIZATION`，P2-007 及以后保持未授权，所有 P2/P3 Feature Flag 保持 `false`。
- 此完成结论不代表最终生产前端、真实企业微信发送、真实医院身份/内网、AI、Media/OCR、Incident、生产或临床上线。
