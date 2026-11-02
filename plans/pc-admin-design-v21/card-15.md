# 卡 15 · 通知异常

## 范围与基线

- 基线：`origin/main@bf5073db934348046155e006873b50075e7a1ac2`。
- 前置：卡 8 [#128](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/128)、卡 9 [#129](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/129) 已合并；`heat.ts`、`category-map.ts` 均存在。
- 工作区：`D:/worktrees/pc-admin-v21-card15`，分支 `codex/pc-admin-v21-card15`。本任务为唯一写者；卡 14 资源不在本任务范围内。
- 依据：[v2.1 §4.4](../../docs/ui/design-system-v2.1.md#44-通知异常有哪些通知没送到)、原型 04 / 04b；本轮用户卡 15 为具体交付合同。
- 只调整正式前端视觉、交互与文案。无数据库、后端、合同、依赖、状态值、权限、请求语义或 Feature Flag 变更。关闭沿既有 `notificationExceptionsEnabled=false`；回退使用独立 revert，保留原 Delivery / Attempt 事实。

## 当前接口限制与规范补充建议

T32 闭合 DTO 见 `contracts/workbench_notification_exception_contracts.d.ts`、`docs/08_api_contracts.md` §12。没有工单编号/标题、接收人显示名、轻量总数；`safe_summary` 是安全模板摘要，不能解析成工单标题/接收人。不得逐行扇出读取父对象或投递目标。

2026-11-02 用户已确认并授权继续完成、审查与合并的过渡方案：关联来源链接 + 安全摘要；接收人仅显示既有群聊/个人类型；保留通知类型、渠道、时间及尝试次数。缺失的只读投影列为后续项。侧栏不显示数字，避免把当前页条数当全域计数。

## 本卡视觉与交互补充

- 原型 04：结果 Tag → 关联来源链接与安全摘要 → 通知类型 → 接收人类型 → 渠道 → 时间及次数 → 核对。时间显示最近一次尝试，无尝试时显示通知创建时间；所有时间沿既有北京时间本地字段，不重新推算时区。
- 顶部仅概括本页：明确未应用的失败使用 danger，未知结果继续单列待核对；全页只有「逐条核对」一个 primary。不能把当前页条数冒充异常总数或把 UNKNOWN 当成确定失败。
- 「逐条核对」从本页首条进入，核对区可切换上一条/下一条并关闭；复用原精确 item GET，查看不重发。来源链接沿原 `parent_link`，原控制入口与 `allowed_actions` 展示判断保持。
- 原型 04b：共享 EmptyState 增加 opt-in `success` 展示，64px 绿色圆形勾，默认中性状态保持。未筛选空页标题为「通知都已送达」，说明限定当前可见范围；筛选/后续页为空时使用「当前筛选没有通知异常」，避免误报全域送达。空页无分页，刷新仍沿原 bootstrap / 清缓存 / 重读流程。
- 仅复用现有语义 Token；不改卡 9 所有的 tokens、heat、category-map 或设计系统共用文档。表格在容器内保留横向滚动，页面无横向溢出；不增加动画，遵守减少动效偏好。

## 验证计划与停止条件

最终候选按顺序运行 `npm run lint:css`、`npm run lint:features`、`npm run migration:build`、`node .build/tools/gate.mjs types`，活动 `v3-p09` 内直接相关的 T32 合同 / 正式制品浏览器 / 授权回归，再运行制品与指令文档检查。不把相关子集称为 full/certify。

每次使用本任务 PG18（loopback 55475）和既有 fixture 创建新 UUID 合成库。只使用合成 Sender，不连接企业微信。自有浏览器 / HTTP / 数据库在 finally 清理；不运行 Electron 原生集成。测试失败保留原日志，定位直接原因后仅重跑受影响项。浏览器截图包含 1920 / 1440 / 1280 / 900，改动前后与原型并排。

证据根：`D:/CodexEvidence/pc-admin-v21-card15-20261102`。本地结果、规范偏差、逐项自检与 PR/审查/清理状态在实际发生后补充。

## 2026-11-02 开工检查与基线准备

- GitHub 当前 API 再核：#128、#129 均为 MERGED；通知异常原任务 #87 为 CLOSED，本卡没有新建或关闭 Issue。
- 过渡方案确认仍待用户回复。尚未改产品代码、提交、推送或创建 PR。
- 锁定依赖安装通过（647 包，无依赖变更），Node 24.18.0 / 本任务 PG18。
- 基线首次构建 FAIL：构建运行期间新增本执行记录，输入指纹变化，报 `MIGRATION_SOURCE_CHANGED_DURING_BUILD`。保留 `baseline-build.log`；固定输入后 `baseline-build-2.log` 的构建 PASS，913 个编译模块语法检查通过，2747 个输出，制品为 STAGED_NOT_ACTIVATED。
- 改动前截图：`before-{data,empty}-{1920,1440,1280,900}.png`。真实既有 T32 fixture、真实 loopback HTTP/PG、模拟外部 Sender；空状态使用当前工单筛选。原型 04 / 04b 截图：`prototype-{04,04b}.png`，原始 HTML 解包后渲染，不修改用户原型。
- 截图、构建、临时预览准备不代表卡 15 验收。最终 lint/types/相关 selection/artifact、自检、前后并排、远端审查与合并均 NOT_RUN。
- 本任务预览正常退出，fixture 合成库已删除，PG 剩余非模板库仅 postgres，PG 停止；自有三个 HTTP 端口与浏览器已关闭。保留专属分支/worktree、停止的合成 PG 目录和失败日志供确认后继续；没有清理其他会话资源。

## 实现后的第一轮静态检查

- `npm run lint:css` / `npm run lint:features` 在根目录失败：脚本实际归属 `app/pc-admin/package.json`，未改 package。使用 `npm --prefix app/pc-admin run lint:css` / `lint:features` 后均 PASS，违规数 0。
- 前端 `npm --prefix app/pc-admin run typecheck` PASS。设计机械检查 `design-detect.json` 为空数组。
- 既有测试只把空状态文字期望同步为「通知都已送达」；原分页、原精确对象、迟到响应、失权清理、合法 Session 保留、零 POST、Sender 次数与隐私断言逐字保留。
- 最终构建、strict gate、T32 相关 selection、四宽度渲染、制品和远端审查待本候选实际执行；此处不预写 PASS。

## 第一轮实际验证与集中修正

功能提交 `8aa0beee21445399f3012e7c400395821eb16d62`：`final-build.log` PASS（913 编译模块、2747 输出）；`types-gate.log` PASS（未定义 Token / primitive leak 均 0）；`artifact.log` PASS，manifest SHA-256 `53cc41a6156064294ec0bb862f7b7844e51258a183f52b1fe5b7f0c60033c19e`。指令文档检查 PASS，原工具测试 19/19 PASS。

活动 `v3-p09` 内 T32 直接子集 8 个已注册入口，实际 12/12 PASS、FAIL/SKIP/CANCELLED 均 0。使用既有 `runSelection`，保留原 STAGED_RUNTIME、flags、超时、数据库及浏览器合同，未修改 routing。完整路径/逐例/回执/截图归档见证据根 `t32-results/summary.json`、`t32.log`；不称为活动全集或 full/certify。

首轮实际 UI 检查 `ui-round1.json`：四宽度均无页面溢出、3 行数据、1 个 primary；摘要正确为 2 条失败 + 1 条待核对。切换待核对筛选后为 warning，不把未知写成失败。逐条切换读取的是不同精确 delivery。四宽度空页均无分页、1 个 primary、成功圆直径实算 64px。

发现并集中修正：关闭核对区后焦点落 BODY，改为返回原入口按钮；筛选可见「投递路由 / 全部路由 / 未知待核对」改为「渠道 / 全部渠道 / 结果待核对」。原 aria-label 和 API 参数不改。后继候选的检查待实际执行，旧结果仍绑定上述提交。

焦点修正首次类型检查 FAIL（`frontend-types-final.log`、`final-build-2.log`）：HeroUI 事件的 currentTarget 是 FocusableElement，不能赋给 HTMLButtonElement。按实际只消费的 `focus` 能力收窄 ref 类型，不增加断言或逃逸；原失败保留，随后重新类型检查和构建。


## 最终本地交付（2026-11-02）

最终功能候选：`21183c1428e2489e6cf3cdab682168f6512bf6e3`。后续截图/记录提交不改本候选代码，保留其真实祖先身份；PR head 的远端普通检查和审查另行记录于 PR。

| 验证 | 实际结果与证据根内文件 |
| --- | --- |
| Stylelint / ESLint | 0 / 0，`lint-css-final.log`、`lint-features-final.log`；最终 strict gate 同时复核规则 |
| 前端严格类型 | PASS，`frontend-types-final-2.log` |
| `npm run migration:build` | PASS，`final-build-3.log`，913 编译模块 / 2747 输出 |
| `node .build/tools/gate.mjs types` | PASS，`types-gate-final.log`，CSS、Token、功能规则、strict、负向类型均 PASS |
| T32 首轮完整相关子集 | 8 个注册入口，12/12 PASS，绑定 `8aa0beee`，详见上节 |
| 最终受影响子集 | 3 个既有 T32 browser 入口，3/3 PASS，`t32-browser-final/summary.json`；分页、精确 GET、失权、迟到响应、尾斜杠与零 POST/原 Sender 次数保留 |
| 制品 | PASS，`artifact-final.log`；manifest SHA-256 `b387f89681289c0d79b965db52930bf054a387d0ca0c3a66f6acd1059f8ccc02`，STAGED_NOT_ACTIVATED |
| 指令文档及工具 | PASS；`docs-check.log`，19/19 原工具测试 `docs-test.log` |
| 真实 UI | `ui-final.json`：四宽度无页面溢出、每页恰好 1 个 primary、空页无分页、成功图标 64px；键盘关闭回到 `review-exceptions`，focus-visible=true；控制台 error=[] |

### 文件清单

- `app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx`：布局、文案、逐条只读核对、焦点。
- 同目录 `notification-exceptions.css`：本页布局，颜色/字号/字重/圆角均使用既有 Token。
- `app/pc-admin/src/design/components/EmptyState/{EmptyState.tsx,empty-state.css}`：opt-in success 视觉，默认状态沿原样。
- `tests/wbint-t32-exception-authorization.browser.test.mts`：仅同步空页文字期望。
- 本记录与 `docs/ui/evidence/v21-card15/` 的 9 张合成截图。

### 四宽度前后 / 原型并排

左 Before、中 After、右原型固定尺寸参考；各面板等比缩放，原型不假装响应式。数据均为合成 fixture，失败与未知结果独立。空页前后均为工单筛选，未筛选的标题另见 [通知都已送达](../../docs/ui/evidence/v21-card15/delivered-900.png)。

| 宽度 | 有数据 / 原型 04 | 空页 / 原型 04b |
| --- | --- | --- |
| 1920 | [对照](../../docs/ui/evidence/v21-card15/compare-data-1920.jpg) | [对照](../../docs/ui/evidence/v21-card15/compare-empty-1920.jpg) |
| 1440 | [对照](../../docs/ui/evidence/v21-card15/compare-data-1440.jpg) | [对照](../../docs/ui/evidence/v21-card15/compare-empty-1440.jpg) |
| 1280 | [对照](../../docs/ui/evidence/v21-card15/compare-data-1280.jpg) | [对照](../../docs/ui/evidence/v21-card15/compare-empty-1280.jpg) |
| 900 | [对照](../../docs/ui/evidence/v21-card15/compare-data-900.jpg) | [对照](../../docs/ui/evidence/v21-card15/compare-empty-900.jpg) |

### 规范偏差、后续项与限制

- 经本轮用户确认的过渡：工单编号/标题、接收人姓名等待后续只读投影；当前显示关联来源 + 安全摘要、群聊/个人类型。没有解析摘要或逐行读取父对象来补造字段。
- 无轻量计数接口，侧栏不显示数字。概括仅为本页，确定失败/未知分开；不是全域异常总数。
- 原型唯一动作按任务改为 primary；筛选空页使用范围化标题，避免局部空页宣称全域送达。首屏彩色面积估算仅卡 10/12 要求，本卡不适用。
- 后续卡 16 仍要求卡 12 合并；本卡完成不启动它，也不补做其他卡。上述字段与计数是独立后续工作，不是扩大本卡后端范围。
- full / current certify / 历史 certify、Electron 原生集成、真实发送/企业微信客户端、部署和 Gate 均 NOT_RUN。本卡没有改 Electron、业务或认证；原生集成不作为本 UI 卡的完成替代。

### 自检（是 / 否与证据）

| 项目 | 回答与证据 |
| --- | --- |
| 前端未改业务命令、状态值、权限判断 | 是：query/reload/clear/authority/allowed_actions 原判断保持；无 server/contracts/API diff；T32 12/12 与最终 browser 3/3 |
| 选择器只增不删，测试只改文案期望 | 是：原 class、data-action、data-exception-* 与 aria-label 保留；测试 diff 仅一个等待文字，所有业务断言原样 |
| 新增颜色经 Token，lint=0 | 是：Stylelint/ESLint 0，strict gate 变量未定义/原始色泄漏均 0 |
| 彩色对应阶段/紧急/类别/人 | 是：失败 danger、未知 warning 属紧急；绿色成功空态属完成阶段；蓝色主动作/链接/选中沿既有交互规范 |
| 卡片无「未提供 / 未登记」 | 是：本页无此类占位文案，源摘要原样按合同展示 |
| 有权限时区域恰好一个 primary | 是：有数据「逐条核对」、空页「刷新」；四宽度实算 1；行操作与核对区导航为 secondary/ghost |
| 热度使用统一常量，无硬编码阈值 | 是：本卡不计算热度，没有新增阈值，heat.ts 未改 |
| 四宽度与原型并排核对 | 是：上表 8 张对照与 `ui-final.json`，无页面横向溢出 |

本地自有合成库已由 fixture 收回，PG 非模板库仅剩 postgres 后停止；预览 HTTP、浏览器标签均关闭，viewport 已恢复。失败原件和 NOT_RUN 保留。PR、审查、合并与最终分支/worktree 清理状态以本次 GitHub 实际记录和证据根 cleanup 回执为准。
