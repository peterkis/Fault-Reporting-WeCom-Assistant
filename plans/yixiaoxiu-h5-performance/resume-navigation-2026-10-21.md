# Android 前台恢复与 H5 局部导航修复

本轮从 `ccd732235c7a26e87ef3ddf138008d423a1b423d` 接续；执行分支 `codex/h5-session-navigation`。依据用户的 Android 企业微信真机反馈修复，决策见 [ADR-0037](../../adr/0037_h5_session_resume_and_navigation.md)。前一轮发布、Profiler 与大库记录保留原被测身份，不改绑本轮。

## 诊断证据

用户实机报告旧版约 5 分钟锁屏后出现不可恢复的认证提示、底部菜单往返像整页刷新，状态为 **用户观察 FAIL**。企业微信版本仅取得“应用商店最新版”，没有推断精确版本号。

固定旧编译身份的真实 OAuth／原生 HTTP 夹具中，5 分钟对照为 200，16 分钟两次为 401，Cookie Max-Age 为 900 秒；会话有效时当前成员资格撤销为 403。这证明固定 15 分钟且无续期的程序缺陷，**不能确认它就是此次 Android 约 5 分钟现象的直接原因**。云端 12:27 UTC 只读检查显示容器自 10:34 UTC 持续运行、重启和 OOM 为 0、ready 29/29；现有日志未捕获该次请求错误码。state/code 的 5 分钟不等于已签发 session 的期限。

旧页面运行层回归实际重现：温首页往返增加一次 entry，`checking=true/ready=false`；真实 App 分支只输出骨架；401 与 403 进入相同终止状态。Hash 历史正控通过，不能把内容区重建直接表述为浏览器文档重载。

## 实现

- 显式新版 H5 采用 8 小时空闲期、24 小时绝对上限。entry 原当前成员核验、业务读取及等待后终检成功后，同步续期仍有效的原 SID 与浏览器绑定；不旋转 CSRF／恢复范围、不增加 Provider 调用、不改变 OAuth state/code 与媒体请求预算。非 H5 模式保留原寿命。独立 M 宿主也在显式 H5 启动装配时选择该策略；发放过旧模式凭据后禁止中途升级，过期后清空 Map 也不能绕过。
- 401 允许一次 `snsapi_base` 静默认证，成功回原白名单页面及筛选。回调失败回清洁应用壳，返回标记防止自动循环；403 不自动认证，503 保留读取重试。草稿／UNKNOWN 栅栏在清理前捕获，存在时不自动离开文档，也不重放业务 POST。详情补充、评价文字及评分使用独立草稿标记，清理不会覆盖报修或 UNKNOWN 栅栏。
- 温导航使用最多 8 个固定 30 秒访问戳，要求恢复范围、组织修订、generation 一致且 Query 数据完整、未失效。前台恢复立即禁写并合并 entry；手动／写后刷新继续强制查询，取消、旧响应与分页边界保留。
- 应用壳与主内容分离，React 绘制前选择温缓存。认证失败采用原创几何 SVG、双语和随主题变化的居中状态；骨架使用 CSS shimmer，减少动态效果时关闭动画。非关键帮助／命令提示文案按需加载，未修改原型与八屏基线。

## 调试验证与历史候选

私有诊断编译：后端四个既有入口 **54/54 PASS、0 SKIP**，前端页面运行与实际 App 异步 SSR **51/51 PASS**，传输／恢复与原型守卫 **13/13 PASS**；前后端私有 strict noEmit 为 0。它们不是最终根编译、完整 selection 或真实企业 API 验收。

生产 Vite 调试制品 `ui-build-04`：初始 JS 为 111955 B gzip；首页／报修／本人列表／详情／科室总闭包分别为 118331／120040／118440／122475／117103 B gzip，包含主题脚本，均低于原 122880 B 上限。此前超预算制品及失败记录保留，没有放宽指标。

第一批真实浏览器调试验收 28 项中 26 PASS、2 FAIL：8 个导航组合的温往返均为 entry 增量 0、文档增量 0、可见整页骨架帧 0；前台事件合并为 1 次 entry。两项自动 401 恢复均只有 1 次同源 login，保留列表筛选。12 项错误／重试与 4 项正常／减少动态骨架通过。2 项失败为人工重连跳离文档前瞬态 `.is-connecting` 的观测超时，已经实际到达合成 login，未直接判为产品认证失败；后续只调整测试屏障并保留原 FAIL。

以上属于当时的调试阶段；最终根构建、正式浏览器、当前 head 审查／CI、云切换与生产 Profiler 的实际结果分别追加在下文。旧大库 SQL、吞吐与生产 Profiler 数值保持原记录范围，不改写成新候选通过。

### 已冻结的第一候选与录音追加诊断

会话／导航第一候选 `285add114d96fe028ce94d07630e7eb3cd39a35b` 已在干净源码上完成根构建：878 个严格类型目标、2618 个产物，manifest SHA-256 为 `6a017e1ec31ee37e483ec328c932f370cb56b420a3c80cc2a242644f8d4ad88c`。实际 14 个已注册相关非 PG 入口 **195/195 PASS、0 SKIP**。首次调度因并行测试文件漂移拒绝执行 `MIGRATION_INPUT_DRIFT`，恢复原字节后才取得该结果；失败原件保留。后续用户追加录音问题，不能把第一候选直接标为最终发布。

用户确认实际为**服务商代开发应用**，此前“第三方服务商应用”的回答已被更正。当前强制 CORP 和 AGENT 两套 ready 的实现，在真实安装的 SDK 2.4.4 与合成 Android 原生桥中可重现：AGENT 可用、CORP 拒绝时，应用在 `startRecord` 前失败，而同 SDK 所选择的应用注册可以启动；拍照仍可回退到文件输入。自建 CORP-only 的反向对照也保留，但它不代表当前应用身份，不宣称本轮实现自动识别全部应用模式。

静态响应继承父工作台的 `microphone=()`：静态消费者与真实 HTTP 检查均取得该响应头，浏览器录音回归 **12 PASS / 1 RED → 13/13 PASS**。只对 H5 HTML 放开 `(self)`，其他工作台、资源和错误路径保持原设备禁用。云端 13:28 UTC 只读检查确认没有 Nginx 额外覆盖该策略，4 个工单、4 个受理、2 个媒体和 26 个迁移回执均保留，容器重启与 OOM 为 0。该头影响浏览器路径，是否影响企业微信原生桥仍未证明。

SDK 额外依赖和浏览器策略是已复现缺陷；当前提示吞掉了原始阶段，**尚不能确认此次真机启动失败究竟发生在 SDK 注册、原生命令还是系统访问阶段**。本轮拆分安全本地提示，不展示签名、凭据或原始 Provider 错误。冷启动手势时序和真实客户端授权尚无直接证据；实机状态继续 `NOT_RUN`。

录音修复的实际 SDK／控制器私有回归 **35/35 PASS**，H5 与两个注册测试的严格类型检查通过。较新客户端只请求 AGENT 签名，旧 3.0.23 合成客户端仍经 SDK 请求 CORP→AGENT；没有预热时申请权限、自动第二录音器或失败后媒体 POST。新提示仅随报修路由加载，删除四条已无展示调用的基础旧提示。

独立后端审查还发现关闭聚合 entry 的兼容模式缺少滑动续期：实际第一候选在第七小时 V2 bootstrap 200、第九小时 401。现仅在 H5 V2 bootstrap 原 `authorization.read` 等待后终检成功后续期；四个既有 OAuth 入口私有回归 **62/62 PASS、0 SKIP**，覆盖原会话／CSRF／范围不变及撤权、退出、替换、等待到期不续期。其余实际后端差异未发现新的可复现 P1/P2；这不替代最终 PR 审查。

### 第二候选的正式本地与云端组件验证

候选 `135e91e21d18fb1e509c88de49b95c0fc594a5bb` 在干净源码上完成根构建（878 typed、2618 outputs），manifest SHA-256 为 `4ba397081fe813259f6de84f777231e478ceb9b4c8b2c25e9eb545cf23252293`。strict types、14 个实际注册相关入口 **214/214 PASS、0 SKIP**、4 个相关工具入口 **45/45 PASS**、指令链接检查及制品校验通过；未执行本轮 PG 全量／大库重测，不改写前轮结果。

该候选初始必需 JS 为 111819 B gzip，home／report／reports／request／department 总闭包为 118195／120653／118304／122345／116969 B，均含 408 B gzip 主题脚本，仍低于原 122880 B 上限。raw／gzip／Brotli 与逐资源明细保存在正式 `startup-metrics.json`。

同一编译身份的实际父 HTTP→Native→静态资源浏览器验收 **30/30 PASS**：温往返没有新 entry、文档或可见整页骨架，恢复事件合并为一次 entry；401 自动回原筛选、回调标记防循环、403／503、草稿／UNKNOWN、详情补充／评价保护及 reduced-motion 均通过。独立设备策略控制通过：HTML 允许同源 microphone，JS、404 与父 health 继续禁止。所有自有浏览器、页面请求及 HTTP 宿主归零。

同批视觉只读检查没有横向溢出，但测得浅色认证说明文字对比度 **4.4573**，略低参考 4.5。原 30 用例只采集该数值，不能称其已通过 AA。后继修补仅在新认证状态页使用既有 `secondary-text`，并将保护提示正文改为 `foreground`，保留全站配色和原型；后继正式验证单独登记。

该候选已按 2619 个逐文件哈希封装，在现有云镜像的隔离无网络、无配置／数据目录容器运行静态组件 **13/13 PASS**，容器删除确认；只是候选组件验证，未切换运行服务、修改数据库或 Nginx。该阶段 PR 为 [#111](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/111)，当时已请求 `@codex review`；最终候选的审查、CI 与实际切换结果见下文，保留该组件验证的原范围。

新版 iOS／Android 企业微信的锁屏、录音、相机与渐进播放实机复验为 **NOT_RUN**。外部 OAuth Provider、真实业务 POST、通知发送、数据库重置与 Gate 推进均未执行。

外部原件根：`D:\wecom-workbench-evidence\h5-session-navigation-20261021-ccd73223`。包括首次 RED、夹具失配、超预算、所有中间失败、正式结果和资源记录；不上传私密配置。

### 最终候选、当前审查与普通 CI

正式候选 `14dad39133a43f3ea0c3d18e825d151a7ee80f2e` 在干净源码上完成本轮最终根构建，878 typed、2618 outputs；Windows manifest 为 `cf4778d1564828bd90961e3a26788e2662d820c3bba59c03bae94c85129cfaf7`，source input 为 `876a361441f2fd1ab380be57e1a9167acf1d03c5d2b155cada42390470fc349f`。strict types、14 个实际注册相关入口 **214/214 PASS、0 SKIP**、指令链接及正式制品校验通过。四个工具入口在未变工具的 `135e91e2` 上为 **45/45 PASS**，不伪称另跑一次；当前 head 的远端检查独立完成。

| 当前页面 | raw B | gzip B | Brotli B |
| --- | ---: | ---: | ---: |
| 初始必需 JS | 359816 | 111823 | 96268 |
| home | 375975 | 118204 | 101908 |
| report | 384747 | 120659 | 103979 |
| reports | 375833 | 118310 | 102010 |
| request | 388896 | 122347 | 105630 |
| department | 372358 | 116971 | 100886 |

各页数值包含主题脚本，主题为 raw/gzip/Brotli **671/408/333 B**。仍按首屏完整依赖闭包核对 **122880 B gzip**，没有将拆块后的单文件大小冒充总量，也没有放宽上限。

最终正式浏览器 **30/30 PASS**，使用同一候选的生产 Vite 字节，经实际编译父 HTTP→Native→H5 静态挂载。8 组主题／语言／视口组合的温往返均为 entry、文档和可见整页骨架增量 0；前台恢复合并为 1 次 entry。独立 policy 通过，20 项认证可读性断言、42 条文本测量的未取整最小对比度 **6.205360167784985**；浅／深色说明文字分别约 6.21／7.25。182 份计算样式没有低对比或横向溢出记录，26 张截图中独立检查 9 张。该范围不等于全站 AA 认证。648 次 HTTP 均为合成只读 GET，30 页资源、两个宿主最终为 0。

[PR #111](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/111) 对最终完整 head 的 [Codex 审查回执](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/111#issuecomment-6317816441)没有 P1/P2，inline threads 为 0。全部适用 CI 成功；[TypeScript run 39611648564](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/39611648564) 的原始 ZIP 已下载、核 API digest 与 ZIP CRC，实际 **237/237 文件、638/638 测试 PASS**，fail/cancelled/skipped/todo 为 0，`NOT_RUN=[]`。该 Linux manifest `97438a284cded6993d63421a154ace6550c68693335badd7aa72ba709db56084` 与 Windows 编译分开登记；源 SHA／tree `f8f9cd9ae906527136c6d4c53af1fcbbb3bd6ff0` 均核对。PG18.6 清理 `remaining_databases=[]`。没有运行手动 full、certify 或严格 readiness Gate。

PR #111 用 `--match-head-commit` 与保留历史的 merge commit 合并为 `c7825bc378a875c94a604ac067adc9249c2bd10a`。本地 main 从旧点实际快进，与 origin/main 和 GitHub main 为 0/0；合并树等于被测 head。对应本地／远端临时分支已删除，主工作区保留。本记录后续文档提交不改变被测祖先与已封装的编译身份。

### 当前候选的生产 Profiler 复测

本轮单独为 `14dad391` 制作 React19.3.0 的 production profiling 变体，普通 B0 严格绑定上述正式 manifest；P1 实际使用生产 profiling renderer，`PROD=true / DEV=false`，没有 DEV renderer、Vite client 或 preview。P1 详情闭包 131622 B gzip 是仪表额外成本，单列保留；普通 B0 仍按上表原预算验收。未把前轮 `0e1efa7e` 的27窗口改绑为本轮。

首次本轮完整尝试 `current-14dad-03` 因录音起始屏障超时，只有5个窗口且18次页面清理证据缺失，严格为 **INVALID**；最终浏览器／宿主归零不弥补缺失页面证据。`04` 同33份 P1 编译字节的单例观测显示，首次真实按压触发焦点恢复与 entry 复核，期间 writeReady=false、按钮 disabled，尚未创建 recorder，没有安全错误提示。该次是 `sdk.enabled=false` 的合成浏览器路径，不是虚假 SDK 缺少 `ensureConfigReady`，也不是提前 pointerup。

仅修改外部 driver：先以真实中性聚焦触发原前台复核，等 entry 实际完成、writeReady=true、inflight=0 与原250ms安静边界，再开始 hold；不伪造 focus、不关闭终检／刷新、不修改生产源码。`05` 单例取得3次真实1秒 interval，随后 `current-14dad-06` 复用完全相同33份 P1 字节，不重建，完整 **27/27窗口 PASS**，包含9个校准和18个业务窗口。

| 场景 | 三轮活动组件 own 提交 | 无关组件 own 提交 |
| --- | --- | --- |
| 报修正文 | `9 / 9 / 9` | 报修整页、Provider、结构材料列表与已有材料均0 |
| 位置输入 | `6 / 6 / 6` | 同上均0 |
| 录音秒数 | `3 / 3 / 3` | 同上均0；每窗3个真实浏览器1秒计时回调且至少2800ms |
| 上传进度 | 活动材料 `6 / 6 / 6` | 结构列表、整页及两项已有材料均0；收尾SubmitActions各1次 |
| 补充／评价文字 | 各 `7 / 7 / 7` | 详情整页、时间线、材料列表／Provider及无关材料均0 |

校准区分父自身提交与 Profiler 子树回调：Recorder更新时 App.Scope／Report.Scope有3次子树提交，不解释为 App／整页自身重新执行。弃置渲染有真实 attempt、own/subtree均0。零判据未放宽，结构列表非零仍为RED；上传适配器仅合成5段100ms进度，结束100%状态仍实测，未使用真实麦克风、媒体、业务后台或Provider。

最终独立复核为正式输入 **1981/1981** 哈希一致、变化0；捕获输入405份（404份正式输入与1份仅供严格类型解析的原始preview）、复制源码402份、普通B0输出82份、P1输出33份与7份可逆插桩逐项通过。21次页面清理、浏览器原生1s／60s媒体timer、浏览器进程／profile／timer／socket及fixture／server监听和socket均为0；缺失与非零均使整轮INVALID，不能默认成0。最终回执 `profiler-14dad-01/profiler-final-receipt.json` 为34311 B，SHA-256 `e1ec6ab90d8c37220399845da673ce3bc3042a664eb19592d5c4056f52332a0b`。

工具初始的公开`.env.example`白名单、TypeScript AST包误选、preview仅供严格类型解析等准备失败也保留原件，不作为产品缺陷或通过项。末次汇总额外假设三次聚焦都产生新entry的断言FAIL：首次实际focus使entry 1→2，另两次已经前台合法维持1→1，均完成原就绪／安静守卫；只修汇总假设，不修改产品或重跑浏览器。React DevTools commit trace与真实企业微信设备仍NOT_RUN。

### 当前云部署与保留式清理

2026-10-21 **14:43 UTC** 实际切换至上述 `14dad391` Windows 编译制品，使用已有 Node24.20.0／FFmpeg5.1.9 镜像，没有在云端重编译或更改 SQL 换行。2619 个传输文件逐个核验；云端无网络、无配置／数据库挂载的实际静态组件 **13/13 PASS**。当前入口为 [医小修 H5](https://cd3120.mobimedical.cn/wecom/yixiaoxiu/)，HTML SHA 为 `f9186468fb2cad429da470264874fed2ce96b03e80cedcdb870783bd0242a285`，`Permissions-Policy` 实际为 `camera=(), microphone=(self), geolocation=()`；匿名 entry 为 401/no-store，继续拒绝未认证业务读取。

前三次切换保留 FAIL：01 把非公开构建元数据误纳入旧资源拷贝，02 误假设私有配置目录没有历史子目录，两次均在停服务前被守卫拒绝；03 已通过新服务 ready 与页面响应，但旧资源 HTTP 检查失败，自动恢复旧 owner。隔离诊断确认公开目录受安全 `umask` 影响成为 0700，真实 UID1000 读取旧 manifest 得到 `EACCES`。第四次只显式设置已验证公开资源目录 0755、文件 0644；私有配置仍原权限，未放宽。先以 UID1000、network=none、无配置／数据库容器运行实际静态 HTTP 预检，当前 HTML 与上一代主脚本均 200／字节哈希正确，才停止原服务。切换后公网旧主脚本 363809 B 的 SHA 与原件相同，`immutable` 正确；不保留上一代 HTML，也没有第二套活动 H5。

新容器由既有 systemd 唯一管理，Docker restart=no；限制为 768 MiB、1.5 CPU、128 pids，runtime 与根目录只读，私有媒体保留原持久路径。后续读回 ready **29/29**，systemd/Docker 重启和 OOM 为 0，H5/performance 显式 true、AI false。原 **4 Intake、4 Ticket、2 媒体、26 迁移回执、communication SENT9、notification 空**均保持；42 个私有配置文件逐项 hash 保持，媒体 key 与 Reporter HMAC 未更换。此次没有 DDL、重置数据库、主动业务 POST 或测试消息发送。

仅在核对新 owner 与健康状态后，按完整 ID 删除两个已停止的自有旧容器，不删镜像、数据库、密钥、历史制品或失败记录。一次清理预检用旧名字符串匹配误中其作为新名的前缀，尚未删除任何容器；改为逐条 ExecStart/ExecStop 的完整参数匹配后才清理。D 盘下载的 15 个分片共 **15109670 B**，与保留 ZIP 对应区间逐字节摘要相同后删除，ZIP 和恢复 offset／哈希映射保留。先前 WAL 压缩与七工作树归档回收的 8.835072 GB 仍属于[上一轮清理记录](release-2026-10-21.md)，不计成本轮新增回收。

用户未提交的 `.env.example` 原件与忽略的 `.env/.env.pilot/h5/.env.local` 不上传；用户设计原件保留。当前主工作区无额外工作树，所有自有浏览器／Profiler／合成服务按各运行回执清理。完整原件包括上述三轮切换失败、隔离诊断、修复后预检、激活与读回，以及最终 Profiler 的 INVALID 和 PASS；均在本页登记的外部证据根中。

本轮没有重跑候选07的大库并发和80浏览器性能样本，其 2C4G 结论保持原候选范围。新版 iOS／Android 企业微信真实首次绘制、锁屏恢复、原生录音、相机与渐进播放复验继续 **NOT_RUN**，用户此次约5分钟锁屏与起录失败的直接原因仍 **NOT_CONFIRMED**。生产 profiling 只证明合成环境提交范围；公网静态与匿名边界不替代真实成员授权后的交互。不得将本轮合并／部署推进为 P2/P3 Gate。

最终外部原件根仍为 `D:\wecom-workbench-evidence\h5-session-navigation-20261021-ccd73223`：

| 原件 | 适用范围 |
| --- | --- |
| `formal-build-03/`、`registered-related-04.*`、`ci-artifact-14dad.zip`、`ci-14dad-verified-summary.json` | 最终正式编译、214项本地及638项CI，来源分别核验 |
| `browser-qa/formal-14dad-handoff.json` | 30项浏览器、主题／语言、可读性与设备策略、资源清理 |
| `profiler-14dad-01/profiler-final-receipt.json`、`profiler-14dad-01/final-hash-checks.json`、`runs/current-14dad-03..06/` | 生产提交计数、源／制品／插桩、INVALID、诊断和27窗PASS |
| `cloud-activation-resume-01..04.*`、`cloud-static-previous-probe-01..02.*`、`cloud-resume-handoff-01..02.*` | 切换失败、自动回退、UID1000预检、新服务与旧容器清理 |
| `cleanup-ci-download-parts-01.json`、`local-only-config/` | 下载分片→保留ZIP区间映射、用户配置保全；配置不上传 |
