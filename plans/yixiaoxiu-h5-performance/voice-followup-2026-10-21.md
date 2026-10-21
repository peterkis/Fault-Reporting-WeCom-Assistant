# 现场录音、上传与报修操作修复

本轮接续已合并、已部署的 `14dad39133a43f3ea0c3d18e825d151a7ee80f2e`，通过现有 [PR #112](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/112) 交付。前轮会话恢复、温导航、638项CI和27窗口Profiler仍绑定[原验收身份](resume-navigation-2026-10-21.md)，不改绑为本轮通过。新增决策见 [ADR-0038](../../adr/0038_h5_voice_capture_and_transcript_lifecycle.md)。

## 用户观察与定位

用户确认 Android 企业微信现在可以开始录音，状态为 **USER_REPORTED_PASS（仅起录）**；随后报告页面录音试听有干扰感，而同一声音的视频较清晰。用户已更正“上传后才有杂音”的中间回答，本轮依据最终的**页面试听不清晰**继续诊断。音质和上传当前仍为 **USER_REPORTED_FAIL**，不由合成测试改写。

用户还报告删除首次录音再录时保留首次转写、短录音缺乏友好说明、非输入文本可被长按选择、录音卡片位置不便、音频文件入口多余，以及 Retry upload 进度闪过0%后立即失败且没有其他提示。

原控制器以 `performance.now()` 小数差值直接构造 `duration_ms`。实际原路径反例 `4000.4` 在真实后端预留输入守卫得到400／`YXX_MEDIA_INPUT_INVALID`，尚未读取数据库；整数对照可进入后续边界。这与立即失败现象一致，但未取得用户设备该次请求错误码，**不将一致性推断表述为已确认的实机直接原因**。后端整数、格式、大小、用途与当前权限终检全部保留。

企业微信本地试听使用 `playVoice(localId)`，尚未经过后端转码。已核 SDK2.4.4 与官方录音文档，未提供采样率、码率或降噪参数；不能声称更改服务端转码修复了该本地播放。普通AMR读取和另一高质量Speex接口是不同表示，不为此盲换接口。

## 实现范围

- 用户明确选择**继续默认企业微信录音、尽量排查当前杂音**。有企业微信能力时默认原生录音及可选转写；保留手动“清晰录音”，仅无原生能力时默认浏览器。清晰模式请求关闭回声消除、语音降噪和自动增益，以有界编码保留现场声音，并明确需要手动补充文字。浏览器／设备是否遵循约束以及实际听感仍需真机验证。
- 起录、已有录音或权限复核期间不能切换；麦克风只由明确操作申请，不在拒绝权限后自动启动另一录音器。照片原生路径、单上传队列、60秒与大小预算保持。
- 成功起录开始计时、松开时冻结；先按原始时长检查少于3秒，再归一为有限整数毫秒。短录音不上传、不转写，取消／隐藏／卸载仍静默释放。
- 转写以录音ID与手工编辑版本绑定；移除旧录音撤销其尚未编辑的自动文字，迟到回调不得回填；保留手写、手工修改与手工清空。
- 上传按阶段显示闭合的本地错误提示，不展示原始SDK／服务端消息或凭据，不自动重试未知POST。原生试听等待SDK后复核材料寿命，合并进行中的重复播放，删除后阻断迟到播放。
- 安装版SDK合成桥证明旧试听停止尚未收到回执时可开始下一段原生／浏览器录音。停止工作需跨页面控制器保留，下一段采集沿5秒有界／可取消等待；未试听不强行停止，自然播放结束精确匹配localId。该调用顺序缺陷与用户首次录音的声学根因分别记录，后者仍NOT_CONFIRMED。
- 报修顺序调整为照片／视频、已有材料、正文／位置、下部录音、提示与提交。浅深主题与中英文共用结构；移除音频文件入口及tips。非录入区域禁选，输入框／textarea／contenteditable保留选择和编辑菜单。

## 原路径反例与私有预检

此前控制器与草稿私有回归 **59/59 PASS**，H5与相关Node测试严格类型退出0；初始小数时长RED、删除后迟到播放RED和一次测试夹具类型失败均保留。真实安装SDK的合成桥确认上传／转写未完成时仍可本地试听，未发生服务端导入；这不构成音质证明。默认模式后续按用户选择调整，本结果不直接改绑最终候选。

此前私有Vite预检五页总必需JS闭包（含主题）gzip为118205／122678／118308／122347／116974 B，主题408 B，原上限122880／2048 B保持。该次是私有预检，不能代替正式根构建或发布制品身份。

手动CLEAR／纯浏览器路径另做真实编码单项：真实UI按压4547ms，经实际MediaRecorder以128kbps生成68882 B WebM/Opus，本地`audio`预览与XHR上传原件SHA一致，冻结后端`inspectMedia`接受；浏览器原生解码4.26秒、48kHz、单声道。合成440／997／2903Hz音源持续可观测，clipping为0；这只证明合成音源链路，不证明真实麦克风或企业微信音质。删除／路由卸载后Blob、预览、轨道、录音器、计时器、AudioContext和浏览器／服务器资源归零。

该单项首次夹具返回DOM节点导致CDP序列化失败，第二次墙钟3332ms而解码2.7秒的断言失败均保留。第三次记录音源自身时钟与真实信号后通过；第二次未采音源时钟，原因UNKNOWN，不能声称编码器丢音。此单项使用当时私有Vite原字节，不改绑后续正式候选，也不改变企业微信默认选择。

### 中间候选的独立审查

独立本地审查还在中间字节发现一个P2：仅将停止等待保存在页面controller内，离开再返回会绕过尚未收到ACK的旧试听停止。实际SDK两模式均RED，原件与原73项私有PASS分别保留；没有以其他通过覆盖此缺口。

随后将原生试听及真实停止任务移入已有SDK单例；页面卸载／成员clear不丢弃尚未settle的设备操作，两种录音模式沿5秒／可取消边界等待。连续四次导航仍仅发送一次停止，拒绝回执只由明确再次起录重试，自然播放结束不伪造停止ACK。最后私有回归 **81/81 PASS**、H5与测试strict退出0；具体源SHA及原始RED在`voice-followup-frontend-01/final-handoff-03/`保留。首次录音杂音声学根因仍NOT_CONFIRMED，上传／转写原并发保持。

包体预检02／03／04／05的报修页分别123052／123048／122943／122899 B gzip，均按原122880 B记FAIL。只清理无调用的旧入口文案并精简重复双语恢复提示，不删除安全分支、不增加懒加载规避闭包；预检06五页为118050／122822／118160／122197／116823 B，主题408 B，全部PASS。它仍是私有Vite预检，正式身份在下文单列；Windows外部度量包装器首次误用裸盘符ESM导入的准备失败也保留，未算产品测试。

### PR #112 首次CI失败

文档head `ee84955dd91f6fb81fe06d20f483b08712731a34` 的 [run 39621660471](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/39621660471) 失败：237个注册文件选中，127执行、110 NOT_RUN；272项测试中271 PASS、1 FAIL。失败位于T16实际附件下载取消测试的全库等待锁数量等于1断言。原始ZIP保留并核API digest、590条目CRC和完整SHA；PG18.6清理空。该head的Codex审查已完成且无发现，**审查通过不能覆盖CI失败**。

原路径自然观测PASS，没有伪称修复前自然RED；受控反例证明“目标附件确在等待，同时另有非附件等待者”时全库计数为2，旧断言错误。此次CI究竟观测到0还是2未捕获，保留 **NOT_CONFIRMED**。修复只使测试等待真实已启用按钮、精确目标HTTP、当前数据库中被自身locker阻塞的来源查询，并核响应尚未输出、关闭详情后确实断流；原5秒预算、PNG/JPEG内容哈希、权限与Blob回收断言保留。未更改生产下载或数据库逻辑。

该测试最终源在2CPU／4GiB Job、任务自有PG18中通过，严格类型退出0，库／客户端／PG监听／Job活动进程归零；完整4例与最终新增关闭前守卫的相关1例分开记账，不拼成5项通过。

## 正式验收状态

录音源码候选为 `62c21984ed1229d75e3a342e3a4d5adad0c4f76f`，tree为 `266e6463709d6bc8d7957bbad485efc2da378b9a`。正式根构建、活动selection strict和制品校验均退出0：878个typed implementation、351个legacy、2618个输出；manifest为 `390aa755c25b3b1b39dc49a1e15411f97a85d2b9bac05da0d887d823c1a61bd6`，source input为 `b95cd71dc6daf4fab649ab5d2d9310b0dc4098994d6bf261d900e099be536ced`。构建后所有验证完成再做制品检查仍通过，用户配置不进入制品。

| 当前源码62的本地验证 | 实际结果及边界 |
| --- | --- |
| 正式五页完整首屏JS闭包（raw／gzip／Brotli，B） | home 375642／118050／101862；report 390406／122822／105903；reports 375500／118160／101943；request 388563／122197／105586；department 372025／116823／100854；主题671／408／333。原122880／2048 B gzip上限保持，报修页余量58 B |
| 注册回归 | 17个实际入口、284/284 PASS，fail／cancel／skip／todo均0。含H5／OAuth、实际T16浏览器4例、媒体FFmpeg14例、PG媒体6例；任务自有PG18.4、Windows Job硬约束2CPU／4GiB，峰值commit 1495089152 B，非整库full或Gate |
| 工具及文档 | H5、性能、资源预算与agent-docs共45/45 PASS；docs:agents:check退出0 |
| 正式浏览器 | 44/44 PASS：原30项会话／温导航／shimmer等，加320／390 px×浅深色×中英8组合、录音流程、PUT 503和能力分支。实际WECOM默认，CLEAR仅手动或无SDK夹具；短录音、429／503本地提示、无自动POST重试、输入选择／非输入禁选均覆盖；根任务另查看8张布局截图，不声明像素差分验收 |
| 生产React Profiler | 独立production B0/P1构建，9控制＋18业务窗口共27/27 PASS、各场景3次。文字Description 9、Location 6次本叶提交；录音3个真实秒跳仅Recorder；上传item 6次＋SubmitActions 1次；补充／评价弹窗各7次。整页、Provider、时间线、结构媒体列表与非活动item无无关提交；父Profiler的子树回调另记，未冒充父组件提交。SDK关闭夹具使用CLEAR，不是实机原生音质证明 |
| 独立审查 | review03确认跨controller停止ACK的P2已关闭，无新增P1/P2；实际安装SDK原2模式反例2/2 GREEN，另7个具体注册生命周期用例通过，不拼作新整套计数 |

44项浏览器首次36 PASS／8 FAIL原件保留：夹具把视觉隐藏的1px说明算作溢出，并读到textarea已有选择；按确切CSS隐藏规则及先清空／blur再真实拖选修正测试驱动，未改页面、布局预算或选择策略。随后44项完整重跑通过。Profiler首次准备因旧FileFallback函数已删除而失败；核对AST后只移除该已不存在的探针，核心探针、27窗口和无关提交为0断言保持，未伪造删除组件的计数。

注册回归、44项浏览器及Profiler各自的PG、Job、浏览器／profile、服务器／socket／timer、媒体轨道／录音器／Blob与租约均按各自收据释放为0；PG正常停止退出0、status 3，数据库／客户端为空，Job未强制终止。Profiler另核1981个正式input无变化；405份捕获中404份正式源与1份DEV-only预览分开，不将插桩发布。

该head的[Codex审查](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/112#issuecomment-6321188507)已完成、findings=false且无未解决inline意见；[CI run 39634414243](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/39634414243)仍为**FAIL**：237个注册文件选中，151执行、86 NOT_RUN，361项中360 PASS、1 FAIL。失败为既有工作台T38第一例在再次授予权限后等待editor＋live的30秒超时，其余3例通过。原始ZIP的API digest、10457721 B完整SHA与717条目CRC均已核，PG18.6清理为空；原CI未归档失败DOM／截图，不能凭空确定页面状态或根因。本机原流程自然PASS，尚不能作为修复前RED或CI已关闭的证明，诊断另行记账。**本地通过与审查通过均不覆盖此CI失败，未据此合并或切换云服务。**

T38补充诊断中，原流程自然观测1 PASS；通过真实runtime端口主动断开原SSE再恢复的受控流程1 PASS，未构造RED，均不冒充已定位CI原因。两次沿原30秒、实际404拒绝、空草稿与0自动POST运行，2CPU／4GiB Job、PG正常退出及最终资源0。后继测试仅增加同步phase、最多128条不含Cookie／正文／身份的HTTP状态账及失败时的DOM白名单与现有runner可收录截图回执；成功路径无新增浏览器await，原4个waitFor参数逐字相同，后三例正文保持。最终私有strict退出0；其正式构建和当前CI另行执行，未直接将观测补丁称作产品修复。

### T38自然复现与生产修复

诊断head `456d96b32b913b1e8e9801281e1bfbde504d7ab9` 正式根构建、strict和制品校验通过，manifest为 `d1d03f3d0c2b169cb6d48454c76ef920df0836092344e3abd4d121c47b3a33a1`；与62逐项相比只有T38输入及其mjs／map改变，H5全部82个输出和其他非测试制品完全一致，原284／44／27度量仍绑定62。该head的Codex审查完成、无发现；云组件13/13仅为隔离预检，未切换服务。

随后在该正式制品和实际2CPU／4GiB Job中执行T38四例，得到**3 PASS／1 FAIL的自然RED**。重新授权后bootstrap200×8、item200×5、context200×8且实时连接live，详情／编辑器仍未恢复、POST为0；截图为原404提示，稍后DOM为pending。未采响应正文，不以200推断解码。原权限、30秒、空草稿与0自动POST断言未改。Job正常结束、未强制清理，PG18.4正常停止，数据库／客户端／监听和活动进程归零，失败截图首次由现有runner完整归档。

实际源码验证发现可解释该表象的闭环：整单当前READ拒绝先清空所有相应查询，其中包含未启用的`ticket-follow-up-schedule`。`SharedFollowUp`始终挂载，关闭功能的query不发请求，却在每次挂载时将缓存404当新拒绝，重新清空刚通过当前READ的详情；之后每5秒重读成功又重复。独立真实React／Query／IndexedDB、原组件与原刷新节奏的控制中，每次detail成功后0.5–1ms即再次变为404，live不变、POST为0，与自然RED表象一致。没有把缺少DOM的原CI直接绑定为该控制的因果证明。

修复仅要求该组件在功能启用且当前挂载后确有读取时才再次处理拒绝；缓存错误仍隐藏旧资料，新的401／403／404仍沿原权限清理。采用Query的`isFetchedAfterMount`，其语义同时核对锁定版本QueryObserver的更新计数与[官方useQuery文档](https://tanstack.com/query/latest/docs/framework/react/reference/functions/useQuery)。不删除READ终检、不恢复旧草稿、不增加自动POST、不改变Feature Flag默认值或30秒预算。修复后的正式注册回归、当前head CI／审查和发布状态见后续[交付收据](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/112#issuecomment-6321712907)，本截点不预记PASS。

此前另查A→B→A会话合并的外部停机控制，仅直接cache writer构成HYPOTHESIS；实际旧epoch网络读取已被丢弃的对照通过，且它的auth-blocked／无后续GET表象与本次live／多轮200自然RED不符，没有据此修改会话或放宽旧请求栅栏。

截至本地验证截点，新62制品仅完成云端隔离组件预检13/13 PASS，未加载运行配置／业务数据库、未联网、未切换服务；实际在线仍为前轮14dad391。后续当前head的CI故障闭环、合并与新录音制品云切换按实际身份追加至 [PR #112 验收与发布收据](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/112#issuecomment-6321712907)，本截点不预先记为通过。

Android／iOS新模式实际音质、实际Provider上传、录音相机与锁屏恢复完整实机复验继续 **NOT_RUN**；起录用户观察与本轮未验证的音质分别记录。不推进P2/P3 Gate，不主动发送消息，不重置已有工单、密钥或媒体。

外部原件根：`D:\wecom-workbench-evidence\h5-session-navigation-20261021-ccd73223`，本轮目录包括 `voice-followup-frontend-01/`、`voice-followup-layout-02/`、`voice-followup-backend-01/`、`voice-quality-browser-01/`、`wbint-t16-lock-diagnosis-01/`、`formal-build-voice-04/`、`registered-voice-05-host-01/`、`tooling-voice-01/`、`browser-qa/formal-62c21984-voice-44-02/`、`profiler-voice-feedback-01/`、`voice-followup-review-03/` 与 `cloud-release-voice-01/`。失败与中间态原件保留；用户配置及设计原件不改写。
