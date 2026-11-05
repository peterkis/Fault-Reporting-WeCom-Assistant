# 卡 25B：会话计数与等待时长

## 范围与前置

2026-11-05，本地分支 `codex/pc-admin-v216-card25b`。开始前已 fetch `origin/main` 并确认 main 与远端均为 `4ca9a7002c688341bd6fabca1b91ae8fc8a59803`；GitHub 实际记录确认卡 24 PR [#150](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/150)、卡 25A PR [#151](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/151) 已合并。该分支以此 main 创建，初始工作区干净。

依据 [ADR-0054](../../adr/0054_conversation_inbox_counts_and_waiting_since.md)、[25A 执行记录](card-25a.md)和[设计规范](../../docs/ui/design-system.md)实施。A1 可可靠推导，因此实施 B3、B4。25A 合并版本以 `include_waiting_since=true` 显式启用等待字段，旧请求仍保留原键集合；本卡仅更新实际 inbox/chat/related 读取与解析，不修改后端或契约。

只做前端只读展示；不改权限、命令、投递、依赖或迁移。按本次 25B 授权停在本地验证与交付，不提交、推送或创建 PR。唯一写者为当前会话，合成运行使用自有 loopback 测试库和浏览器，不使用现场数据。

## 编号清单

- B1：已完成。标题使用账号级 summary；辅助失败和零人数隐藏，不弹错误；查询键不含队列、来源、搜索或分页。真实浏览器断言筛选后数字不变、summary 请求数不增加。
- B2：已完成。侧栏复用同一缓存，18px 实心品牌色徽标、99+、完整未读 aria-label；折叠为 8px 圆点。真实 Cursor / SSE 场景未读由 139 降至 35，等于服务端 summary。
- B3：已完成。只用服务器 `waiting_since`；复用 heatOf 的 5/20/60/240 阈值和时间文字，低于关注阈值用次要色，60 分钟关注，240 分钟危险，24 小时起按天；空起点保留原列表时间。12 分钟 / 2 小时 / 5 小时的文字、实际颜色及已领取普通时间通过断言。
- B4：已完成。保留卡 24 单行省略与接待动作，等待横幅使用详情起点，危险时长单独着色；空起点保留原文案。横幅文案和危险颜色通过断言，1440 / 1920 截图已核对。
- B5：已完成。summary 放入既有 `conversation-inbox` 族，标题与侧栏共用账号缓存；既有实时失效同时刷新。工作台和会话复用可见性分钟订阅实现，隐藏暂停、恢复立即重算，计时不发请求。真实领取人数 6→5、等待消失；假时钟 12→13 分钟且接口请求增量 0；隐藏、恢复及清理均有单测。
- B6：已确认无需修改。25A A4 确认没有当前账号可见范围的通知异常总数接口；不把当前页条数当总数，留待独立只读契约。
- 规范文档：已完成。新增 v2.1.6 前向章节并引用 ADR-0054，写明计数不随筛选变化及三处样式。

## 直接风险与验证计划

遵循 [ADR-0053](../../adr/0053_mvp_delivery_and_test_policy.md) 和路径策略。新增验证只覆盖新字段解析、等待阈值/非法起点、可见性计时、辅助失败隔离，以及真实合成 PG/HTTP/SSE 下的计数、筛选、领取、已读刷新和视觉断言。保留旧选择器及业务断言。适用检查和缺口通过后停止扩验，不运行 full/certify、Electron、真实发送、部署或业务 Gate。

新增数据沿既有 `addInboxSession` / `attachInboxJourney` / `appendT22LiveItem` 和控制命令 helper 写入。展示姓名、部门、文字均带“（合成）”；5 小时联系人先领取后释放，会话开始比最近释放早 3 小时，最近活动又晚于释放，验证等待不借用创建或活动时间。

最终验证与资源结果见下文；原失败和 NOT_RUN 原件保留。

### 首轮与诊断记录

外部原件目录：`D:/CodexEvidence/pc-admin-v216-card25b-20261105/`，临时截图和浏览器所有权回执在 `D:/tmp/pc25b-1105/`。这些目录保留本轮失败和诊断，不混充最终候选结果。

- `build-initial.log` FAIL：测试类型引用把浏览器源码拉入后端 NodeNext 范围；改为现有纯模块测试模式的局部类型声明，未改前端导入约定。`build-candidate.log` 与 `types.log` 随后 PASS，922 个编译文件的 Node 语法检查通过。
- `direct/`：格式/计时基础单测 71/71 PASS；契约入口原有 5 条 PASS、新增 2 条 FAIL，原因为测试加载器正则把普通字符串误识别为导入。改用 TypeScript AST 识别实际 import；后两入口原 NOT_RUN 保留。
- `browser-initial/`：真实收件箱集成 17/17 PASS；浏览器原有 9 条 PASS，新增 2 条因错误等待关闭恢复功能时不存在的“草稿”提示而超时。新用例改为等待实际会话 ready 与实时 live；不改旧 9 条的选择器或业务断言。
- `diagnostic-test-harness.log`：修正后的解析 2/2 PASS；普通 Node 诊断中两次 Edge 启动未生成 DevToolsActivePort，FAIL 保留。随后使用与正式路由一致的 owned process / sanitized environment 进行诊断，未修改公共浏览器 helper。
- `diagnostic-owned-browser-initial.log`：新增场景发现 summary 初始读取和真实 SSE snapshot 各一次刷新，均在筛选之前。请求顺序原件保留；断言改为筛选前后 summary 请求数相等，继续严格断言人数不变。`diagnostic-owned-browser-filter-reset.log` 保留连续重置筛选未等待 React 路由提交的超时；补上实际 URL 和筛选状态就绪等待，无任意 sleep。
- `diagnostic-owned-browser.log`：新增浏览器场景 2/2 PASS；人数 6→5，真实 Cursor 后未读 139→35，分钟重算接口请求增量为 0。这是最终重新构建前的诊断，不代替制品级最终检查。
- `impeccable-detect.json`：对本卡三个 UI 目标的一次机械扫描返回 `[]`。四张要求截图已成批检查：1440 窄聊天栏按卡 24 保留单行省略，1920 显示完整横幅；三档颜色、标题、徽标及折叠圆点可见，无需视觉修改。

首次复用本卡自有 PG 数据目录时遗漏启动端口覆盖，55485 预检连接被拒绝；核验 data/PID 后只停止该实例，以显式 `127.0.0.1:55485` 重启。正式测试全部使用该 loopback 地址。原 `pg.log` 保留，不涉及现场数据库。

### 最终候选与校验

2026-11-06 完成。本地 HEAD 仍为基线 `4ca9a7002c688341bd6fabca1b91ae8fc8a59803`，本卡工作区未提交。最终编译输入 SHA-256 为 `1547e1a45e080e125cbdd17839d7eadc1449cecf18912bfcae5475d444e30eaf`；manifest SHA-256 为 `7aab67d8f9807d04487497a4bd7a51491d7974a70df77bbd20b153fa2b003a9e`。下列制品级检查均绑定该 manifest，不混用前面的诊断候选。

| 校验 | 结果与原件（位于上述外部目录） |
| --- | --- |
| `migration:build` | PASS，`build-final.log`；strict emit、PC/H5 构建、922 个 Node 语法检查完成。保留构建原有的大 chunk 提示。 |
| `gate.mjs types` | PASS，`types-final.log`；strict、负向类型、CSS、设计变量和 feature syntax 通过。 |
| 直接风险检查 | 4 入口 106/106 PASS，`final-direct/summary.json`：基础格式/计时 71、契约/实际客户端解析 7、真实收件箱集成 17、浏览器 11，零 SKIP/TODO。 |
| 其余路径检查首轮 | `remaining/summary.json`：前 44 入口 156/156 PASS，第 45 个 `yxx-h5-flow` 失败，其后 9 入口 NOT_RUN；原件不覆盖。 |
| 同候选继续验证 | `h5-resume/summary.json`：原样重跑失败入口及原 NOT_RUN 9 入口，10 入口 169/169 PASS；没有改 H5、媒体、公共 helper 或断言。 |
| 最终去重结果 | `final-aggregate.json`：路径计划 57 入口，另补直接风险收件箱集成 1 入口，共 58 入口最终采用 431/431 PASS，零 SKIP/TODO；同时明确保留初次失败与 NOT_RUN，不能理解为首轮全绿。 |
| 文档及工具 | `docs-agents.log` PASS；`docs-tool.log` 20/20 PASS；改动文档链接另做定向校验。 |
| 制品核验 | `verify-final.log` PASS，`ARTIFACT_VERIFIED_NOT_ACTIVATED`，manifest 与上述各批一致。 |
| 设计检查与截图 | 一次机械检测 `[]`；[四张正式截图及回执](../../docs/ui/evidence/v216-card25b/README.md)已核对尺寸与哈希，并作最终视觉确认。 |

`yxx-h5-flow` 首轮的精确等待条件为音频暂停、音频 currentTime 和 HeroUI 滑块均为 2.5 秒、剩余时长 `00:02`。诊断显示图片和语音 Blob 已加载，尚未进入随后的播放副本预览；原件在 `D:/tmp/pc25b-1105/workbench-detail-media-994b46c3-9fb9-4c23-8912-6efa3bdf369f/`。同候选原代码和原断言重跑通过，只能记为本次未复现，未宣称修复这个间歇超时。无需据此扩大本卡白名单。

路径计划采用真实未提交差异与新增文件，通过现有 `planChanges` API 生成；所选 `core/docs/mvp/pc` 与 NOT_SELECTED 明细在 `path-plan.json`，没有运行 full/certify。构建工具与上述应用检查串行，测试沿既有 owned process、隔离库、2C4G 与清理规则执行。新数据仅在合成库。

### 资源收口

`pg-final-baseline.json` 确认只剩 `postgres/template0/template1`，其他客户端 0；核验实际 data/PID/55485 后仅停止本卡复用的自有 PG，`pg-stop-receipt.json` 确认 pg_ctl status=3、55485 端口无监听。数据目录、全部原失败、原 NOT_RUN、诊断及所有权回执保留。浏览器入口沿既有 helper 断言自有 processes/profiles/commandTimers/sockets 均为 0；未清理其他任务资源。

### 文件清单

- `app/pc-admin/src/app/Workbench.tsx`：侧栏徽标及复用分钟订阅的原工作台时钟。
- `app/pc-admin/src/design/format-time.ts`：等待格式与可见性分钟订阅。
- `app/pc-admin/src/features/conversations/inbox-client.ts`：新字段严格解析、显式 opt-in、summary 读取与共享查询选项。
- `app/pc-admin/src/features/conversations/ConversationInbox.tsx`：标题人数、列表等待、等待横幅。
- `app/pc-admin/src/features/conversations/conversations.css`：本卡局部样式。
- `tests/pc-admin-design-foundation.test.mts`、`tests/conversation-inbox-contract.test.mts`、`tests/conversation-inbox.browser.test.mts`、`tests/helpers/conversation-inbox-fixture.mts`：新增断言与合成场景，保留旧断言。
- `docs/ui/design-system.md`、本执行记录。
- `docs/ui/evidence/v216-card25b/README.md`、`receipt.json`、`conversation-1440-before.png`、`conversation-1920-before.png`、`sidebar-collapsed.png`、`conversation-1440-after-takeover.png`。

### 七项自检

| 自检 | 是 / 否与证据 |
| --- | --- |
| 只改允许文件，25B 不改后端和契约 | 是。`final-aggregate.json` 枚举全部 17 文件，后端/契约差异 0。工作台原时钟只改为复用本卡可见性分钟订阅，实现 B5 要求。 |
| 不改命令、状态、权限，无新依赖 | 是。后端、契约、依赖清单差异 0；领取/已读继续调用原命令。 |
| 无自行迁移 | 是。本卡无迁移；25A 已合并且 A1 非停止项。 |
| 只计可见范围，不随筛选变化 | 是。真实收件箱集成 17/17 核对可见范围与翻页关系；新增浏览器断言队列/来源/搜索不改变人数或请求 summary。 |
| 等待从变成无人接待起算 | 是。合成会话开始早于最近释放 3 小时，但列表与横幅显示释放后的 5 小时；活动时间晚于释放也未改变等待。 |
| 沿用推送，不新增轮询 | 是。同一 `conversation-inbox` 族、实际 SSE 连接 1；领取/已读后刷新；分钟重算请求增量 0、隐藏暂停单测通过。 |
| 测试选择器和业务断言只增不减 | 是。`final-aggregate.json` 记录删除的断言/选择器行 0；旧浏览器 9 条保持，新总数 11 条通过。 |

最终停在本地验证与交付。CI（本卡未推送）、full/certify、Electron、真实发送、现场业务写库、部署及业务 Gate 均 NOT_RUN。

## 2026-11-06 独立审查与发布后继

用户随后明确授权先提交、独立审查和修复、验证后推送并创建 PR / 请求 Codex review，CI 通过且无 major 问题后合并、同步 main，仅清理本卡分支和 worktree。以上“本地未提交”是前一交付检查点的真实记录，不覆盖本次授权。

初始提交 `66785f6c690c59a728db67ca7a34c434fef3a01f`，固定基点仍为 `4ca9a7002c688341bd6fabca1b91ae8fc8a59803`。只读独立审查分别执行：code-review 的 Standards 与 Spec 两轴，以及 Open Code Review delegate；三方未互读报告。

- Standards：P2 为 summary 悬挂进入核心刷新完成门槛；P3 为徽标裸写 tabular-nums，未引用统一数字 Token。Fowler 判断项 0。
- Spec：P2 为辅助 summary 单独超时会令实时状态 offline、阻断原回复及内部备注，违反 B1 辅助失败不阻塞核心。
- OCR delegate：同一悬挂恢复问题为 medium，无 critical/high；CLI 原生选中 6 文件，另 7 文本和 4 PNG 补审，17/17 覆盖，跳过 0。原 preview、规则、探针和各自报告保存于 `D:/CodexEvidence/pc-admin-v216-card25b-review-20261106/`。

新增真实 PG/HTTP/浏览器回归先在修复前的生产 bundle 上诊断：summary 响应单独保持 pending，超过原刷新截止后观察到 `offline !== live`，`slow-summary-red.log/json` 保留该 RED。新增测试源码在仓库外转译加载，生产 bundle 未注入或改写；这是诊断，不冒称新的制品认证。

修复只在现有前端 `useRealtime.ts` 中把精确 summary key 纳入既有辅助失效通道，同时排除核心等待/失败门槛。该文件是本次已授权审查修复所需的 B1/B5 接线补充；没有新增族、连接或轮询，不改 bootstrap、当前账号筛选、授权 epoch、认证拒绝清理或命令权限。徽标改为引用 `--font-numeric-variant`，视觉值不变。后端、契约、迁移及依赖仍不改。

新增回归保留原 11 条浏览器用例，额外验证 pending 超过既有截止时仍 live、通过原回复和内部备注命令分别提交成功、仍只有一个 summary 请求和一个 SSE，响应恢复后数字能显示。后续构建、相关检查、独立复核及 PR/CI 结果按实际追加，不预填通过。

## 限制与回退

25A A3 中自动结束 Session 缺少独立推送仍是已知停止项，本卡不改写入路径。当前已有收件箱刷新事件会同步刷新 summary；服务端未产生事件的情况仍受该既有缺口限制。通知异常侧栏无可用总数接口，B6 跳过。

回退本卡前端差异即可恢复旧展示；原后端接口默认不返回等待字段的兼容行为保持。未授权提交、推送、PR、部署及现场运行。
