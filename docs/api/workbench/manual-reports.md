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

## T18 经核实成员选择（冻结合同，尚未挂载／NOT_RUN）

2026-10-09 SOURCE准备，仅冻结[#73](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/73)的公共输入输出及首个GET tracer。下面是计划合同，不能据此调用现有服务或宣称验证通过；本票[执行记录](../../../plans/admin-workbench-integration/execution/t18.md)区分后续实际运行。上文T17已交付合同、HAND_ENTERED／UNVERIFIED快照及原证据不改写。

| 方法与路径（W，计划） | 输入／输出 |
| --- | --- |
| `GET /api/workbench/reporter-candidates?q={query}&limit={limit}&cursor={opaque}` | 当前工作人员认证及代录创建权＋配置应用与候选对象授权；闭合[候选页Schema](../../../contracts/workbench_reporter_candidates.schema.json)，不返回原始外部ID、手机号、工号或完整目录 |
| `POST /api/workbench/reports` 的独立选择分支 | [选择命令Schema](../../../contracts/workbench_verified_manual_report_command.schema.json)；相同source／description／location／UUID规则，reporter只接受`verification:VERIFIED_SELECTION,candidate_ref,candidate_version`；由服务器重核，禁止浏览器提供姓名／部门／WeCom ID／proof／actor |
| 同原`GET /api/workbench/reports/commands/{commandId}`的已提交选择结果 | 同principal＋MANUAL_REPORT原ledger与恢复配置；计划闭合[核实结果Schema](../../../contracts/workbench_verified_manual_report_result.schema.json)，不会从当前目录重新生成旧回执 |

候选查询仅接受`q,limit,cursor`，参数不得重复；q去首尾空白后2–100字符，单行且拒绝控制字符；limit默认10、最大20；cursor为最多512字符的opaque引用，绑定当前principal、配置corp／app／目录scope、query、limit和资料版本，最长5分钟。不存在、过期或不匹配cursor返回400。候选页最多20项、16KiB，每人最多20个部门名称、名称1–100字符，不包含联系方式或头像；名称与部门仅用于展示，不能证明身份对应。候选引用最多256字符，版本为64位小写SHA256形式，二者均不是授权凭据。

应用范围来自宿主受控配置，不接受浏览器指定corp／app／source scope。沿T17当前active ADMIN／DISPATCHER或属于active处理组的HANDLER创建许可，查询完成后再次检查当前认证／许可。窄`ManualReporterDirectoryPort.searchAuthorizedCandidates`在分页前裁剪该principal可枚举的对象范围；`verifyAuthorizedCandidate`在提交时独立重核同一应用与对象、资料版本、账户有效性、现有明确绑定及消息可达性。公共Port合同见[类型定义](../../../contracts/workbench_reporter_candidates_contracts.d.ts)。首次只验证GET正向切片；伪造引用、跨principal／应用、撤权、分页及离线均待各自真实RED。

身份对应复用既有`YxxIdentityMapping`的`VERIFIED_DELEGATED_MAPPING`／configHash和`YxxMemberScope`的corp／app／canonical hash／proofRef；当前资料复用既有Directory Provider／Store及显式ProviderUidResolver。第三方`user_id`、`wecom_id`、官方`open_userid`、Bot UID、姓名与手机号没有自动等价关系。现有directory.identity_binding只证明特定目录scope中的解析，不能单独证明目标应用账户或可达性。配置映射不匹配、目录绑定STALE／CONFLICT、账户停用或重核失败拒绝该选择，不偷偷降级或改绑；用户可显式切换既有手填分支并形成新意图UUID。UNKNOWN原UUID／body仍不可更改。

`binding_verified:true`只表示候选已具备明确绑定；`message_reachability:REACHABLE|UNREACHABLE|UNKNOWN`独立来自目标应用可达性证明，不由ACTIVE、能登录或目录存在推定。提交重核绑定成功且本次可达才记录`notification_eligibility:ELIGIBLE,manual_contact_required:false`；已核实绑定但不可达／未知仍可受理，记录`NOT_REACHABLE,manual_contact_required:true`。回执`reporter_verification:VERIFIED`仅指本次独立选择证明，不改变T17的UNVERIFIED含义。所有本票回执仍`external_notification:false`，不表示已发送；后续应用通知由T26及原独立外发开关／Outbox／Delivery合同承接，T18不直接调用Sender。

预计使用父任务专属预留045的最小forward扩展：同一Service Intake保存独立的报修时姓名／部门、目录来源／版本、核验时刻、实际代录Principal、既有映射configHash及scope／proof引用、分别观察的可达性与通知资格。原T17列和历史快照不更新，不把旧UNVERIFIED记录提升为身份绑定；新选择分支与原手填分支互斥。这里只保存该次验证的观察与既有权威引用，不建立第二套Person／目录绑定／Ticket／owner／receipt事实源。选择证据与受理／Decision／Core或Review沿原账本同事务提交，失败全回滚；目录后续变化不回写已保存快照。045尚未写入或应用，具体最小结构必须由后续选择提交的真实RED驱动。

计划配置`workbenchReporterCandidatesEnabled=false`，同时要求原代录开关；关闭该选择入口无需目录或新结构，既有手填仍可受理。配置端口缺失、目录离线／超时／结果超限用503稳定P2_016错误包并保留输入及手填入口；无结果返回200空页，不伪装离线。输入／cursor400、认证401、权限403、选择版本／绑定变更409、变意图UUID409。重放先验当前创建权与选择对象权，随后只读原结果，不以新资料重写历史。

目录整次请求含解析最多2000ms、并发1、每principal每60秒最多10次、速率状态最多128个主体且惰性清理；无无限队列／后台全量同步／新timer。读既有本地当前目录优先，外部适配只在已批准独立运行边界内装配，本轮以Stub替代外部目录、映射及可达性。单App／Worker、Gateway单活、SSE32及共享pool max4／总预算8保持。关闭选择配置停止查询和新选择命令；已提交原账本及快照保留，结构修复用后续迁移。生产bundle选择、手填回退、恢复与失权清理均尚未实现／NOT_RUN。

正式前端计划消费bootstrap可选兼容字段`reporter_candidates_enabled:boolean`；缺字段取false，仅在原代录用途与本票option同时启用时为true。它只控制入口展示，当前创建许可仍取原capabilities，并由每次GET／POST重新验权。浏览器不把候选页缓存当绑定证明；刷新／恢复后重新读取候选，UNKNOWN只保留原选择ref／version及UUID／body并显式GET核对，不能自动以新资料替换原提交。来源资料展示追加独立“本次已核实选择”与实际proof来源；既有T17未核实Reporter展示继续诚实保留。

### 2026-10-10 当前 T17 接缝核对（T18 仍为计划）

T18 专树已正常合入指定集成根`4fececa695f8adea54ce599baa6b5f8cf50665d2`。当前生产`createWorkbenchManualReports`仍只接收T17的HAND_ENTERED／UNVERIFIED命令，runtime与bootstrap尚未消费`workbenchReporterCandidatesEnabled`、`manualReporterDirectory`或`reporter_candidates_enabled`；候选GET与核实选择POST仍未挂载。原fixture透传仅用于待运行首tracer，不代表宿主已有可用入口。

后续最小GET切片须复用T17的当前代录创建权与现有authenticatedHandler，再装配受控应用／目录scope及窄候选Port；在实际HTTP首RED前不预写生产handler。前端继续沿T17当前capabilities、T38 authorization epoch、abort／组件generation及同账号草稿用途隔离。迟到目录页不得覆盖新查询、撤权后内容或UNKNOWN原命令；候选资料只能展示，提交仍须服务器重核。明确手填回退形成新的意图UUID，原UNKNOWN必须先只读核对，不能由新选择或当前目录悄然替换。

本票选择只完成代录受理，不自动派工、接单或创建沟通责任；后续一步处理属T19。首GET、选择提交、快照／回执、离线与失权、正式bundle选择表单依次取得各自真实RED后实施。045仍只预留最小同Intake快照提案，无SQL文件、无迁移执行；本次源码同步与合同核对没有任何运行PASS。

### 2026-10-10 原 GET 真实 RED 后的源码准备

原首测试在固定`cc06a6a37bdd100e4bb3e4ab5a54ce8ed60cff20`经一次build／strict／artifact均native 0后实际调用候选GET，得到404≠200；原候选JSON及Directory响应断言未到达。该原失败与完整制品已保全，本段后继源码尚未重新build、types或运行，**不能宣称GET已验证可用或整票完成**。原执行证据和源码后继身份见[本票执行记录](../../../plans/admin-workbench-integration/execution/t18.md)。

本次源码只准备`GET /api/workbench/reporter-candidates`。生产runtime开始消费`workbenchReporterCandidatesEnabled=false`、`manualReporterDirectory=null`，仅在原代录option与候选option同时启用时处理该用途；关闭时不读取目录或033／042存储。开启后继续核验原T17当前创建许可及033／042 readiness，并把authenticated principal、宿主冻结的corp／app／directory scope和规范化q／limit／cursor传给既有窄`searchAuthorizedCandidates`。目录等待在数据库事务外，返回成功页或错误前再次验当前创建权。配置缺失／无效或目录结果无效用503；POST候选路径不挂载。

GET输入只接受单份q／limit／cursor：q去首尾空白后2–100字符，原值拒绝控制字符；limit默认10、最大20；cursor为1–512字符base64url opaque引用。Directory Port必须在分页前执行对象过滤，并负责cursor的principal／应用／目录／query／limit／资料版本关联及五分钟有效期，向宿主用稳定400拒绝失配或过期；宿主不会把opaque引用当授权凭据或复制第二套目录事实。返回只接受原闭合四字段页与七字段候选，候选数不超过请求limit／20、各名称最多100字符、部门最多20且唯一、ref32–256、版本64位小写SHA256、cursor最多512；额外字段与16KiB超限返回503，合法空页仍200。

源码准备的目录等待加解析deadline为2000ms、全局在途1／无队列、每principal每60秒最多10次、惰性清理rate状态最多128。超时会abort并503；若adapter忽略abort，其单一未结束操作继续占并发围栏，直到实际settle，不能用“已超时”开启第二请求。无常驻worker／全量同步／后台timer；单次deadline timer在请求finally清理。关闭本票候选option停止新查询，T17手填及既有事实保留。

候选GET不执行`verifyAuthorizedCandidate`，不写Intake／Ticket／profile／proof／receipt，不产生外发。选择POST、VERIFIED公开投影／回执、首次proof版本与目标绑定、终态当前对象READ语义、045及正式UI均仍独立前置；本次不预实现它们。bootstrap的`reporter_candidates_enabled`与前端消费也留待其实际UI切片。本票全部七项仍REMAINING，源码后继等待下一唯一运行窗口的原GET GREEN与必要负片。

### 2026-10-10 GET GREEN 后冻结的选择验证／保留合同（POST NEXT_FIRST_NOT_RUN）

固定6493的原GET1已实际PASS，原404RED保持。本段只冻结内部验证IO、公开保留形状和独立POST first，**尚未实现或验证核实选择POST**。内部[proof envelope Schema](../../../contracts/workbench_reporter_verification.schema.json)不是浏览器请求或公开API回复；staff JSON仍仅提交原UUID／来源／描述／位置及`VERIFIED_SELECTION, candidate_ref, candidate_version`，拒绝actor、app、scope、profile、proof和收件人ID。原同名T17手填继续HAND_ENTERED／UNVERIFIED、人工联系、零自动外发，不自动匹配目录。

受控`ManualReporterDirectoryOptions.verificationAuthority`为选择分支单独钉住已有映射authority的`mappingConfigHash,mappingProofRef,proofKind,validationProfile`；GET仍可不配置它。映射digest来自既有`YxxIdentityMapping.configHash`，proofRef来自已核实配置，不能采信请求或目录页提供的任意hash。`SYNTHETIC`只允许`ISOLATED_TEST`，`LIVE`标记也不构成现场／外发授权。该Port必须先用既有显式namespace resolver／verified delegated mapping解析目标，再在当前应用、目录及principal对象范围内核验current Directory记录；姓名／手机号／同格式的ID、候选`binding_verified:true`、schema通过都不是身份事实证明。

`verifyAuthorizedCandidate`的输入为当前principal、受控application／directory scope、原selection与AbortSignal，加闭合用途：首次`purpose:ADMISSION,committed_target_scope:null`；终态POST重放`purpose:READ_COMMITTED,committed_target_scope:<原保存YxxMemberScope>`，后者由服务器按同principal＋MANUAL_REPORT账本及关联Intake取出，浏览器不能指定。它们不能互换。共享2000ms含解析／在途1／有界rate约束仍适用；不在持有数据库事务时等待外部目录。

两种成功返回均闭合`schema_version:1,purpose,selection,application,directory_source_scope,actor_principal_id,object_access:ALLOWED,authorized_at,authorized_at_epoch_ms,valid_until,valid_until_epoch_ms`，再分别只允许`proof`或`target_scope`。ADMISSION proof沿原字段增加`account_status:ACTIVE,binding_state:VERIFIED,proof_kind`及时间epoch；`reachability`独立含`status,target_scope_hash,checked_at,checked_at_epoch_ms,proof_ref`。scope沿既有YxxMemberScope四字段；资料只含目录来源／版本、本次姓名与部门，private binding／mapping references不是Person／Ticket的新权威表。

后续消费者必须同时检查：返回用途与请求相同；selection.ref/version与原提交精确相等；envelope／proof actor等于authenticated principal；两层corp/app、目录scope与宿主配置相等；映射hash／scope.proofRef／proofKind与宿主pin相等；account为ACTIVE且binding为VERIFIED；reachability.target_scope_hash等于proof.scope.scopeHash且同目标应用。Producer必须从既有当前授权、显式映射及binding资料形成这些观察，STALE／CONFLICT／停用／跨对象或应用拒绝；不把任意canonical hash本身当proof。REACHABLE需该实际目标应用的独立非空可达性proof；ACTIVE／目录存在／可登录不能替代它。UNREACHABLE／UNKNOWN在明确绑定有效时仍可受理，资格NOT_REACHABLE与人工联系true，不默默降级为手填。

选择版本约定为现有`hashP2016`的稳定canonical JSON hash，输入精确为`{candidate_ref,scope,mapping_config_hash,verification_method,profile_source,directory_source_scope,directory_snapshot_version,profile_at_report,binding_proof_ref,account_status,binding_state,proof_kind,reachability:{status,target_scope_hash}}`；scope是既有canonical mapped target，不能由姓名／手机号生成。GET producer基于同一当前观察生成版本，ADMISSION producer重查并重算，宿主也重算与原version比较；不能只echo浏览器版本。actor已由opaque ref及envelope授权绑定。授权时刻／expiry／reachability检查时刻及其短期proof reference不参与资料版本，避免每次重核因时钟推进必然冲突；稳定binding／资料／可达性观察变更仍使新提交409。

所有内部绝对时刻采用Asia/Shanghai无时区后缀秒精度与对应epoch毫秒字符串双值，须通过既有time contract验证并相互一致；不得Date.parse猜时区。授权／验证／可达性观察不能在未来，返回时至多5分钟，`0 < valid_until_epoch_ms-authorized_at_epoch_ms <= 300000`且当前时刻小于expiry；proof.verified_at与envelope.authorized_at一致，reachability.checked_at不晚于该时刻且至多5分钟。16KiB与闭合形状也须执行；畸形／错pin／时间不自洽503，当前无权403、当前版本／binding变化409，不能降级或制造成功。

READ_COMMITTED仅返回同原selection、当前actor／application／scope授权和`target_scope`。它必须等于原保存目标，证明当前可读该对象；不要求原candidate_version等于最新目录资料版本，不重建profile／reachability或改写原受理结果。POST仍先验当前创建许可＋对象READ；GET最小ACK继续现有原principal／用途／当前工作人员许可的READ ONLY，不依赖在线Directory、新创建proof或新资料。目录离线不能暗中放行新的选择POST，也不能让他人读取原UUID。

公开[VERIFIED保留投影](../../../contracts/workbench_verified_manual_report_projection.schema.json)闭合为`source_kind:MANUAL_REPORT,source,description,location,reporter:{verification:VERIFIED,name,departments},identity_source:VERIFIED_DIRECTORY_SELECTION,actor_principal_id,manual_contact_required,external_notification:false,notification_eligibility`。姓名／部门取本次原proof snapshot；ELIGIBLE严格对应manual_contact_required=false，其余true。它不含联系方式、raw成员ID、candidate ref、scope/hash、配置或private proof。既有投影Schema增加该独立分支，原HAND_ENTERED分支字段与含义保持。当前生产仍只写／读T17分支，此处schema冻结不是VERIFIED写入实现。

成功／COMMITTED公开字段沿原13字段[已核实结果](../../../contracts/workbench_verified_manual_report_result.schema.json)，只增加已冻结VERIFIED与独立eligibility，不公开人员资料或proof；共享receipt Schema允许这个独立结果分支，UNKNOWN／FAILED与原T17结果不变。新`VerifiedManualReportProjection/Receipt`类型单独声明，未把当前T17生产返回类型偷偷改成已实现union。045仅预留，实际同一Intake private观察／Public projection／Core或Review／ledger的同Tx扩展等待真实POST RED；不新建第二套目录、Person、Ticket或receipt事实源。

### 2026-10-10 原POST真实RED后的最小SOURCE实现（未构建／未运行）

固定83c339的原8294／bc749首片已真实执行：build／strict／artifact全部native0，合法bootstrap及候选GET到达后，POST实际400而预期202；后续verify／VERIFIED／Core／ACK断言NOT_REACHED。原TAP没有读取error body，不能把静态UNVERIFIED-only normalizer原因说成实际response日志。完整原档及释放证据见本票执行记录，均保持原绑定。

本分支后继SOURCE新增`workbench-reporter-verification.mts`消费已冻结closed envelope。待验行为：POST只接受三字段selection，显式候选开关和配置authority有效后，当前创建验权及原账本／用途／hash／原目标读取在READ ONLY事务内完成；Directory ADMISSION或READ_COMMITTED等待在事务外，与GET共用原2000ms／单在途／速率／16KiB约束。返回后再次验当前人员；事务内进入受理及commit前重验人员、scope／ACTIVE+VERIFIED证明与精确版本／时效。错actor／app／目标／pin／形状／时钟503，目录版本或绑定状态变更409，当前失权403；不退回手填或猜绑定。

合法新受理复用原MANUAL账本savepoint、Intake、Journey／Leg、Decision、Core或Review，并在同事务保留原public snapshot及完整private ADMISSION观察；公开结果仍13字段且external_notification=false。资格只表示本次独立可达性观察，不代表Delivery创建或送达。没有调用SDK／sender，没有新增Outbox事实源。手填路径不读045或新增列，仍UNVERIFIED／人工联系。

已提交POST先读取原actor＋用途＋UUID／body hash及Intake保存目标，只作当前对象READ；当前目录资料／可达性变更不重建旧snapshot。并发原命令获胜时，事务后补原对象READ及回复前人员／目标fence；同UUID异body409，不能把原proof改绑另一事项。最小GET ACK仍当前工作人员权限＋原UUID／用途，不请求Directory，返回前重验当前人员，不含原对象profile或private proof。两种回复均闭合解析原保存结果。

042实际约束只允许HAND_ENTERED／UNVERIFIED，故新[045](../../../database/migrations/045_workbench_verified_manual_reports.sql)只扩现有Intake：增加nullable `manual_reporter_verification`及closed VERIFIED快照／private envelope一致性约束；旧27SQL、043与046不改，不回填、不新建Person／Ticket／所有权／receipt表。独立migrator默认check，apply依赖042、校验checksum并关闭max1 pool；当前未运行／未应用。隔离fixture仅在原显式`manualReports=true && reporterCandidates=true`装配它，原账户／角色／业务种子／两首字节／默认false不改。

此SOURCE只准备首受理与最小回执；现有MANUAL公开资料reader／正式选择UI仍为UNVERIFIED-only，VERIFIED详细资料读取、不可变资料公开证明、公共HTTP负权与回滚、物理Delivery守恒、通知接缝及生产制品UI均待后继真实切片。关闭候选开关停止新核实选择，旧T17及最小账本ACK保留；不drop迁移或重写旧观察。全部新运行NOT_RUN，七项不关闭。

### 2026-10-11 051前向数据库修补（SOURCE_ONLY／NOT_RUN）

原03a8公开POST仍503，命令READ为FAILED；query窗口观察到SQLSTATE2201B，尚未定位具体SQL或首cause。045中candidate_ref固定模式的量词上界256存在明确静态SQL语法风险，JS解析与纯copy检查通过不能替代数据库CHECK。旧045与所有历史迁移保持；新增[051](../../../database/migrations/051_workbench_verified_manual_report_candidate_ref_check.sql)只前向替换 `service_intake_manual_verification_check` 的该子句为独立长度32–256及同ASCII字符集判断。其余CHECK／IS TRUE／null与UNVERIFIED／actor与proof规则不变，HTTP／JS／Schema的32–256合同不缩为255，不删除约束。

核实选择路径需要在原045之后应用051。本次原隔离测试caller只准备从STAGED资源读取051并在同迁移事务记录checksum与时间，资源清单仅登记这个具体SQL；既有045 migrator、业务代码、默认false和API无变更，没有生产迁移或部署。DDL、构建及原POST后继仍NOT_RUN，是否解决该事务失败需下一次原公开用例证据。关闭候选开关停止新核实选择，保留旧资料及前向约束；不得以删除CHECK／修改历史045或重写旧观察回退。


### T18 正式管理端接入首例状态（2026-10-11，SOURCE_ONLY）

T18私有候选`f83fbec18eaab714fbc3ca37d0d9b50d640cbc70`上的原候选GET与核实选择POST已各1 PASS；POST实际202并存储原UUID的COMMITTED最小回执。该结果不等同正式管理端支持，也不改变默认关闭和真实外部依赖停止线。原失败候选的日志与收据保持其原状态。

下一首例已注册为[正式PC浏览器单片](../../../tests/wbint-t18-normal-verified-form.browser.test.mts)，**NEXT_FIRST_NOT_BUILT_NOT_RUN**。预定界面合同在既有姓名输入上提供真实候选combobox、授权option和显式选择；提交只沿本文件已有`VERIFIED_SELECTION/ref/version`合同，不上传姓名/部门/proof/actor作为授权证据。当前正式表单仍是手填分支，此项须通过实际生产bundle browser RED→GREEN证明。

报修时资料继续通过已有`GET /api/manual-reviews/{reviewId}`的`manual_report`读取：[闭合VERIFIED projection Schema](../../../contracts/workbench_verified_manual_report_projection.schema.json)已定义safe姓名与部门数组、来源、代录主体和资格；未包含联系方式、原始外部ID或private proof。**当前生产reader与前端decoder尚只支持HAND_ENTERED/UNVERIFIED，本轮没有补齐，因此此合同仍是接入后层NOT_RUN。**最小命令回执不增加人员快照字段；界面必须读取该次持久来源资料，不能把刷新后的Directory名称回写成旧单。

本次只新增一个SOURCE测试及精确导航注册，复用既有HTTP路径、认证fixture和合成Directory Port，无新增REST入口、业务实现或SQL。051仅在新首例caller中复用原已通过迁移setup，不改历史045或共享helper；不以初始SQL伪造业务成功。当前全部新增运行检查NOT_RUN，完整状态见[本票执行记录](../../../plans/admin-workbench-integration/execution/t18.md)。

### T18 完整迁移入口补齐合同（待真实首例验证）

本票需要 045 与其 051 前向修补共同生效。现有公开 `migrateWorkbenchVerifiedManualReports({databaseUrl, mode})` 将覆盖所需 045→051 链；`check` 保持只读，缺任一所需项返回 PENDING，完整一致返回 NOOP_ALREADY_APPLIED。`apply` 校验原 042 前置及两文件 checksum，在原迁移锁与单事务内依序应用缺项，完整存在时 NOOP；返回既有 root migration_id 形状兼容，status 表示整条本票所需链。两 SQL 原字节均不可修改。当前生产函数尚只处理 045，051 由测试 caller 显式应用；此处是补齐合同，尚不能视为入口已通过。
未提交草稿中已明确选择成员时，只随既有加密副本保存选择意图，不恢复成员核验资格。刷新后要求重新选择成员或明确改为手填；候选开关关闭时保留输入并阻止静默提交为手填。已提交而结果未知的副本仍保存原命令和 UUID，只允许原 GET 核对。

### 核实选择拒绝与未知结果合同

单独 HTTP 403、404、409 或错误文字不能证明未受理。核实选择在 Directory 前置核验失败后，仅当当前创建权限仍有效，原命令账本在同 actor／body／UUID／purpose 锁下确定为 FAILED，才可返回闭合错误体 `{"error":{"code":"P2_016_FORBIDDEN","retryable":false},"receipt":{"client_command_id":"00000000-0000-4000-8000-000000000018","state":"FAILED","error":{"code":"P2_016_FORBIDDEN","retryable":false}}}`。两个 code 必须一致，只含原 UUID 与错误，不含资料或目标；原 COMMITTED 不得被失败覆盖，也不通过对象拒绝返回其正文。

浏览器只有严格解析同 UUID 的这类 FAILED 回执，且当前创建能力仍获准时，才清原标识并允许明确手填；错 UUID、额外字段、矛盾 state／code 或一般拒绝均不能作为已失败。提交后权限复验拒绝或其它未知结果保留原操作，当前权限恢复也不新 POST；用户必须显式 GET 核对。真正创建失权继续按原用途清理敏感内容。
