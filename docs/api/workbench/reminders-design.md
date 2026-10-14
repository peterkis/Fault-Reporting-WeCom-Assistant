# T40 站内提醒与个人偏好：闭合 SOURCE 合同

状态：SOURCE_PREPARED / RUNTIME_NOT_RUN。基于 integration b5808ee88ee749df61a6a82708d1d5bd26971743。本票 handler、控制器、React 设置/提示、音频和桌面适配未实现/挂载；default-false 仅为 unused composition 声明。原 API、Ticket/Incident、Delivery 和 SQL 不变。不能由源码缺失推导已观测 RED，不能由准备完成关闭 Issue。

依据 [WBINT-13/15](../../../plans/admin-workbench-integration/implementation-plan.md)、[A13/15](../../../plans/admin-workbench-integration/acceptance-matrix.md)和 [ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md)。T34 的 current READ 下实际处理责任/活动沟通责任/本人明确关注并集是 related 权威；T35 实际阅读、T37 共享安排及原到期信号独立。提醒不授读取或处置权，不推进个人已读、Follow、补充处置、责任、状态或送达。

## 原事实、资格与规范去重

AUTHORIZED_TEAM_NEW_REPORT 来自现有当前获权团队待办中的初次 Service Intake/报修。初次材料经 Manual Review 转 Ticket 不能再次算新报修；沿真实关系规范化，不按姓名、标题或时间接近合并。团队范围沿服务端原权限裁剪，本票不新授广域读取。

RELATED_NEW_MATERIAL 来自真实保留的 Channel Message/Web Submission/代录材料及当前修订；RELATED_REOPEN 来自原 Ticket 重开事件/新轮次；RELATED_FOLLOW_UP_DUE 来自原 T37 的 Ticket+schedule_version 一次到期信号。后三类要求 current canonical READ ∩ (HANDLING ∪ 有效非ENDED COMMUNICATION ∪ 本人FOLLOW)。看过、其他人的Follow或仅READ不制造个人关系。

唯一原 SSE 只触发查询失效；泛化 ticket.updated、read_cursor.changed、内部备注、Delivery 变化、刷新/重连不是声音资格。服务端重读原 retained 事实、当前范围与规范对象。reminder_id 是 reason+稳定 source_key+source_revision 的 SHA256；event_id 保留真实授权 realtime 引用。同事实的多个会话/重复投影/Review→Ticket 不重复提醒。source_key 不透明，不含 raw user/group/provider target、正文、患者信息或凭据。

## 拟议 HTTP 与闭合 Schema

仅新增读投影 GET /api/workbench/reminders。无 HTTP 写入口、设置保存接口、第二事件入口、业务表或数据库变更。本窗口不挂载 GET。六个 own Schema 与 DTS 见 contracts/workbench_reminder_*；旧 Schema 不扩写。

| 输入/输出 | 约束 |
| --- | --- |
| 规范Query | after_event_id:string/null、baseline_token:string/null、cursor:string/null、limit默认/最大50；未知/重复参数400，BIGINT≤9223372036854775807，不转JS Number |
| 初始读 | 三个窗口参数全null时，items=[]，返回当前 as_of_event_id、有效 baseline_token、next_cursor=null、reset_required=false |
| live读 | token绑定初始scope、原事实截点、事件floor、10分钟期限；不能通过任意after_event_id提取历史当新提醒 |
| 页 | schema_version=1、items≤50、as_of_event_id:string、baseline_token:string、next_cursor:string/null、reset_required:boolean |
| item | reminder_id/event_id/reason/canonical_item/source_key/source_revision/occurred_at；四个闭合reason，重开/到期只能Ticket；时间沿无offset Asia/Shanghai秒精度 |
| token/cursor | ≤512字符，process-private HMAC 验证并绑定 current principal 有效权限revision、原查询和as-of；是投影栅栏，不是认证/READ/写授权 |
| bootstrap增量 | 未来按 capability Schema返回 workbench_reminders_enabled 与同源 reminders_endpoint/null；目前未返回 |

当前验权先于匹配、计数、规范去重、LIMIT和返回；token不能旁路。页固定同一as-of及 (event_id,reminder_id) 稳定升序，cursor不能改变查询。原事实早于baseline截点时，晚投影不能成为新提醒；缺精确新旧依据则fail closed，不播放猜测，不泄漏未授权总数。

原401关闭账号会话；目的明确403/404清该对象。失效scope/token、gap或retention在当前验权后返回新空基线/reset；临时503保留断线视觉、不排队补响。process重启使原token失效，只重新baseline，不恢复历史播放队列。actor绑定、权限时间及来源轴不能由偏好或SSE payload决定。

## 视觉、个人设置和声音

提示使用安全类别和可定位的规范事项引用。事件不导航、开详情、抢焦点或滚动；用户显式定位前再核对象READ，回到原看板/列表目标，失权移除。不覆盖草稿、输入或正在拖动的对象。GET/提示/定位不能POST read-position/Follow/处置。

个人设置仅本浏览器 wbint-reminder-preferences-v1 一条≤128 UTF8字节的闭合记录：schema_version=1、sound_enabled:boolean、desktop_enabled:boolean，初始均false。坏JSON/字段/超界重置。无 principal/session/权限身份、token/CSRF、事件/对象ID、正文/草稿，不承诺跨设备或服务端保存。

保存的是意愿；每个新文档/新身份仍disarmed，需要真实用户手势开启/试听或主动申请桌面权限。注销、账号/当前范围变化、关闭capability清本票owned key/候选/claims并disarm，不动其他存储。播放拒绝、静音或平台不可用只影响声音/桌面，视觉继续。试听是本地短音，不伪造报修事实，沿现有减少动态设置。

自动声音只处理 fresh baseline 后 LIVE 新事实，经当前资格重新核验、当前文档可见、主动启用且拥有领导者锁时 eligible。750ms 时间簇最多一段120ms短音，相邻自动音≥2s，不排队补响。reconnect/gap、reload、后台恢复、scope变化和领导者交接先新baseline；RECOVERY读恢复当前事实，不能播放历史声音/桌面通知。

## 跨标签与桌面

同源一个 exclusive Web Lock 领导者独占自动声音/桌面资格；锁名仅 transient authority hash，不用TTL竞选冒充原子互斥。BroadcastChannel仅传闭合RESET/SEEN：authority_scope+reminder_id摘要，无正文/raw身份/凭据/详情，不持久化。内存去重≤256条/10分钟，foreign/stale scope、坏消息或超界忽略；新领导者先baseline，不接旧队列。可靠协调不可用时视觉/主动试听继续，自动声音/桌面关闭。去重溢出/不确定资格不能驱逐旧key后复活重放声音。

已有桌面权限也不自动开启，必须当前用户主动选择。内容仅通用类别，无报修正文、患者/人员/位置/内部信息；tag为opaque reminder摘要。每簇至多一个通知，点击定位前仍验READ；失权/关闭清owned通知。浏览器API调用/headless PASS不证明实体扬声器或Windows通知中心现场送达。

平台依据：[Web Locks](https://w3c.github.io/web-locks/)、[Notifications](https://notifications.spec.whatwg.org/)、[Web Audio](https://www.w3.org/TR/webaudio/)。本段资格、预算、拒绝与恢复行为是本票设计决定，不把平台规范当作运行证据。

## 有界资源与回退

沿单App/Worker、Gateway单活、SSE32、总池≤8，复用 T38 一个 EventSource/当前授权refresh/timer，不开第二SSE/轮询器、Worker、Broker、连接池或每事项timer。一次refresh最多4页/200候选；未完整不能称全量通知。视觉≤40条/10分钟，通过当前授权重读清失权对象。分页未完成或缓存超预算显示有界刷新提示、先baseline而不补历史声；原due持续待办不因toast过期处置。

浏览器owned上限为一个 AudioContext、一个 BroadcastChannel、一个 Web Lock请求/领导者、一个短簇timer；GET沿现有AbortSignal/授权epoch/generation/late fence。新旧scope交错、长GET、旧timer/leader不得改变新账号。offline/hidden、unmount、scope变化或总flag关闭取消owned读/簇、释放锁、关闭channel/context/owned桌面通知，未来必须实际验证清零。

workbenchRemindersEnabled=false 总关闭回原视图/事实；静音单独停止声音，视觉继续。无须删SQL、业务事实、旧Evidence或其他偏好。当前只有unused声明，关闭路径尚未实现或运行。

## 原首例及下一真实窗口

tests/wbint-t40-reminder-first.browser.test.mts + own helper复用T37原隔离wrapper/migration/Core/assign/SET/due Port。停止旧App后同池同端口仅启一App，Gateway/Sender/external false，后台worker不start；新GET/UI不mock。

先真实 Ticket→原Cookie/CSRF/UUID/If-Match assign→当前handler GET→原SET到期/GET→正式bundle/真实授权SSE，再首次断言实际“提醒偏好”按钮。随后初始静音/桌面false、真实基线、原due Port、新GET与实际DOM核对同event/source_revision/reminderID；不自动打开，0音频/桌面/POST，定位不打开，Ticket/责任/read/Follow不变。平台observer转发原方法，不制造播放成功。截图沿WEB01_BROWSER/web01-ui-UUID归档，finally清own browser/App/SSE/randomDB。

本窗口 types/build/artifact/tests/PG/HTTP/browser/audio/desktop 全NOT_RUN。下一整票先普通merge最新integration，保全first/旧SQL/合同/registry并集；独占heavy后严格types、一次build、制品证明，再原首例真实RED→最小实现→同首例。setup/编译/宿主未到达不算产品RED。随后按实际风险补时钟/合同Unit、权限/身份/延迟投影/重复源/新旧材料/重开/到期真实HTTP、多tab与主动启用/拒播/desktop拒绝、recovery/hidden/late/account及清零证据，不预写一揽子假成功。

WBINT-13/A13和WBINT-15/A15只记本票SOURCE贡献，整组未因此完成；Root/GH/coordinator和部署/发送/full/certify/Gate由父按原授权边界管理。
