# PC 管理端 v2.1.3 收尾 · 执行 Prompt（卡 22）

> 放在 `prompts/pc-admin-design-system-v2.1.3_prompt.md`。本轮只有一张卡，一个会话、一个 PR。按顺序粘贴「一」到「七」。
>
> 问题编号 R1–R6 对应「医小修 PC 端 v2.1.2 验收报告（卡20 / 卡21）」中的问题：R1、R2 为 P1，R3–R6 为 P2。PR 描述和执行记录里必须逐条引用编号。
>
> 注意：验收报告中 R2 的修复写的是 `stage_entered_at ?? created_at`，**以本 Prompt 为准**：处理中工单的 `stage_entered_at` 为空时无热度，不回退到 `created_at`，和卡片热度现有行为保持一致。

---

## 一、角色与目标

你是一名资深产品设计工程师。v2.1.2（卡 20 PR #142、卡 21 PR #143）已合并到 main `b98d7cda`，整体已经和原型正式画板 01–05、04b 对齐。剩下 6 个问题：2 个正确性问题（R1、R2）和 4 个视觉/状态细节（R3–R6）。

本轮目标是**一次收尾，不留返工**：

1. 每个问题按「现象 → 位置 → 原因 → 修改 → 验收」执行。验收必须有测试断言或实测数值，不能只靠截图。
2. 标有「先确认原因」的问题，先补合成数据让场景真实出现，再判断原因，最后修改。原因写进执行记录。
3. 不新增功能、不改信息架构、不改列顺序、不改后端接口和业务语义。

## 二、边界

1. 先读 `AGENTS.md`，按其「按任务读取」表读取相关文档；流程和验证遵循 ADR-0053 的测试策略。
2. 只改 `app/pc-admin` 前端展示层，以及测试 fixture 中的**合成数据**。不改 `app/server`、`contracts`、数据库迁移、业务命令、状态值和权限判断。
3. 合成数据只能通过现有 fixture / helper 的既有写入方式添加，不新增迁移或 SQL 文件。新增人员、科室、标题一律带「（合成）」。
4. 测试选择器只增不删；文案改动可同步修改测试里的期望文字，但不得放宽任何业务断言（状态、权限、请求、回执、次数）。
5. 颜色、字号、间距、圆角、阴影都通过 Token；Stylelint 和 ESLint 保持 0；不新增依赖。
6. 未经明确授权，不提交、不推送、不创建 PR；完成后停在「本地验证通过 + 交付说明」。

## 三、事实来源

| 来源 | 作用 |
| --- | --- |
| 「医小修 PC 端 v2.1.2 验收报告（卡20 / 卡21）」 | 本轮全部问题 |
| 原型画布：01 工作台、02 抽屉、03 会话、04 / 04b 通知异常、05 色彩系统 | 视觉参考（06–08 不作为依据） |
| `docs/ui/design-system.md`、`docs/ui/design-system-v2.1.md` | 规范 |
| `docs/ui/evidence/v212-card20/`、`v212-card21/` | 改前截图 |

## 四、文件范围

| 可以修改 | 不可修改 |
| --- | --- |
| `src/design/components/Avatar/*` | `src/design/tokens.css`（本卡不需要新 Token；如确需，在 PR 说明中列出并说明理由） |
| `src/design/heat.ts`、`src/design/board-presentation.ts` | 看板列、抽屉、Toolbar 的布局与样式 |
| `src/app/Workbench.tsx`、`src/app/WorkbenchDetail.tsx`（**只限**热度起点计算，改为调用共享函数） | 其它业务功能文件 |
| `features/conversations/ConversationAssociatedItem.tsx`（只限热度起点）、`ConversationInbox.tsx`（只限分隔线）、`ConversationComposer.tsx`（只限禁用态展示） | `features/conversations/client.ts`、`inbox-client.ts` |
| `src/design/components/Split/conversation-v21.css`、`src/design/components/FilterChip/*` | |
| `features/notification-exceptions/notification-exceptions.css` | 通知异常的数据请求与列顺序 |
| 上述功能对应的测试和 fixture | |

- 分支：`codex/pc-admin-v213-card22`，独立 worktree，基于最新 `origin/main`。
- 执行记录：`plans/pc-admin-design-v21/card-22.md`；截图：`docs/ui/evidence/v213-card22/`。

## 五、交付格式

1. 编号清单：R1–R6 每个一行，写「已修改 / 已确认原因并修改 / 已确认无需修改（理由）」。
2. 「先确认原因」各项的结论：补了哪些合成数据、观察到什么、原因是什么。
3. 文件清单。
4. 前后对照截图：1920 / 1440；改前取 `docs/ui/evidence/v212-card*`。
5. 实测表：R5、R6 用浏览器 `getBoundingClientRect` 实测并列出数值（允许 ±1px）。
6. Stylelint、ESLint、`migration:build`、`gate.mjs types`、`verify-artifact.mjs` 和相关测试的结果；失败如实列出。
7. 规范文档更新内容。

---

## 六、卡 22 · 正确性与细节收尾

### R1 头像显示「)」（P1）

- **现象**：看板卡片底部处理人、抽屉「处理人」、会话输入区、侧栏账号处的头像显示「)」。
- **位置**：`src/design/components/Avatar/Avatar.tsx`，fallback 为 `Array.from(name).at(-1)`。
- **原因**：合成数据姓名以「（合成）」结尾，最后一个字符是右括号。真实姓名也可能带「（外包）」「(实习)」之类的后缀，所以不能只靠改数据解决。
- **修改**：
  1. 在 `Avatar` 目录新建并导出纯函数 `avatarInitial(name: string): string`，规则按顺序执行：
     - `trim()`；
     - 循环去掉末尾的括号后缀，全角半角都要处理：`/\s*[（(][^（）()]*[）)]\s*$/u`，直到不再匹配；
     - 结果为空：回退到原始字符串中第一个非括号、非空白字符；仍为空返回 `'—'`；
     - 结果以拉丁字母开头（`/^[A-Za-z]/`）：返回首字母大写，如 `Peter` → `P`；
     - 否则返回最后一个字符（用 `Array.from` 处理代理对），如 `张三` → `三`。
  2. `Avatar` 的 fallback 改为 `avatarInitial(name)`。`aria-label` 和 `title` 保持完整原名，不做剥离。
  3. 颜色哈希保持现在的输入（`personId ?? name`），不要因为剥离后缀而改变已有人员的头像颜色。
  4. `ConversationInbox.tsx` 第 107 行会话头部传入 `participant_label.replace(/（[^）]*）/gu,'')` 的临时处理：改为直接传原名，由 `avatarInitial` 统一处理。保留 `<h2>` 原有的文字处理不变。
- **验收**：
  - 新增单元测试，至少覆盖：`张三（合成）`→`三`、`李四(外包)`→`四`、`王五（合成）（外包）`→`五`、`（合成）`→`合`、`Peter`→`P`、`  赵六  `→`六`、空串→`—`。
  - 浏览器断言：工作台、抽屉、会话页所有 `[data-slot=avatar-fallback]` 的文本都不匹配 `/[()（）]/`。
  - 截图：看板卡片底部、抽屉处理人、会话输入区、侧栏账号的头像局部放大图各一张。

### R2 「已超时」计数与卡片热度不一致（P1，先确认原因）

- **现象**：v212-card20 的 board-1920 截图中，「已超时」tab 显示 1，看板上却有 2 张红色超时卡（IT-0001 待处理 · 超时 1 天；IT-0007 处理中 · 超时 5 小时）。
- **位置**：`src/design/board-presentation.ts` 第 16–17 行：

  ```ts
  case 'overdue': return item.kind === 'ticket' && item.column === 'pending'
    && heatOf(item.created_at...)?.tone === 'danger';
  ```

  同时，热度起点在三处各写了一遍：`Workbench.tsx` 第 95–96 行、`WorkbenchDetail.tsx` 第 128–129 行、`ConversationAssociatedItem.tsx` 第 25 行。
- **原因**：计数只统计「待处理」列，并且只用 `created_at`。卡片热度对处理中的工单用的是 `stage_entered_at`。上面的注释「Active-state start is not projected until Card 11」已经过时，卡 11 已经提供了 `stage_entered_at`。
- **先补合成数据**（工作台 fixture，名称带「（合成）」）：

  | 编号 | 列 | 起点 | 期望热度 | 计入已超时 |
  | --- | --- | --- | --- | --- |
  | a | 待处理 | `created_at` = now − 26h | 超时（天） | 是 |
  | b | 处理中 | `stage_entered_at` = now − 5h | 超时 | 是 |
  | c | 处理中 | `stage_entered_at` = now − 30min | 关注 | 否 |
  | d | 处理中 | `stage_entered_at` = null，`created_at` = now − 2 天 | 无热度 | 否 |
  | e | 已完成 | `completed_at` = 今天，`created_at` = now − 3 天 | 无热度 | 否 |

  补完后观察：修改前的 tab 计数和红色卡片数量各是多少，写进执行记录。同时记录看板上是否有非 `ticket` 类型（`kind`）的卡片显示热度。
- **修改**：
  1. 在 `src/design/heat.ts` 新增并导出：

     ```ts
     export function cardHeatStart(item: Pick<WorkbenchCard,'column'|'created_at'|'stage_entered_at'>): string | null
     // pending → created_at；active → stage_entered_at（为 null 时返回 null，不回退到 created_at 或 updated_at）；closed → null
     export function cardHeat(item: ..., now: number): Heat | null
     // 统一做 ' ' → 'T' + '+08:00' 的转换后调用 heatOf
     ```

  2. `Workbench.tsx`、`WorkbenchDetail.tsx`、`ConversationAssociatedItem.tsx` 三处改为调用 `cardHeat`，删除各自的起点计算。只改这几行，不要动周围代码。
  3. `board-presentation.ts` 中 `overdue` 改为 `cardHeat(item, now)?.tone === 'danger'`，删除过时注释。
  4. `kind` 规则：如果看板上非 `ticket` 卡片也会显示红色超时热度，就一并计入（原则是**用户看到几张红卡，tab 就显示几**）；如果非 ticket 卡片不显示热度，保留 `item.kind === 'ticket'`。在执行记录中写明结论。
  5. tab 的红点、数字、点击后的筛选结果使用同一个函数，不允许出现第二套判断。
- **验收**：
  - 单元测试覆盖上表 a–e 五种情况。
  - 浏览器断言：「已超时」tab 数字 = 看板上 `heat tone=danger` 的卡片数；点击 tab 后可见卡片集合与此一致，并且同时包含 a 和 b。
  - 截图：1920 下「已超时」tab 激活后的看板（新增，之前缺这张）。

### R3 会话分隔线叠在一起（P2）

- **现象**：会话时间线里，「今天」日期分隔线下面紧跟一条「切换到 Bot 私聊」分隔线，两条线上下叠在一起。原型 03 是一条：「今天 · 切换到 Bot 私聊」。
- **位置**：`ConversationInbox.tsx` 第 112 行 `renderBeforeItem`：`newDay` 和 `channel` 在同一个 index 时分别渲染了两个 `<li>`。
- **修改**：
  - 同一个 index 同时满足 `newDay` 和 `channel` 时，只渲染一个 `<li className="inbox-message-divider inbox-date-divider inbox-channel-divider">`，内容为 `<time dateTime={day}>今天</time><span aria-hidden> · </span><span>切换到 Bot 私聊</span>`。中间点用 `--text-tertiary`。
  - 只有其中一个条件成立时保持现状。
  - 样式沿用 `conversation-v21.css` 第 24–25 行的分隔线，不新增样式变体。如果组合类名导致左右线条或间距被重复设置，修正选择器，确保合并后的分隔线和单独的日期分隔线外观一致（上下外边距相同、两侧横线相同）。
- **验收**：
  - 用卡 21 的合成数据（昨天 16:40、昨天 16:52、今天 09:10 切到 Bot 私聊、今天 09:30）断言：分隔线依次为「昨天」「今天 · 切换到 Bot 私聊」，共 2 条。
  - 补一条用例：同一天中途切换渠道，例如今天 09:30 切回群聊，此时出现独立的「切换到 群内原始消息」分隔线。
  - 更新卡 21 的规则描述：分隔线数量 = 天数 + 与当天首条消息**不重合**的渠道切换次数。

### R4 无回复权限时输入区仍像可用（P2，先确认原因）

- **现象**：v212-card21 的会话截图中，侧栏账号标注「只读」，但会话「回复报修人」输入框看起来和可用状态一样。
- **已知事实**（先核对，不要直接改）：
  - 侧栏「只读 / 人工协作」来自 `Workbench.tsx` 第 160 行，依据是工作台协作开关（`internal_notes_enabled` 等），**不是**会话回复权限。
  - 输入框在 `ConversationComposer.tsx` 中已经有 `disabled={!allowed||awaitingReception||busy||unknown}`，其中 `allowed = entry.capabilities.includes(action)`。
- **先补合成数据**：一个会话 `capabilities` 不含回复和内部备注的账号（「只读值班（合成）」），以及一个侧栏为「只读」但会话 `capabilities` 含回复的账号。分别截图。
- **判断与修改**：
  1. 如果截图里的账号其实有回复权限（`allowed=true`）：功能正确，不改逻辑。在执行记录中说明侧栏「只读」和会话权限是两套开关。
  2. 如果 `allowed=false` 但输入框外观没有变化：说明禁用态样式缺失。修改：
     - 输入框容器禁用态：背景 `--bg-subtle`、边框 `--border-hair`、文字和占位符 `--text-tertiary`、`cursor: not-allowed`；字数计数隐藏；发送按钮保持禁用。
     - 输入框上方（替换现有说明行的位置）显示一行 `--fs-xs`、`--text-secondary` 的说明，按原因区分：`!allowed` →「你当前没有回复权限」；`awaitingReception` →「领取接待后可回复」。内部备注同理：「你当前没有内部备注权限」。
     - 两个输入框都不可用时，可以把两个输入区折叠为一行说明，但不得移除 DOM 中已有的测试选择器。
  3. 不改 `allowed` 的计算方式，不改任何权限判断。
- **验收**：浏览器断言：无权限账号下 textarea 为 `disabled`、说明文字可见、计算后背景色等于 `--bg-subtle`；有权限账号下不出现说明文字。

### R5 FilterChip 高度与文字对齐（P2）

- **现象**：筛选 chip 高 30px，同一行的搜索框高 32px，底边不齐；chip 文字视觉上略偏上。
- **位置**：`FilterChip/filter-chip.css`：`--filter-chip-h: calc(var(--control-h-sm) + var(--space-0-5))` = 30px。
- **修改**：
  1. `--filter-chip-h: var(--control-h-md);`（32px；触屏设备上 `--control-h-md` 为 40px，和搜索框同步变化）。
  2. trigger 内 `.ds-board-filter-label` 和 `[data-slot=select-value]` 设置 `line-height: 1`，trigger 本身保持 `align-items: center`；检查 HeroUI select-value 是否有默认 `padding-top` 或 `line-height`，有则清零。
  3. × 按钮仍为 24px，在 32px 高的 chip 内垂直居中，右侧外边距不变。
  4. 工作台、会话、通知异常三页使用同一个组件，改一处全部生效，不要在页面级覆盖高度。
- **验收**（1440，工作台、会话、通知异常各测一次，填入实测表）：
  - chip 高度 = 搜索框高度 = 32px；
  - chip 与搜索框的 `top` 和 `bottom` 差值都 ≤ 1px；
  - 文字盒中心与 chip 中心的垂直差值 ≤ 0.5px（未生效、已生效两种状态都测）。

### R6 通知异常「关联来源」列过宽（P2）

- **现象**：1440 下「关联来源」列约占表格宽度的 40%，内容只是重复的「查看工单 / 查看会话」，右侧大片空白；通知内容挤在固定的 120px 列里。
- **位置**：`notification-exceptions.css` 第 4 行起：除「关联来源」`minmax(240px, 1.5fr)` 外，其余列全部是固定宽度，所以剩余空间全部给了这一列。
- **原因**：只有一个弹性列。工单号、标题、接收人等字段在当前 DTO 中不存在（报告中的 N3 契约缺口），所以这一列现在没有足够的内容撑满宽度。
- **修改**（不改列顺序，只改列宽）：
  - 结果 `120px`；
  - 关联来源 `minmax(140px, 0.6fr)`，链接左对齐，单行；
  - 通知类型 `minmax(160px, 1fr)`，单行省略，`title` 显示全文；
  - 接收人 `minmax(120px, 0.6fr)`；
  - 渠道 `120px`；时间 `140px` 右对齐；操作 `80px` 右对齐。
  - 用现有 Token 组合宽度（参照文件中 `--notification-column` 的写法）；同步更新第 6 行的 `min-width` 计算，保证 900 宽度下仍然横向滚动而不是挤压。
  - 「查看工单 / 查看会话」链接前加 14px 图标（工单用 `ClipboardList`，会话用 `MessageCircle`，用项目已有的图标库），文字 `--text-link`。
- **不在本卡处理**：显示工单号、标题、接收人姓名需要后端增加只读字段，属于 N3 契约缺口。在执行记录中保留 N3 为「未处理：契约缺口」，不要在前端拼凑或伪造这些字段。
- **验收**：
  - 1440 和 1920 实测：关联来源列宽 ≤ 表格宽度的 25%；通知类型列是最宽的弹性列。
  - 900 宽度截图：表格可以横向滚动，列内容不换行、不重叠。

### 规范文档

- `docs/ui/design-system.md`：
  - Avatar 章节补充 `avatarInitial` 规则（后缀剥离、拉丁首字母、回退）。
  - 热度章节补充：「热度起点：待处理用 `created_at`，处理中用 `stage_entered_at`（为空则无热度），已完成无热度；『已超时』计数与卡片热度使用同一函数 `cardHeat`」。
  - 会话章节更新分隔线合并规则。
  - FilterChip 规格中的高度改为 `--control-h-md`。

### 卡 22 验收清单

- [ ] R1–R6 逐条有结论和证据
- [ ] R2、R4 先补了合成数据，修改前的观察和原因写进执行记录
- [ ] 所有页面头像不出现括号字符（浏览器断言）
- [ ] 「已超时」tab 数字 = 红色超时卡数，点击后同时包含待处理和处理中的超时卡
- [ ] 热度起点计算只剩 `heat.ts` 一处
- [ ] 会话分隔线「今天 · 切换到 Bot 私聊」为一条
- [ ] FilterChip 与搜索框高度一致，实测表已填
- [ ] 关联来源列 ≤ 25%，N3 标记为契约缺口
- [ ] 新增截图：已超时 tab 激活看板、头像局部、会话分隔线、无权限输入区、三页工具栏、通知异常 1440 / 1920 / 900

---

## 七、自检清单（逐条回答「是 / 否 + 证据」）

- [ ] 只改了前端展示层和测试合成数据，没有改后端、合同、业务命令、状态值和权限
- [ ] 合成数据只用现有 fixture 的写入方式，没有新增迁移或 SQL 文件，虚构内容带「（合成）」
- [ ] 测试选择器只增不删；改过的测试只改了文案期望或新增了断言
- [ ] 新增样式全部经 Token；Stylelint / ESLint 为 0
- [ ] 只改了「四、文件范围」允许的文件和行
- [ ] 每个编号都有结论；「先确认原因」的编号都写明了数据、观察和原因
- [ ] 带像素值的验收项都有 `getBoundingClientRect` 实测值
