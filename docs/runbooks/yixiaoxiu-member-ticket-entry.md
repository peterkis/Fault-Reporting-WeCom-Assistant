# 医小修成员工单入口定向现场手册

Status: NOT_AUTHORIZED / NOT_RUN. 本文是后续独立授权的执行模板。当前只能使用本地合成自动化结果；没有本次真实身份对应证明、客户端验收或负责人现场批准。

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
