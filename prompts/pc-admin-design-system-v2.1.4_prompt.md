# PC 管理端 v2.1.4 会话页对齐 · 执行 Prompt（卡 23）

> 放在 `prompts/pc-admin-design-system-v2.1.4_prompt.md`。本轮一张卡，一个会话、一个 PR。按顺序粘贴「一」到「七」。
>
> 问题编号 V1–V14 对应「医小修 PC 端 v2.1.3 验收报告（卡22）」。V1–V4 为 P1（可见错误），V5–V14 为 P2（向原型靠拢）。PR 描述和执行记录里必须逐条引用编号。
>
> 注意：报告中 V12 把「发送到本人 Bot 私聊」写成疑似按钮。核对代码后确认它是 `entry.reply_channel_label`，是**回复方式说明，不是操作**。以本 Prompt 为准。

---

## 一、角色与目标

你是一名资深产品设计工程师。卡 22（PR #148，main `6d2e7411`）已合并，R1–R6 全部达标。和原型画板 03「会话」逐项对比后，会话页还有一批细节没有对齐：联系人列表时间、会话头部、消息气泡、输入区、等待横幅、右栏；通知异常页还剩表头和时间两处小问题。

本轮目标是**让会话页在细节上和原型 03 一致**：

1. 每个问题按「现象 → 位置 → 修改 → 验收」执行。验收必须有测试断言或 `getBoundingClientRect` 实测数值，不能只靠截图。
2. 标有「先确认数据」的问题，先检查接口 DTO 里有没有可靠字段，再补合成数据让场景出现。**没有字段就记为契约缺口，不要用其它字段代替或在前端估算。**
3. 不新增功能、不改信息架构、不改后端接口和业务语义。

## 二、边界

1. 先读 `AGENTS.md`，按其「按任务读取」表读取相关文档；流程和验证遵循 ADR-0053 的测试策略。
2. 只改 `app/pc-admin` 前端展示层，以及测试 fixture 中的**合成数据**。不改 `app/server`、`contracts`、数据库迁移、业务命令、状态值和权限判断。
3. 合成数据只能通过现有 fixture / helper 的既有写入方式添加，不新增迁移或 SQL 文件。新增人员、科室、标题一律带「（合成）」。
4. 测试选择器只增不删（包括 `data-message-delivery`、`data-delivery-id`、`data-conversation-item`、`data-contact-ref`、`data-reply-outcome`、`data-note-outcome`、`data-action=*`）。元素可以移动位置，但选择器和属性必须保留。文案改动可同步修改测试里的期望文字，但不得放宽任何业务断言（状态、权限、请求、回执、次数）。
5. 颜色、字号、间距、圆角、阴影都通过 Token；Stylelint 和 ESLint 保持 0；不新增依赖。图标只用项目已有的 `lucide-react`。
6. 未经明确授权，不提交、不推送、不创建 PR；完成后停在「本地验证通过 + 交付说明」。

## 三、事实来源

| 来源 | 作用 |
| --- | --- |
| 「医小修 PC 端 v2.1.3 验收报告（卡22）」 | 本轮全部问题 |
| 原型画布「医小修 PC 管理端 v2.1 设计原型」：03 会话为主，01 工作台、04 通知异常为辅 | 视觉参考（06–08 不作为依据） |
| `docs/ui/design-system.md`、`docs/ui/design-system-v2.1.md` | 规范 |
| `docs/ui/evidence/v213-card22/` | 改前截图 |

**有意保留的差异，本卡不要改**：工具栏横跨整页、位于三栏之上（卡 21 决定）；内部备注的锁图标和「内部」放在气泡里（卡 21 C3）；原型列表上方的「等待最久」排序（新功能）；1440 下保持三栏。

## 四、文件范围

| 可以修改 | 不可修改 |
| --- | --- |
| `features/conversations/ConversationInbox.tsx`、`ConversationComposer.tsx`、`ConversationAssociatedItem.tsx`、`ConversationControl.tsx`（只限按钮外观，不改 `act` 和权限判断）、`conversations.css` | `features/conversations/client.ts`、`inbox-client.ts`、`ConversationReadTimeline.tsx` 的读取逻辑 |
| `src/design/components/Split/*`、`MessageBubble/*`、`ConversationListItem/*`、`SegmentedControl/*`（只限会话输入区用到的样式） | `tokens.css`（确需新 Token 时在 PR 说明中列出理由） |
| 新建 `src/design/format-time.ts` | 工作台、抽屉、看板相关文件 |
| `app/ToastFeedback.tsx`（只限 `DraftStatus` 的展示） | |
| `features/notification-exceptions/*`（只限表头样式和时间格式）、`src/design/components/DataTable/data-table.css`（只限表头分隔线） | |
| 上述功能对应的测试和 fixture | |

- 分支：`codex/pc-admin-v214-card23`，独立 worktree，基于最新 `origin/main`。
- 执行记录：`plans/pc-admin-design-v21/card-23.md`；截图：`docs/ui/evidence/v214-card23/`。

## 五、交付格式

1. 编号清单：V1–V14 每个一行，写「已修改 / 已确认数据并修改 / 契约缺口未处理（理由）/ 已确认无需修改（理由）」。
2. 「先确认数据」各项的结论：查了哪个 DTO、哪个字段、有没有、补了哪些合成数据。
3. 文件清单。
4. 前后对照截图：会话 1920 / 1440 / 900，四种状态各一组：**可回复、无权限、待接待、含发送失败消息**。通知异常 1440。改前取 `docs/ui/evidence/v213-card22/`。
5. 局部截图（2 倍）：联系人列表项、会话头部、带头像的消息组、发送失败消息、输入区底栏、等待横幅、右栏报修人。
6. 实测表：本卡带像素值的验收项，用 `getBoundingClientRect` 实测并列出（允许 ±1px）。
7. Stylelint、ESLint、`migration:build`、`gate.mjs types`、`verify-artifact.mjs` 和相关测试的结果；失败如实列出。
8. 规范文档更新内容。

---

## 六、卡 23 · 会话页对齐原型 03

### 先补合成数据（所有编号共用）

在会话 fixture 中确保以下场景都存在，名称带「（合成）」：

| 场景 | 内容 |
| --- | --- |
| 今天的联系人 | 最近活动 = 今天 09:35 |
| 昨天的联系人 | 最近活动 = 昨天 16:52 |
| 更早的联系人 | 最近活动 = 今年 10-21 |
| 待接待联系人 | `assignment_summary.kind = UNASSIGNED` |
| 我接待 / 他人接待 | `MINE` 和 `ASSIGNED` 各一 |
| 一个会话内的发送状态 | 工程师消息 4 条，投递状态分别为 `SENT`、`PENDING`（排队中）、`DEAD_LETTER`（发送失败，带 `last_error_code`）、`RECONCILIATION_REQUIRED`（结果待核实） |
| 报修人消息 | 至少 2 条，来自同一报修人，间隔 2 分钟 |
| 系统事件 | 一条文本以「。」结尾的系统事件 |

---

### V1 联系人列表时间（P1，部分「先确认数据」）

- **现象**：列表时间全部显示「11-05 00:14」，今天的消息也显示日期。原型显示「20:35」；待接待的显示等待时长「12 分钟」，超过阈值变红「3 小时」。
- **位置**：`ConversationInbox.tsx` 第 142 行 `contact.latest_activity_at.slice(5,16)`。
- **修改**：
  1. 新建 `src/design/format-time.ts`，导出纯函数 `formatListTime(local: string, nowMs: number): string`。输入为北京时间 `YYYY-MM-DD HH:mm:ss`，规则：
     - 今天 → `HH:mm`；
     - 昨天 → `昨天`；
     - 今年更早 → `MM-DD`；
     - 跨年 → `YYYY-MM-DD`；
     - 「今天 / 昨天」按 `Asia/Shanghai` 判断，和会话分隔线（第 95 行）使用同一套日期计算。可以把第 95 行的计算抽到这个文件里共用。
  2. 列表时间改为 `formatListTime`，`<time>` 的 `title` 保留完整时间「YYYY-MM-DD HH:mm（北京时间）」，`dateTime` 为 ISO 格式。
  3. **等待时长（先确认数据）**：检查联系人列表 DTO 里有没有表示「开始等待接待」的字段（例如 waiting_since、unassigned_since 之类）。
     - 有：待接待联系人的时间位置改为等待时长，用 `heatOf` 的阈值和配色（关注色 / 超时红色），格式沿用热度文案（「12 分钟」「3 小时」「2 天」）；`title` 写「已等待 12 分钟，最近活动 YYYY-MM-DD HH:mm」。
     - 没有：保持 `formatListTime`，在执行记录中记为契约缺口「联系人缺少等待起点」。**不要用 `latest_activity_at` 或 `created_at` 代替。**
- **验收**：
  - 单元测试：今天、昨天、今年更早、跨年、午夜边界（今天 00:00:30 和昨天 23:59:30）五种输入。
  - 浏览器断言：今天的联系人时间匹配 `/^\d{2}:\d{2}$/`，昨天的为「昨天」，更早的匹配 `/^\d{2}-\d{2}$/`。

### V2 主题选择器文字压住下拉箭头（P1）

- **现象**：会话头部主题选择器在 1440 下显示「护士站打印设备与护理…」，末尾文字和下拉箭头重叠；900 下同样。
- **位置**：`ConversationInbox.tsx` 第 59 行 `TopicPicker` 中的 `WorkbenchSelect`；相关样式在 `conversations.css` 或 `Split/conversation-v21.css`。
- **修改**：trigger 使用 `display: flex; align-items: center; gap: var(--space-1-5)`；`[data-slot=select-value]` 设置 `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`；箭头 `flex: none`，不使用绝对定位。trigger 左侧加 14px `MessageSquare` 图标（`--text-secondary`），和原型一致。`title` 显示完整主题名。
- **验收**：1440 和 900 下实测 `select-value` 右边缘 ≤ 箭头左边缘 − 4px。

### V3 会话头部姓名被截断（P1）

- **现象**：1440 下头部显示「欧阳慧敏（合…」「心血管内科第二病…」，主题选择器却占了较宽空间。
- **原型布局**：左侧「头像 32 + 姓名（14px / 600）+ 状态标签」，下一行「科室 · 渠道」（12px，`--text-secondary`）；右侧「主题选择器 + ⋯」。
- **修改**：
  1. 头部使用 `display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-3)`。
  2. 左侧身份区内：姓名 `flex: none; white-space: nowrap`，**不截断**；状态标签 `flex: none`；第二行科室 · 渠道 `min-width: 0`，单行省略，`title` 显示全文。
  3. 右侧主题选择器 `max-width: clamp(160px, 28vw, 280px)`，先收缩、先省略。
  4. 1440 及以下：右栏宽度改为 `264px`（当前约 300px），左侧联系人列表不变，把空间让给中间对话栏。1920 下保持现状。
- **验收**：用「欧阳慧敏（合成）」「心血管内科第二病区护士站（合成）」数据，1440 和 1920 下姓名完整显示（断言姓名元素 `scrollWidth <= clientWidth`）；1440 下中间对话栏宽度 ≥ 500px（实测）。

### V4 发送状态孤立在气泡下方（P1）

- **现象**：每条工程师消息下面都有一行右对齐的「排队中」，没有图标、没有上下文。原型中没有这一行。
- **位置**：`ConversationInbox.tsx` 第 104 行 `<footer>`，文字来自第 44–47 行 `deliveryLabel`。
- **修改**：把投递状态分为两类，展示位置不同：

  | 状态（`deliveryLabel` 返回值） | 位置 | 样式 |
  | --- | --- | --- |
  | 渠道已确认发送 | 不显示文字；meta 行时间后加 12px `CheckCheck` 图标，`--text-tertiary`，`aria-label="渠道已确认发送"` | — |
  | 排队中、发送中、正在确认发送状态 | 并入气泡上方 meta 行：「林舟 · 09:10 · 排队中」 | 12px `Clock` 图标 + 文字，`--fs-xs`，`--text-tertiary` |
  | 发送失败 | 气泡下方，右对齐 | 12px `TriangleAlert` + 「发送失败 · {error_code}」，`--tone-danger-fg` |
  | 结果待核实 | 气泡下方，右对齐 | 12px `CircleHelp` + 「结果待核实」，`--tone-attention-fg` |
  | 已取消 | 并入 meta 行 | 同「排队中」，无图标 |

  - `data-message-delivery` 容器和每个 `data-delivery-id` 元素保留，只改变渲染位置。一条消息有多条投递时，按上表优先级显示最需要处理的一条（失败 > 待核实 > 排队/发送中 > 已发送），其余放进 `title`。
  - 不改 `deliveryLabel` 的返回值和判断逻辑。
- **验收**：用合成数据中的四种投递状态断言：`SENT` 消息下方没有文字；`PENDING` 的「排队中」在 meta 行内（和时间元素 `top` 差 ≤ 2px）；`DEAD_LETTER` 和 `RECONCILIATION_REQUIRED` 在气泡下方，颜色分别等于 `--tone-danger-fg` 和 `--tone-attention-fg`。

---

### V5 发送人头像与 meta 间距（P2）

- **现象**：两侧消息都没有发送人头像；meta 行「林舟（合成）  ·  09:10」中间点两侧空隙过大。
- **原型**：报修人消息左侧有 28px 头像；工程师和内部备注在右侧有 28px 头像；meta 为「姓名 · 时间」，间距 4px。
- **修改**：
  1. `MessageBubble` 增加可选 `avatar` 插槽，incoming 放在气泡左侧，outgoing 放在右侧，头像与气泡间距 `--space-2`，头像顶部与 meta 行对齐。
  2. 头像用 `Avatar` 组件，`size={24}` 或 28（如 Avatar 不支持 28，用 24，不要新增尺寸），`name={item.sender_label}`。系统事件不显示头像。
  3. **连续合并**：同一发送人、间隔 ≤ 5 分钟的相邻消息，第二条起不重复显示头像和 meta 行，用等宽占位保持气泡对齐，消息间距从 `--space-4` 缩为 `--space-1-5`。投递状态（V4）属于每条消息，合并时仍然显示在该条的位置。
  4. meta 行 `gap: var(--space-1)`，中间点 `--text-tertiary`。
- **验收**：报修人两条间隔 2 分钟的消息，第一条有头像和 meta，第二条没有；实测 meta 行姓名右边缘到「·」左边缘 = 4px。

### V6 输入区细节（P2）

- **现象**：快捷键写在占位文字里（「回复报修人，通过 Bot 私聊发送 · Ctrl+Enter 发送」）；发送按钮无图标；「内部备注」标签无锁图标。
- **原型**：占位文字「回复将通过 Bot 私聊发送给{报修人}…」；底栏左侧「0 / 2000」，右侧「Ctrl ↵ 发送」提示 + 带 `Send` 图标的发送按钮；「内部备注」标签前有 13px `LockKeyhole`。
- **修改**：
  1. 占位文字：回复为「回复将通过 Bot 私聊发送给 {报修人姓名}…」（姓名去掉「（资料未提供）」；无姓名时为「回复将通过 Bot 私聊发送给报修人…」）；内部备注为「仅内部协作可见，不会发送给报修人…」。
  2. 底栏右侧发送按钮左边加提示 `<kbd>Ctrl</kbd> ↵ 发送`（内部备注为「保存」），`--fs-xs`，`--text-tertiary`。禁用状态下隐藏提示。
  3. 发送按钮前加 14px `Send` 图标；内部备注按钮用 `Save` 图标。
  4. 「内部备注」标签前加 `LockKeyhole` 13px。
- **验收**：截图对照；断言 textarea 的 `placeholder` 不包含「Ctrl」。

### V7 无权限说明行排版（P2）

- **现象**：「你当前没有回复权限」紧贴在标签下面，和占位文字挤在一起；待接待时横幅已写「接待后即可回复」，输入区又重复「领取接待后可回复」。
- **位置**：`ConversationComposer.tsx` 第 124 行 `ds-composer-disabled-reason`。
- **修改**：
  1. 原因文字移到底栏左侧，替换字数计数的位置：13px `LockKeyhole` + 原因文字，`--fs-xs`，`--text-secondary`，和发送按钮垂直居中对齐。
  2. textarea 禁用时占位文字仍显示（V6 的新文案），颜色 `--text-tertiary`。
  3. 等待横幅可见时（`inbox-reception` 未隐藏），输入区**不显示**「领取接待后可回复」，原因文字只保留在 `aria-describedby` 指向的元素中（可用 `sr-only`），保证读屏仍然能读到。
  4. 保持卡 22 R4 的禁用背景、边框和颜色。
- **验收**：无权限场景下，原因文字与发送按钮中心 `top` 差 ≤ 1px；待接待场景下原因文字不可见，但 textarea 的 `aria-describedby` 指向的元素文本包含「领取接待后可回复」。

### V8 孤立的 ⓘ 图标（P2）

- **现象**：900 待接待场景中，输入区左下角只有一个 ⓘ 图标，没有文字。
- **位置**：`app/ToastFeedback.tsx` 第 48 行 `DraftStatus`，只渲染图标，文字在 `title`。
- **修改**：在会话输入区中，`DraftStatus` 显示「图标 + 短文字」，放在底栏左侧字数之后，用「·」分隔，例如「0 / 2000 · 草稿已保存」。没有需要提示的草稿状态时不渲染。不要改变 `DraftStatus` 在其它页面的表现（通过 prop 或容器类名控制）。
- **验收**：900 待接待截图中不再出现单独的图标。

### V9 等待横幅（P2，先确认数据）

- **现象**：横幅为「报修人（资料未提供） 尚无人接待 · 接待后即可回复」；原型为「🕐 宋岚已等待 12 分钟，尚无人接待 · 接待后即可回复」。
- **位置**：`ConversationInbox.tsx` 第 117 行。
- **修改**：
  1. 横幅左侧加 16px `Clock` 图标，颜色 `--tone-attention-fg`。
  2. 姓名去掉「（资料未提供）」后缀，无姓名时显示「报修人」。
  3. 等待时长与 V1 共用同一个数据结论：有字段时显示「{姓名}已等待 12 分钟，尚无人接待」；超过 `heatOf` 的超时阈值时时长用 `--tone-danger-fg`。没有字段时显示「{姓名}尚无人接待」，记为契约缺口。
  4. 「请求人工接管」保持 ghost，「我来接待」保持主按钮并加 14px `Headset` 图标（`Conversations.tsx` 已引入）。
- **验收**：截图对照；断言横幅文字不包含「（资料未提供）」。

### V10 系统事件标点（P2）

- **现象**：「本条消息暂无可展示的文本。 · 00:27」，句号和中间点相撞。
- **位置**：`ConversationInbox.tsx` 第 103 行，系统事件 `{item.text} · {time}`。
- **修改**：仅系统事件拼接时间前，去掉文本末尾的「。」「.」和空白。消息原文不变（`data-session-read-sequence` 等不受影响）。
- **验收**：合成的「。」结尾系统事件渲染为「…文本 · 00:27」。

### V11 列表状态行（P2）

- **现象**：「待接待 1 个主题 · 1 个群」中，状态和数量之间少了「·」；「我接待 / 接待中」的圆点是灰色。
- **原型**：「● 待接待 · 1 个主题」，待接待为 attention 色；「● 接待中 · 我」为品牌蓝。
- **位置**：`ConversationInbox.tsx` 第 144 行 `StatusBadge`。
- **修改**：
  1. `StatusBadge` 和数量之间插入 `<span aria-hidden="true">·</span>`，`--text-tertiary`，两侧 `--space-1`。
  2. 圆点颜色：待接待 → `warning`（保持）；我接待 → `brand`，文字改为「接待中 · 我」；他人接待 → `brand`，文字「接待中」；已结束 → `neutral`。如果 `StatusBadge` 没有 `brand` tone，用现有最接近的蓝色 tone，不新增 Token。
  3. 不改 `assignment_summary` 的判断逻辑。
- **验收**：浏览器断言三种状态的圆点计算颜色；文字依次为「待接待」「接待中 · 我」「接待中」。

### V12 右栏（P2）

- **现象**：「报修人」只有两行纯文字；关联事项卡下面没有打开入口；「发送到本人 Bot 私聊」和上面两行格式不一致，看不出含义。
- **位置**：`ConversationAssociatedItem.tsx` 第 32–33 行。
- **修改**：
  1. **报修人**：头像 32（`Avatar`，`name={entry.participant_label}`）+ 右侧两行：姓名 `--fs-sm` / 600 / `--text-primary`；科室 `--fs-xs` / `--text-secondary`，单行省略。整体 `display: flex; gap: var(--space-2-5)`。
  2. **关联事项**：卡片下方加 ghost 链接「在抽屉中打开 ↗」（14px `ArrowUpRight`，`--text-link`，`--fs-sm`），点击行为与点击卡片相同（先确认卡片当前的点击行为，复用同一个处理函数，不新增跳转）。
  3. **来源**：三行统一为「标签：值」格式：「原始来源：…」「当前沟通：…」「回复方式：{reply_channel_label}」。标签 `--text-secondary`，值 `--text-primary`。「发送到本人 Bot 私聊」是说明，**不做成链接或按钮**。
  4. 三个区块标题间距统一：区块之间 `--space-6`，标题与内容之间 `--space-2`。
- **验收**：截图对照；实测三个区块标题 `top` 间距符合上述规则。

### V13 计数信息（P2，先确认数据）

- **现象**：原型标题旁有「4 位报修人等待回复」，侧栏「会话」有未读徽标；当前都没有。
- **先确认**：是否有接口直接返回「待接待联系人数」和「本人未读数」（不是当前页列表的长度）。
- **修改**：
  - 有可靠计数：标题右侧加 `--fs-sm`、`--text-secondary` 的「{n} 位报修人等待回复」（n = 0 时不显示）；侧栏「会话」加未读徽标，样式与卡 20 T1 的 `--tone-brand-solid` 徽标一致。
  - 只有分页列表长度：**不做**，记为契约缺口。不要用当前页数量冒充总数。

### V14 通知异常表头与时间（P2）

- **现象**：表头单元格之间有竖分隔线，原型 04 没有；时间列今天的记录显示「11-05 00:14」。
- **修改**：
  1. 找到竖线来源（HeroUI Table 的 column separator / resizer，或 `th` 的边框 / 伪元素），只在通知异常和共享 `DataTable` 表头中去掉；表头只保留底部 1px `--border-hair`。确认其它使用 `DataTable` 的页面没有依赖这条竖线。
  2. 时间列改为 `formatListTime`（V1）+ 第二行「N 次尝试」不变；`title` 显示完整时间。
- **验收**：浏览器断言表头 `th` 及其伪元素计算后的 `border-left` / `border-right` 宽度为 0；今天的记录时间匹配 `/^\d{2}:\d{2}$/`。

---

### 规范文档

`docs/ui/design-system.md` 会话章节补充：

- 列表时间格式规则（V1），说明 `formatListTime` 为共享函数；
- 消息组规则：头像位置、连续合并条件（同一发送人、≤ 5 分钟）；
- 投递状态展示规则表（V4）；
- 输入区底栏结构：左侧「字数 / 原因 · 草稿状态」，右侧「快捷键提示 + 发送按钮」；
- 右栏三个区块的结构与间距。

### 卡 23 验收清单

- [ ] V1–V14 逐条有结论和证据
- [ ] V1、V9、V13「先确认数据」写明了 DTO、字段和结论；缺字段的记为契约缺口，没有用其它字段代替
- [ ] 联系人列表时间：今天 `HH:mm`、昨天「昨天」、更早 `MM-DD`
- [ ] 主题选择器文字不压箭头；1440 下姓名完整、中间栏 ≥ 500px
- [ ] 「排队中」不再单独占一行；发送失败和待核实在气泡下方用对应颜色和图标显示
- [ ] 消息有发送人头像，连续消息合并
- [ ] 输入区占位文字不含快捷键；无权限原因在底栏左侧；待接待时不重复提示；无孤立图标
- [ ] 右栏报修人有头像，关联事项有「在抽屉中打开」，来源三行格式统一
- [ ] 通知异常表头无竖线，今天的时间显示 `HH:mm`
- [ ] 会话四种状态 × 三种宽度截图齐全，局部截图齐全

---

## 七、自检清单（逐条回答「是 / 否 + 证据」）

- [ ] 只改了前端展示层和测试合成数据，没有改后端、合同、业务命令、状态值和权限
- [ ] 合成数据只用现有 fixture 的写入方式，没有新增迁移或 SQL 文件，虚构内容带「（合成）」
- [ ] 测试选择器只增不删；移动位置的元素保留了全部选择器和属性
- [ ] 改过的测试只改了文案期望或新增了断言，没有放宽业务断言
- [ ] 新增样式全部经 Token；Stylelint / ESLint 为 0；没有新增依赖
- [ ] 只改了「四、文件范围」允许的文件
- [ ] 带像素值的验收项都有 `getBoundingClientRect` 实测值
- [ ] 「有意保留的差异」四项没有被改动
