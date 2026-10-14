# 当前查看与编辑活动（WBINT-T39）

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [实时事件](../platform/realtime.md)

2026-10-09 合同已冻结，当前为 `SOURCE_READY_FOR_ORIGINAL_RED / NOT_IMPLEMENTED`。以下路径是本票待挂载合同，不能按现有可用接口调用。本票全部七项条件仍待实现及验证；首条真实 HTTP RED 只是第一个行为切片。

## 输入、输出与限值

活动对象使用当前 WEB01 的规范事项 `{kind:ticket|review|intake,id:UUID}`，与详情实际返回的规范事项一致；关联沟通处理、复核或完工编辑提示归属其正在显示的该事项。来源群设置、列表预取、隐藏抽屉及未打开详情不产生对象活动。目标或字段不受权时不能发出活动。

宿主配置 `workbenchActivityEnabled:boolean=false`。`GET /api/lifecycle/bootstrap` 待增加 `activity_enabled:boolean` 与固定 `activity_limits`。仅当前有效 Cookie 身份、该开关和 `workbenchRealtimeEnabled` 同时启用时可用；不能以 body/browser_id/能力快照授予权限。Bearer、开关关闭和未组装路径不建立活动状态。

| 限值 | 数值及含义 |
| --- | --- |
| `lease_ttl_ms` | 15000；服务端接收且重新获权的 RENEW 才续租 |
| `heartbeat_ms` | 5000；复用 T38 单控制器节奏，无第二轮询器／timer／流 |
| `viewing_idle_ms` | 60000；实际进入可见详情或该详情内受信 pointer/key/scroll 活动之后，超过此值停止续租 |
| `editing_idle_ms` | 10000；受信 input/change 后的编辑提示期限，超过后降为合格查看或停止 |
| `max_objects_per_browser` | 2；每个浏览器标签随机 UUID，绑定当前认证主体／会话，不构成人员身份 |
| `max_browsers_per_principal` | 4；不因重复请求无限创建标签状态 |
| `max_browsers` / `max_leases` | 单 App 合计 64 / 128 |
| `max_leases_per_object` | 16；活动读取输出最多 16 人，先获权再输出，无隐藏计数 |

同一主体在多个标签中的活动去重为一人。只有当前主体和同事均仍获权查看该对象，才返回其当前安全 display_name、VIEWING/EDITING 与十进制 string `expires_epoch_ms`；排除请求人自己。不得输出 principal_id、browser_id、外部身份、角色、隐藏对象、全局人数、字段正文或字段名称。UI 文案为“正在查看／正在编辑”，不声称永久在线、领取或排他锁。

## 待挂载 HTTP／Schema

`POST /api/workbench/activity` 只接受 JSON、同源 Origin、当前 Cookie CSRF，禁止 query 参数。复用 W 现有认证／32KiB 正文上限／安全错误和 no-store；活动服务进一步拒绝非法字段、UUID、模式与上限。无 If-Match、业务 command ID 或 durable receipt；相同主体／浏览器／对象续租更新一个短租期，释放幂等。

请求见 [命令 Schema](../../../contracts/workbench_activity_command.schema.json) 与 [类型](../../../contracts/workbench_activity_contracts.d.ts)：

- `RENEW`：`schema_version:1,browser_id,action,target,visible:true,active:boolean,mode,field`。`active:true` 表示自上次发送后实际进入可见详情或有新的受信本地活动；普通心跳为 false，续租不能重置查看／编辑失活期限。服务端时钟记录首次／新活动，不能用浏览器时间戳延长租期。VIEWING 的 field 为 null；EDITING 只能是已显示且当前可编辑的 `internal-note|ticket-handling|ticket-completion|manual-review`，且仅新的受信 input/change 以 active:true 更新编辑期限；纯心跳超过10秒后降为当前合格查看。
- `RELEASE`：`schema_version:1,browser_id,action,target`。
- `RELEASE_BROWSER`：`schema_version:1,browser_id,action`，只释放该认证绑定的自有标签。

200 返回 `{schema_version:1,accepted:true,expires_epoch_ms:string|null}`；续租返回服务器期限，释放返回 null。400 非法输入；401 认证无效；403 身份／CSRF 或字段编辑权限拒绝；404 不存在／不可读对象共用；503 开关关闭或容量不可用。不能泄漏另一个主体的浏览器注册或目标存在性。

`GET /api/workbench/items/{kind}/{id}/activity` 无 query 参数，沿当前规范事项详情授权；返回 [活动 View Schema](../../../contracts/workbench_activity_view.schema.json)。任何续租、读取及发出 SSE 提示时，都重新检查当前主体与对应人员／对象权限；过期、失权人员在投影前移除。复核当前字段写权限时复用真实备注、处理、完工和复核公共服务授权，不能把 VIEWING 权限升级为 EDITING。没有可见详情的预加载 GET 不能续租。

## 租期、真实流与关闭

活动状态只在单 App 内存中有界保存；服务端公开 service 的 `now()` 端口使用可控时钟验证。读、写以及现有 SSE recovery 节奏执行有界清理，不增加常驻 timer。App 停止时 state 清零；不新增数据库表／迁移／池／Broker／进程，不往 Ticket、Conversation、Event、Read Cursor、Delivery 或其他业务事实表写心跳。普通认证会话的既有触达机制保持原语义。

唯一流仍为 `GET /api/realtime/events?scope=workbench`。待扩展命名帧 `event: workbench.activity.changed`，单行 `data: {"schema_version":1}`，无 id；不分配或替换 durable event_id，不进入 Event Log/replay/retention，也不改变 Last-Event-ID。只在当前主体仍获权的自有可见活动对象投影变化时发提示，不为隐藏对象变化广播信号。前端仅失效／重读该主体当前挂载的活动 GET，payload 不能成为姓名或业务事实源。与现有 durable writer 的有界 backpressure／断连清理一致。

真实详情 GET 成功、对应 DOM 已进入可视区域、document 可见且未离线，才可以建立查看。字段真正可见且可编辑，受信 input/change 才标 EDITING；预取、脚本设置值、单纯 focus、缓存或不可见内容都不算编辑。离开、后台、失活、原生流断开、退出或已确认失权立即清除本地提示并停止续租，能发送时尽力释放；发送失败仍在最后服务端租期后最多 15 秒消失。原生流断开本身不当作权限撤销，仍需当前授权和租期检查；SSE 单独失败不妨碍健康 REST 与人工业务命令。恢复后先完整当前授权／详情重验，再等实际可见活动重建，不恢复旧在线承诺。

成功退出移除该主体活动绑定；认证／对象失权拒绝也移除相应已有租期，晚到请求与旧 GET 不能恢复旧身份提示。关闭 `workbenchActivityEnabled=false` 不建立新活动内存或续租；UI 清提示，服务停止清空已有短暂状态，业务事实与 T38 REST/流原配置保持。

验证计划与原 RED／GREEN、被测 source／artifact、资源清理和七项状态见 [T39 执行记录](../../../plans/admin-workbench-integration/execution/t39.md)。本合同不授权真实 OAuth／WeCom／Provider／发送／用户数据库、部署、push、full/certify 或 Gate。


## 2026-10-14 Rootb5808 有限 SOURCE 同步

普通合并已完成的固定依赖基线 `b5808ee88ee749df61a6a82708d1d5bd26971743`，本节只记录 SOURCE 准备。三份 Schema／DTS、原 HTTP 首例与上述输入、输出、权限、期限和容量合同保持冻结；活动路径仍未挂载，`workbenchActivityEnabled=false` 仍仅为测试 helper 的准备参数。共享 helper 完整继承当前基线的迁移、T13／T34、实际身份与原业务配置，只保留本票原一个默认 false 参数和两处 runtime 参数转发；没有新增活动实现或业务开关启用。

本次没有数据库变更或编号分配，不触碰 T33 的 060／061；不新增业务事实、责任、已读、第二 SSE、常驻 timer 或心跳写库。真正 VIEWING／EDITING、当前双方 READ／字段权限、TTL／失活／后台／断线／退出／失权、有界单 App／现有真实流及正式前端行为仍待未来整票验证。原七项均 PENDING，全部 runtime／PG／HTTP／浏览器及自有资源清理为 NOT_RUN；SOURCE 同步不构成 RED／GREEN、验收、部署或 Gate。实际字节、规范 Git 对象、冲突与 clean pin 记录在 `D:/wecom-workbench-evidence/t39/prepared/source-sync-rootb5808-20261014/`。


## 2026-10-14 固定 Rootf941 的有限 SOURCE 前向记录

本票准备树普通合入固定 `f941e24e74e65a0181024f38bf1ac38bc947ea4e`；该输入已包含父任务完成的 T33 和当前实际 registry 630 entries／160 selections／364 resources。本轮仅继承这些来源与当前授权／流／草稿／目录边界，不把 T33 或 T36 用途扩为 presence 权限。Root 完整 tuple、scalar、原成员次序与本票原一 HTTP entry／三合同 resource 并集为 631／160／367。原 3118B HTTP 首例、三份 closed Schema／DTS、上述 TTL15秒／心跳5秒及全部字段、数量、授权、隐私边界保持冻结。

生产仍没有本票活动挂载；原 helper 只保留 workbenchActivityEnabled=false 和两处 bare runtime 参数透传，没有包装或重复开关。本轮无新 case、模块、数据库／DDL或永久事实，真实 SSE／可控时钟／浏览器及业务验证全部 NOT_RUN。原七项全部 PENDING，当前只完成有限 Source 同步，不构成验收或清理PASS。精确普通两parent、真实Git blob／物理raw、旧SQL／Evidence／用户六原件和实际native见 D:/wecom-workbench-evidence/t39/prepared/source-sync-rootf941-20261014/handoff.json。未来独占 WHOLE 仍须再合最新 Root 后运行未改原first取得真实RED，才最小实现与收口。
