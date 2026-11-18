# Card 35C：实施与验收记录

实施与验收跨至 2026-11-19；产品确认日期 2026-11-18 保留。

本轮可执行范围已接入；13项按API停止线暂停，负责人 2026-11-19 决定保持现状、上线后登记。只实施[已确认清单](../../../../../plans/pc-admin-design-v21/card-35c-inventory.md)的上线前项。基线 `30eb2fc80353d1ab834c5da4bcc183c6415311c6`；未提交。35A/35B 已合并，A01–A08 不重复接入；登录 O67–O72 不纳入。

原始确认稿保留在历史原文（原件已移出仓库；本地归档 R01），原行号到合并基线的 318 个锚点见重新定位记录（原件已移出仓库；本地归档 R02）。实施产物记录在最终构建日志（原件已移出仓库；本地归档 R03）；源码输入哈希 `7c82d44b7b09021079e71dfec7c547e748fe62c8e989b3880c7356451118bbe3`。所有状态沿合并后的设计组件及 `useDelayedLoading` 接入，小表单使用现有 `DetailLoading inline`。未改业务、权限、接口、命令、确认或重提条件。

## 清单结果

| 区域 | 接入 | 按决策保留 | 35A 已覆盖 | 暂停 | 上线后/排除 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 会话 | 20 | 5 | 0 | 2 | 16 |
| 公共故障 | 20 | 6 | 0 | 0 | 12 |
| 通知异常 | 9 | 2 | 0 | 0 | 1 |
| 来源群目录 | 7 | 3 | 0 | 0 | 1 |
| 设置 | 0 | 3 | 0 | 0 | 1 |
| 操作表单 | 20 | 4 | 0 | 6 | 14 |
| 其他 | 21 | 29 | 0 | 5 | 17 |
| **合计** | **97** | **52** | **0** | **13** | **62** |

原编号完整保留，共 224 条（上线前 162，上线后/登录排除 62）。每条结果在[机器结果表](item-results.json)、[逐项证据](items.md)及清单的状态列；暂停项没有伪记为完成。保留项的证据包括具体产品决定、[逐段白名单](../../../../../plans/pc-admin-design-v21/card-35c-plain-state-whitelist.json)与原 feature 浏览器用例。白名单校验冻结具体段落内容和次数，不按目录放行。

## 实施时发现：需要负责人决定

负责人已于 2026-11-19 决定：下表 13 项保持现状，上线后登记。

| 发现 | 条目 | 本轮处理与后续选择 |
| --- | --- | --- |
| D01 | C04、C08 | `EmptyState block` 不显示筛选摘要，filtered 必需 summary/onClear。保留原空态。负责人决定：保持现状，上线后登记。 |
| D05 | F12、F16、F20/F21、F39/F40、O26、O35/O37、O42、O46 | 新 ErrorState/StaleRetry 没有 disabled/隐藏动作参数，不能表达原互斥、拉取中、媒体对话框或 portal 条件。保留原说明与按钮。负责人决定：保持现状，上线后登记。 |

F02/F04/F06/F09、G05、I18–I21、O48 的原互斥分支仍使用原说明，只在既有读取入口可用时接入错误/旧内容反馈。35A 为 O25/O41 提供了默认骨架形态；本卡仍需绑定真实查询，以保持最短展示，已直接组合 BlockSkeleton/useDelayedLoading。O43 仍有刷新动作，不满足 Q8 的“无动作”隐藏条件。

D06（O12/O15）按已有 Q3/Q5 保留原安全告知及核对条件；原因尚未分清不扩大成 pending，不需要新增确认。

Q1–Q14 不是待重问的问题；本节只登记实施时的 API/原因边界。没有为这些项扩展 ReadOnlyBar 原因、增加权限、解除互斥或新造视觉模式。

## 1440 截图

以下是实际运行的组件与真实隔离 HTTP/PG 夹具。仅 GET 响应的时序/失败被控制；写操作不被拦截。默认视口 1440 × 1000，附件补充证据为 1440 × 900。

| 区域 | 加载 | 完成/空 | 失败/局部说明 |
| --- | --- | --- | --- |
| 会话服务主题列表 | [加载](states-7c82d44b/conversations-loading-1440.webp) | [空队列，原 C04 保留](states-7c82d44b/conversations-ready-1440.webp) | [读取失败](states-7c82d44b/conversations-error-1440.webp) |
| 联系人收件箱 | [联系人骨架](states-7c82d44b/inbox-loading-1440.webp) | [联系人](states-7c82d44b/inbox-ready-1440.webp) | [失败](states-7c82d44b/inbox-error-1440.webp)、[慢请求](states-7c82d44b/inbox-slow-1440.webp) |
| 会话消息区 | [骨架](states-7c82d44b/chat-loading-1440.webp) | [消息](states-7c82d44b/chat-ready-1440.webp) | [读取失败](states-7c82d44b/chat-error-1440.webp) |
| 公共故障候选 | [真实四列表头](states-7c82d44b/incidents-loading-1440.webp) | [默认队列为空](states-7c82d44b/incidents-ready-1440.webp) | [错误](states-7c82d44b/incidents-error-1440.webp) |
| 通知异常 | [真实七列表头](states-7c82d44b/notifications-loading-1440.webp) | [中性空态](states-7c82d44b/notifications-ready-1440.webp) | [错误](states-7c82d44b/notifications-error-1440.webp) |
| 来源群目录 | [真实四列表头](states-7c82d44b/groups-loading-1440.webp) | [本页为空](states-7c82d44b/groups-ready-1440.webp) | [错误](states-7c82d44b/groups-error-1440.webp) |
| 操作表单 | [一行内加载，无骨架](states-7c82d44b/forms-loading-1440.webp) | [原操作表单](states-7c82d44b/forms-ready-1440.webp) | [原错误与草稿安全告知仍在](states-7c82d44b/forms-error-1440.webp) |
| 设置 | — | 保留原设置流程 | [原局部声音反馈](states-7c82d44b/settings-local-error-1440.webp) |
| 附件 | [骨架](states-7c82d44b/attachments-loading-1440.webp) | [转换失败仍可预览原件](states-7c82d44b/preview-frame-1440.webp) | [读取错误](states-7c82d44b/attachments-error-1440.webp)、[诊断复制失败的手动复制框](states-7c82d44b/detail-media-diagnostic-copy-1440.webp) |
| 轮次通知 | [骨架](states-7c82d44b/rounds-loading-1440.webp) | [原空块及刷新动作保留](states-7c82d44b/rounds-ready-1440.webp) | [原错误与重试](states-7c82d44b/rounds-error-1440.webp) |

18次联系人/附件/轮次通知的400ms读取测量中，骨架实际可见时长为 301.5–489.6ms，普通/CPU4均符合最短展示；见逐次时序（原件已移出仓库；本地归档 R04）。

普通与 4 倍 CPU 的各次运行均保留独立截图和 SHA-256 元数据；见最终验收矩阵（原件已移出仓库；本地归档 R05）。400ms 的最短展示时序记录见首次测量（原件已移出仓库；本地归档 R06）。80ms 检查从首次 DOM 出现起观察，确认不闪骨架；慢请求检查等待既有 8 秒提示。

早期重复截图/目录已逐文件校验后归档至 history-runs.tar.gz（原件已移出仓库；本地归档 R07） / 索引（原件已移出仓库；本地归档 R08）。先前展开的首轮、路由未传参矩阵及中间 CI 通过 TAP 位于 pre-f26-evidence.tar.gz（原件已移出仓库；本地归档 R09） / 索引（原件已移出仓库；本地归档 R10）。最终主轮截图保留展开，旧失败记录保留原身份和实际结果。

前一版视觉报告的全部原件保留在 earlier-visual.tar.gz（原件已移出仓库；本地归档 R11） / 索引（原件已移出仓库；本地归档 R12），当前比较报告绑定最终构建。归档保全原字节，同时避免现有制品工具枚举未跟踪文件时超过 Git 输出缓冲区；没有修改该工具或放行制品检查。

## 验证结果

CI 路由选测（79 个测试入口及 8 项工具/调度）有 **2 FAIL**：`wbint-t15-review-start-restoration-boundaries.browser.test.mts`、`web01-workbench.browser.test.mjs`。两者也在纯 `30eb2fc8` 的本地 macOS 运行中失败；对照评审反馈中 main 的 Linux CI 为绿，优先怀疑本地 macOS harness 差异，根因尚未确认。下表及历史 FAIL/NOT_RUN 保留原结果，不改写为 PASS。

<!-- validation:begin -->
本地验收未全绿。最终230个唯一入口中198 PASS、32 FAIL：浏览器/单元/集成及source-host共222个（190 PASS、32 FAIL），工具/调度8个全部PASS。主CI的87个入口为85 PASS、2 FAIL；额外143个入口为113 PASS、30 FAIL。驱动程序正常结束表示记录完整，不代表门禁通过。

| 检查 | 结果 | 原件 |
| --- | --- | --- |
| migration:typecheck（strict / negative types） | PASS | 日志（原件已移出仓库；本地归档 R13） |
| migration:build（972 typed、329 legacy、3050 outputs） | PASS | 日志（原件已移出仓库；本地归档 R03）、制品身份（原件已移出仓库；本地归档 R14） |
| lint:css / lint:features | PASS / PASS | CSS（原件已移出仓库；本地归档 R15）、features（原件已移出仓库；本地归档 R16） |
| copy-terms / 纯文字状态段落守卫 | 8/8 PASS；118段、116种精确指纹 | TAP（原件已移出仓库；本地归档 R17） |
| 文档规范 / 制品校验 | PASS / PASS | 文档规范（原件已移出仓库；本地归档 R18）、制品（原件已移出仓库；本地归档 R19） |
| 新区域与附件浏览器矩阵 | 18/18 PASS；普通3次、真实CPU4三次 | 矩阵（原件已移出仓库；本地归档 R05） |
| 每个文件、首轮与基线、复跑 | 32个主轮FAIL保持原结果 | [逐文件报告](tests.md)、机器结果（原件已移出仓库；本地归档 R20） |

32个主轮失败中，30个文件在纯30eb也出现失败。Card16的位置数值并不完全相同，原始对照及T15/Web01的具体断言均在报告中保留。arch-006的冻结scope与HEAD已有的.env.example摘要不一致，源文件本卡未改，仍记FAIL。Card31在线同事主轮失败、当前及基线独立复跑通过，尚未确认因果，不直接归为35A。

T15同一清理失败恢复断言在纯30eb三次为FAIL/PASS/PASS，当前三次均PASS；原固定100ms、原UUID和权限断言均保留。复跑通过不覆盖主CI失败。conversation-inbox（含topic history）、card12-review、T28 storage通过；T28 followup-input与t37-shared-time-card-list失败，均保留原件。

全机数据库清理检查实际exit 1，原因是6个预存非CI库；本卡没有新增残留，前后7个非模板库集合一致，原库未删除。实际检查（原件已移出仓库；本地归档 R21）、资源清理（原件已移出仓库；本地归档 R22）。本机为darwin-chrome，不能声明为Linux CI通过。
<!-- validation:end -->

CI 选择直接调用现有 `parsePolicy/planChanges/loadRoutes`，将本工作树实际差异（含未跟踪文件）代入 `plans/testing-policy.json` 和当前路由，未制造提交。结果见最终 CI 计划（原件已移出仓库；本地归档 R23）。运行沿数据库 lane 的 `runSelection`，仍保留宿主、制品、V8 加载来源、子进程、隔离资源与 case trace 检查；一次联合失败后，剩余文件单独继续，避免把未运行记为通过。额外 feature 文件选择见选测依据（原件已移出仓库；本地归档 R24）。

补充 CPU 矩阵使用 staged runtime 的显式参数入口，仅在现有环境白名单上增加本测试定义的两个参数；保留制品、V8 来源、case trace 和自有浏览器/数据库资源断言。CI 与其余相关回归继续使用原 runSelection。一次路由矩阵的自定义参数被过滤，实际全部为普通 CPU，故该记录（原件已移出仓库；本地归档 R25）不计入 CPU4 验收。

环境为本机 darwin-chrome、Node.js 24。使用本工作树的 `TS_MIGRATION_TEST_SOURCE_ROOT`、指定本机 PG 和 `TS_MIGRATION_TEST_DB_ISOLATED=1`；浏览器用例执行 `.build/runtime/tests` 产物。临时根采用同一 macOS 临时目录的真实路径，因为存储守卫禁止经过 `/var` 符号链接；未放宽守卫。4 倍 CDP CPU 是本机慢环境验证，不是 Linux CI 结果。

### 开发期失败与未执行记录

- 初次基线构建（原件已移出仓库；本地归档 R26）因已有安装缺少锁定的 pixelmatch 失败；按锁文件安装后基线构建通过（原件已移出仓库；本地归档 R27），没有改依赖声明。
- 首次类型检查（原件已移出仓库；本地归档 R28）发现新增路由加载 hook 的声明顺序问题，已修正；后继完整构建严格检查通过。
- 构建期间输入变化（原件已移出仓库；本地归档 R29）被制品守卫拒绝；测试字符串转义错误（原件已移出仓库；本地归档 R30）被 strict 拒绝。对应被拒绝的构建矩阵（原件已移出仓库；本地归档 R31）的六个调用没有可执行产物，属于 NOT_RUN，不能当作六次浏览器失败或通过。
- 首轮测试夹具的枚举/报修前置、表单/联系人选择器与断言范围错误保留在 development 系列 TAP。首次 4 倍 CPU（原件已移出仓库；本地归档 R32）断言把其他表单的准备状态算作备注读取，已改为核对内部备注区域；未放宽既有 feature 断言。
- 附件初次矩阵（原件已移出仓库；本地归档 R33）的两个区域状态用例通过，但附件用例被真实存储守卫拒绝临时目录符号链接。将测试临时根规范为真实路径后重跑；不修改存储实现或跳过断言。

新增测试的一次普通 CPU 第三轮因标签坐标点击未激活面板而失败：TAP（原件已移出仓库；本地归档 R34）、截图（原件已移出仓库；本地归档 R35）、观察与修正（原件已移出仓库；本地归档 R36）。该轮未进入 CPU4，不纳入最终矩阵；新增测试现直接激活非业务标签并确认面板可见，所有读取、错误、重试与时序断言保留。

后一次新增测试在表单错误等待中发现了相邻表单先报错的竞态：TAP（原件已移出仓库；本地归档 R37）、截图（原件已移出仓库；本地归档 R38）、记录（原件已移出仓库；本地归档 R39）。现将加载和错误等待限定在备注页脚；保留同一内容断言，未改页面代码。

新增测试另一次等待失败来自错误假设：行内 DetailLoading 没有 aria-label，其实际语义是 role=status 与子文案。现按合并 API 检查页脚状态及文案，标签面板也按真实 DOM ID 确认：TAP（原件已移出仓库；本地归档 R40）、观察（原件已移出仓库；本地归档 R41）。页面组件未改。

T15 的本轮 CI 另有一次「已知失败后清理受阻」断言失败，固定 100ms 后未看到原核对入口；此前完整轮通过。保留原断言及失败截图（原件已移出仓库；本地归档 R42），以观察记录（原件已移出仓库；本地归档 R43）与后续独立重跑区分，不直接归为35A。

## 视觉回归与逐屏归因

先在未修改源码的 `30eb2fc8` 构建并捕获了全部 18 屏，再进行本卡源码变更。基线前报告原件归档（原件已移出仓库；本地归档 R44）及逐文件索引（原件已移出仓库；本地归档 R45）说明 14 屏已有差异，不能归到本卡。

<!-- visual:begin -->
[原基线 → 最终报告](comparison/index.html) / 纯 30eb2fc8 → 最终归因报告（原件已移出仓库；本地归档 R46）。最终捕获为 18 屏，绑定 `7c82d44b7b09021079e71dfec7c547e748fe62c8e989b3880c7356451118bbe3`。原基线比较 exit 1，14 屏 changed；纯30eb比较 exit 0，18 屏全部零像素差异。缺失基线、过期捕获和元数据错误均为0。

| 屏幕 | 原基线 → 最终 diff ratio | 30eb2fc8 → 最终 | 归因 / 是否预期 | 三联图 |
| --- | ---: | ---: | --- | --- |
| board-default | 3.351319% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/board-default-baseline.webp) / [当前](comparison/images/board-default-current.webp) / [差异](comparison/images/board-default-diff.webp) |
| board-presence | 3.351319% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/board-presence-baseline.webp) / [当前](comparison/images/board-presence-current.webp) / [差异](comparison/images/board-presence-diff.webp) |
| board-filtered-empty | 0.735764% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/board-filtered-empty-baseline.webp) / [当前](comparison/images/board-filtered-empty-current.webp) / [差异](comparison/images/board-filtered-empty-diff.webp) |
| drawer-processing | 1.054861% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/drawer-processing-baseline.webp) / [当前](comparison/images/drawer-processing-current.webp) / [差异](comparison/images/drawer-processing-diff.webp) |
| drawer-dismissed | 3.273611% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/drawer-dismissed-baseline.webp) / [当前](comparison/images/drawer-dismissed-current.webp) / [差异](comparison/images/drawer-dismissed-diff.webp) |
| drawer-completed | 2.609306% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/drawer-completed-baseline.webp) / [当前](comparison/images/drawer-completed-current.webp) / [差异](comparison/images/drawer-completed-diff.webp) |
| drawer-banner-editing | 1.466597% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/drawer-banner-editing-baseline.webp) / [当前](comparison/images/drawer-banner-editing-current.webp) / [差异](comparison/images/drawer-banner-editing-diff.webp) |
| detail-fullpage-1280 | 0.005391% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/detail-fullpage-1280-baseline.webp) / [当前](comparison/images/detail-fullpage-1280-current.webp) / [差异](comparison/images/detail-fullpage-1280-diff.webp) |
| close-dialog-out-of-scope | 0.566319% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/close-dialog-out-of-scope-baseline.webp) / [当前](comparison/images/close-dialog-out-of-scope-current.webp) / [差异](comparison/images/close-dialog-out-of-scope-diff.webp) |
| close-dialog-duplicate | 0.566319% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/close-dialog-duplicate-baseline.webp) / [当前](comparison/images/close-dialog-duplicate-current.webp) / [差异](comparison/images/close-dialog-duplicate-diff.webp) |
| restore-dialog | 2.194306% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/restore-dialog-baseline.webp) / [当前](comparison/images/restore-dialog-current.webp) / [差异](comparison/images/restore-dialog-diff.webp) |
| toast-drawer-stack | 1.054861% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/toast-drawer-stack-baseline.webp) / [当前](comparison/images/toast-drawer-stack-current.webp) / [差异](comparison/images/toast-drawer-stack-diff.webp) |
| sidebar-online-popover | 3.350208% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/sidebar-online-popover-baseline.webp) / [当前](comparison/images/sidebar-online-popover-current.webp) / [差异](comparison/images/sidebar-online-popover-diff.webp) |
| notifications-default | 0.005833% | 0.000000% | 35A 阶段既有；预期（纯30eb捕获复现） | [基线](comparison/images/notifications-default-baseline.webp) / [当前](comparison/images/notifications-default-current.webp) / [差异](comparison/images/notifications-default-diff.webp) |

未变化的4屏：list-default、list-closed-groups、toast-tones、conversation-default。35C 相对30eb没有新增差异，非预期变化为0；各区域替换状态另有31张1440截图。
<!-- visual:end -->

对比阈值沿 35B 工具；出现 changed 就如实保留比较失败状态，不把“预期变化”改成自动通过。三联图均保存在各报告 images 目录，不链接到被忽略的临时捕获目录。原基线的逐文件摘要保存在初始哈希（原件已移出仓库；本地归档 R47）。

## 已变更的旧测试预期

| 文件 | 仅替换的旧预期 | 对应清单 |
| --- | --- | --- |
| `tests/web01-workbench.browser.test.mjs` | 来源群原加载文字改为 loading-status 标签；错误改为“来源群目录没有读出来”；检索空改为“没有符合条件的来源群”。未开放改为“来源群目录尚未开放”、无查看权改为“当前账号不能查看目录”；既有数据/权限断言保留。 | G01/G02/G04/G05/G07 |
| `tests/wbint-t32-exception-authorization.browser.test.mts` | “通知都已送达”改为中性“当前没有通知异常”。 | N06 |
| `tests/helpers/wbint-t27-browser-fixture.mts`、`tests/t28-followup-receipt.browser.test.mts` | 未开放页面的旧“候选工作区尚未启用”改为“公共故障页面尚未开放”。 | I01 |
| `tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts` | 原“重新核对确认并开始权限”按钮定位改为同一接单区域 ErrorState 的重试；仍触发原 context.refetch。 | F35 |
| `tests/wbint-t22-conversations.browser.test.mts` | 不再要求可见错误码、原 title、技术错误映射 span；改查逐条真实 delivery ID/错误码在复制数据中、发送结果和下一步仍可见、正文/title 不含原码。“待发送”改为“等待发送”。 | C16/C24 |
| `tests/workbench-detail-media.browser.test.mts` | Tooltip 保留原件说明，错误码/时间改查复制对象；增加复制失败可选中只读框的验证，原预览、下载字节、守卫和几何断言保留。 | O31/O65 |
| `tests/helpers/card23-presentation.mts` | 发送状态 SVG 计数独立排除诊断复制图标，并显式断言诊断图标数；错误码在逐条复制对象中，正文不出现。其余几何、标签与责任断言保留。 | C24 |
| `tests/wbint-t22-boundary.browser.test.mts` | 成功纯空的关联会话区不渲染，实际“会话”标签仍在；其他边界/命令断言保留。 | C43 |
| `tests/wbint-t22-outcome.browser.test.mts` | “发送结果未知，需核对”改为“发送结果待核对”。 | C16 |
| `tests/workbench-detail-restructure.browser.test.mts` | 原 detail-loading 选择器改为同区域 loading-status，并继续要求两个骨架；原纯空附件段落改为成功空区隐藏。 | O25/O27 |
| `tests/yxx-h5-flow.integration.test.mts` | 记录真实两类附件元信息读取成功，要求成功纯空附件区隐藏。原件预览、下载字节、转换、越权与原 UUID 断言保留。 | O27 |

`tests/pc-admin-card35c-states.browser.test.mts` 是新增区域状态/时序测试；`tests/pc-admin-copy-terms.test.mts` 增加精确白名单与反例检查，涵盖原生 p、动态错误、隐藏测试钩子和 `hidden={false}`，已注册的 copy-terms 入口继续选中。新增浏览器文件注册在当前路由并加入 pr-pc。

## 删除记录与回退

没有删除整个文件。删除的是被替换的散装状态 p、重复错误/加载分支、成功纯空子块和原可见技术错误码：

- 会话列表/消息区、公共故障候选/结果、通知异常、来源群的读取占位改用设计状态；旧会话错误段落的 `.inbox-read-error` 样式删除。
- 小表单“正在读取”p 改为一行内加载；草稿恢复/清理、已知结果和未知结果的安全告知按 Q5/Q13 保留。
- 仅成功、纯空且无动作的附件/复核材料/补充内容子块隐藏；`.media-empty` 样式及原空附件 p 删除。存储不可用/错误/有动作的区块保留。
- 原发送错误码/技术映射 span、标题拼接与附件 Tooltip 码/时间拼接删除；只保留诊断复制。转换诊断按钮直接可聚焦，未放进 Tooltip 内。
- BoardConflictIntent 的原 alert p 改成现有 InlineAlert；没有改新意图、采用原事实或发送条件。

本轮未提交。需要回退时可逐文件撤销本卡源码/测试差异，保留确认原文、TAP、截图及基线前证据；不要重置用户工作树或覆盖原始确认记录。

## 文件清单

下表列源码、测试和配置变更；本目录证据与确认清单/白名单另列。没有基线文件、服务端、接口或权限实现变更。

<!-- files:begin -->
| 状态 | 文件 |
| --- | --- |
| M | [app/pc-admin/src/app/App.tsx](../../../../../app/pc-admin/src/app/App.tsx) |
| A | [app/pc-admin/src/app/read-state-diagnostics.ts](../../../../../app/pc-admin/src/app/read-state-diagnostics.ts) |
| M | [app/pc-admin/src/design/components/Drawer/detail-content.css](../../../../../app/pc-admin/src/design/components/Drawer/detail-content.css) |
| M | [app/pc-admin/src/design/components/Split/conversation-v21.css](../../../../../app/pc-admin/src/design/components/Split/conversation-v21.css) |
| M | [app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx](../../../../../app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx) |
| M | [app/pc-admin/src/features/attachments/AttachmentSection.tsx](../../../../../app/pc-admin/src/features/attachments/AttachmentSection.tsx) |
| M | [app/pc-admin/src/features/board-actions/BoardConflictIntent.tsx](../../../../../app/pc-admin/src/features/board-actions/BoardConflictIntent.tsx) |
| M | [app/pc-admin/src/features/conversations/ConversationAssociatedItem.tsx](../../../../../app/pc-admin/src/features/conversations/ConversationAssociatedItem.tsx) |
| M | [app/pc-admin/src/features/conversations/ConversationComposer.tsx](../../../../../app/pc-admin/src/features/conversations/ConversationComposer.tsx) |
| M | [app/pc-admin/src/features/conversations/ConversationInbox.tsx](../../../../../app/pc-admin/src/features/conversations/ConversationInbox.tsx) |
| A | [app/pc-admin/src/features/conversations/ConversationLoading.tsx](../../../../../app/pc-admin/src/features/conversations/ConversationLoading.tsx) |
| M | [app/pc-admin/src/features/conversations/Conversations.tsx](../../../../../app/pc-admin/src/features/conversations/Conversations.tsx) |
| M | [app/pc-admin/src/features/follow-up/SharedFollowUp.tsx](../../../../../app/pc-admin/src/features/follow-up/SharedFollowUp.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/CandidateDecisionForm.tsx](../../../../../app/pc-admin/src/features/incident-candidates/CandidateDecisionForm.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/CandidateDetail.tsx](../../../../../app/pc-admin/src/features/incident-candidates/CandidateDetail.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/IncidentCandidates.tsx](../../../../../app/pc-admin/src/features/incident-candidates/IncidentCandidates.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/IncidentFollowup.tsx](../../../../../app/pc-admin/src/features/incident-candidates/IncidentFollowup.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/IncidentInternalNotes.tsx](../../../../../app/pc-admin/src/features/incident-candidates/IncidentInternalNotes.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/IncidentOwnerTransfer.tsx](../../../../../app/pc-admin/src/features/incident-candidates/IncidentOwnerTransfer.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/IncidentPublicProgress.tsx](../../../../../app/pc-admin/src/features/incident-candidates/IncidentPublicProgress.tsx) |
| M | [app/pc-admin/src/features/incident-candidates/IncidentResult.tsx](../../../../../app/pc-admin/src/features/incident-candidates/IncidentResult.tsx) |
| M | [app/pc-admin/src/features/manual-report/ManualReportForm.tsx](../../../../../app/pc-admin/src/features/manual-report/ManualReportForm.tsx) |
| M | [app/pc-admin/src/features/manual-report/ManualSelfHandlingForm.tsx](../../../../../app/pc-admin/src/features/manual-report/ManualSelfHandlingForm.tsx) |
| M | [app/pc-admin/src/features/manual-review/ReviewStartControls.tsx](../../../../../app/pc-admin/src/features/manual-review/ReviewStartControls.tsx) |
| M | [app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx](../../../../../app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx) |
| M | [app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx](../../../../../app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx) |
| A | [app/pc-admin/src/features/read-states/ReadTableSkeleton.tsx](../../../../../app/pc-admin/src/features/read-states/ReadTableSkeleton.tsx) |
| M | [app/pc-admin/src/features/source-groups/SourceGroupDirectory.tsx](../../../../../app/pc-admin/src/features/source-groups/SourceGroupDirectory.tsx) |
| M | [app/pc-admin/src/features/supplement-follow-up/SupplementFollowUp.tsx](../../../../../app/pc-admin/src/features/supplement-follow-up/SupplementFollowUp.tsx) |
| M | [app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx](../../../../../app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx) |
| M | [app/pc-admin/src/features/ticket-completion/TicketCompletion.tsx](../../../../../app/pc-admin/src/features/ticket-completion/TicketCompletion.tsx) |
| M | [app/pc-admin/src/features/ticket-handling/TicketConversationHandling.tsx](../../../../../app/pc-admin/src/features/ticket-handling/TicketConversationHandling.tsx) |
| M | [app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx](../../../../../app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx) |
| M | [app/pc-admin/src/features/ticket-notes/TicketNotes.tsx](../../../../../app/pc-admin/src/features/ticket-notes/TicketNotes.tsx) |
| M | [app/pc-admin/src/features/ticket-reopen/TicketReopen.tsx](../../../../../app/pc-admin/src/features/ticket-reopen/TicketReopen.tsx) |
| M | [app/pc-admin/src/features/ticket-round-notifications/TicketRoundNotifications.tsx](../../../../../app/pc-admin/src/features/ticket-round-notifications/TicketRoundNotifications.tsx) |
| M | [app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx](../../../../../app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx) |
| M | [app/pc-admin/src/features/ticket-waiting/ClosureActions.tsx](../../../../../app/pc-admin/src/features/ticket-waiting/ClosureActions.tsx) |
| M | [app/pc-admin/src/features/ticket-waiting/ClosureHistory.tsx](../../../../../app/pc-admin/src/features/ticket-waiting/ClosureHistory.tsx) |
| A | [plans/pc-admin-design-v21/card-35c-inventory.md](../../../../../plans/pc-admin-design-v21/card-35c-inventory.md) |
| A | [plans/pc-admin-design-v21/card-35c-plain-state-whitelist.json](../../../../../plans/pc-admin-design-v21/card-35c-plain-state-whitelist.json) |
| M | [plans/typescript-migration/test-routing.json](../../../../../plans/typescript-migration/test-routing.json) |
| M | [tests/helpers/card23-presentation.mts](../../../../../tests/helpers/card23-presentation.mts) |
| A | [tests/helpers/pc-admin-plain-state.mts](../../../../../tests/helpers/pc-admin-plain-state.mts) |
| M | [tests/helpers/wbint-t27-browser-fixture.mts](../../../../../tests/helpers/wbint-t27-browser-fixture.mts) |
| A | [tests/pc-admin-card35c-states.browser.test.mts](../../../../../tests/pc-admin-card35c-states.browser.test.mts) |
| M | [tests/pc-admin-copy-terms.test.mts](../../../../../tests/pc-admin-copy-terms.test.mts) |
| M | [tests/t28-followup-receipt.browser.test.mts](../../../../../tests/t28-followup-receipt.browser.test.mts) |
| M | [tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts](../../../../../tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts) |
| M | [tests/wbint-t22-boundary.browser.test.mts](../../../../../tests/wbint-t22-boundary.browser.test.mts) |
| M | [tests/wbint-t22-conversations.browser.test.mts](../../../../../tests/wbint-t22-conversations.browser.test.mts) |
| M | [tests/wbint-t22-outcome.browser.test.mts](../../../../../tests/wbint-t22-outcome.browser.test.mts) |
| M | [tests/wbint-t32-exception-authorization.browser.test.mts](../../../../../tests/wbint-t32-exception-authorization.browser.test.mts) |
| M | [tests/web01-workbench.browser.test.mjs](../../../../../tests/web01-workbench.browser.test.mjs) |
| M | [tests/workbench-detail-media.browser.test.mts](../../../../../tests/workbench-detail-media.browser.test.mts) |
| M | [tests/workbench-detail-restructure.browser.test.mts](../../../../../tests/workbench-detail-restructure.browser.test.mts) |
| M | [tests/yxx-h5-flow.integration.test.mts](../../../../../tests/yxx-h5-flow.integration.test.mts) |
<!-- files:end -->



完整测试报告、case trace、V8来源及重复截图均已逐文件验证后归档，原路径和SHA-256见最终原件索引（原件已移出仓库；本地归档 R48）。归档分为主CI（原件已移出仓库；本地归档 R49）、相关回归（原件已移出仓库；本地归档 R50）、矩阵（原件已移出仓库；本地归档 R51）、独立复核（原件已移出仓库；本地归档 R52）及中间轮（原件已移出仓库；本地归档 R53）。自有临时检出、报告目录和Python venv已清理，历史字节可从归档恢复。

以上为非证据文件清单（50个修改、7个新增）；全部改动含证据路径见完整路径清单（原件已移出仓库；本地归档 R54）。未删除整个文件。

CI选择、显式CPU参数矩阵、复核和归档的实际临时驱动见脚本原件（原件已移出仓库；本地归档 R55） / 索引（原件已移出仓库；本地归档 R56），供核验执行方式；重新运行须使用新的输出路径保全历史。最终范围/基线/决策审计（原件已移出仓库；本地归档 R57）与链接检查（原件已移出仓库；本地归档 R58）记录交付边界。

## 移出仓库的原件

原件已移出仓库，结果和历史文字仍按原轮次保留。本地归档目录：`/private/tmp/claude-501/-Users-petervans-Projects-ticket/172774c8-e578-406d-b0a5-c4c9c8c86f82/scratchpad/35c-evidence-archive`；完整文件哈希见该目录的 `MANIFEST.txt`。以下路径相对原证据目录，均为纯文本定位，不是仓库链接。

| 引用 | 原件 | 本地归档 SHA-256 |
| --- | --- | --- |
| R01 | `inventory-confirmed-f76fffef.txt` | `c78968c95deec2980f75744cabc26c8af654edf2683099665b97fb902cb4b976` |
| R02 | `reanchor-30eb2fc8.json` | `13590183d53cc165c2f0a298b198cae4a67a9495a870cd49815e52b917dceb64` |
| R03 | `build-inline-dom.txt` | `b375c1d727e0d070e502fe07feb4e1fdcdc4bd596f5e7a54d4b14d528986d18d` |
| R04 | `timing-summary.json` | `79f3295da66ac720e1034fbc290cf704cc53d89bc6bfb0acdecc0b576484e3fc` |
| R05 | `matrix-7c82d44b-results.json` | `c5287af2e1b50167022b5dbd2ebb95c51a27d57c91741e0e1069efd28a708300` |
| R06 | `states-7c82d44b/inbox-timing.json` | `c5a344533f617bf11807b8df7fbfc4cb6ce82790063844a5bfadc408f13615f8` |
| R07 | `history-runs.tar.gz` | `d4f55776d0033f4fa5ef3afd35c0e80d85dded815e42b57c0e95999a6961d540` |
| R08 | `history-runs-index.json` | `fb54cf6042b7e360b199f18f86671fa76544558347fd5c6e047b5634eeb915de` |
| R09 | `pre-f26-evidence.tar.gz` | `31f3781825d2d49b567e3b1f37c34cd6fb0d9fc2dab243ff8364df44a42b387f` |
| R10 | `pre-f26-evidence-index.json` | `558a426c2bf4db21a055f02f8f675d8cf072ea4c947f6f34feb0cf1db225105e` |
| R11 | `earlier-visual.tar.gz` | `8d12e87d6eb739fc39e77eb096aba7b568d7c79708d88f69f9c8f9d8e9481214` |
| R12 | `earlier-visual-index.json` | `5d439c590ab62361bd7d45fc05b97ef81443f4782de6348af7e50c0f6c94856f` |
| R13 | `typecheck-inline-dom.txt` | `83f10f843da1a12c0c926f32156044eaa58b4a5c1adef482ffe921f7e9e805e7` |
| R14 | `artifact-identity-final.json` | `1b49757b28a65fa71c3b984c6aeae4731c65c771b3ccc77be15f8d51d87b0138` |
| R15 | `7c82d44b-css.txt` | `f63c7c64a77f209d9abab662928ed53b471657ac17b8f63dacfb9185d03d7f06` |
| R16 | `7c82d44b-features.txt` | `613e3c6a507c793d26dbb0d62938f43f973f483fa2bcde310559e88724ca930f` |
| R17 | `ci-7c82d44b/c030.tap` | `d44af1fd94dd0df51523adf537bfd74f741a053914c9f549e90c39a81583702e` |
| R18 | `7c82d44b-agents.txt` | `2ef943b93726f27ea5887366033c0d1391a820e550534dc48aa94653614939f6` |
| R19 | `7c82d44b-artifact.txt` | `7e6cb044561643d2e9f9ae50222ed50e75d7530be642d7a7892ed54df8510d32` |
| R20 | `per-file-results-final.json` | `f3b8cd676d1131a64e37ce09e222c2689f2bf3ccf6d532b8411597763bfa1bdc` |
| R21 | `database-cleanup-global.txt` | `b47c72e1081efb0f7273e568dbb4ac4993c0384a1bc1ffca5457d3aee7da63c3` |
| R22 | `resource-cleanup.json` | `73b7502d769676b9cec405cd7bd042ef35d7c0af38c4bb50cd69267d028d12c5` |
| R23 | `ci-selection-7c82d44b.json` | `d679d81b3ff1a6a3d8079e84315df08df08f7d62a73d7de30fbd80240e3b336e` |
| R24 | `touching-tests.json` | `4648951eb962c4f1872fd6f02c3cdc583b204906c3c47fd1daffee4640a46684` |
| R25 | `matrix-environment-filtered-results.json` | `03e1b6b83a2129d3fdd7f01da2499e9e73c755323ef2a9ad56335203a5e41066` |
| R26 | `base-build.txt` | `a75213b4ebcb20ed81d22e03c2295d8359e124a3b73a3231fbca7ad4d15e1b71` |
| R27 | `base-build-after-dependencies.txt` | `3ef433c1af6a91440e35aec2de8c142f45d72a56b355ad68954e13d80b64dd8b` |
| R28 | `typecheck-first.txt` | `edee593fd508ebffff86397dbd66159d2d41a9f4ec5bacdd463f9981ef7bcd93` |
| R29 | `implementation-build-4.txt` | `67d27a16d32694a113935ac911b9d6d4e245e63ba78f61431d5d37d71a0115bd` |
| R30 | `implementation-build-6.txt` | `22677002762f7a755fbb72d9ae9199525c8d555261ee1bc9d5422727308f4334` |
| R31 | `matrix-rejected-build-results.json` | `3fc9021608effa3ceb29dfae669feedd09127686004402a3acab64227fb245be` |
| R32 | `cpu4-1.tap` | `2f835e15a88ea0a360a21952edf4df8ebb97077e49b58516d97c06d2de4120d9` |
| R33 | `matrix-release-results.json` | `a559ff49553a37d1978fd8edf71c721655d875e2f9d1d73d2b51885fcfed1516` |
| R34 | `matrix-effective/normal-3-1.tap` | `a29d605375398c9d222c098a12be5ccaecccc08edf7a9e543814e50375158d3b` |
| R35 | `new-test-tab-activation/failure-main-1440.png` | `44d30cb6a636aab3e167b0ff74690e198ac73030a411570882bbeccff495deda` |
| R36 | `new-test-tab-activation.json` | `772c8f6b01ca90839169e431849b53e753a91f51050e8ebaee1b710e32a93fd3` |
| R37 | `matrix-f26/normal-1-1.tap` | `925f334da87eee059b66a9a1b1273862469d5a290380a5e70b40c6b35730ec59` |
| R38 | `new-test-note-wait/failure-main-1440.png` | `4f1ce49b7e857715b5bcb1395fa0e1a7781538c0fe65c0dfe4c41411dbd936be` |
| R39 | `matrix-f26-failure.json` | `e56e256721d21d5137bff92c8ecbc0819b3a545791cc5bd22ac4c45abc021282` |
| R40 | `matrix-d866dc23/normal-1-1.tap` | `44a50484d7faef22f67e5af27337c2da041ca054fd5170f02657143342fcec28` |
| R41 | `matrix-d866dc23-failure.json` | `2f39df665264ac440cf5645ead6ebd3c2697d3cd9768831c9da37642816ac68c` |
| R42 | `t15-opaque-failed-900.png` | `9916319b53df683fceef1bcee71e81e73ae7b36e374460b7a278b9c8de7782f8` |
| R43 | `t15-current-failure.json` | `2dccc8978beb6a0940441365f1a7f1587f97a9f7aa6b38680434140030e2d3bb` |
| R44 | `base-visual-before-code.tar.gz` | `c6cd655fd2f7ee48ef7a7ab1793697323e0411f8e341b2aec9947b438ea2811d` |
| R45 | `base-visual-before-code-index.json` | `9649175dce1a6fa7c0ae845382764d42f38fc4ebb482a2b4a494da5b6235097d` |
| R46 | `attribution/index.html` | `abc78e5273da4da6b0617db67df52405566f7a911abd4de4ad4250be8acec39d` |
| R47 | `baseline-hashes.json` | `b2357a027926b565a4cba32450611757e227e7655980f2b75403c3210feb90a8` |
| R48 | `final-test-reports-index.json` | `f2b3ac10544c2708558cbc815ed0e5b52c86b849323caa0340fe0e9fb5bdc204` |
| R49 | `final-ci-reports.tar.gz` | `07fde8fced12ab11fc08863407b91248611e1dd18c6be6d8f985c2a2d33c1b24` |
| R50 | `final-extra-reports.tar.gz` | `6dd7aa4fa47ecb5512a1510fdad2283c4ee72894c43198c7ea06db19a4f6b76e` |
| R51 | `final-matrix-reports.tar.gz` | `b6bc0b0354c444500e3cffb274c806afb130c46ca883d053f9c2cda27e54c793` |
| R52 | `recheck-reports.tar.gz` | `4b7612f0cc1ded87fea130d550da44355a323a41ad4b62c1d972dbc317787681` |
| R53 | `intermediate-test-reports.tar.gz` | `86e37a743ff80266596e71513bba31c6b188ec7f39ef3a59b6e1381fa73f63ae` |
| R54 | `changed-files.txt` | `52a4180aec49ad588376c10cfeeb526eecb470f0ef7c7d09a47a44001094795d` |
| R55 | `verification-drivers.tar.gz` | `918dc268ef76f56620b8151c7a5feda93339e47cfd5bd707019b14880c522809` |
| R56 | `verification-drivers-index.json` | `89c03807c1b81a96eed8017ca52c596030ec4c8aa3d4a64899cf77d88dc060d7` |
| R57 | `final-audit.json` | `ebc88c39d1e80a0728dab549a300f3742c14e4f051f25a8c313b01c1e2e82408` |
| R58 | `docs-links.json` | `e28bba5c24e5b83788aca92b68fcac008ebd439052a7bba01d09fe678a1da5b4` |

## 本次证据减量

本次仅调整文档及证据存储，没有修改源码、测试、构建产物或运行构建。原 PNG 已移入本地归档；仓库展示副本使用无损 WebP，73 张图逐张确认尺寸、解码后的 RGBA8 字节及 ICC 配置完全一致，视觉差异数值未重算、未变更。只保留变化屏三联图，未变化屏保留原数值。编码前后文件 SHA-256、像素 SHA-256 见本地归档 `LOSSLESS-ENCODING.txt`，所有原件均可按 `MANIFEST.txt` 校验恢复。

## 仓库内保留文件

共149个文件：3份Markdown、item-results.json、31张1440区域截图、42张变化屏三联图、3份视觉报告文件及69份最终/失败TAP。减量前的完整改动路径清单属于历史原件，已移出；当前保留集合如下。

<details>
<summary>展开完整保留文件清单</summary>

```text
README.md
comparison/images/board-default-baseline.webp
comparison/images/board-default-current.webp
comparison/images/board-default-diff.webp
comparison/images/board-filtered-empty-baseline.webp
comparison/images/board-filtered-empty-current.webp
comparison/images/board-filtered-empty-diff.webp
comparison/images/board-presence-baseline.webp
comparison/images/board-presence-current.webp
comparison/images/board-presence-diff.webp
comparison/images/close-dialog-duplicate-baseline.webp
comparison/images/close-dialog-duplicate-current.webp
comparison/images/close-dialog-duplicate-diff.webp
comparison/images/close-dialog-out-of-scope-baseline.webp
comparison/images/close-dialog-out-of-scope-current.webp
comparison/images/close-dialog-out-of-scope-diff.webp
comparison/images/detail-fullpage-1280-baseline.webp
comparison/images/detail-fullpage-1280-current.webp
comparison/images/detail-fullpage-1280-diff.webp
comparison/images/drawer-banner-editing-baseline.webp
comparison/images/drawer-banner-editing-current.webp
comparison/images/drawer-banner-editing-diff.webp
comparison/images/drawer-completed-baseline.webp
comparison/images/drawer-completed-current.webp
comparison/images/drawer-completed-diff.webp
comparison/images/drawer-dismissed-baseline.webp
comparison/images/drawer-dismissed-current.webp
comparison/images/drawer-dismissed-diff.webp
comparison/images/drawer-processing-baseline.webp
comparison/images/drawer-processing-current.webp
comparison/images/drawer-processing-diff.webp
comparison/images/notifications-default-baseline.webp
comparison/images/notifications-default-current.webp
comparison/images/notifications-default-diff.webp
comparison/images/restore-dialog-baseline.webp
comparison/images/restore-dialog-current.webp
comparison/images/restore-dialog-diff.webp
comparison/images/sidebar-online-popover-baseline.webp
comparison/images/sidebar-online-popover-current.webp
comparison/images/sidebar-online-popover-diff.webp
comparison/images/toast-drawer-stack-baseline.webp
comparison/images/toast-drawer-stack-current.webp
comparison/images/toast-drawer-stack-diff.webp
comparison/index.html
comparison/report.json
comparison/tokens.css
item-results.json
items.md
states-7c82d44b/attachments-error-1440.webp
states-7c82d44b/attachments-loading-1440.webp
states-7c82d44b/attachments-ready-1440.webp
states-7c82d44b/chat-error-1440.webp
states-7c82d44b/chat-loading-1440.webp
states-7c82d44b/chat-ready-1440.webp
states-7c82d44b/conversations-error-1440.webp
states-7c82d44b/conversations-loading-1440.webp
states-7c82d44b/conversations-ready-1440.webp
states-7c82d44b/detail-media-diagnostic-copy-1440.webp
states-7c82d44b/forms-error-1440.webp
states-7c82d44b/forms-loading-1440.webp
states-7c82d44b/forms-ready-1440.webp
states-7c82d44b/groups-error-1440.webp
states-7c82d44b/groups-loading-1440.webp
states-7c82d44b/groups-ready-1440.webp
states-7c82d44b/inbox-error-1440.webp
states-7c82d44b/inbox-loading-1440.webp
states-7c82d44b/inbox-ready-1440.webp
states-7c82d44b/inbox-slow-1440.webp
states-7c82d44b/incidents-error-1440.webp
states-7c82d44b/incidents-loading-1440.webp
states-7c82d44b/incidents-ready-1440.webp
states-7c82d44b/notifications-error-1440.webp
states-7c82d44b/notifications-loading-1440.webp
states-7c82d44b/notifications-ready-1440.webp
states-7c82d44b/preview-frame-1440.webp
states-7c82d44b/rounds-error-1440.webp
states-7c82d44b/rounds-loading-1440.webp
states-7c82d44b/rounds-ready-1440.webp
states-7c82d44b/settings-local-error-1440.webp
taps/35c/ci.tap
taps/35c/cpu4-1.tap
taps/35c/cpu4-2.tap
taps/35c/cpu4-3.tap
taps/35c/normal-1.tap
taps/35c/normal-2.tap
taps/35c/normal-3.tap
taps/base-30eb/pc-admin-card13.browser.tap
taps/base-30eb/pc-admin-card16-arrivals.browser.tap
taps/base-30eb/pc-admin-card29.browser.tap
taps/base-30eb/t04-self-handling.browser.tap
taps/base-30eb/t05-conversation-handling.browser.tap
taps/base-30eb/t06-assignment-memory-recovery.browser.tap
taps/base-30eb/t06-assignment-recovery.browser.tap
taps/base-30eb/t07-draft-recovery.browser.tap
taps/base-30eb/t07-legacy-recovery.browser.tap
taps/base-30eb/t10-privacy-boundaries.browser.tap
taps/base-30eb/t11-completion.browser.tap
taps/base-30eb/t12-draft-recovery.browser.tap
taps/base-30eb/t12-raw-off-unknown.browser.tap
taps/base-30eb/t12-targets-read-loss.browser.tap
taps/base-30eb/t20-staff-post200-context503.browser.tap
taps/base-30eb/t20-staff-unknown.browser.tap
taps/base-30eb/t28-followup-input.browser.tap
taps/base-30eb/t37-shared-follow-up-drawer.browser.tap
taps/base-30eb/t37-shared-time-card-list.browser.tap
taps/base-30eb/wbint-t15-review-start-restoration-boundaries.browser.tap
taps/base-30eb/wbint-t16-attachments.browser.tap
taps/base-30eb/wbint-t27-bounded-pages.browser.tap
taps/base-30eb/wbint-t34-follow-production.browser.tap
taps/base-30eb/wbint-t34-follow-recovery.browser.tap
taps/base-30eb/wbint-t40-reminder-first.browser.tap
taps/base-30eb/wbint-t40-reminder-locate.browser.tap
taps/base-30eb/wbint-t40-reminder-preferences.browser.tap
taps/base-30eb/wbint-t40-reminder-recovery.browser.tap
taps/base-30eb/wbint-t43-incident-delivery.browser.tap
taps/base-30eb/web01-workbench.browser.tap
taps/fail/arch-006-rule-first-service-loop.tap
taps/fail/pc-admin-card13.browser.tap
taps/fail/pc-admin-card16-arrivals.browser.tap
taps/fail/pc-admin-card29.browser.tap
taps/fail/pc-admin-card31.browser.tap
taps/fail/t04-self-handling.browser.tap
taps/fail/t05-conversation-handling.browser.tap
taps/fail/t06-assignment-memory-recovery.browser.tap
taps/fail/t06-assignment-recovery.browser.tap
taps/fail/t07-draft-recovery.browser.tap
taps/fail/t07-legacy-recovery.browser.tap
taps/fail/t10-privacy-boundaries.browser.tap
taps/fail/t11-completion.browser.tap
taps/fail/t12-draft-recovery.browser.tap
taps/fail/t12-raw-off-unknown.browser.tap
taps/fail/t12-targets-read-loss.browser.tap
taps/fail/t20-staff-post200-context503.browser.tap
taps/fail/t20-staff-unknown.browser.tap
taps/fail/t28-followup-input.browser.tap
taps/fail/t37-shared-follow-up-drawer.browser.tap
taps/fail/t37-shared-time-card-list.browser.tap
taps/fail/wbint-t15-review-start-restoration-boundaries.browser.tap
taps/fail/wbint-t16-attachments.browser.tap
taps/fail/wbint-t27-bounded-pages.browser.tap
taps/fail/wbint-t34-follow-production.browser.tap
taps/fail/wbint-t34-follow-recovery.browser.tap
taps/fail/wbint-t40-reminder-first.browser.tap
taps/fail/wbint-t40-reminder-locate.browser.tap
taps/fail/wbint-t40-reminder-preferences.browser.tap
taps/fail/wbint-t40-reminder-recovery.browser.tap
taps/fail/wbint-t43-incident-delivery.browser.tap
taps/fail/web01-workbench.browser.tap
tests.md
```

</details>
