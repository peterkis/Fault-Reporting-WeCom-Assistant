# 新版人工工作台运行接线交付

状态：**LOCAL_VERIFIED / 待用户审查**，2026-10-17。显式 `human-v1` 入口已接通原 App／Worker／Gateway、认证、工作台与三种 Sender。没有 SQL／Schema、业务状态机、队列、AI 或前端业务代码变更；完整运行旅程由下一项继续。

本次 GitHub OPEN 列表只读查询为空，未新建、修改或关闭 Issue。原43票、Gate、默认持久开关及历史证据保持。

## 候选身份与文件

初始 `main` 工作区干净，从原点创建 `codex/workbench-runtime-wiring`，没有回退。交付为该分支上的 **18个未提交文件改动**，索引未暂存；没有 commit／push／PR／merge。

| 身份 | 实际值 |
| --- | --- |
| HEAD | `2962679248f076ed5a11fba9b2ef309ac5fceef1` |
| HEAD tree | `7b9354305f460614456e2425300a54ddae343bf3` |
| 工作区 | dirty；5个已跟踪文件修改，13个新增文件 |
| 最终 source input hash | `1c42ade3d9dc9b366e7f084359b9342f2d833950b3a474515d0a552a57bb08b2` |
| 最终 manifest SHA256 | `7402e9f320ff4d3694e364617c4df8d74939ae60af894fa1f7f9d6754cd13e5d` |
| 构建清单 | 1820输入；818 typed implementation；351保留 legacy；2406输出 |
| 环境／状态 | Node 24.18.0、TypeScript 5.9.3、隔离 PostgreSQL 18.4；`STAGED_NOT_ACTIVATED` |

HEAD/tree 是基础提交身份。本轮代码由真实 dirty 工作区、逐输入哈希和最终 manifest 共同标识，不把基础 HEAD 当作包含本轮修补的提交。

| 文件 | 作用 |
| --- | --- |
| [human-workbench-configuration.mts](../../../src/human-workbench-configuration.mts) | 集中解析、前置依赖校验、原密钥用途分离、最小角色映射；当前通知资格重读／撤销／到期拒绝 |
| [human-workbench-cluster.mts](../../../src/human-workbench-cluster.mts) | 原三进程及 IPC；OS字段白名单和可选测试覆盖目录，不继承其他环境／NODE_OPTIONS |
| [human-workbench.mts](../../../scripts/human-workbench.mts) | 编译 CLI 检查／启动／stop／Ctrl+C，只输出安全状态，不迁移 |
| [human-workbench-role.mts](../../../scripts/human-workbench-role.mts) | 明确能力组合、正式 OAuth、App identityHmacKey、Worker 编排、Gateway 三种实际 Sender，原 schema readiness |
| [p2-g1-process-role.mts](../../../scripts/p2-g1-process-role.mts) | 正式认证注入时不要求测试 principal 列表；旧测试路径保持 |
| [p2-g1-process-cluster.mts](../../../src/p2-g1-process-cluster.mts) | 仅显式 externalAuthentication 模式允许正式认证没有测试 Cookie，旧拓扑检查保持 |
| [workbench-conversation-inbox.mts](../../../src/workbench-conversation-inbox.mts) | 修补真实 Session 谓词替换后遗留未使用 `$5` 的 PostgreSQL 500；保留到期条件及真实 Session 终检 |
| [运行配置](../../../config_examples/human-workbench.json)、[环境样例](../../../config_examples/human-workbench.env.example)、[通知资格样例](../../../config_examples/human-workbench-notification-bindings.json) | 三份占位配置，无真实密钥、收件人或授权值 |
| [配置测试](../../../tests/human-workbench-configuration.test.mts)、[进程／HTTP／浏览器测试](../../../tests/human-workbench-process.browser.test.mts) | 默认关闭、前置失败、角色隔离、真实认证／读取／SSE／反馈／发送链 |
| [测试设置](../../../tests/helpers/human-workbench-test-settings.mts)、[外部边界子入口](../../../tests/helpers/human-workbench-boundaries-role.mts) | 仅隔离合成配置与外部 HTTP／SDK 叶子，业务／数据库／认证 Session／Runtime 保留 |
| [test-routing.json](../../typescript-migration/test-routing.json) | 两个 STAGED_RUNTIME 入口、human-workbench-wiring、活动 v3-p09 追加、实际编译子入口观测 |
| [运行手册](../../../docs/runbooks/human-workbench-runtime.md)、[README](../../../README.md)、本记录 | 入口导航、配置／关闭／复用说明及交付状态 |

## 最终链路和能力

`human-workbench.mjs --start → readHumanWorkbenchConfiguration → createHumanWorkbenchCluster → 原 createP2G1ProcessCluster → 三个编译角色入口 → 原 Runtime／Worker／Sender`。

| 能力 | 本入口选项／依赖 | 角色 |
| --- | --- | --- |
| 接单／分派／开始／等待恢复／完工／同单重开 | self handling、conversation self handling、assignment、waiting actions、staff completion、reopen rounds | App，原 Core／轮次 |
| 复核／代录／补充／回执草稿 | manual review、resolve-and-start、manual reports、supplement follow-up、draft recovery | App |
| 接管／转交／释放／私聊文字／备注 | conversations、internal notes、真实 Session／CSRF／Control／Communication | App |
| 联系人／来源／已读／实时 | conversations + inbox；原 identity HMAC、source groups、personal read、realtime | App，唯一实时控制器 |
| 节点通知／异常／受控恢复 | round notifications + 接单／工作人员完工 + 模板／时间线 + MEMBER_REQUIRED；notification exceptions | App 原轮次消费者创建意图，Worker 投递，Gateway 发送 |
| 原报修人查询／仍未解决 | VERIFIED_DELEGATED_MAPPING、原 reporterUserIds、OAuth；原两个 yxx flags；Web／Bot feedback 及各自恢复选项 | App；Web requestRef／Bot publicRef 分别原成员验证 |
| 群／Bot 私聊／H5 应用 | T26 原群适配器／原 SDK Sender／T25 应用适配器，保留目标及等待后终检 | Gateway |

完整精确选项名称见[能力表](../../../docs/runbooks/human-workbench-runtime.md#能力与实际装配)。原 `PILOT_LOG_IDENTITY_HASH_KEY` 映射 App Runtime 的 `identityHmacKey`，不轮换、不与 Reporter secret 混用。App 内 Gateway／Sender 仍为 false；原 Outbox／Delivery／IPC 到 Gateway。

Worker 保留 `composeConversationRuleAdmission`，只收所需 Bot ID、两个原 HMAC、数据库与运行控制，不收成员列表、通知资格文件、Webhook URL 或应用凭据。未列选项保持默认；附件、核实目录候选、Incident、AI、搜索、提醒、活动、关注、预约、看板拖动等没有统一开启。旧演练入口及严格 `_ENABLED` 限制未改。

## 必需配置与命令

完整名称、默认值、依赖、角色见[配置表](../../../docs/runbooks/human-workbench-runtime.md#配置与角色)。必需项：`WORKBENCH_RUNTIME_PROFILE=human-v1`、`WORKBENCH_RUNTIME_CONFIG`、`PILOT_DATABASE_URL`、原 `PILOT_LOG_IDENTITY_HASH_KEY`、原 `P2_016_REPORTER_HMAC_SECRET`、`APP_SECRET`。发送另需原 Bot 凭据、具名外部 IO 批准及引用；通知文件须为当前、未过期、已核实的资格。

样例都是占位符，填写后才可用于正式检查／启动；本任务没有写入真实配置或密钥。在仓库根目录 PowerShell：

```powershell
node .build/tools/verify-artifact.mjs
node --env-file=secrets/human-workbench.env .build/runtime/scripts/human-workbench.mjs --check
node --env-file=secrets/human-workbench.env .build/runtime/scripts/human-workbench.mjs --start
```

同一控制台输入 `stop` 回车或 `Ctrl+C`；完成应输出 `event:stopped,process_count:0`。首次准备新代码使用原 `npm.cmd run migration:build` 和 strict gate；现有制品可直接复用。

`--check` 不连接数据库／Provider；transport=false 关闭消息投递，正式 OAuth 启动仍依赖身份服务。实际启动检查原 schema readiness，不自动 apply。真实身份、发送、现场库迁移／业务写入、部署均沿各自具名授权。

## 实际验证与原件

证据根目录：`D:/wecom-workbench-evidence/runtime-wiring-20261017`。

| 验证 | 结果 | 原件 |
| --- | --- | --- |
| 最终 strict | PASS，未放宽类型规则 | `types-final.log` |
| 最终构建 | PASS；818个 Node 编译文件语法检查，并发上限2；原前端 chunk 提示保留 | `build-final.log` |
| 接线 selection | **2文件／5 PASS，0 FAIL／SKIP／NOT_RUN** | `tests-final/summary.json`、逐文件 TAP／cases／loaded 清单 |
| 相关注册入口 | **11文件／37 PASS，0 FAIL／SKIP／NOT_RUN** | `related-final/summary.json`、逐文件原件 |
| 指令检查／工具测试 | PASS；工具测试 **19 PASS** | `agent-docs-final.log`、`agent-docs-test-final.log` |
| 最终制品 | PASS，manifest／输出／当前输入匹配，未激活 | `artifact-final.log`、`candidate-identity.json` |
| 历史制品保全 | 原2390输出、三个中间候选各2406输出；manifest/proof一致，逐输出哈希错误0 | `preserved-artifacts-verified.json` 及各备份目录 |
| 资源／差异 | diff检查 PASS；隔离库全删、运行连接0；自有PG停止／监听0，数据与临时目录删除 | `database-cleanup-before-stop.json`、`resource-cleanup.json`、PG stop/status 原件 |

测试调用编译后的 `human-workbench.main(['--start'])`，经过同一解析／父进程并 fork 三个编译子角色；专用子入口只替外部 HTTP／SDK，没有测试 runtimeFactory 绕过解析。另有独立 Node 进程执行正式 CLI 的默认 `--check` 和缺密钥 `--start`。

已证明正式认证无测试 Cookie、真实 bootstrap、正式 React 收件箱、读取／SSE、实时备注、Gateway 三种 Sender，以及 Web／Bot 原报修人用真实 Cookie／CSRF POST `STILL_UNRESOLVED` 同单重开，未用管理员 reopen 替代；内部备注不外发。外部身份／SDK 合成，DB／HTTP／业务／认证 Session 为真实实现，证据始终 `production_ready:false`。

相关11入口均在 `tests/`：`p2-016-live-harness.test.mjs`、`p2-016-workbench-auth.integration.test.mjs`、`p2-g1-human-only-assembly.integration.test.mjs`、`p2-012-process-assembly.integration.test.mjs`、`conversation-inbox-contract.test.mts`、`conversation-inbox.integration.test.mts`、`conversation-rule-admission.integration.test.mts`、`t20-feedback-defaults.integration.test.mts`、`t21-bot-defaults-contract.integration.test.mts`、`t25-runtime-app-composition.integration.test.mts`、`t26-group-message-push-sender.integration.test.mts`。这是相关子集，不称 v3-p09 全集或 full/certify。

最终候选只构建一次，两个业务集合直接复用 `runSelection`。开发期间共5次构建，其中1次误用 CLI 自动重复构建，其余为修补后不同候选。早期 strict、启动、观察和诊断原件均保留：

- `tests-candidate-1`：4配置 PASS；角色只留下泛化错误，另有子入口覆盖观察缺失，不能断言具体业务根因。
- `tests-candidate-2`：精确 YXX_ENTRY_CONFIG_INVALID，沿现有 H5 合同定位到委托映射依赖并前置校验。
- `tests-candidate-3`：真实认证／bootstrap已过，收件箱因未使用参数 `$5` 返回500，为实际业务 RED。
- `diagnostic-*`：临时编译诊断验证修补；夹具未受理、已有会话要求复合接单、非既有确定性 Web 文案等测试准备失败保留。临时文件恢复并核对后才正常构建最终候选；诊断 GREEN 不冒充正式候选。
- `artifact-candidate-1.log`：误触发重建期间清单暂不存在的 ENOENT，保留观察时点失败，最终独立校验另列。

## 复用与停止线

分支 `codex/workbench-runtime-wiring`；源码仍未提交。制品位于 `D:/Projects/Fault-Reporting-WeCom-Assistant/.build/runtime`，清单为其 `build-manifest.json`。报告原件位于上述根目录的 `tests-final/`、`related-final/`；`run-registered.mjs` 调用现有注册 runner 导出函数，可用新的空报告目录和新的任务自有 PG 环境复用，无需重复构建。

本轮 PG／认证 Session／浏览器均关闭；测试库、自有 PG 数据和临时目录已删。旧制品、全部失败和历史证据保留。下一项继续完整人工运行旅程及组合／失败恢复矩阵；真实身份、当前目标／群提及对应、Provider 客户端效果和现场配置仍需实际证据与授权。本轮无遗留已知接线阻塞。

真实企微发送、真实外部身份／目录、现场库迁移／写入、部署、手动 full／certify、业务 Gate、push／PR／merge：**NOT_RUN**。关闭方式沿运行手册，不删除业务事实、UNKNOWN、回执或历史证据。本地交付后停止。
