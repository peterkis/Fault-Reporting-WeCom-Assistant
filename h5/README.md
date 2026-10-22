## 2026-10-20：V2 H5 实现入口

2026-10-22 部署后连续展示与首次认证调整见 [ADR-0042](../adr/0042_h5_continuous_navigation_and_silent_entry.md)及 [本轮记录](../plans/yixiaoxiu-h5-performance/loading-continuity-2026-10-22.md)：取消骨架，切换保留当前视图，顶部进度条独立延迟和结束；企业微信正常首次认证不展示重连页，外部浏览器显示打开指引。以下旧候选保留各自的实现与验收时点。

2026-10-22 路由与交互修订见[ADR-0041](../adr/0041_h5_react_router_shared_shell_and_interaction_readiness.md)及[本轮记录](../plans/yixiaoxiu-h5-performance/router-ux-2026-10-22.md)：官方React Router接管主内容导航，三主页面共用页头，首页导航与写就绪分别控制；英文工单／日期、分时欢迎语、同秒时间线及快慢骨架同步调整。原生起录确认前保留准备提示，真机漏词改善另行验证。

2026-10-22 单入口录音调整见 [ADR-0040](../adr/0040_h5_single_voice_capture_and_optional_transcription.md)和[本轮记录](../plans/yixiaoxiu-h5-performance/unified-voice-2026-10-22.md)：移除录音方式选择，具备网页采集能力时清晰音频作为唯一回听／上传材料，同一手势尝试企业微信辅助转写；下限为2秒，移除报修页header下方的Quick report装饰标题。真机双路采集不沿用两种独立模式的实测结果。

2026-10-22 本人资料修复：Home／资料弹窗按 [ADR-0039](../adr/0039_h5_member_display_profile.md) 在 entry 后独立读取官方姓名和主部门显示名称；不再要求当前 H5 开放身份先命中第三方本地目录。展示查询复用原有界 BASE 核验，不拖入关键 entry，也不授予科室工单权限。历史能力矩阵、原路径反例、云端只读诊断及本轮验收入口见[资料修复记录](../plans/yixiaoxiu-h5-performance/member-profile-2026-10-22.md)。

本轮性能改造沿[ADR-0036](../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)实施。新增[页面引导／预览／Range](../docs/api/member/h5-performance.md)仅在`YIXIAOXIU_H5_PERFORMANCE_ENABLED=true`显式开启，默认false；新版前端遇明确`YXX_H5_ENTRY_DISABLED`回退原读取。代码／数据并行加载、30秒内存新鲜度、2分钟非活动缓存和统一刷新不替代服务端当前权限检查。预算与实际结果见[性能实施记录](../plans/yixiaoxiu-h5-performance/README.md)。

2026-10-21按用户指定在本目录新增本地`h5/.env.local`（Git忽略），显式设置H5与性能开关为true，配套新本地私有媒体目录、独立媒体密钥及受控FFmpeg路径；App与Worker实际配置解析均验证`performanceEnabled=true`。服务端启动时将`--env-file=h5/.env.local`作为既有完整运行环境的后加载覆盖层；该文件只含H5配置，不能替代成员身份、数据库及宿主配置。密钥使用服务端变量名，不加`VITE_`前缀、不打包到网页。此项为本地配置完成，没有启动其他环境服务，公开进度写开关仍false；详见[续作验收](../plans/yixiaoxiu-h5-performance/closure-2026-10-21.md)。

新版页面使用 Vite、strict TypeScript、React、React Router、TanStack Query、shadcn/ui（Radix）、Tailwind CSS 与 Lingui React i18n，前向边界见 [ADR-0035](../adr/0035_yixiaoxiu_h5_multimedia_and_member_service.md)、[ADR-0036](../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)及[ADR-0041](../adr/0041_h5_react_router_shared_shell_and_interaction_readiness.md)。五种Hash路径由官方声明式路由管理，与页面引导共用类型化路由描述；代码与数据继续并行启动。国际化消息在开发／构建侧预编译，浏览器只加载执行目录；语言功能与既有五个namespace保持。本目录为实际产品源码，现有根构建管线负责正式制品和 HTTP 装配。

- [固定设计基线](design-baseline/README.md)：Stitch 项目“医院IT工单报修系统”的八个移动端屏幕、HTML、PNG 与哈希。
- `src/pages`：工作台、快捷报修、本人查询、工单详情和科室有限共享。
- `src/components/ui`：由官方 @shadcn registry 源码适配的组件，使用原稿的 Inter、Material Symbols 与主题变量；[components.json](components.json) 保留 CLI 配置。
- [Vite 配置](vite.config.ts)：同源 base `/wecom/yixiaoxiu/`，输出 `.build/emit/h5` 及 manifest。正式字体、CSS 与脚本均经 Vite hash 及依赖图登记。

本地开发先使用根目录锁定的依赖，不单独生成第二份锁文件：

~~~powershell
npm --prefix h5 run typecheck
npm --prefix h5 run dev
~~~

开发服务只监听 `127.0.0.1:5196`，`/api` 代理到显式本地宿主 `127.0.0.1:5197`。本地Hash导航提供 `#/`、`#/report`、`#/reports`、`#/requests/{requestRef}` 和 `#/department`，保留浏览器前进后退与查询参数；本人 Bot 历史仍链接原 `/wecom/yixiaoxiu/tickets/{ref}`。

### 显式合成预览

仅 Vite DEV 且 URL 含 `preview=1` 时加载 `src/dev/preview.ts`。该模块拦截本地预览 API 和上传，无现场写库或外发。正式构建会消除模块、预览资料及照片。

~~~text
/wecom/yixiaoxiu/?preview=1&theme=light&lang=zh-CN#/
/wecom/yixiaoxiu/?preview=1&theme=dark&lang=zh-CN#/
/wecom/yixiaoxiu/?preview=1&theme=light&state=empty#/
/wecom/yixiaoxiu/?preview=1&theme=dark#/report
/wecom/yixiaoxiu/?preview=1&theme=light#/requests/11111111111111111111111111111111
~~~

`lang=en` 验证英文，`state=completed` 验证完工评价与未解决反馈，`submit=unknown` 模拟已提交后丢失响应，`submit=409` 验证版本冲突，`auth=403` 和 `error=503` 分别验证失权与暂不可用。预览结果不代替真实接口、实机和现场收件验收。

### 身份、媒体与恢复

所有业务读请求明确协商 `Accept: application/vnd.yixiaoxiu.v2+json`。写命令使用当前 Cookie、CSRF 与原 UUID；列表使用服务端 `search/status/source` 筛选、授权与游标分页，不在当前页过滤冒充全量查询。

报修文字与位置选填，纯录音、图片、视频或文字均可受理；“直接联系我”可不带材料。所有现场材料须上传完成后再绑定报修。录音按[ADR-0040](../adr/0040_h5_single_voice_capture_and_optional_transcription.md)提供一个按住入口：网页能力可用时清晰Blob为唯一回听／上传材料，同一手势通过官方`@wecom/jssdk`辅助录音转写，不上传第二份原生语音。只有浏览器API缺失时使用原生兼容路径；网页权限拒绝不被原生录音绕过。少于2秒友好提示且不入队／上传／识别，合格录音冻结实际时长后保存为整数毫秒；辅助转写不可用不丢清晰材料。照片仍使用原企业微信能力。自动文字绑定录音ID，删除或替换时撤销仍归属该录音的文字，保留用户手动编辑，旧回调不能污染新录音。不实现图片OCR或新ASR服务；真实双路有效音频、清晰回听和转写需单独实机复验。

服务商代开发应用保留应用身份签名，注册就绪交由官方 SDK 按既有配置和客户端版本等待，避免额外强制等待另一类注册。录音由用户按住触发，初始化、原生命令与浏览器能力／访问失败分别提示；拍照回退或原生聊天语音正常不能证明网页录音链路已就绪。仅新版 H5 HTML 允许同源麦克风申请，工作台及其他响应保持原设备策略，系统授权仍由用户控制。

录音卡片位于正文与位置下方、提交操作之前；浅深主题共用结构。底部音频文件入口及tips已移除，照片／视频入口和已有材料预览保留。非录入文本禁止选择和触摸callout，输入区域保留正常选择、粘贴与编辑菜单。媒体上传按预留、原生素材上传、导入或文件上传提供本地安全提示，禁止输出原始Provider错误或凭据。

草稿、Blob、Query 缓存和操作恢复仅在当前成员范围的内存中。Mutation 不自动重试。提交结果不明时保留原 UUID 和用途，页面导航后仍由同一成员范围的内存栅栏阻止第二次 POST，只能显式 GET 核对原操作。404 与暂时 503 均不能证明未提交。401／403 清除受保护内容；范围改变时卸载旧资料、媒体和命令状态。

语言优先使用企业微信 UA 的 `Language/…`，全部中文归为简体中文，其余为 English。主题按 `ColorScheme/Dark`、显式 Light 和系统偏好自动选择，恢复可见时重查。生产入口使用 CSS 深色首屏变量与独立同源小主题脚本；主应用模块不整体阻塞绘制。iOS／Android 企业微信的实际首次绘制、录音权限、原生取消、上传和渐进播放须单独实机验证，未运行项记为 `NOT_RUN`。

### H5 增量迁移维护

已存在的开发库沿原迁移工具安装 036、049、053、063 后，再使用编译制品中的 H5 维护入口核对和安装 064–066。连接由受控环境的 `PILOT_DATABASE_URL` 提供；命令必须另写实际数据库名，名称不一致时拒绝执行。不把配置文件、连接值或密钥上传到 Git。

~~~powershell
node .build/runtime/scripts/yxx-h5-migrate.mjs --check --expected-database=project_development --include-previews
node .build/runtime/scripts/yxx-h5-migrate.mjs --apply --expected-database=project_development --include-previews
~~~

将示例 `project_development` 替换为本次已授权的完整数据库名。省略 `--apply` 时仅检查；应用路径使用同一事务和维护锁，比较不可变 SQL 原字节校验值、ARCH-005 回执时间对与必要约束、函数、索引和外键。已安装阶段只复核并返回 `NOOP_ALREADY_APPLIED`，允许从 064/065 安装继续增加 066。无回执但已有对象、回执不连续或结构漂移均停止，不能改写旧回执、重放冻结的 033/034 全量 catalog、重新初始化工作人员或自动删库。App/Worker 启动不执行迁移。部署及测试结果在 [性能实施记录](../plans/yixiaoxiu-h5-performance/README.md)按候选身份单独登记。

以下保留原后端交接要求；实际新增 API 与 DTO 以 [API 统一入口](../docs/api/README.md)及前向合同为准。

---

# 新医小修 H5 接入要求

本目录预留给新版页面设计。本次只交付后端接入要求，不生成页面布局。业务规则见 [ADR-0034](../adr/0034_mvp_notifications_and_application_members.md)。

## 身份与入口

使用既有医小修企业微信 OAuth 及同源 Cookie／CSRF。报修范围为当前应用可见成员，不逐人写报修名单；这不授予 PC 管理权限。开放身份与 Bot userid 不可互换。页面不能传入通知收件人、群 ID 或 Webhook。

H5 显式装配使用 8 小时空闲、24 小时绝对会话期；entry 及兼容读取的 V2 bootstrap 在当前成员核验、业务查询和终检成功后续期，SID／CSRF 保持稳定。前台恢复合并事件并立即关闭写操作，401 通过一次静默 OAuth 回当前页面；403 显示双语浅深色权限状态，503 可重试。草稿／UNKNOWN 期间不自动离开文档、不重放 POST；重新连接影响会明确提示。旧非 H5 OAuth 的 15 分钟合同不变。

底部导航使用 Hash 路由；30 秒内已访问页面可复用同范围、同组织修订且未失效的内存 Query 数据。30 秒至 2 分钟内的完整旧缓存先展示并后台核验，复核中不允许写操作。页面切换保留当前视图，代码与数据就绪后再切换，不挂载隐藏页面集合。前台复核、手动刷新和写后同步保留强制读取。

按 [ADR-0042](../adr/0042_h5_continuous_navigation_and_silent_entry.md) 移除所有产品骨架与 shimmer；冷启动和切换共用延迟 200ms 的顶部细进度条，最短显示时间只作用于进度条，不阻塞内容。企业微信首次自动认证保持相同加载体验，失败后才显示主动恢复入口；外部浏览器直接提示在企业微信中打开。原 [ADR-0037](../adr/0037_h5_session_resume_and_navigation.md) 的单次 OAuth、草稿／UNKNOWN、撤权清理、范围代际与终检边界保持，动效遵循 `prefers-reduced-motion`。

后端显式选择 `memberEntry.identityMode=VERIFIED_APP_OPENID`，保持已核对的企业、应用、Bot 作用域和 proofRef。先核验并在授权数据库应用 063 增量迁移；启动不自动迁移。新成员不需要 reporterUserIds 或通知目标文件。可选旧名单和原资格文件仅兼容既有身份与记录；不得更换原 Reporter HMAC 或用开放身份冒充 Bot 原始 userid。配置、检查和关闭命令见[运行说明](../docs/runbooks/human-workbench-runtime.md#mvp-通知切换)。

## 接口

复用 [实际 HTTP 索引](../docs/api/endpoint-index.md)及[成员自助合同](../docs/api/member/self-service.md)：

- GET `/api/yixiaoxiu/bootstrap`：能力与当前会话。
- POST `/api/yixiaoxiu/requests`：创建报修，202 表示已受理，沿原 client_command_id 幂等。
- GET `/api/yixiaoxiu/my-reports`、`/api/yixiaoxiu/requests/{requestRef}`、其 `/timeline`：本人报修与进度。
- POST `/api/yixiaoxiu/requests/{requestRef}/supplements`：补充，沿原输入版本和命令恢复。
- POST `/api/yixiaoxiu/requests/{requestRef}/feedback`：明确仍未解决，重开原工单；按 [反馈合同](../docs/api/member/web-feedback-design.md)核能力与恢复。

路由、DTO、版本及失败以实际合同为准；页面设计完成后再装配其入口与 OAuth return path，不自行新增工单 API。

当前成员核验在业务事务前执行，最多 32 个等待项、一个实际查询，5 秒包含排队。等待后再检查本地会话和作用域。拒绝当前成员资格时返回 403；页面清除受保护内容。通知发送独立核验当前资格，不依赖浏览器继续登录。

资格查询暂不可用时返回既有 503，不把网络或 Provider 故障当作成员已退出。页面提示稍后重试。通知在实际发送前遇到这类故障，沿既有 Worker 有界重试；明确无资格仍拒绝，发送结果不明仍需人工核对。

## 通知与体验

实际接单／开始处理和工作人员完工时，由医小修应用向本人发送模板；后台保存报修时核验的收件绑定，退出登录不取消通知。无渠道来源标题；已受理为“工程师正在处理你的工单”。卡片进入本人进度，其他人不能凭链接读取。

页面展示工单业务编号、中文状态、当前进度和下一步动作，不展示数据库 ID、内部规则或投递术语。草稿恢复本期关闭；保留重复提交、版本和结果核对保护。界面文案采用短句、一句一事。

## 接入验收

新可见成员无需配置即可报修；非可见成员拒绝；本人可读、他人拒绝；补充和重复提交不产生重复工单；完工后反馈仍未解决沿原工单新轮处理；应用通知与会话、重启解耦。模拟接口结果不能代替真实设备收件验收。
