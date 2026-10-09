# 电话／现场代录合同（WBINT-T17）

返回[导航](../README.md) · [索引](../endpoint-index.md)。电话／现场代录、当前创建权限、同用途回执及正式新报修／MANUAL复核页面均已挂载，默认关闭。本票七项已有本地隔离证据，覆盖持久受理、人工复核、草稿恢复／UNKNOWN只读核对、并发／事务回滚及生产制品浏览器行为；实际被测祖先、当前差异和限制见[执行记录](../../../plans/admin-workbench-integration/execution/t17.md)。历史RED与修补过程保留在执行记录和原始证据中，不代表生产启用或Gate批准。

宿主 W，内部工作人员会话。`workbenchManualReportsEnabled=false` 默认关闭；关闭时拒绝该用途并不访问042存储。启用后缺033/042 readiness 返回503。AI、外部目录、OAuth/Provider、Sender不参与受理。只有当前active ADMIN／DISPATCHER，或实际属于至少一个active处理组的HANDLER可以新代录；重复与回执每次重新核验同一当前权限。浏览器不能提供actor、WeCom identity、person binding、状态或处理人。成功受理不扩大该工作人员对新Ticket／Journey的既有读取范围。

| 方法与路径 | 合同 |
| --- | --- |
| `GET /api/workbench/reports/capabilities` | `{can_create:true,manual_contact_required:true,external_notification:false,draft_recovery_enabled:boolean}`；当前权限及readiness重新核验；恢复位取本票用途与原通用恢复开关同时启用 |
| `POST /api/workbench/reports` | JSON、同源Origin/CSRF、Idempotency-Key与body UUID相等；首次202、相同原意图重放200 |
| `GET /api/workbench/reports/commands/{commandId}` | 默认恢复能力同时启用；READ ONLY原principal＋MANUAL_REPORT用途账本，闭合UNKNOWN/FAILED/COMMITTED，不写receipt，不按状态猜结果 |

请求闭合字段：`schema_version:1,client_command_id:UUID,source:PHONE|ON_SITE,description:string,location:{text:string|null,unknown:boolean},reporter:{verification:UNVERIFIED,name:string,contact:string,department:string|null}`。描述去首尾空白后1–4000字符，姓名1–100、联系方式1–100、科室null或1–100、位置最多200。unknown=true只允许text=null；unknown=false要求非空位置。全部单行资料拒绝控制字符；描述保留换行。Body最多16KiB。字段不得含患者详情、口令或其它敏感业务记录。

返回闭合`{ok:true,client_command_id,intake_id,intake_no,source,reporter_verification:UNVERIFIED,manual_contact_required:true,external_notification:false,result_code,ticket:{id,number,status}|null,review:{id,status:PENDING}|null,replayed}`。返回的是同事务持久受理及规则结果；Ticket状态取Core，Review取原队列。真实故障经UnifiedTicketCommandPort创建最小Ticket；高风险／规则不可用／咨询／缺少可判现象进入必要Review。HANDLER受理可进入Core默认处理组，回执不授予该Ticket可见权，不允许顺便接单。没有消息Inbox、Conversation、Message/Outbox/Delivery、Reporter Access或外发。

MANUAL入口使用`WBINT_T17_MANUAL_SYMPTOMS/1.0.0`别名overlay，只把实际症状词“无法打印”映射到既有`PRINT.NO_OUTPUT`，委托原AliasResolver、FaultTaxonomyResolver及纯规则引擎／路由生成事实。保留原描述、Source引用、事实source hash和原命令input hash；不改BOT／WEB默认profile、原词表或历史规则。Decision的safe_result记录`classification_source`中overlay及所委托base的ID／版本／哈希，engine version为`workbench-manual-rule-adapter/1.0.0`，policy version为`workbench-manual-safe-route/1.0.0`。缺少可判现象仍诚实返回`NEEDS_DESCRIPTION`，保留原分类结论并同事务追加既有`ENQUEUE_MANUAL_REVIEW`；不把Review回执称为已建Ticket，不发送催问消息。

新增别名采用局部`workbench-manual-print-affirmation/1.0.0`筛选：明确否定该现状、纯词义或假设提问时不加入该条alias，仍用原引擎和原文本处理；电话转述“打印机无法打印”及“打印机无法打印怎么办”仍可生成真实症状。该筛选不重写旧词表、不充当通用语言分类器。`classification_source.new_alias_applied`及`affirmation_gate_version`说明实际参与情况；未参与时ID／版本／哈希如实指向base，参与时指向overlay。

422不使用；输入400、认证401、权限403、变意图UUID409、关闭／缺schema／原事务失败503；稳定P2_016错误包沿公共约定。失败业务全部回滚，原账本保存FAILED；失败回执只含code/retryable:false。UNKNOWN仅表示找不到终态，不能推断未提交。COMMITTED只含原受理结果且replayed:true，无联系方式或完整描述。

042仅增加Intake原人工描述／来源／实际Reporter未核实快照和authenticated actor；Journey/Leg/Decision引用同一Intake，不新建Ticket/Owner/receipt表。旧SQL、历史证据、181迁移分母保持。停止本票option即可停止新代录/读取用途；已保存事实与原命令账本保留，结构修复用后续迁移。

正式新报修表单复用T03当前浏览器AES-GCM、不可导出key、20份/16KiB、首次保存后固定24h、principal+intake+固定新报修scope+manual-report用途。固定scope id=`00000000-0000-4000-8000-000000000072`只是浏览器草稿槽位，不代表Service Intake、人员身份或服务器资源；受理后真实Intake UUID只由服务器返回。恢复前重新GET capabilities并核验当前account；只保存业务密文与原UNKNOWN UUID/body，不保存凭据。pending只保存一次原命令，不重复复制大段描述。提交、恢复均不自动POST；成功、丢弃、退出、失权、过期沿T03清理。UNKNOWN正文/UUID不可更改，只能显式GET核对；敏感过期后仅保留opaque操作标识。正式路由`/workbench/app/reports/new`及当前工作台“新报修”入口已接入；已完成真实生产制品隔离浏览器验证，具体被测祖先及限制见执行记录。bootstrap新增可选兼容的`manual_reports_enabled`和`manual_report_draft_recovery_enabled`，旧回复缺字段视为false，组合非法拒绝；实际创建许可仍来自当前capabilities和服务器每次验权。沿T38既有authorization epoch/transport fence，只对新建操作检查当前连接事实，只读UNKNOWN核对不发送新命令。

当前授权看板／列表／事项卡片在本票开关启用时，从本次保留期内真实MANUAL快照展示“电话代录／现场代录”和姓名附“身份未核实”。默认关闭不读取042字段，已有BOT/WEB及群名称字段保持；不把未核实姓名提升为人员目录、WeCom收件人或已解析profile。该显示仍由既有Core/Review/Intake读取权限决定，回执不赋予额外工单可见权。

资源沿既有单App/Worker、Gateway单活、SSE32、共享pool max4／总预算8；本票无新后台worker、timer或目录网络。公共验证seam为真实已编译HTTP＋隔离PG及正式production bundle，七项追溯见[执行记录](../../../plans/admin-workbench-integration/execution/t17.md)。T18目录核实、T19一步接单均不在本票。

`GET /api/manual-reviews/{reviewId}`在当前Review／Journey权限与保留期内返回`material_basis.source_kind:MANUAL`、固定来源revision 1及原描述材料`manual:{intakeId}`，不按Bot消息窗口生成或替换原Decision依据。附加闭合`manual_report:{source_kind:MANUAL_REPORT,source:PHONE|ON_SITE,description,location,reporter,identity_source:HAND_ENTERED,actor_principal_id,manual_contact_required:true,external_notification:false}`，内容取本次持久快照及真实authenticated actor；姓名／联系方式仍UNVERIFIED，不赋予任何Person／WeCom身份。人工结论沿同原账本与事务，仅走人工来源适用的APP_ONLY数据库动作；确认回应、咨询等不强制建工单，所有结论均无自动Communication／Outbox／Delivery。各结论隔离验证状态见执行记录。正式复核页面展示本次手填Reporter、未核实身份与人工联系提示，并单独展示实际代录主体；仅真实actor UUID等于当前principal时取当前工作人员名称，其它主体记录诚实保留，不根据姓名／联系方式推断身份。原safe_result／provenance保持，材料围栏沿当前capture hash；已有BOT／WEB的权限、材料与通知语义保留。MANUAL分支沿`workbenchManualReportsEnabled=false`默认关闭，材料工作区还沿原T14开关；旧BOT/WEB不会读取042新增字段。

回执在READ ONLY事务中核验当前创建权限，再读取原principal＋`WORKBENCH_MANUAL_REPORT`用途账本；UNKNOWN不写原账本或其它事实，同UUID其它principal或其它用途返回UNKNOWN。成功结果仅返回原受理结果，不含原描述或Reporter姓名／联系方式，闭合快照守卫失败返回503；重复提交只返回原结果，变更原意图409，失去当前创建权限后读取、重放均403。恢复开关默认false，关闭时只读receipt拒绝且不查询账本；capabilities恢复位诚实取当前配置。

MANUAL复核的显式`CONFIRM_TICKET_ELIGIBLE`及`CLASSIFY_SERVICE_REQUEST`分别设置原Intake request_type为`INCIDENT`／`SERVICE_REQUEST`，沿既有执行器创建原生Core `QUEUED`、未分配工单；其余六种合法结论不建单。所有结论均保留原来源快照和Decision，不自动接单或发送通知。代录入口产生Core标题与Intake摘要时，沿原200／500 UTF16单位上限取完整Unicode字符前缀，完整原描述快照及其hash不改变。

## 代录后由本人立即处理（WBINT-T19，SOURCE合同，尚未挂载）

本节是#74的冻结输入／输出与首个HTTP tracer准备，不是已经提供的接口。当前生产源码未改，build、strict、tracer、PG、browser均`NOT_RUN`；[本票记录](../../../plans/admin-workbench-integration/execution/t19.md)列出全部七项remaining。T17普通受理的字段、canonical payload/hash、既有命令结果及恢复语义保持原合同。T18核实成员未纳入本片。

| 候选方法与路径 | 冻结合同 |
| --- | --- |
| `GET /api/workbench/reports/self-handling-context` | W／READ ONLY；当前创建权限及真实活动组成员资格；闭合`{can_take_and_start,resolver_teams:[{id,name}],manual_contact_required:true,external_notification:false,draft_recovery_enabled}`。仅返回当前操作者合法活动组，稳定按id排序，最多100；超限明确503，不截断成完整候选。无合法组时false＋空数组，不授予新的读取权限 |
| `POST /api/workbench/reports/take-and-start` | W／同源Origin／CSRF／16KiB／UUID Idempotency-Key与body一致；T17原闭合body只增加必填`resolver_team_id`；首次完成202、相同原意图重放200。姓名、联系方式仍UNVERIFIED；目标处理人固定当前authenticated principal |
| `GET /api/workbench/reports/commands/{commandId}` | 复用原MANUAL_REPORT用途READ ONLY核对；UNKNOWN／FAILED／COMMITTED语义不变；原principal＋当前创建权限及原恢复开关重新核验，不写账本，不发送新命令 |

输入[Schema](../../../contracts/workbench_manual_report_self_handling_command.schema.json)、[当前组上下文](../../../contracts/workbench_manual_report_self_handling_context.schema.json)、[成功结果](../../../contracts/workbench_manual_report_self_handling_result.schema.json)及[类型](../../../contracts/workbench_manual_report_self_handling_contracts.d.ts)为候选合同。结果沿原闭合`ManualReportResult`，成功必须`ticket.status=IN_PROGRESS`、`review=null`、`result_code=TICKET_ELIGIBLE|SERVICE_REQUEST`，无额外联系方式、actor声明或未知字段。受理后当前版本、责任与轮次由原获权Ticket查询读取。

新报修尚无Ticket／Review／Intake对象版本，body使用`schema_version:1`，不接收虚构`expected_version`或If-Match。服务器在唯一新Core上以真实版本执行accept→start，成功首轮cycle1有真实accepted事件、操作者、选定活动组及原命令依据。新入口同时要求既有`workbenchManualReportsEnabled=false`与`ticketSelfHandlingEnabled=false`的显式启用以及033／039／042 readiness；一个开关关闭即拒绝新操作。恢复还要求原`workbenchDraftRecoveryEnabled=false`，既有普通受理及已存恢复不因此改变。

原当前角色与创建权限仍必需；ADMIN／DISPATCHER也必须实际属于所选活动处理组。新组不要求等于Core默认组，而是该次建单时传入合法选定组；多组明确选择，不默认挑首个。锁后重新核验实际principal／角色／成员／组有效性，重放前也执行当前授权。浏览器不得声明actor、处理人、Person／WeCom身份、Conversation或业务状态。实际Reporter由T17原快照保存，Recorder为服务器认证主体，Handler为本次实际承接者；Recorder与Handler本次可同人，仍是两项独立事实。

一次原MANUAL_REPORT账本事务包含T17原持久Intake／来源快照／Journey／MANUAL Leg／Decision／规则动作、唯一Core Ticket、原显式accept／start及039轮次／事件关联。新action `manual-report-take-and-start`只用于新分支原command hash，原普通`manual-report`canonical对象及hash完全不变；同UUID跨action或改组／描述返回409，不建第二单。复用原purpose和receipt，不新建owner、receipt、Ticket表或Conversation；当前计划无新增SQL，若后续真实RED证明结构不足，先向父任务申请编号。历史001–042与旧Evidence不改。

原规则要求Review、没有合法最小Ticket或不能承接时，复合操作明确失败，业务事实全部回滚；不能成功返回仅Review或声称部分受理／责任已成功。既有`POST /api/manual-reviews/{reviewId}/resolve`的显式`CONFIRM_TICKET_ELIGIBLE`／`CLASSIFY_SERVICE_REQUEST`只适用于已持久Review、当前授权和原版本，可产生QUEUED／未分配Core。新表单没有可直接代用的已有Review对象，也不把“由我处理”当作该人工确认；复核到处理沿所属T15合同。工作人员可明确选择普通T17受理，按规则持久Review；前端不得失败后自动补普通POST或串行调用旧接单／开始伪装原子成功。

FAILED保留原失败账本，业务savepoint全部回滚；同UUID失败重放不重新执行。事务失败HTTP503沿原稳定错误；认证401、权限403、闭合输入400、变意图409、关闭／缺readiness503。UNKNOWN保留原UUID及完整body，显式GET核对；找不到终态不等于未提交。不自动换UUID、改group／版本、降为普通受理或重复POST。已提交结果只取原回执，不从Core当前状态猜旧命令结果。

正式T17新表单将保留“提交报修”，在当前context获准时增加“由我处理”与明确组选择。新action草稿使用T03同一当前浏览器AES-GCM／不可导出key／首次保存固定24h，独立`manual-report-self-handling`用途与T17固定槽位，保存原body、mode和UNKNOWN UUID，不改普通`manual-report`草稿。恢复前重新验当前principal、创建权与所选真实组；成功／丢弃／退出／失权／过期沿原清理，UNKNOWN只留规定opaque核对元数据。连接与epoch围栏复用T38，不从动画或点击推导提交成功。此段前端尚未实现或验证。

本票无目录网络依赖，现有UNVERIFIED电话／现场路径在目录不可用时可使用；保留人工联系提示，零新增Message／Communication／Outbox／Delivery／Reporter Grant或外发。资源沿单App／Worker、Gateway单活、SSE32、共享pool4／总预算8，单表单in-flight1，无新worker／timer。关闭任一新入口依赖隐藏按钮、拒绝新复合命令；已提交受理、责任、轮次、事件及原回执保留。尚未运行的验证覆盖授权／合法组、默认关闭／缺readiness、规则Review拒绝、完整回滚、并发／原UUID冲突、原T17恢复兼容、UNKNOWN、撤权、固定24h和真实production bundle；不能据本合同推导已验收。
