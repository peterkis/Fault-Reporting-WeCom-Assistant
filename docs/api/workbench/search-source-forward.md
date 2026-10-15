# T41 检索 Source 增量，未构建或运行

状态：SOURCE_ONLY / NOT_BUILT_NOT_RUN。基线619d2245402a493e50daddef591527a710c67a3b及其原HTTP first、helper、三份Contract原字节保留。[初始冻结合同](search-design.md)描述619d未实施对象；本页记录其后候选源码，不能当作现有已验证HTTP或T41验收。原七项仍全部PENDING。

## 当前候选源码

P2016 Runtime新增默认false的workbenchSearchEnabled，HTTP/bootstrap候选接线与React可选入口已写入。没有修改部署环境、持久Feature Flag、旧SQL、历史Evidence或Ticket事实源。

GET /api/workbench/search只读。共享纯解析器执行闭合键、重复键、q128码点、枚举/数组、标识、limit1..100和cursor2048上限；HTTP另拒绝非法编码Unicode。原声明和两份闭合Schema保持原字节。错误码P2_016_SEARCH_RATE_LIMITED按已冻结计划加入原闭合码表，429携Retry-After和retryable=true；未引入第二套错误框架。

获权规范cards复用原查询CTE。SQL在授权/规范去重之后、ORDER/keyset/LIMIT之前执行编号、描述、留存报修时资料/位置以及责任、来源、原群ref、细分状态、补充、共享时间的AND/OR组合。没有当前页搜索、第三方逐卡目录、总数、隐藏计数、匹配片段或额外全局候选列表。

T23来源origin关系、T36可读精确材料及已核验响应、T37当前活动安排各从原模板抽成同一个内部SQL常量；原用例与新查询共同引用，未复制第二套事实。T34责任/关注谓词复用原定义。若需要的功能关闭或Schema不可用，拒绝对应条件；网页来源存在而网页绑定Schema缺失时拒绝，不能悄悄漏搜后当完整结果。

游标由当前App临时HMAC秘密签名，绑定principal、原认证session_id（只有既有本地测试profile可由其当前csrf派生不可逆绑定）、角色/组、全部规范criteria和窗口、kind/id/order。不包含rawCookie/csrf。变化或当前anchor已失权/过期/移出匹配条件时400 CURSOR_INVALID；App重启后旧签名失效。

SQL分页完成先释放连接，再复用原公开事项投影，随后以新的只读事务复核当前scope、anchor、选中对象和排序；next_cursor根据最后当前授权匹配关系重新判断，不沿用早先第limit+1条可能失权的记录。没有在持有一条搜索连接时再等待原投影取得另一条连接。以上均为代码意图；并发、pool=1和实际隐私行为未运行验证。

## 前端与有界读

默认关闭时保留原看板/列表。开启后的显式搜索使用一个查询供三列和列表展示，不为每列并行请求。条件编码与后端复用纯解析器；query key包含完整criteria、当前账号、权限revision/角色和认证到期。初次搜索默认跨全部日期，并包含已取消的当前可读事项；显式近期/取消范围仍被遵守。原分页看板的取消分栏语义不变。列表/看板、详情返回、重载沿同一URL条件。URL中不接受搜索页面自带cursor/limit冒充当前分页。

输入与已提交条件分开；切换展示或外部范围不会覆盖尚未提交的q。提交/改条件传递原AbortSignal，关闭或权限开关回落会取消并清理本票查询；旧回包继续受原读取epoch围栏约束。缓存至多5页、每页50，显示已加载条数而非总数。空条件、无匹配、读取失败分别显示；失败不展示旧搜索卡片，不触碰备注/回复草稿。原有SSE和事项失权使board查询族失效，新搜索沿该族重新读取。

全App同时最多1次搜索，单principal每60秒20次，限流记录最多256、TTL60秒。新的主查询及末次权限/匹配复核使用局部只读事务和每statement 2000ms超时。原认证及事项安全投影继续走原有受限接口，其实际耗时必须在whole窗口测量；不能把新主查询的statement上限说成整个端到端请求耗时证明。池总<=8、fixture<=4、单App/Worker、Gateway单活、SSE32不变。没有新队列、搜索服务、DDL或索引。

## 待执行与停止线

1. 在619d或未包含本次实现的同步基线，先运行原2883字节HTTP first，区分准备失败与实际HTTP RED；原件不改。
2. 在当前候选真实对象执行适用strict、一次构建、制品绑定和本票测试；当前所有此类结果都是NOT_RUN。
3. 已新增纯合同、分页/当前READ/同名群/关闭/限流HTTP及生产bundle浏览器测试源码，均未运行；不能凭测试文件存在说通过。报修时各字段、所有来源与组合、T36/T37细分状态、同principal不同真实session、实际角色变化、retention、晚到读取和PG EXPLAIN/容量仍需逐项真实验证或补充必要测试。
4. 根据真实查询计划决定必要索引，当前无DDL。原46SQL和原Contract保持不变，不能为通过测试缩窄范围、增加上限或绕过授权。
5. 全七项/来源WBINT-14/A14执行记录、两轴非作者审查、自有运行资源清理、父验收与独立merger尚未完成。本SOURCE author不自验收，不关闭Issue。
6. 未执行types/build/tests/install/PG/browser、真实外部服务/发送、部署、full/certify或Gate。关闭新flag回到原分页看板/列表；事实和业务草稿不变。
