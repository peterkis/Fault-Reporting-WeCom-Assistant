# WEB01 管理端看板

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 W；正式页面 `/workbench/app/`。业务使用真实API，新增处理能力按默认关闭的独立开关启用，与 `web/admin-workbench-prototype` 的合成原型区分。前端：[client](../../../web/admin-workbench/src/api/client.ts)；后端：[HTTP](../../../src/web01-workbench-http.mts)、[query](../../../src/web01-workbench-query.mts)。沿用内部身份、工单/复核范围、生命周期启用条件；默认关闭的管理员[来源群名称维护](source-groups-design.md)独立授权。

| METHOD + PATH | 请求 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | 内部 principal_id,display_name,roles 等，见 [工单](tickets.md) |
| `GET /api/workbench/board` | column 默认 pending：`pending\|active\|closed`；range 默认 recent：`recent\|all\|cancelled`；cursor?；limit 默认50/最大100；仅 `workbenchFollowEnabled=true` 的责任查询源码片接纳 scope=`team\|related`、默认team，见下文当前验证状态 | BoardPage |
| `GET /api/workbench/items/{kind}/{id}` | kind=`ticket\|review\|intake`，id UUID；cursor?；limit 默认50/最大100 | WorkbenchDetail |

仅允许表内query，重复参数也拒绝。board列表cursor绑定principal、当前授权范围、column/range/时间窗口；责任查询能力开启时另绑定team/related，切换范围或能力须重置。开关false保持原query allowlist，所有显式scope均拒绝。detail cursor绑定kind/id/at/record_id，访问仍每次授权。权限过滤先于LIMIT；不能用intake卡片旁路读到不可见工单。

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

正式前端按已启用能力复用既有业务命令；本票默认关闭的[同事项复核](manual-reviews.md#同事项复核与恢复wbint-t14)使用原resolve与专用只读receipt，不自行建立业务事实。开发代理 `/api` 的 loopback 目标仅用于本地，见 [Vite config](../../../web/admin-workbench/vite.config.ts)；它不是部署 Base URL。[ADR-0029](../../../adr/0029_admin_workbench_frontend_boundaries.md) 约束数据和前端边界。

基础接口核对：[unit](../../../tests/web01-workbench.test.mts)、[integration](../../../tests/web01-workbench.integration.test.mjs)、[browser](../../../tests/web01-workbench.browser.test.mjs)。本票增量如下。

WBINT-T34 原被测提交 `f3e551f461c96c2a6a3d846d23a46aa744d1a3ee` 的首条真实HTTP已取得 `scope=related` 返回400的RED，原件与清理见[本票记录](../../../plans/admin-workbench-integration/execution/t34.md)。当前后继仅完成责任查询源码，状态 **NOT_BUILT_NOT_RUN**：related在原获权、规范去重的卡片上取本人当前处理责任或ASSIGNED且非ENDED的真实沟通关系，再排序、分页；沟通材料须仍在保留期，历史责任、团队可见性、最新消息都不产生该关系。它不修改任何责任或事项，不返回Session引用或其他人的关系。

本片默认 `workbenchFollowEnabled=false`，无数据库变更、不读取044；尚无本片GREEN。完整[关注／与我有关合同](follow-design.md)中的FOLLOW写入、attention、follow_version、完整迁移readiness与正式UI仍为后续目标，不能将本片称为完整关注服务，也不改变个人已读或团队待跟进。

WBINT-T14启用时 Detail另含有界 `review_refs:[{id,status,row_version:string}]`，每项独立Journey/保留期授权。Review发生合法canonical转换时响应可增加 `requested_item:{kind:'review',id}`，实际item和活动来自当前有权Ticket/Review/Intake，cursor仍绑定请求；客户端只接受准确原请求的Review alias。相同关联Ticket不重复计卡片；多个材料版本明确选择，刷新不静默改选或丢失输入。正式600px详情/全页展示原原因、缺失与冲突、安全材料和当前支持/不支持结论；React按文本呈现。默认关闭、无DB变更及实际证据见[本票记录](../../../plans/admin-workbench-integration/execution/t14.md)。
