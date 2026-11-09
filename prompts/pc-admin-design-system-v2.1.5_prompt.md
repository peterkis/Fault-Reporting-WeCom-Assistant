# PC 管理端 v2.1.5 字体与细节收口 · 执行 Prompt（卡 24）

> 放在 `prompts/pc-admin-design-system-v2.1.5_prompt.md`。本轮一张卡，一个会话、一个 PR。按顺序粘贴「一」到「七」。
>
> 问题编号：F（字体）、C（会话）、N（通知异常）、G（全局外壳）。PR 描述和执行记录里必须逐条引用编号。
>
> 视觉依据是**最新版**原型画布「医小修 PC 管理端 v2.1.4 · 定稿原型」：01 工作台、02 抽屉、03 会话、03b 会话状态规则、04 / 04b 通知异常、05 色彩系统。旧画板 06–08 已删除，不再作为依据。

---

## 一、角色与目标

你是一名资深产品设计工程师。卡 23（PR #149，main `f71a1cb8`）已合并，V1–V14 的结构和行为都已达标。和最新原型逐像素对比后，剩下的差异集中在三类：

1. **字体没有落地**（F）：原型使用 Inter（西文与数字）+ Noto Sans SC（中文）+ JetBrains Mono（编号与代码），项目里的 `--font-sans` 仍是 `"PingFang SC", "Microsoft YaHei UI", …`，Windows 上实际渲染为微软雅黑，字形、字重和数字宽度都和原型不同。这是整体观感和原型不一致的首要原因。
2. **会话页细节**（C）：气泡形状和内边距、头像尺寸、等待横幅与输入区的组合、草稿按钮、错误码展示等。
3. **通知异常与全局外壳**（N、G）：表头底线断开、结果标签缺图标、页面标题图标、侧栏品牌行、快捷键样式。

本轮目标是**一次收口**：

- 每个问题按「现象 → 位置 → 修改 → 验收」执行。验收必须有测试断言或 `getComputedStyle` / `getBoundingClientRect` 实测值，不能只靠截图。
- 不改信息架构、不改后端接口和业务语义、不改权限判断。

## 二、边界

1. 先读 `AGENTS.md`，按其「按任务读取」表读取相关文档；流程和验证遵循 ADR-0053 的测试策略。
2. 只改 `app/pc-admin` 前端展示层、测试 fixture 中的合成数据，以及 F1 授权的字体依赖。不改 `app/server`、`contracts`、数据库迁移、业务命令、状态值和权限判断。
3. **本卡明确授权新增 3 个依赖**：`@fontsource-variable/inter`、`@fontsource-variable/noto-sans-sc`、`@fontsource-variable/jetbrains-mono`。按仓库惯例**精确锁定版本**（不用 `^`），更新 lockfile。除此之外不新增任何依赖。
4. **不使用任何外部字体 CDN**（包括 Google Fonts）。医院内网和桌面端可能离线，字体文件必须随构建产物本地打包。
5. 合成数据只能通过现有 fixture / helper 的既有写入方式添加，虚构内容带「（合成）」。
6. 测试选择器只增不删；元素可以移动，但选择器和属性必须保留。文案改动可同步修改测试期望，但不得放宽业务断言。
7. 颜色、字号、间距、圆角、阴影都通过 Token；Stylelint 和 ESLint 保持 0。
8. 未经明确授权，不提交、不推送、不创建 PR；完成后停在「本地验证通过 + 交付说明」。

## 三、事实来源

| 来源 | 作用 |
| --- | --- |
| 原型画布 v2.1.4（见开头） | 视觉依据；字体以原型 `.ff` / `.mono` 的声明为准 |
| `docs/ui/design-system.md`、`docs/ui/design-system-v2.1.md` | 规范（本卡会更新字体章节） |
| `docs/ui/evidence/v214-card23/` | 改前截图 |

**有意保留、不要改**：工具栏横跨整页；内部备注的锁图标和「内部」在气泡内；不做「等待最久」排序；会话等待时长和「N 位报修人等待回复」继续作为契约缺口，不估算。

## 四、文件范围

| 可以修改 | 不可修改 |
| --- | --- |
| `package.json`、lockfile（只限 F1 的 3 个字体包） | 其它依赖 |
| 新建 `src/design/fonts.css`；`src/design/tokens.css`（只限字体 Token、F 项需要的 Token、C2 的头像尺寸 Token） | 颜色 Token 的取值 |
| `src/main.tsx` 或应用入口（只限引入 `fonts.css`）；`src/login/login.css`、`src/design/shell.css`（只限字体声明） | 登录、启动页的布局 |
| `src/design/components/Avatar/*`、`MessageBubble/*`、`PageHeader/*`、`StatusBadge/*`（只限 N2 图标）、`DataTable/data-table.css`（只限表头底线） | 其它共享组件的结构 |
| `features/conversations/*`（展示层；不改 `client.ts`、`inbox-client.ts`） | 读取与提交逻辑 |
| `features/notification-exceptions/*`（展示层） | 通知数据请求 |
| 侧栏组件（G2、G3；先定位文件） | 侧栏导航项与权限 |
| 上述功能对应的测试和 fixture | |

- 分支：`codex/pc-admin-v215-card24`，独立 worktree，基于最新 `origin/main`。
- 执行记录：`plans/pc-admin-design-v21/card-24.md`；截图：`docs/ui/evidence/v215-card24/`。

## 五、交付格式

1. 编号清单：每个编号一行，写「已修改 / 已确认无需修改（理由）」。
2. F 项单独一节：依赖版本、打包后的字体文件清单与总大小、首屏实际下载的字体文件数量与大小、CSP 检查结论。
3. 文件清单。
4. 前后对照截图（Windows，缩放 1）：工作台 1440、抽屉 1440、会话四种状态 1440、通知异常 1440；另加 1920 工作台和会话各一张。改前取 `docs/ui/evidence/v214-card23/` 和 `v213-card22/`。
5. 字形局部（2 倍）：工作台卡片编号与标题、会话气泡与 meta、通知表格时间列、侧栏账号区。
6. 实测表：本卡带数值的验收项。
7. Stylelint、ESLint、`migration:build`、`gate.mjs types`、`verify-artifact.mjs` 和相关测试的结果；失败如实列出。
8. 规范文档更新内容。

---

## 六、卡 24

### F · 字体落地（P1）

**F1 本地打包三套字体**

- **现象**：原型 `.ff` 为 `Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif`，编号用 `"JetBrains Mono", ui-monospace, Consolas, monospace`。项目 `tokens.css` 第 67–68 行为 `--font-sans: "PingFang SC", "Microsoft YaHei UI", …`、`--font-mono: ui-monospace, "Cascadia Mono", Consolas, …`，没有引入任何网页字体。Windows 证据截图全部是微软雅黑和 Consolas。
- **修改**：
  1. 安装并精确锁定：`@fontsource-variable/inter`、`@fontsource-variable/noto-sans-sc`、`@fontsource-variable/jetbrains-mono`。
  2. 新建 `src/design/fonts.css`，只引入需要的子集：
     - Inter：`latin` 子集（含数字与常用符号）；
     - Noto Sans SC：使用包内自带的 `unicode-range` 分片（按需加载，不要合并成一个大文件）；
     - JetBrains Mono：`latin` 子集。
     - 所有 `@font-face` 使用 `font-display: swap`。
     - 如果包的默认入口引入了不需要的子集（如 cyrillic、greek、vietnamese），改为按子集文件单独引入。
  3. 在应用入口最先引入 `fonts.css`（在 `tokens.css` 之前）。登录页如果是独立入口，也要引入。
  4. `tokens.css` 第 1 层字体 Token 改为：

     ```css
     --font-sans: "Inter Variable", "Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
     --font-mono: "JetBrains Mono Variable", ui-monospace, "Cascadia Mono", Consolas, monospace;
     ```

     字体族名以包内 `@font-face` 的 `font-family` 实际值为准（先打开包里的 CSS 确认，不要猜）。**Inter 必须排在 Noto Sans SC 之前**：西文、数字、`·` 等符号走 Inter，中文和全角标点回落到 Noto Sans SC。
  5. 新增 Token `--font-num: var(--font-sans)` 和工具类或组件规则：时间、计数、徽标数字、表格数字列统一 `font-variant-numeric: tabular-nums`。先全局搜索现有 `tabular-nums`（当前 23 处），统一改为引用同一规则，不要重复散写。
  6. `:root` 增加 `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;`，和原型一致。保留现有 `font-synthesis` 设置（如有）。
  7. 字重：可变字体只使用 Token 中的 400 / 500 / 600。全局搜索 `font-weight: 700`、`bold`，确认没有绕过 Token 的粗体（粗体 700 在 Noto Sans SC 下会明显比原型重）。

**F2 清理绕过 Token 的字体声明**

- `src/login/login.css` 第 1 行 `font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif` → `var(--font-sans)`。如果登录页不加载 `tokens.css`，在登录入口引入 `fonts.css`，并在 `login.css` 写同样的字体栈（注释说明原因）。
- `src/design/shell.css` 第 2 行 `.workbench-startup` 的 `font-family: ui-sans-serif, …` → `var(--font-sans)`。
- 检查 HeroUI 桥接层：HeroUI 组件（Select、ListBox、Table、Button、Tooltip、Modal）的 `font-family` 计算值必须等于 `--font-sans`。如果 HeroUI 有自己的字体变量（例如 `--font-sans` 同名覆盖或 `--heroui-font-*`），在桥接层映射到我们的 Token。
- 全局搜索 `font-family` 不引用 `var(--font-` 的声明，除 `fonts.css` 中的 `@font-face` 外全部改掉。在 Stylelint 中加一条规则：`font-family` 只允许 `var(--font-*)`（`fonts.css` 豁免）。

**F3 等宽字体的使用范围**

- 只有**工单号 / 受理号、错误码、代码片段**使用 `--font-mono`。
- 快捷键提示（侧栏「Ctrl K」、搜索框「/」、输入区「Ctrl ↵」）**不使用等宽字体**，改用 G3 的 kbd 样式。
- 全局搜索 `var(--font-mono)`（当前 8 处），逐处确认属于上述范围。

**F4 CSP 与桌面端**

- 检查 `index.html` 和桌面端外壳（Electron / 其它宿主）的 Content-Security-Policy。`font-src` 必须允许 `'self'`（如果构建把小字体内联为 data URI，还需要 `data:`）。不得为此放开任何远程源。
- 在执行记录中写明：桌面端打包是否包含字体文件、离线启动时字体是否可用（断网启动截图一张）。

**F 验收**

- 浏览器断言（工作台、会话、通知异常各一次）：
  - `document.fonts.check('14px "Inter Variable"')` 与 `document.fonts.check('14px "Noto Sans SC Variable"')` 为 `true`（族名以实际为准）；
  - 页面加载完成后，`document.fonts` 中 Inter、Noto Sans SC、JetBrains Mono 对应条目的 `status === 'loaded'`；
  - `h1`、卡片标题、气泡正文、表格单元格、HeroUI Select 选项的 `getComputedStyle().fontFamily` 以 Inter 开头；
  - 工单号元素的 `fontFamily` 以 JetBrains Mono 开头。
- 网络面板记录：首屏没有任何外部域名的字体请求；列出首屏实际下载的字体文件和总大小（Noto Sans SC 应只下载用到的分片）。
- 构建产物中字体总大小写进执行记录。

---

### C · 会话页（P2）

**C1 气泡形状与内边距**

- **现象**：所有气泡圆角均为 8px、内边距 8 12（卡 23 实测）。原型 03：气泡圆角 12px，**每组第一条**靠发送人一侧的上角为 4px（报修人左上、工程师右上），内边距 10 12；连续消息（合并后的第二条起）四角都是 12px。
- **修改**：`MessageBubble` 增加 `data-group-position="first|rest"`，样式：
  - incoming first：`border-radius: var(--radius-xs) var(--radius-lg) var(--radius-lg) var(--radius-lg)`（4 / 12 / 12 / 12，`--radius-xs` 4px、`--radius-lg` 12px，均为现有 Token）；
  - outgoing first：`var(--radius-lg) var(--radius-xs) var(--radius-lg) var(--radius-lg)`；
  - rest：四角 `var(--radius-lg)`；
  - 内边距 10 / 12：用 `calc(var(--space-2) + var(--space-0-5)) var(--space-3)`（仓库没有 `--space-2-5`，不要新增）。
  - 系统事件胶囊不受影响。
- **验收**：实测第一条与第二条的四个角半径、内边距。

**C2 消息头像 28px**

- **现象**：消息组头像 24px，原型为 28px。
- **修改**：`Avatar` 增加 `size={28}`，新增 Token `--avatar-msg: 28px`（与现有 `--avatar-sm` 20 / `--avatar-md` 24 / `--avatar-lg` 32 并列），字号 `--fs-xs`。消息组改用 28，合并占位同步改为 28。其它位置不变。
- **验收**：实测头像 28×28，占位宽度 28。

**C3 等待横幅与输入区合为一体**

- **现象**（`conversation-waiting-1440.png`）：横幅和输入区是两个独立的卡片，中间有间隙；横幅文字在 1440 下折成两行；姓名用棕色加粗；待接待时整个输入区变灰并隐藏字数。
- **原型 03**：
  - 横幅贴在输入区正上方：横幅圆角 `10 10 0 0`，输入区圆角 `0 0 12 12`，两者之间没有间隙，横幅下边与输入区上边共用一条 1px 线；
  - 横幅文字单行，超出省略：「**宋岚已等待 12 分钟，尚无人接待**」（`--text-primary` 600）+「 · 接待后即可回复」（`--text-secondary` 400）；当前没有等待时长字段，所以显示「**宋岚尚无人接待**」+「 · 接待后即可回复」；
  - 横幅左侧时钟图标 `--tone-attention-fg`，按钮 `flex: none`；
  - 待接待时输入区保持白底，显示「0 / 2000」，发送按钮禁用，不显示快捷键提示；**灰底只用于「无回复权限」状态**（03b）。
- **验收**：横幅 `bottom` = 输入区 `top`（差 0）；横幅高度 ≤ 52px（单行）；待接待时输入区背景计算值为 `--bg-canvas`，字数可见。

**C4 输入区底栏**

- **现象**（`detail-composer-bottom-x2.png`）：「清理敏感草稿」是带边框的大号按钮，夹在左侧状态和右侧发送之间，字号明显大于周围文字；空输入时不显示快捷键提示；「Ctrl」是普通文字。
- **修改**：
  1. 「清理敏感草稿」改为 ghost 文字按钮：`--fs-xs`、`--text-secondary`、高度 24、无边框，放在左侧状态区末尾：「18 / 2000 · ✓ 草稿已保存 · 清理敏感草稿」。悬停时 `--text-primary` 并显示 `--bg-hover`。`data-action="discard-…"` 保留。
  2. 快捷键提示在**有回复权限且未待接待**时始终显示，不因输入为空而隐藏；只在无权限、待接待、提交中时隐藏。
  3. 「Ctrl」使用 G3 的 kbd 样式。
- **验收**：清理按钮计算字号 = `--fs-xs`、无边框；空输入 + 可回复时快捷键提示可见。

**C5 占位文字空格**

- **现象**：「回复将通过 Bot 私聊发送给 欧阳慧敏（合成） …」，姓名前后多了空格。
- **修改**：拼接时不加空格：「回复将通过 Bot 私聊发送给欧阳慧敏（合成）…」。
- **验收**：断言 placeholder 不包含「给 」和「 …」。

**C6 发送失败的错误码**

- **现象**：失败行显示「发送失败 · V23_SYNTHETIC_FAILURE」，直接展示了原始错误码。原型为「发送失败 · 企微接口超时」。
- **修改**：
  1. 先查前端是否已有投递错误码到中文的映射（搜索 `last_error_code`、通知异常页的错误展示）。有就复用。
  2. 已映射：显示中文说明，原始码放在 `title`。
  3. 未映射：显示「发送失败 · 错误码 」+ 原始码，原始码用 `--font-mono`、`--fs-xs`（仓库没有 11px 字号 Token，不要新增）。
  4. 「结果待核实」同理。
  5. 不新增后端字段，不改 `deliveryLabel` 返回值。
- **验收**：合成数据各一条已映射码和未映射码，断言显示文本与 `title`。

**C7 联系人列表投递异常标记**

- **现象**：列表项徽标前有一个裸的红色「!」。
- **修改**：改为 12px `TriangleAlert` 图标，颜色 `--tone-danger-fg`；保留原有 `aria-label="有投递待处理"` 和 `title`。
- **验收**：截图对照；断言元素内为 svg，不含文本「!」。

**C8 会话头部**

- **现象**：头部没有底部分隔线，滚动时消息内容（系统事件胶囊）从头部下方露出；已接待会话在姓名旁显示灰色「林舟（合成）」标签。
- **修改**：
  1. 头部底部 `1px solid var(--border-hair)`，背景 `--bg-canvas`；消息滚动区从分隔线下方开始，不与头部重叠。
  2. 姓名旁的状态标签与列表状态行保持同一套语义：待接待 →「待接待」warning；本人接待 →「接待中 · 我」brand；他人接待 →「接待中 · {姓名去掉括号后缀}」brand；已结束 →「已结束」neutral。
- **验收**：滚动到中间时截图，头部下方没有内容露出；三种状态的标签文本与 tone 断言。

**C9 右栏字号**

- **现象**：区块标题、报修人姓名、来源三行的字号与原型不一致（卡 23 实测报修人姓名 13px，来源为 12px）。
- **原型 03**：区块标题 13px / 600；报修人姓名 14px / 600；科室 12px；来源三行 13px、行高 22px（标签 `--text-secondary`，值 `--text-primary`）。
- **验收**：`getComputedStyle` 实测上述字号、字重、行高。

---

### N · 通知异常（P2）

**N1 表头底线断开**

- **现象**：表头下方的灰线在列之间断开（每列一段），数据行的分隔线是连续的。原因是 `th` 自带底边框，同时表格行使用了 `column-gap`。
- **修改**：`th` 不设底边框；表头底线只画在 `thead tr` 上（或用 `box-shadow: inset 0 -1px 0 var(--border-hair)`），宽度等于表格宽度。
- **验收**：断言所有 `th` 的 `border-bottom-width` 为 0；`thead tr` 底线元素宽度 = 表格宽度。

**N2 结果标签图标**

- **现象**：「发送失败」「结果待核对」标签没有图标。原型 04：发送失败带 12px `TriangleAlert`，结果待核对带 12px `Clock`。
- **修改**：在标签内加图标，和文字间距 `--space-1`。
- **验收**：截图对照；断言标签内各有一个 12px svg。

**N3 会话来源的姓名后缀**

- **现象**：「会话 · 报修人（资料…」。
- **修改**：姓名去掉「（资料未提供）」后缀：「会话 · 报修人」。其它括号后缀（如「（合成）」）保留。

---

### G · 全局外壳（P2）

**G1 页面标题图标底块**

- **现象**：工作台、会话、通知异常、公共故障的标题图标是 20px 裸图标（`page-header.css` 第 4 行 `background: transparent; border-radius: 0`）。原型 01 / 03 / 04 都是 36px 圆角底块。
- **修改**：`.page-icon` 改为 36×36、圆角 `--radius-md`（8px）、背景 `--bg-muted`、图标 20px `--text-primary`；通知异常页使用 `--tone-danger-bg` 底、`--tone-danger-fg` 图标。标题与图标间距 `--space-3`。有副标题的页面（通知异常），副标题左侧与标题文字对齐（缩进 = 图标宽 + 间距 = 48px）。
- **验收**：四个页面标题左上角坐标一致；图标底块 36×36；通知异常副标题 `left` = `h1` 的 `left`。

**G2 侧栏品牌行**

- **现象**：侧栏顶部直接是「搜索工作区」。原型顶部有品牌行：28px 品牌蓝圆角方块（白色扳手图标）+「医小修」（15px / 600）+「信息服务团队」（12px，`--text-secondary`）。
- **修改**：在侧栏搜索框上方加品牌行，高 48，左右内边距与导航项对齐，与搜索框间距 `--space-2`。团队名来自现有数据（面包屑里已显示「信息服务团队」），不要写死。
- **验收**：截图对照；断言团队名与面包屑一致。

**G3 快捷键样式**

- **现象**：侧栏「Ctrl K」使用等宽粗体纯文字；搜索框「/」和输入区「Ctrl」样式各不相同。
- **修改**：统一一个 `kbd` 样式：高 18、最小宽 18、内边距 0 4、圆角 4、1px `--border-default` 描边、白底、`--fs-xs`、`--text-secondary`、`--font-sans`、`font-weight: 500`。侧栏「Ctrl K」、搜索框「/」、输入区「Ctrl」都使用这个样式。
- **验收**：三处 kbd 的计算样式一致。

---

### 规范文档

`docs/ui/design-system.md`：

- 新增「字体」章节：三套字体的用途、字体栈、子集与本地打包、`tabular-nums` 规则、等宽字体使用范围、禁止外部 CDN、Stylelint 规则。
- 会话章节：气泡圆角与内边距（C1）、头像 28（C2）、横幅与输入区组合（C3）、底栏结构（C4）、错误码展示（C6）。
- 外壳章节：页面标题图标底块（G1）、侧栏品牌行（G2）、kbd 样式（G3）。

### 卡 24 验收清单

- [ ] F1–F4：三套字体本地打包、Token 更新、绕过 Token 的声明已清理、CSP 已检查；`document.fonts` 断言通过；无外部字体请求；离线启动截图
- [ ] C1–C9 逐条有结论和实测值
- [ ] N1–N3 逐条有结论
- [ ] G1–G3 逐条有结论
- [ ] Windows 1440 / 1920 前后对照截图与 2 倍字形局部齐全
- [ ] 规范文档已更新

---

## 七、自检清单（逐条回答「是 / 否 + 证据」）

- [ ] 只新增了 3 个字体包，版本精确锁定；没有其它新依赖
- [ ] 没有任何外部字体 CDN 请求
- [ ] 只改了前端展示层和测试合成数据，没有改后端、合同、业务命令、状态值和权限
- [ ] 测试选择器只增不删；移动的元素保留了全部选择器和属性
- [ ] 新增样式全部经 Token；Stylelint / ESLint 为 0；新增的 `font-family` Stylelint 规则生效
- [ ] 只改了「四、文件范围」允许的文件
- [ ] 带数值的验收项都有实测值
- [ ] 「有意保留、不要改」的各项没有被改动
