# T41 检索 Source 增量，未构建或运行

状态：SOURCE_ONLY / NOT_BUILT_NOT_RUN。基线619d2245402a493e50daddef591527a710c67a3b及其原HTTP first、helper、三份Contract原字节保留。[初始冻结合同](search-design.md)描述619d未实施对象；本页记录其后候选源码，不能当作现有已验证HTTP或T41验收。原七项仍全部PENDING。

## 当前候选源码

P2016 Runtime新增默认false的workbenchSearchEnabled，HTTP/bootstrap候选接线与React可选入口已写入。没有修改部署环境、持久Feature Flag、旧SQL、历史Evidence或Ticket事实源。

GET /api/workbench/search只读。共享纯解析器执行闭合键、重复键、q128码点、枚举/数组、标识、limit1..100和cursor2048上限；HTTP另拒绝非法编码Unicode。原声明和两份闭合Schema保持原字节。错误码P2_016_SEARCH_RATE_LIMITED按已冻结计划加入原闭合码表，429携Retry-After和retryable=true；未引入第二套错误框架。

同一路径补充只读POST：无query参数，body严格为已有WorkbenchSearchRequest的{criteria,cursor,limit}，criteria仍按原闭合DTO解析；沿用宿主32KiB body上限、Content-Type、Origin/跨站与Cookie-CSRF核验；超大body沿原413，JSON/结构非法沿原400，失权保持原401/403。它不要求命令UUID/版本，不写业务或ledger，与GET共用当前READ、完整criteria/HMAC绑定和同一速率预算。正式api.search在完整GET target超过原2048字节时改用此读传输，包含全部原条件、cursor和limit；不截断q或省略条件。GET及宿主URL上限不变。POST沿原READ的signal/epoch、失权与技术失败路径，不经过transportWritable命令门，故仍可用于恢复读取。此接口仅是未构建/未运行的Source候选。

获权规范cards复用原查询CTE。SQL在授权/规范去重之后、ORDER/keyset/LIMIT之前执行编号、描述、留存报修时资料/位置以及责任、来源、原群ref、细分状态、补充、共享时间的AND/OR组合。没有当前页搜索、第三方逐卡目录、总数、隐藏计数、匹配片段或额外全局候选列表。

manualReviewEnabled开启时，搜索将原详情端口可读的COMPLETED/IGNORED无Ticket Intake SELECT并入获权全集；原详情与搜索复用同一SQL文字，保留其授权、留存和Ticket去重条件。原分页看板仍用原活动CTE。该Intake的近期筛选按现有updated_at判断，输出原completed_at仍可为null；没有新增状态、关闭事件或事实源。

T23来源origin关系、T36可读精确材料及已核验响应、T37当前活动安排各从原模板抽成同一个内部SQL常量；原用例与新查询共同引用，未复制第二套事实。T34责任/关注谓词复用原定义。若需要的功能关闭或Schema不可用，拒绝对应条件；网页来源存在而网页绑定Schema缺失时拒绝，不能悄悄漏搜后当完整结果。

游标由当前App临时HMAC秘密签名，绑定principal、原认证session_id（只有既有本地测试profile可由其当前csrf派生不可逆绑定）、角色/组、全部规范criteria和窗口、kind/id/order。不包含rawCookie/csrf。变化或当前anchor已失权/过期/移出匹配条件时400 CURSOR_INVALID；App重启后旧签名失效。

SQL分页完成先释放连接，再复用原公开事项投影。随后新的只读事务在同一末次statement中核验实际认证会话、当前完整角色/团队集合、anchor、选中对象完整投影输入的SHA256摘要和当前continuation。角色和团队从原principal_role、team_member事实读取，集合必须与已绑定principal完全相等；不会在末次readiness等待后继续信任旧团队参数，也不增加授权事实源。认证owner提供原workbench_auth_session、ACTIVE、principal、绝对期限、配置的idle期限及physical clock谓词；入口authContext摘要不能代替当前认证。会话失效401，当前角色或团队变化400。末次输入摘要覆盖当前安全姓名、来源/保留期、匹配条件及排序等，不只比较kind/id/order；等待期间发生变化则400拒绝整页，不返回旧安全字段。next_cursor根据最后当前授权匹配关系重新判断，不沿用早先第limit+1条。没有在持有搜索连接时再等待原投影取得另一条连接。以上均为代码意图；并发、pool=1和实际隐私行为未运行验证。

## 前端与有界读

默认关闭时保留原看板/列表。开启后的显式搜索使用一个查询供三列和列表展示，不为每列并行请求。条件编码与后端复用纯解析器；query key包含完整criteria、当前账号、权限revision/角色和认证到期。初次搜索默认跨全部日期，并包含已取消的当前可读事项；显式近期/取消范围仍被遵守。原分页看板的取消分栏语义不变。列表/看板、详情返回、重载沿同一URL条件。URL中不接受搜索页面自带cursor/limit冒充当前分页。

输入与已提交条件分开；切换展示或外部范围不会覆盖尚未提交的q。提交/改条件传递原AbortSignal，关闭或权限开关回落会取消并清理本票查询；旧回包继续受原读取epoch围栏约束。缓存至多5页、每页50，显示已加载条数而非总数。空条件、无匹配、读取失败分别显示；失败不展示旧搜索卡片，不触碰备注/回复草稿。原事项失权保留board查询族的清理接线，搜索的实时刷新方式见下段。

T38周期刷新不再自动重搜已加载的搜索页，也不把搜索429/技术失败当作全局连接失败。搜索仍保留在原board族，当前身份/角色变化和401/403继续原清理；实际实时hint取消当前principal的全部搜索读，包括data尚为undefined的首次或显式重置请求，并清除结果、提示人工重读。原Query取消和READ AbortSignal约束迟到回包；不在后台重搜、不清搜索输入或业务草稿。20次/分钟和其余资源上限不变。

T15验收后的bfd0331ea060f0830d2d85df9868e60ae73e856c通过普通merge并入本票源码。确认复核并开始处理仍沿用原canonical Ticket查询；装配保留两项独立默认false开关和T15用途清理分支。新增tests/t41-search-review-start.integration.test.mts覆盖真实T15命令后的同Ticket搜索去重、待处理/处理中条件及无权人员隐藏结果，selection为wbint-t41-review-start，并追加到wbint-t41-search。此组合测试只有源码，尚未执行；619d与原HTTP first、helper及三份Contract保持不变。

全App同时最多1次搜索，单principal每60秒20次，限流记录最多256、TTL60秒。新的主查询及末次权限/匹配复核使用局部只读事务和每statement 2000ms超时。原认证及事项安全投影继续走原有受限接口，其实际耗时必须在whole窗口测量；不能把新主查询的statement上限说成整个端到端请求耗时证明。池总<=8、fixture<=4、单App/Worker、Gateway单活、SSE32不变。没有新队列、搜索服务、DDL或索引。

## 待执行与停止线

1. 在619d或未包含本次实现的同步基线，先运行原2883字节HTTP first，区分准备失败与实际HTTP RED；原件不改。
2. 在当前候选真实对象执行适用strict、一次构建、制品绑定和本票测试；当前所有此类结果都是NOT_RUN。
3. 已新增纯合同、分页/当前READ/同名群/关闭/限流HTTP及生产bundle浏览器测试源码，均未运行；不能凭测试文件存在说通过。报修时各字段、所有来源与组合、T36/T37细分状态、同principal不同真实session、实际角色变化、retention、晚到读取和PG EXPLAIN/容量仍需逐项真实验证或补充必要测试。
   本轮另冻结真实Cookie会话logout/physical expiry等待、闭合Intake、跨卡片等待到期、GET/长POST等价/非法与超限拒绝，以及51匹配事项的生产浏览器长Unicode分页和两页T38/人工命令源码。风险测试-only祖先保留五个缺陷，尚无实际RED或PASS。
   dcf6的有限Source审查又指出末次readiness等待中的团队失权、首次/重置pending搜索未被hint取消两项同根残余。82bc0154b4c319226ef3e4ccb8de097ed0febf9b是保留dcf6生产源码的test-only后继，冻结了真实Cookie HTTP等待撤销唯一团队资格，以及真实生产浏览器扣留成功响应、Ticket转派失READ、身份revision不变、真实持久SSE hint先到的两种pending场景。此基线及后来修补均未构建、未运行；应在授权whole窗口先观察真实失败，再验证当前候选，不能把本说明或测试文件当作结果。
4. 根据真实查询计划决定必要索引，当前无DDL。原46SQL和原Contract保持不变，不能为通过测试缩窄范围、增加上限或绕过授权。
5. 全七项/来源WBINT-14/A14执行记录、两轴非作者审查、自有运行资源清理、父验收与独立merger尚未完成。本SOURCE author不自验收，不关闭Issue。
6. 未执行types/build/tests/install/PG/browser、真实外部服务/发送、部署、full/certify或Gate。关闭新flag回到原分页看板/列表；事实和业务草稿不变。
