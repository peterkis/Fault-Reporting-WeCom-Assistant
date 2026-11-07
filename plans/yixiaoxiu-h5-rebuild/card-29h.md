# 卡 29H：H5 已关闭图标、关闭说明位置与处理记录文案

日期：2026-11-07（Asia/Shanghai）。分支 `codex/v220-card29h`，基于 `origin/main` `33648dfd03629fca3caed5d7ed1aa7fe7db8bfb7`（PR #161 合并）。本会话在独立工作树中是唯一写者；卡 29（PC）与卡 30A（后端）在其它会话并行，三者文件不重叠。依据 [ADR-0056](../../adr/0056_unified_closure_reasons_notify_and_restore.md) 与 [ADR-0053](../../adr/0053_mvp_delivery_and_test_policy.md)。

环境：macOS（Darwin 25.6，Apple Silicon）、Node 24.18.0、PostgreSQL 18.6（Homebrew，loopback）、Google Chrome（headless）。**不是 Windows 验收**；本地合成验证，不代表企业微信真机、部署、真实通知或 Gate 批准。

## 编号交付

| 编号 | 结论 |
| --- | --- |
| H1 已关闭图标 | 已完成。列表报修卡、Web 详情头部、Reporter 详情头部的“已关闭 / Closed”标签都改为中性色 CircleX 标记（`span.status-icon-closed`，`data-h5-status-icon="closed"`，颜色继承 `--status-neutral-fg`）。时钟 `schedule` 只留给排队、待补充、审核、等待重新承接等进行中 / 等待类状态。原“不属于报修范围”（`notService`，危险色）也曾用时钟，现改为 `info`，因为它不是等待类状态。图标字体是按图标名裁剪的子集，不含 `cancel`。为避免重新下载字体资产，CircleX 用 CSS mask 和内联 SVG 数据实现，没有新增依赖。 |
| H2 关闭说明位置 | 已完成。头部顺序改为：工单号 + 复制 + 状态 → 标题 → 报修时间 → 位置。关闭说明移到头部卡片底部，是一行说明块：CircleX + 文字，中性底色 `--muted`，文字 `--secondary-text`，圆角 `--radius-sm`（8px，与 H5 现有说明块一致）。误报或测试（服务端文本为“已关闭”）以及没有说明时，不显示说明块。Reporter 详情的 `#closure-text` 同样移到头部卡片底部，id 和原 class 都保留。 |
| H3 处理记录文案 | 已完成，Web 详情。Ticket 更新进入 CANCELLED / DUPLICATE_LINKED 时，标题改为“报修已关闭 / Report closed”。最新一条关闭事件的内容是报修人可见的关闭说明；没有说明、误报或测试、更早的关闭事件，内容为“本次报修已关闭 / This report has been closed.”。已加载事实中，关闭之后紧接的非终态 Ticket 更新显示为“报修已重新受理 / Report accepted again”。中英文同步。Reporter 详情的处理记录由服务端 `p2-016-reporter-timeline` 给出“报修已关闭 / 报修已重新受理”文本，本卡不改后端，因此没有修改。 |
| 截图 | 已完成。共 32 张：4 种主题 × 语言组合，每种 4 个场景（已关闭列表、重复报修、非 IT 范围、误报或测试），每个场景各有整页图和 2 倍局部图。处理记录在详情截图里。见[截图索引](../../docs/ui/evidence/v220-card29h/README.md)。 |
| H5 体积预算 | 已完成并通过，见下方实测表。 |
| 规范文档 | 已确认无需修改。H5 没有独立设计规范文档。PC 的 [design-system.md](../../docs/ui/design-system.md) 由卡 29 负责。新样式只用现有 Token。 |

## 实测表

浏览器：macOS headless Chrome（CDP），`Emulation.setDeviceMetricsOverride` 390×844，DPR 1，visualViewport.scale 1，Vite DEV 合成预览。每个场景都在页面中实际读取下列数值。

| 项 | light | dark | 结论 |
| --- | --- | --- | --- |
| devicePixelRatio / scale / innerWidth | 1 / 1 / 390 | 1 / 1 / 390 | 16 个场景一致 |
| 横向溢出（scrollWidth > innerWidth） | 无 | 无 | 16 个场景均无溢出 |
| 已关闭列表：关闭标签数 / 带 CircleX 的数量 / 含时钟的数量 | 4 / 4 / 0 | 4 / 4 / 0 | 中英文相同 |
| 详情头部 DOM 顺序 | 工单号行 → 标题 → 报修时间 → 位置 → 关闭说明 | 同左 | 误报或测试场景没有说明块 |
| 说明块底色 / 文字 | `#f4f3f2` / `#615d59` | `#191c24` / `#9ca3af` | 对比度 5.89:1 / 6.71:1（≥ 4.5） |
| 说明块圆角 / 字号 / 图标 | 8px / 12px / 16px | 8px / 12px / 16px | `--radius-sm` / `--fs-caption` / `--icon-sm` |
| 关闭标签（中性）文字 / 底色 | `#4f4b47` / `#efeeed`（7.46:1） | `#d1d5db` / `#252a37`（9.73:1） | 沿用现有 neutral tone |
| 重复报修处理记录（最新在上） | 报修已关闭（重复说明）→ 报修已重新受理 → 报修已关闭（本次报修已关闭）→ 工单已创建 | 同左 | 英文为 Report closed / Report accepted again |
| 非 IT 范围 / 误报或测试处理记录 | 报修已关闭（非 IT 说明）/ 报修已关闭（本次报修已关闭） | 同左 | 页面中无 INTERNAL 文本 |

H5 体积预算（`h5StartupMetrics`，gzip level 9，`.build/emit/h5`，预算 122880 B）：

| 闭包 | gzip（B） | 余量（B） |
| --- | --- | --- |
| 初始 | 109420 | 13460 |
| home | 117037 | 5843 |
| report | 119573 | 3307 |
| reports | 116188 | 6692 |
| request（最大） | 121173 | 1707 |
| department | 114726 | 8154 |
| reporter | 115675 | 7205 |
| reporterFeedback | 119493 | 3387 |
| 预绘制脚本 | 408 | 1640（预算 2048） |

macOS 构建产物与此前 Windows 记录的数值不直接可比，所以只报告本次绝对值，没有计算增量。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| [ReportCard.tsx](../../app/h5/src/components/ReportCard.tsx) | H1 列表标签图标 |
| [Detail.tsx](../../app/h5/src/pages/Detail.tsx) | H1 详情标签、H2 头部顺序与说明块、H3 处理记录展示 |
| [timeline.ts](../../app/h5/src/lib/timeline.ts) | H3 关闭 / 重新受理展示规则，以及报修人可见说明的过滤 |
| [i18n.ts](../../app/h5/src/i18n.ts) | 新增 `eventClosed`、`eventClosedDefault`、`eventRestored` 中英文 |
| [styles.css](../../app/h5/src/styles.css) | CircleX 标记、头部说明块、处理记录关闭图标（只用 Token） |
| [ReporterPage.tsx](../../app/h5/src/reporter/ReporterPage.tsx)、[controller.ts](../../app/h5/src/reporter/controller.ts) | Reporter 详情的 H1 / H2 |
| [preview.ts](../../app/h5/src/dev/preview.ts) | DEV 合成：新增“门禁卡读卡器失灵（合成）”非 IT 范围关闭，以及重复报修的关闭 → 重新受理 → 关闭记录；生产构建不包含 |
| [yxx-h5-frontend.test.mts](../../tests/yxx-h5-frontend.test.mts) | 新增处理记录展示测试、头部顺序与 CircleX 断言；语言目录精确计数从 468 改为 474 |
| [p2-012-reporter-refresh-browser.test.mjs](../../tests/p2-012-reporter-refresh-browser.test.mjs) | 新增 Reporter 关闭标记和说明块位置断言 |
| 本记录与[截图索引](../../docs/ui/evidence/v220-card29h/README.md) | 交付记录与 32 张截图 |

没有修改后端、contracts、`app/h5/src/api/*`、依赖、SQL 或开关。

## 验证

`pr-plan --base origin/main --head e597404d`：profiles 为 docs + h5 + mvp。其中 mvp 是因为 `tests/p2-012-reporter-refresh-browser.test.mjs` 被路由判定为未知路径而触发的回退。选中 7 组 selection、56 个入口；NOT_SELECTED 为 policy、pc、core、notification、desktop、presence、identity、toolchain。

- `npm --prefix app/h5 run typecheck`：PASS。
- `npm run migration:build`：首次 FAIL（新测试中 `view` 参数隐式 any，TS7006 两处）。补上类型后 PASS。最终在 `e597404d` 上重建，PASS。
- `node .build/tools/gate.mjs types`：PASS（strict、negative-types，含 PC Stylelint / ESLint 门禁）。H5 没有独立 ESLint / Stylelint 配置，本卡没有新增配置。
- `node .build/tools/verify-artifact.mjs`：PASS，manifest `a2345aa2eb9c8d50fa055c1bcbf576b4004cf316e414bc9fff852bb174716707`。
- `runSelection(plan.selection)`，自有 loopback PG18 隔离库 `v220_card29h_test`：最终一次完整运行 **56/56 入口、419/419 tests PASS**，fail / skip / cancel / todo 均为 0，not_run 0。

### 已发现的失败（保留，如实记录）

1. **TS7006**：本卡新增测试的类型问题，已修复。
2. **`web01-workbench.integration`**（Card 27A closure facts，500 !== 200）：首轮在 `57af488`（与最终代码相同，只差 DEV fixture 时间偏移）上失败一次，之后两次运行都通过。本卡没有改它涉及的后端或 PC 代码；在 macOS 上判定为偶发，未做进一步定位。
3. **macOS 环境，与本卡无关**：`yxx-h5-flow.integration`、`yxx-h5-media.integration`、`yxx-h5-media.test` 在默认环境下失败。
   - 原因一：媒体私有存储拒绝路径中有符号链接，而 macOS 默认 `TMPDIR`（`/var/folders/...`）位于 `/var → /private/var` 符号链接下，报 `YXX_MEDIA_STORAGE_UNAVAILABLE`。
   - 原因二：转码器拒绝符号链接的 ffmpeg，而 Homebrew 的 `/opt/homebrew/bin/ffmpeg` 是符号链接，报 `YXX_MEDIA_CONVERSION_UNAVAILABLE` / `UNAVAILABLE !== READY`。
   - 未改动的 `origin/main` 基线工作树中，`yxx-h5-flow` 在两种设置下分别以相同断言失败，确认为既有环境问题。
   - 把 `TMPDIR` 设为无符号链接的真实路径、并把 ffmpeg / ffprobe 设为 Cellar 实际路径后，三个入口全部通过，最终完整运行也通过。没有修改产品校验。

## 自检（六）

| 项 | 是 / 否与证据 |
| --- | --- |
| 只改本卡允许的文件 | 是。只改了 `app/h5/src`（列表标签、详情头部、处理记录、文案、样式、Reporter 详情、DEV 预览）、两处测试、截图和本记录。没有后端改动。 |
| 无新增依赖，未改状态值与权限，未放宽业务断言 | 是。`package*.json` 未变。状态映射 `reportState` / `reportTone` 未变。唯一改动的旧期望是语言目录计数 468 → 474（新增 3 个 key × 2 种语言），逐条字面量与插值断言保留。 |
| 内部说明不会展示给报修人 | 是。只消费服务端安全字段 `closure_text`。新测试断言 `INTERNAL_NOTE` 不出现，16 个浏览器场景都读取到无 INTERNAL 文本。 |
| 没有只有图标没有文字的状态提示 | 是。CircleX 均为 `aria-hidden`，并与“已关闭 / Closed”文字、说明文字或处理记录标题同时出现。 |
| 测试选择器只增不删，移动的元素保留选择器和属性 | 是。`data-h5-closure-text`、`#closure-text`（含原 `ui-card-description selectable` class 与 `hidden` 行为）都保留。新增 `data-h5-status-icon`、`.detail-closure-note`、`.timeline-icon-closed`。 |
| 带数值的验收项有实测值 | 是，见实测表。 |

## 限制与回退

- Web H5 处理记录的数据源（`yxx-self-service-store`）不包含 `ticket.restored` 和 `ticket.duplicate_linked` 事件，本卡不改后端。因此“报修已重新受理”在真实数据中只会出现在关闭之后、已加载的下一条非终态 Ticket 更新上。重复报修的关闭事件要等后端把它纳入时间线后才会显示。这一点作为后续后端议题另记，不在本卡处理。
- 对于分页之外的前一条事实，不做推断，保持通用展示。
- 回退：普通 revert 本卡提交即可，不涉及数据、合同或开关。

## Codex 复审修复（PR #164，评论 4502103937）

- 问题：分页未加载完时，当前关闭说明可能绑到已加载的较早关闭事件上。属实。
- 修复：只有在整个时间线已加载（无下一页），且最新关闭事件就是最新的 Ticket 事实时，才绑定当前说明；其它情况显示中性文本“本次报修已关闭”。新增部分历史、关闭后又有更新、未加载新页三条断言。
- 验证：migration:build、gate types、verify-artifact PASS（manifest `cf2d1fad…`）；pr-plan 56/56 入口、419/419 tests PASS（macOS，TMPDIR 与 ffmpeg 使用真实路径）。
