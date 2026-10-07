---
name: yixiaoxiu-ui-design-spec
title: 医小修 · 医院工单管理端 UI 设计规范（Notion 风格）
version: 1.0
platform: PC Web（桌面端管理后台）
reference_canvas: https://claude.ai/artifact/Krt7Bga9yxRcbKa1JK3Kmq
screens: [团队工作台-看板, 团队工作台-列表, 工单详情抽屉]
design_language: Notion-style（中性灰阶 + 柔和语义色 + 无描边卡片 + 轻阴影）
canvas_width: 1440
---

# 0. 给 Agent 的使用说明

- 本文档是**可执行规范**：先读第 1、2 章（原则与 Token），再按需读第 5 章对应组件。
- 关键词含义：**MUST** = 必须；**SHOULD** = 默认应当，需有理由才可偏离；**MUST NOT** = 禁止。
- 所有颜色、字号、间距、圆角、阴影**必须通过第 2 章的 Token 使用**，不要在组件里写裸 hex。
- 第 11 章列出了原型中**尚未满足规范**的地方；生成代码时 MUST 按第 11 章的修正值实现，而不是照抄原型。
- 原型中的示例数据（工单、人名、时间线文案）是合成数据，不得当作真实业务规则。

---

# 1. 设计原则

1. **内容优先，容器隐形**：卡片无描边，仅用极轻阴影；分隔用 1px 低对比发丝线，不用粗框。
2. **颜色只表达需要行动的信息**：只有「状态」和「超时」使用语义色；分类、位置、报修人一律中性灰。
3. **一屏一个主操作**：整屏只有一个实心蓝色按钮（新建报修）；抽屉内主操作是「标记已解决」。
4. **层级靠字重与灰度，不靠字号堆叠**：全局只用 400 / 600 / 700 三个字重，正文只有 14 / 13 / 12 三档。
5. **可扫读**：卡片与列表行的阅读顺序固定（编号 → 标题 → 位置 → 状态 → 负责人与耗时）。
6. **协作可见但不抢眼**：在线与正在查看/编辑用小头像和圆点表达，不用整行文字。
7. **不能只靠颜色传达信息**：红色超时必须同时有文字（耗时数字或「需跟进」标签）。

---

# 2. Design Tokens

## 2.1 CSS 变量（参考实现，直接可用）

```css
:root{
  /* 字体 */
  --font-sans: ui-sans-serif,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  --font-mono: ui-monospace,Menlo,Consolas,monospace;

  /* 文字 */
  --text-1:#37352F;          /* 主文字、标题 */
  --text-2:#6B6965;          /* 次级文字、图标、元信息 */

  /* 背景与交互底色 */
  --bg:#FFFFFF;
  --bg-sidebar:#F7F7F5;
  --bg-hover:#EFEFED;        /* 导航/页签/幽灵按钮悬停、页签选中 */
  --bg-active:#EBEBE9;       /* 导航当前项 */
  --bg-neutral:#F1F1EF;      /* 中性标签、图标瓷砖、分段控件底 */
  --bg-row-hover:#F7F7F5;    /* 列表行悬停、抽屉属性值悬停、引用块 */
  --bg-row-selected:#E7F3F8; /* 列表行选中（抽屉打开中） */

  /* 发丝线与描边环 */
  --line-hair:rgba(55,53,47,.09);
  --ring-1:rgba(55,53,47,.12);   /* 搜索框 */
  --ring-2:rgba(55,53,47,.16);   /* 输入框 */

  /* 主操作与危险 */
  --primary:#1D6FBF;  --on-primary:#FFFFFF;
  --primary-hover:#1A63AB;       /* 建议值 */
  --danger:#B4332B;              /* 超时文字 */
  --badge:#C9332D;               /* 导航红色角标底（修正值，见 11） */

  /* 语义标签 底色 / 文字 */
  --tag-yellow-bg:#FBF3DB; --tag-yellow-fg:#7F5F01;
  --tag-blue-bg:#E7F3F8;   --tag-blue-fg:#1B6A8F;
  --tag-red-bg:#FDEBEC;    --tag-red-fg:#B4332B;
  --tag-green-bg:#EDF3EC;  --tag-green-fg:#2F6B4A;
  --tag-orange-bg:#FAEBDD; --tag-orange-fg:#9A4A0A;
  --tag-gray-bg:#F1F1EF;   --tag-gray-fg:#5F5E5B;

  /* 看板列淡色底 */
  --col-pending-bg:#FCF9F0; --col-doing-bg:#F3F8FB; --col-done-bg:#F4F8F3;

  /* 头像（底 / 字） */
  --av1-bg:#D3E5EF; --av1-fg:#18516F;   /* 林舟 */
  --av2-bg:#F5E0E9; --av2-fg:#8A2D5B;   /* 陈悦 */
  --av3-bg:#E8DEEE; --av3-fg:#5B3C79;   /* 周宁 */
  --av4-bg:#FADEC9; --av4-fg:#8A430C;   /* 沈然 */

  /* 在线状态与未领取 */
  --online:#3E8E7E;  --offline:#C9C8C5;  /* online 为修正值 */
  --unassigned-border:#8A8985;           /* 修正值 */

  /* 圆角 */
  --r-tag:4px; --r-md:6px; --r-lg:8px; --r-xl:12px; --r-tile:16px; --r-full:50%;

  /* 阴影 */
  --sh-card:0 1px 2px rgba(15,15,15,.08),0 2px 6px rgba(15,15,15,.04);
  --sh-card-hover:0 2px 4px rgba(15,15,15,.10),0 6px 16px rgba(15,15,15,.08);
  --sh-seg-active:0 1px 2px rgba(15,15,15,.12);
  --sh-drawer:-8px 0 32px rgba(15,15,15,.14);
  --scrim:rgba(55,53,47,.14);

  /* 布局 */
  --sidebar-w:240px; --topbar-h:44px; --content-max:1240px; --drawer-w:600px;
}
```

## 2.2 字号 · 字重 · 行高（类型阶梯）

| 角色 | 字号 | 字重 | 行高 | 颜色 | 字距 | 用于 |
|---|---|---|---|---|---|---|
| 页面标题 H1 | 36px | 700 | 1.2 | text-1 | -0.5px | 「团队工作台」 |
| 抽屉标题 H2 | 28px | 700 | 1.3 | text-1 | -0.3px | 工单标题 |
| 卡片标题 | 15px | 600 | 1.4 | text-1 | 0 | 看板卡片标题 |
| 工作区名称 | 15px | 600 | normal | text-1 | 0 | 侧栏顶部「医小修」 |
| 正文 / 导航 / 按钮 | 14px | 400（导航当前项与主按钮 600） | normal；多行正文 1.6 | text-1 | 0 | 通用 |
| 列表行标题 | 14px | 600 | normal | text-1 | 0 | 单行省略 |
| 状态胶囊 | 14px | 600 | normal | 语义 fg | 0 | 看板列头、分组头 |
| 元信息 | 13px | 400 | 1.5 | text-2 | 0 | 位置·报修人、耗时、列头计数、统计行、表头 |
| 标签 Tag / 角标 / 小标题 | 12px | 400 | normal | 语义 fg 或 text-2 | 0 | 标签、补充数、侧栏分组标题 |
| 工单编号 | 12px | 400 | normal | text-2 | 0 | `--font-mono` |
| 副标题 | 14px | 400 | normal | text-2 | 0 | 「让每一件报修，都有回应。」 |

规则：
- 字重 MUST 仅使用 400 / 600 / 700。
- 正文字号只有 14 / 13 / 12 三档，标题 15 / 28 / 36；MUST NOT 引入其他字号。
- 中文 MUST NOT 使用全大写、斜体；英文标签使用 sentence case。
- 时间、编号列 SHOULD 加 `font-variant-numeric: tabular-nums`（数字等宽，避免跳动）。
- 单行截断：`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`。

## 2.3 间距

基础网格 4px，常用值：`2 4 6 8 10 12 14 16 18 20 24 28 32 40 48`。

| 场景 | 值 |
|---|---|
| 页面内容区 | `max-width:1240px; margin:0 auto; padding:28px 48px 48px` |
| 看板列间距 / 卡片间距 | 16px / 8px |
| 卡片内边距 | 12px 14px |
| 标签行外边距 | 10px 0 12px，标签间 gap 6px |
| 导航项内边距 | 6px 8px，图标与文字 gap 10px |
| 工具栏外边距 | 28px 0 14px，底部 padding 6px |
| 抽屉正文内边距 | 12px 40px 40px |

## 2.4 圆角

| 元素 | 值 |
|---|---|
| 标签 Tag | 4px |
| 按钮、页签、导航项、列表行、分段控件 | 6px |
| 卡片、引用块、输入框 | 8px |
| 看板列、状态胶囊、统计胶囊 | 12px |
| 标题图标瓷砖 | 16px |
| 头像 | 50% |

规则：圆角随元素尺寸分级，MUST NOT 给所有元素同一个圆角。

## 2.5 对比度（已用 WCAG 公式实算）

| 前景 / 背景 | 比值 | 结论 |
|---|---|---|
| text-1 `#37352F` / 白 | 12.26 | AA/AAA |
| text-2 `#6B6965` / 白 | 5.48 | AA |
| text-2 / 侧栏底 `#F7F7F5` | 5.11 | AA |
| text-2 / 看板列底（三色） | 5.10–5.20 | AA |
| text-2 / 导航当前项 `#EBEBE9` | 4.59 | AA（余量小，MUST NOT 再加深底色） |
| text-2 / 悬停底 `#EFEFED` | 4.76 | AA |
| 黄标签 `#7F5F01` / `#FBF3DB` | 5.35 | AA |
| 蓝标签 `#1B6A8F` / `#E7F3F8` | 5.30 | AA |
| 红标签 `#B4332B` / `#FDEBEC` | 5.30 | AA |
| 绿标签 `#2F6B4A` / `#EDF3EC` | 5.61 | AA |
| 橙标签 `#9A4A0A` / `#FAEBDD` | 5.36 | AA |
| 灰标签 `#5F5E5B` / `#F1F1EF` | 5.73 | AA |
| 超时红字 `#B4332B` / 白 | 6.09 | AA |
| 主按钮 白 / `#1D6FBF` | 5.15 | AA |
| 头像四色 | 5.66–6.81 | AA |
| 选中行 text-1 / `#E7F3F8` | 10.84 | AAA |
| 红角标 白 / `#C9332D`（修正后） | 5.26 | AA |
| 红角标 白 / `#E03E3E`（原型旧值） | 4.26 | **不达标**，禁用 |
| `#8A8985` / 白（原型快捷键提示旧值） | 3.50 | **文字不达标**，仅可用于非文字边框 |

规则：所有 ≤ 18px 的文字 MUST ≥ 4.5:1；非文字图形（边框、圆点）SHOULD ≥ 3:1，或旁边有文字冗余。

---

# 3. 布局与响应式（Grid / Flex）

## 3.1 应用外壳

```css
.app{display:flex;min-height:100vh}                 /* 原型为 min-height:900px */
.sidebar{width:var(--sidebar-w);flex:none;background:var(--bg-sidebar);
         padding:12px 8px;display:flex;flex-direction:column;gap:2px;box-sizing:border-box}
.main{flex:1;min-width:0}                           /* min-width:0 防止子级撑破 */
.topbar{height:var(--topbar-h);display:flex;align-items:center;
        justify-content:space-between;padding:0 24px}
.page{max-width:var(--content-max);margin:0 auto;padding:28px 48px 48px}
```

## 3.2 各区域布局方式

| 区域 | 方案 |
|---|---|
| 外壳 | flex（侧栏固定宽，主区 `flex:1; min-width:0`） |
| 侧栏纵向 | flex column，弹性占位 `flex:1` 把「设置」顶到底部 |
| 标题区 | flex，`align-items:center; gap:20px` |
| 工具栏 | flex，`gap:4px`，中间 `flex:1` 占位，把搜索/筛选/排序/视图切换/新建推到右侧 |
| 看板 | `display:grid; grid-template-columns:repeat(3,1fr); gap:16px; align-items:start`（列高度由内容决定） |
| 卡片内部 | 纵向堆叠；头部、底部行用 flex `justify-content:space-between` |
| 列表行 | grid，见 5.10 |
| 抽屉属性 | grid `88px 1fr`，`row-gap:4px` |

## 3.3 响应式

| 断点 | 行为 |
|---|---|
| ≥ 901px | 侧栏 + 主区；看板 3 列 |
| ≤ 900px | 侧栏隐藏；看板变 1 列；页面内边距 24px 16px；工具栏 `flex-wrap:wrap` |
| 列表视图任意宽度 | 表格外层 `overflow-x:auto`，表格 `min-width:900px`，页面 body MUST NOT 横向滚动 |
| 抽屉 ≤ 900px | SHOULD 变为全宽：`width:min(600px,100vw)` |

参考画布宽度 1440px；MUST 在 1280px 宽度下复核无溢出。

---

# 4. 信息层级

## 4.1 页面级（自上而下）

1. 页面标题（36/700）+ 副标题（14/text-2）
2. 视图页签 + 工具栏（一条发丝线收束）
3. 统计行：**「N 项需要跟进」琥珀胶囊（唯一高亮）** → 「全部 N 项」→ 右侧时间范围
4. 内容区（看板 / 列表）

## 4.2 工单卡片 / 列表行（阅读顺序固定）

| 层级 | 内容 | 样式 |
|---|---|---|
| L1 | 工单标题 | 15/600（列表 14/600）text-1 |
| L2 | 状态标签、耗时（超时时） | 语义色标签；超时红字 600 |
| L3 | 位置 · 报修人 | 13/400 text-2 |
| L4 | 工单编号、分类、补充条数 | 12，mono / 灰标签 / text-2 |
| L5 | 负责人（头像+姓名）、耗时 | 13，头像 22px |

规则：
- 只有「状态」与「超时」可带彩色；分类标签 MUST 为中性灰。
- 同一张卡片内彩色元素 SHOULD ≤ 2 个（状态 + 需跟进）。
- 看板每列默认展示 3 张，其余折叠为「还有 N 项」（13/text-2）。

---

# 5. 组件规范

## 5.1 侧边栏与导航

- 宽 240px，底色 `--bg-sidebar`；顶部为工作区切换（24px 黑色圆角方块 Logo + 「医小修」15/600 + 右侧团队名 12/text-2）。
- 搜索框：白底、`box-shadow:inset 0 0 0 1px var(--ring-1)`、圆角 6px、内边距 6px 8px；右侧快捷键提示 12px，**颜色用 text-2**。
- 分组标题（「工作空间」「团队成员 · 3 人在线」）：12px / text-2，内边距 14px 8px 4px。
- **导航项 MUST 渲染为中性文字，不得出现浏览器默认蓝色与下划线**：

```css
a,a:visited{color:inherit;text-decoration:none}
.nav-item{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer}
.nav-item:hover{background:var(--bg-hover)}
.nav-item.is-active,.nav-item.is-active:hover{background:var(--bg-active);font-weight:600}
.nav-item svg{width:18px;height:18px;stroke:var(--text-2);fill:none;stroke-width:1.6;
              stroke-linecap:round;stroke-linejoin:round;flex:none}
```

- 图标：18px、线性、线宽 1.6、圆角端点、颜色 text-2；MUST NOT 使用 emoji 图标。
- 右侧附属信息：文字徽标（如「预留」）12px/text-2；数字角标（如异常数）为红底白字 12px、圆形、`min-width:18px;height:18px`，底色用 `--badge`。
- 团队成员行：22px 头像 + 姓名；「你」标记 12px/text-2；在线圆点 8px 靠右（`margin-left:auto`）。
- 「设置」固定在侧栏底部。

## 5.2 顶栏

- 高 44px，内边距 0 24px，13px / text-2；左：面包屑「团队 / **当前页**」，当前页用 text-1、字重 500。
- 右：三枚 18px 重叠头像（2px 白环）+「N 位同事在线」+「原型」灰标签。「原型」标签仅用于原型，上线 MUST 移除。

## 5.3 标题区域

- flex 横排，`gap:20px`：64×64 瓷砖（`--bg-neutral`、圆角 16px、30px 线性图标，线宽 1.6，描边 text-1）+ 文案块。
- H1 36/700/1.2，字距 -0.5px；副标题 14/text-2，距标题 4px。
- 副标题只写一句价值主张，不写操作说明。

## 5.4 工具栏

```
[团队工作] [与我有关] [公共故障]   ………   [搜索工单] [筛选] [排序]  [看板|列表]  [+ 新建报修]
```

| 元素 | 规格 |
|---|---|
| 页签 | 内边距 6px 10px；圆角 6px；默认 text-2；悬停 `--bg-hover`；**选中**：`--bg-hover` 底 + text-1 + 600 |
| 幽灵按钮（搜索/筛选/排序） | 无边框无底；内边距 6px 10px；text-2；悬停 `--bg-hover`；带图标时 gap 6px |
| 分段控件（看板/列表） | 容器底 `--bg-neutral`、内边距 2px、圆角 6px；选中项白底 + `--sh-seg-active` + text-1 |
| 主按钮（新建报修） | 底 `--primary`、白字、600、内边距 7px 14px、圆角 6px、无边框；整屏唯一 |
| 工具栏容器 | `margin:28px 0 14px; padding-bottom:6px; box-shadow:0 1px 0 var(--line-hair)` |

规则：整屏 MUST 仅有一个实心主按钮；视图切换 MUST 使用分段控件，不使用两个独立按钮。

## 5.5 统计行

- flex，`gap:16px`，13px / text-2，下边距：看板 16px、列表 8px。
- 「N 项需要跟进」：琥珀胶囊（`--tag-yellow-bg` / `--tag-yellow-fg`，圆角 12px，内边距 3px 10px，600）。数字 N = 带「需跟进」或已超时的工单数。
- 右侧靠右放时间范围说明（如「已关闭仅显示 10/06 – 10/07」）。

## 5.6 看板

**列**
- 圆角 12px，内边距 `8px 8px 4px`，底色三选一：待受理 `--col-pending-bg`、处理中 `--col-doing-bg`、已关闭 `--col-done-bg`。
- 列头：状态胶囊 + 数量（13/text-2）+ 右侧「+」。列头内边距 `6px 8px 10px`。
- 状态胶囊：圆角 12px、内边距 2px 10px、600；左侧 7px 圆点用 `::before{background:currentColor}`。

**卡片**

```css
.card{background:#fff;border-radius:8px;padding:12px 14px;margin-bottom:8px;
      box-shadow:var(--sh-card);cursor:pointer;transition:box-shadow .15s}
.card:hover{box-shadow:var(--sh-card-hover)}
```

卡片结构（自上而下）：
1. 头部行（高 18px，flex 两端对齐）：左 工单编号（mono 12）；右 协作状态小头像（可选）。
2. 标题：15/600/1.4，上下外边距 4px。
3. 元信息：`位置 · 报修人`，13/text-2/1.5；可多一行「下次跟进 今天 14:30」。
4. 标签行：flex-wrap，gap 6px，外边距 10px 0 12px：状态标签 → 分类灰标签 → 补充条数（12/text-2，如「补充 1」）。
5. 底部行（flex 两端对齐，13/text-2）：左 负责人（头像 22px + 姓名）或「等待领取」；右 耗时。

规则：卡片 MUST NOT 加描边；悬停只加深阴影，MUST NOT 位移。

## 5.7 标签（Tag）

- 12px、内边距 1px 8px、圆角 4px、`white-space:nowrap`；底色 / 字色成对使用（见 2.1）。
- 状态 → 颜色映射（**唯一合法映射**）：

| 状态文案 | 颜色 | 含义 |
|---|---|---|
| 待复核、待接单 | 黄 | 等待我方动作 |
| 重新报障、等待补充 | 橙 | 需要报修人或重新处理 |
| 处理中、等待厂商 | 蓝 | 进行中 / 等待外部 |
| 需跟进 | 红 | 需立即关注（与超时联动） |
| 已关闭 | 绿 | 完成 |
| 分类：终端设备 / 业务系统 / 网络通信 | 灰 | 中性属性，MUST NOT 彩色 |

## 5.8 头像与协作状态

**头像**
- 22px 圆形，12px/600，单字（团队成员取名字末字，如「舟」「悦」「宁」「然」）；每位成员颜色固定（av1–av4），MUST 保持跨视图一致。
- 小头像 18px/11px，外加 `box-shadow:0 0 0 2px #fff` 白环（用于卡片右上、顶栏重叠头像）。
- 未领取：空心圆，`border:1.5px dashed var(--unassigned-border)`，旁边文字「等待领取」（看板）/「未领取」（列表）。

**协作状态**
| 信号 | 呈现 |
|---|---|
| 同事正在查看/编辑某工单 | 卡片右上 18px 头像，`title` 与 `aria-label` 写「陈悦正在查看」「周宁正在编辑」 |
| 成员在线 | 侧栏 8px 绿点（`--online`）；离线灰点（`--offline`） |
| 在线人数 | 顶栏「N 位同事在线」+ 重叠头像 |

规则：状态 MUST 有文字可读版本（title / aria-label），不得仅靠圆点颜色；协作信号 MUST NOT 占整行。

## 5.9 超时预警

| 层级 | 呈现 |
|---|---|
| 工单级 | 耗时文字改为 `--danger`、字重 600（看板在底部行右侧；列表在末列右对齐） |
| 工单级（补充） | 同卡片带红色「需跟进」标签；如有计划，加一行「下次跟进 今天 14:30」（13/text-2） |
| 页面级 | 统计行琥珀胶囊「N 项需要跟进」 |

规则：
- 原型只对 WX-2387（处理中 · 等待厂商 · 2 小时 4 分）做了预警；**超时阈值未在原型中定义**，SHOULD 做成可配置（按状态/分类设 SLA），不得写死。
- 超时 MUST 红字 + 数字/标签冗余，MUST NOT 仅改变底色或边框。
- 一屏内红色文字 SHOULD 仅用于真正超时项，避免「处处是红」。
- 耗时格式统一：`42 分钟`、`1 小时 26 分`、`2 小时 4 分`（数字与单位之间有空格）。

## 5.10 列表视图

```css
.table-wrap{overflow-x:auto}
.row,.row-head{display:grid;
  grid-template-columns:84px minmax(240px,1fr) 96px 92px 170px 80px 110px 90px;
  min-width:900px;gap:12px;align-items:center;padding:0 12px;box-sizing:border-box}
.row-head{height:32px;font-size:13px;color:var(--text-2);box-shadow:inset 0 -1px 0 var(--line-hair)}
.row{height:44px;border-radius:6px;cursor:pointer}
.row:hover{background:var(--bg-row-hover)}
.row.is-selected{background:var(--bg-row-selected)}
```

| 列 | 内容 | 对齐 |
|---|---|---|
| 编号 | mono 12 text-2 | 左 |
| 标题 | 14/600，单行省略 | 左（弹性列） |
| 状态 | 状态标签 | 左 |
| 分类 | 灰标签 | 左 |
| 位置 | 14px / text-2 | 左 |
| 报修人 | 14 text-1 | 左 |
| 负责人 | 头像 22px + 姓名；未领取为虚线圆 + text-2 | 左 |
| 耗时 | 13 text-2；超时 `--danger` 600 | **右对齐** |

- 分组头：`display:flex;gap:8px;padding:20px 12px 6px`，状态胶囊 + 数量（13/text-2）。
- 每组默认展示 3 行 + 「还有 N 项」（13/text-2，内边距 8px 12px）。
- 行为：整行可点击，点击在右侧打开抽屉，并将该行置为 `is-selected`。

## 5.11 工单详情抽屉（侧边 peek）

| 项 | 规格 |
|---|---|
| 容器 | 宽 600px（`--drawer-w`），白底，贴右、满高，`box-shadow:var(--sh-drawer)`，内容 `overflow:auto` |
| 遮罩 | 全屏 `--scrim`；背景列表仍可辨认；选中行保持 `--bg-row-selected` |
| 顶部栏 | 高 44px，flex：关闭、在新页面打开、上一张、下一张（均 30×30 图标按钮，圆角 6px，悬停 `--bg-hover`）→ 弹性占位 →「在新页面打开」文字 → 更多操作 |
| 正文内边距 | 12px 40px 40px |
| 标题区 | 编号（mono 12）→ H2 28/700（上 6px 下 20px） |
| 属性区 | grid `88px 1fr`，`row-gap:4px`；左列标签 text-2、内边距 6px 0；右列值内边距 6px 8px、圆角 6px、悬停 `--bg-row-hover` |
| 属性顺序 | 状态 → 负责人 → 报修人 → 位置 → 分类 → 已耗时（超时红字）→ 下次跟进 |
| 操作区 | `margin:20px 0 4px; gap:8px`；**标记已解决**（主按钮蓝）、转派、请求补充（次按钮：`--bg-neutral` 底，悬停 `#E8E8E5`）；按钮内边距 6px 12px、圆角 6px |
| 页签 | `margin:24px 0 16px; padding-bottom:6px`，发丝线；页签：动态 / 补充信息 N / 附件；选中同 5.4 页签 |
| 动态时间线 | 每条 flex，`gap:12px; padding-bottom:18px`；左 22px 头像；右 行高 1.6，姓名 600，时间 12/text-2（左边距 6px） |
| 引用块 | 描述/评论内容：`--bg-row-hover` 底、圆角 8px、内边距 10px 12px、上边距 6px |
| 评论输入 | 通栏，内边距 10px 12px、圆角 8px、`box-shadow:inset 0 0 0 1px var(--ring-2)`；`aria-label="添加评论"` |

规则：抽屉打开后 Esc 与点击遮罩 MUST 关闭；打开动画与焦点管理见第 7 章。

---

# 6. 状态与数据字段速查

工单字段（UI 展示顺序）：`编号 · 标题 · 位置 · 报修人 · 状态 · 分类 · 补充条数 · 负责人 · 耗时 · 下次跟进`。

看板列 ↔ 状态：

| 列 | 内含状态标签 |
|---|---|
| 待受理 | 待复核、待接单、重新报障 |
| 处理中 | 处理中、等待厂商、等待补充、需跟进 |
| 已关闭 | 已关闭（默认仅显示最近 24 小时，时间范围在统计行右侧说明） |

---

# 7. 交互状态、动效与焦点

| 状态 | 规则 |
|---|---|
| hover | 背景只在中性灰阶内变化（`--bg-hover` / `--bg-row-hover`）；卡片仅加深阴影 |
| active/当前 | 导航当前项 `--bg-active` + 600；页签选中 `--bg-hover` + 600；分段选中白底 |
| 焦点（**必须补充**） | `:focus-visible{outline:2px solid var(--primary);outline-offset:2px}` 全局生效，MUST NOT 去掉 outline |
| 禁用 | 透明度 .45，`cursor:not-allowed` |
| 动效 | 只做「响应用户操作」的动效：卡片阴影 150ms；抽屉打开 `translateX(24px→0) + opacity`，200ms ease-out；MUST NOT 做页面加载入场动画 |
| 减少动效 | 所有 transition/animation MUST 包在 `@media (prefers-reduced-motion:no-preference)` 内或在 `reduce` 下关闭 |
| 抽屉焦点 | 打开时焦点移入抽屉；Tab 在抽屉内循环；关闭后焦点回到触发行 |

---

# 8. 可访问性

- 使用语义元素：`<button>`、`<a href>`、`<input>`+`<label>`；MUST NOT 用 `div` 加 `onClick` 做交互。
- 纯图标按钮 MUST 有 `aria-label`（关闭、在新页面打开、上一张工单、下一张工单、更多操作）。
- 点击目标：桌面指针 ≥ 30px；触控设备 SHOULD ≥ 44px。
- 属性区建议使用 `<dl><dt><dd>` 语义（原型为 span 网格，见第 11 章）。
- 颜色不是唯一信息载体：超时、在线、状态均有文字对应。

---

# 9. 内容与文案规则

- 动作文案用动词且全流程同名：新建报修、标记已解决、转派、请求补充。
- 位置格式：`楼栋/科室 · 具体位置`；元信息格式：`位置 · 报修人`；用间隔点「·」连接。
- 时间使用相对时间（`19 分钟`、`1 小时 8 分`），详情时间线用「N 小时 N 分前」。
- 空状态与错误要说明原因与下一步，不道歉、不含糊。
- 副标题保持一句、不超过 20 字。
- 示例文案 MUST 标注「（示例文案）」，上线前替换。

---

# 10. Do / Don't

**Do**
- 用 Token；用灰阶与字重建立层级；只让状态与超时有颜色。
- 卡片无描边 + 轻阴影；列用淡色底区分状态。
- 看板用 grid 三等分，列表用 grid 定义列，其余用 flex。
- 给每个交互元素提供 hover 与 focus-visible 状态。

**Don't**
- MUST NOT 使用蓝色下划线链接样式于导航或页签。
- MUST NOT 给卡片加描边或左侧彩色竖条；MUST NOT 使用渐变背景、紫色渐变、emoji 图标。
- MUST NOT 把分类做成彩色标签。
- MUST NOT 引入第四种字重或 12/13/14 以外的正文字号。
- MUST NOT 在一屏出现第二个实心主按钮。
- MUST NOT 把超时只表现为底色变化。

---

# 11. 原型的已知偏差与修正（生成代码时按“修正值”执行）

| # | 问题 | 原型值 | 修正值 / 动作 |
|---|---|---|---|
| 1 | 搜索框快捷键提示对比度不足 | `#8A8985`，白底 3.50:1 | 改用 `--text-2`（5.48:1） |
| 2 | 导航红色角标对比度不足 | 白字 / `#E03E3E`，4.26:1 | 底色改 `--badge:#C9332D`（5.26:1） |
| 3 | 缺少键盘焦点样式 | 无 | 加 `:focus-visible` 蓝色 2px 轮廓 |
| 4 | 未领取虚线圈对比度偏低 | `#A8A7A3`，2.41:1 | `#8A8985`（3.5:1），文字「等待领取」保留 |
| 5 | 在线绿点对比度偏低 | `#4DAB9A`，2.57:1 | `#3E8E7E`（3.64:1）并加 title 文本 |
| 6 | 外部报修人头像与团队成员色冲突（郑医生用了 av4） | av4 | 外部报修人用中性头像（`--bg-neutral` / `--tag-gray-fg`） |
| 7 | 抽屉用 `position:absolute` 在画板内 | absolute | 生产环境用 `position:fixed`，加焦点陷阱与 Esc 关闭 |
| 8 | 超时阈值未定义 | 仅 WX-2387 示例 | 做成按状态/分类可配置的 SLA 参数 |
| 9 | 样式写死 hex | 裸 hex | 全部改为第 2.1 节 Token |
| 10 | 属性区用 span 网格 | span | 改 `<dl>/<dt>/<dd>` |
| 11 | 协作头像仅 `title` | title | 同时加 `aria-label` |
| 12 | 暗色模式 | 未设计 | 本规范范围外；如需，由 Token 层整体映射 |
| 13 | 「原型」标签、示例文案 | 存在 | 上线前移除 |

---

# 12. 验收清单

- [ ] 所有颜色、字号、间距、圆角、阴影来自 Token，无裸 hex。
- [ ] 字重仅 400 / 600 / 700；正文仅 14 / 13 / 12。
- [ ] 导航、页签无蓝色下划线；hover / 当前 / focus-visible 状态齐全。
- [ ] 整屏仅一个实心蓝色主按钮。
- [ ] 分类标签全部灰色，状态标签按第 5.7 映射。
- [ ] 超时项：红字耗时 + 文字冗余；统计行有「N 项需要跟进」。
- [ ] 卡片无描边，仅阴影；悬停不位移。
- [ ] 看板 grid 三列；≤ 900px 变单列；列表容器横向滚动，body 不横向滚动；1280px 下无溢出。
- [ ] 抽屉：Esc / 遮罩关闭、焦点移入与回归、选中行高亮、属性顺序正确。
- [ ] 文本对比度 ≥ 4.5:1，非文字 ≥ 3:1 或有文字冗余。
- [ ] 减少动效偏好被尊重。

---

# 附录 A：布局线框（1440 宽）

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ 医小修 ⌄   │ 信息服务团队 / 工作台                    ◯◯◯ 3 位同事在线 [原型]│  ← topbar 44
│ [搜索 ⌘K]  ├──────────────────────────────────────────────────────────────┤
│ 工作空间   │  [▦]  团队工作台  (36/700)                                    │
│ ▣ 工作台   │       让每一件报修，都有回应。                                │
│ ▢ 会话     │  [团队工作][与我有关][公共故障]   搜索 筛选 排序 [看板|列表] [+新建报修]
│ ▢ 公共故障 │  ───────────────────────────────────────────────────────────  │
│ ▢ 团队知识库│  (4 项需要跟进)  全部 13 项                 已关闭仅显示 …    │
│ ▢ 通知异常 ①│  ┌待受理 5──┐ ┌处理中 4──┐ ┌已关闭 4──┐                      │
│ 团队成员   │  │ card     │ │ card     │ │ card     │   grid 3×1fr gap16   │
│ ◯ 林舟 你  │  │ card     │ │ card     │ │ card     │                      │
│ ◯ 陈悦     │  │ card     │ │ card     │ │ card     │                      │
│ …          │  │ 还有 2 项│ │ 还有 1 项│ │ 还有 1 项│                      │
│ ⚙ 设置     │  └──────────┘ └──────────┘ └──────────┘                      │
└────────────┴──────────────────────────────────────────────────────────────┘
 240px                         main: flex 1, content max 1240

抽屉（右侧 600px，遮罩 + 阴影）
┌────────────────────────────────────┐
│ ✕ ↗ ⌃ ⌄            在新页面打开  ⋯ │  44
│ WX-2387                            │
│ PACS 调阅影像时加载缓慢  (28/700)   │
│ 状态   [等待厂商][处理中]           │
│ 负责人 ◯ 陈悦   …（88px | 1fr）     │
│ [标记已解决] [转派] [请求补充]      │
│ 动态 | 补充信息 2 | 附件            │
│ ◯ 时间线 … ◯ … ◯ …                 │
│ [ 添加评论，输入 @ 提及同事… ]      │
└────────────────────────────────────┘
```
