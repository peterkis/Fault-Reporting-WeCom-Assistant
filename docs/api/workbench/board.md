# WEB01 管理端看板

2026-10-28：详情新增可选 actor_ref 与同源操作人头像读取；联系电话独立显示。当前人员缓存与权限终检见[头像与媒体合同](actor-avatars-and-media.md)。

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

T42 [合法动作与原表单路由](board-legal-actions-design.md)已完成本地隔离定向验证，默认关闭、待父原七验收。拖动／按钮／键盘只打开既有合法表单，明确确认后由官方查询显示真实列；本页查询与原详情按钮保留，不提供任意状态 PATCH。UNKNOWN／409保原控制器、UUID和完整命令，成功位置提示不冒充本UUID回执。

宿主 W；正式页面 `/workbench/app/`。业务使用真实API，新增处理能力按默认关闭的独立开关启用，与 `web/admin-workbench-prototype` 的合成原型区分。前端：[client](../../../app/pc-admin/src/api/client.ts)；后端：[HTTP](../../../app/server/src/web01-workbench-http.mts)、[query](../../../app/server/src/web01-workbench-query.mts)。沿用内部身份、工单/复核范围、生命周期启用条件；默认关闭的管理员[来源群名称维护](source-groups-design.md)独立授权。

| METHOD + PATH | 请求 | 200 响应 |
| --- | --- | --- |
| `GET /api/lifecycle/bootstrap` | 无 query | 内部 principal_id,display_name,roles 等，见 [工单](tickets.md) |
| `GET /api/workbench/board` | column 默认 pending：`pending\|active\|closed`；range 默认 recent：`recent\|all\|cancelled\|custom`；custom 必须同时提供 `closed_from`、`closed_to`（`YYYY-MM-DD`，含起止两天）；cursor?；limit 默认50/最大100；仅 `workbenchFollowEnabled=true` 接纳 scope=`team\|related`、默认team，见下文当前验证状态 | BoardPage |
| `GET /api/workbench/items/{kind}/{id}` | kind=`ticket\|review\|intake`，id UUID；cursor?；limit 默认50/最大100 | WorkbenchDetail |

仅允许表内query，重复参数也拒绝。board列表cursor绑定principal、当前授权范围、column/range/时间窗口；责任查询能力开启时另绑定team/related，切换范围或能力须重置。关注开关false时所有显式scope均拒绝；日期范围与关注开关独立。detail cursor绑定kind/id/at/record_id，访问仍每次授权。权限过滤先于LIMIT；不能用intake卡片旁路读到不可见工单。

`custom` 的日期按北京时间自然日解释，服务器验证真实日历日期及起止顺序，并返回开始日零时至结束日次日零时的半开窗口。结束日期须早于 `9999-12-31`，以保证次日上界仍符合四位年份时间合同。非 custom 不接纳这两个日期参数。仅第三列的已完结记录应用该窗口，未完成事项和 RESOLVED 待确认事项继续保留。第三列默认同时纳入完成和关闭，包括 CANCELLED；已关闭按可证明的关闭时刻筛选，缺时间仅在 all 可见，原 cancelled 专项仍只选 CANCELLED 且不加日期限制。自定义分页游标使用 v2 并绑定开始和结束边界，修改任一日期后旧游标拒绝；原预设游标保持 v1。高级搜索仍只支持三种预设，并独立支持 closure_kind 筛选。

完整 DTO：[types](../../../contracts/web01_workbench_contracts.d.ts)。字段如下：

source_label提供统一来源显示，source_group提供管理员登记群名及不透明引用；具体来源、默认关闭的模块和维护入口见 [来源群名称](source-groups-design.md)。

| 对象 | 字段 |
| --- | --- |
| BoardPage | items:WorkbenchCard[]、next_cursor:string或null、column、range:{mode,from,until,timezone:'Asia/Shanghai'}；closed 列必有 group_counts:{completed:number,dismissed:number}，其它列不带 |
| WorkbenchCard | kind,id,intake_id,number,title,status,column,priority,source,source_label,source_group,location,reporter_name,reporter_department,assignee_name,review_reason,created_at,updated_at,completed_at、必填 closure:WorkbenchClosure或null |
| WorkbenchDetail | item:WorkbenchCard、description、reported_at?:string或null、records:WorkbenchRecord[]、next_cursor、responsibility:{ticket_assignee_name,conversation_assignees:string[]} |
| WorkbenchRecord | id,at,type,text,audience:`REPORT\|INTERNAL\|EXTERNAL`,actor,old_status,new_status |

可空字段遵循 types；如 priority/location/reporter_name/completed_at。range 的窗口以服务端返回为准，不由客户端猜测月份或时区。

### 结束方式与分组计数（卡 27A）

沿 [ADR-0055](../../../adr/0055_workbench_closure_kind_projection.md)，第一、二列 closure=null；第三列包含 kind、source、reason_code、reason_label、reason_note、closed_by_display_name、closed_at、duplicate_of、can_restore。RESOLVED/CLOSED/COMPLETED 为 COMPLETED，CANCELLED/DUPLICATE_LINKED/IGNORED 为 DISMISSED。除 kind/can_restore 外均可按合同为 null；时间采用相同北京时间 LocalDateTime。

原因只读已有事实；纯空白内部说明或人员名投影为 null，原记录不改。reason_note 仅在当前账号原可读时给出，Intake 的任意自由文本不外扩。人工 Intake 用匹配 Review.resolved_at；自动后续分类仅记录旧输入时间、无法证明实际关闭时刻时 closed_at=null，不能用 updated_at 推断；严格证明初始创建即 IGNORED 时用该创建事实的 created_at。duplicate_of 当前无原单事实为 null；DISMISSED 无恢复，can_restore=false，完成 Ticket 的原 reopen 权限独立判断。

group_counts 使用当前获权完整匹配集合，分页前计算；不能以 items.length 替代。最终同一 SQL 同时保留原身份/角色/会话/对象 READ 终检，并复核当前有序页、排序键及 limit+1 后续页标志；等待期间新增/移出匹配事项或排序边界变化时返回 `409 P2_016_VERSION_CONFLICT`，不返回混合快照，调用方刷新重读。默认没有 include_* / closure_groups 兼容参数；当前严格解析与后端同批更新。UI 分组及 cancelled 移除属于 27B。

`reported_at` 只增加在详情响应，表示原始报修首次进入系统的时间，按既有北京时间合同格式化。聊天来源取原始报修消息的接收时间，H5 取初次 SUBMIT 的接收时间，人工代录取首次登记时间；补充材料和重开不改变该值。遵守原来源读取条件、撤销状态及保留期，来源不可读取或无法确定时为 null；旧响应缺少字段时客户端显示“未记录”，不以工单 created_at 或当前已加载记录的最早时间代替。不扩展看板/搜索 DTO，不新增持久化事实或迁移。

ADR-0048的`workbenchReporterProfilesEnabled`默认false。显式开启时，Ticket卡片可包含`reporter_profile:{state,source,captured_at}`；state为`PENDING/PARTIAL/RESOLVED/UNAVAILABLE`，source为`REPORT_SNAPSHOT/LATER_LOOKUP/null`，captured_at为资料取得时间或null。Bot、H5和人工代录的必要来源、姓名、部门随工单持续保存，完结后不按时间清理；后续补得资料注明取得时间，原Journey报修时快照不覆盖。每页仍以一次集合查询读取资料，等待后保留当前Ticket READ终检。该能力不恢复已过期的原文、会话或媒体，不增加发送权限。

合成空看板响应（时间窗口仅示例）：

```json
{"items":[],"next_cursor":null,"column":"pending","range":{"mode":"recent","from":"2026-10-26 00:00:00","until":"2026-10-28 00:00:00","timezone":"Asia/Shanghai"}}
```

```http
GET /api/workbench/board?column=pending&range=recent&limit=50
Accept: application/json
```

前端同源Cookie、no-store、redirect:error，使用Query提供的AbortSignal取消请求（此client没有独立timeout）；必须校验JSON Content-Type和运行时DTO。HTTP成功但DTO不合法时client报 `INVALID_RESPONSE`（本地客户端错误，502）。服务端错误沿用WORKBENCH/P2_016；401/403不应被模拟卡片替代。

正式前端按已启用能力复用既有业务命令；本票默认关闭的[同事项复核](manual-reviews.md#同事项复核与恢复wbint-t14)使用原resolve与专用只读receipt，不自行建立业务事实。开发代理 `/api` 的 loopback 目标仅用于本地，见 [Vite config](../../../app/pc-admin/vite.config.ts)；它不是部署 Base URL。[ADR-0029](../../../adr/0029_admin_workbench_frontend_boundaries.md) 约束数据和前端边界。

基础接口核对：[unit](../../../tests/web01-workbench.test.mts)、[integration](../../../tests/web01-workbench.integration.test.mjs)、[browser](../../../tests/web01-workbench.browser.test.mjs)。本票增量如下。

WBINT-T34 原被测提交 `f3e551f461c96c2a6a3d846d23a46aa744d1a3ee` 的首条真实HTTP已取得 `scope=related` 返回400的RED，原件与清理见[本票记录](../../../plans/admin-workbench-integration/execution/t34.md)。后继 d89547f4 已通过一次 build／strict／artifact 及原首真实HTTP 1/1（仅责任查询片）：related在原获权、规范去重的卡片上取本人当前处理责任或ASSIGNED且非ENDED的真实沟通关系，再排序、分页；沟通材料须仍在保留期，历史责任、团队可见性、最新消息都不产生该关系。它不修改任何责任或事项，不返回Session引用或其他人的关系。

本片默认 `workbenchFollowEnabled=false`，无数据库变更、不读取044；GREEN只覆盖上述原首查询测试。完整[关注／与我有关合同](follow-design.md)中的FOLLOW写入、attention、follow_version、完整迁移readiness与正式UI仍为后续目标，不能将本片称为完整关注服务，也不改变个人已读或团队待跟进。

WBINT-T14启用时 Detail另含有界 `review_refs:[{id,status,row_version:string}]`，每项独立Journey/保留期授权。Review发生合法canonical转换时响应可增加 `requested_item:{kind:'review',id}`，实际item和活动来自当前有权Ticket/Review/Intake，cursor仍绑定请求；客户端只接受准确原请求的Review alias。相同关联Ticket不重复计卡片；多个材料版本明确选择，刷新不静默改选或丢失输入。正式600px详情/全页展示原原因、缺失与冲突、安全材料和当前支持/不支持结论；React按文本呈现。默认关闭、无DB变更及实际证据见[本票记录](../../../plans/admin-workbench-integration/execution/t14.md)。


## 当前 T34 完整关注实现（2026-10-14）

上述d895责任查询片为历史阶段。当前related包含本人处理、实际ASSIGNED且非ENDED沟通及明确关注的当前READ并集，先规范去重再分页；列表／看板／详情共用caller-only `attention={following,follow_version,related_reasons}`，不显示他人的关注或隐藏计数。bootstrap独立Follow／恢复能力决定控件，空列表不能代替开关证明。显式POST、原UUID只读核对、044精确readiness与关闭／隐私见[当前合同](follow-current-contract.md)。默认关闭，旧SQL／事实源／关闭态查询语义保持；本地证据与父验收状态见[本票执行](../../../plans/admin-workbench-integration/execution/t34.md)。

## T43 同候选综合隔离证明（2026-10-15）

[T43 执行记录](../../../plans/admin-workbench-integration/execution/t43.md)保留真正首例 baseline GREEN、原失败与最终同 MF 综合6/6、相关22/22、strict／一次build／artifact及自有资源释放。本次正常群／单聊／H5／电话代录均通过原入口形成规范 Ticket，由正式 bundle 回读并贯穿明确承接、交接、等待／补充、完工和合法下一轮。Bot的非空沟通责任与不同人的 Ticket 处理责任独立。

本票唯一生产修补为原 closure 的收件身份 nullable guard：没有 Bot 身份不建立 Bot 卡片能力，合法人工等待仍提交并追加原事件；H5／代录不假造企业微信身份。真实新材料使旧复核命令409且不改变当前 Ticket／事件／责任。没有新 API、DTO、SQL、权限或默认开关。原H5补充的 SYSTEM／WEB_SUPPLEMENT_RECEIVED resume 与工作人员明确恢复分别核对，不将两者混为本人重开。

正式产物截图及本地双主体／同profile双Target断网、UNKNOWN原UUID核对与失权清理已记录。外部身份、目录和 Sender 均为合成适配；不代表真实登录、真实消息到达、物理设备或生产容量验收。原开关默认false，部署／现场／full／certify／Gate继续按独立授权。

2026-10-26 展示调整：卡片以报修人姓名和部门替代位置信息；位置字段保留用于详情及原查询合同。部门来自原报修资料快照；人工代录使用其已核实部门列表或手填部门。缺少旧 H5 快照时通过[独立只读资料接口](web-reports.md)补充当前资料，不回写历史。来源 PORTAL 的显示标签为 H5报修。

2026-10-26 查询后继：关系、关注、人工来源资料和补充材料提示按整页读取。分页前沿原 READ 过滤；异步投影完成后按整页重新核验当前 principal 和规范事项 READ，包括 Follow 关闭的入口。等待期间 principal 失效返回403，页面事项失去 READ 返回404；拒绝响应不携带旧卡片，客户端可按当前身份重新加载。请求字段、DTO、游标、默认开关及命令／回执语义不变。测量口径与检查见[性能修复记录](../../../plans/pc-admin-electron/board-performance-2026-10-26.md)。


## v2.1 卡 11：服务与状态起始时间（2026-11-02）

合同按用户确认的 [ADR-0052](../../../adr/0052_workbench_service_and_stage_read_projections.md) 扩展。board/detail 卡片总是返回 `service` 与 `stage_entered_at`，二者可为 null；旧响应可缺席，基础 TypeScript DTO 使用可选字段。高级搜索不输出两字段，保持旧闭合客户端兼容。对应 [card Schema](../../../contracts/web01_workbench_card.schema.json)、[board Schema](../../../contracts/web01_workbench_board.schema.json)。

`service={code,name_zh,category,category_name_zh,source}`。代码/类别最长64字符，名称最长80字符；source 为 `MANUAL_CONFIRMED / REPORTER_EXPLICIT / RULE_DETERMINISTIC`。只读当前获权且保留有效的事实；明确人工服务确认优先于初始 Web 显式选择，再取当前确定性事实。普通人工分类不确认服务代码；未解决冲突、失效或禁用/不存在的代码返回 null，不复活旧判定或改用相反建议。目录名称只取当前装配的同一 ServiceCatalog。无事实补写或数据库迁移。详细 [事实表与确认规则](../../ui/design-system-v2.1-card11-source-audit.md)。

`stage_entered_at` 使用原北京时间 `YYYY-MM-DD HH:mm:ss`，取最近一次真正进入当前 Ticket 状态的事件，按 aggregate_version/event_ordinal 排序。挂起、恢复分别重新起算；备注和同状态转交不重置；非 Ticket 或无法证明为 null，不以 updated_at 补值。前端待受理仍从 created_at 计算、已处理不计热度，本卡不修改前端。

### 工作台只读服务目录

- `GET /api/workbench/service-catalog`；宿主 W，沿现有默认关闭的生命周期工作台启用条件，无新增 Flag。
- 当前有效内部 Principal 可读，包括只读角色；不要求写权限或 ADMIN，成员 Cookie/Reporter Grant 不适用。匿名/过期401，非有效内部主体403。
- 无 query/body；未知/重复 query 或 body 拒绝400，其他方法404。成功和错误使用 no-store。
- 返回 `{schema_version:1,catalog_version,categories:[{category,category_name_zh,services:[{service_code,name_zh}]}]}`，见 [Schema](../../../contracts/workbench_service_catalog.schema.json)。只包含启用服务及非空大类，不返回别名、责任组、规则或哈希。
- 版本/代码最多64字符，名称最多80字符，启用服务总数/大类数组各最多200项，超限或目录不可用为503 `P2_016_ACTION_FAILED`，不截断；无目录时卡片 service 为 null，状态时间仍可读取。身份错误不降级为503。
- 前端筛选接入留给后续卡；503时可不显示筛选，401/403仍按原身份处理。只读，无命令、回执、Provider请求或发送，不改变 Ticket 事实和责任。


卡11审查终检：看板/详情材料读取及详情规范路由等待结束后，最后一条只读 SQL 将当前有效人员、完整角色/处理组快照、既有真实 Cookie 会话谓词、当前 canonical READ 与来源有效性放在同一快照。退出/物理或空闲到期401，人员/范围失效403，事项READ丢失404，规范对象/状态变更409；拒绝不携带旧卡片。来源撤销、保留期或当前判定在等待期间变化时，service为null，内部指纹不对外暴露。目录同样在最后一个只读权限证明通过后同步生成白名单；不重新认证或更新last_seen。来源与授权检查保持集合查询，不增加业务写入、回执或外部请求。
