# 医小修成员工单入口：定向现场范围申请

状态：DRAFT / OWNER_CONFIRMATION_REQUIRED / NOT_AUTHORIZED / NOT_RUN。
本申请仅整理离线检查与待批准范围，复用 docs/runbooks/yixiaoxiu-member-ticket-entry.md；不是新现场手册，不是开工批准或 P2-G2 Gate 结论。配套 JSON 保存本次检查结果与源文件摘要。

## 1. 当前候选与就绪状态

- 分支 main；commit：9aa2428c85fbd28d34eaf5a795be85046afc59a7。
- tree：33826803c02e058f6475a8a0c8b5abccf6a8aaa0。
- candidate fingerprint：9e6aa8a001fc0fde9c4f364888d5ecbaa28dd3350269e1af72e18d3c4a502048；609 文件，SHA256_SORTED_PATH_CONTENT_UTF8_LF。
- 本地合并提交的标题与双父记录对应 PR #8；本轮未请求远端，不作远端实时核验声明。申请前工作区与 index 干净。
- node scripts/p2-g2-yixiaoxiu-check.mjs --require-ready：exit 0，CURRENT_READY。
- node scripts/validate-p2-g2-service-loop.mjs --require-ready：exit 0，17 checks。
- node scripts/p2-g2-check.mjs --mode=check：exit 0；只是离线配置/指纹检查。
- 当前报告引用的隔离回归为 1044/1044、166 测试文件、两轴独立审查通过。本轮验证其当前候选证据绑定，没有重跑数据库、浏览器、资源测试或全量回归。
- 父准备状态 READY_FOR_LIVE_E2E；成员入口 READY_FOR_TARGETED_LIVE_VALIDATION；真实身份仍为 IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING。P2-G2-LIVE 未授权、NOT_RUN；P2-008 TODO_BLOCKED_BY_P2_G2。
- 当前 .gitignore SHA256 为 0350afa8c952a92ee938901ae5e079c993c87d5ff1bb672a4e7a827f5d52d092，与冻结旧记录不同，但相对当前 HEAD 无修改。不得为门禁恢复旧版本；本轮检查均在现有版本上完成。

## 2. 身份对应：可信来源与未补齐证据

负责人需指定有权核验人员、受保护材料位置和允许的核验方式，先批准这一窄范围，证明完成后才能批准启用。A/B 必须分别证明：

| 可信来源 | 必须证明 | 当前缺口 |
|---|---|---|
| 企业微信管理侧应用归属与配置的受控记录，由授权管理员确认 | 同一企业下的目标 Corp、应用 Agent、Bot/Channel Account 归属及应用可见范围 | 当前未提供本次引用与管理员确认 |
| 经独立许可取得的真实 OAuth 服务端身份结果摘要 | A/B 各自的应用 userid 口径；对应本次企业和应用 | 本轮未调用；历史 OAuth 成功仅证明认证 |
| 既有测试消息的可信 Gateway/Channel Message → Intake 上报人绑定记录 | A/B 各自 Bot 上报身份口径，及到 A1/A2/B1 所属 Ticket 的链路 | 未指定记录、测试库与核验许可 |
| 授权核验者在受保护环境逐项比对的证明 | OAuth 身份与 Bot reporter 身份同一命名空间、逐成员对应，保留证据引用及摘要 | LIVE proofRef、核验人、时间和结论均待提供 |

不能以姓名、部门、手机、页面登录成功、SYNTHETIC 结果替代证明。既有手册引用的官方协议材料是解释口径的来源，不是 A/B 对应证明；本轮未联网刷新。
只有真实证明成立，才允许后续受保护配置使用 identityMode=VERIFIED_SAME_NAMESPACE、memberIdsConfirmed=true、proofKind=LIVE、非空 proofRef、validationProfile=DEPLOYMENT。
未知或不一致立即停止，不启用、不修改身份数据、不调用转换接口；窄映射 Adapter 如确需实施须另立任务。

## 3. A/B 与 A1/A2/B1 待确认清单

| 别名 | 申请用途 | 负责人尚需确认 |
|---|---|---|
| A | 本人读取、多标签、旧链接、退出与恢复 | 真实测试成员的受保护引用、身份对应证明、企业/应用可见性、手机及电脑测试设备、参与同意 |
| B | 他人拒绝与自身读取的阳性对照 | 与 A 不同成员；同上；禁止用认证成功代替归属检查 |
| A1 | A 第一张既有测试工单 | 测试库摘要、Ticket/public_ref 的受保护映射、A 的权威 reporter 绑定、预期公开 Timeline/Incident、安全字段清单 |
| A2 | A 第二张既有测试工单 | 与 A1 不同 ref；用于双标签各归原 ref；所有权和预期内容同样待核实 |
| B1 | B 既有测试工单 | B 的权威所有权、与 A1/A2 不同 ref、B 可读/A 不可读 |

必须确认三张工单仅为获准测试数据、允许读取字段、访问审计落库、测试记录保留期限及保管人。不得在本轮创建工单或访问数据库。
旧链接另需受保护夹具清单：ISSUED、CONSUMED、过期但签名有效、REVOKED、旧密钥无效、伪造签名。缺任何夹具时相应用例保持 NOT_RUN；不为覆盖率改真实 Grant 状态、轮换共享密钥或恢复旧 Grant。
既有资源不足时先补充范围批准，不自动扩到建单、工单 Action 或 Incident link/unlink。

## 4. 唯一 App、精确 proxy、配置与发布回滚申请

唯一运行组合：MEMBER_TICKET_READONLY，reporterPolicy=MEMBER_REQUIRED，单 App、loopback 监听、连接池 max=4。
它包含 OAuth、单 Ticket 安全读取及访问审计；业务表只读不等于数据库零写入，访问审计写入需明确批准。
不启动 Worker、Gateway、Workbench、AI、SSE、FULL_SERVICE_LOOP。替换既有 OAuth-only App，不并行叠加内存 Cookie 服务。

配置存在性仅检查当前进程、.env 和 .env.pilot；未输出值、未自动装载到进程、未扫描云端：
- 当前进程所需 11 项配置均未设置。运行 node scripts/p2-g2-yixiaoxiu-serve.mjs --check 返回 exit 1 / YXX_ENTRY_CONFIG_INVALID；默认回落 OAUTH_ONLY，故此结果也不是 MEMBER_TICKET_READONLY 配置验证通过。
- .env 仅发现 PILOT_DATABASE_URL；.env.pilot 发现 CORP_ID、APP_ID、APP_SECRET、PILOT_DATABASE_URL。存在不代表适用、有效或已批准。
- 三个来源均未找到运行 profile、固定 origin/端口、两个显式开关、成员配置路径、P2_G2_REPORTER_HMAC_SECRET；未找到被这些来源引用的成员配置文件。
- 仓库配置 example 存在，两个默认开关 false、身份 UNVERIFIED；不得把 example 当作部署凭据配置。
- 后续需通过既有受保护渠道提供：YIXIAOXIU_RUNTIME_PROFILE=MEMBER_TICKET_READONLY；固定 WECOM_WEB_OAUTH_ORIGIN/PORT；WECOM_WEB_OAUTH_ENABLED 与 YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED 显式字符串 true；批准的 CORP_ID/APP_ID/APP_SECRET（应用 secret，不是 Bot secret）；YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG；批准测试目标 PILOT_DATABASE_URL；既有 P2_G2_REPORTER_HMAC_SECRET。
- 需复核配置中 corpId/agentId 与应用匹配、botId 归属、LIVE 身份证明及配置规范化摘要。摘要绑定本次批准；原始配置、secret、userid 不进入公开 Evidence。

拟申请仅放行以下方法和精确路径，动态 ref 由 App 现有格式校验；public_ref 为 32 位 [A-Za-z0-9_-]，entry_ref 为手册规定的 64 字符引用。不能扩成整个 /api 或路径前缀通配：

| 方法 | 路径 |
|---|---|
| GET | /wecom/yixiaoxiu/ |
| GET | /wecom/yixiaoxiu/login |
| GET | /wecom/yixiaoxiu/callback |
| POST | /wecom/yixiaoxiu/logout |
| GET | /wecom/yixiaoxiu/tickets/{public_ref} |
| GET | /wecom/yixiaoxiu/continue/{entry_ref} |
| GET | /reporter/ |
| GET | /reporter/open |
| GET | /reporter/reporter.js |
| GET | /reporter/reporter.css |
| GET | /api/reporter/member/session |
| POST | /api/reporter/member-entry/prepare |
| GET | /api/reporter/bootstrap |
| POST | /api/reporter/logout |
| GET | /api/reporter/tickets/{public_ref} |
| GET | /api/reporter/tickets/{public_ref}/timeline |

旧 exchange 固定拒绝；具体拒绝路径按现有手册与 App 合同核对。其余接口默认拒绝，不开放 Workbench、内部写接口、health、metrics、管理路由。固定 Host/publicOrigin，不信任任意 X-Forwarded-*；callback 仅 GET。
关闭 callback query、prepare body、Cookie 敏感日志；校验 HTTPS、手机证书信任、no-store/no-referrer、Secure/HttpOnly/__Host Cookie、SameSite=Lax、self CSP 和 POST 同源。

待批准发布步骤（本轮全部 NOT_RUN）：
1. 填写目标主机别名、固定域名/端口、部署包摘要、配置摘要、精确 proxy diff、当前 OAuth-only 版本摘要和原停止态 G2 包摘要；明确操作人、发布窗口与回退窗口。
2. 在独立授权后完成身份核验、批准测试库与审计权限、检查真实配置；在指定环境用现有 --check 失败关闭，通过仍不自动授权启动。
3. 保留原包/配置与 proxy 快照；替换唯一 App，按批准 diff 切换 proxy；仅批准本入口 HTTPS/客户端步骤。旧内存 Cookie 不迁移，必须重新认证。
4. 停止/结束时关闭本次 App、自有请求、连接池与认证/intent；核对释放与停止状态。在批准窗口按原摘要恢复 OAuth-only 和 proxy，重新登录；原停止态 G2 包保持停止。
5. 不执行迁移/回滚迁移，不删工单、审计、Grant 或历史 Evidence；MEMBER_REQUIRED 失效不得降级成公开 LEGACY_BOUND_GRANT。

## 5. 现场顺序与判据（引用现有手册，不是执行记录）

所有步骤须在身份与运行范围另行批准后执行；本轮均 NOT_RUN。

| 步骤 | 范围与预期 |
|---|---|
| 本人读取 | A 打开 A1/A2，B 打开 B1；核对完整工单号、安全标题、状态、Shanghai 时间、公开 Timeline 与本人可见 Incident。重复点击、刷新、认证过期重登、手机/电脑独立登录后仍正确 |
| 他人拒绝 | B 打开 A1/A2 均 404，同时 B1 可读；A 打开 B1 拒绝。只有旧 Cookie/Grant/public_ref、A OAuth 混 B 旧 Cookie 不得获得 B 内容；详情、Timeline、bootstrap 和条件请求/304 均不能旁路 |
| 多标签 | 同一浏览器 A1/A2 同时打开、交错完成认证，各自回原 ref；退出换 B、历史返回及晚到响应不得出现 A 内容 |
| 旧链接 | fragment 清除 → prepare/OAuth/ownership → canonical；签名有效的 ISSUED/CONSUMED/过期链接仅定位，REVOKED/失效密钥/伪造拒绝；Grant 不复活、不消费 |
| 退出 | 分别核对两个 logout 路由与 session；退出、重登、换账号、返回旧页不回显旧内容，旧 exchange 拒绝；不复制跨进程 Cookie |
| 恢复 | 优先只对测试浏览器暂时断网、恢复并刷新；验证 Timeline 503 后补齐、不提前采纳新 ETag。真实 Provider/DB 故障注入须单独批准精确目标、手段、窗口、影响上限；未批准则对应项 NOT_RUN，不停共享依赖 |
| 收尾 | 对照测试范围审计与业务表差异、成功/拒绝计数、资源和停止结果。业务无新增 Ticket/Delivery/Grant/持久 Reporter Session；访问审计增量单独列明 |

状态 Action/Incident unlink 场景只有另获工作台/夹具权限才执行；不能用直接 SQL 改真实业务状态。本入口登录不建立 Direct Leg 或私人发送资格。短时验证不等于完整 2C4G/自然 GC/60 分钟观察。

## 6. 真实卡片发送：独立许可

当前发送授权数为 0，实际发送数为 0。建议独立申请上限 3 张 canonical 测试卡片：A 收 A1、A2 各 1 张，B 收 B1 1 张；无群发、无其他成员、无自动补发。
负责人须逐项确认是否批准这 3 个目标、卡片类型与内容摘要、已有合法 Delivery/发送资格、执行渠道与人员、发送窗口、计数和 UNKNOWN 处理。真实目标只通过受保护别名映射交付。
成员只读 App 不具备发送能力；若现有发送路径需启动完整服务环或 Gateway，立即停止，另行明确独立发送执行范围，不能由此申请启动 P2-G2-LIVE。必须经过既有 Outbox/Delivery，禁止绕过。
若已有合规 canonical 卡片可复用，维持 0 次新发送；A 向 B 的手工转发另需 A/B 同意，拟上限 A1/A2 各 1 次，仅限 B。UNKNOWN 进入既有 Reconciliation，不盲重试，不增加许可额度。

## 7. 负责人确认、窗口、停止与证据

负责人必须补全后另行给出明确批准；本申请本身不赋予任何现场操作权限：

| 待确认项 | 当前值 |
|---|---|
| 项目负责人、身份核验人、发布操作人、现场执行人、证据保管人 | 全部待指定 |
| 身份来源访问/真实 OAuth 核验许可 | 未授权；A/B 逐成员 LIVE proof 待补 |
| A/B、A1/A2/B1、旧链接夹具与数据/审计范围 | 待指定、核实和批准 |
| 主机/域名/端口、唯一 App、proxy diff、部署/配置/回退摘要 | 待确认 |
| 发布、现场开始、现场结束、回滚截止窗口 | 全部待填 Asia/Shanghai 时间及字符串 epoch_ms；过期立即停止 |
| 真实新卡片发送 | 当前 0；拟 A×2、B×1，共 3，必须独立许可 |
| 手工转发、故障注入、状态 Action | 单独勾定；默认不包含共享依赖故障和业务状态修改 |
| 数据/截图/审计保留期、访问者、到期处理责任 | 待批准，不删除既有业务/历史证据 |

停止条件：身份未知/不一致、候选或配置摘要漂移、任何归属错误/内部字段泄漏/Cookie 旁路、意外业务写入或发送、发送 UNKNOWN、超目标/超额度、日志含凭据、范围或窗口超限、资源不能释放。发现即停止本次唯一 App，保留脱敏失败证据并通知负责人；不得自动扩大权限或改业务代码。

证据输出仅新增本轮申请 MD 与离线检查 JSON，源文件摘要与检查退出码可复核；现场获批后另建带运行标识的结果、身份摘要、配置/proxy/包摘要、逐用例结果、脱敏截图、审计/业务差异、发送计数和恢复/清理记录，不改写冻结历史。
所有新增结构化事件统一使用现有 g2EvidenceTime（调用平台 time-contract）生成 event_time 和字符串 event_epoch_ms；未来批准窗口缺失时保持 null，不编造时间。
不记录 secret、Cookie、OAuth code/state、Grant、原始 userid、连接 URL 或 SDK/SQL 原文。

本轮边界：零 SSH/云端变更，零真实 OAuth/SDK/数据库访问，零服务启动与真实发送；无业务代码/迁移/开关修改，无 push/merge/tag。生成申请后停止，P2-G2-LIVE/P2-008 停止线不变。

申请记录时间：2026-09-12 09:04:32（Asia/Shanghai）；event_epoch_ms：1789175072689。
