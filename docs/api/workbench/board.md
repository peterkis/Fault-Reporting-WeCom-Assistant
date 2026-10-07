# WEB01 管理端看板

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 W；正式页面 `/workbench/app/`。Ticket业务为真实API只读视图，与 `web/admin-workbench-prototype` 的合成原型区分。前端：[client](../../../web/admin-workbench/src/api/client.ts)；后端：[HTTP](../../../src/web01-workbench-http.mts)、[query](../../../src/web01-workbench-query.mts)。沿用内部身份、工单/复核范围、生命周期启用条件；后继增量提供默认关闭的管理员[来源群名称维护](source-groups-design.md)。

| METHOD + PATH | 请求 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | 内部 principal_id,display_name,roles 等，见 [工单](tickets.md) |
| `GET /api/workbench/board` | column 默认 pending：`pending\|active\|closed`；range 默认 recent：`recent\|all\|cancelled`；cursor?；limit 默认50/最大100 | BoardPage |
| `GET /api/workbench/items/{kind}/{id}` | kind=`ticket\|review\|intake`，id UUID；cursor?；limit 默认50/最大100 | WorkbenchDetail |

仅允许表内query，重复参数也拒绝。board列表cursor绑定principal、授权范围、column/range/时间窗口，切换条件须重置；detail cursor绑定kind/id/at/record_id，访问仍每次授权。权限过滤先于LIMIT；不能用intake卡片旁路读到不可见工单。

完整 DTO：[types](../../../contracts/web01_workbench_contracts.d.ts)。字段如下：

source_label提供统一来源显示，source_group提供管理员登记群名及不透明引用；具体来源、默认关闭的模块和维护入口见 [来源群名称](source-groups-design.md)。

| 对象 | 字段 |
| --- | --- |
| BoardPage | items:WorkbenchCard[]、next_cursor:string或null、column、range:{mode,from,until,timezone:'Asia/Shanghai'} |
| WorkbenchCard | kind,id,intake_id,number,title,status,column,priority,source,source_label,source_group,location,reporter_name,assignee_name,review_reason,created_at,updated_at,completed_at |
| WorkbenchDetail | item:WorkbenchCard、description、records:WorkbenchRecord[]、next_cursor、responsibility:{ticket_assignee_name,conversation_assignees:string[]} |
| WorkbenchRecord | id,at,type,text,audience:`REPORT\|INTERNAL\|EXTERNAL`,actor,old_status,new_status |

可空字段遵循 types；如 priority/location/reporter_name/completed_at。range 的窗口以服务端返回为准，不由客户端猜测月份或时区。

合成空看板响应（时间窗口仅示例）：

```json
{"items":[],"next_cursor":null,"column":"pending","range":{"mode":"recent","from":"2026-10-01 00:00:00","until":"2026-11-01 00:00:00","timezone":"Asia/Shanghai"}}
```

```http
GET /api/workbench/board?column=pending&range=recent&limit=50
Accept: application/json
```

前端同源Cookie、no-store、redirect:error，使用Query提供的AbortSignal取消请求（此client没有独立timeout）；必须校验JSON Content-Type和运行时DTO。HTTP成功但DTO不合法时client报 `INVALID_RESPONSE`（本地客户端错误，502）。服务端错误沿用WORKBENCH/P2_016；401/403不应被模拟卡片替代。

正式前端仅上述三个 GET，没有自己的 SSE/WebSocket/命令 URL。开发代理 `/api` 的 loopback 目标仅用于本地，见 [Vite config](../../../web/admin-workbench/vite.config.ts)；它不是部署 Base URL。[ADR-0029](../../../adr/0029_admin_workbench_frontend_boundaries.md) 约束数据和前端边界。

核对：[unit](../../../tests/web01-workbench.test.mts)、[integration](../../../tests/web01-workbench.integration.test.mjs)、[browser](../../../tests/web01-workbench.browser.test.mjs)。本轮无运行时变更或新 Feature Flag。
