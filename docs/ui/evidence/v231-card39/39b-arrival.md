# 卡 39B 交付证据：新卡片到达高亮叠加层与占位统一样式

- **目标系统**：Windows 10 / Windows 11 桌面与浏览器工作台。
- **沙箱说明**：本执行环境禁止启动 Chrome，因此浏览器测试、`filmstrip` 胶片图生成、占位截图与 `visual:compare` 留待有 Chrome 权限的宿主机执行；静态检查、类型检查、样式/脚本门禁、构建与制品校验、非浏览器单测已在 R2 修复后全部实跑通过。

---

## 一、问题 1–4 复现结论与首轮宿主运行记录

### 1.1 首轮宿主机（`br1`）与 R1 静态审查记录（如实保留）

- **36A / 36B / 36C 浏览器套**：宿主机 `br1` 运行 **43/43 PASS**。
- **39B 浏览器套（R1）**：宿主机 `br1` 运行 **0/2 FAIL**：
  1. Vite 开发服务器日志前 15 行警告 `node_modules/@fontsource-variable/{inter,noto-sans-sc,jetbrains-mono}/*.woff2` 不在 Vite 服务允许列表（缺 `server.fs.allow: [root]`）。
  2. 首条 `39B A1/A2` 子测试（连带父测试）在 `timeText === '刚刚'` 处失败，实得 `'11-24 14:51'`（揭示 `Workbench.tsx` 复用 `useClock()` 60s 时钟，新到达报修的 `updated_at > clockNow` 被 `relativeTime` 判定 `elapsed < 0` 而输出月日）。
  3. 其余子测试、胶片图、`unclassified-tile.png`、`unassigned-placeholder.png` 与 `visual:compare` 在 R1 尚未运行产出（NOT_RUN）。
- **工具单测（R1）**：`pr-plan.test.mjs` 中 2 条读取 GitHub workflow YAML 的用例因本机 `PATH` 仅提供 `python3` 而报 `spawnSync python ENOENT`（FAIL，与 39B 改动无关）；其余 42/44、copy-terms（8/8）、design-foundation（75/75）、motion-tools（11/11）、motion-policy（6/6）均 PASS。

### 1.2 问题 1–4 复现对照

| 问题 | 代码/证据核对结论 | 真实环境复现状态 |
| --- | --- | --- |
| 1. 高亮没有「停留」，像闪了一下 | 已从主线旧实现与 `v229-card36/filmstrip/board-arrival.png` 核实：原实现从 `t=0` 即以 `--ease-standard` 直接淡回原色，缺少 `240ms` 停留。已改为 `::after` 叠加层 `delay: --dur-highlight-hold`（`240ms`）+ `--dur-highlight`（`1200ms`）`--ease-ambient` 淡出（总 `1.44s`）。 | 待宿主机 R2 复跑确认 |
| 2. 待受理列里，新卡片和列底混成一片 | 已从 [tokens.css](../../../../app/pc-admin/src/design/tokens.css) 核实：原实现仅有 `--stage-intake-bg`（`#FBF3DB`），与 `--lane-intake`（`#FCFAF4`）接近。已加入 `inset 0 0 0 1px` 55% 阶段色内描边（`--highlight-ring-intake / active / done / brand`）。 | 待宿主机 R2 复跑确认 |
| 3. 高亮直接改卡片 `background-color` 与状态底色冲突 | 已核实原实现直接写 `el.style.backgroundColor`，且 R1 的不透明 `::after` 在负层级仍可能遮盖宿主选中/已关闭/按下底色与 1.5px 在场内描边。R2 已改为 `::after` 仅动 `opacity` 不改宿主 `backgroundColor`，且宿主处于选中/已关闭/按下/在场/键盘当前/回退环状态时，叠加层底色透明（`inset: var(--space-0-5)` 避让内描边），保住全部状态视觉可见性。 | 待宿主机 R2 复跑确认 |
| 4. 新报修未分类、未分配占位与时间不一致 | 已核实并修复四项：未分类瓷砖改为 `1px dashed var(--border-default)` + `--bg-canvas`；未分配统一为 `20px` `1.5px dashed var(--text-tertiary)` 无内符号空心圆及对应可读性；窄列表（`≤1080px`）固定首列 `th::after` 同步显示 `brand` 高亮与描边；`Workbench.tsx` 收到新页数据时重采样展示时钟修复 `'刚刚'` 误判。 | 待宿主机 R2 复跑确认 |

---

## 二、R2 改动清单

| 文件 | 改动内容与原因 |
| --- | --- |
| [tokens.css](../../../../app/pc-admin/src/design/tokens.css) | 新增 `--dur-highlight-hold: 240ms`、`--highlight-ring-*`（55% 实体色）与 `--shadow-highlight-*`、`--shadow-list-highlight-sticky`（保住首列左/上/下描边与右侧分隔线）；未分类底色改为 `var(--bg-canvas)`、边框改为 `1px dashed var(--border-default)`。 |
| [.stylelintrc.json](../../../../app/pc-admin/.stylelintrc.json) | `border-radius` 白名单允许 `"inherit"`，供 `::after` 叠加层使用。 |
| [tokens.ts](../../../../app/pc-admin/src/design/motion/tokens.ts) | 将 `--dur-highlight-hold`、`--ease-ambient` 与 `--highlight-ring-*` 纳入缓存与类型。 |
| [format-time.ts](../../../../app/pc-admin/src/design/format-time.ts)、[Workbench.tsx](../../../../app/pc-admin/src/app/Workbench.tsx) | 新增纯函数 `resolveDisplayNow` 与 `formatRelativeTime`，在收到新一页数据时以最新 `dataUpdatedAt` 重采样展示时钟（保留 60s `observeVisibleMinute`），消除新到达报修因时钟滞后误显示月日的问题；看板卡片未分配 `title` 统一为 `"未分配"`。 |
| [ticket-card.css](../../../../app/pc-admin/src/design/components/TicketCard/ticket-card.css) | `.ds-ticket-category` 加 `box-sizing: border-box`；新增 `[data-highlight-tone]::after` 叠加层；R2 新增状态保色规则（`.is-selected`、`DISMISSED`、`:active`、`[data-presence]`、`[data-keyboard-current="true"]`、`[data-optimistic-rollback="true"]` 下底色 `transparent`，选中/在场/回退与列表键盘环叠加层内收 `var(--space-0-5)`）。未改 `.ds-ticket-owner`（39C）。 |
| [work-table.css](../../../../app/pc-admin/src/design/components/WorkTable/work-table.css) | `.ds-list-unassigned` 对齐 `20px` / `1.5px dashed var(--text-tertiary)`；在 `@container work-table (max-width:1080px)` 为固定首列 `th` 加 `isolation: isolate` 与同步 `.ds-work-row[data-highlight-tone]>th::after` 叠加层，兼顾横向滚动遮挡与 `brand` 高亮。 |
| [highlight.ts](../../../../app/pc-admin/src/design/motion/highlight.ts) | 仅动 `::after` `opacity`（`delay: --dur-highlight-hold`、`duration: --dur-highlight`、`easing: --ease-ambient`），绝不写 `el.style.backgroundColor`；对含固定首列 `th::after` 的表格行同步驱动/取消首列叠加层；减少动态效果静态保留 `1440ms`。 |
| [board-motion.ts](../../../../app/pc-admin/src/design/motion/board-motion.ts) | B2 新卡到达从帧 0 与 `enterSlide` 同步启动 `highlight`；记录并管理本轮所有活动高亮句柄，在范围切换重置（`scope` 变化）与卸载时立即取消；`createFlightGhost` 清理 `data-highlight-tone`。 |
| [timeline-entry.ts](../../../../app/pc-admin/src/design/motion/timeline-entry.ts) | D3 与到达位移同步从帧 0 启动 `highlightTimelineEntry`。 |
| [Avatar.tsx](../../../../app/pc-admin/src/design/components/Avatar/Avatar.tsx)、[avatar.css](../../../../app/pc-admin/src/design/components/Avatar/avatar.css)、[WorkTable.tsx](../../../../app/pc-admin/src/design/components/WorkTable/WorkTable.tsx)、[TicketHoverCard.tsx](../../../../app/pc-admin/src/features/hover-cards/TicketHoverCard.tsx)、[WorkbenchItemPresentation.tsx](../../../../app/pc-admin/src/app/WorkbenchItemPresentation.tsx) | 统一为 20px 空心虚线圆（无内部符号），`title="未分配"`；无相邻文字处（看板卡片）提供 `role="img"` + `aria-label="未分配"`，有相邻文字处（列表 `未领取`、悬停/详情 `等待领取`）加 `aria-hidden="true"` 避免重复朗读。 |
| [ClosureActions.tsx](../../../../app/pc-admin/src/features/ticket-waiting/ClosureActions.tsx) | 恢复高亮清理定时器已更新为 `motionToken('--dur-highlight-hold') + motionToken('--dur-highlight')`（正常 `1440ms` / 慢速 `7200ms`），与叠加层完整时长对齐。 |
| [motion-assert.mts](../../../../tests/helpers/motion-assert.mts)、[motion-filmstrip.mts](../../../../tests/helpers/motion-filmstrip.mts) | `assertMotion` 支持 `pseudoElement` 与 `delayToken`；`createFilmstripCapture` 支持 `endTime`、`sampleTimesMs`、`frameLabels` 与 `onSample`。 |
| [pc-admin-design-foundation.test.mts](../../../../tests/pc-admin-design-foundation.test.mts)、[pc-admin-motion-tools.test.mts](../../../../tests/pc-admin-motion-tools.test.mts)、[pc-admin-card36a-motion.browser.test.mts](../../../../tests/pc-admin-card36a-motion.browser.test.mts)、[pc-admin-card36b-motion.browser.test.mts](../../../../tests/pc-admin-card36b-motion.browser.test.mts)、[pc-admin-card36c-motion.browser.test.mts](../../../../tests/pc-admin-card36c-motion.browser.test.mts) | 新增时钟重采样退化测试；36A 补齐四色（含 `done`）实际颜色/描边 token 校验；36B/36C/tools 全部迁移至 `::after` 叠加层与新令牌，未放宽断言。 |
| [pc-admin-card39b-arrival.browser.test.mts](../../../../tests/pc-admin-card39b-arrival.browser.test.mts)、[testing-policy.json](../../../../plans/testing-policy.json)、[test-routing.json](../../../../plans/typescript-migration/test-routing.json) | R2 修复 Vite `fs.allow` 与字体加载断言、同帧位移+叠加层校验、筛选重置取消高亮回归、真实同事领取 `A2` 路径、窄列表固定首列像素校验、`A3` 同时间基准 `≤100ms` 点击与选中/已关闭/在场像素校验、`A4` 局部 settle、`A5` DPR 2 与 CDP AX 树校验。 |
| [design-system.md](../../design-system.md)、[README.md](../../../../app/pc-admin/src/design/motion/README.md) | 同步高亮时长（`240ms + 1.2s`，减少动态效果保留 `1.44s`）、状态保色与窄列表首列叠加层、句柄所有权规范，修复全部相对链接路径。 |

---

## 三、验收 1–8 核对表

| 验收项 | 目标产物 / 测试用例 | 状态 |
| --- | --- | --- |
| 1. 新 H5 入「待判断」与同事真实领取入「处理中」6 帧胶片图（`?motion=slow` 0/240/480/840/1200/1440ms） | `filmstrip/arrival-intake.png`、`filmstrip/arrival-active.png`；`39B A1/A2 intake arrival...`（含同帧位移+叠加层、`'刚刚'` 与筛选切换取消回归）、`39B A1/A2 active arrival: real colleague claim FLIP...` | 已按 R2 重写并编译；待宿主机 Chrome 复跑出图 |
| 2. 叠加层断言与颜色映射 | `39B A1/A2` + `39B narrow list...` + `pc-admin-card36a-motion`（含 `done` 全四色校验）+ [pc-admin-motion-tools.test.mts](../../../../tests/pc-admin-motion-tools.test.mts) | 单测通过；浏览器套待宿主机复跑 |
| 3. 冲突（同基准 `≤100ms` 选中、已关闭、1.5px 在场内描边保持可见） | `39B A3 conflict: same-timebase <=100ms select, dismissed and presence hold visuals`（含像素实测） | 已按 R2 重写并编译；待宿主机复跑 |
| 4. 待受理列 4 边像素采样与 `--lane-intake` 对比度 | `39B A4 intake column 4-edge pixel contrast during highlight`（含局部 `waitForAnimationsSettled`） | 已按 R2 重写并编译；待宿主机复跑 |
| 5. 未分类/未分配在看板、列表、悬停三处截图 + AX 树 + 相对时间 `'刚刚'` | `unclassified-tile.png`、`unassigned-placeholder.png`；`39B A5...` + `pc-admin-design-foundation` 时钟单测 | 时钟单测通过；浏览器截图标定待宿主机复跑 |
| 6. 减少动态效果：无位移、无淡出、按时移除 | `39B A6 reduced motion...` + [pc-admin-motion-tools.test.mts](../../../../tests/pc-admin-motion-tools.test.mts) | 单测通过；浏览器套待宿主机复跑 |
| 7. 36A / 36B / 36C 高亮相关测试全部通过 | 宿主机 `br1` 已跑 `43/43 PASS`；36A 在 R2 新增 `done` 等四色视觉映射断言 | 已更新并编译；待宿主机复跑确认 `done` |
| 8. `visual:compare` 核对并更新基线 | 宿主机运行 `npm run visual:capture` 与 `npm run visual:compare` | 待宿主机执行并确认 |

---

## 四、36A / 36B / 36C / 单测断言变更对照（较 main `64ad8bf2`）

| 文件 | 测试名 | 变更前 | 变更后 |
| --- | --- | --- | --- |
| [pc-admin-design-foundation.test.mts](../../../../tests/pc-admin-design-foundation.test.mts) | `Card 39B relativeTime resamples display clock...` | （新增） | 覆盖 `clockNow < updated_at <= dataUpdatedAt < nextTick` 返回 `'刚刚'`、真实未来时间戳与无效值仍回退 |
| [pc-admin-motion-tools.test.mts](../../../../tests/pc-admin-motion-tools.test.mts) | `all highlight tones use overlay attributes/tokens...` | 校验 `[{backgroundColor:color},{backgroundColor:'white'}]`、`duration: 1200` | 校验 `data-highlight-tone === tone`、`el.style.backgroundColor` 不变、`pseudoElement: '::after'`、`delay: 240`、`duration: 1200`、`easing: 'ease-in-out'`、`fill: 'both'`、`[{opacity:1},{opacity:0}]`，结束后移除属性 |
| [pc-admin-motion-tools.test.mts](../../../../tests/pc-admin-motion-tools.test.mts) | `reduced highlight holds overlay then removes attribute...` | 校验 `el.style.backgroundColor === 'blue'` 与恢复 `''` | 校验 `data-highlight-tone` 保留后移除、`el.style.backgroundColor` 全程不变 |
| [pc-admin-card36a-motion.browser.test.mts](../../../../tests/pc-admin-card36a-motion.browser.test.mts) | `isolated highlight...` | `assertMotion(b,'#highlight','--dur-highlight','--ease-standard')` 与 `slow` 只查 `--dur-base` | 迁移至 `::after` / `--dur-highlight-hold` / `--ease-ambient` / `['opacity']`，逐一对比四色（含 `done`）`::after` 背景与 `--highlight-ring-*` inset shadow，并补充 `slow` 下 `--dur-highlight-hold === 1200` |
| [pc-admin-card36b-motion.browser.test.mts](../../../../tests/pc-admin-card36b-motion.browser.test.mts) | `probe` / `waitEffect` / `assertHighlightTone` / `B5.1–3` / `B5.8` | 检测 `backgroundColor` 动画与 `--dur-highlight` / `--ease-standard` | 检测 `options.pseudoElement === '::after'`、`::after` `opacity` 动画（`--dur-highlight` / `--ease-ambient` / `--dur-highlight-hold`）与背景 + `--highlight-ring-*` |
| [pc-admin-card36b-motion.browser.test.mts](../../../../tests/pc-admin-card36b-motion.browser.test.mts) | `36B B5.9 reduced-motion...` | 检测 `node.style.backgroundColor` 停留 `1200ms` | 校验宿主 `style.backgroundColor === ''` 与卡片计算底色不变，`::after` 静态保留 `1440ms`（`240 + 1200`）后移除 |
| [pc-admin-card36c-motion.browser.test.mts](../../../../tests/pc-admin-card36c-motion.browser.test.mts) | `Card 36C C5...`（`timelineEntry`） | 入场后才出现 `highlight`，测 `['background-color']` | 校验到达帧 0 同时启动入场位移与 `::after` `opacity` 叠加层（`--dur-highlight-hold` + `--dur-highlight` / `--ease-ambient`）及 `--highlight-ring-intake` |

---

## 五、Chrome 宿主机复跑命令

```sh
npm run migration:typecheck && npm run migration:build && npm run migration:verify-artifact

export TS_MIGRATION_TEST_SOURCE_ROOT="$PWD"
export PILOT_DATABASE_URL="postgresql://petervans@127.0.0.1:5432/postgres"
export CARD39B_EVIDENCE_DIR="docs/ui/evidence/v231-card39"

node --test --test-concurrency=1 \
  .build/runtime/tests/pc-admin-card39b-arrival.browser.test.mjs \
  .build/runtime/tests/pc-admin-card36a-motion.browser.test.mjs \
  .build/runtime/tests/pc-admin-card36b-motion.browser.test.mjs \
  .build/runtime/tests/pc-admin-card36c-motion.browser.test.mjs
```

---

## 六、Open questions（需负责人确认）

1. **状态保色叠加层的视觉语义解读**：当卡片/行处于 `.is-selected`、`[data-closure-kind="DISMISSED"]`、`:active`、`[data-presence]`、`[data-keyboard-current="true"]` 或 `[data-optimistic-rollback="true"]` 时，本轮按「状态底色与描边优先可见」设计：叠加层底色设为 `transparent`，仅保留阶段/品牌 `1px` 内描边，并在选中、在场（1.5px）、乐观回退及列表键盘当前行下将 `::after` 内收 `2px`（`var(--space-0-5)`，外圆角内缩至 `var(--radius-sm)`），避免遮盖状态外/内环；若希望已关闭卡片或按下态仍叠加微弱阶段底色（例如 50% 透明），可基于真实截图再微调。
2. **第 5 项新卡片相对时间（`刚刚`）颜色令牌**：全站 `.activity-time` 共用 `--fs-xs`（`12px`）与 `--text-secondary`（`#6B6965`，白底对比度 `5.48:1`）。按 [design-system.md](../../design-system.md) 无障碍约定，`--text-tertiary`（`3.45:1 < 4.5:1 AA`）仅用于禁用、占位与装饰图标，因此保留 `--text-secondary` 待负责人最终确认。

---

## 七、最终宿主结果（br7 / br8，取代上文各表中的「待宿主」状态）

环境：macOS 26.6.2 / Chrome 158.0.8127.37，DPR 1（A5 另开 DPR 2 观察者）；本地 PostgreSQL 隔离库。目标机为 Win10/11 i3/i5，按约定不做 Mac 专项测试。

### 7.1 问题 1–4 在真实环境中是否成立

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 1. 高亮没有停留 | **成立** | main 代码从 `t=0` 以 `--ease-standard` 回到原色；`v229-card36/filmstrip/board-arrival.png` 五帧近似。修复后 `filmstrip/arrival-intake.png` 第 1、2 帧（0 / 240ms）叠加层不透明度为 1，第 6 帧（1440ms）为 0。 |
| 2. 待受理列新卡片与列底混成一片 | **成立** | `visual:compare` 的 `board-new-chip` 在高亮期间截取：main 为无边界黄色块，分支为阶段浅底 + `--highlight-ring-intake` 描边；A4 四边像素与列底色距离 ≥80、与环色距离 ≤10。 |
| 3. 高亮直接改卡片底色 | **成立（代码层）** | main `highlight.ts` 直接写 `el.style.backgroundColor` 并在结束时恢复内联样式；未在浏览器中单独复现「恢复成错误颜色」的画面。修复后 A3：到达后 ≤100ms 选中，结束后保持选中底色与描边；已关闭卡片恢复高亮后仍为已关闭底色。 |
| 4. 未分类 / 未分配占位与原型不一致 | **成立** | `visual:compare` 中 12 个画面的变化即此项（见 7.3）。 |

另：审查中发现并修复的真实缺陷：新到达卡片在页面时钟采样之后到达会显示月日而非「刚刚」（br1 实测 `11-24 14:51`）；窄表固定首列在宽→窄切换时高亮不同步（br5 实测首列 1 / 行 0.5）；恢复事项高亮计时器提前 240ms 取消叠加层。

### 7.2 测试结果

| 范围 | 结果 |
| --- | --- |
| `migration:typecheck` / `migration:build` / `migration:verify-artifact` | PASS |
| stylelint / eslint（`--max-warnings 0`） | PASS |
| copy-terms（编译产物） | 8/8 |
| design-foundation + motion-tools + motion-policy | 93/93 |
| `docs:agents:check` | PASS |
| 39B `pc-admin-card39b-arrival` | **8/8**（43s） |
| 36A / 36B / 36C | 8/8、13/13、22/22 |
| 37A motion / optimistic / recovery | 17/17、26/26、9/9 |
| 37B keys / pauses / recovery / surfaces | 59/59、11/11、15/15、23/23 |
| 37C hovercard | 28/28 |
| 39A ring-room / 39C owner | 3/3、5/5 |
| T42 boundaries / complete-reopen / legal-action / review | 通过 |
| T42 authority-navigation、capability-fallback、t37 list | 失败，与干净 main `64ad8bf2` 相同（main 上 t37 3/3 次失败），非本卡引入 |

### 7.3 `visual:compare`（对干净 main `64ad8bf2` 采集）

19 个画面中 12 个变化，全部为本卡预期，未执行 `visual:approve`，基线由负责人确认后更新：

- 看板卡片未分配占位「—」实心圆 → 空心虚线圆：`board-default`、`board-presence`、`sidebar-online-popover`、`drawer-processing`、`drawer-completed`、`drawer-banner-editing`、`toast-drawer-stack`（各约 63–64 像素，均为背景中同一张卡片）。
- 列表「未领取」列虚线圆改为 `--text-tertiary` 20px：`list-default`、`list-closed-groups`。
- 详情「等待领取」处理人占位同步为 20px 空心虚线圆：`drawer-dismissed`、`restore-dialog`。
- `board-new-chip`：截取于新卡片高亮期间，main 为无边界黄色块，分支为浅底 + 阶段描边 + 虚线未分类方块 + 虚线未分配圆（即问题 2 与问题 4）。

### 7.4 胶片说明

`arrival-intake.png` 第 1 帧（0ms）新卡片处于入场位移起点（`opacity: 0`），因此该帧可见的是让位中的相邻卡片；新卡片自身叠加层不透明度在该帧已为 1（A1 同帧断言）。
