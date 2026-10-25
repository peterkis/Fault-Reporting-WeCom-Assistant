# 后端迁移至 `app/server`：候选 05 本地迁移与验证记录

日期：2026-10-23—2026-10-24（Asia/Shanghai）。当前被测对象为同一候选05。主741已全部执行，保留712通过入口／29失败入口和全部首次原件，整体REVIEW_REQUIRED；16组单次双侧对照及自有服务清理已完成，源码迁移与本地验证执行收口；保留所有失败，不代表无保留验收通过或生产就绪。2026-10-24 用户明确要求完成剩余对照、文档及资源收口，保留所有失败，继续只使用 D 盘。证据根 `D:\worktrees\server-app-layout-validation-20261023`，以下文件相对此目录。

导航：[应用整理总表](README.md)、[应用目录](../../app/README.md)、[ADR-0044](../../adr/0044_server_application_layout_and_logical_source_identity.md)。

## 1. 基线、候选和授权

继续同一隔离工作树 `D:\worktrees\pc-admin-app-layout\Fault-Reporting-WeCom-Assistant`、分支 `codex/pc-admin-app-layout`、HEAD `d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f`，保留已完成 PC／H5／Reporter 及其未提交成果。被测对象为 HEAD 加当前差异；主工作区 `D:\Projects\Fault-Reporting-WeCom-Assistant` 不参与迁移。

| 身份 | SHA256／数量 |
| --- | --- |
| 迁移前 manifest | `6592ef7e27e75e16ea6e7fbe44e8e4b9881aad5982b53152a4addc0e861bb49f` |
| 迁移前构建输入 | `e6a60fff98eba5c5fcc4f1ffbbcde2f7db7e88d5c82720245276af9d09ac33e4` |
| 候选 05 manifest | `37b1671d4ce7936fd91b559fba0f2f162015d1b5e150d4342832aa3c7995d44d` |
| 候选 05 构建输入 | `153ec2acbd1266b7d224dd5a220e3f5ec7762c2ceeea3969f260532b72c3e0f9` |
| G2 源身份指纹 | `d5172d3eb64c85f0deeb65f0f7ce31250ac30ff011b1cbb8507cd7808623263c` |
| 当前清单／原上限 | 2011／2048 |

迁移前完整源码、Git 差异、382 项映射和运行树已独立保全并核验哈希，见 `baseline-source/`、`baseline-source-inventory.json`、`file-mapping.json` 及基线冻结原件，不覆盖 PC、H5 前两步证据。当前证明见 `final-05-proof.json`。

本轮仅本地实现与合成验证：不提交、推送、PR、合并、部署、真实发送、现场业务写库或推进 Gate；P2-G2-LIVE、P2-008 停止线保持，P2-G3／P3 不自动启动。不另行运行大库性能、全仓 full、current／historical certify。用户已确认保留既有失败、T18／T21首次FAIL及同05各一次PASS复核、工具360秒超时与rename NOT_RUN，继续全部741并单独报告；不扩业务／性能修复，不改合同、断言或门槛来换取通过。

## 2. 归属、输出和必要接线

按 Accepted ADR-0044 实施 382 个原文件唯一映射：265 个后端文件归入 `app/server/src`，105 个脚本归入 `app/server/scripts`，三个纯共享模块归根 `shared`，八个 PC 浏览器合同归 `app/pc-admin/src/contracts`，实时客户端归 `app/pc-admin/src/realtime`。旧根 `src`／`scripts` 不存在，无重复实现、链接或兼容跳板；已退役的 Bot 静态桥不重新加入。

三个共享文件为 `workbench-search-contracts.mts`、`workbench-web-report-browser-contracts.mts`、`workbench-incident-delivery-authority.mts`；PC 九项完整归属见 `file-mapping-final-05.json`，实时客户端仍为 `workbench-realtime-client.mts`。继续复用单一实现、原导出及业务合同，不拆共享 npm 包。根 `contracts`、`tests`、`tools`、SQL、配置样例、文档及 Evidence 保持归属；公共声明五处类型导入只改路径。

根统一编译按原生目录输出 `.build/emit/app/server/...`／`.build/runtime/app/server/...` 和共享／PC纯模块对应目录；九个PC `.mts` 纳入strict及遗漏检查。React／TSX管线、PC／H5资产位置、根依赖／锁文件和命令合同保持，无workspaces／升级；79个legacy MJS保留扩展名并原字节复制。

manifest／G2用物理路径，T00豁免、禁止MJS回退、固定历史checkout／REF／tested_head／命令守原逻辑合同。映射拒绝伪造豁免、重复／遗漏模块、旧根、父级链接和共享Node依赖；含ImportEquals负例／type-only正例。

资源／动态导入／`import.meta.url`／子进程cwd及角色接线修正，缺失失败关闭、无源码回退。CI不改触发／权限／full／certify；三份源码shell原字节保持且不入runtime，语法2＋1退出0、实际操作false，见 `final-05-shell-syntax.json`。私有配置原位不读取／复制；API／DTO／Schema／认证／默认开关／数据库不变。

## 3. 完整性、编译与预算

`source-audit-05.json`、`file-mapping-final-05.json` 证明：382 项中 183 项原字节、173 项 canonical 仅路径变化、26 项人工核查。`manual-review-05-receipt.json` 将 26 项审阅按完全相同目标哈希绑定候选 04 的审阅回执及 `review-backend-delta-04-normalized.patch`；13 项当前 help 前缀修正见 `candidate04-help-path-fix.json`，无新增业务语义。不能沿用候选 03 的旧分类。

| 受保护对象 | 数量 | 结果 |
| --- | ---: | --- |
| SQL／Schema | 49／259 | 原字节保持，变更 0 |
| 固定设计／原型 | 22／19 | 原字节保持，变更 0 |
| 历史 Evidence／既有 ADR | 7740／43 | 原字节保持，变更 0 |
| 固定政策及锁文件 | 5 | 变更 0，依赖保持 |
| 字体／图片 | 31 | `protected-fonts-images.json` 已核验保持 |
| PC／H5 正式资产 | 117 | 候选 05 与基线逐字节相同 |

候选 05 统一构建退出 0；活动 selection strict、PC 和 H5 独立 typecheck 均退出 0。原件为 `build-final-05-result.json`、`final-05-types-result.json`、`final-05-pc-admin-typecheck-result.json`、`final-05-h5-typecheck-result.json`。完整 2642 文件运行树已冻结并核验，见 `final-05-runtime/`、`final-05-runtime-inventory.json`；构建后不再 bootstrap。`final-05-frozen-audit.json` 核查 4796 条运行导入，无意外缺失；417 项运行资源仅四份声明导入和根包命令接线有差异，49 份 SQL 保持。两条原有条件 SOURCE_HOST 加载边按原宿主执行。

`frozen-runtime-final-audit-05.json` 在正式回归后重新核验基线及final-05两份完整冻结运行树，各2642文件，文件集合与全部哈希一致，状态PASS；修改／删除／私有文件读取均0，未改当前runtime或源码。此项证明保全完整性，不代表业务回归通过。

H5 gzip 实测启动图 112071、最大路由 122848、独立预绘制 408 字节；原预算分别为 122880／122880／2048，最大路由余 32 字节。117 项前端输出与基线相同，无分块差异；见 `final-05-frontend-comparison.json`。页面 base、资产地址、开发代理、G2 上限及 Vite 文件访问限制保持，没有混入性能或业务改造。

## 4. 全部注册回归与最终工具结果

候选05的 `registered-final-05/` 与 `registered-final-05-resumed-01/` 已完成全部注册回归。同候选恢复承接和原未汇总批次的重新执行均保留origin／raw来源并去重，不复用候选01–04数量。`registered-final-05-final-summary.json` 与逐项CSV最终证明741个唯一且实际加载执行的入口，原phase的not_run为空；资源要求数据库605／浏览器267可以重叠。

原runSelection／testEnvironment／verifyArtifact、宿主／flags／超时／隔离保持；最多12项仅合并相同资源元组并断言环境相同。外置续跑修正结果路径定位、保留origin，无候选改动或bootstrap。原件见05 binding、两个phase及 `resume-candidate05-d-only-20261023-1857.md`；checkpoint状态按后继记录读取。

最终正式注册结果绑定同一manifest/source，诊断与工具另计：

| 项目 | 最终实际结果 |
| --- | --- |
| 唯一注册／实际观测入口 | 741／741 |
| 入口结果 | 712 PASS／29 FAIL，NOT_RUN 0 |
| 用例结果 | 2841项，2802 PASS／39 FAIL |
| CANCELLED／SKIP／TODO | 0／0／0 |
| 宿主 | SOURCE_HOST 13／STAGED_RUNTIME 713／MIXED_EXPLICIT_ROOTS 15 |
| 旧候选入口复用 | 0 |

逐项路径、flags、完整执行身份、timeout、origin、raw/TAP及失败case在 `registered-final-05-final-summary.json`、`registered-final-05-entry-results.csv`。入口全部执行不表示失败case的后续断言已到达，也不抹除工具rename的独立NOT_RUN或独立列出的对照诊断。关键覆盖的正式派生绑定与截图来源见第6节，不再用先前中途统计替代最终结果。

`tools-final-05-derived-summary.json`逐组绑定TAP／哈希，前8组来自 `tools-final-05/`，后4组来自 `tools-final-05-resumed-01/`，旧候选复用0：

| 工具 | 实际测试点 | PASS | FAIL | 退出 |
| --- | ---: | ---: | ---: | ---: |
| backend-layout | 11 | 11 | 0 | 0 |
| tooling | 32 | 32 | 0 | 0 |
| Hosts | 27 | 27 | 0 | 0 |
| H5 | 13 | 13 | 0 | 0 |
| H5 performance | 6 | 6 | 0 | 0 |
| H5 resource budget | 16 | 16 | 0 | 0 |
| T02 expiry | 5 | 5 | 0 | 0 |
| agent docs | 19 | 19 | 0 | 0 |
| batches | 14 | 12 | 2 | 1 |
| acceptance | 7 | 1 | 6 | 1 |
| publication | 9 | 9 | 0 | 0 |
| t40 screenshot archive | 3 | 3 | 0 | 0 |
| 合计 | 162 | 154 | 8 | 1 |

TAP取消／跳过／TODO为0，另有未执行项。acceptance6失败同基线，case4逐字相同、无ENOENT。batches无参 `npm run migration:gate` 在原360000ms触发 `spawnSync cmd.exe ETIMEDOUT`，子项／父项合计2 FAIL。rename另列 **NOT_RUN**，迟到canary PASS不替代超时；见 `tools05-noargs-timeout-readonly-audit.json`，未提限／改断言／重试。

工具副本无私有复制／主源码写入；自有进程／监听0、共享PG未触动、日志保留，见汇总resources，不替代总清理。输入再变即换候选重跑741，不拼接数量。

## 5. 失败分类、诊断及范围决定

按用户在2026-10-24明确的范围决定，完成全部741与剩余对照、文档及资源收口，保留所有首次失败，不扩业务／性能修复。以下证明与最终05实际失败逐项匹配；未匹配项不归为旧失败。

| 对象 | 已确认事实与证据 |
| --- | --- |
| readiness／scope／evidence／history | 49份SQL与固定22份readiness合同冲突；`baseline-counterfactual/`、`baseline-counterfactual-extra/`重现。 |
| current migrations | `baseline-current-migrations-counterfactual/`重现1 FAIL／CURRENT_SCOPE_INVALID，在隔离库帮助器调用前拒绝。 |
| readiness CLI | 基线2 FAIL，另2个stderr空断言在相同intent-to-add／显式根下重现Git LF提示；见 `baseline-cli-intent-index-warning-paired-roots.tap`。 |
| ARCH005／ARCH006／realtime | 时间排序检查、原4项ARCH006诊断、realtime两项有基线对照；见基线回归、`baseline-arch005-counterfactual.json`、`final-04-arch006-comparison-result.json`。 |
| acceptance | 220／221旧清单与741不符；05恢复基线7项1 PASS／6 FAIL，详见最终工具汇总。 |
| T29 | 旧基线首次自然复现相同快照断言；UUID归一后错误及expected/actual相同。见 `t29-baseline-isolated-diagnostic/`；诊断PG52475已清理。 |
| P2-012 incident | 基线4项3 PASS／1 FAIL，disabled假pool缺connect导致原构造拒绝；见 `baseline-p2012-incident-counterfactual/`。52474 lease已归还。 |

新增T18／T21：`tests/t18-verified-summary.integration.test.mts`、`tests/t21-bot-round-idempotency.integration.test.mts`原各1 FAIL；旧基线与同05各一次原模式复核均PASS。原件 `baseline-t18-t21-natural-01/`、`candidate05-t18-t21-natural-01/` 均不计741、不替换FAIL或追加轮次。05 host／flags／240秒／UUID隔离保持，源／运行SHA及322／344项加载哈希相同；无日志注入／fixture修改，PG租约已归还。

这些PASS只证明本次未复现，不证明旧基线复现原失败、具体原因已定位或缺陷已修。T18同窗口有thread投影死锁，但原failure条目缺完整code／PID绑定；T21只保存HTTP409状态，原响应body／拒绝码未知。`pg-window-failure-05.*`是窄窗口观察；`baseline-t18-t21-natural-01/static-thread-paths.json`证明3个调度模块运行原字节保持，timeline-projector仅011资源路径精确映射后相同；`t21-409-static-05.*`只枚举可能409分支，不认定本次具体原因。历史报告“未执行复核”等时点叙述保留，由新比较记录承接。

### 尚未归因的新增失败：原FAIL和未到达断言均保留

以下是各入口已终止的原始结果，不是741最终总数。精确入口、case、SHA及原raw/TAP/截图路径在同名前缀的 `*-static-05.json` 中，Markdown承接人工阅读。各静态记录产出时保持 **NEW_NOT_ATTRIBUTED**，不并入T18／T21已有范围决定。正式回归后的16项单次原模式对照已完成；最终分类见下节，不回写下表首次观察。

| 入口／原用例结果 | 首次失败观察 | 尚未到达／不能外推的断言 | 静态证据前缀 |
| --- | --- | --- | --- |
| T17 `wbint-t17-manual-risks`，17项16 PASS／1 FAIL | case8观察查询在pg-pool等待client时timeout；不是ECONNREFUSED证明 | 尚未降权，最终503／P2_016_FORBIDDEN未执行；同窗LOCK_TIMEOUT未与客户端异常绑定，缺瞬时池占用快照，不指定后台任务或池耗尽为原因 | `t17-pool-timeout-static-05` |
| T41 `t41-search-acceptance`，4项3 PASS／1 FAIL | case2刚执行runOnce的CHANNEL_MESSAGE_INBOX 15 scanned／14 inserted，1项通用投影存储失败 | handling／unassigned搜索已过，takeover／follow／supplement／schedule未到达；同窗死锁无原错误/PID绑定，不认定调度重叠或根因 | `t41-projection-static-05` |
| T12 `t12-late-and-confirmation`，4项2 PASS／2 FAIL | late-post／late-ack的refresh-completion selector=null，click TypeError；现有图为会话失效授权页 | 已有CLOSED/version+2、原UUID及直接bootstrap401断言；延迟释放后的最终隐私、空草稿和计数未执行，截图无私文不等于后续PASS | `t12-late-confirmation-static-05` |
| T12 `t12-raw-off-unknown`，1项0 PASS／1 FAIL | 已认证工作台的legacy refresh selector=null；与late/principal401画面不同 | 单POST／UNKNOWN／CLOSED/version+2／commitment=1已过，刷新后capture/check、防重复POST与最终持久事实未到达，不能合并上述两个FAIL | `t12-raw-off-static-05` |
| T35 `t35-read-denial-scope`，1项0 PASS／1 FAIL | 降权前等待held==1超时；原件held=2、receipts空，两个真实read-position COMMIT | 尚未降权、Review404／另一Item200、重键清理及恢复保留均未执行；两次held请求精确归属未知 | `t35-read-denial-static-05` |
| T35 `t35-late-read-success`，2项1 PASS／1 FAIL | SOURCE通过、SESSION在切换前期望cursor1实际2；唯一POST与200回执均为2，原图两条材料可见 | B cookie未安装，迟到body释放／新账号scope fence未执行；当前组件取最高可读sequence的静态代码相同，不替代自然基线对照 | `t35-session-cursor-static-05` |
| T35 `t35-session-unknown`，1项0 PASS／1 FAIL | 首POST body.last_read_sequence期望1实际2，唯一真实COMMIT=2、current_checks空 | foreground重核、GET UNKNOWN、防重复坐标与其他主体／Session／Source不变断言未执行，不能称UNKNOWN恢复或服务端越界已被证明失败 | `t35-session-unknown-static-05` |
| P2-G2 `p2-g2-process-assembly`，1项0 PASS／1 FAIL | Gateway重连authenticated=true、health200之后，兼容页等“已发送”超时 | 三角色／pool4/2/1／worker ready／环境／受控故障／PENDING退避已越过；SDK恰+1、唯一通知／对账和后续业务未执行，不能称恢复投递完成 | `p2-g2-process-assembly-static-05` |
| SS007 `yxx-ss-007-native-ui`，53项52 PASS／1 FAIL | case32等待确切提示“服务暂时不可用”约32.3秒超时；整入口预算900000ms、case自身60000ms，非900s宿主超时 | commandCalls=0、21条记录未变、释放slot后提交未执行；无原失败快照，不能倒推页面／时序。显式退役V1，不作新H5 bundle验收 | `ss007-native-quota-static-05` |
| SS008 `yxx-ss-008-assembly`，7项6 PASS／1 FAIL | case4 GET `/wecom/yixiaoxiu/` 预期200实际503，不是catalog API或validation-scope失败 | 未传h5/runtime/presentation的静态default-off链使h5Static=null、成员校验后503“新版页面尚未启用”，不调用静态加载器；直接assembly基线once未执行，不能据字节链替代自然复现或更改默认开关 | `ss008-assembly-root503-static-05` |
| T30 `wbint-t30-internal-note`，1项0 PASS／1 FAIL | 提交显示及真实GET items=1已过，随后DOM历史断言false；catch较晚截图已含原文/script文字 | script节点禁止、横向溢出、成功双尺寸截图断言未到达；晚截图不覆盖原false。原runner screenshot_artifacts为空，D临时失败附件单列，不写回metadata或增加归档数 | `t30-internal-note-static-05` |
| T29 `wbint-t29-purpose-loss`，2项1 PASS／1 FAIL | case1等浏览器hook记录owner-transfer-targets403超时；Node bootstrap／Incident200、targets403及刷新已越过；case2 late200通过 | 仅清owner输入、一般Session／Incident保持、0POST与row_version1未执行；目的失权晚截图不补原断言，也不并入旧owner-transfer HTTP快照失败 | `t29-purpose-loss-static-05` |
| T41 `t41-search-pending-hint`，2项1 PASS／1 FAIL | initial通过；reset点击侧栏搜索后等预热目标article超时，realtime已live | holdNext、刷新held response、权限转移、hint／旧响应隔离和自动POST等尚未执行，不能称hint fence失效；原test／runner无失败截图，缺口保留 | `t41-search-pending-hint-static-05` |
| T40 `wbint-t40-reminder-preferences`，2项1 PASS／1 FAIL | case2等main tab观察两项新report超时；真实server reminders200含两项，main observer仅第二项，peer两项可见 | 后续peer.wait、合并tone计数／同ID集／断网重连不重放未执行；observer不证明物理声音或OS送达 | `t40-reminder-preferences-static-05` |
| T42 `wbint-t42-board-review`，1项0 PASS／1 FAIL | 等resolve-and-start-review按钮节点超时；此前600px对话框、材料、版本／hash及board intent已过 | 默认禁用／无隐式write、人工选择、原子start及正式移动未到达，不能称原子写命令失败；原1920归档图保留 | `t42-board-review-static-05` |
| `human-workbench-process`，4项3 PASS／1 FAIL | case3在attachInboxJourney→ensureJourney触发23514／contact_journey_due_pair_check，执行文件219行 | 尚未该case的TLS、编译parent／三角色启动或OAuth／React／SSE／feedback／Sender断言；实际due-pair值未捕获，不倒推时钟原因。case1／2／4通过、case4独立A–F闭环及stop0不替代case3 | `human-workbench-process-static-05` |

这些记录中的源码／产物相同或精确路径映射等价仅用于排除未经证明的语义变化，不构成失败自然复现。T12／T35及G2相关18份正式web资产与基线相同；G2 candidate的根／清单接线不是canonical_path_only，未混称原字节相同。P2-G2原失败未保存截图／子角色日志，原t.after已移除预算／resource临时目录，静态复核不能补造缺口；finally无追加清理异常也不替代最终资源核验。

完整16项计划与顺序在 `prepared-post741-comparisons-index-16.json/.md`。索引保留准备时点的PREPARED状态；原声明103 case／侧已由实际32次单侧原件核实。每项baseline再同05、各一次fresh报告，原mode／flags／timeout／DB／browser／TLS保持；SS007完整53 case、900000ms且非DB，不注入DB环境。中断前已完成的侧未重跑；全部额外诊断不计741，不替换原39 FAIL，也不证明根因已修。

### 单次双侧对照结果与原失败分类

全部16组／32侧完整入口已执行。旧基线与候选05各103例，均为93 PASS／10 FAIL；合计206例、186 PASS／20 FAIL，CANCELLED／SKIP／TODO均为0，32侧无遗漏。它们与主回归2841例、工具162例分别记账。逐例原件与配对分析见 `post741-pair-01-…` 至 `post741-pair-16-…`、`parallel-failure-review-05-final.json/.md`；独立核对见 `post741-independent-final-audit-05.json`，校验了32侧原宿主、完整argv、flags、cwd、超时、manifest、入口源／运行SHA及TAP／trace哈希，没有再运行测试。

| 对照入口 | 旧基线 PASS／FAIL | 候选05 PASS／FAIL | 与原主回归的关系 |
| --- | ---: | ---: | --- |
| T17 manual-risks | 17／0 | 16／1 | 原case8连接池等待失败两侧未复现；当前另一个case出现23514 |
| T41 search-acceptance | 4／0 | 4／0 | 原投影失败两侧未复现 |
| T12 late-and-confirmation | 2／2 | 2／2 | 两个同case在同click-null位置复现 |
| T12 raw-off UNKNOWN | 0／1 | 0／1 | 同click-null位置复现 |
| T35 late-read-success | 2／0 | 2／0 | 原Session序号断言两侧未复现 |
| T35 read-denial-scope | 0／1 | 0／1 | 同等待条件失败，held／receipt观察状态不同 |
| T35 session-unknown | 1／0 | 0／1 | 旧基线原case通过，当前仍为序号2／预期1；未解差异 |
| P2-G2 process-assembly | 0／1 | 1／0 | 旧基线在首次SENT等待更早失败；当前完整通过，不是原重连UI失败的基线复现 |
| SS007 native UI | 53／0 | 53／0 | 原quota提示失败两侧未复现；保留原900秒预算 |
| SS008 assembly | 6／1 | 6／1 | 同首页503／预期200在旧基线复现；未启用H5开关 |
| T30 internal-note | 1／0 | 1／0 | 原DOM文字断言两侧未复现 |
| T29 purpose-loss | 1／1 | 1／1 | 两侧失败case不同：旧侧另一case浏览器清理失败，当前仍为原scoped403等待失败 |
| T41 pending-hint | 1／1 | 2／0 | 旧基线在同初始article等待复现；当前完整通过 |
| T40 reminder-preferences | 1／1 | 1／1 | 同主tab遗漏首条／peer两条的等待阶段复现；轮询时序不宣称完全相同 |
| T42 board-review | 0／1 | 0／1 | 同按钮等待阶段复现，原子开始／正式移动未到达 |
| human-workbench process | 4／0 | 4／0 | 原due_pair夹具失败两侧未复现；该次完整进程／浏览器断言已执行 |
| 合计 | 93／10 | 93／10 | 各103例，全部原FAIL保留 |

原39个FAIL按适用证据分为：18个已有迁移前同入口主要失败复现；2个paired-index CLI上下文复现；7个本轮旧基线同case、同失败阶段复现；2个用户已决定保留的T18／T21两侧一次通过；其余6个原失败两侧一次未复现；1个T35相同等待但观察状态不同；1个P2-G2旧侧更早失败而当前一次通过；2个尚未解开的差异（T35 session-unknown、T29 purpose-loss）。总数仍为39。CLI两例的warning文件集合／全文不同，缺完整独立argv收据，不能称原因或原件完全相同；详见 `baseline-failure-match-audit-05-revision1.json/.md`。同case／阶段复现也不等于所有底层机制均已定位。

额外诊断失败单列保留：候选05 T17 case3的 `workbench_auth_session_revoked_time_check`／23514；旧基线P2-G2更早的首次SENT等待失败；旧基线T29另一个case的 `P2_006_BROWSER_PROCESS_NOT_STOPPED`。T35 read-denial原主记录held2／receipt0，旧基线对照held0／receipt1，当前对照held2／receipt1，均有两条commit，不能合称同一个已证实机制。

第12组曾只凭PG恢复回执推进了已启动的下一侧，发现浏览器清理错误后暂停后续入口。原调用自然完成后进行实际进程／profile复核，无残留且未强杀进程，再继续剩余组；首次清理FAIL、原始PID／profile未持久化的缺口及后续无残留结果分别保存在 `post741-pair12-cleanup-reaudit-receipt.json`。其余后续侧还同时检查原TAP清理错误及实际Node／Edge／HTTP／profile。`post741-final-comparison-lease-return.json` 记录最终32侧复核与资源归还；PG回执不再被视为完整浏览器清理证明。

本轮不通过修改业务、SQL、默认开关、断言或预算消除失败。未解差异与未到达断言留作后续独立范围；本文及派生报告整体保留 `REVIEW_REQUIRED`，不修改主回归、工具或历史原件。

04→05只改 `acceptance.test.mts` 四行HEAD夹具准备，复制12个routing子进程目标、原断言不变；`acceptance-layout-fix-probe-04/result.json`证明ENOENT消失、基线错误逐字恢复，`candidate04-to05-byte-comparison.json`证明2641运行输出相同。04及更早中间数量不计05；路径／scope／ImportEquals／help修正和首次失败保留于旧报告。

## 6. 关键覆盖、正式 bundle 与收口审计

原 `critical-acceptance-entry-map-05.json/.md` 的PENDING原件保持，派生 `final05-critical-binding/critical-acceptance-final-binding-05.json/.md` 已绑定20维度／16入口、同一候选及全741实际加载原件，严格核精确flags、host、cwd、完整argv、timeout及固定控制文件。结果为 **整体REVIEW_REQUIRED**：10维仅在所述边界内为REFERENCED_ENTRIES_PASS_WITHIN_DOCUMENTED_BOUNDARY，10维为REVIEW_REQUIRED_REFERENCED_ENTRY_FAILED；全29个失败入口及其中27个未映射失败完整列出，incomplete_pass_evidence为空不意味着整体PASS。

两个已映射失败入口是 `p2-g2-process-assembly` 和 `human-workbench-process`，不能沿用此前仅P2-G2四维的中途结论。需复核10维为SERVER-ROLE-ENV、SERVER-APP-READY、SERVER-WORKER-GATEWAY-READY、SERVER-IPC、SERVER-FAULT-EXIT、SERVER-FAULT-HEALTH、SERVER-CLEANUP、PC-WORKBENCH、H5-OWN-WEB-FEEDBACK、H5-OTHER-DENIAL。整入口有失败时不笼统标维度PASS；这也不自动将该维度所有业务行为判为缺陷，具体停止点及未到达断言保留在静态记录。

`final05-critical-binding/screenshot-source-index-05.json/.md` 索引注册归档321 PNG，来自138入口，内容SHA去重296；另列H5补充8 PNG，不计注册case。索引验证归档SHA／bytes／IHDR尺寸及原始来源，不是321张逐一视觉验收；未审阅或退役夹具图不算当前UI通过。T30原runner字段空的补充附件不强行计入321。`critical-binding-boundary-review-05.json` 的部分终止记录核对作为较早准备原件保留，现正式输出由最终binding及complete回执承接。退役V1、纯模块和补充browser各守原覆盖边界，现场／Gate不因此通过。

`browser-acceptance-05.json`／result／log及8张PNG绑定05：四主题语言、390／1440宽度、home／reports／request及深链刷新、同源资产通过，WeCom调用0、浏览器／TLS／App／夹具库清理true。此补充脚本不计741、不替代真机。`dev-final-05.json`：PC9／H5六GET全200、PASS、error null、监听释放，共享／PC恢复模块加载、Vite边界保持。

`browser-visual-check-05-extra.json` 另记对现有浅色中文首页、深色中文刷新详情两张PNG的只读视觉核查及SHA：文字／字体、卡片／底部控件、主题可见， 抽查视口无明显破版。新增浏览器运行0、源码／图片修改0、注册case增加0；不扩展成八图全部视觉审阅，不替代未到达断言或真机验收。截图来源索引的完整性核验和这份人工视觉记录分别保留，不能把未审阅或退役图片计为当前UI通过。

`t30-failure-visual-check-05.json` 只读观察较晚失败PNG可见一条已提交内部备注及literal script文字，不能补原DOM历史false、script-node／布局／成功截图断言。`t30-failure-screenshot-supplement-05.json` 记录原runner截图字段空的缺口，补充D临时附件精确来源／哈希，不写回原metadata、不挪移或计入runner归档。

`t29-purpose-failure-visual-check-05.json` 只读观察归档failure screenshot1的一般Incident信息仍在、owner-transfer目的失权及输入不再显示；不补原403-hook等待、后续0POST／row_version／恢复清理断言。T29原runner两张归档保持，case1失败图和case2通过图按原TAP区分。这两份视觉记录新增运行／case／runner归档数均0，business_acceptance_inferred=false；晚时点截图只能作来源证据，不能翻绿原FAIL。

文档收口前的源码统计保留于 `source-audit-05.json`、`backend-increment-05.json`；最终状态以 `source-audit-05-delivery.json`、`file-mapping-final-05-delivery.json`、`backend-increment-05-delivery.json` 为准。历史正文／tested_head／哈希只加带日期导航，不回写；旧文档检查数量不代替收口结果。

最终文档／本地链接、差异和制品核验原件分别为 `docs-agents-final05-result.json`／日志、`backend-doc-links-05-delivery.json`、`final-diff-check-05-result.json`、`final-artifact-verification-05-result.json`。外部链接未抓取；这些检查不替代业务readiness或Gate。使用现有编译工具，未再次bootstrap或生成另一业务候选。最终G2源身份复核见 `final-g2-identity-05.json`，仍保留2011／2048清单上限及上述指纹。

主工作区复核为PASS，见 `main-workspace-final05.json`：HEAD仍为上述d3b7fda…，状态仍只有原 `.env.example` 修改，其SHA256仍为 `491e12a90985a2a32bddb90797b28ddd18b2f54b8230751ec7cab6de7feb9ce5`；没有读取其私有环境文件。隔离树中的当前导航说明源码迁移与本地验证执行收口，同时保留失败，不写为无保留验收通过。

完整最终源码、清单及Git差异保存在 `final05-source-delivery/`，包含未跟踪源码文件并逐文件核对复制字节；Git patch本身不包含这些未跟踪文件。最终来源／哈希与各收口检查统一索引在 `delivery-results-05.json`。

## 7. 证据与增量回退

交付索引链接本文原件和05两phase、工具汇总、critical map、最终审计／清理；旧稿／候选／首次失败／备份保留。

回退先保全差异，按 `backend-increment-05-delivery.json`、382映射及 `baseline-source/` 原字节逆转265／105／3／9归属和本轮接线；只删清单内新增文件，校验目标位于本隔离工作树。保留PC／H5／Reporter和全部证据，不reset／clean、不动主工作区；无生产数据库、依赖或现场配置回滚。

## 8. D盘约束、无损压缩与资源收口

用户要求临时／缓存／证据只用D盘，禁止新C目录。旧 `C:\cx05a` 规划取消且未创建／使用，见 `tools05-remaining-d-temp-plan.md`；工具汇总C分配false，未触动外部TV项目。

压缩01写前停止，02恢复空间后停止；`ntfs-compression-02-partial-result.json`证明6895文件／3151911148逻辑字节在native完成后重核hash／大小／mtime差异0，无删／移／链接，工作树、私有／依赖／Git／PG跳过。用户另行清理也贡献空间，不能全归因压缩。

全部对照结束后，主PG18／52474／`pgdata`已安全停止，没有重新initdb。停止前仅有 `postgres`、`server_layout_baseline`、`template0`、`template1` 四库，其他client为0；stop退出0、status退出3，PID7676及监听均消失。独立52475也已停止。数据和日志全部保留。

外置FFmpeg／ffprobe不改PATH／依赖；Gyan9.0.2 SHA256 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`，见 `media-tools.json`。只清理明确自有进程／监听，不按进程名全局处理。

`final-postgres-before-stop.json`、`final-postgres-process-tree.json`／after及 `final-postgres-cleanup.json` 记录四库／连接与父子进程核验，最终PG清理为PASS。`final-resource-audit.json` 核对自有Node／浏览器／HTTP／TLS／媒体工具等活动进程及5194／5196／52474／52475监听，均为0；记录PID未被复用，未修改其他任务资源。最终文件交付后的补充资源读回见 `final-resource-after-delivery-05.json`。

最终无残留不抹除第12组首次浏览器清理错误，不能写为整个验证期间从未出现清理异常。全部数据、日志、失败原件、冻结运行树、旧稿、诊断副本和未提交工作树继续保留；没有删除主工作区材料、提交、推送、合并或部署。

范围外NOT_RUN：全仓full、current／historical certify、大库性能认证、真实OAuth／WeCom、企业微信真机、现场业务写库、部署及Gate。当前导航记录本地迁移和验证执行收口，保留失败与未运行项，不改变上述停止线。
