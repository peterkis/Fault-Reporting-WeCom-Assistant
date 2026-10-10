# Reporter 只读进度与旧卡片入口

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

2026-10-11 WBINT-T21的[Bot本人反馈合同](bot-feedback-design.md)已有最小SOURCE候选：显式Bot能力在成员写profile增加同事务feedback_context、独立Bootstrap/POST/用途Receipt。原1e01公开HTTP只到“缺context”真实RED；本后继尚未构建或运行，未集成、未完成原七项。默认false及只读profile保持本页原详情，Web requestRef不能替代Bot publicRef。

调用方：[reporter.js](../../../web/p2-reporter/reporter.js)。有两种互斥访问策略：`MEMBER_REQUIRED`（M/O/W按装配挂载）与显式 `LEGACY_BOUND_GRANT`（W）。W装配还依赖默认false的 `REPORTER_TIMELINE_ENABLED`；独立只读profile通过配置/显式装配启用handler，不直接消费此持久Flag，成员入口/OAuth条件仍适用。实现：[成员handler](../../../src/p2-g2-yixiaoxiu-http.mts)、[旧handler](../../../src/p2-016-reporter-http.mts)、[timeline](../../../src/p2-016-reporter-timeline.mts)、[访问服务](../../../src/p2-016-reporter-access.mts)。

## 读取与退出

| METHOD + PATH | 成员模式 | 显式旧Grant模式 |
| --- | --- | --- |
| `GET /api/reporter/member/session` | 200 `{identity_mode:'MEMBER_REQUIRED',authenticated:true,read_only:true}`，无query | 未挂载 |
| `GET /api/reporter/bootstrap` | 上述相同对象，不包含public_ref，无query | 200 `{public_ref,identity_mode:'BOUND_ACCESS_SESSION',read_only:true}` |
| `GET /api/reporter/tickets/{publicRef}` | 当前成员、32位opaque ref，无query；200/ETag/304 | 绑定访问session，仅其授权ref；200/ETag/304 |
| `GET /api/reporter/tickets/{publicRef}/timeline` | cursor?、limit默认30/最大100；200/ETag/304 | 同类分页，绑定ref；200/ETag/304 |
| `POST /api/reporter/logout` | `{}`、JSON≤2KiB、Origin同源；200 logged_out；清OAuth/浏览器绑定 | `{}`、JSON≤1KiB、Origin同源；200 logged_out；清p2016_reporter |
| `POST /api/reporter/access/exchange` | **403 `YXX_ENTRY_LEGACY_EXCHANGE_DISABLED`**；不能用作回退认证 | `{grant}`；200 `{public_ref,identity_mode:'BOUND_ACCESS_SESSION'}` + Cookie |

Cookie：成员为 `__Host-wecom_session`（HttpOnly/Secure/SameSite=Lax/Path=/）；旧访问为 `p2016_reporter`（HttpOnly/Secure/SameSite=Strict/Path=/api/reporter，测试loopback例外须显式允许）。grant 来自卡片 fragment，不能放query、日志或本地存储。

Ticket view：`public_ref,ticket_no,suffix,title,external_status,created_at,updated_at,version,guidance`；Incident 组装可加 `incident_milestones[]` 的安全公开事件。timeline=`{items:[{ref,text,occurred_at,source_rank,source_ordinal,...公开milestone字段}],next_cursor}`。不返回内部备注、处理人私密信息、Ticket UUID、原始绑定或grant。source_rank/ordinal只用于投影排序，不是业务状态版本。

成员会话的合成响应与legacy bootstrap不同：

```json
{"identity_mode":"MEMBER_REQUIRED","authenticated":true,"read_only":true}
```

```http
GET /api/reporter/tickets/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
If-None-Match: "<previous-etag>"
```

ETag 命中304无正文；不能当空Ticket重置页面。权限、绑定、有效期每次核验，旧卡片的可定位信息不能成为跳过成员认证的理由。未找到/越权/失效应停止视图轮询；公开码主要为 `YXX_ENTRY_*` 或 `P2_016_REPORTER_*`，见各模式handler。

## 旧卡片转成员认证

`POST /api/reporter/member-entry/prepare`：成员策略专用；JSON `{grant}`，≤2KiB；同源Origin、非cross-site。可在成员尚未认证时建立浏览器绑定，返回200 `{entry_path:'/wecom/yixiaoxiu/continue/{entryRef}'}`。entryRef是64hex，一次性、5分钟TTL，最多1024全局/每浏览器8条；失败为INPUT_INVALID、BUSY或UNAVAILABLE等 `YXX_ENTRY_*`。

`GET /wecom/yixiaoxiu/continue/{entryRef}`：无query；必要时302 OAuth，认证后核对卡片/成员归属并303到 `/wecom/yixiaoxiu/tickets/{publicRef}`。失效404 HTML。继续入口是HTML/重定向，不能按JSON解析。

`GET /wecom/yixiaoxiu/tickets/{publicRef}`：成员页，无query；未认证进入OAuth，认证后200 Reporter HTML。页面认证之后，数据查询仍单独核验该ref归属。

完整定义：[member types](../../../contracts/yixiaoxiu_contracts.d.ts)、[prepare schema](../../../contracts/yixiaoxiu_legacy_prepare.schema.json)、[prepared schema](../../../contracts/yixiaoxiu_legacy_prepared.schema.json)、[reporter view](../../../contracts/p2_016_reporter_ticket_view.schema.json)、[timeline](../../../contracts/p2_016_reporter_timeline.schema.json)。Grant/session schema是内部持久化信息，不是公开响应。

核对：[成员profile](../../../tests/p2-g2-yixiaoxiu-profile.integration.test.mjs)、[OAuth归属](../../../tests/p2-g2-yixiaoxiu-oauth.test.mjs)、[旧surface](../../../tests/p2-016-reporter-surface.integration.test.mjs)、[Incident reporter](../../../tests/p2-012-reporter-http.integration.test.mjs)。成员Reporter无SSE，既有客户端5秒只读轮询。本轮未启用任何访问策略或现场外发。


WBINT-T11的工作人员完工以真实PILOT_USER、IN_PROGRESS→CLOSED、STAFF_COMPLETED的ticket.closed追加事件为依据。本人/绑定授权timeline仅展示其已单独确认且≤500字的external_note；internal_note处理过程和普通内部备注仍不可见。不会伪造REPORTER或REQUESTER_CONFIRMED，不生成旧Reporter确认task；legacy RESOLVED-confirm保持原语义。[完工合同](../workbench/tickets.md#工作人员完工wbint-t11)。
