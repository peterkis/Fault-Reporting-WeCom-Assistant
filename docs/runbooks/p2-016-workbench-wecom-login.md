# P2-016 管理工作台企业微信扫码登录运行手册

## 范围

本手册记录管理工作台的企业微信 Web 登录实现，不改变现有成员入口 `/wecom/yixiaoxiu/`，也不打开 Gateway、Sender、AI 或真实外部通知。

管理工作台仍由现有 P2-016 App 进程提供，Node 只绑定 `127.0.0.1`；公网接入必须由独立 Nginx/HTTPS 代理完成。当前仓库实现不等于云端已部署或已获得公网写操作批准。

## 登录链路

```text
GET /workbench
  -> GET /workbench/login
  -> login.work.weixin.qq.com/wwlogin/sso/login
     login_type=CorpApp, appid=CORP_ID, agentid=APP_ID,
     redirect_uri=https://<public-origin>/workbench/callback, state=<one-time>
  -> GET /workbench/callback?code=<one-time>&state=<one-time>
  -> gettoken + auth/getuserinfo
  -> batch/userid_to_openuserid 映射到已有 Pilot Principal
  -> PostgreSQL 会话
  -> 303 /workbench
```

`state` 与 `__Host-wecom_workbench_intent` 浏览器绑定，5 分钟过期且只能消费一次。OAuth `code` 只交给服务端解析；日志和审计只保存结果类别、原因码、Principal/身份哈希与时间，不保存 raw userid、code、state 或 token。

登录回调采用单并发准入；忙时在消费 state 前返回 `503 WORKBENCH_AUTH_BUSY`，用户可刷新当前回调重试。已调用 Provider 的 code 不自动重放；Provider 超时仍未结束时继续拒绝新的回调准入。

App 对登录开始和回调分别限制每分钟 30 次，超额在写库前返回 `429 WORKBENCH_AUTH_RATE_LIMITED`。预算为进程全局固定窗口，不信任代理 IP；进程重启会重置窗口。现有单 App 部署适用，多副本时需重新设计共享限流。

## 身份与权限

启动时只读取 `pilot_ticket.pilot_principal` 中 `is_active=true` 且拥有 `HANDLER`、`DISPATCHER` 或 `ADMIN` 的有限白名单，按最多 32 个一批调用官方 `batch/userid_to_openuserid`。运行时只接受转换后的 `open_userid`，转换失败、缺失、重复或数量不一致时整个登录端口保持未就绪。

登录只映射已有 Principal，不自动创建账号、不按企业微信应用可见范围授予角色。每次 API 请求重新读取 Principal 的启用状态和角色；停用或移除工作台角色后，当前会话被撤销并拒绝后续请求。

## 持久会话

迁移 `035_p2_016_workbench_wecom_auth` 创建：

- `pilot_ticket.workbench_auth_session`：会话 token/CSRF 哈希、Principal、8 小时绝对过期、30 分钟空闲过期、撤销状态；
- `pilot_ticket.workbench_login_intent`：一次性 state、浏览器绑定和回调目标；
- `pilot_ticket.workbench_auth_event`：脱敏登录、拒绝、OAuth 错误、退出、过期和撤销审计。

Cookie 使用 `__Host-`、`Secure`、`HttpOnly`、`SameSite=Lax`；CSRF Cookie 为非 HttpOnly，仅用于双提交校验。API 未认证固定返回 JSON `401`，不跳转 OAuth；写请求要求精确 Origin、非跨站 Fetch Metadata、幂等键、CSRF 和既有版本校验。

新增身份审计摘要使用 `PILOT_LOG_IDENTITY_HASH_KEY`（至少 16 bytes）的 HMAC-SHA256，并绑定企业、应用和用途。旧审计摘要不回填；密钥变更影响新摘要，不改变会话凭证校验。

App 初始化后每分钟串行执行技术记录清理，每表每批最多 200 行：删除过期 login intent；删除超过 30 天的认证审计；删除已绝对过期且无剩余审计引用的会话。有效会话、最近审计及业务事实保留。清理失败只记录固定错误事件，并在下个周期重试；关闭 App 会等待本轮清理结束。本次没有改写 035 或新增业务迁移。

## 配置

真实值只放私有 `.env.pilot`，不要提交：

```dotenv
CORP_ID=<企业ID>
APP_ID=<代开发应用AgentId>
APP_SECRET=<代开发应用Secret>
WORKBENCH_WECOM_LOGIN_ENABLED=false
WORKBENCH_PUBLIC_ORIGIN=https://cd3120.mobimedical.cn
WORKBENCH_EXTERNAL_SEND_ENABLED=false
```

开启登录前必须先确认企业微信应用可信域名包含 `cd3120.mobimedical.cn`，并确认回调 URI 与 `WORKBENCH_PUBLIC_ORIGIN` 精确一致。`WORKBENCH_EXTERNAL_SEND_ENABLED` 保持 `false` 时，投递 retry/reconcile 服务端稳定返回 `WORKBENCH_EXTERNAL_SEND_DISABLED`；该开关不继承任何 P2-G2 现场发送批准。

## 迁移与验证命令

以下命令需要在目标数据库上下文中执行。`--check` 校验并回滚，`--status` 检查迁移标记。2026-09-22 经负责人授权，已完成云端 035 迁移、公网管理路由配置与 A 扫码回调验证，见 [本次现场记录](../../evidence/p2-016-workbench-wecom-live-20260922.md)。该历史记录仅证明所列验证范围；后续修复的部署与验收须记录对应版本。

```powershell
npm run p2:016:workbench-auth:status
npm run p2:016:workbench-auth:check
npm run p2:016:workbench-auth:migrate
npm run test:p2:016:workbench-auth
npm run test:p2:016:workbench-auth:integration
```

应用启动前应先完成 035 迁移并完成身份映射初始化。若映射摘要不存在、数据库 marker 缺失或 Provider 调用失败，`/health/ready` 不通过，登录端口返回 `WORKBENCH_AUTH_NOT_READY`，不得通过 Nginx 暴露。

## Node 路由与代理边界

需要与代理 allowlist 同步的管理页面/资源为：

```text
GET  /workbench
GET  /workbench/
GET  /workbench/login
GET  /workbench/callback
GET  /workbench/lifecycle
GET  /workbench/incidents
POST /workbench/logout
GET  /static/workbench/*
GET  /api/workbench/*
GET  /api/conversations/*
POST /api/conversations/*
GET  /api/tickets/*
POST /api/tickets/*
GET  /api/manual-reviews/*
POST /api/manual-reviews/*
GET  /api/contact-journeys/*
GET  /api/realtime/events
```

`/api/` 不得全量代理；`/health/*`、metrics、成员入口和其他内部路由不纳入公网 allowlist。SSE 使用 HTTP/1.1、关闭 buffering、较长 read timeout，且不接受 query token；断线由前端既有轮询回退。

## 分阶段上线停止线

1. 本地/隔离数据库：完成单元、Contract、PostgreSQL 和浏览器验证；确认成员入口、Bot 路径和测试认证不回归。
2. 云端停止态：备份 Nginx、数据库和 release；应用 035；启动 App/Worker 但不开放 Nginx；先通过 loopback 或 SSH 隧道验证回调、刷新、退出、角色变更和管理动作。
3. 受控公网验证：由负责人单独批准后，才开启登录开关与精确代理路由；逐一验证 A/B、未知成员、错误/重复 state/code、CSRF、会话过期、SSE 和 provider send count=0。
4. 正式评估：必须有当前候选指纹、真实扫码与跨成员拒绝证据、备份恢复演练、2C4G 观察、安全响应头/HTTPS 核验和 Owner 对公网写操作的明确批准。

回退不执行 down migration：撤销会话、关闭登录/代理路由、停止 App/Worker，并恢复备份的 release/Nginx 配置。外部通知是否启用必须另走既有 P2 Gate。
