---
document_id: WBINT-ACCEPTANCE
status: PLAN_CONFIRMED
business_validation_status: LOCAL_VERIFIED
snapshot_on: 2026-10-16
---

# 人工工作台验收矩阵

2026-10-16 全部43票本地交付收口：**43／43 CLOSED/completed、0 OPEN**，[298条原验收要求](<D:/wecom-workbench-evidence/notes/resume-20261012-after-pause/all43-native-298criteria-parent-acceptance-map-20261016.json>)已对应原关票验收与逐票记录。[完整集成分支审查与修补](execution/all43-final-review.md)已完成；[Standards与Spec独立结论](<D:/wecom-workbench-evidence/notes/resume-20261012-after-pause/all43-finalfixes-closure-20261016/final-two-axis.md>)剩余问题均为0。最终修补由非作者精确快进至`5e5f023cd557adf42b725f40f5a1fca507b0418f`。实际风险验证在40a0／MF7e9d的19项与4235／MF9356的后继2项、相关42项、综合6项分段通过；严格类型、一次候选构建及制品检查通过，纯文档后继不重绑被测对象，不称一次full通过。

[30个自有工作树清理](<D:/wecom-workbench-evidence/notes/resume-20261012-after-pause/all43-final-worktree-cleanup-20261016/report.md>)已完成：13个托管归档、17个原生移除；原提交、分支、历史证据与6份用户原件保留，自有PG和浏览器已停止。A00文档基线完成，A01–A16本地隔离验证完成；默认开关仍为false，真实外部、现场、部署、full／certify及Gate未运行。全部旧失败与未运行项保留；一份早期Standards审查工作文件的旧原始字节缺失已如实记录，未重建或冒充原件。以下旧日期段及带PENDING_PARENT的贡献记录保留原时点，不代表当前状态。

返回 [计划入口](README.md) · [能力映射](capability-map.md) · [实施任务](implementation-plan.md)

以下保留已确认的验收要求；各票当前结果与真实被测对象见[执行导航](execution.md)。未运行部分保持 `NOT_RUN`，不能因原型、历史报告或类型通过填 PASS。

2026-10-11当前本地增量：A06的[T20 Web本人反馈](execution/t20.md)和[T21 Bot本人反馈](execution/t21.md)原七项已完成独立核对并集成，A06为LOCAL_VERIFIED；T21的最终边界12／12、共享11／11与各适用分组分别保留原对象。该增量不代表全部43票完成、发布、现场验收或Gate批准；其他组按各票执行记录保留完成与剩余范围。

## 验证环境和证据层次

| 层次 | 应证明什么 | 不能推导什么 |
| --- | --- | --- |
| Contract／Unit | 输入守卫、角色／状态／来源规则、版本和纯策略 | HTTP已挂载、事务有效、真实送达 |
| 隔离 PG＋public HTTP | 当前宿主认证、对象授权、事务／并发／幂等、追加事件、投影／Outbox事实 | 真实OAuth、WeCom强@、生产开关、正式Gate |
| 生产bundle浏览器 | 同源真实HTTP＋隔离库上的表单／导航／草稿／冲突／实时／键盘／多标签 | 原型成功、模型可用、外部人员实际看见通知 |
| 当次普通PR检查 | 活动selection的类型、一次最终构建、相关业务／工具检查、制品与自有资源清理 | 手动full或独立certify已经通过 |
| 独立现场／认证 | 仅当次授权范围、实际对象和本次运行得到的结果 | 自动扩展到生产／临床或下一Gate |

外部Provider／目录／WeCom发送使用Stub或Simulator；业务宿主、Ticket／Intake／Incident事务与数据库不能由前端Mock替代。合成主体至少区分两名同组同事、一名另一组同事、调度／ADMIN、原Reporter和另一Reporter，以及不同应用／Bot来源；名字及标识均使用新合成资料。

## 任务验收

| 组／任务 | 触发场景 | 必须观察到的结果 | 主要验证边界 |
| --- | --- | --- | --- |
| A00／00 | 当前HTTP／合同／ADR对照；来源群本地增量尚未发布；历史API示例混用 | 当前与目标分列；每个动作有唯一宿主、资源标识、角色／目标／状态／版本合同；待实现PATH不写成现有。037及用户修改保留 | 文档＋源码／Schema／测试映射 |
| A01／01 | 请求已提交但响应丢失；刷新／误关标签；24h过期；退出或换账号／失权 | 原UUID＋原payload核对；不重复新意图；只恢复当前获权事项草稿；过期／退出／失权清理；冲突保留内容且不自动改版本发送 | Contract＋HTTP＋bundle浏览器 |
| A02／02 | 两人同时一步处理；跨团队接管；目标人离组；任一Session写失败；撤派／等待中停止退回 | 只有合法版本成功；Ticket人／组和选择的沟通责任同事务；非法组／关联被拒；保留原沟通可选；退回保留轮次和历史、不取消／关闭 | Unit状态矩阵＋PG并发＋HTTP |
| A03／03 | 当前人完工；同事接管并完工；两人并发关闭；内部过程含敏感合成标记；重放原命令 | 单一工作人员完工事实和轮次结束；不是Reporter确认；内外分离，标记不进入外发／Reporter；事件／责任／承诺原子；安全交接链完整 | PG事务＋HTTP＋bundle表单 |
| A04／04 | 不明确诉求／咨询／故障复核；已有关联Ticket；材料追加后旧复核；另一人越权或过期附件 | 保留诉求且不强制建故障；明确故障一次确认并开始，不重复Ticket／卡片；陈旧材料拒绝；附件只有真实获权内容，缺能力明确不可用 | Intake／Review Port＋PG／HTTP＋浏览器 |
| A05／05 | 电话／现场代录；同名候选、来源ID混用；目录离线；手填未核实；选择“由我处理” | Reporter与操作者分离；离线仍持久受理；未核实零外发并需人工联系；只用经核验绑定，提交／本人处理原子幂等 | Stub＋PG／W HTTP＋bundle |
| A06／06 | 原Reporter／他人；Web与Bot ref互换；旧entryRef／Grant；不同UUID多标签同时反馈同一轮；普通补充 | 他人／错绑定／错误定位拒绝；同Ticket仅一次新轮次，清旧当前责任并提醒上轮人；待重新承接；补充不重开；readonly／零写profile继续拒绝 | M两类HTTP＋PG并发＋成员UI |
| A07／07 | 同群两个参与者／主题；处理人与沟通人不同；回复202后失败或UNKNOWN；输入时新消息 | 无串主题／越权；责任分离；受理发送不显示成功；内部备注不外发；草稿保留，正文最新提示可见；无会话不造聊天 | Conversation／Communication＋PG／HTTP＋浏览器 |
| A08／08 | 群转单聊或H5补充；群成功私聊失败／反向；Worker中断后恢复；转派／退回／再次承接；重开下一轮 | 原始来源不变；两路独立结果与恢复，不重发成功路；同轮首次责任通知一次，下一轮可新通知；内部内容／原始标识不外发；不可达不改任意目的地 | 事件／检查点／Outbox＋Sender Stub＋PG |
| A09／09 | 候选人工确认；范围／关联父子版本冲突；普通处理人尝试ADMIN操作；公共故障恢复 | 现有权限／广域限制生效；只关联获权真实Report；未选／不可见数量不泄漏；Incident恢复不关闭个人Ticket；分页不是总数 | Incident PG／HTTP＋bundle |
| A10／10 | 负责人交接；先写内部过程再显式发布；暂停订阅；并发发布；相同UUID重放 | 只按Incident权限操作；内部默认不发；显式安全进展一次事实／每路意图，暂停者不发；目标有效；个人Ticket状态独立 | Incident／Communication PG＋HTTP＋表单 |
| A11／11 | 不同域异常队列；另一Ticket或Incident delivery ID；UNKNOWN点重试；已发核对／确定未发重新排队 | 先授权，wrong parent拒绝；UNKNOWN不能盲发；核对权独立、留原因与结论；安全摘要按路裁剪；不把查看权当控制权 | 各域Delivery control＋PG／HTTP |
| A12／12 | 预加载／实际看到；同事看过；旧补充处置时又来新补充；回复入队／失败／确认发送；关注转交；到期关闭／重开 | 只有本人实际看到推进个人位置；个人已读不清团队跟进；旧动作不清新材料；202／失败／UNKNOWN不清；与我有关按责任／关注授权并集；共享安排继承、结束留历史 | PG／HTTP＋多主体／多标签浏览器 |
| A13／13 | 重复／乱序SSE、gap、断线／重连；后台标签与presence TTL；静音／主动开启／autoplay拒绝；编辑或拖动时新事件 | 查询失效重读真实事实；断线正确显示；活动过期、不锁单；去重短音、重连不补响；视觉提示保留；不抢焦点、不覆盖输入或移动操作目标 | 真实SSE＋时钟可控Unit＋bundle多标签 |
| A14／14 | 第2页之外的对象搜索；组合筛选／游标混用；获权对象被转走；同名来源群 | 能查全部获权范围，不是当前页过滤；未获权对象／计数不泄漏；稳定去重与游标；ID不按同名合并；URL与board/list一致 | PG查询＋HTTP＋bundle |
| A15／15 | 合法／非法拖动、填完工表单取消、两人竞争、键盘和Esc、长文窄屏、菜单滚动、设置权限 | 仅调用合法动作；成功才改变列；冲突／未知保持输入并核对；按钮等价；操作目标不跳；声音／桌面主动开启；普通人不能改群名／系统权限 | 生产bundle真HTTP＋可访问性／性能观察 |
| A16／16 | 四条来源贯穿完整人工链，同时加入公共故障、投影延迟／断网／局部送达失败，多人多标签 | 单Ticket、原始来源与轮次正确，受理不因AI／目录失败丢失，内外隔离、双责任、本人重开、通知恢复全链有证据；所有owned资源关闭 | 同候选隔离全链＋交接核对 |

## 业务与资源横切检查

所有新增写入口验证当前权限，而非只信登录时roles；csrf／Origin／幂等／If-Match严格匹配。replay也重新验权，版本冲突不自动重新授权业务意图。GUID／opaque引用不可替代授权，跨应用user_id／WeCom userid／open_userid／Provider UID不按同名或字符串格式转换。

所有外显结果必须搜索／断言内部合成标记没有出现在Reporter timeline、群摘要、Bot／应用消息或异常队列的未授权投影。日志／Evidence不保留凭据、原始群ID、真实姓名／联系方式或真实材料；已受理、已建单、已发送、已读分别核对实际事实。

分页、并发、消息／草稿／附件大小、presence TTL／对象数量、SSE32和池预算必须有明确限值。超出限值给可解释失败，不丢已持久受理。没有实际负载证据就不声称2C4G容量通过；按已确认常见1920×1080及窄窗口检验操作，未完工总量仍需通过真实观测确定。

## 每次交付证据模板

实际证据需包含以下字段，可在Markdown表格或JSON中记录；占位符只能出现在模板里，不能提交为PASS报告。

```yaml
task_id: WBINT-xx
status: IN_PROGRESS
source_head: <实际完整SHA>
candidate_or_worktree_basis: <实际被测对象与未提交差异说明>
contracts: []
http_hosts_and_profiles: []
database_migrations: []
feature_flags_and_defaults: []
checks:
  strict_types: NOT_RUN
  build_and_artifact: NOT_RUN
  relevant_tests: NOT_RUN
  browser_production_bundle: NOT_RUN
  owned_resource_cleanup: NOT_RUN
not_run_live_items: []
artifacts: []
rollback_or_disable: <真实关闭步骤>
backlog_state: IN_PROGRESS
```

真实源码／编译树／固定历史对象分别验证。新证据按当前任务保存；旧Evidence、tested_head、历史fingerprint和认证结论不重绑。若需要手动full／current certify／historical certify，遵循[既有v3流程](../typescript-migration/README.md)，记录其真实运行URL；它们不因A16通过自动触发。

## 现场验证仍待独立执行

真实OAuth／成员枚举、群消息推送真正强@指定Reporter、Bot私聊与应用通知实际送达、真实源群改名／权限／人员离组，以及部署后运行行为，均不能从本地合成结果推导。计划不创建本次现场授权。既有场景若有定向批准，先核对对象、范围与停止线，不沿用为新全链批准。

阶段状态继续按架构基线／当前计划核验：最后完成Gate为P2-G1，P2-G2-LIVE／P2-008及后续阶段停止线保留。最终交接必须并列列出本地通过项、未运行项和仍需外部环境证明的能力。

## A12 本地贡献：T36（PENDING_PARENT）

T36原七逐字及对应本地风险/HTTP/正式制品证据列于[执行记录](execution/t36.md)。明确处置或非空全部必要原Delivery可核验成功只解除原exact修订；新修订继续pending，获权同事不附owner前提。当前GET、UUID/当前授权/留存、independent encrypted purpose、defaultfalse/062及cold旧宿主兼容均有分对象证据，原FAIL和工具窗口预算FALSE仍保留。最终自有清理与独立Source/Doc/保护引用由Dhandoff绑定；A12整组和原七父验收仍待定，原验收行和其它票不改。
