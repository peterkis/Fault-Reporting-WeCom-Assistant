# T41 全量授权检索：SOURCE 合同

状态：SOURCE_ONLY / NOT_BUILT_NOT_RUN。固定基点940cf3167733de403c2b67b01c39904f0056ad69。本次冻结合同、原HTTP first及typed port；下述路径尚未挂载。原七验收全部PENDING，未运行types/build/tests/PG/browser，没有启用生产功能。

来源：[T41/#96](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/96)、WBINT-14/A14、[ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md)。复用[看板](board.md)、[关注](follow-current-contract.md)、[精确补充](supplement-follow-up-design.md)、[共享时间](follow-up-schedules.md)及原报修时快照。

## 拟议HTTP与闭合输入

拟议W/P2016宿主GET /api/workbench/search，当前工作台认证，只读，无命令UUID或业务写入。拟议workbenchSearchEnabled默认false，尚未在运行宿主消费/在bootstrap暴露。first fixture向原Runtime传入明确true的拟议选项；原Runtime尚不消费它，不能称已启用。后续须先观察原公开HTTP first实际RED，再挂载。

URL仅接受下表字段，每键最多一次。省略取默认，空白q规范为''。数组URL用逗号分隔，规范DTO排序；重复成员/空成员拒绝，不静默修正。字段间AND，数组内OR。未知键、控制字符或无效Unicode拒绝。

| 字段 | 合同 |
| --- | --- |
| q | trim后最多128 Unicode码点，字面子串；PG lower大小写匹配，不解释SQL通配符/正则。 |
| column | all / pending / active / closed；默认all；分列看板明确传列，列表all覆盖所有细分状态。 |
| range | recent / all / cancelled；默认all；只限制closed部分。recent沿现有Asia/Shanghai当日+前一日，RESOLVED仍是已解决待确认。 |
| scope | team / related；默认team。related复用T34获权并集；依赖关闭则拒绝该条件。 |
| responsibility | any / handling / communication / following / unassigned；默认any。按调用者真实责任/关注；unassigned仅Ticket当前无处理人。 |
| resolver_team_id | null或真实组ID；缩小当前可读Ticket，不按显示名认组。 |
| assignee_id | null或UUID；当前Ticket处理人，不提供全局候选目录。 |
| sources | []不限；最多5个WECOM_DIRECT / WECOM_GROUP / WEB_REQUEST / MANUAL_PHONE / MANUAL_ON_SITE。WEB_REQUEST规范医小修网页，MANUAL按原保存代录类型。 |
| source_group_ref | null或原64位小写hex ref，按provider/bot/chat区分，不按同名合并，不暴露原chatid。 |
| statuses | []不限；最多8个既有规范Ticket/Review/Intake状态，逐字枚举见Schema；不创造新状态。 |
| supplement | any / pending / followed / none，默认any。当前精确可读留存材料中，pending至少一项待办；followed至少一项且无待办；none无当前可读补充。 |
| schedule | any / active / due / none，默认any；仅T37原活动安排，due使用实际物理时间；不创设SLA或责任人。 |
| cursor | null或不超过2048字符的服务器签名游标。 |
| limit | 1..100整数，默认50。 |

类型见[search contracts](../../../contracts/workbench_search_contracts.d.ts)，闭合[criteria Schema](../../../contracts/workbench_search_criteria.schema.json)与[page Schema](../../../contracts/workbench_search_page.schema.json)。运行守卫和Schema尚未验证。

## 授权、匹配与事实

每次重新解析活动内部人员和原READ范围。先构造当前已授权、仍留存且规范化的事项，再匹配全部q/筛选、排序、keyset、limit+1。不能取一页后过滤，不能先对隐藏对象检索再丢弃。责任/关注/安排/补充筛选只缩小范围，不授予读取权。

复用当前Ticket/Review/Intake真实关联去重：同Ticket只返回Ticket；多个同Intake待复核按原created_at/id规范。kind/id保持身份，不能按标题/姓名猜关系。可见Ticket不能旁路读取不可读Journey、其他参与者或过期材料。

q涵盖编号、获权故障描述、位置、现有工作台可读的报修时姓名/部门/联系方式。BOT仅使用原安全投影和通过原profile守卫的留存快照；网页使用有效binding/submission的description/location/reported_department_text；代录使用通过原manual source守卫的保存描述/位置/Reporter快照。禁止匹配当前目录、外部账号/identity hash、原Provider载荷、内部备注或处置记录。不逐卡调用第三方目录，不回写人员变动。

来源筛选与显示使用相同Journey-origin一致性及retention；冲突/过期origin不能猜后续leg。同名不同群ref独立。所有筛选在LIMIT前；依赖关闭或Schema缺失时拒绝该条件，不降级any。

输出仅含当前规范安全cards、next_cursor、column/range和完整规范criteria。无total_count、hidden_count、匹配片段、全局群/人员候选。已加载条数不能冒充全量。

## 游标与当前变化

签名payload绑定版本、principal、当前认证会话、当前角色/有效组范围摘要、全部规范criteria、窗口及(order_group/order_at/kind/id)。由当前App临时秘密签名，不加持久部署配置/DB状态源；App重启后旧游标明确400并重开首屏。不得包含rawCookie、csrf、凭据或Reporter身份。

修改q/任何筛选/column/range/scope/账号/会话/权限范围均400 P2_016_CURSOR_INVALID。认证失效401。anchor也须当前READ、retention并满足完整criteria；失权/移出条件的anchor拒绝，不能从隐藏anchor生成计数或继续。当前状态keyset不是冻结快照；刷新重开首屏，kind/id破同位。

实际W生产身份已有session_id时必须绑定它。仅原本地测试认证profile无持久session_id时，可使用服务器生成且不外露的当前认证绑定派生值；不能把生产降成principal-only。挂载前须按实际authContext来源实现并验证。

## HTTP、资源与关闭

计划错误：401沿原WORKBENCH_UNAUTHENTICATED/WORKBENCH_AUTH_EXPIRED；403沿原WORKBENCH_FORBIDDEN或P2_016_FORBIDDEN；400 P2_016_INPUT_INVALID/LIMIT_INVALID/CURSOR_INVALID；404 P2_016_NOT_FOUND；503 P2_016_DISABLED或P2_016_ACTION_FAILED；429拟议P2_016_SEARCH_RATE_LIMITED并带Retry-After。429新码尚未登记到原错误表，须在实际RED后的挂载实现中同步加入精确闭合码；本SOURCE不改变原错误行为。原宿主统一error对象与retryable语义不变，输入/游标/关闭为false，查询服务不可用及限流为true。

每个App同时最多1个搜索；每principal每分钟20次；全App最多256个限流记录，TTL60秒，满时拒绝新搜索。浏览器同时1个搜索，请求由明确提交触发，条件替换取消旧读并用generation屏蔽晚到回包。局部只读事务statement_timeout=2000ms，结束释放，不能改全局PG超时。SQL仅取limit+1；不为总数扫描。原单App/Worker、Gateway单活、SSE32、池总<=8及fixture<=4不变。上限是拟议合同，查询计划/延迟/扫描行/容量尚未实测。

关闭新flag停止本票读/Query cache，回到已有分页看板。搜索输入与业务备注/回复草稿独立，取消/失败不删除业务草稿。无新DDL/索引/迁移/第二套Ticket事实源；索引必须后续由真实计划证明需要。未改原46SQL、旧合同、历史Evidence、认证器或持久flag。

## 原first与后续

原first用原真实PG/HTTP fixture：limit=1的原看板不含目标，目标Ticket读取200，同样匹配的隐藏Ticket读取404；新搜索须200只返回目标且无next_cursor/计数。当前未运行，未观测RED。

first之后逐项完成全字段/组合谓词前置、跨页/去重、游标混用/失权/retention/同名群、关闭/非法输入/依赖/限流/PG计划；再以生产bundle验证URL/board/list一致、独立输入、无事项/无匹配/失败、重载及取消晚到读。原七项、WBINT-14执行记录、两轴非作者最终审查及自有资源清理仍待whole owner。
