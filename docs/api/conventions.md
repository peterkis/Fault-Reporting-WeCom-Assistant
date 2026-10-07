# 公共约定与 HTTP 宿主

返回 [接口导航](README.md) · [完整路径索引](endpoint-index.md)

## 宿主与装配

索引中的宿主编号是检索标签，不是新增服务或端口配置。相同路径在不同 profile 下可以有不同契约，不能仅按 URL 前缀推断身份。

| 编号 | HTTP 宿主 / 装配 | 接口范围 | 入口源码 |
| --- | --- | --- | --- |
| W | 内部 Conversation Workbench；G1 → P2-016 → P2-012 逐层扩展 | `/api/conversations`、`/api/tickets`、复核、Incident、WEB01、SSE、内部静态页面 | [G1 runtime](../../src/p2-g1-runtime.mts)、[P2-016 runtime](../../src/p2-016-runtime.mts)、[P2-012 assembly](../../src/p2-012-workbench-assembly.mts) |
| M | 医小修成员 HTTP handler；member self-service 独立宿主或 FULL_SERVICE_LOOP 中的 W 扩展 | `/wecom/yixiaoxiu/`、`/api/yixiaoxiu/`、成员 Reporter 读取 | [self-service runtime](../../src/yxx-self-service-runtime.mts)、[native handler](../../src/yxx-self-service-native-http.mts) |
| O | OAuth-only / 成员只读 profile 的替代宿主 | 成员认证页面和条件 Reporter 读取；不等于 M 的报修写入能力 | [OAuth server](../../src/p2-g2-wecom-oauth-server.mts) |
| P | 历史 P1 Pilot access/workbench 与 foundation 独立宿主 | 试点工作清单、Ticket 动作；foundation healthz 另有宿主 | [Pilot access/workbench](../../src/p1-009-pilot-access-workbench.mts)、[foundation](../../src/p1-001-pilot-foundation.mts) |

W 原生宿主的处理顺序是：未认证扩展 → 可用的 health provider → 静态资源（`/workbench/app/` 先验身份）→ `/api/` 的 enabled/认证检查 → 已认证扩展 → G1 会话与 SSE → 404。[HTTP server](../../src/p2-006-workbench-http.mts) 是实际顺序依据。P2-012 在 P2-016 外面增加 Incident 路由；成员 handler 可以在 `/api/` 的内部坐席认证前处理成员请求。

Base URL 从宿主配置取得，浏览器使用同源相对路径。内部 W 的监听 helper 限定 loopback；Reporter/成员公开 origin 必须遵循各自配置及 HTTPS 规则。不得把测试随机端口、当前云域名或 P1 origin 写成所有 API 的固定地址。

## 认证与权限

| 调用域 | 身份 | 写入约束 |
| --- | --- | --- |
| W 内部工作台 | 注入的 `WorkbenchAuthenticationPort`，Cookie 或 Bearer；数据库中的活动 ADMIN / DISPATCHER / HANDLER 再授权 | Cookie：精确 Origin、非 cross-site、`X-CSRF-Token`；Bearer：`Authorization: Bearer <token>`；具体对象权限仍由服务端判断 |
| M 成员自助 | 企业微信 OAuth Cookie `__Host-wecom_session`；成员映射、绑定、当前 write_flag | 精确 Host/Origin、非 cross-site、bootstrap 的 CSRF；开关与 profile 同时满足，写后再次核验授权 |
| Reporter | `LEGACY_BOUND_GRANT` 的绑定访问 Cookie，或 `MEMBER_REQUIRED` 的 OAuth Cookie | Reporter 读取能力不授予工单写入；成员模式禁用旧 Grant exchange |
| P 历史试点 | 注入的Pilot authenticator返回actor.id/type | 具体流程见平台入口；没有新增公开邀请/Session HTTP服务；不用于给新管理端旁路授权 |

W 拒绝 URL 中的 `access_token`、`token`、`authorization`。M 不接受前端声明 reporter/principal 身份。bootstrap 中的 capabilities / allowed_actions 用于显示可用操作，服务端每次仍核对数据库权限。`401` 应重新认证；`403` 不应自动换一种身份重试。

## 请求、响应与错误

W 写入要求 `application/json` 对象，32 KiB 上限，URL 2048 bytes。M 新报修 16 KiB、补充 8 KiB、退出 1 KiB；旧成员 Reporter bridge 为 2 KiB、旧 Grant handler 为 1 KiB。字段白名单与各模块规则优先，未声明字段通常被拒绝。

实际 API 通常直接返回业务对象。不要给所有响应补造 `trace_id` 或 `{data: ...}`。通用失败外壳为：

```json
{"error":{"code":"WORKBENCH_VERSION_CONFLICT","retryable":false}}
```

| HTTP | 处理方式 |
| --- | --- |
| 200 / 201 / 202 | 按模块读取对象；202 表示已受理/入队，不能推断业务处理或外发完成 |
| 304 | ETag 命中，无 JSON 正文；使用已有缓存（仅相应详情/时间线接口支持） |
| 400 / 413 / 414 / 415 | 输入、长度、Content-Type；修正输入再提交 |
| 401 / 403 | 身份或权限；不能以轮询/刷新循环掩盖 |
| 404 | 路径不存在、对象不可见或不可用；具体业务中还可能是恢复查询的暂未发现 |
| 409 | 版本、动作、幂等内容冲突；重新读取权威状态，不盲造新命令重试 |
| 429 / 503 / 5xx | 以接口错误码判断容量/不可用；不要把缺失的能力视为成功 |

命令服务可能返回 `{ok:false,error,replayed}`，也可能抛出通用错误外壳。网络请求完成后必须同时检查 HTTP status 和业务 `ok`。稳定码族分别为 `WORKBENCH_*`、`P2_016_*`、`P2_012_*`、`YXX_*`、`WECOM_*`、`CONVERSATION_REALTIME_*`。

## 幂等与并发版本

W 一次用户意图生成一个 UUID `client_command_id`，Header `Idempotency-Key` 与 body 一致（UUID 比较允许大小写归一）。重试保持同一 ID 和原 payload。会话动作要求 `expected_row_version` **number** 与 `If-Match` 一致；工单 `expected_version` 为 **number**；人工复核和 Incident 版本为 **十进制 string**。复合接管分别携带会话和工单版本。

M `Idempotency-Key` 必须精确等于 `client_command_id`；补充另有 **string** `expected_input_revision`，不用工单的 `expected_version` 或 W 的 `If-Match`。命令恢复查询和成员 `recovery_scope` 见 [成员契约](member/self-service.md)。

不把 ETag、会话版本、工单版本、输入修订和 SSE event ID 混为同一计数器。W 一些路由接受弱/裸数字 If-Match，而 Incident 要求精确 `"版本"`，具体见模块。

## 时间、分页与数据边界

业务时间按 [ARCH-005](../48_arch_005_asia_shanghai_time_contract.md) 使用 Asia/Shanghai 本地秒精度 `YYYY-MM-DD HH:mm:ss`（日期与时间之间是空格）；物理毫秒使用十进制字符串。避免浏览器自行添加 `T`/`Z` 或把 BIGINT 转为不安全 number。

分页游标是服务端生成的不透明值；原样传回，换过滤器清空 cursor。不同模块有不同上限：会话列表 100/时间线 200，工单列表 100/事件 200，成员报修列表 50/时间线 100。内部查询的授权条件在 LIMIT 前应用。

内部备注、原始身份绑定、OAuth code/token、provider 原始响应、患者内容不进入公开 Reporter/成员接口或日志示例。内部 `reporter-contact` 有授权内的联系资料，见工单文档；它不能复用为成员 profile API。SSE、Redis、投影和浏览器缓存不是 Ticket 事实源。
