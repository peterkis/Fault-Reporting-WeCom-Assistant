# 认证、页面、健康检查与历史试点

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

本页同时列 JSON、HTML 和重定向入口；必须按响应 Content-Type 使用。具体 profile 决定 handler 挂载，不能把所有路径视为同一运行实例。

## 内部员工登录（W）

[实现](../../../app/server/src/p2-016-workbench-wecom-auth.mts)；[装配](../../../app/server/scripts/p2-016-process-role.mts)。`WORKBENCH_WECOM_LOGIN_ENABLED` 默认关闭；启用还要求应用配置、approved员工列表/映射、内部public origin。其他宿主构造时须显式注入这个认证端口。

| METHOD + PATH | 请求 | 响应 |
| --- | --- | --- |
| `GET /workbench/login` | 无query | 302 到企业微信员工扫码SSO；设置一次性state/浏览器绑定 |
| `GET /workbench/desktop` | 无query，仅GET，错误方法／query返回400 | 新桌面入口；有效员工会话303到 `/workbench/app/`，否则沿原扫码 intent 固定返回该路径；无任意return_to |
| `GET /workbench/desktop/embedded` | 无query，仅GET，错误方法/query返回400 | 已认证303工作台，否则200独立公开登录壳；同一5分钟intent/state及HttpOnly绑定，官方面板回调仍走原callback |
| `GET/HEAD /workbench/desktop/assets/{hashAsset}` | 仅本次登录构建清单的JS/CSS，无query | 独立公开登录资源；未知404、非法400，不放开业务SPA资产 |
| `GET /workbench/callback` | 仅code/state、各一次 | 成功303 return_path，Set-Cookie；失败返回公开认证码 |
| `POST /workbench/logout` | 无query；同源Origin、非cross-site；有session时需当前Cookie与X-CSRF-Token校验；既有UI不带body | 200 `{logged_out:true}`，清员工session/CSRF Cookie |

Cookie：`__Host-wecom_workbench_session`、`__Host-wecom_workbench_csrf`。code/state不可记录到示例、日志或浏览器业务存储。登录成功仍需数据库活动内部角色与对象权限。[测试](../../../tests/p2-016-workbench-wecom-auth.test.mjs)。

桌面 PC 页面收到认证失效 401 时，先沿既有撤权流程清空旧界面、关闭提醒并完成恢复副本清理，再自动调用原桌面扫码入口。无需点击中间的失效页；清理失败保持关闭，403 权限不足与网络/服务故障不触发自动扫码，业务 POST 不会自动重放。普通浏览器的被动认证失效保持原语义。显式退出收到成功回执且恢复副本清理确认后，PC直接进入固定 `/workbench/desktop` 扫码入口；退出结果未知或清理失败保持关闭并提供核对入口，不自动重放退出或业务命令。

身份bootstrap为 `/api/workbench/bootstrap` 和 `/api/lifecycle/bootstrap`，见 [会话](../workbench/conversations.md)、[工单](../workbench/tickets.md)。没有公开 `/auth/wecom`、`/auth/bootstrap` 或test-auth HTTP登录；测试身份是注入端口/IPC。

PC当前人员资料：`GET /api/workbench/profile`，只允许现有内部Cookie身份，无query/body，响应 `{name:string|null,department:string|null}`。bootstrap广告 `current_profile_available:boolean`，仅配置原企业微信资料读取Port时为true。读取使用启动时核验的内部principal→应用open_userid映射，经原有有界Provider调度器获取姓名和主部门；等待前后再次核当前会话/内部权限。身份标识、手机号、token、部门ID不返回；核验成功且姓名有效时，仅将该员工的显示姓名同步到既有内部principal，供工单处理人、沟通责任及人员选择统一显示；写入语句再次核验同一会话、当前内部权限及启动时确认的原始人员ID。不会更换principal／企业微信身份、角色、团队或历史操作主体，也不修改目录及报修快照；暂时失败或缺少姓名保留已有名称。未配置返回503，真实会话失效返回401/403，临时资料失败不伪造姓名。前端按当前员工和授权版本使用独立内存Query，staleTime和gcTime均为五分钟，切换标签保留最近成功呈现；权限拒绝和退出仍清空，不加入每5秒业务刷新。

T03 的 lifecycle bootstrap 增加 `logout_enabled:boolean`，默认false；实际员工认证端口声明 `supportsLogout:true`、已完成 initialize，且当前 Cookie 身份有 CSRF 时才广告退出。React 调用上述真实 `/workbench/logout`，只有闭合200 JSON `{logged_out:true}` 才显示已退出；请求结果不确定显示“退出结果尚未确认”，清界面与本应用已知主体恢复副本，并要求重新核验，不能宣称服务器session已撤销。同profile其他标签接收无正文／凭据的退出失效信号；实际服务端撤销、旧Cookie401与合成TLS证据见[T03记录](../../../plans/admin-workbench-integration/execution/t03.md)。test-auth不会广告真实退出。

## 企业微信成员OAuth（O/M/W按模式）

[OAuth handler](../../../app/server/src/p2-g2-wecom-oauth-http.mts)、[web OAuth](../../../app/server/src/p2-g2-wecom-web-oauth.mts)。条件：`WECOM_WEB_OAUTH_ENABLED`，member读取/写入另需自身Flag。默认关闭。

| METHOD + PATH | 请求 | 响应 |
| --- | --- | --- |
| `GET /wecom/yixiaoxiu/login` | 旧模式无 query；显式 H5 模式可带唯一 `return_to`，仅白名单 SPA 页面及有界筛选 | 302 到成员 OAuth，scope=snsapi_base；目标只保存在不透明服务端 intent |
| `GET /wecom/yixiaoxiu/callback` | 仅code/state、各一次 | 303合法returnPath，替换成员session并设置Cookie |
| `GET /wecom/yixiaoxiu/` | 无query，或限定 `auth_return=1` | OAuth-only为认证HTML/302；旧 auth_return 成功303清query；新版 H5 为无成员数据的应用壳，由 entry 核验当前成员 |
| `POST /wecom/yixiaoxiu/logout` | OAuth-only：同源Origin、非cross-site；member/native：空JSON `{}` | OAuth-only 200 **HTML**；member/native 200 **JSON** `{logged_out:true}`；不能跨profile假定响应格式 |

Cookie：`__Host-wecom_oauth`、每state的 `__Host-wecom_intent_<state>`、`__Host-wecom_session`；HttpOnly/Secure/SameSite=Lax/Path=/。state 与 code 仍为 5 分钟且一次性。旧模式 session 15 分钟、浏览器绑定 20 分钟。P2-016 显式 H5 装配采用 8 小时空闲／24 小时绝对上限，成功完成 entry 当前资格及等待后终检后续期，保持 SID／CSRF／恢复范围。认证寿命不替代每次业务权限核验。

H5 401 可在无草稿／UNKNOWN 栅栏时单次自动 `snsapi_base` 认证；成功回 `/wecom/yixiaoxiu/?auth_return=1#<白名单页面>`，由 entry 再核验，成功后客户端清标记。H5 callback 失败也回清洁应用壳显示可恢复提示；返回标记防止自动循环。403 不自动换身份重试，503 不视为撤权。没有浏览器 refresh_token；不自动重放业务 POST。白名单和前台恢复细节见 [ADR-0037](../../../adr/0037_h5_session_resume_and_navigation.md)。disabled 时仍为 503 HTML。

成员卡片的continue/tickets入口见 [Reporter](../member/reporter-access.md)。[测试](../../../tests/p2-g2-wecom-oauth-http.test.mjs)、[首页返回](../../../tests/yxx-ss-001-homepage-oauth.test.mjs)。

## 页面与静态资源

下表方法是客户端预期 GET。既有 W/P2 static handler 只接收pathname/response，未统一检查method/query；文档不宣称这部分严格限制GET。成员/Reporter与P1页面由各handler显式检查GET，见源码。

| 页面 / 资源路径 | 宿主 | 用途 / 条件 |
| --- | --- | --- |
| `/workbench`、`/workbench/` | W | 会话参考客户端；挂员工auth时无session进入登录 |
| `/workbench/lifecycle` | W | 工单/复核页面，生命周期扩展 |
| `/workbench/incidents` | W | Incident人工页面，Incident扩展 |
| `/workbench/app`、`/workbench/app/` | W | WEB01 React shell；先验内部身份与bootstrap，未认证401 |
| `/workbench/app/items/{kind}/{id}`（可尾斜杠） | W | WEB01详情deep link；kind=ticket/review/intake；同样先认证 |
| `/workbench/app/conversations`、`/workbench/app/conversations/{sessionId}`（可尾斜杠） | W | 正式集中会话页与主题deep link；UUID、先验身份，`workbenchConversationsEnabled=false` 默认不挂载；不是任意SPA路径回退 |
| `/workbench/app/assets/{buildAsset}.js` 或 `.css` | W | 仅当前asset-inventory中的编译资源，先认证；不是任意路径文件读取 |
| `/static/workbench/workbench.css`、`workbench.js`、`workbench-state.mjs`、`time-display.mjs` | W | 会话资源，完整前缀均为/static/workbench/ |
| `/static/workbench/lifecycle.js`、`lifecycle.css`、`incidents.js` | W | 生命周期/Incident资源 |
| `/wecom/yixiaoxiu/reports`、`/reports/new`、`/reports/{requestRef}`（均完整前缀/wecom/yixiaoxiu） | M | 成员自助页面，无query；ref32位opaque；缺Cookie可经有界OAuth首页返回 |
| `/wecom/yixiaoxiu/self-service.js`、`self-service.css` | M | 自助资源，无query |
| `/reporter/`、`/reporter/open`、`/reporter/reporter.js`、`reporter.css` | Reporter | 旧/成员Reporter资源，无query；shell可打开不代表数据授权 |
| `/`、`/static/pilot-workbench.css`、`/static/pilot-workbench.js` | P | 历史Pilot页面/内嵌资源 |

源码：[conversation static](../../../app/server/src/p2-006-workbench-static.mts)、[WEB01 static](../../../app/server/src/web01-workbench-static.mts)、[P2-016 runtime](../../../app/server/src/p2-016-runtime.mts)、[Incident assembly](../../../app/server/src/p2-012-workbench-assembly.mts)。原型/preview不是当前业务REST的新宿主，见 [差异](../design-and-gaps.md)。

## 健康与指标

| METHOD + PATH | 宿主 | 实际结果 |
| --- | --- | --- |
| `GET /health/live` | W，healthProvider存在 | 200/503，G1为 `{ok,service:'P2_G1_HUMAN_ONLY'}` |
| `GET /health/ready` | W，healthProvider存在 | 200/503，readiness对象；装配扩展可以增加各能力状态 |
| `GET /health/metrics` | W，metrics provider存在 | 200 **JSON** metrics；不是Prometheus文本 |
| `GET /health/live` | O/M替代OAuth server | 200 `{ok:true,mode,authenticated_callbacks,authenticated_pages}`，无query；Host不匹配421，URL过长414 |
| `GET /healthz` | P1 foundation独立server | 200 `{status:'ok',service:'pilot-foundation',phase:'P1'}` |

W handler通过注入provider返回对象，不能假定所有装配的readiness字段一致。当前G1 provider见 [runtime](../../../app/server/src/p2-g1-runtime.mts)、[observability](../../../app/server/src/p2-g1-observability.mts)；替代OAuth见 [server](../../../app/server/src/p2-g2-wecom-oauth-server.mts)。base_service_ready与ai_enhancement_ready须独立；健康技术结果不是Gate/生产批准。`GET /metrics` 没有当前主宿主handler，正确路径为 `/health/metrics`。

## P1历史Pilot业务API（P）

仍在仓库的独立 [Pilot server](../../../app/server/src/p1-009-pilot-access-workbench.mts)，不是当前W/M同origin API。认证器注入 `{id,type}` actor；读取按REPORTER本人/内部团队权限。内嵌浏览器只调用第一条GET。

| METHOD + PATH | 输入 | 响应 |
| --- | --- | --- |
| `GET /api/pilot/work` | 注入actor，无客户端分页契约 | 200 `{ok:true,items:[公开Ticket投影+reporter_wecom_userid+mobile_summary]}`；拒绝403 |
| `GET /api/pilot/tickets/{ticketId}` | UUID，actor | 200 `{ok:true,ticket,events[]}`；Ticket可加web_report，事件按角色裁剪；拒绝403 |
| `POST /api/pilot/tickets/{ticketId}/actions/{action}` | camelCase body：expectedVersion:number、traceId:string必需；note?、externalVisible?、reasonCode?、attachmentIds?；actor/action/ticketId由server注入 | 200 `{ok:true,ticket,event,side_effects}`；拒绝403，业务失败409，异常400 |

action允许 `queue|accept|start|request-information|resume|wait-vendor|resolve|confirm|reopen|cancel|add-note`，由领域服务做状态校验；auto-close显式403。旧HTTP wrapper没有W的Idempotency-Key/If-Match/CSRF协议，不能复用当前工单snake_case body；改建新功能应使用 [当前工单接口](../workbench/tickets.md)。

旧错误外壳 `{ok:false,error:{code,retryable:false}}`；UNAUTHORIZED401、FORBIDDEN403、NOT_FOUND404、VALIDATION_FAILED400等。合成示例 `GET /api/pilot/work` 可返回 `{"ok":true,"items":[]}`；不会创建第二套Ticket事实源。

核对：[P1 unit](../../../tests/p1-009-pilot-access-workbench.test.mjs)、[foundation](../../../tests/p1-001-pilot-foundation.test.mjs)、[operations](../../../tests/p1-011-pilot-operations-baseline.test.mjs)。本轮未启动历史试点或真实OAuth。

2026-10-29内嵌登录实施：新增入口保留原 `/workbench/desktop` 官方302回退；仅登录HTML以窄frame-src允许官方面板，同源打包SDK，Referrer-Policy为origin以供官方来源核验，不发送路径或state。原回调、Cookie、员工准入及session协议不变。先完成原生/真实扫码与等待恢复最小验证，再接入已确认的Lanyard工牌正面官方面板；阶段与实机结果见[实施记录](../../../plans/pc-admin-electron/embedded-login-2026-10-29.md)。

工牌页保留完整官方面板、平面视图和原官方入口。翻面/拖动只改变呈现；切换视图或三维环境失败时换一轮服务端intent，不移动并复用活iframe，不保存认证参数到展示偏好。100%以外的浏览器/显示缩放使用平面面板。公开资源仍严格受本次构建清单约束，动态资源也不放开业务SPA命名空间。
