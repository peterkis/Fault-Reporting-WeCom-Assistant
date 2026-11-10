# 绿色旧版管理端退役

Issue：[145](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/145)。原生依赖#144已在PR #146以merge commit 76af1e9e0219bee13d752cda0b3fa99b054c153a合入并完成；本票独立worktree codex/pc-admin-legacy-retirement基于该最新origin/main开始。

## 已确认决定

新PC当前流程是唯一保留功能依据，不迁移或复刻旧页独有流程。正式PC旧/workbench（含尾斜杠）及/workbench/lifecycle以302/no-store跳新PC首页；旧/workbench/incidents跳新PC候选页，旧静态资源404。裸G1只有原API/SSE，不跳向未装配的PC。共享认证、业务命令/查询、状态、权限、原UUID和UNKNOWN恢复不删除；默认Flag不变，无迁移。

## 退役与替代覆盖

web/p2-workbench全部10个文件、专属preview脚本/两条npm命令、旧资源登记和旧HTML读取已移除。保留共享HTTP静态Port接口，裸G1默认未处理；正式P2-016装配该处仅处理入口跳转，P2-012不再额外挂载旧Incident HTML/JS。新PC错误页使用现有扫码入口，通知异常详情删除旧页处置链接/承诺，不新增重试核对流程。

八个旧DOM专属MJS测试物理退役，在test-routing.json逐条记录Issue、原因及当前覆盖。原始207历史队列数、72条原别名命令、固定历史checkout不改；loader仅允许原历史队列中实际含旧UI浏览器启动的已退役文件，并验证该文件不再活动、替代入口存在、无重复/空替代。缺登记或任意移除仍失败。旧别名只在调度时去重转到所声明当前入口，不冒称复刻旧业务流。

混合测试保留HTTP/PG权限、CSRF、版本、门禁、通知次数、持久状态及恢复断言，只撤旧DOM步骤；网关故障下的真实接单改走原HTTP并保留重连/原通知次数。G1浏览器Cookie/安全遥测测试保留；时区矩阵改编译新PC实际formatter，在三时区运行相同输入。制品篡改/缺资源守卫改用仍有效的Schema资源，未降低制品/库存保护。P2-016/P2-012冻结祖先验证器及原证据不改写；其中旧路径属于原对象，不是现行UI挂载。

## 验证风险与停止条件

本票实际影响路由/静态挂载、当前前端入口、验证器资源与测试生命周期。按ADR-0053选择计划并集，加直接受影响的HTTP、旧别名调度、时区、新生产bundle以及登录/退出/恢复入口验证。覆盖302/no-store、404无旧资源、裸G1无不存在目标、真实新PC导航/安全文本、只读异常无POST/额外Sender，以及退役登记负例。适用检查完成即停止，不因旧名称自动执行full/certify、现场、真实发送、部署或Gate。

当前为实施候选；后续实际源码/manifest、检查结果及FAIL/NOT_RUN按对象独立记录在D:/CodexEvidence/pc-admin-n3-retirement-20261104/，不预称通过。用户主工作区5份原件、原型画布和历史Evidence保留。


## 准备、前置失败与直接风险首轮

初次build在布局库存前置拒绝删除原preview脚本（MIGRATION_LAYOUT_SOURCE_MISSING），未开始应用编译。保留原382项布局映射和原历史207测试队列、72别名数量；只为已授权退役的绿色preview追加严格专用生命周期记录，任意业务源码缺失仍失败，preview复活也失败。当前工具层新增负例并将布局测试加入所选toolchain。后继严格build成功（919 typed，341 legacy，2739 outputs），没有恢复旧文件绕过库存。

首轮新入口真实HTTP/生产bundle两例PASS：正式PC四入口302/no-store、七静态资源404、裸G1无不存在跳转、当前新PC导航与XSS文本安全、异常详情无旧处置承诺/POST/额外Sender。随后报告器拒绝新增截图目录/文件名不在既有白名单，尚余10入口NOT_RUN。仅调整为原UUID目录、实际1280视口和标准new-detail-1280文件名，不放宽截图范围/尺寸/哈希检查；原日志/截图保留。

第二轮直接风险33PASS/1FAIL、剩1入口NOT_RUN（桌面Session）：所有入口/时区/HTTP等首段通过；网关故障恢复的原精确SDK次数断言先于真实投递SENT到达。原来依靠旧UI等待“已发送”，去掉旧DOM步骤后缺少等价等待；补以同一Ticket/TICKET_ACCEPTED实际Delivery持久SENT条件后再检查原精确SDK增量、PENDING/恢复、原通知唯一绑定等全部断言，不加任意sleep、不改状态/权限/次数。原失败保持b-direct-2报告对象，后继结果另记。


## 修复后直接风险结果

43977c48候选的首次命名修正后直接检查33PASS/1FAIL保留；4cccc2cc438dd6b6b68fbfe7581de53610b040ce7b6b6122eecdb04c6b7d017d候选补齐真实SENT等待后，11入口45/45 PASS、0失败/取消/SKIP/TODO、NOT_RUN空，含现有桌面Session/登录/退出11例；布局生命周期12/12 PASS，72原别名全展开且无空集合。67个实际差异路径的显式文档链接检查issues=[]；固定导航检查另记，未用空committed diff代替差异覆盖。

所选影响计划68入口，加入直接风险后去重并集71入口，工具层七类保护检查独立执行中；不预称最终整票PASS。原输出、失败/NOT_RUN、差异及源码身份见同一外部Evidence目录。新增UI只验证现有PC安全渲染和只读导航，不补回旧业务流；新PC/h5成员端/API底线仍由对应实际检查证明。

## 后续退役：P2-G1 Replay Gap 浏览器用例（2026-11-10）

背景：`tests/p2-g1-human-only-assembly.integration.test.mjs` 里的「P2-G1 isolated PostgreSQL Replay Gap drives real Edge…」仍由 `app/server/scripts/p2-g1-replay-gap-e2e.mjs` 驱动旧绿色工作台 DOM（`.conversation-card`、`#conversation-view`、`#composer`）。按本票决定裸 G1 只保留 API / SSE，不提供页面，`/workbench/app/` 返回 `WORKBENCH_NOT_FOUND`，所以该用例在 main 上必然以 `P2_G1_TEST_BROWSER_COMMAND_TIMEOUT` 失败；它只在测试文件被改动时被 CI 选中（卡32D-L #175）。

替代覆盖（先补后退）：

| 原用例断言 | 当前覆盖 |
| --- | --- |
| EventSource 带 Last-Event-ID 续传、遇保留期缺口返回 410 | `wbint-t38-gap.browser` 两例：真实清理保留期后，生产包续传携带旧游标并收到 410 |
| 410 后重读列表 | 新增用例：看板 + 抽屉，在 410 之后实际 GET `/api/workbench/board` |
| 410 后重读详情与时间线 | 两例：缺口后的事实出现在时间线；新增用例另断言 410 之后有该事项的详情 GET |
| 时间线不出现重复条目 | 新增用例：缺口前后两条事实在时间线中各出现一次 |
| 新连接不携带旧游标 | 两例：410 之后的 SSE 请求不带 Last-Event-ID |
| HTTP 层 410 与回退 | `p2-003-realtime-event-log.integration`（`replay_gap_http_fallback`） |

退役内容：

- 删除该浏览器用例与 `app/server/scripts/p2-g1-replay-gap-e2e.mjs`，以及 npm 命令 `p2:g1:replay-gap` / `p2:g1:replay-gap:check`。
- `p2-g1-check` 的源码存在清单去掉该脚本；`scope.json` 的 `retained_existing_tooling` 去掉该脚本；静态测试改为断言脚本与命令已退役、替代用例存在。
- `backend-layout.json` 增加第二条写死校验的退役记录（`LEGACY_GREEN_UI_REPLAY_GAP_RETIRED`，Issue 145），复活或缺登记仍失败。
- 同文件另外 7 个 G1 用例保留不变。`p2-g1-browser-sessions` 仍被 P2-G1 / P2-012 / P2-016 现场脚本与资源观察脚本使用，不在本次范围；这些人工现场门禁不因本次退役自动执行。
- 历史证据、CHANGELOG 与 P2-G1 交付文档中 2026-09-02 的 Replay Gap 通过记录如实保留。
