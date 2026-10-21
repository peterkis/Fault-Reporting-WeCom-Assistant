# H5 大库 PostgreSQL 性能评估

本评估按用户2026-10-21追加要求使用 `postgresql-optimization` 与 `postgresql-table-design` 两个技能，依据实际编译HTTP、PostgreSQL 18和任务专用2CPU／4GiB Job证据。它是本轮实施记录，不能代替[续作验收](closure-2026-10-21.md)。技能的一般建议不得覆盖 Unified Ticket Core、ARCH-005、现有UUID、外键和历史迁移合同；本次不改时间类型、主键、Ticket事实归属或持久开关默认值。

当前结论：最终07的原600正式＋90预热已PASS，三view p95为1041.179／624.560／1204.216ms，独立88项账本／阶段／资源复核PASS。下文03／06失败和各私有对照按时间顺序保留，最终结果见[正式07大库结果](#正式07大库结果)，不把后续PASS重绑旧身份。

## 已测瓶颈

正式候选03的manifest为`929b518e178a30dcc80089e67652c58aa4a92d5bd3793c6b99713645438277a9`，工具另行固定SHA。10个真实不同合成成员各有10,000条本人报修，合计100,000条科室记录；10个目标工单各有10,000事件。每视图3轮预热与20轮10并发，完整保留90条预热和600条正式样本。

| 视图 | 正式请求 | HTTP错误 | HTTP p95 | 1,500ms预算 |
| --- | ---: | ---: | ---: | --- |
| home | 200 | 0 | 5,225.262ms | FAIL |
| request | 200 | 0 | 1,133.630ms | PASS |
| department | 200 | 2 | 5,898.220ms | FAIL |

2个科室503的实际Provider核验各1次且正常完成，显式连接池等待约5,248／5,342ms，业务SQL和SQL耗时均为0，未进入业务查询；失败计入完整样本。不能通过增加池、延长等待、过滤失败或放宽1.5秒来通过。App4＋Worker1连接预算、固定100ms Provider、CPU mask3与原hard cap继续保持。

此前受限私有计划中，current_member约0.039ms、10行eligible_reporters约0.119ms、首页本人3条约0.137ms；主要成本在100,000行WB／intake扫描、含长身份字符串的哈希连接、Ticket集合连接及中间结果物化。私有单SQL约266ms不能外推为正式并发通过。正式每HTTP trace包含合计SQL耗时、显式pool.connect等待、实际Provider耗时与HTTP残差；没有逐statement span，不把后处理单次EXPLAIN当作并发请求内逐SQL实测，也不把残差改名为独立Provider／调度队列。

## 查询与表结构决策

1. 优先对连接顺序和中间行宽做同库对照：先由10行当前获权身份闭合WB窄集合，保留企业、应用、撤销及每行物理留存判断，再连接intake与Ticket。当前目录读取已经集合化，不将其误判为逐条N+1。显式JOIN本身不保证执行顺序，必须核对实际计划。[PG18连接规划](https://www.postgresql.org/docs/18/explicit-joins.html)
2. 仅在单消费首页统计中评估直接聚合，减少100,000行status中间表的额外物化扫描；科室页counts与page共用的完整集合仍保证筛选、分页、稳定顺序及空页非零总数。包含volatile时钟时，不能假定CTE可安全自动折叠，逐处guard原语义优先。[PG18 CTE物化](https://www.postgresql.org/docs/18/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION)
3. 原WB与intake之间的本人／应用相等判断不可删除。仅可对SQL三值逻辑等价的连接条件形状做私有探针，验证是否能以唯一UUID作哈希键、保留身份比较为剩余过滤；同时覆盖NULL、错误本人／应用、撤销、到期和组织变化。
4. 既有WB本人排序索引、intake和Ticket主键保持。只有执行计划证明扫描宽表造成成本时，才私有对照WB当前有效来源和WEB intake窄覆盖索引；记录既有定义、索引尺寸、blocks、Heap Fetches、写放大与普通执行时间。当前Ticket集合扫描未证明需要新索引，不重复建立PK同义索引。
5. 覆盖索引包含查询列只满足必要条件；MVCC可见性仍可能要求回表。对照不额外VACUUM制造优惠，不禁用autovacuum，不把强制enable_seqscan等规划开关装进产品。记录实际visibility／heap读取与维护状态。[PG18 index-only条件](https://www.postgresql.org/docs/18/indexes-index-only-scans.html)
6. 新索引需要正向实证后由主任务追加下一可用迁移；不修改066或既有历史。保持PK／FK／CHECK及归属规范化，不新增汇总事实表、跨请求统计缓存、分区、扩展、Redis或连接池。10万记录规模目前没有支持分区改造的证据。

## 资源与权限边界

生产热查询和私有对照都采用现有三个事务局部设置16MiB work_mem／hash multiplier2／parallel0。16MiB不是整查询预算；多个hash／sort操作及并发会话按实际内存累计。保存默认4MiB控制计划、局部设置计划、COMMIT／ROLLBACK恢复与Job全树采样，不调大实例或2C4G额度。

每处原物理留存guard继续独立读取真实时钟，禁止替换为now、statement_timestamp、常量或共享clock CTE；当前成员Provider核验、本人／应用／组织关系、SQL后新语句终检、签名游标和reporter-safe投影全部保留。新语法有性能收益也必须先通过语义反例。

## 下一轮验证

先完成fresh受限私有对照：每候选完整DTO深等价、EXPLAIN ANALYZE BUFFERS、3次普通执行、索引／实例设置原件及回滚恢复；无收益候选与失败保留。采用有证据的最小改变后重新严格编译、冻结独立候选并跑18个相关注册入口，再跑完整600＋90。只有三视图原HTTP预算、完整样本、权限及资源均通过，才继续当前候选80浏览器样本和38项QA。

## 第一轮追加对照结果

`large-sql-preflight-13/backend-authorization-probe-04`为绑定候选03的私有SQL诊断，18候选完整DTO和错误范围等价，exit0，设置及索引inventory恢复。没有运行正式600或浏览器，也没有将其中单次SQL结论当作HTTP预算通过。

- Home current普通3次454.13／506.51／475.79ms；Ticket仅投影id/status为293.93／262.90／260.25ms，WB-first加UUID residual为270.81／273.41／293.36ms。current首次有2,636个shared read，后续对照全热；因此不能把全部差值归因SQL，下一轮采用交错current控制。
- Department current为311.21／333.55／336.79ms；UUID residual为328.12／303.90／296.69ms，其他结构未稳定更快。全部temp0，不把它误判为work_mem不足后继续扩大内存。
- 三组覆盖索引均未被实际EXPLAIN采用，仍为SeqScan，没有IndexOnly节点，Heap Fetches为N/A而非0。WB索引14,188,544 B，intake索引15,015,936 B，增加约29.2MB及实际创建／维护成本。当前没有支持新增067的证据，产品未加入这些索引。
- fixture在原约束下先clone intake再UPDATE链接，实际n_live约100,000、n_dead约100,000，只执行既定ANALYZE；本轮没有额外VACUUM。该可见性／维护前提必须保留，不能外推为任何稳态库都不需要覆盖索引。
- Job raw peak commit227,094,528 B、全部成员working-set峰值879,575,040 B；UUID库、其他客户端、PG、监听、pid文件与Job active均0，未强制清理。

另一个待评估想法已排除：现有`retention_until=platform.local_from_epoch_ms(epoch)`配对列截断到整秒，不能直接用本地timestamp列替代毫秒截止比较，否则可能提前最多999ms过期；上海历史DST还存在局部时间歧义。技能对一般时间类型的建议不改变本仓库ARCH-005合同，产品原物理毫秒表达式保持。

## 交错控制与时间比较诊断

`large-sql-preflight-14/backend-interleaved-probe-05`全候选预热后执行三轮轮换，每候选夹在current前后。Home的source-ticket-semijoin普通wall为234.70／231.77／227.48ms，相对同轮控制约0.874／0.855／0.858，有13–15%改善；实际WB intake主键及intake pilot_ticket唯一约束validated均true，证明半连接0／1基数。Department未见稳定收益。所有DTO、错误范围和设置恢复通过，没有DDL或额外VACUUM。

私有十成员SQL、100ms间隔分派的吞吐仍不足：Home current-before／best／current-after总wall为2,578／2,626／3,151ms，Department为3,103／3,033／2,851ms。单任务时延从各自分派计，不含真实Provider、HTTP及其本地串行等待，不能用作1.5秒正式通过。这说明单SQL有限收益尚不足以闭环。作业正常退出、所有资源归零，raw peak commit391,376,896 B、working-set和1,439,854,592 B。

`large-sql-preflight-15/backend-numeric-deadline-probe-06`首先通过16个有限numeric边界，随后在首个NaN域外case停止；微测与热SQL比较为NOT_RUN。原因是私有驱动将NaN／Infinity转int8的SQLSTATE也固定预期为22003。原FAIL与restore.json保留，没有改产品时间表达式。

`numeric-sqlstate-16/observed-sqlstates.json`使用独立小型fresh PG18.4、同Job限制、不种大库，实际证明NaN／±Infinity为0A000，有限正负int8溢出为22003；新numeric比较各返回布尔，五个域外反例均为全域不等价。与[PG18 numeric_int8官方实现](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/utils/adt/numeric.c)一致。诊断约8秒完成、资源归零，不能代替原06未运行的性能比较。

精确代数方案仅在BIGINT整数期限E、有限numeric真实时钟N且旧floor可转int8的域内满足`E > floor(N)`等价`E::numeric > N`，不用float、不存时钟；它仍是未获产品采纳的私有思路。修正驱动06b按域外case分别严格断言错误码、先保存实测值；另备07仅减少同时活动重SQL的调度对照，原pool4、实例、CPU／内存配额均不变。结果仍以各自新证据为准，不回写原FAIL。

`large-sql-preflight-17/backend-numeric-deadline-probe-06b`完整exit0。16有限边界等价、5个域外不等价和精确SQLSTATE均实际记录。100,000行独立真实clock微测，current为37.26／38.59／38.76ms、numeric为36.19／36.53／40.45ms；Home热SQL改写325.91／325.76／399.18ms，相对前后current不稳定；Department约1–11%改善但仍370–403ms。收益不足以支持修改Accepted时间公式及其错误域，产品继续使用原公式。Job peak commit199,405,568 B、working-set和758,947,840 B，所有资源正常归零。

`large-sql-preflight-18/backend-scheduling-probe-07`全部150调用完成，0失败、活动／等待项最终0。原pool4不变，仅私有限制重SQL active4-before→2→1→3→4-after。Home current共同起点p95为2,710／2,668／2,890／2,503／2,543ms；Home05结构为2,283／2,291／3,079／2,253／2,206ms；Department current为2,988／2,925／3,078／3,314／2,881ms。active2使Home单SQL变快，但排队抵消：其从各自分派开始的1,392.7ms不能替代共同发起口径2,291ms，更不能冒充HTTP预算通过。没有足够证据采纳单纯减并发的产品调度。Job peak commit341,106,688 B、working-set和1,323,253,760 B，全部资源正常归零。

下一私有研究限定为封闭在途批次的集合读取，按每成员当前目录重新获权，只对精确相同的有效数据范围合并一次源扫描，禁止结果缓存或SQL派发后附着新请求。每HTTP初始获权及返回前新语句／外层READ仍独立。该方案会合并跨请求重复guard的物理求值次数，若有性能证据必须先前向修订ADR和双账计数，不能声称原逐请求物理次数完全不变。当前仅准备有限SQL探针，尚未获产品采纳或正式验收结论。

真实WeCom iOS／Android首次绘制、相机、录音、渐进播放和前台恢复仍为NOT_RUN；本地启用配置、合成运行及性能通过均不触发部署、现场业务写库、真实发送或Gate。

## 封闭批次 SQL 可行性证据

`large-sql-preflight-19/backend-sealed-batch-probe-08`完整exit0，绑定原候选03及私有模块SHA `85e2519c8a1ecec83df1b0eb9d43a7ce0f693cd81a2faa8df8c957ae858d62fa`。原2CPU／4GiB、pool4、100,000条及实例设置不变；每个slot先在同一SQL中按实际目录关系重新取得完整eligible集合，仅精确集合、source／corp／app和目录新鲜度规则相同才共享一次来源扫描。本人预览仍逐slot读取，科室返回原始页数据而不共享成员游标签名。

| 视图／封闭批大小 | 1 | 2 | 4 | 8 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Home，10成员全部完成wall，三轮范围／ms | 2,582–2,897 | 1,308–1,349 | 781–797 | 499–510 | 287–306 |
| Department，同口径／ms | 2,934–3,260 | 1,448–1,598 | 882–906 | 580–584 | 319–331 |
| 实际物理业务SELECT | 10 | 5 | 3 | 2 | 1 |

各组均执行三轮“10次原查询→封闭批→10次原查询”，前后原查询约2.3–3.1秒。逐slot完整原始DTO、映射与当前授权集合相等；相同eligible集合但corp／app不同的三个slot保持三个独立组，否定对照通过。每slot实际参与一个共享读取阶段，不能将共享SQL只计给首成员、其他成员记0或分摊小数。全部计划及原始结果保存，Job raw peak commit377,069,568 B、全成员working-set峰值1,410,052,096 B，UUID库／客户端／PG／pid／监听／Job active均0，无强制清理。

这证明SQL结构有收益，尚未证明HTTP p95。Provider、首末独立profile、在途队列、取消、截止、签名游标与正式600请求均未由私有探针验证。共同读取会减少跨HTTP重复guard的物理求值次数，原时钟表达式和逐来源guard保留，但不能称为原逐请求次数完全不变。采纳前先前向修订ADR，限定封闭且不可附着的在途批次；不得缓存资格或已完成结果，不引入新事实、数据库池或服务。

## 产品采用与执行边界（2026-10-21续作）

私有08的正向证据之后，主任务已先前向更新ADR-0036、ARCH-005和API合同，再将封闭在途批次写入产品。仅首页及无筛选科室entry第一页使用；初始事务释放后入队、共同SQL释放后各自新语句profile／组织关系及外层READ终检。每HTTP的Provider、bootstrap、CSRF、recovery scope和游标签名均独立；SQL派发即封闭，后到者只入下一批，已完成结果不缓存。原时钟表达式和逐来源guard保留，共享扫描减少跨请求重复求值次数已明确记为前向行为变更。

实际容量为一个活动SQL批次、单批最多10成员、总计20个在途预算，包含初始／队列／终检／尚未完成的原生连接任务；输入256KiB和尚存结果4MiB为全局上限。5秒单调截止从HTTP入口开始，单个成员到期不会杀死同批仍在有效期的其他成员。已开始SQL必须等待真实服务端结果或statement_timeout及COMMIT／ROLLBACK完成，才归还活动槽；未开始SQL的迟到连接等待真实销毁事件。异常数据库网络断开不能仅凭本地Promise拒绝声称服务端执行已经停止。原池4＋Worker1、16MiB/hash2/parallel0与2CPU／4GiB不变，没有采用新索引或新增迁移。

实际物理SQL逐条记账，每个参与成员另记初始1／共同1／末尾1三个阶段；共享耗时是请求依赖，不能按参与人数复制成物理吞吐，也不能从HTTP耗时扣除。读批次排队、每次pool.connect、Provider实际耗时、SQL执行和整体HTTP分别保存，Provider内部队列没有独立测量时保留NOT_RUN。新增8项纯测试、8项PG／HTTP集成子场景和7项观测计量测试已纳入原selection，合计21入口。04／05真实注册FAIL及其修复另见续作验收，正式大库预算仍须以随后同身份完整690请求证明。

## 正式06结果与进一步瓶颈判断

原690请求全部完成、HTTP200，但正式home／request／department p95为1623.724／1134.638／1674.263ms，首页和科室仍FAIL。该结果完整绑定06，不用私有08单SQL约300ms替代端到端预算。formal home93批（13/20轮五批、13轮最后单成员），department79批（17/20轮四批）；原Provider串行、立即封闭与单活动SQL共同形成小批次，禁止SQL派发后附着仍保留。

actual后测Home单批execution311.228ms、group_reads304.378ms，Department373.454／368.674ms，来源集合约占98%。Home长身份＋UUID哈希约18,407KiB，Dept授权来源100,000行join195.783ms、物化keys218.827ms，再Ticket join311.325ms，reports扫描和有限排序至336.834ms。全部计划temp0、Hash Batches1。实际初末checkout p95不到0.5ms、共享checkout约5ms；没有证据通过增池或增work_mem补齐123–174ms缺口。

当前仅研究09私有SQL对照：默认同关系group首页直接聚合、科室无筛选第一页window统计及窄Top21之后的有限展示投影、完整等式作为residual减少长文本哈希。不得据此删除归属、来源或物理留存guard；legacy／filter／cursor SQL不改，NULL、错scope、真0条与完整DTO等价先于性能。所有候选沿原16MiB／2／parallel0、同fresh2C4G数据和交错baseline验证，不新增DDL、额外VACUUM或资格缓存。未取得实证前产品与测量源码继续STOP。

### 私有09结果与后续有界核验调度

`large-sql-preflight-24`在fresh `pg-attempt24`、原Job及pool4完成，仅SQL Component诊断，不启动正式Worker或690 HTTP。模块SHA为`4ea576155f191c69d95e1b61aad2f642c0d248985f55857c787b9f58624ced2e`，无额外依赖、DDL或VACUUM。130 physical business SELECT与15 EXPLAIN分开计账，完整DTO、8组否定边界与81个NULL真值案例通过，原设置恢复。private使用member0 BOT固定字段，适用边界见原报告，不能代替每人完整HTTP验证。

Home直接统计A单独收益不稳定；A＋完整条件UUID residual在slots1／3／10的三轮交错对照均改善，相对相邻控制为0.833–0.953倍。Department窗口方案B无稳定收益，slots3为1.084–1.109倍，未采用。只有Home A+C进入正式静态构造器，其完整SQL SHA为`1af2bc9876d6154719ff9fa9930d7e532b5ad1305d9523d311bb19fcddbfb15f`；Department完整SQL及11种其他构造器与06逐字相同。原guard、proof、本人预览及有界尾部保持，不引入私有字符串替换实现。

私有作业正常exit0，raw peak commit258,514,944 B、全成员working-set和1,048,424,448 B；UUID库／客户端／监听／pid／Job active均0。原06 FAIL未重绑。独立评估认为双活动重SQL会扩大结果预留与取消管理，且无性能实证，未采用。

主任务先前向更新ADR-0036／0033、API／runbook和资源合同，再装配性能entry专用的当前成员核验入口：与BASE共享APP总2实际／32项、BASE最多1，默认仍1／32，不叠加两个队列；Gateway／Bot和发送不选新入口。逐HTTP实际Provider核验一次、原5秒含排队、底层真实settle占槽、单活动SQL及所有终检保持，2C4G／池4＋Worker1／1.5秒指标不变。新诊断仅opaque操作ID与实际queue/start/settle单调时刻，不含成员或秘密；此前Provider queue NOT_RUN原件保留，新测量必须由实际边界直接取得。实现后以新独立编译身份跑25相关注册入口、原690及后续浏览器，未执行前不标PASS。

## 正式07大库结果

冻结manifest `4b0fe5e35cb4305b4c98f63e61b2d0b2cae7d084e21ebd3438aa574604d2a7ce`通过25注册入口／197测试后，使用fresh `pg-attempt26`完成原90预热＋600正式HTTP。每view正式200条，独立审查从完整690原始行重新排序计算home／request／department p95为1041.179／624.560／1204.216ms，均满足原1500ms。06的1623.724／1134.638／1674.263ms失败原件保留；同一2CPU／4GiB、Provider100ms、App4＋Worker1、十成员各1万本人记录、10万科室和十工单各1万事件的协议未放宽。

实际物理业务SELECT2438＝2300 direct＋138 sealed shared，逻辑参与2760＝2300 direct＋460 shared参与；每home／department仍含独立初始、共享读取、独立新语句终检，request为6 direct。690个HTTP均200、Provider690次实际completed、DTO失败0；时间线230 READY及12游标检查完成。并发核验实际峰值global2／BASE1／H5 2／pending10，最后全0，不把容量32写成实测峰值。共享SQL活动仍为1，没有新增池、并行数据库重任务或覆盖索引，也没有067迁移。

这次改善来自有证据的Home窄集合／直接统计、封闭批次减少相同获权来源扫描，以及实际有界核验调度；不是删除安全投影、当前READ、等待后终检或留存判断。科室窗口方案及覆盖索引无稳定收益，仍未采用；私有单SQL结果不能替代本次端到端结果。原始前后EXPLAIN、逐SQL／checkout、真实核验排队事件和690全样本保留在`large-final-07`，阶段与计划独立复核随验收记录补充。

该正式大库Job raw peak commit415,645,696 B、全部成员working-set和1,530,642,432 B，root exit0、无强制清理、active0；PG正常stop0、合成数据库／其他客户端／pid／54184监听均0。Windows提交内存和working-set语义不外推为Linux RSS。07注册轮的单独conhost强制回收已在[续作验收](closure-2026-10-21.md)保留；不能将两个作业的资源关闭结论混写。

真实阶段仪表已补齐：home／request／department的member queue p95为434.170／435.822／439.143ms，actual active为114.833／114.247／113.969ms；这不是用HTTP残差估算。home／department batch queue p95为310.908／342.482ms，共享SQL为365.530／380.563ms；初始checkout均不到0.12ms、终检约6.6ms、共享checkout约10.6ms。各列为不同请求的独立分布，不能相加冒充HTTP分解；详情终检同一事务连接，无单独final checkout／shared阶段。690阶段行、详情6个SQL位置及实际p95请求见`large-final-07/derived-stage-review-07.json`。

后测11个实际生产计划及15个默认对照完整：temp读写全0、最大Hash Batches1，16MiB／hash2／parallel0及事务恢复正确。科室slots1的801.862ms单次EXPLAIN原值保留，其余实际批次357.200–385.702ms；单次计划不冒充并发SQL p95，也不因端到端预算PASS而过滤慢计划。没有证据需要继续扩内存、池或添加覆盖索引。所有执行到此STOP，实机及生产Profiler保持NOT_RUN。
