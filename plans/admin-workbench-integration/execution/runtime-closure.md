# 当前人工工作台候选隔离闭环验收

> 本报告保存本地验收完成、提交发布之前的状态快照。随后授权的提交、PR 审查、CI 与合并结果另记于证据目录的 `publication/`，不重绑下列 dirty 候选的 HEAD、构建或验收身份。

2026-10-18。承接 PR #102 合并后的实际代码。本次只完成本地实现、构建与隔离验收，未提交、推送、创建新 PR、合并或部署。GitHub OPEN Issues 本次只读查询为0，未修改任务或 Gate 状态。

| 判断 | 结果 |
| --- | --- |
| 新版运行入口接线 | **PASS**：正式配置解析、父进程及 App／Worker／Gateway |
| 当前候选制品 | **PASS / ARTIFACT_VERIFIED_NOT_ACTIVATED** |
| 实际进程隔离闭环 | **PASS**：A–F，真实业务、PG、HTTP、React、SSE |
| 当前候选真实企业微信闭环 | **NOT_RUN**：没有本次具名真实登录／发送／现场库授权 |

制品通过不表示部署、正式启用或用户已读。外部 OAuth、身份转换、SDK 与 Sender HTTP 为隔离合成叶子，不是生产默认实现。

## 候选与保全

| 项目 | 实际身份 |
| --- | --- |
| 分支 | `codex/workbench-runtime-wiring`；前项已删除该分支，本次从合并后的 main 重建同名本地分支 |
| 完整 HEAD | `31f28a06d3a076ef77a0ce68bdd7df46168dbf19` |
| HEAD tree | `c41ae5294a8394232517d52bf7aa109721daf789` |
| 工作区 | dirty；5个已跟踪文件修改、1个新增报告；未暂存，没有用户原有未提交修改被覆盖 |
| source input hash | `f3fee8714b82d3caf51b1b37bb1ec9b37674332e2f447b79f94d96a8bb15a8c1` |
| manifest SHA256 | `98840cf84f3376cf279af37308a892d48291f73d9362558ca0f4712f6567f662` |
| 构建清单 | 1820输入、818 typed、351 legacy、2406输出；逐输出哈希不一致0 |
| 环境 | Node 24.18.0、TypeScript 5.9.3、任务自有 PostgreSQL 18.4 |
| 运行输入 | 显式 `human-v1`、ISOLATED_TEST 成员配置、合成通知资格、transportEnabled=true；仅替换外部叶子 |

HEAD/tree 是基础提交，当前修补由 dirty 工作区、逐输入哈希和 manifest 共同标识。不能把基础提交当成本轮代码已提交。以后提交或改变运行输入，必须重新沿既有构建／校验机制确认候选。

全部动态证据位于 `D:/wecom-workbench-evidence/isolated-closure-20261018`（下称 E）。可复用产物为仓库 `.build/runtime/`，独立备份为 `E/candidate-4-runtime/`；清单及真实工作区状态见 `E/final-candidate.json`、`E/final-build-manifest.json`、`E/final-changes.patch`。

保留问题发现基线 `2962679248f076ed5a11fba9b2ef309ac5fceef1` 曾返回 `MIGRATION_INPUT_DRIFT`、退出码1的历史事实。本次没有回退。前项交付见 [接线记录](runtime-wiring.md) 及 `D:/wecom-workbench-evidence/runtime-wiring-20261017/publication/merge-delivery.md`。

本次开始时旧本地制品仍绑定 `44f129c39727b361f3598f3d06f90fe7c0124750` 的 dirty 快照；在当前 HEAD 上重新执行原校验也实际返回漂移、退出码1，见 `E/artifact-before.log`。因此不能复用旧制品。旧2406输出、原 manifest/proof 均备份并逐项核验，见 `E/previous-runtime/`、`E/previous-candidate.json`。未改写校验器、manifest、artifact-proof、冻结迁移、历史 hash 或全仓换行策略。

按本次明确授权删除以下4条远端历史分支及本地跟踪引用；本地同名实际分支原本不存在。删除前以原完整 SHA 制作并验证 `E/historical-branches.bundle`，SHA256 为 `ca328619ac3cb843ceaecdf9a2f25ce4c3ccbc6a64ae0b2e18c4b2a83baa6b39`。原引用见 `E/deleted-branch-originals.json`。

- `codex/typescript-dependency-preflight`
- `codex/typescript-t00-validation-only`
- `codex/typescript-t02-object-preparation`
- `codex/typescript-t02-prepare`

## 本轮修改

| 文件 | 作用 |
| --- | --- |
| [p2-016-direct-intake.mts](../../../src/p2-016-direct-intake.mts) | 修复真实 App／Worker 投影补绑窗口：Session 已出现、Leg/Journey 引用尚空时，同主题消息可沿精确唯一来源 Session 和最新 Leg 续接原 Intake；已有冲突引用、身份／来源不符、结束及留存边界仍拒绝 |
| [human-workbench-process.browser.test.mts](../../../tests/human-workbench-process.browser.test.mts) | 增加实际编译入口 A–F；真实 SDK 入站、四主体 OAuth、React/SSE、四来源处理及反馈、三适配器目标、回执恢复；旧静态夹具在 Worker 启动前准备，避免竞态建 Journey |
| [human-workbench-boundaries-role.mts](../../../tests/helpers/human-workbench-boundaries-role.mts) | 仅测试 SDK 的 loopback 入站端口、四种合成身份及安全角色／目标记录；停止后确认监听关闭 |
| [p2-g2-conversation-binding-boundaries.integration.test.mjs](../../../tests/p2-g2-conversation-binding-boundaries.integration.test.mjs) | 确定性复现延迟补绑窗口，并验证错误创建键、非空冲突引用不能续接 |
| [运行说明](../../../docs/runbooks/human-workbench-runtime.md)、本报告 | 当前候选、实际命令、验收与下一步 |

没有新增业务状态机、业务表、消息队列、独立生产聊天服务或 AI。DirectIntake 保留 Journey/Leg reporter hash 一致性；HMAC 重算仍由既有补绑器负责。

## 实际链路、配置与 schema

`编译 human-workbench.main(['--start']) → readHumanWorkbenchConfiguration → 原 G1 父进程 → fork 三个编译角色 → App Runtime／Worker 编排与投递／Gateway Sender`。测试只通过专用 roleScriptUrl 提供外部 fetch／SDK，不通过测试 runtimeFactory 构造业务 Runtime。

| 能力 | 依赖和执行角色 |
| --- | --- |
| 工单接单／分派／等待／恢复／完工／同单重开、代录／复核 | App 的既有 self-handling、assignment、waiting、completion、reopen、manual 功能及 Unified Ticket Core |
| 会话接管／文字／备注、收件箱／来源／个人已读／实时 | App：conversations + inbox、现有 identityHmacKey、personal-read、唯一 realtime 控制器；真实 Session／CSRF／个人范围 |
| 草稿／命令核对、补充跟进 | App 的既有 draft-recovery、各命令回执、supplement-follow-up；不增加账本 |
| 节点通知与受控恢复 | App 原轮次意图 → Worker Outbox/Delivery → IPC → Gateway；模板、时间线、接单、工作人员完工和 MEMBER_REQUIRED 同时满足 |
| 原报修人查询／未解决 | App 的原 Web requestRef／Bot publicRef 反馈入口、成员 OAuth；不用管理员 reopen 替代 |
| 群／Bot 私聊／H5 应用 | Gateway 原群消息推送、SDK、应用 Sender；群提及证明、Bot 目标白名单、应用 open_userid 转换分别验证 |

精确选项、配置样例和角色白名单见[运行说明](../../../docs/runbooks/human-workbench-runtime.md)。本次所需配置如下，均不含密钥值：

| 配置 | 默认／依赖 | 所属角色 |
| --- | --- | --- |
| `WORKBENCH_RUNTIME_PROFILE` | 不设置则关闭；显式 `human-v1` | 父进程／三角色 |
| `WORKBENCH_RUNTIME_CONFIG` | 必需绝对路径，schemaVersion=1，严格类型与未知字段校验 | 父进程解析后按角色映射 |
| `PILOT_DATABASE_URL` | 必需；本次仅自有 loopback 合成库；测试父进程 `TS_MIGRATION_TEST_DB_ISOLATED=1` | 三角色 |
| `PILOT_LOG_IDENTITY_HASH_KEY` | 既有身份密钥，至少16字符；不轮换、不替换为 Reporter secret | App Runtime/认证、Worker、Gateway |
| `P2_016_REPORTER_HMAC_SECRET` | 独立 Reporter 用途，至少32字节 | 三角色原反馈／通知用途 |
| `APP_SECRET` | 既有成员应用凭据；成员入口/OAuth/MEMBER_REQUIRED | App；发送启用时 Gateway；Worker 不接收 |
| `WECOM_BOT_SECRET` | transportEnabled=true 时必需 | 仅 Gateway |
| `WORKBENCH_EXTERNAL_IO_APPROVED`／`WORKBENCH_EXTERNAL_IO_APPROVAL_REF` | 正式外部 IO 默认未授权；启用须具名批准及引用，配置不产生授权 | 父进程／Gateway |
| `publicOrigin`／`reporterOrigin`／`listenPort` | 精确 HTTPS origin、loopback 端口 | App；通知链接供 Gateway |
| `memberEntry` | 既有委托身份映射、corpId、agentId、成员范围与证明 | App／通知校验；正式为 LIVE/DEPLOYMENT |
| `bot`／`groupRoutes` | Bot、WSS、个人/群目标 hash、对应群路由 | Gateway |
| `notificationBindingsFile`／`appChannelAccountId` | 当前有效、同映射、已核实且可达的资格；原应用账号 | App／Gateway |
| `transportEnabled` | false；隔离验收显式 true，外部叶子合成 | 父进程／三角色；App 内 Sender/Gateway 仍关闭 |

复用 `migrateCurrentBaselineWithYxx` 的基础 DDL 链，再应用既有 auth、self-handling、staff-completion、round-notifications（含052）、manual-reports、reopen、Bot feedback、personal-read、follow（回执依赖）、supplement-follow-up、source-groups、conversation-delivery-commands。实际迁移账本19个标记完整保存在 `E/closure-proof.json`：022、030–035、037、039–044、047、050、052、061、062；这不是“全部基础 DDL 只有19项”的声明。启动只核 schema readiness，不自动迁移。

## 实际验证及命令

最终候选只构建一次（candidate4）。开发期间因实际输入修补共构建4个不同候选；没有通过 run-tests CLI／旧 npm 测试别名重复触发构建。活动集合唯一记录为 `v3-p09`，本地只执行下列 targeted 子集，不称活动全集、full 或 certify。

```powershell
Set-Location D:\Projects\Fault-Reporting-WeCom-Assistant
npm.cmd run migration:build
node .build/tools/gate.mjs types
node D:/wecom-workbench-evidence/isolated-closure-20261018/run-targeted.mjs wiring wiring-candidate-4
node D:/wecom-workbench-evidence/isolated-closure-20261018/run-targeted.mjs related related-candidate-4
node .build/tools/verify-artifact.mjs
```

上述两个已用报告目录有防覆盖检查，重跑须使用新的空报告目录名并先创建新的自有隔离 PG。外部小脚本只使用编译后的 `loadRoutes/select/runSelection`，保留注册 Entry、flags、数据库/浏览器要求及超时；不新增仓库 selection 或框架。

正式配置检查／启动／停止沿原入口（真实配置与发送须另获具名授权）：

```powershell
node --env-file=secrets/human-workbench.env .build/runtime/scripts/human-workbench.mjs --check
node --env-file=secrets/human-workbench.env .build/runtime/scripts/human-workbench.mjs --start
# 同一控制台输入 stop 回车，或 Ctrl+C
```

本次实际隔离启动由已编译 process 测试调用上述同一 `main(['--start'])`，使用合成配置和外部叶子；`controller.stop()` 关闭三个真实子进程，SDK端口关闭另有连接失败断言。正式 CLI 的默认关闭／缺配置拒绝也由配置测试实际执行。

| 测试文件（均在 tests/） | PASS |
| --- | ---: |
| human-workbench-configuration.test.mts | 4 |
| human-workbench-process.browser.test.mts | 3 |
| p2-g2-direct-session-boundary.integration.test.mjs | 23 |
| p2-g2-late-conversation-binding.integration.test.mjs | 1 |
| p2-g2-conversation-binding-boundaries.integration.test.mjs | 6 |
| conversation-rule-admission.integration.test.mts | 4 |
| t21-bot-ordinary-supplement-no-reopen.integration.test.mts | 1 |
| t24-synthetic-sender-unknown.integration.test.mts | 1 |
| t26-group-unknown-and-interruption.integration.test.mts | 1 |
| t36-supplement-follow-up.integration.test.mts | 1 |
| wbint-t43-four-source-service-loop.browser.test.mts | 1 |
| wbint-t43-competition-recovery.browser.test.mts | 1 |
| t10-unknown-recovery.browser.test.mts | 1 |

共 **13文件／48 PASS，0 FAIL／CANCELLED／SKIP／TODO，选定入口 NOT_RUN 为空**。原件为 `E/wiring-candidate-4/` 与 `E/related-candidate-4/` 中 summary、逐文件 TAP、cases、执行宿主／加载来源和截图。实际入口证明来自新 process case；其他 Runtime 夹具仅作相关回归，不替代该证明。

| 场景 | 当前候选实际结果 |
| --- | --- |
| A | 正常群@Bot与私聊经过合成 SDK→正式 Gateway；材料/Intake/Session/Ticket 可定位，重复帧不重复建单 |
| B | 真实 takeover、文字及内部备注、责任转派、等待补充；H5 原 SYSTEM resume、Bot 人工 resume 保持差异；本人阅读不推进他人位置或团队跟进；暂停普通规则为 CANCELLED/NOT_ATTEMPTED、Sender调用0 |
| C | 当前处理人完成四来源；内部材料不外发；首承接与完工两节点逐路 SENT；群提及、SDK原目标、应用 open_userid 正确；不把ACK解释为本人已读 |
| D | Web与群/私聊原报修人正式反馈；同编号、新轮次、清空原处理人、重新承接；Worker处理普通补充和新问题后原单不误重开 |
| E | H5本人列表/详情可见、他人404；未核实PHONE代录内部完工且无自动通知目标 |
| F | 服务端提交后真实HTTP响应被测试客户端丢弃；原UUID查询COMMITTED并显式同正文重试，责任转派事件只增加1次；另有原浏览器恢复及UNKNOWN不自动重发回归 |

构建、strict、制品分别见 `E/build-candidate-4.log`、`E/types-candidate-4.log`、`E/artifact-final.log`。原前端大 chunk 提示保留，不在本任务扩展优化。文档检查及工具回归见 `E/agent-docs-final.log`、`E/agent-docs-test-final.log`。

历史失败不覆盖：candidate1 真实同主题被误分 Intake；只读观察记录了 NULL→补齐窗口，第一轮观察因清库终止观察连接而中止，不能称完整测试通过；candidate2 包含旧静态夹具与 Worker 建 Journey 的死锁，以及新增 SQL 注释分号被原单语句守卫拒绝；candidate3 为测试使用错误 H5 GET 列表路径。对应日志、报告、诊断快照和各完整构建均在 E 保留。SQL注释移出、静态夹具提前准备、测试路径及身份命名空间断言均已修正；未放宽事务守卫或业务授权。

## 资源与下一步

本次 PG 所有者 `563142cd-5051-49a3-bf91-c5c83f4ce95e`，PG PID5408、端口55458；完整 A–F 的 App／Gateway／Worker PID 为30984／22440／12988，App／HTTPS代理／合成SDK端口50771／50772／50774。它们仅用于本次隔离测试。

各UUID合成库已删除，库清单恢复 postgres/template0/template1，客户连接0；PG status退出3、监听0、主进程0。自有 `owned-pg18` 与 `temp` 已按绝对路径／无reparse点检查后删除，诊断残余先归档到 `E/diagnostic-temp-archive/`。证据：`E/resource-owner.json`、`E/database-cleanup.json`、`E/resource-cleanup.json`、`E/final-resource-git-audit.json`。停止实际执行 `E/stop-owned-pg.ps1`。没有额外Git工作树或应用工作树挂载；当前验收分支、源码、最终构建及所有历史证据保留待统一审查。

真实渠道、真实 Gateway 登录、现场库写入／迁移、部署、P2-G2-LIVE/P2-008、P2-G3/P3、手动 full/current certify/历史 certify、本轮新 PR/远端CI均 **NOT_RUN**。

真实试单清单（尚未授权，不执行）：

1. 先审查本报告的 dirty 候选；如提交代码，重新构建并记录新完整 HEAD/tree/input hash/manifest，不能把当前制品重绑到新提交。
2. 具名指定现有成员应用的 corpId/agentId、Bot ID、测试群ID、原报修人与处理人员；本次未加载 `.env.pilot`，不猜测或填写真实身份。确认群提及证明、应用成员资格、同一稳定身份密钥及独立 Reporter secret。
3. 指定现场数据库、迁移权限、HTTPS入口、授权窗口和停止负责人；先用既有迁移 check/status 核对必要 schema，再运行配置 `--check` 与制品校验。
4. 仅在批准的群/用户上执行 A–F 的具名试单：群和私聊各1单、H5本人1单、未核实电话1单；接管/转派/补充/完工、原报修人“仍未解决”及重新承接。保存工单号、轮次、节点Delivery和真实渠道回执，不收集无关业务数据。
5. 明确允许 Gateway 登录、这批真实通知/回复及指定库业务写入后才启动；遇身份不符、误投、UNKNOWN或重复写立即按原核对路径停止，不自动重发。结束输入 stop，核三个角色退出。真实送达与用户已读分别记录，不能沿用本地合成成功。

本地必要验证已完成，没有已知未解决的本次阻塞；下一步是统一审查及按上述清单另行取得真实试单授权。
