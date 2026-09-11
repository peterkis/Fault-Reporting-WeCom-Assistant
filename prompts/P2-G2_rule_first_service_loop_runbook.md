# P2-G2 AI-off 完整服务闭环现场手册

本手册供当前候选达到 READY_FOR_LIVE_E2E 后、负责人另行批准的现场使用。准备回归、Mock SDK ACK、开发机浏览器结果不构成真实企业微信客户端确认。当前现场结果为 NOT_RUN。最终候选与回归索引见 evidence/p2-g2-automated-readiness-report.json；该文件缺失、状态非 READY 或校验失败时停止。

## 1. 一次准备完整许可

负责人需确认专用测试 Bot、群、至少三个 Reporter、两个坐席及 ADMIN、完整 2C4G 目标、HTTPS origin、空隔离业务库、运行时段、故障清单和发送总预算。显式 Reporter hash 或批准群来源允许入站；PERSON 出站仍要求同身份、同 Bot、同 Journey 且保留期内的 Direct Leg。群结单使用已批准群 Webhook 路由，不以私人通知替代。

在批准主机保存私有 env 和 manifest；不得覆盖 .env.pilot。manifest 遵守 contracts/p2_g2_validation_manifest.schema.json，运行配置语义以 config_examples/p2-g2-validation-policy.example.json 为准。默认文件全部 false；仅在该 manifest 中开启 required_runtime_flags，forbidden_runtime_flags 全部 false。设置 mode=live、新 run_id、当前 candidate_fingerprint、有效 epoch 时段、身份 hash、库标识 hash、principal_ids、固定测试前缀/文案、Webhook 路由 hash、预算及允许故障。没有显式启用 member_directory 时身份目录为 DEFERRED，不虚构科室/姓名/电话。

只读计算接口：src/p2-g2-candidate.mjs 的 g2CandidateInventory / g2ApprovalScopeHash，src/p2-g2-validation-config.mjs 的 g2DatabaseIdentity，src/p2-g2-evidence-files.mjs 的 g2SourceBinding。后者返回 run_id、candidate_fingerprint、run_mode 和完整 manifest_binding；不要对未经 validateG2Manifest 规范化的 JSON 直接计算替代 hash。

负责人提供 evidence/p2-g2-live-start-approval-<run>.md，包含 P2-G2、PROJECT_OWNER、run_id、candidate_fingerprint 及单独一行 `manifest_scope_sha256: <g2ApprovalScopeHash结果>`；manifest 的 approval.source_ref/source_sha256 绑定该原文件。批准文件由负责人提供，工具不生成肯定批准。预算初始化也要求此文件和当前 READY 证据。

空业务库须已按独立数据库准备授权完成现有001–032迁移和测试坐席配置；现场工具不会迁移。批准配置库不能当作临时测试库。迁移命令、库创建和凭据配置均不包含在下面的启动流程中。

## 2. PowerShell 离线核验

在实际运行主机仓库目录执行。Windows开发机执行全仓合成回归（现有浏览器harness依赖Windows Edge/Chrome）。Linux正式2C4G目标可在安装了PowerShell 7时执行下面的现场命令；Linux绝对路径必须使用目标主机实际路径。不要在Linux运行当前full浏览器suite并假定支持。

```powershell
$ErrorActionPreference = 'Stop'
function Assert-G2Exit { if ($LASTEXITCODE -ne 0) { throw "P2-G2 command failed: $LASTEXITCODE" } }
node --version
Assert-G2Exit
npm run p2:g2:check
Assert-G2Exit
node scripts/validate-p2-g2-service-loop.mjs --require-ready
Assert-G2Exit
node scripts/p2-g2-live-e2e.mjs --help
Assert-G2Exit
node scripts/p2-g2-evaluate.mjs --help
Assert-G2Exit
```

Node 必须 >=24 <25。需要重做启动前自动化时执行 `node scripts/p2-g2-synthetic-e2e.mjs --suite=full --env-file=<本地主机测试库私有env>`；受检runner只接受回环数据库，创建自有隔离库，最小环境移除模型Key并使用 --expose-gc。输出实际 tmp/p2-g2-tests-<uuid>/run.json/result.tap/stderr.txt，不能手改失败日志。正式业务进程不带 --expose-gc。启动前及现场后full回归在受支持Windows测试主机、同一未改动候选上执行；把实际 tmp/p2-g2-tests-<uuid> 目录原样复制到判定主机相同仓库相对路径，保留run.directory及所有原文件SHA256，核对两端candidate fingerprint相同。不得重写run的Node/OS/epoch为Linux。启动批准时段须覆盖现场、最终回归、人工审核和证据编译，不能只预留64分钟。

## 3. 许可后的只读检查和启动

下面路径是操作模板；填写本次已批准文件，不把示例当许可。$g2RunDir 必须是全新 tmp/p2-g2-小写字母数字连字符目录，budget-file 必须绝对路径。

```powershell
$g2Manifest = 'tmp/p2-g2-approved-run/manifest.json'
$g2PrivateEnv = 'tmp/p2-g2-approved-run/private.env'
$g2RunDir = 'tmp/p2-g2-observation-run'
$g2Budget = Join-Path (Get-Location) "$g2RunDir/send-budget.jsonl"
$g2ProxyPidFile = 'tmp/p2-g2-approved-run/proxy.pid'
$g2LatencyFile = 'tmp/p2-g2-approved-run/client-latency.json'
$env:P2_G2_LIVE_TEST_APPROVED = 'true'
$env:P2_G2_TEST_SCOPE_CONFIGURED = 'true'
$env:P2_G2_REAL_WECOM_SEND_APPROVED = 'true'
$env:P2_G2_INCIDENT_PUBLIC_NOTICE_APPROVED = 'true'
$env:P2_G2_INCIDENT_PRIVATE_NOTICE_APPROVED = 'true'
node scripts/p2-g2-check.mjs --mode=live-check "--manifest=$g2Manifest" "--env-file=$g2PrivateEnv"
Assert-G2Exit
node scripts/p2-g2-live-e2e.mjs --mode=initialize-budget "--manifest=$g2Manifest" "--env-file=$g2PrivateEnv" "--budget-file=$g2Budget"
Assert-G2Exit
node scripts/p2-g2-live-e2e.mjs --mode=live "--manifest=$g2Manifest" "--env-file=$g2PrivateEnv" "--budget-file=$g2Budget" "--proxy-pid-file=$g2ProxyPidFile" "--client-latency-file=$g2LatencyFile" --duration-ms=3840000 --interactive=true
Assert-G2Exit
```

live-check 开始前检查完整候选、启动批准和五个临时许可；只读SQL，不启动SDK/监听。正式启动再核对本机CPU/内存、PostgreSQL和代理RSS。主机不满足整栈2C4G即拒绝；开发机heap不能替代。

启动前创建客户端延迟测量文件：`{"run_id":"<本run>","candidate_fingerprint":"<当前指纹>","measurement_kind":"CLIENT_RENDER_OBSERVED","samples_ms":[]}`。空数组表示尚未测量；不得填假数。现场观察人使用同一设备单调计时记录从操作提交到对应客户端完整呈现的实际毫秒耗时，追加到samples_ms，并保留测量依据；采用临时文件原子替换，避免采样读到半写JSON。最多10000个值；正式结束前须有真实样本，零样本不能PASS，不能事后改写已生成资源记录。

控制台出现 LIVE_ROLES_READY 后再开始场景操作。本run的 sessions.private.json 含合成坐席会话，按私有凭据处理，不输出、不入Git。资源每15秒采样，App/Worker/Gateway池4/2/1，加控制器1连接。模型网络拒绝与批准WSS/HTTPS/数据库网络分别验证。运行64分钟是为60分钟有效观察留余量；启动、停机、缺样/休眠和无业务活动不能自动算有效时长。

## 4. 操作、故障、观察和停止

按 tests/fixtures/p2-g2/scenarios.v1.jsonl 与 evidence/p2-g2-scenario-matrix.json 逐项执行。三入口包含群内直接报修、群转私聊、首次自然单聊。测试内容带批准的测试前缀；两次明确新故障不得合并，普通补充不另开单。群内可完成既有流程，不强迫所有人转私聊。默认私人进度仅受理/结单，其他事件须在 manifest 明确 opt-in。

使用真实坐席/Reporter页面完成 Review、Ticket全部动作、双责任和 Incident人工确认/link/unlink/单人恢复/整体恢复。三个Reporter产生候选必须来自正常入站；不seed Ticket/Candidate。内部Note只在内部可见。保留原始Decision、每次人类命令和独立个人Ticket。Incident单人恢复后、其他人仍受影响时立即输入 `capture:G2-I03` 保存中间事实；不要等整体恢复后再试图重建该证据。

在运行控制台输入以下已支持命令（仅manifest允许的故障可执行）：

```text
status
capture:G2-I03
fault:G2-F02:WORKER:stop
fault:G2-F02:WORKER:restart
fault:G2-F01:GATEWAY:disconnect
fault:G2-F01:GATEWAY:reconnect
stop
```

F01断开后提交一条批准的通知事件，等待该Delivery出现 GATEWAY_UNAVAILABLE / RETRY_SCHEDULED，再重连并核对同Delivery数值ACK。Worker故障与Gateway故障分开操作，保留control-sources.jsonl。未知副作用只在本地Mock注入；现场UNKNOWN按既有显式核对操作处理，不能盲发。任何安全异常停止外发，保留已提交事实。

另一终端只读查看最近样本：

```powershell
node scripts/p2-g2-resource-observation.mjs --mode=observe "--manifest=$g2Manifest" "--run-directory=$g2RunDir"
Assert-G2Exit
```

正常结束前停止新入站、完成审核及通知核对，至少五个连续STEADY样本队列为零。输入stop或达到时长会停本run角色。非交互模式可在本run目录创建空 stop.request；不要killall或结束他人PID。只有 STOPPED_AWAITING_RECONCILIATION/process_count=0 才执行：

```powershell
node scripts/p2-g2-reconcile.mjs --mode=reconcile "--manifest=$g2Manifest" "--env-file=$g2PrivateEnv" "--run-directory=$g2RunDir" --output=reconciliation-source.json
Assert-G2Exit
```

该命令使用一个只读可重复读事务，输出业务计数、脱敏事件/投递/尝试关联，不改状态、不重试、不DROP库。已有输出拒绝覆盖，可换新的 reconciliation-source-后缀.json。

## 5. 源文件与证据编译

所有源引用写 `{ref: 相对路径, sha256: 原文件SHA256}`，文件仅允许 evidence/p2-g2-* 或 tmp/p2-g2-*/...，禁止符号链接和路径穿越。control单条引用为带行号的ref和对应JSONL单行（不含换行）的SHA256，遵守 readG2PacketSource。JSON输出write-once。以下只描述格式，不预制现场成功文件。

| 文件 | 必需内容 |
|---|---|
| test-proof-startup.json / test-proof-end.json | schema_version=1、kind=G2_TEST_PROOF、run_id、candidate_fingerprint、phase=STARTUP/END、run指向实际全仓run.json的ref/hash |
| delivery-proof-场景.json | schema_version=1、kind=G2_DELIVERY_PROOF、run_id、candidate_fingerprint、scenario_id、snapshot/startup的ref/hash、receipts数组指向provider-receipts.jsonl及需要的webhook-receipts.jsonl、delivery_ref_hashes数组 |
| G2-N03 delivery proof | 另含 synthetic_fault_basis 指向当前候选实际Mock测试proof；禁止声称真实WeCom已出现未知副作用 |
| G2-F01 delivery proof | 另含 controls 两条断开/恢复packet引用；数据库尝试必须位于断开窗口且之后同Delivery收到ACK |
| finalization-proof-run.json | schema_version=1、kind=G2_FINALIZATION_PROOF、run_id、candidate_fingerprint、snapshot/stop/startup/resources的ref/hash；browser_cleanup可选，但缺失则CLEANUP为INCOMPLETE |
| browser cleanup assertion | kind=G2_BROWSER_CLEANUP_ASSERTION、authority=CLIENT_OBSERVER、完整g2SourceBinding、physical_epoch_ms、owned_profile_count、remaining_owned_profiles、browser_profiles_removed，必须来自实际清理核对 |
| 人工观察/批准源JSON | 精确字段schema_version、kind=G2_MANUAL_ASSERTION、完整g2SourceBinding、scenario_id、evidence_type、authority、physical_epoch_ms、result、details、fragments数组 |

人工客户端源 evidence_type=CLIENT_OBSERVATION、authority=CLIENT_OBSERVER，至少一个已保留png/jpg/jpeg/txt/json片段ref/hash；details须包含实际 executed:true、client_display_confirmed、client_fragment_preserved。E07另记录manual_review_handled；I01另记录incident_confirmed。负责人最终源为 PROJECT_OWNER_APPROVAL / PROJECT_OWNER / G2-OWNER，details.executed为true，details.owner_approved只在确实批准后填写；fragments仍是必填数组，可为空。源内容由观察人/负责人提供；不得以Provider ACK复制这些字段。

编译命令示例：

```powershell
node scripts/p2-g2-evaluate.mjs --mode=automation "--manifest=$g2Manifest" "--source=$g2RunDir/test-proof-startup.json" "--output=$g2RunDir/automation-evidence.jsonl"
Assert-G2Exit
node scripts/p2-g2-evaluate.mjs --mode=receipts "--manifest=$g2Manifest" "--source=$g2RunDir/delivery-proof-e01.json" "--output=$g2RunDir/receipt-e01.jsonl"
Assert-G2Exit
node scripts/p2-g2-evaluate.mjs --mode=attest "--manifest=$g2Manifest" "--source=$g2RunDir/client-e01.json" --authority=client "--output=$g2RunDir/client-e01-evidence.jsonl"
Assert-G2Exit
node scripts/p2-g2-evaluate.mjs --mode=finalize "--manifest=$g2Manifest" "--source=$g2RunDir/finalization-proof-run.json" "--output=$g2RunDir/finalization-evidence.jsonl"
Assert-G2Exit
```

逐场景选择实际匹配的Delivery，不能将任意ACK重标为另一个场景。I03使用捕获的中间snapshot。automation输出仍标synthetic。最终full回归生成新的END test proof；负责人审核全部源文件、回归、清理后提供最终批准，再用attest --authority=owner编译。此顺序不能颠倒。

将同run各场景证据作为独立文件传入，最多64个stream；禁止拼接独立hash链或重算人工证明。streams包含startup-evidence、resource-evidence、automation、全部receipt、client、finalization、END回归和owner证据。运行：

```powershell
$g2BaseStreams = @("$g2RunDir/startup-evidence.jsonl", "$g2RunDir/resource-evidence.jsonl", "$g2RunDir/automation-evidence.jsonl", "$g2RunDir/finalization-evidence.jsonl", "$g2RunDir/end-automation-evidence.jsonl", "$g2RunDir/owner-evidence.jsonl")
$g2ScenarioStreams = Get-ChildItem -LiteralPath $g2RunDir -File | Where-Object { $_.Name -match '^(receipt-[a-z0-9-]+|client-[a-z0-9-]+-evidence)\.jsonl$' } | Sort-Object Name | ForEach-Object { "$g2RunDir/$($_.Name)" }
$g2Streams = (@($g2BaseStreams) + @($g2ScenarioStreams)) -join ','
node scripts/p2-g2-evaluate.mjs --mode=evaluate "--manifest=$g2Manifest" "--streams=$g2Streams" --output=evidence/p2-g2-gate-result-run.json
Assert-G2Exit
```

INCOMPLETE/BLOCKED退出1并列出缺项；不修改它为PASS。判定器验证源文件、候选、真实入口/审核/Incident、ACK和客户端分账、有效60分钟、整栈2C4G、最终回归及负责人批准。工具不修改治理状态或提交。最终关闭提交须另行按原Gate授权流程执行。

## 6. 结束边界

移除本shell的五个临时批准变量，核对本run角色/池/SSE/浏览器profile。只清理明确owned路径/PID；自动审批拒绝的目录不绕过。运行残留与保留证据分别记录。现场业务库只在另有明确可销毁授权且证据完备时删除。持久Flag始终false；P2-008、P2整体GO、生产上线、push/PR/merge/tag/release不由本手册授权。
