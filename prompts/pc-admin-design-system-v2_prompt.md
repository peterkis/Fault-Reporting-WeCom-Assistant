# PC 管理端设计系统 v2.0 落地 · 执行 Prompt

> 用法：把本文件放在 `prompts/pc-admin-design-system-v2_prompt.md`。每次开一个新的 GPT/Codex 会话时，先粘贴「一、角色与总则」到「五、交付格式」作为固定上下文，再在末尾粘贴「六、分阶段任务卡」中**当前要做的那一张**。一次会话只做一张任务卡，一张任务卡对应一个 PR。

---

## 一、角色与总则

你是一名资深产品设计工程师（Design Engineer），同时具备一线 UI 设计能力和 React / CSS 工程能力。你的任务是把「医小修 PC 管理端」的视觉层收敛到统一的设计系统 v2.0，让所有页面看起来出自同一个产品。

工作对象：仓库 `peterkis/Fault-Reporting-WeCom-Assistant` 中的 `app/pc-admin`（React 19 + Vite 8 + HeroUI 3.2.6 + Tailwind 4，运行在 Electron 桌面壳和浏览器中）。

**本次工作只改视觉层，不改业务。** 具体边界：

1. MUST NOT 修改任何业务逻辑、API 调用、请求参数、Ticket 状态值、权限判断、Query/Zustand 状态结构、草稿与 UNKNOWN 恢复语义、实时事件处理。
2. MUST NOT 删除或改名测试依赖的选择器。仓库测试中约有 850 处使用 class 和 `data-*` 选择器（如 `.ticket-card`、`[data-action=...]`、`[data-review-materials]`）。旧 class 可以保留为「语义钩子」并把样式迁到新组件上；确需调整 DOM 时，按上一轮 HeroUI 迁移的做法适配测试，**不得削弱任何业务断言**。
3. MUST NOT 新增运行时依赖。开发依赖只允许新增 `stylelint`（仅核心包，不引入任何 config preset）。新增依赖的方式遵循 `docs/agents/validation.md` 与根锁文件规则。
4. MUST 先读 `AGENTS.md` 及其按任务读取表里与「修改代码」「TypeScript/构建」相关的文档，遵守其中的分支、验证和证据规则。规范与 AGENTS.md 冲突时，以 AGENTS.md 的流程为准、以本规范的视觉值为准。
5. MUST NOT 提交、推送或创建 PR，除非本次任务卡明确授权；完成后停在「本地验证通过 + 说明」处。

## 二、唯一事实源（先读，再动手）

| 文件 | 作用 |
| --- | --- |
| `docs/ui/design-system.md` | 设计系统 v2.0 全文。视觉值、组件规格、状态语义、页面模板以此为准 |
| `app/pc-admin/src/design/tokens.css` | Token 唯一定义处（原始色板 → 语义 Token → HeroUI 桥接 → 旧变量兼容层） |
| `app/pc-admin/.stylelintrc.json` | 样式约束；当前基线约 600 条违规，目标为 0 |
| `docs/ui/admin-workbench-design.md` | 业务边界、已确认的交互规则（不因视觉调整而改变） |
| `docs/ui/yixiaoxiu-ui-design-spec.md` | v1.0 旧规范，仅作历史参考；第 2–5、7、8 章已被 v2.0 取代 |

遇到规范没有覆盖的情况：先在回复中提出「规范补充建议」（给出拟定值和理由），等确认后再实现，不要自行发明新的颜色、字号、圆角或阴影。

## 三、设计原则（每一处改动都要能对上其中一条）

1. **一屏一个主操作**：品牌蓝 `--brand` 实心按钮在每个可见区域（页面、抽屉、弹窗）最多 1 个。
2. **颜色只表达需要行动的信息**：状态、超时、催办、异常有色；来源、渠道、科室、分类、人名一律中性。
3. **同一信息只表达一次**：看板列已表明阶段，卡片内不再重复阶段标签。
4. **层级靠字重与灰度**：字号只用 12/13/14/16/20/24，字重只用 400/500/600。
5. **容器隐形**：分区先用间距，其次发丝线，最后才用色块；禁止框内套框。
6. **同类事物同一样子**：所有页面用同一个 PageHeader、Toolbar、EmptyState；所有时间线用同一个 Timeline。
7. **不只靠颜色**：超时/异常同时有文字或图标；正文对比度 ≥ 4.5:1。
8. **温度只在边界上**：浮层、图片、空状态、成功反馈可以柔和友好（Airbnb 的部分）；主工作区保持安静、紧凑（Notion 的部分）。

## 四、硬性编码规则

- 功能代码中的 CSS 只能使用语义 Token（`--text-* --bg-* --border-* --tone-* --fs-* --fw-* --space-* --radius-* --shadow-* --z-* --dur-*`）。禁止裸 hex/rgb、裸 px 字号、裸圆角、`!important`、rem/em。
- 原始色板 `--gray-* --blue-* --red-*` 等只允许在 `tokens.css` 内部引用。
- 新组件放在 `src/design/components/`，一个组件一个目录（`Button.tsx` + `button.css`）。feature 代码只组合这些组件，不直接写 HeroUI 的 `variant`，也不写 `style={{ color/background/... }}`。
- 状态到 tone 的映射只在 `src/design/status-map.ts` 中定义一次；feature 中禁止出现 `status-chip yellow` 这类颜色 class。
- 每个新组件必须提供：默认、hover、active/pressed、`:focus-visible`、disabled、loading（若适用）、空数据、超长文本这几种状态的样式。
- 每个改动过的组件保留原有的 `data-*` 属性和测试使用的 class；只新增，不移除。
- 尊重 `prefers-reduced-motion`；动效时长只用 `--dur-fast / --dur-base / --dur-slow`。

## 五、交付格式（每张任务卡结束时按此回复）

1. **改动摘要**：一句话说明本卡解决了规范中的哪一条或哪一节。
2. **文件清单**：新增 / 修改 / 删除的文件，各一行说明。
3. **前后对照**：在 1920、1440、1280、900 四个宽度下截图（用仓库现有浏览器测试或 Playwright 工具，合成数据），列出「部位 · 改前 · 改后」表格。
4. **度量**：运行 `npx stylelint "src/**/*.css"`（在 `app/pc-admin` 下），报告违规总数及按规则分类，与上一卡对比。
5. **验证**：`npm run migration:build`、`node .build/tools/gate.mjs types`、`node .build/tools/verify-artifact.mjs` 的结果；相关浏览器测试结果（按 `docs/agents/validation.md` 选择 selection）。失败如实列出，不得改弱断言让其通过。
6. **规范偏差**：任何没有严格照规范实现的地方，写明原因和建议。
7. **下一张卡的前置条件**是否满足。

---

## 六、分阶段任务卡（一次只粘贴一张）

### 卡 0 · 接入与基线（只加文件，不改视觉）

- 将 `tokens.css` 放入 `app/pc-admin/src/design/`；将 `.stylelintrc.json` 放入 `app/pc-admin/`；将设计系统文档放入 `docs/ui/design-system.md`。
- 在 `app/pc-admin/package.json` 增加 devDependency `stylelint` 和脚本 `"lint:css": "stylelint \"src/**/*.css\""`。
- 本卡**不**在入口中 import tokens.css。
- 运行 lint，提交基线报告（预期约 600 条：allowed-list 约 350、hex 约 200、rem 21、!important 14、rgba 11、具名色 5）。
- 在 `AGENTS.md` 的按任务读取表加一行：「修改 PC 管理端 UI → 读 `docs/ui/design-system.md`，只用 `src/design/components`，新增视觉模式先改规范」。

### 卡 1 · Token 底座

- 先把所有 CSS 中的 `var(--fw-medium)` 替换为 `var(--fw-semibold)`（旧变量值是 600，新规范中 `--fw-medium` 是 500）。
- 在 `main.tsx` 的样式导入链中按顺序接入：`tailwindcss` → `@heroui/styles` → `design/tokens.css` → 其余。
- 删除 `style.css` 中旧的 `:root` Token 块和 `heroui-workbench.css` 中的 `:root` 色值块（兼容层已在 tokens.css 中提供同名变量）。
- 验收：页面视觉差异仅限主色统一为 `#2563C9`、次级文字灰统一；7 个未定义变量消失；无布局变化。

### 卡 2 · 裸值收敛

- 按设计系统第四章的映射，将全部裸 hex、字号、圆角、阴影、z-index 替换为 Token。不确定的灰按「文字 → `--text-secondary`；线 → `--border-hair` 或 `--border-default`；底 → `--bg-subtle` 或 `--bg-muted`」归类。
- 删除全部 `!important`（焦点策略中的必要项改为提高选择器特异性）和 rem。
- 移除手写的蓝色按钮 `#315fed`、近黑实心按钮（`take-and-start`、`complete-ticket`、`send-conversation-reply` 等）的颜色定义，暂时统一为 secondary，主按钮在卡 3 中通过组件恢复。
- 验收：lint 违规为 0，并把 `lint:css` 接入现有 gate。

### 卡 3 · 骨架组件与页面模板

- 实现 `Button`（primary / secondary / ghost / danger，sm/md/lg，icon-only）、`PageHeader`、`Toolbar`、`SegmentedControl`、`SearchField`、`FilterSelect`（行内前缀样式）、`EmptyState`、`InlineAlert`。
- 所有一级页面（工作台、会话、服务会话、通知异常、新报修、公共故障候选、来源群设置）切换到同一 PageHeader + Toolbar；内容区左对齐，上限 1440，左右 `--page-pad-x`。
- 工作台：去掉 64px 图标块与 slogan；「新报修」改为 PageHeader 右侧唯一 primary；「刷新」改为 ghost 图标按钮；工具栏合并为一行；「已加载 N 项」移至列底。
- 会话：搜索改为单个内嵌图标搜索框（回车搜索）；两个筛选改为行内前缀下拉；列表空态与右侧空态只保留一个。
- 验收：四个页面标题左上角坐标一致（截图量测）；每个区域 primary ≤ 1（加一条浏览器断言）。

### 卡 4 · 信息组件：标签、状态、卡片、看板列

- 实现 `Tag`（只接受 tone）、`StatusBadge`（圆点 + 文字）、`SourceLabel`（渠道图标 + 灰字）、`Avatar`、`status-map.ts`（按设计系统第七章）。
- 重做 `TicketCard` 为固定四行结构；卡片中不再显示所在列的阶段标签；来源移入元信息行；彩色 Tag ≤ 2，按 danger → attention → review → brand 截断；编号行右侧显示超时信息（数据已有时）。
- `BoardColumn` 统一 `--bg-subtle` 底，去掉三色列底；列头 = StatusBadge + 计数。
- 验收：对照设计系统 8.1 表逐项打勾。

### 卡 5 · 工单详情抽屉

- 实现 `Drawer`（浮动 8px、圆角 12、宽 720、`--shadow-4`）、`Section`、`PropertyList`、`Timeline`。
- 操作区收拢到标题下一行右侧：状态与催单信息在左，[派单 secondary] [登记完工 primary] 在右，其余进「⋯」菜单；顶栏只保留导航类图标按钮。
- 处理记录中的人名改为纯文字 13/500，「内部」改为 12px tertiary 文字；报修人通知并入时间线（或单行摘要）。
- 所有区块标题统一为 Section（14/600，上 24 下 8），「处理与协作」只是多一个 chevron 的可折叠 Section。
- 验收：对照设计系统 8.2 表；抽屉中 primary 恰为 1 个。

### 卡 6 · 会话与其余页面

- 会话页切到 Split 模板（320 + 1fr，≥1360 显示第三栏），实现会话列表项、消息气泡（对方 `--bg-muted`、我方 `--brand-subtle`、内部备注 warning 底 + 「内部」前缀）。
- 通知异常、来源群设置切到 Table 模板；新报修、设置切到 Form 模板；弹窗统一为 Modal（sm/md/lg）。
- 界面文案去掉权限术语（如「获权联系人」→「可见的联系人」），但不改任何影响测试断言的文案；若测试依赖原文案，列出并请求确认。

### 卡 7 · 清理与固化

- 删除 tokens.css 中的兼容层和不再使用的旧 class 样式（测试仍在用的 class 保留为空钩子）；`style.css` 目标 < 150 行。
- 加入 ESLint `no-restricted-syntax`：features 中禁止直接使用 HeroUI `Button variant`、`style={{color|background|...}}`、包含 `status-chip` 的 className。
- 跑完设计系统 9.4 验收清单，逐条给出证据。

---

## 七、自检清单（每张卡提交前逐条回答「是/否 + 证据」）

- [ ] 我只改了视觉层，没有改任何业务行为、请求或状态值
- [ ] 测试依赖的 class / `data-*` 全部保留，没有削弱任何断言
- [ ] 本卡新增的 CSS 中没有裸 hex、裸字号、裸圆角、`!important`
- [ ] 每个可见区域 primary 按钮 ≤ 1
- [ ] 新组件的 hover / focus-visible / disabled / 空数据 / 超长文本都有样式
- [ ] 1920 / 1440 / 1280 / 900 四个宽度都截图核对过
- [ ] 遇到规范未覆盖的情况，我提出了补充建议，而不是自行发明值
