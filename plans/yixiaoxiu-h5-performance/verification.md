# 医小修 H5 性能改造验证记录

2026-10-21本地性能续作已完成原预算验证，详见[本轮续作验收](closure-2026-10-21.md)及[PostgreSQL评估](postgresql-assessment-2026-10-21.md)。当前身份与结果如下；后续2026-10-20原候选、失败和未闭环结论作为历史原文保留，不与本轮合并。

## 2026-10-21当前续作

最终候选07基于同一HEAD `b88e5ff1a22110cf5479d89677df77192e034864`及实际未提交输入，manifest为`4b0fe5e35cb4305b4c98f63e61b2d0b2cae7d084e21ebd3438aa574604d2a7ce`，source input为`e5bd346c0a160b26cd73394520807f0bfdf9ce66dbf5562876b2e7386c6c8112`，完整冻结2598文件、36,455,035 B。本轮Evidence根为`D:\wecom-workbench-evidence\h5-performance-closure-20261021-b88e5ff1`。

| 项目 | 07实际结果 | 原预算／边界 |
| --- | --- | --- |
| 构建与相关检查 | strict、875模块语法、制品校验及25项工具／文档回归PASS | 不以类型逃逸或源码回退掩盖问题 |
| 注册功能回归 | 25/25入口、197/197测试PASS，0 skip／cancel／NOT_RUN | 包含原默认成员核验、通知及真实三角色进程浏览器回归 |
| 整页首页业务SELECT | 一次entry同时取得本人3条和科室统计，整页3 | 原6→3；终检计入，额外summary0 |
| 十万大库并发 | home／request／department各200正式＋30预热，p95为1041.179／624.560／1204.216ms | 各≤1500ms；10不同成员，Provider100ms，不过滤慢／失败样本 |
| 大库安全与双账 | 690 HTTP200、每HTTP实际Provider一次；物理业务2438、逻辑参与2760，完整性错误0 | 每请求home／request／department为3／6／3，当前权限及留存终检保留 |
| 物理资源限制 | 固定Windows Job，2允许逻辑CPU＋hard cap、4GiB提交内存，全部后代受限 | 7项真实内核探针通过；非Linux RSS／cgroup认证 |
| 浏览器主基准 | 冷／热首页与详情每组20正式＋3预热，共80＋12，QA38/38 | 390px／4Mbps／1Mbps／150ms RTT／CPU4倍；弱网另记烟测 |
| LCP p75 | home cold／warm 1200／776ms，request cold／warm 1224／784ms | 各≤2500ms |
| CLS与交互 | 最大CLS0.0161743，80交互均MEASURED，最大88ms | CLS≤0.1；代表性交互≤200ms |
| 首屏完整JS闭包 | 最大122752 B gzip，主题408 B | 全部必需依赖合计≤122880 B；最紧余128 B，未放宽 |
| 媒体与关闭 | 真实私有音视频渐进播放PASS；正式大库／浏览器Job无强制清理，资源最终0 | 实机项NOT_RUN；有限空队列Worker不称活跃转码并发认证 |

全SQL账本10021条语句保留，690请求子集物理业务2438＝direct2300＋138 shared、逻辑2760＝2300＋460 shared参与；正式600子集另为物理2120、逻辑2400。460组独立初始／末尾proof的SHA相等、阶段单调且committed；共享依赖不冒充多条物理SQL。原始member账本2187事件／729 operation含setup BASE，其中690 H5_ENTRY与690 HTTP一一映射；实际峰global2／BASE1／H5 2／pending10，最后全0。容量32未实测饱和，不扩称为32项压力认证。独立离线88项检查PASS，见外部`backend/large-07-independent-review.json`与`.md`。

`large-final-07`的Job raw peak commit415645696 B、全部成员working-set和1530642432 B；`browser-final-07`分别609333248 B／1185447936 B。两轮均root exit0、forced false、active0，PG正常停止、合成库／其他客户端／监听／pid0，浏览器／profile／timer／socket与HTTP／媒体资源0。注册07的单独Job raw peak commit1170919424 B、working-set和2015391744 B；最后启动期conhost由固定guardian回收，forced true／最终0及原始时间线保留，不能混写为自然退出。

用户指定的`h5/.env.local`已显式启用H5和性能开关，Git忽略、无VITE变量；默认空环境仍disabled，公开进度写false，67公开文件及36压缩表示未含本地媒体密钥。配置状态为`LOCAL_H5_ENV_CONFIGURED_NOT_STARTED`，不是部署或现场启动。

旧候选03／06大库FAIL、04／05注册FAIL及所有私有失败均按原身份保留。无关旧ARCH-005 token检查器仍为`BASELINE_FAIL_RETAINED`，未修改checker或旧query来消除它，不能称全仓全部检查通过。企业微信iOS／Android真实首次绘制、录音、相机、渐进播放、恢复前台均NOT_RUN；生产React Profiler提交计数仍NOT_RUN，六项局部函数执行探针不替代该项。本地合成结果不推进生产／临床／P2／P3 Gate，不授权部署、真实发送或现场业务写库。

## 2026-10-20历史记录（原文保留）

本记录只覆盖本地合成验证。执行开始于2026-10-20，基点`b88e5ff1a22110cf5479d89677df77192e034864`，分支`codex/yixiaoxiu-h5-rebuild`。没有部署、真实发送、现场业务写库或Gate推进；新增性能开关默认关闭。用户原型、八屏设计基线和历史Evidence保留。

Evidence根：`D:\wecom-workbench-evidence\h5-performance-20261020-b88e5ff1`。本页的相对证据路径均以此为根。

## 测量环境与口径

- Node.js 24.18.0、任务自有loopback PostgreSQL 18、独占合成库、编译HTTP/TLS宿主与任务自有Edge/CDP浏览器。Provider固定模拟100ms，未调用真实Provider。
- 主浏览器基准：390×844、下行4Mbps、上行1Mbps、150ms RTT、CPU四倍降速；冷/热首页和详情各3次预热、20次计量。弱网补充为320px、1.6Mbps，单样本烟测不称为20样本分位数。
- 宿主有16个逻辑CPU、约16GiB内存，未建立专用2C4G物理限制，标记`NOT_ENFORCED_2C4G`。实例内的池、租约、明文、单线程FFmpeg等结构性上限与物理资源认证分别报告。
- gzip统一使用level 9，Brotli统一使用quality 11；首屏预算按当前页面所有必需依赖的去重闭包与主题脚本求和。原计划中的147,025 B未记录同样的gzip选项，对照采用重新测得的147,166 B，不覆写原计划数字。
- 业务SELECT计入权限、绑定、留存与必要终检；事务、保存点和GUC另计总SQL。entry请求与随后独立加载的首页科室统计/人员资料分别记账。
- 服务端十并发基准使用5条报修、10个成员的小数据集。本人1万/科室10万/单工单1万事件为单独SQL执行计划，不外推为十并发大库表现。
- 原基准在较早开发阶段的非专用宿主采集；最终主样本在根重型工具全部退出后采集。网络/CPU降速协议一致，宿主隔离程度不同，因此前后数字是本地观测对照，不是生产保证或严格隔离硬件上的因果证明。

## 固定原基准

`baseline-compiled`为完整冻结运行树，manifest SHA-256：

`c0ec8fd13c42118b4cd4eb08ab28503f427ab9467de4233c748f1ca62b531f8c`

包含2,503文件、34,506,156 B，每个文件大小与SHA见`baseline-inventory.json`。原主JS为478,915 B，gzip 147,166 B，Brotli 126,306 B。

`baseline-main-20/performance.json`保留全部80次计量和各组预热，原始HAR与该运行同目录。

| 场景 | LCP p75 | 页面就绪p75 | 最大CLS |
| --- | ---: | ---: | ---: |
| 首页冷启动 | 2,320 ms | 2,984 ms | 0 |
| 首页热启动 | 1,916 ms | 2,629 ms | 0 |
| 详情冷启动 | 2,040 ms | 2,283.9 ms | 0.03225 |
| 详情热启动 | 2,036 ms | 2,178.3 ms | 0.03225 |

原代表性交互最大584ms，超过200ms目标；十并发首页关键链路`bootstrap → my-reports` p95为2,216.7ms。浏览器、profile、CDP计时器/socket、HTTP/TLS listener/socket与临时TLS目录均归零。

`baseline-weak-smoke-1`仅为每组1次弱网烟测：首页冷/热LCP 3,888/3,340ms、详情冷/热3,820/3,528ms，不作p75结论。

`baseline-large-3/large-data-explain.json`在约束开启的合成数据上保存10份`EXPLAIN (ANALYZE, BUFFERS)`：本人10,000条、科室100,000条、工单事件10,000条。本人列表216.573ms，时间线42.376ms，科室旧统计3,761.873ms、旧分页3,463.101ms。前两次种子构造失败的外键/状态和重复JSON求值记录保留。

## 候选与失败记录

| 尝试 | 身份与结果 | 证据 |
| --- | --- | --- |
| 首轮构建 | 构建PASS；input `6173f4b580e792349c6106e11c096fda40add1f2d79742bc00236531ab6fca77`，manifest `ba8784f35e84f8bd757dc705426d503623f354e7310fb27907836454e3a0b04d` | `final-build.log` |
| 首轮类型Gate | FAIL：度量工具3处非空断言被禁止类型逃逸规则拒绝；改为显式有界样本检查，算法未变 | `final-types.log`、`metrics-repair.tap` |
| 类型修复第一次 | FAIL：负向类型测试的5条`ts-expect-error`说明缺少规则要求的`--`分隔；修正注释 | `final-types-repair.log` |
| 类型修复第二次 | PASS | `final-types-repair-2.log` |
| 第二轮构建 | 构建与制品校验PASS；input `1d4b6a70131a45d442db977e618e903a5fec4795d713740b66ed94b2a8f2887d`，manifest `95500b102e0219033ad1a910a1860767b2a0ae730b6f0ff701b3bbdb374c8f4d` | `final-build-repair.log`、`current-compiled`及inventory、`verified-final-types.log` |
| 第二轮注册回归 | 第13入口FAIL：首块交付后撤销READ，预取的下一块未拒绝。前12入口82/82，第13入口4/5，后5未执行 | `current-registered-18`原summary/TAP/cases/模块清单 |
| 第二轮后5诊断 | 在全新报告中按原routing/flags/双根补跑44/44，0 skip；不更改前一份FAIL，不代替最终18入口 | `current-post13-diagnostic-1` |
| 第二轮浏览器诊断 | FAIL：focus触发entry复核时驱动继续查找动作。需等待真实ready/writeReady和可用动作；失败DOM、截图、HAR保留 | `current-smoke-qa-1` |
| 媒体隔离复现 | 原编译副本4/5，准确复现同一失败；禁用预取并增加等待后READ终检的私有副本11/11、0 skip | `media-agent/read-revocation/red-integration.tap`及`green-integration.tap` |
| 媒体受控等待竞态 | 新增初始化/逐块两子例，在真实metadata SELECT完成后hold返回并撤权；旧实现两例均RED，最小修补后原集成、原races及新增门闩共14/14、0 skip | `media-agent/read-revocation/red-metadata-read-revocation.tap`、`green-with-regression.tap` |
| 浏览器私有驱动诊断 | 修复ready等待后30组页面/主题/语言与导航、四恢复事件合并通过；催单503使后续验收停止。原因是SQL仪表将真实事务包成Proxy，触发现有Realtime appender的Proxy拒绝，非生产写链路缺陷；修复仪表，不放宽生产守卫 | `current-private-qa-diagnostic-2` |
| 扩充私有驱动诊断 | 同一冻结产品字节改用真实实例仪表：催单200、事实恰+1，随后entry503正确显示已提交同步失败且非UNKNOWN；视频1,834,720 B首帧时72,451 B、早完整下载8.898秒，音频960,078 B开始播放时276,454 B、早3.487秒。长中文/英文、真实offline关闭写入→online保留草稿、另一真实合成成员空首页/列表通过。旧UI错误后按钮消失导致原`null.disabled`断言FAIL；最终候选需保持按钮存在且disabled，未放宽此最终断言 | `current-private-qa-diagnostic-3` |
| 稳定身份私有试验 | 仅改session、Home、Detail；原始Identity能力不随checking广播，兼容useSession仍关闭写入；strict与首屏预算PASS，详情gzip 122,650 B，余230 B。工作树原字节与Vite配置不变 | `frontend-session-projection-private-20261021` |
| 工具回归首轮 | 整体exit 1，93项中92 PASS、1 FAIL。唯一失败为旧G2 source-manifest用例15秒子进程超时 | `final-tooling.tap` |
| 工具隔离重试 | 同断言/原15秒时限仍FAIL，暴露`P2_G2_CANDIDATE_INVENTORY_LIMIT`。只读元数据定位到`web/admin-workbench-prototype/node_modules`被G2遍历，在第2,048文件处触发上限。用户既有依赖未删除，生产G2规则未修改 | `tooling-source-manifest-isolated-retry.tap` |
| G2工具夹具修复 | 自有干净源码夹具完整构建后，原15秒子进程和原全部断言PASS，exit 0；用例总耗时332.484秒含clone/构建，不能与子进程15秒混为同一预算 | `final-tooling-source-manifest-repair.tap` |
| 417候选完整浏览器QA | 30组直达、导航、恢复事件合并、空数据、实际私有预览/渐进播放及催单提交后读失败均通过；整体exit 1，唯一失败为严格断网场景等待warning超时。原单次读故障有时被下一focus轮真实200恢复，属于正确恢复行为；旧私有离线实验仅观察过渡checking锁，不足以证明完整离线失败 | `final-smoke-qa-1` |
| 417候选完整注册 | 原routing的18个入口134/134 PASS、0 SKIP；随后新增Timeline重试用例，此记录不冒充最终135例 | `final-registered-18` |
| 严格离线驱动修复 | 等待focus复核真正完成后再断网，观察实际`ERR_INTERNET_DISCONNECTED`、warning和写关闭，联网200后草稿保留；提交后读故障在观察窗持续注入，清理放在finally，不关闭产品自动恢复。30组视图与8项补充验收、原生媒体均PASS | `current-offline-diagnostic-2`、`final-driver3-handoff.json` |
| a754候选注册回归 | 整体FAIL：91项中90 PASS、1 FAIL，后5入口NOT_RUN。媒体首例reserve触发`web_media_initial_retention`，原撤权例通过。创建默认值和到期表达式分别读取volatile物理时钟，跨毫秒违反既有24小时CHECK；开始受控时钟复现，禁止放宽065历史约束 | `final-timeline-registered-18` |
| 留存边界确定性复现 | 自有隔离PG仅将物理时钟改为每次递增1ms，原实际reserve、原065 CHECK保持：2次时钟采样、23514、插入0行，隔离资源归零 | `reservation-clock-proof` |
| 留存边界最小修补 | 新持久回归在旧实现RED，同一23514；单次MATERIALIZED物理时间同时填created/expires后，完整媒体集成6/6 PASS、0 SKIP，两文件strict 0诊断。验证精确24小时、原UUID时间不变、超限1ms仍被原CHECK拒绝；历史065未修改 | `media-agent/reservation-clock-source` |

工具用例修复只将该source/runtime身份验证放入现有`scratch()`自有干净源码夹具并构建，全部业务源码和原断言保留，子进程仍为15秒、库存仍为2,048文件。修复后定向重跑PASS，首轮整体FAIL不改写成PASS。

最终路径核对发现Timeline错误面板仍直接调用无限查询`refetch()`，多页后重试可能顺序重取历史页。最小修补改为已有`refreshRequest → entry`首批重置，不新增Status订阅；真实TanStack observer先保留三页再使下一页503，重试仅请求一次entry、没有历史cursor请求，缓存回首一页。原11例加新增例12/12 PASS，已整合进a754候选且在注册入口再次通过；首屏request gzip 122,676 B，未放宽上限。

工具bootstrap按既有合同会清理本地旧运行树。首轮类型修复时未先完成冻结，首轮完整运行树未能保留；保留构建/失败日志和真实hash，不重建伪造旧快照。原基准完整冻结与第二轮完整冻结均仍保留。

拆包draft 1—7的预算失败/不同分组探针保留，draft 8通过预算；不删除中间失败。组件预检曾因缺少注册资源和Worker测试未等待真实启动门闩而失败，修正测试宿主后记录新的通过，原失败不改写。

## SQL组件预检

以下绑定临时编译模块SHA，明确标为`COMPONENT_PREFLIGHT`，不是最终制品验收：

- `current-large-preflight-1`：科室合并查询2,735.698ms，仍对10万行重复执行初始/进展/目录投影，临时块1,953。
- `current-large-preflight-2`：本人首页候选4条0.604ms；时间线首批21条17.35ms；科室合并查询1,156.114ms，显示投影仅对21条运行，临时块989。仍有10万行关联扫描成本，不能称为消除所有大库成本。
- 小数据entry观察到home/reports/department各3次业务SELECT、6次总SQL，request 6次业务SELECT、13次总SQL；每请求实际Provider核验一次。最终需由新候选重新确认。
- 未发现足以支持额外时间线索引的执行计划证据，没有添加067迁移。066仅新增私有派生预览Schema，不修改历史迁移。

## 完整冻结候选

以下保留各轮真实身份，不能将旧候选的成功结果重绑到新候选。

- source input SHA-256：`fc23b0195302fa14eeb23d88d0c7d7b5876aae348b5e32d14338b1d0c6736272`。
- manifest SHA-256：`417f7bce191e246fe33cb34c0fe171a88faf1647ae209c462a3c5bc96ed85044`。
- 冻结目录`final-compiled`，逐文件SHA/大小见`final-compiled-inventory.json`，构建日志`final-build-read-revocation.log`。864个严格类型实现、351个未迁移历史实现、2,575个输出，原生语法检查864/864通过、并发峰值2。
- 原始Identity能力与检查状态分离，兼容`useSession()`继续关闭所有既有写入口；复核期间补充按钮保留原位并禁用。媒体取消预取，在每块metadata等待后继续READ终检；原失败用例不改弱。
- `final-types-read-revocation.log`：完整strict Gate PASS，生产就绪仍为false。`final-registered-18/summary.json`为该417候选的134例结果，原宿主、flags、双根、FFmpeg与真实PG隔离合同保留，未调用会隐式再次build的CLI别名。
- `final-h5-tooling.tap`：H5构建/压缩/首屏依赖闭包、性能度量与文档检查36/36 PASS、0 SKIP。原93项工具尝试的FAIL与其后定向修复重跑单独记录，不改写原退出码。

a754候选包含最终Timeline重试与严格离线驱动：source input `da788039ea996fb5aa7aed157c44eae608f8dc7a6dda48cf0069a5115d111275`，manifest `a7544207f12c018a33eca324f53d97cabc8a1e90560bda22a573b6b734de3012`。完整冻结为`final-timeline-compiled`，inventory、`final-build-timeline-retry.log`和`final-types-timeline-retry.log`保留。构建、制品校验、strict均PASS；注册留存边界FAIL如上，不称为最终通过。

## 最终候选验收

最终单时钟留存修补已完成，正式制品已构建、校验与冻结，完整严格类型Gate、全部18个注册入口、完整浏览器QA、80个主基准样本、弱网和大数据SQL均完成，自有资源归零。结论为本地合成实施完成；整页首页SQL预算、物理2C4G、大库并发和实机认证没有全部闭环。

- source input SHA-256：`5471e304b305e00632d6e377ea4ffbb36601a5a4df4905003110407f2a3049b9`。
- manifest SHA-256：`366791ca6473520cfe191b18c527474c40b7eda2095d79f98f09185d8585de88`。
- 冻结目录`final-retention-compiled`与`final-retention-compiled-inventory.json`，构建日志`final-build-retention-clock.log`。864个严格类型实现、351个未迁移历史实现、2,575个输出，原生语法检查864/864通过、并发峰值2。
- 相对a754候选只增加媒体预留单次物理时间及对应持久回归，前端字节不变；065历史约束与24小时上限保持。
- `final-types-retention-clock.log`：完整strict、前端类型和负向类型Gate exit 0，状态`MIGRATION_GATE_PASS`，生产就绪仍为false。
- `final-retention-registered-18/summary.json`：原routing全部18个入口、136/136 PASS、0 FAIL、0 SKIP，exit 0；包括新单时钟留存、Timeline多页失败重试、原媒体撤权与V1/V2兼容回归。
- `final-retention-smoke-qa-1/performance.json`：完整浏览器QA exit 0，38/38 PASS（30组视图/主题/语言、8项附加），媒体PASS。此目录的四个单样本仅作烟测，正式80样本另见`final-main-20`，不以单样本p75作预算结论。

最终QA实际断网得到`net::ERR_INTERNET_DISCONNECTED`，warning与写关闭后，再以真实online 200恢复，1,386字草稿保留。实际催单200且事实仅增加1条；随后的entry持续503仍显示committed和页面同步失败，补充按钮保留并禁用，没有误判UNKNOWN。六图、一语音、一视频合法组合进入页面时，图片原件自动读取0、音视频正文自动读取0。

在1.6Mbps媒体连接上，视频原生`requestVideoFrameCallback`触发时已收到70,951 / 1,834,720 B，早于全文件完成8,885.423ms；音频`playing`触发时261,454 / 960,078 B，早3,546.355ms，均为实际受保护同源206响应。TLS测试代理会缓冲上游，浏览器渐进证明不代替后端背压/输出租约回归。QA结束时浏览器进程/profile/CDP timers/socket、HTTP/TLS listeners/socket与临时TLS目录均0，自有隔离数据库及私有目录在finally清理。

该最终候选首屏所有必需JS依赖与主题脚本合计，构建硬上限122,880 B gzip：

| 页面 | raw / B | gzip / B | Brotli / B |
| --- | ---: | ---: | ---: |
| home | 375,947 | 117,562 | 101,502 |
| report | 385,633 | 120,418 | 104,031 |
| reports | 375,800 | 117,664 | 101,604 |
| request | 390,989 | 122,676 | 106,049 |
| department | 374,499 | 117,303 | 101,309 |

主题脚本raw 671 B、gzip 408 B、Brotli 333 B。详情页距gzip上限204 B；后续新增首屏依赖仍受同一构建门禁。静态测量不能代替浏览器实际下载闭包，后者另由HAR核验。

## 最终主基准

`final-main-20/performance.json`绑定最终manifest `366791ca…`，exit 0，保存完整80个正式样本、12次预热与80份HAR。参数与原基准一致；浏览器按实际使用下载字体，并不把全部WOFF2文件算入首屏。首屏JS的实际资源闭包与上表一致，压缩协商选用Brotli。

root独立从80份样本的Resource Timing核对页面就绪前的API启动：每份恰有1次entry，旧bootstrap、独立详情和时间线请求均0。首页随后独立加载department-summary，不能称为整个页面只有1个API或3次业务SELECT。派生检查保存在`root-final-har-critical-path-check.json`，原HAR和样本未改写。

| 场景 | 原LCP p75 / ms | 最终LCP p75 / ms | 原就绪p75 / ms | 最终就绪p75 / ms | 最终最大CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 首页冷启动 | 2,320 | 1,228 | 2,984 | 1,434.4 | 0 |
| 首页热启动 | 1,916 | 840 | 2,629 | 857.3 | 0 |
| 详情冷启动 | 2,040 | 1,192 | 2,283.9 | 1,347.6 | 0.016175 |
| 详情热启动 | 2,036 | 804 | 2,178.3 | 832.7 | 0 |

各组20个样本的LCP p75均小于2,500ms，最大CLS小于0.1。80个样本的代表性交互均为`MEASURED`，最大136ms，原基准584ms；这是有可信点击与Event Timing的合成交互测量，不能外推为真实用户长期INP分布。

十个并发成员、5条报修、Provider固定100ms的合成home-entry p95为1,079.5925ms（目标1,500ms），全部200。每请求业务SELECT 3、总SQL 6、实际Provider核验1次；显式池checkout等待、SQL及Provider耗时分别保留。原基准两段读取链路p95为2,216.7ms，和新entry具有不同往返数。`other_ms`仅为剩余服务开销，调度排队没有独立仪表，标记`NOT_RUN`，不把剩余值冒称排队。

Node RSS样本最大110,944,256 B，仅指HTTP宿主采样，既不是完整进程树峰值，也不是2C4G强制预算证明。浏览器进程/profile/CDP计时器/socket、HTTP/TLS listeners/socket及临时TLS目录均归零；自有DB/private root清理在finally完成。大数据SQL与弱网另行报告，不用本组小数据十并发替代。

`final-weak-smoke-1`使用320×844、1.6Mbps下行、1Mbps上行、150ms RTT、CPU四倍降速，4个单样本烟测exit 0（没有预热或20样本分位数）。首页冷/热LCP 2,244/856ms，详情冷/热2,024/820ms，最大CLS 0.015547。对应基准单样本分别为3,888/3,340/3,820/3,528ms；仅说明这轮弱网场景可完成，不外推长期p75。

## 最终大数据SQL

`final-large-1/performance.json`绑定最终manifest `366791ca…`，exit 0、`MEASURED`；`large-data-explain.json`保留真实10,000条本人、100,000条科室、10,000条单工单事件的6份完整执行计划、SQL SHA、参数类型和BUFFERS。

| 查询组成 | Execution Time / ms | 返回行数 | 临时写块 |
| --- | ---: | ---: | ---: |
| 当前成员/资料投影 | 1.911 | 1 | 0 |
| 首页本人候选 | 0.783 | 4（3条与是否有下一页） | 0 |
| 本人工单绑定/详情上下文 | 0.603 | 1 | 0 |
| 时间线候选 | 23.149 | 21（首批20条） | 0 |
| 当前绑定终检 | 0.098 | 1 | 0 |
| 科室统计与分页合并 | 1,474.798 | 1个聚合结果 | 989 |

科室正文/进展投影仅21 loops，目录补全降至成员数量；service_intake/ticket关联仍有100,000 loops。原科室独立统计3,761.873ms、分页3,463.101ms，新查询减少往返和全量显示投影，但大库成本尚存。首页候选由原列表20条收窄为3条用途，不能将两种载荷的耗时差冒称相同SQL的等价加速。时间线新旧顺序/游标/迟到/缺口语义另由注册回归验证。

本科室单查询已接近1.5秒，加Provider和其它工作后的大库entry并发p95尚未测；小数据十并发结果不能证明该场景达标。未新增未经执行计划证明的067索引迁移；不修改旧迁移或扩大查询连接预算。

## 查询口径与未闭环预算

`final-sql-counts.json`从最终候选的真实HTTP trace提取，每次请求的核验、事务、终检均保留，没有Proxy或重复仪表：

| view | 业务SELECT / 请求 | 总SQL / 请求 | 实际Provider核验 / 请求 |
| --- | ---: | ---: | ---: |
| home | 3 | 6 | 1 |
| report | 2 | 5 | 1 |
| reports | 3 | 6 | 1 |
| request | 6 | 13 | 1 |
| department | 3 | 6 | 1 |

首页单次导航还独立读取department-summary，增加业务SELECT 3、Provider 1；HTML成员校验再增加Provider 1、业务SELECT 0。因此整页首页实际是业务SELECT 6、含HTML的Provider 3，详情导航为业务SELECT 6、Provider 2。若按原计划“home≤3”解释为整页，**该预算未达标**；只按entry接口计算才为3。这里如实保留两种口径，不自动放宽预算，也不删除等待后权限终检或跨请求复用成员资格。导航/重载/动作后另一次focus复核是另一轮，不混入单次启动数量。

以下保持未证明：专用2C4G硬限制、十万科室数据的并发HTTP p95、Provider/调度器独立排队时间、生产React Profiler提交计数，以及企业微信iOS/Android实机路径。资源结构测试、独立函数探针、Node RSS采样与合成浏览器分别证明其自身范围，不互相替代。

## 最终证据与资源关闭

`final-verification-index.json`将136项注册、38项浏览器QA、80样本/80 HAR、4个弱网单样本、6份大库执行计划和逐项文件SHA绑定最终manifest/source input；`final-measurement-summary.json`保存度量、恢复/刷新合并和资源断言索引。最终source harness/QA SHA与编译模块身份再次核验，结束前输入和运行树未改写。

`final-resource-closure.json`状态`OWNED_RESOURCES_ZERO`：PG18.4停前自有合成库0、其他client 0；pg_ctl停止exit 0，PID 11460消失、54184监听0、postmaster.pid不存在。历史数据目录离线保留。自有浏览器process/profile/socket/timer、HTTP/TLS listener/socket/临时目录、媒体磁盘操作/租约/明文预留/等待队列/句柄、FFmpeg进程/临时文件均0。媒体资源来自实际注册fixture finalizer断言；真实设备权限仍NOT_RUN。

root最终再次校验manifest `366791ca…`通过，状态`ARTIFACT_VERIFIED_NOT_ACTIVATED`；文档预算/本地链接和`git diff --check`通过。Git HEAD仍为原`b88e5ff1…`，改动保留在工作树，未提交或推送。没有部署、真实发送、现场业务写库、生产开关启用或Gate批准。

## React更新范围实验

任务外独立目录`D:\wecom-workbench-evidence\h5-render-probe-20261021-85f71026`保存`INSTRUMENTED_RENDER_ONLY`私有实验。67个剔除探针后的源码SHA与最终工作树匹配，7个探针文件的最小diff逐字节可逆；没有修改正式源码/配置/制品。使用真实Chrome隔离上下文、dev preview合成DTO/设备/XHR，没有真实Provider、DB或麦克风权限。

| 场景 | 实际函数入口计数 |
| --- | --- |
| 报修文字输入27字符 | 仅DescriptionInput 27；整页、Provider、材料子树0 |
| 录音3次秒级更新 | 仅Recorder 3；整页、材料子树0 |
| 上传第三张图 | 当前材料叶节点与列表各9，提交区2；整页、Provider和已有两张图叶节点0，最终进度100% |
| 补充输入34字符 | 仅补充弹窗34；详情页、Materials、Timeline 0 |
| 评价输入29字符 | 仅评价弹窗29；详情页、Materials、Timeline 0 |
| 会话复核 | 补充按钮保持同一节点并切换disabled；Materials、Timeline 0，消费检查状态的节点按预期更新 |

计数直接观察函数执行并包含渲染尝试，不以DOM无变化代替。原`render-results.json`、`assertions.json`、`candidate-original-hashes.json`、`instrumentation.diff`与`probe-reversibility.json`保留，root原绑定对应417候选；自有页面和Vite PID 4624退出。

整合Timeline重试后在`timeline-retry-final-20261021`重新同步全部67个H5输入，以同一7个可逆探针完整重跑六项，全部PASS，计数与表中一致。该子目录的`root-final-candidate-binding.json`将67个源码SHA/大小与当前工作树核对并绑定manifest `a7544207…`。本轮Detail原源码12,187 B，SHA `6c1e23021981de7ecb5744d54bb0dbbc4765a8a4c1f28044f964f81d41aaf1d2`。自有page 3、Vite PID 15236和exec 29942退出；5205监听、自有计时器、Blob URL、合成tracks/uploads均归零。未操作共享空白页。

媒体留存修补不涉及H5源码。root再次读取全部67个当前文件，SHA/大小逐项匹配六项实验输入；新建`root-final-retention-candidate-binding.json`绑定最终manifest `366791ca…`及source input `5471e304…`，保留旧绑定，不以新的后端结果冒充旧制品身份。

企业微信iOS/Android实机首次绘制、相机、录音、渐进播放与恢复前台为`NOT_RUN`。React Profiler提交渲染计数为`NOT_RUN`，不以DOM未变化冒称没有React渲染。合成浏览器、源码边界与组件测试分别保留适用范围。
