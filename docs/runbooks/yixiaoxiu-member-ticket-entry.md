# 医小修成员工单入口定向现场手册

Status: NOT_AUTHORIZED / NOT_RUN. 本文是后续独立授权的执行模板。当前只能使用本地合成自动化结果；没有本次真实身份对应证明、客户端验收或负责人现场批准。

2026-09-15 增补：A/B 已完成独立身份核验，结论是官方转换后对应，不是原始 ID 同命名空间；工单现场尚未运行。ADR-0019 的最小修补已获授权。当前候选报告以 `plans/current_phase.json` 的 `p2_g2_current_readiness` 指针为准（不存在时使用原固定路径）；原 PR #8 报告是冻结历史，不覆盖。

### 代开发应用的只读启动转换

当 Bot 返回企业明文 userid、OAuth 返回服务商级密文时，使用 `VERIFIED_DELEGATED_MAPPING`，受保护配置添加 `reporterUserIds`（1–32 个经批准的 Bot 原始 userid）。仍要求企业/Agent/Bot范围、memberIdsConfirmed=true、proofKind=LIVE、proofRef 与 DEPLOYMENT。不得以 VERIFIED_SAME_NAMESPACE 代替。

独立 MEMBER_TICKET_READONLY 启动器在建立数据库池和监听前，使用同一应用 token provider 调用官方 `batch/userid_to_openuserid` 一次。5秒截止、64KiB响应上限；全部转换成功且一对一才创建内存反向映射。`--check`只检查配置，不调用该接口。读取时仍比较原始 Intake userid 和原始 binding hash，不改数据库身份，不在事务中访问 Provider。映射不赋予额外工单权限，不包含的成员拒绝。

映射随当前 App 生命周期使用；配置或名单变化须停止并重新启动、重新转换，不热改旧映射。关闭/回退仍按本手册原方式执行。FULL_SERVICE_LOOP 的映射集成不在本次修补范围，仍拒绝这种配置。下面的“确认一致”仅适用于原同命名空间模式；跨命名空间采用本增补，不能伪造原始ID相等证明。

## 选择候选与最少许可

现场申请必须给出当前确切commit、tree、candidate fingerprint及两个就绪报告。先执行离线命令并逐条核对退出码：

```powershell
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
node scripts/p2-g2-yixiaoxiu-check.mjs --require-ready
node scripts/validate-p2-g2-service-loop.mjs --require-ready
```

这些命令不连接数据库或Provider、不启动监听；只有完整当前候选通过才继续申请。`p2-g2-check --mode=check`只是配置/指纹检查，不能替代它们。

待负责人单独填写的范围：

| 项目 | 当前值 |
|---|---|
| 当前commit/tree/fingerprint | 待选定并复核 |
| 企业/应用/Agent/Bot范围证明摘要 | 待提供 |
| 测试上报人A/B与各自既有测试工单 | 待指定，仅记录别名/摘要 |
| OAuth userid与Bot上报身份对应证明 | UNVERIFIED |
| 只读测试工单范围与保留期 | 待批准 |
| 发送新测试卡片的额外权限/数量/目标 | 未授权；只读许可不包含发送 |
| 云端发布、proxy窗口、目标及回滚版本 | 未授权 |
| 开始/结束时间、责任人、停止条件 | 待批准 |
| 本入口定向现场结果 | NOT_RUN |
| P2-G2-LIVE/正式60分钟观察/负责人Gate批准 | 未授权、NOT_RUN |

凭据经现有受保护配置渠道交付，不在聊天、Evidence、命令行参数、截图或日志粘贴secret、Cookie、code、state、Grant和原始userid。

## 先证明身份口径

1. 使用批准的可信来源，分别确认A/B的应用OAuth身份与Bot source Intake上报身份处在同一命名空间；核验企业、应用、Agent与Bot归属。只记录对应/不对应、证据引用和摘要。
2. [97104](https://developer.work.weixin.qq.com/document/path/97104)存在明文/服务商密文与大小写差异；[97106](https://developer.work.weixin.qq.com/document/path/97106)存在不同转换场景。不能凭姓名、部门、手机或既有OAuth成功页面认定一致。当前代码不会自动调用转换或迁移接口。
3. 确认一致才允许配置VERIFIED_SAME_NAMESPACE、memberIdsConfirmed=true、非空proofRef与proofKind=LIVE。真实部署使用validationProfile=DEPLOYMENT；SYNTHETIC证明不得进入部署。
4. 对应关系不明或不一致时停止启用，保持IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING；另行裁定窄映射Adapter。本轮没有实施医院MPI、通讯录全量同步或历史身份迁移。

## 选择唯一App profile

| Profile | 数据与权限 |
|---|---|
| OAUTH_ONLY | 原认证入口，零DB、无Ticket API |
| MEMBER_TICKET_READONLY | OAuth和单Ticket安全查询/访问审计；无Workbench、业务Action、Gateway、Worker、AI或发送 |
| FULL_SERVICE_LOOP | 既有G2 App组合；必须完整G2独立现场许可，不能用本入口许可启动 |

优先验证MEMBER_TICKET_READONLY。切换为替换唯一App，不能叠加两个独立内存Cookie服务。OAuth-only旧进程Cookie不会移植到新App，必须重新登录。旧OAuth-only服务和原停止态G2发布包均为回退基线，不覆盖它们或假定历史批准沿用。

独立启动器为 `scripts/p2-g2-yixiaoxiu-serve.mjs`，参数仅`--check`或`--serve`。`--check`只验证配置；`--serve`是真实运行操作，本轮未执行。运行配置需要：

- YIXIAOXIU_RUNTIME_PROFILE=MEMBER_TICKET_READONLY；固定WECOM_WEB_OAUTH_ORIGIN与loopback端口；
- WECOM_WEB_OAUTH_ENABLED和YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED均显式字符串true；仓库example仍false；
- CORP_ID、APP_ID、APP_SECRET为批准应用凭据；APP_SECRET不是Bot secret；
- YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG指向受保护配置文件，结构参考config_examples/yixiaoxiu-member-ticket-entry.example.json；
- PILOT_DATABASE_URL为批准的仅测试数据目标，P2_G2_REPORTER_HMAC_SECRET为既有Reporter签名密钥。

连接池max4，启动器只关闭自己创建的pool；库函数不关闭外部共享pool。关闭App会撤销内存认证与intent。应用只读profile的唯一本地持久增量是访问审计，不能连接真实业务库试探权限。

FULL_SERVICE_LOOP仍走现有G2进程入口。未来manifest必须带scope.reporter_access_policy=MEMBER_REQUIRED和按validateYxxEntryConfig规范化后的配置SHA256；Controller/App使用YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG_JSON传递该受保护数据配置。manifest scope hash与负责人许可也覆盖该摘要。App凭据不传Worker/Gateway，Gateway只接收链接模式。缺任何条件均失败关闭。

## HTTPS与精确路由

只有批准云端窗口后才调整proxy；本轮没有SSH、nginx reload、Docker重建或发布。固定Host与publicOrigin，忽略任意X-Forwarded-*。配置可信域名与OAuth callback；callback只接受GET code/state，不是企业微信事件POST端点。

允许的路由和方法：

```text
GET  /wecom/yixiaoxiu/
GET  /wecom/yixiaoxiu/login
GET  /wecom/yixiaoxiu/callback
POST /wecom/yixiaoxiu/logout
GET  /wecom/yixiaoxiu/tickets/{32字符public_ref}
GET  /wecom/yixiaoxiu/continue/{64字符entry_ref}
GET  /reporter/
GET  /reporter/open
GET  /reporter/reporter.js
GET  /reporter/reporter.css
GET  /api/reporter/member/session
POST /api/reporter/member-entry/prepare
GET  /api/reporter/bootstrap
POST /api/reporter/logout
GET  /api/reporter/tickets/{32字符public_ref}
GET  /api/reporter/tickets/{32字符public_ref}/timeline
```

旧exchange在MEMBER_REQUIRED始终403，可在proxy拒绝或送至App以返回稳定拒绝。不要公开/workbench、内部工单/Incident写接口、health/metrics或管理路由。精确路径校验由两层共同执行；不是放行整个/api。

callback query、prepare body和Cookie头关闭敏感访问日志；不记录完整URL或Provider原始错误。浏览器/代理响应应为no-store/no-referrer、Secure HttpOnly __Host Cookie、SameSite=Lax及self静态资源CSP。POST严格同源，禁止通配CORS。真实HTTPS可达性和手机证书信任须现场验证，不能用本地SPKI测试替代。

## 定向验证顺序

1. A点击自己的新canonical卡片，认证后看完整工单号、安全标题、状态、Shanghai时间、公开Timeline与本人可见Incident里程碑。
2. A重复点击、刷新、过期后重新认证，以及手机/电脑各自登录；每次API重新判定归属，不新增Ticket、Delivery、Grant或持久Reporter Session。
3. A把卡片转给B。B认证成功但A工单404；B自己的工单可读。不可把B认证成功页面算作A工单查询成功。
4. 同一浏览器两张卡片同时打开；每个标签页回原ref。退出、换账号、返回旧页及晚到响应都不能回显旧账号内容。
5. 旧`/reporter/open#grant=...`入口清除fragment后经过prepare/OAuth/ownership，仅定位到canonical页。正确成员可用ISSUED/CONSUMED/过期但签名有效的旧链接；REVOKED、轮换密钥失效或伪造签名拒绝，Grant不复活、不消费。
6. 只有旧Reporter Cookie、Grant或public_ref均不能读取；A OAuth混入B旧Cookie也不能读B。逐条测试exchange、bootstrap、logout、详情、Timeline及304。
7. 工单状态由已批准工作台/夹具正常Action改变后，页面刷新一致；禁止为门户验证直接SQL改真实业务状态。Incident unlink只移除本人失去资格的里程碑。
8. Provider/数据库/页面网络故障后恢复；Timeline503后必须补齐，不提前接受新ETag。认证失败不影响规则受理、人工工作台和通知主路径。
9. 核对访问审计和业务表差异。网页登录不会建立Direct Leg或私人发送资格；如另获发送许可，限定目标与数量，UNKNOWN按既有Reconciliation处理，不能盲重试。
10. 记录同候选截图、成功/拒绝计数、资源、恢复和清理情况。原始身份、请求凭据与SQL/SDK原文不进入公共记录。

本地基线只做短时100会话/32并发验证；它不是自然GC下整栈2C4G正式60分钟观察。现场发现错误归属、内部字段、Cookie旁路、意外发送、未知身份对应或资源无法释放时立即停止唯一App并记录失败，不改写业务或历史证据。

## 结束与回退

关闭本次App及其拥有的请求、池和认证状态；保留已有业务/审计事实。需要回退到OAuth-only时，在已批准窗口核对原版本摘要并切回，重新认证；MEMBER_REQUIRED配置失效不能变成公开LEGACY_BOUND_GRANT入口。不执行down migration或清理旧工单、Grant、archive、用户.gitignore、全局Temp。

负责人另行确认的是本入口的定向联调结果。即使本入口通过，P2-G2-LIVE、P2-008、Phase2 Go、生产或临床上线仍需各自授权。
# 定向建单补充（2026-09-15）

负责人已在会话授权受控建单模式，供 A/B 后续成员只读测试准备工单。入口仍使用本手册既有实现。新增运行模式为 `YXX_TARGETED_TICKET_CREATION`，启动器 `scripts/p2-g2-yxx-targeted-create.mjs --check|--serve`，契约见 ADR 0020。

范围：A1=A 群聊、A2=A 私聊、B1=B 群聊、B2=B 私聊；每案例精确文本、原始 Bot 成员 ID、Bot ID 和唯一群 ID 绑定。群消息须 @Bot。每案例最多一单，最多 16 条持久入站，最多 4 条在途，最长 30 分钟；完成四案例、失败、超限或到期自动停止。配置只保存于受限私有目录，不将成员 ID 写入证据。

此运行不启动发送器、AI、Incident、完整 G2 Worker；无回复和卡片发送。工单及创建事件通过既有事务端口写入，并生成只读 public_ref，不生成 Grant。测试者发送完成后，由操作者核对返回案例编号、工单号及 public_ref，再按本手册继续本人读取与他人拒绝测试。

启动前核对候选 fingerprint、独立审查和回归，验证测试库名称/OID/属主、原归属标记及无其他 Gateway；部署使用独立不可覆盖目录、只读挂载、专用配置、256 MiB/0.5 CPU、无自动重启和额外的系统停止计时器。关闭仅停止本次容器，保留测试工单供后续读取；不修改原 OAuth/nginx 配置，不推进 P2-G2-LIVE/P2-008。

## 2026-09-15 定向现场收尾

上述原始授权表和停止态描述保留其历史语境。负责人随后授权定向现场、身份修补、受控建单和成员只读测试；结果见 `evidence/p2-g2-yxx-targeted-live-summary.json`，不扩展为完整 P2-G2-LIVE 或 P2-008。

A/B 均可读取自己的两单，对他人的两单均被拒绝。手机上按顺序打开多个页面已验证，但未执行同时多标签测试。退出本次访问后，旧请求可返回 401，重新打开入口会启动新的 `snsapi_base` OAuth 流程；企业微信可以自动完成这轮认证，因此“必须出现手动认证提示”不是通过判据。应核对退出、重定向或未认证拒绝、新 OAuth 回调、本人读取恢复的请求顺序。

只读窗口曾通过 Unix socket 代理连接 nginx 容器与主机回环上的唯一 App，没有改变 PostgreSQL 的监听或认证规则。日志仅记录时间、方法、HTTP 状态和固定路径别名，不记录查询串、Cookie 或原始成员 ID。窗口结束恢复原 nginx 字节和 OAuth-only 容器；本轮已完成回退，保留四张测试工单。

旧 Grant 卡片现场和真实卡片发送仍未执行，后者没有独立发送授权。退出/恢复和部分现场验证通过不等于 Gate 批准。
