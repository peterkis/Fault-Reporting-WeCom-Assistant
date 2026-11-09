# 卡32C-T：卡13 抽屉位置测试稳定性 + 32B 代码尾项

本地交付：2026-11-08（Asia/Shanghai）。分支 `codex/v224-card32c-t`，基线 `main` `7fbcb3df`（#169、#170 已合并）。依据 `pc-admin-v2.2.4_card32C_prompt.md` 32C-T 节；只改测试与 32B 尾项，不改状态、契约或文案。计划见 `card-32c-plan.md`。

环境：Apple M5 Pro、64 GiB、macOS 26.6.2（25G83）、Node v24.18.0、Google Chrome 156.0.8078.81（系统 Chrome，DPR 1）、PostgreSQL 18.6。**未在 Windows 上复测**（本机无 Windows 环境）。

## T2 测试记录

单测命令：`node --test --test-name-pattern "Card 13 next step" .build/runtime/tests/pc-admin-card13.browser.test.mjs`（真实 loopback HTTP + PG）。降速与采样用仅本地的临时补丁注入（`Emulation.setCPUThrottlingRate`、断言前采样写入 JSONL），未提交。

### 步骤 1：三个基线各 10 次

| 基线 | 通过 | 失败时实测 `right`（期望 8） |
| --- | --- | --- |
| `e6fed67d`（#169/#170 合并前） | 0/10 | 7.653–7.996 |
| 合并后 main `7fbcb3df` | 0/10 | 7.653–7.996 |
| 合并后 main + CPU 4 倍降速 | 10/10 | — |

判定：合并前同样失败 → **原本就不稳定，不是回归**，不需要 bisect。降速后反而通过：页面变慢后到达断言时进入动画已结束（见步骤 2），说明这是双向的时序竞态，而不是固定的布局偏差。

过程失败（保留）：第一次降速批次因运行脚本把 `CARD13_CPU=4` 当作命令执行，10 次都在启动前失败（不是测试结果）；修正脚本后重跑，即上表数据。

### 步骤 2：采样证明根因

断言前对 `.ds-drawer` 及其 `.ds-drawer-content` 采样（20 个失败样本全部一致）：

- `transform` 为 `matrix(1, 0, 0, 1, x, 0)`，`x` 为 0.053–0.347（非 `none`）；采样时 `right` 为 7.653–7.947，稍后断言读到 7.653–7.996（动画仍在推进）；
- `getAnimations({subtree:true})` 含 `ds-drawer-enter`，`playState: 'running'`（同时有若干颜色过渡在运行）；
- `right ≈ 8 − x`，与实测值一致。

降速批次的样本：`transform: none`，没有 `ds-drawer-enter` 在运行，`right = 8`。结论：测量发生在抽屉进入动画（`translateX(16px) → 0`，`--dur-slow` 240ms）结束前。

### 步骤 3：修法（只改测试）

- 新增 `tests/helpers/browser-animations.mts` 的 `waitForAnimationsSettled(browser, selector?, timeoutMs=5000)`：等待指定元素子树（省略时为整个文档）内所有有限次数、运行中或待开始的动画 `finished`，若又有新动画开始则继续等，最后等两帧；超过截止时间抛出 `ANIMATIONS_NOT_SETTLED` 并列出未结束的动画。
- 卡13：首次打开抽屉后、四个宽度循环每次 `setDeviceMetricsOverride` 后先调用 helper，再做原几何断言；`width:720 / top:8 / right:8` 仍为**精确相等**，未加容差。新增终态断言：动画结束后 `.ds-drawer-content` 的 `transform` 为 `none` 或单位矩阵。两处证据截图循环同样先等动画。
- `t10-cancel`（#170 B5 截图函数）与 `pc-admin-card32b` 的内联等待逻辑改为调用 helper。

### 步骤 3 复测中发现并处理的问题（保留过程）

1. **第一版修复后 0/20**：抽屉几何断言已全部通过，但同一用例后段的「selected tab has a two-pixel primary-text underline」开始失败——此前被抽屉断言挡住，从未执行到。采样：选中标签的 `border-bottom-color` 过渡仍在运行（`rgba(55,53,47,0.725 / 0.863)` 对比文字色 `rgb(55,53,47)`），与抽屉同属「断言早于过渡结束」。修法同上：断言前 `waitForAnimationsSettled(b,'.ds-detail-tabs')`，样式断言不变。
2. **降速批次 6/10，4 次超时**：helper 的等待在 4 倍降速下有一次 `Runtime.evaluate` 永不返回（表达式长度 533、SHA 与 helper 一致），用例 240 秒超时。helper 改为有界等待：默认 5 秒截止，超时抛出 `ANIMATIONS_NOT_SETTLED` 并列出未结束动画的名称与状态，不再挂起；两帧等待同样有界。
3. **T3 选择器回归**：给全局焦点规则直接加 `:not(.ds-closure-combobox input)` 使其特异性由 (0,4,2) 升到 (0,5,3)，压过 `base.css` 对程序化聚焦（`[tabindex="-1"]`，(0,5,1)）的静默规则，卡13 文件中的「Card 20 … programmatic focus stays quiet」随之失败。改为 `:not(:where(.ds-closure-combobox input))`，特异性保持原值；该用例恢复通过。

### 步骤 4：对照组

同一用例内，在宽度循环之前用 `Emulation.setEmulatedMedia {prefers-reduced-motion: reduce}` 设置 1920 / 1440 两个宽度，**不调用 helper**，立即断言 `{width:720, top:8, right:8}` 精确相等且没有运行中的 `ds-drawer-enter`；随后恢复 `no-preference`。产品 CSS 在减少动态效果时关闭该动画（`drawer.css`），对照组证明布局本身正确。

### 步骤 5：稳定性

修复后在合并后 main（本分支）上执行，只跑「Card 13 next step」用例；降速同样用仅本地的临时注入，结束后已删除。

| 批次 | 结果 |
| --- | --- |
| 正常速度 20 次 | **20/20** 通过 |
| CPU 4 倍降速 10 次 | **10/10** 通过 |

### 步骤 6：同类问题扫描

检索浏览器用例中对抽屉 / 弹窗 / popover / 面板 / 提示读取 `getBoundingClientRect` 的断言，共 51 处（不含本卡已改）：

| 类别 | 位置 | 结论 |
| --- | --- | --- |
| 抽屉绝对位置（`right` / `top`） | `pc-admin-card13` 第 35 行（原） | **竞态，已改**（步骤 3） |
| 抽屉宽度 `Math.round(width)===720` | `t04-self-handling`、`t05-conversation-handling`（2 处）、`t06-assignment`、`t07-atomic-start`、`t11-completion`、`t12-production-form`、`wbint-t14-review`、`wbint-t15-*`（5 处）、`wbint-t42-board-review`、`web01-workbench`（2 处） | 进入动画只做平移，不缩放，宽度不受影响；不改 |
| 抽屉内部相对位置 / 尺寸 | `pc-admin-card13` 第 37、51、88、132、223 行 | 同一抽屉内元素一起平移，差值不受影响；不改 |
| 弹窗尺寸 | `t10-cancel` 第 90 行（`waitFor` 轮询直到 440）、`workbench-toast-feedback` 第 33/37 行 | 前者已轮询；后者在打开弹窗后经过多次交互才测量，且比较的是同一弹窗前后两次尺寸，未观察到失败。HeroUI 弹窗有 `zoom-in-105` 进入动画，理论上存在竞态，列为低风险，未改 |
| 菜单 / 面板 / 提示 | `pc-admin-card29`（⋯ 菜单宽度）、`pc-admin-card31`（在线面板）、`pc-admin-card30b`（提示，先等 500ms）、`pc-admin-card32a`、`pc-admin-card32b`、`workbench-detail-media`（`[role=tooltip]` 可见性） | 无进入位移动画或已等待；不改 |
| 登录页 / 桌面端 | `workbench-desktop-session*`（Windows 任务执行） | 非抽屉 / 弹窗，属登录工牌动画，自带采样；不改 |

## T3 32B 代码尾项

1. 全局焦点规则（`app/heroui-workbench.css`）对组合框内输入加 `:not(:where(.ds-closure-combobox input))` 排除（`:where()` 不增加特异性，见上文第 3 条）；`ticket-card.css` 中靠堆叠特异性的选择器恢复为 `.ds-modal .ds-closure-combobox input:is(:focus,:focus-visible)`。`pc-admin-card32b` 的单层框断言（静止 1px、聚焦 2px `--brand` 环、内层输入无焦点环）不变并通过；`close-dialog-reason.png` 重拍。
2. `ActivityPeople.tsx`：只加注释，说明 `data-presence-banner-anchor` 锚点约定、TicketNotes 改结构时必须保留锚点、锚点卸载后由 MutationObserver 重新计算并清理。代码未动。

## 验证

- `npm run migration:build`、`node .build/tools/gate.mjs types`、`node .build/tools/verify-artifact.mjs`、`npm run docs:agents:check`、pc-admin `typecheck` / `lint:css` / `lint:features`：通过。
- `pc-admin-card13` 整个文件 7/7 通过（含 Card 18、Card 20）；`pc-admin-card32b`、`t10-cancel`、`workbench-detail-restructure` 共 10/10 通过。
- `close-dialog-reason.png` 重拍于 `docs/ui/evidence/v224-card32c/`（macOS Chrome，DPR 1，非 Windows）；单层框断言随 `pc-admin-card32b` 通过。

## 回退

还原本卡提交即可；产品行为除焦点选择器写法外无变化（焦点外观不变）。
