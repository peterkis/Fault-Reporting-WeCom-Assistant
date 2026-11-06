# 桌面登录与验证导航

桌面扫码、准备态、工牌/背景、原生恢复及安装包任务从这里进入。业务与权限边界继续按[开发规则](development.md)，验证选择按[验证规则](validation.md)，交付与保全按[会话运行](session-operations.md)。

## 先选宿主和生命周期

| 目标 | 实现入口 | 对应验证 |
| --- | --- | --- |
| 本地启动视频与播放器故障 | [startup.html](../../app/pc-admin/desktop/startup.html)、[startup.mts](../../app/pc-admin/desktop/startup.mts)、[startup.css](../../app/pc-admin/desktop/startup.css) | [原生导航回归](../../app/pc-admin/desktop/navigation-errors.test.mts)中的真实解码与首屏断言 |
| 启动双条件与导航代际 | [startup-state.mts](../../app/pc-admin/desktop/startup-state.mts)、[主进程](../../app/pc-admin/desktop/main.mts) | [状态转换回归](../../app/pc-admin/desktop/startup-state.test.mts)及原生交接 |
| 网页准备态、扫码场景整体出现 | [服务端HTML](../../app/server/src/workbench-embedded-login.mts)、[login.css](../../app/pc-admin/src/login/login.css)、[main.ts](../../app/pc-admin/src/login/main.ts) | [正式编译登录浏览器回归](../../tests/workbench-desktop-session.browser.test.mts) |
| 工牌、官方面板与提示投影 | [Lanyard.tsx](../../app/pc-admin/src/login/Lanyard.tsx)、[Lanyard.css](../../app/pc-admin/src/login/Lanyard.css) | 同一活iframe、拖动/翻面/缩放回退和提示朝向 |
| 背景生成器与帧率/像素预算 | [LoginBackdrop.tsx](../../app/pc-admin/src/login/LoginBackdrop.tsx)、[backdrop-renderer.ts](../../app/pc-admin/src/login/backdrop-renderer.ts) | 隐藏/离线暂停、销毁、背景提交与页面rAF分别测量 |
| 会话续期、网络/渲染恢复和可信窗口 | [main.mts](../../app/pc-admin/desktop/main.mts)、[policy.mts](../../app/pc-admin/desktop/policy.mts)、[preload.cts](../../app/pc-admin/desktop/preload.cts) | 原生导航、安全边界及[Electron编译集成](../../tests/pc-admin-electron.browser.test.mts) |
| 打包与版本 | [desktop.ps1](../../app/pc-admin/desktop/desktop.ps1)、[versions.json](../../app/pc-admin/desktop/versions.json)、[verify-package.mts](../../app/pc-admin/desktop/verify-package.mts) | ASAR白名单、实际包版本、源码字节与安装器哈希 |

网页发布与安装包独立生效；先确认用户看到的是本地覆盖层、网页准备态还是恢复界面，再选择更新方式。命令和版本以[桌面README](../../app/pc-admin/desktop/README.md)及实际脚本为准。

## 启动交接合同

沿用单个默认1440×960、最小900×650的BrowserWindow，不创建小启动窗或展开窗口。本地启动WebContentsView位于远端内容之上；本地标题栏保持可操作。远端登录按目标窗口尺寸加载并保持真实可见性，不能先隐藏远端再等待依赖可见性的背景或挂绳ready。覆盖期间远端输入和焦点由原生层拦截，网页CSS的z-index不承担原生子视图遮挡。

Electron45本机原生探针证明：即使远端getVisible=true，本地覆盖仍可令其document.hidden=true。因此仅在窗口活跃、覆盖尚在且当前登录scene=loading时临时关闭远端backgroundThrottling，让可见性驱动的资源准备执行；prepared、兼容/错误、最小化/隐藏/锁屏/挂起和交接均恢复登录节流，资源准备仍受20秒有效可见预算约束。任一WebContents关闭节流会影响整窗绘制，因此不把它当常驻预热方案；本地覆盖自身保留节流，视频仍明确按原生状态暂停，首播不靠后台计时。业务文档交接后的原策略保持。

启动状态分别记录当前导航代际、视频状态、首帧、`firstPlaybackComplete`、当前场景、窗口活动状态和`covering/releasing/released`阶段。正常交接须当前场景可呈现、窗口可见且未最小化/锁定/休眠、真实首遍`ended`三者同时成立。首遍先结束则手动续播；之后当前场景准备完成可在循环中途交接。播放器从创建到交接始终是同一个video，不在远端dom-ready重建。二维码续期、OAuth回调、页内导航、重试和二次启动唤醒均不重新要求首遍。新的完整文档导航只失效旧场景代际，保留已完成首播；旧代际ready或淡出完成不能交接新文档。

本地video使用原始MP4、muted与playsinline，按原比例contain展示。没有loop属性，真实首遍ended标记完成后手动回到起点继续播放。loadedmetadata、首帧、playing、waiting、stalled、error、play拒绝及解码停滞分别可诊断。renderer和主进程分别按有效可见时间累计8秒故障预算；脚本/preload未启动或无响应也有主进程出口。故障定时器只进入异常回退，不设置播放完成。窗口隐藏、最小化、锁定、休眠时暂停，恢复后续播；遮挡产生的document.hidden另外暂停renderer故障钟，原生事件和页面可见性不能互相替代。关闭/收起立即走既有窗口与托盘生命周期。

视频异常保留明确原因并允许进入已准备的登录场景或现有可操作恢复界面。减少动态效果以独立`reduced-motion`降级退出播放约束，保留`firstPlaybackComplete=false`；验收分别记录系统偏好和显式应急选项。媒体错误、场景超时与正常播完分开报告。交接只发生一次，淡出后释放覆盖视图、媒体及其监听器，不常驻额外播放器进程。

## 登录准备、呈现与兼容

网页将资源准备与实际呈现分开。面板创建成功或可操作失败、背景生成或静态降级均完成后发送`prepared`；它只表示可呈现场景，不证明二维码已显示或可扫码。覆盖层淡出完成并释放后发送`presented`，此时才启动挂绳入场等可见动画；淡出期间仍保持远端不可交互，隐藏/锁定可取消尚未完成的淡出。保留已创建的官方iframe及其WebContents，不因交接重新创建、迁移或导航iframe。背景及挂绳原有隐藏暂停规则保持；背景超时须能形成静态降级，不能阻塞整个登录。

新桥接通过contextBridge只增加版本化的`workbenchLogin.startup.connect`、`prepared`和`onPresented`，不授予认证或业务权限。主进程核对所属WebContents、主框架、允许HTTPS origin、精确embedded登录path、消息形状和当前文档代际/私有nonce；拒绝子帧、非登录页、旧文档及畸形消息。主进程在当前文档dom-ready建立私有文档lease，preload在握手前排队。准备回执中的panel为`created/failed`，backdrop为`shader/fallback`。

旧桌面客户端没有startup能力时，新网页保持原有自主展示。新客户端面对旧网页，在当前文档dom-ready后8秒有效可见时间内未协商connect或prepared，进入有日志的兼容回退；dom-ready在此路径不能证明场景或二维码完整。原生控制栏显示兼容提示，且仅在此模式开放原有“更多”固定恢复菜单，允许重试或使用官方登录页，即使远端脚本未运行也有恢复操作。已协商的新网页适用20秒有效可见资源预算，超时进入可操作恢复，不能被8秒旧页回退抢先呈现。预算使用单调时钟，授权callback与已交接的业务文档不受此资源期限中断。新网页遇到桥接拒绝或准备回执8秒未确认时恢复自主呈现；已确认prepared但presented=false可等待最小化期间首播续播。网络连接恢复与场景准备分别记录：embedded文档dom-ready停止网络重载循环，并保持覆盖下远端可见，资源准备仍须自己的条件。不能因一方未部署而无限循环视频。

仓库使用的`@wecom/jssdk`版本以锁文件为准。[createWWLoginPanel官方合同](https://developer.work.weixin.qq.com/document/path/98622)中，返回实例只说明创建调用完成；SDK没有文档化的二维码渲染完成回调，iframe load也不证明二维码可用。`onLoginSuccess`是用户授权成功，继续既有code/state回调流程，不用于启动ready。同步初始化抛错和onLoginFail须呈现准确原因、重新获取和官方页恢复；跨域iframe内部状态不可读时，局部提示保持“等待企业微信面板”语义，不宣称扫码已验证。

[自建应用Web登录](https://developer.work.weixin.qq.com/document/path/98152)和[Chrome142+适配说明](https://developer.work.weixin.qq.com/document/60094)要求分别核对扫码、桌面企业微信版本、SDK版本和用户本地网络许可。[Electron权限合同](https://www.electronjs.org/docs/latest/api/session)支持相应权限类型，不证明实际快捷登录可用。快捷登录依赖Electron/Chromium、系统权限及企业微信版本；本地网络访问许可沿默认拒绝策略，不无条件批准，拒绝与恢复需独立验收。

## 媒体与打包边界

原件为`glass-reveal-1x (5).mp4`，桌面内命名为[startup-video.mp4](../../app/pc-admin/desktop/startup-video.mp4)，350437字节，SHA-256为`0b52ad1a40dc473a6e6adce5b4ea2297f1ecf62ce73ec87e69d7e15eb5fea65b`。视频为972×972不透明浅灰背景，Electron实际解码边缘采样为`#e9e9eb`，展示上限360 CSS px且contain；不按透明素材处理，不默认转码。视频只进入桌面staging和ASAR，不加入远端登录静态资源目录。

同步维护desktop.ps1的源码/编译复制和builder清单、verify-package.mts的精确ASAR白名单、原生与Electron集成fixture的显式复制列表。源文件及ASAR内字节都核对固定哈希。正式包内播放须用该包的本地文件验证；源码浏览器播放通过不能替代安装包验证。本地CSP仅增加所需`media-src 'self'`；覆盖层维持sandbox/contextIsolation/webSecurity、禁用Node及导航/弹窗/权限限制。

## 几何与准备态取样

逻辑尺寸取`offsetWidth/offsetHeight`或对应CSS值，变换后的外接矩形用于居中/边界检查。视频记录实际videoWidth/videoHeight、展示尺寸、object-fit、首帧与当前时间；以真实画面判断主体完整与浅灰衔接。记录实际viewport、DPI和动画相位；截图文件名只是目标标签，不能替代运行时尺寸。

原生首屏可在合成首响应等待时取样。分别验证登录先准备、视频先结束、多次循环后中途准备、代际失效、异常降级和交接一次。网页用正式编译浏览器检查prepared/presented分离、SDK失败、静态背景及旧桥接兼容；阻断企业微信域名仍scene-ready只证明可呈现及降级，不证明二维码可扫码。原生宿主下挂起defer模块的历史探针曾得到超时/0×0视口，这类结果只记探针失败。先确认`document.readyState`、实际视口和可见性，再解释截图。

原生视图层级、点击/Tab隔离、默认尺寸、窗口控制、离线/DNS/HTTP错误、重试、崩溃、二维码续期和认证安全沿原生用例验证。测试驱动emit的powerMonitor事件只是原生事件模拟；实体锁屏/休眠、100%/125%/150%DPI、正式安装包首帧与交接另列结果。CPU/内存/卡顿须记录硬件、采样方法及原CSS loader可比基线。SDK初始化、真实二维码、手机扫码、授权回调、快捷登录、权限拒绝与恢复分别记账；没有账号/手机/网络的项目标NOT_RUN。

首屏/组件的低成本检查先行，源码、版本及测试稳定后冻结候选。新指令改变目标时保留已运行/未运行结果，再绑定新候选；现有输入指纹和制品检查承担漂移检测，完整命令见[验证规则](validation.md)。原生模拟、正式编译浏览器、真实域名、实体手机/合盖及用户接受分别报告。

## 记录与发布消费端

构建输入、Git树、编译manifest、当前PR head和已部署源head各自绑定原始结果。后继文档提交保留被测祖先，不改写旧`tested_head`。SQL兼容profile的规范化等价、原字节差异及程序/web输出相同必须分别证明。

临时profile优先放在隔离的发布工作区。需要还原开发树的既有操作，应预先保存原字节/哈希及普通runtime的manifest/proof，分别记录“发布包冻结”和“普通树还原”结果；还原异常按已存哈希恢复后调用现有制品校验。当前没有新增通用发布框架或假定文件写入永不失败的检查。

消费报告前读取当前producer的字段：连接器可能把数据放在`structuredContent`，控制台可能只是摘要投影。摘要缺字段时追溯完整原件，例如发布`activation/result.json`；媒体文件数与原件数取本轮快照，数据库行数另记单位。原始缺失/失败保持显式状态，不能从历史常数或绿色健康检查补造结论。

## 合并与退役

按[会话运行](session-operations.md)核当前完整head、适用审查、未解决线程和CI摘要。Codex新格式可能以可信bot的summary/receipt评论报告结果；空的formal reviews列表本身不能说明是否完成审查。发布候选、异常计数或受保护证据合同要求时，下载对应原件核对源SHA、实际执行数与NOT_RUN；普通PR无逐文件核对全部CI制品的默认义务。对象存储签名下载使用独立请求，输出只保留安全字段。

退役前先保全既有改动、恢复引用、忽略的原始材料和安装器，并给旧路径提供归档映射。检查Junction的实际目标；同卷移动链接对象后核目标和共享依赖，不遍历删除共享目标。托管工具返回queued时等真实终态；若把目录判为当前聊天主检出而拒绝删除，保留目录并在适当时detach，报告实际保留状态。聊天通用菜单的“归档”不能当作已完成工作树物理退役的证据。

本次问题、原始来源和改进取舍见[2026-10-31复盘](../retrospectives/2026-10-31.md)。本指南及指针位于现有文档检查器覆盖的`docs/agents`/`docs/retrospectives`内，复用既有CI与19项解析回归。
