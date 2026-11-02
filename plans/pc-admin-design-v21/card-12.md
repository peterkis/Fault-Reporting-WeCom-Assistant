# 卡 12 · 工单卡片 v2.1

## 2026-11-02 用户命令触发的 main 同步

- 已收到用户明确「同步main」命令。同步前工作区干净，发布 head 为 `c9f9976628bcb2e0e99c8e5a877754ecf9d6ddd3`，建立恢复引用 `refs/recovery/pc-admin-v21-card12-pre-sync-20261102-c9f99766` 保留原三次提交及其测试/审查身份。
- 执行 `git fetch origin`、`git rebase origin/main`，新基线 `deb85af9a5da7fa7b27c21c743936191cd017207`（卡 14 #132 与卡 15 #133 已合入）。三个本卡提交无冲突重放；`range-diff` 三项均为 `=`，未修改其它卡归属文件，也未恢复任何旧组件/Token 名。
- 重放映射：`28477d46 → c1286726`、`a3354b15 → 108e89d0`、`c9f99766 → 545f837a`。旧 head 不重绑为新运行；其完整提交链与历史 FAIL/NOT_RUN 保留。
- 重验计划：Stylelint/feature ESLint → 一次 migration:build → strict/negative types → 本卡 11 个注册入口及主线新使用共享 TicketCard 的 conversation-inbox 浏览器入口 → artifact / 文档工具 / 自有资源释放。使用本任务 loopback PG18、每例新 UUID 合成库及模拟发送；不执行 full/certify、Electron 原生、现场、部署或 Gate。
- 只有全部适用检查与新 head 审查/CI完成后才合并。重验后使用 force-with-lease 更新本分支，并在 PR 记录新基线、无冲突清单与实际结果。主线正常场景无像素变化，按影响核对工作台及新主线会话迷你卡，不重写旧截图身份。

- 基线：`origin/main@bf5073db934348046155e006873b50075e7a1ac2`；前置卡 9 #129、卡 10 #130、卡 11 #131 已合并。
- 唯一写者：本会话；worktree `D:/worktrees/pc-admin-v21-card12`，分支 `codex/pc-admin-v21-card12`。卡 14/15 属于其它活动会话，保留其资源。
- 范围：[设计方案 §4.1](../../docs/ui/design-system-v2.1.md#41-团队工作台现在最该先处理哪一张)、原型 01；卡片类别、热度、缺失收纳、领取入口、已加载数据筛选及领取成功动效。
- 用户于 2026-11-02 确认补充：普通接单复用原控制器直接提交；沟通责任/处理组选择仍打开原合法表单。保留原 UUID、版本、UNKNOWN 核对；高级搜索模式不含类别，禁用类别筛选并提示。类别和处理人仅筛选已加载数据，不向原查询添加参数。
- Token/heat/category-map 归卡 9，不在本卡修改。选中底色复用现有 `--bg-selected`（#EEF4FD）；任务指定 #F5F9FF 尚无语义 Token，按文件归属规则列入后续小 PR。
- 无数据库、后端、合同、依赖、业务命令、状态值、权限策略或持久 Feature Flag 变更。原功能关闭方式保持，可用独立 revert 回退。

## 验证计划与当前结果

- Node 24.18.0；自有 loopback PG18：55472，fixture 每次新建 UUID 合成数据库；不连接真实 Sender。证据根 `D:/CodexEvidence/pc-admin-v21-card12-20261102`。
- 原始基线构建 PASS：913 个语法校验、2747 输出。基线四宽 1920/1440/1280/900 截图 PASS，页面无溢出，POST=0；基线采图浏览器与 fixture 数据库已清理。
- 最终源码冻结后：Stylelint/ESLint → migration:build → strict types → 相关活动 v3-p09 注册入口与工具 → artifact → 自有资源释放。四宽真实 bundle/HTTP/PG 合成截图与原型并排，记录彩色面积口径。
- R2 正式候选本地验证：11 个注册入口 70/70 PASS，四宽采图 PASS；整屏面积 8.36% / 9.25% / 9.12% / 11.67%，全部进入 8–12%。远端发布、审查与 CI 在 PR 中独立记录。full/certify、Electron、现场、部署与 Gate 为 NOT_RUN，不以本地或 CI 结果替代。下文逐候选失败保持原身份。

## 2026-11-02 动效范围更正

用户明确撤回本卡额外引入的系统“减少动效”判断、专用测试与交付表述。实现保留卡片 hover 上浮 1px、原 `--shadow-2` 与 `--dur-base` 180ms 官方换列动画；删除本卡新增的 `matchMedia('(prefers-reduced-motion: reduce)')` 判断及测试分支。既有基础 CSS 规则不重写，不新增管理端设置。对应设计方案 §4.5 已同步。

第一候选的 build、strict types、Stylelint/ESLint 通过；第一轮相关注册批次失败及后续 NOT_RUN、浏览器退出超时和旧专用测试失败原件保留，不作为修订后候选的验证结果。

首轮原件：`build-1.log` / `types-1.log`；`registered-tests-1/` 的新增入口先报告 5 FAIL，随后触发原 240 秒文件截止，另外 8 个入口 NOT_RUN。首项是测试内整页导航丢失请求计数探针，领取项则缺少真实前台激活，程序聚焦未触发入口。隔离原路径观测中 `Page.bringToFront` 后，真实合法动作包含 `take-and-start`，原控制器及 secondary「领取 E」立即出现。后继补测试前提，不放宽原命令、版本、次数、回执或失权断言；保留截止，不扩大超时。尝试停止批次时进程已自然退出，纠正记录见 `tests-1-interruption-observation-correction.json`；本任务残留 UUID 合成库已精确删除，未动其它会话资源。

首轮四宽原始图片已生成；采图退出时出现 `OWNED_PROCESS_CLOSE_TIMEOUT`，该次不记全程 PASS。外部采图夹具的服务类别数组漏了第 13 项，另有一次临时脚本语法错误，失败日志均保留，修正夹具不改业务实现。

第二候选输入 `f99b5e52eb271d4e74bbd5aabae00b6f0c87b13d05c21131732eb5093944cfec`：build、strict/negative types、Stylelint/ESLint、指令工具 19/19 与历史工具 22/22 PASS。新增正式浏览器入口 6 项中 2 PASS / 4 FAIL：类别/状态热度/缺失资料/只读筛选、复杂责任原表单通过；普通鼠标与 E 的真实接单及官方换列已通过原命令断言，但 180ms 动画断言失败。三列异步重读期间，旧列先删除事项会过早清掉呈现坐标，后继保留到整个读取批次结束，不保留 DTO 或改变官方列。UNKNOWN 用例实际已出现原核对按钮，刷新点击被通知浮层挡住，后继先关闭提示再刷新，原 UUID/请求次数断言保留。失去全部角色后原命令实际返回 401，后继用精确 401 断言，不改成放宽状态码集合；工单/责任/版本/事件不变断言保留。该候选失败原件在 `registered-focused-2/`。

领取状态只保留事项身份与入口引用；卡片卸载即释放入口 DOM，原操作控制器留在固定位置。当前声明不代表后继候选已验证，修补后重新执行实际检查。

第三次构建已完成；随后恢复已处理日期控件到原共享筛选容器，仅新增行内日期入口，保持旧控件与测试辅助的展开路径；本卡不修改共享测试辅助。相关集合补入正式已处理日期回归。换列回归显式延迟已完成的 active GET 在客户端的交付，先观察 pending GET 删除原卡后再释放，以验证异步列次序的修补。原命令、响应正文和业务断言保持。既有粗指针 44px 目标保留；未新增动效偏好能力。

第四候选输入 `a34788194f0536915c43c00286f9df129c97a0ef9ff5bd178cfdfdc5ef88f1b2`：build、strict/negative types、Stylelint/ESLint、artifact PASS；新入口 4 PASS / 2 FAIL，UNKNOWN 关闭提示→刷新后原 UUID 核对、失去角色后精确 401 与零事实变化均通过。动画仍失败，实际正式 CSS 查明 `--dur-base:.18s`，直接 parseFloat 错算为 0.18ms；后继按 ms/s 换算为 Web Animations 的毫秒，保留精确 180ms 断言。旧 `registered-focused-4/` 失败不改写。

第五候选输入 `82e9f25bf7bb1b05c9f1d88fbfa20e65b5e47107d2ac4a0d238a3b5e1a6d2f4a`：新增入口 6/6 PASS、build/types/artifact/Stylelint/ESLint PASS。扩展回归已执行两个文件 31 PASS / 2 FAIL，后续 7 入口 NOT_RUN；原看板的 border=0 几何断言与有效群名回读断言失败。后继用 1px inset outline 表达整卡紧急描边，保留 border=0 和无布局抖动；已登记的有效群名保留，只收起缺失占位。原测试不改，版本、权限、XSS、请求与回执断言全部保留。原件 `registered-related-5/`。

第六候选输入 `7d4bd71674c84a967039167af11a311beda5b121386b6800dbf46d237e7461d8`：build/types/artifact/Stylelint/ESLint PASS，扩展两个文件 32 PASS / 1 FAIL，后续 7 入口 NOT_RUN；有效群名、维护后回读、长内容、XSS、权限等原回归通过。剩余失败是原“四个直接子行”DOM 断言，瓷砖曾作为第五个子节点；后继把瓷砖收入编号行，仍呈现四行、左侧 28px 类别列，原断言保持不变。原件 `registered-related-6/`。

第七候选输入 `32946032d9aba73e9a606c31386be530895bc7b5d65d654c9d64ac142c18458b`：build/types/artifact/Stylelint/ESLint PASS；9 个相关注册入口 58 PASS / 1 FAIL，0 SKIP/NOT_RUN。前 8 入口全通过；追加的日期文件原先未在活动 v3-p09 中，旧浏览器用例按 latest-first 断言 UUID 顺序，而卡 10 已确认默认 oldest-first。原排序 helper 与卡 10 基线逐字相同，本卡不改产品排序。日期用例只补现有“最新到达”实际菜单操作，原精确 UUID 数组、日期边界、权限及 writes=0 断言全部保留，并加入活动 selection 防止再次漏跑。该额外检查失败与后继前提适配如实保留，不把顺序断言改成集合比较。原件 `registered-related-7/`。

日期用例同步卡 8 已确认的计数呈现位置：精确“已加载 4 项”从可见正文改在列尾 title 核对，仍断言当前已加载恰好 4 项。未改日期、授权、请求或写入次数期望。第八次构建输入 `d5d480a0d73a6c3804252a0f65823ed5d0796894ed4cb7e5841747e0855e91c5` 保留，随后仅完成这处旧文案呈现前提适配，重新冻结最终候选。

## 用户确认的语义底色扩展

用户选择“扩大语义底色，继续调整至目标”，不接受把原 4.51–6.43% 作为面积偏差收口。已据此补充设计方案 §4.1，并修改 BoardSummary 的纯 CSS：宽屏四张概况卡着色，两列布局仅待受理/已超时着色，所有背景/前景来自既有 stage/tone Token。选中态继续使用原品牌描边与选中底；统计、权限、尺寸、请求与默认 Flag 不改。

同一真实 fixture 的临时 CSS 覆盖预览（明确非最终制品）四宽估算为 8.36% / 9.25% / 9.12% / 11.67%；页面无横向溢出、primary=1、POST=0、资源回收。原件 `screenshots-color-preview/`、`color-estimate-preview.json`；原基础候选记录为 `color-estimate-initial.json` / `comparisons-initial/`。后续重新构建正式制品并重验，不把预览当作正式通过证据。

## PR #134 首轮审查与 R1

发布 head `28477d460261e1e144224a90587f7bd224afb43e` 已推送并请求 Codex 审查。首轮返回 P1（入口关闭/同账号授权版本更新卸载 UNKNOWN 控制器）与 P2（处理中缺少状态时间时错误回退创建时间）。原正式制品上独立诊断三项均 RED：关闭 board capability、实际新增同账号角色导致真实 authorization_revision 更新时，原控制器均被卸载；缺席状态时间的旧工单显示虚假 danger 热度。原件 `review-red-probe-2.log`；首探针因返回 DOM 对象触发序列化错误的日志另保留，不作为产品 RED。

R1 将入口可见性与原操作生命周期分开：原控制器按 principal_id + Ticket 身份保持稳定，固定原控制器种类；当前入口能力或授权版本变化只撤下新入口。主体变化仍卸载，可信 READ/权限拒绝继续沿原清理与原终检。入口关闭后保留导航栅栏，详情/领取阻塞分别持有并合并，不覆盖彼此。P2 按 §3.2 澄清，处理中缺少 stage_entered_at 时不显示热度，催单/复核等真实语义描边保留。原 command/send/submit/API 序列化及业务状态机不改。新增三项注册浏览器回归，待本候选实际重验后记录 GREEN。

R1 首构建 / strict / artifact / lint PASS。新增入口 2 PASS / 1 FAIL，关闭入口及缺失状态时间场景 GREEN；授权版本变化场景的原控制器、核对入口与无自动重放断言均通过，后续导航测试读取授权重读期间的空 DOM 报错。后继仅等待新的获权卡片真实可见后继续原导航/UUID/版本断言，不改生产代码或业务期望。原日志 `registered-r1/` 保留；后续十个入口按该批次停止状态为 NOT_RUN。

首轮证据保护 CI [41434073536](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41434073536) 的发布身份预检 PASS，差异检查因 main `cdf4803a…` 不是当前 head 祖先而 FAIL；未修改保护检查。该同步动作按用户明确要求等待“同步 main”命令。首轮业务 CI 与各后继发布 head 独立核验，原 FAIL/CANCEL/NOT_RUN 保留。

## main 同步触发条件

2026-11-02 用户重申：完整同步流程等待其明确的「同步 main」命令；不因其它 PR 合并自行启动。收到命令后先保全当前改动（本分支提交或 stash），再 `git fetch origin`、`git rebase origin/main`。本卡文件冲突保留本卡改动及 main 新内容；其它卡文件以 origin/main 为准，所需例外写入 PR；前置组件/Token 改名后沿用新名称。

随后重跑 Stylelint、feature ESLint、migration:build、strict types、artifact 与本卡相关注册测试，使用 `git push --force-with-lease` 更新既有分支，在 PR 留言完整新基线 SHA、冲突清单/处理方式及实际验证结果；只重拍受影响页面。到达需同步步骤时等待命令，不自动执行这条流程。

## 本地交付结果（2026-11-02）

实现对应 v2.1 §3.2 / §3.3 / §4.1 与原型 01：28px 类别瓷砖、服务 tooltip、四行卡片、最多两行标题、有值元信息与中性“资料不全”、统一 heat.ts 热度、1px 整卡 urgency outline、已处理时间、选中/悬停、获权“领取 E”与官方换列后的 180ms 动画。普通领取复用原 TicketSelfHandling；复杂责任复用原 BoardActions 合法表单。原控制器固定挂载，卡片卸载只释放入口 DOM；UNKNOWN 保留原 UUID、动作、版本和核对入口。

类别目录通过已有只读接口和原 readWorkbench 传输读取，严格闭合解码、总量最多 200；401/403 沿原身份处理。类别与处理人只筛选已加载数据，未向原 board/search 发送新参数。高级搜索仍沿原条件，类别筛选不可用。处理人筛选依现有显示名，同名合并，不用于写命令选人。

### 文件清单

| 文件 | 用途 |
| --- | --- |
| `app/pc-admin/src/api/client.ts` | 只读 service / stage_entered_at 解码 |
| `app/pc-admin/src/app/Workbench.tsx` | 卡片呈现、局部筛选、原入口装配 |
| `app/pc-admin/src/design/components/TicketCard/TicketCard.tsx`、`ticket-card.css` | 瓷砖、热度/完成、四行、整卡描边与悬停 |
| `app/pc-admin/src/design/components/Toolbar/toolbar.css`、`BoardSummary/board-summary.css` | 行内筛选与语义概况卡的窄屏布局 |
| `app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx` | 处理中排序说明去掉已失效的待补齐文案 |
| `app/pc-admin/src/design/use-board-card-motion.ts` | 仅保存呈现坐标，官方换列后 FLIP；ms/s Token 单位归一 |
| `app/pc-admin/src/features/board-filters/client.ts` | 只读目录白名单与预算解码 |
| `app/pc-admin/src/features/board-actions/BoardActions.tsx`、`board-actions.css` | 获权悬停/E 入口、原表单、原手柄/更多操作 |
| `app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx` | 原提交/核对控制器的可选 portal 展示 |
| `tests/pc-admin-card12.browser.test.mts`、`pc-admin-card12-review.browser.test.mts` | 六项基础及三项审查修补正式 HTTP/PG/制品浏览器回归 |
| `tests/web01-closed-range.browser.test.mts` | 旧排序交互前提及卡 8 tooltip 文案位置适配，原业务断言保留 |
| `plans/typescript-migration/test-routing.json` | 新入口登记；补日期回归进入活动 selection |
| `docs/ui/design-system-v2.1.md` | 用户要求的动效范围更正 |
| `docs/ui/evidence/v21-card12/r1/compare-{1920,1440,1280,900}.jpg`、`hover-*.jpg` | 四宽前后/原型及获权悬停截图 |
| 本文件 | 独立范围、验证、偏差、失败与收口记录 |

### 验证与来源

- 本地 R2 冻结输入：`68f1b1cd70cc865aaa08da67a08adae4f5b90c47c2182a0738ee5ec85c6c27a3`，基于发布祖先 a3354b15 上的未提交修补工作区；后续仅追加本记录和截图，不把本地运行重绑为将来发布 SHA。
- `npm --prefix app/pc-admin run lint:css` / `lint:features`：0 / 0；Token gate：0 未定义变量。设计机械检查为空数组。
- `npm run migration:build`：915 个实际 Node 语法检查 / 2751 输出，STAGED_NOT_ACTIVATED。`node .build/tools/gate.mjs types`：strict / negative types PASS。
- `node .build/tools/verify-artifact.mjs`：ARTIFACT_VERIFIED_NOT_ACTIVATED；manifest SHA-256 `41b4c098ba992f5f4fd94988139dc51d2741d9d3b9a092fa1cf363150ee4ef27`。
- 活动 v3-p09 的 11 个相关注册入口，同一 manifest：日期 2/2、既有工作台/合同/合法动作等 8 文件 57/57、卡 12 入口 6/6、审查新增 5/5，合计 **70/70 PASS，0 FAIL / CANCELLED / SKIP / TODO / NOT_RUN**。不是活动全集或 full/certify。R2 原件：`registered-r2b/`、`local-build-manifest-r2b.json`、`local-artifact-proof-r2b.json`；此前各候选原报告另保留，不混用 manifest。
- `docs:agents:check` PASS，指令工具 19/19 PASS；历史工具 22/22 PASS。原业务 API 对象（含请求序列化）、TicketSelfHandling mutation/send/submit、BoardActions 终检主体与基线逐字哈希相同；无 server / contracts / config_examples / package / lock 改动，见 `unchanged-commands.json`。
- 原始 manifest、artifact proof、所有 FAIL / NOT_RUN、日志和 PNG 在本任务证据根保留。PR 完整发布 head 的审查与 CI 必须独立记录。

### 四宽截图与度量

四宽均为真实正式 bundle + 既有 HTTP/PG fixture，仅合成数据。Before 使用 bf5073db 编译的独立静态 bundle 与同构合成事实；After 使用最终本地正式 bundle；原型由用户原件解包渲染，不修改原 HTML。四宽页面级横向溢出均 false、primary 均 1，采图 POST=0。900px 保留既有看板内部横向滚动；类别、处理人、日期在窄屏第二行，1280px 及以上同一行。

| 宽度 | 前后与原型 | 悬停入口 | Before 彩色面积估算 | After |
| --- | --- | --- | ---: | ---: |
| 1920 | [对照](../../docs/ui/evidence/v21-card12/r1/compare-1920.jpg) | [领取 E](../../docs/ui/evidence/v21-card12/r1/hover-1920.jpg) | 4.00% | 8.36% |
| 1440 | [对照](../../docs/ui/evidence/v21-card12/r1/compare-1440.jpg) | [领取 E](../../docs/ui/evidence/v21-card12/r1/hover-1440.jpg) | 4.45% | 9.25% |
| 1280 | [对照](../../docs/ui/evidence/v21-card12/r1/compare-1280.jpg) | [领取 E](../../docs/ui/evidence/v21-card12/r1/hover-1280.jpg) | 4.42% | 9.12% |
| 900 | [对照](../../docs/ui/evidence/v21-card12/r1/compare-900.jpg) | [领取 E](../../docs/ui/evidence/v21-card12/r1/hover-900.jpg) | 5.46% | 11.67% |

方法：原始 1080px 高 PNG 中与阶段、紧急描边、有彩类别、非中性 tone、品牌 Token RGB 各通道相差最多 1 的像素占整幅视口比例；不计未分类/中性类别底。包含留白，属于可复算的近似值，不是感知色彩验收。R1 正式原件 `color-estimate-r1.json` / `screenshots-manifest-r1.json`；原始不足目标的版本另保留。四宽新增浅底文字对比度均 ≥5.29:1，实际选中背景/品牌描边与 Token 一致，点击筛选再取消恢复原九张卡，POST=0。

### 规范偏差与后续

- **用户已选择继续达标设计**：基础候选面积 4.51–6.43% 的原件保留。扩展概况卡语义浅底；宽屏四卡着色，两列布局仅待受理/已超时整卡着色，其余维持白底和原图标块。仅复用现有 Token，选中态仍用品牌描边与原选中底；不改变统计、权限和筛选。正式结果为 8.36% / 9.25% / 9.12% / 11.67%；新配色候选独立完成 65/65、strict、artifact 与四宽验收，未重绑原结果。
- 选中卡复用既有 `--bg-selected` #EEF4FD；指定 #F5F9FF 尚无语义 Token，卡 9 文件归属限制保持，后续单独小 PR 可补 `--bg-card-selected`。
- 概况条统计与处理中排序继续沿卡 10 的既有口径，本卡只接入卡片热度，不把已加载局部筛选称为全量查询。
- 卡 15 已由另一会话经 [#133](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/133) 合并，本会话未改其文件/资源。卡 16 仍须本卡合并；卡 13 的卡 10/11 前置已满足，但本次不启动后续卡。

### 逐项自检

| 项目 | 结论与证据 |
| --- | --- |
| 无业务命令、状态值、权限判断变更 | 是；只读字段/目录与呈现入口；原 command/终检主体哈希相同，65 项真实回归 |
| 选择器只增不删，测试无业务断言放宽 | 是；class / data-* 保留；原日期精确 UUID、边界、权限、writes=0 不变，仅补现有排序交互和 tooltip 文案位置；新增断言覆盖原 UUID 与一次 POST |
| 新颜色经 Token，Stylelint / ESLint 0 | 是；复用 category-map、heat、stage/tone/ring Token，0 / 0 |
| 每处新增彩色有阶段/紧急/类别/人含义 | 是；类别瓷砖、等待热度与描边、完成时间、原稳定头像；交互蓝沿已确认选择样式 |
| 卡片无缺失占位堆叠 | 是；有值元信息，缺至少两个关键字段为一个 neutral 资料不全，四宽及新回归核验 |
| 每区域唯一 primary | 是；获权新报修唯一 primary；领取为 secondary sm，四宽 primary=1 |
| 热度阈值集中 heat.ts | 是；直接调用 heatOf，组件未复制 5/20/60/240；状态时间明确 +08:00，不用 updated_at 计热度 |
| 四宽与原型并排核对 | 是；四份对照、四份悬停、原始 PNG 与哈希 manifest；正式面积均为 8–12% |

自有合成数据库已全部清理，PG18 已停止（status=3，55472 监听=0），浏览器/HTTP/命令计时器/套接字均回收。停止的可再生环境与 worktree 暂保留；报告、失败、NOT_RUN、原图与用户原型保留。分支/工作树/main 同步遵循上文用户命令触发条件。


R1b 正式重验完成：新增三项 3/3 GREEN，11 注册入口合计 68/68 PASS（FAIL/CANCEL/SKIP/TODO/NOT_RUN=0），strict/negative types、artifact、Stylelint/ESLint 0/0、文档与19项工具 PASS。R1与R1b的1255个非测试输出逐字一致，仅补正确的获权DOM就绪等待。R1四宽面积仍为8.36% / 9.25% / 9.12% / 11.67%，对比度/选中态/0 POST及资源回收通过；新图片放r1子目录，原图片保留。发布后复审与CI独立核验。

R1 发布 head `a3354b15b8d84747157d88118932dd7af192b488` 的复审新增对象 READ 拒绝清理 P1。可信 ticket-command-context 403/404 清缓存后，独立控制器仍持有 UNKNOWN；受控真实 HTTP 后的 404 拒绝边界探针已 RED（`read-denial-red-2.log`），首次探针因本任务 PG 已停止而启动失败的日志另留，不作为产品 RED。R2 只订阅当前主体/当前 Ticket READ 查询的新 error 事件：可信 401/403/404 卸载原控制器并释放 pending/导航栅栏；入口关闭、授权版本重读、写权限拒绝及网络/503 不作为对象 READ 拒绝。新增精确 403/404 回归，原两项能力/版本保留与原 UUID 核对继续验证。未改业务权限、请求或回执实现。

原发布祖先28477d46的业务CI [41434073553](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41434073553)成功：247入口/803 tests全PASS，0 FAIL/CANCEL/SKIP/TODO/NOT_RUN；下载归档SHA-256及CRC通过，741份回执与149张截图哈希/尺寸、当前runtime加载记录47447项哈希、manifest/proof/源码head均核验，剩余合成库为空。其它加载记录仅归档，不将其称为当前runtime哈希核验。此结论只属于原祖先，不替代R1的独立CI或消除待同步的证据保护失败。


R2b 正式结果：11注册入口70/70 PASS，0 FAIL/CANCEL/SKIP/TODO/NOT_RUN；五项审查回归含原两项保留、缺失时间及可信HTTP 403/404 READ拒绝清理全部GREEN。strict/negative types、artifact、Stylelint/ESLint 0/0、19项工具与文档检查PASS。新的清理只观察该主体/该Ticket READ查询的fresh error.action，忽略缓存重置、入口变化、写拒绝及临时失败。正常场景CSS/四宽布局未改；`screenshots-r2/`再次验证四宽对比度/选中态/0 POST，面积仍8.36% / 9.25% / 9.12% / 11.67%，复算结果`color-estimate-r2.json`。R1原PNG及脚本另存，未覆写；READ拒绝首探针的PG停止启动失败保留，第二次真正RED单列。当前发布后复审和CI仍独立核验，main同步继续等用户命令。
