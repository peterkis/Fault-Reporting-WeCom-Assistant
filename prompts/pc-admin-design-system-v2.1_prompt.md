# PC 管理端设计系统 v2.1 视觉升华 · 执行 Prompt

> 放在 `prompts/pc-admin-design-system-v2.1_prompt.md`。用法与 v2.0 相同：每个新会话先粘贴「一」到「五」作为固定上下文，再粘贴「六」中当前要做的那一张卡。一张卡一个 PR。卡 11 是后端卡，必须先于卡 12、13 合并。

---

## 一、角色与总则

你是一名资深产品设计工程师，同时具备一线 UI/交互设计能力与全栈工程能力。你的任务是在已合并的设计系统 v2.0（PR #127）基础上，把「医小修 PC 管理端」从「统一但平淡」提升到「有节奏、有温度、一眼知道下一步」的 v2.1。

工作对象：仓库 `peterkis/Fault-Reporting-WeCom-Assistant`。前端在 `app/pc-admin`（React 19 + HeroUI 3.2.6 + Tailwind 4，`src/design/` 下已有 tokens、24 个共享组件与 `status-map.ts`）；后端在 `app/server`（Node 24、TypeScript strict、ESM `.mts`）。

边界：

1. 先读 `AGENTS.md` 并按其「按任务读取」表读取相关文档；后端卡还必须读 `docs/agents/development.md` 与 `docs/api/workbench/board.md`。流程以 AGENTS.md 为准，视觉值以本 Prompt 和设计文档为准。
2. 前端卡（8、9、10、12–16）只改视觉与交互层，不改业务命令、状态值、权限判断和请求语义。看板「领取」复用现有 BoardActions 命令，只改变入口位置。
3. 后端卡（11）只新增**只读投影字段和只读接口**，不新增业务事实、不改写 Ticket 状态机、不改规则引擎与责任路由。
4. 测试依赖的 class 和 `data-*` 选择器只增不删。**文案改动已获授权**：涉及测试断言的文案可以同步修改测试里的期望文字，但不得放宽任何业务断言（状态、权限、请求、回执、次数）。
5. 不新增运行时依赖。新增图标全部来自已安装的 `lucide-react`。
6. 未经任务卡明确授权，不提交、不推送、不创建 PR；完成后停在「本地验证通过 + 交付说明」。

## 二、唯一事实源

| 文件 | 作用 |
| --- | --- |
| 设计方案文档「医小修 PC 管理端 · v2.0 验收与 v2.1 升华设计方案」（导出为 `docs/ui/design-system-v2.1.md`） | 色彩四层、分场景交互、已确认决定 |
| 原型画布「医小修 PC 管理端 v2.1 设计原型」（6 张画板：01 工作台、02 抽屉、03 会话、04/04b 通知异常、05 色彩系统） | 视觉参考；数值以文档为准，原型为示意 |
| `docs/ui/design-system.md` + `app/pc-admin/src/design/tokens.css` | v2.0 规范与 Token，本轮在其上扩展 |
| `config_examples/p2-007-service-catalog.example.json` + `app/server/src/p2-007-service-catalog.mts` | 服务目录与 11 个大类（domain_code）的唯一来源 |

规范没有覆盖的情况：先提出「规范补充建议」（拟定值 + 理由），确认后再实现。

## 三、已确认的产品决定（2026-11-01，不得自行更改）

| 事项 | 决定 |
| --- | --- |
| 等待热度阈值 | `< 5 分钟` 不显示；`5–20 分钟` 中性灰；`20 分钟–1 小时` warning 黄；`1–4 小时` attention 橙 + 卡片橙色描边；`≥ 4 小时` danger 红「超时 N 小时」+ 红色描边。全类别统一，集中定义为一个常量 |
| 计时起点 | 待受理：`created_at`；处理中：进入当前状态的时间（挂起等待从挂起时算）；已处理：不计 |
| 类别 | 必须显示；采用 ServiceCatalog 的 11 个 domain_code + 未分类；颜色跟大类，图标优先跟具体服务 |
| 看板直接领取 | 允许；仅对有领取权限的用户显示，鼠标悬停卡片显示「领取」，键盘 `E` |
| 文案 | 去掉权限/工程术语，测试期望同步修改 |

## 四、设计原则（v2.0 原则继续有效，新增 4 条）

1. **颜色面积与信息的重要程度成正比**：首屏彩色像素约 8–12%；每一处彩色必须能对应到「阶段 / 紧急 / 类别 / 人」四层之一。
2. **每个场景一张「下一步」**：抽屉、会话、通知异常打开后，第一眼就能看到当前状态和唯一的主操作。
3. **缺失数据统一收纳**：卡片上不出现「未提供 / 未登记」字样；缺 2 个及以上关键字段时只显示一个中性「资料不全」标签；抽屉里收拢成一行「未提供：…」。
4. **不用左侧色条卡片**：紧急用整卡 1px 色调描边 + 热度芯片表达。

色彩 Token（新增到 `tokens.css` 第 1/2 层，HeroUI 桥接不变）：

```css
/* 阶段 */
--stage-intake-accent:#D9A400; --stage-intake-bg:#FBF3DB; --stage-intake-fg:#7F5F01;
--stage-active-accent:#2F6FDB; --stage-active-bg:#E8F0FC; --stage-active-fg:#1D4FA3;
--stage-done-accent:#448361;   --stage-done-bg:#EDF3EC;   --stage-done-fg:#2F6B4A;
--bg-board:#F7F6F3; --bg-column:#F4F3EF;
/* 紧急描边 */
--ring-attention:#F2D2B4; --ring-danger:#F0C2BF; --ring-review:#DCCDEE;
/* 类别：bg / fg，对比度均 ≥ 4.9:1 */
--cat-clinical-bg:#EFE9F8; --cat-clinical-fg:#6940A5;   /* CLINICAL_CORE 核心临床与病历 · stethoscope */
--cat-access-bg:#FBF0D9;   --cat-access-fg:#8A6100;     /* PATIENT_ACCESS 挂号签到叫号 · ticket */
--cat-diag-bg:#E1F3EF;     --cat-diag-fg:#1F6B5C;       /* DIAGNOSTIC 检验与影像 · scan-line */
--cat-pharm-bg:#E8F3E8;    --cat-pharm-fg:#2F6B4A;      /* PHARMACY_MEDICATION 药品与审方 · pill */
--cat-billing-bg:#F6EDE3;  --cat-billing-fg:#7A5230;    /* BILLING_INSURANCE 收费与医保 · receipt */
--cat-online-bg:#E8EBFA;   --cat-online-fg:#3B4BA8;     /* INTERNET_HOSPITAL 互联网医院 · globe */
--cat-endpoint-bg:#ECEEF2; --cat-endpoint-fg:#46505E;   /* ENDPOINT_PRINT 终端显示打印 · monitor / printer */
--cat-network-bg:#E3F1F8;  --cat-network-fg:#1B6A8F;    /* NETWORK_INFRASTRUCTURE 网络与连接 · wifi */
--cat-identity-bg:#FBE8EE; --cat-identity-fg:#A3365C;   /* IDENTITY_SECURITY 身份签名安全 · key-round */
--cat-config-bg:#EFEDE8;   --cat-config-fg:#5C5548;     /* CONFIG_DATA 主数据与配置 · sliders-horizontal */
--cat-route-bg:#F1F1EF;    --cat-route-fg:#5F5E5B;      /* CROSS_DEPARTMENT_ROUTING 转办 · route */
/* 未分类：白底 + 1.5px 虚线 #C9C7C1 + circle-help #6B6965 */
```

domain_code → Token / 图标的映射只在 `src/design/category-map.ts` 中定义一次；未知 domain_code 回退为中性色 + `circle-help`。

## 五、交付格式（每张卡结束时）

1. 改动摘要（对应文档哪一节 / 原型哪张画板）
2. 文件清单
3. 1920 / 1440 / 1280 / 900 四个宽度的前后对照截图（合成数据），与原型画板并排
4. 度量：Stylelint、ESLint 违规数；首屏彩色面积估算（卡 10、12）
5. 验证：`npm run migration:build`、`node .build/tools/gate.mjs types`、`node .build/tools/verify-artifact.mjs`、相关 selection 的测试结果；失败如实列出
6. 规范偏差与理由
7. 下一张卡的前置条件是否满足

---

## 六、任务卡（一次只粘贴一张）

### 卡 8 · v2.0 收尾修补

- 顶栏「人工协作 / 只读」标签移到左下账号区，显示为姓名下方「信息科 · 人工协作」；顶栏右侧只保留连接状态和设置。
- 工作台显示与其它页面一致的面包屑，四页标题坐标完全一致。
- 列尾「还有 N 项」+「已加载 N 项」合并为一个 ghost 按钮「显示剩余 N 项」；「已加载」改为 tooltip。
- 通知异常：无数据时隐藏分页说明和「下一页异常」，「重新读取当前范围」改为标题右侧刷新图标；副标题改为「发送失败或结果待核对的通知。查看不会触发重发。」
- 全站文案去工程化：「当前授权范围内暂无事项」→「这里暂时没有工单」；「重新读取工单动作」移入「⋯」并改为「刷新可用操作」；「获权联系人」→「可见的联系人」。同步修改相关测试期望。
- 修正 `border-radius: var(--radius-sm) 0 0 var(--radius-sm)` 的写法错误。
- `--fs-avatar-sm` 补入规范文档。

### 卡 9 · Token v2.1

- 按第四章把阶段、类别、描边、`--bg-board`、`--bg-column`、`--tone-*-solid`（实心小徽标，白字对比 ≥ 4.5）加入 `tokens.css`。
- 新增 `src/design/heat.ts`：导出阈值常量 `[5, 20, 60, 240]`（分钟）和纯函数 `heatOf(startIso, nowMs) → {tone, label, ring} | null`，覆盖边界值单测（4:59、5:00、19:59、20:00、59:59、60:00、239:59、240:00）。
- 新增 `src/design/category-map.ts`（见第四章）。
- 更新 `docs/ui/design-system.md` 第四章。

### 卡 10 · 看板骨架：列头、分组、概况条

- BoardColumn：列头 = 顶部 3px 阶段色条 + 阶段浅色底 + 圆点 + 阶段名 14/600 + 白色半透明计数胶囊 + 右侧排序菜单（默认「等待最久」）；列体 `--bg-column`，圆角 12。
- 待受理列内分组：「待判断」（intake 受理）在上、「待接单」（Ticket）在下，组标题 12/500 + 计数，可折叠。卡片不再显示「待判断」「待接单」标签。
- 概况条（PageHeader 下方）：待受理 / 已超时 / 我负责 / 今日已处理 4 个可点击统计卡，图标块用对应 tone。点击即应用筛选，再点取消，选中态为品牌蓝描边。数字先基于已加载数据计算，并用 tooltip 标明「基于已加载的 N 项」。
- PageHeader 右侧「新报修」主按钮内显示快捷键提示 `N`。

### 卡 11 · 后端：看板卡片返回服务分类与状态起始时间（必须先完成）

目标：WorkbenchCard 增加两个**只读投影字段**，并新增一个**工作台只读目录接口**。

1. 字段设计（先改合同，再改实现）：
   - `service: { code: string, name_zh: string, category: string, category_name_zh: string, source: 'MANUAL_CONFIRMED' | 'REPORTER_EXPLICIT' | 'RULE_DETERMINISTIC' } | null`
   - `stage_entered_at: string | null`：进入当前看板状态的时间，按现有北京时间格式。挂起等待取挂起事件时间。来源为既有状态事件，不新增持久化事实。
2. `service` 的取值优先级：人工复核确认的服务 > 报修人显式选择的 `service_code`（ADR-0021 / YXX-UI-003 已有）> 规则引擎确定性事实 > `null`。先在 `app/server/src` 中定位这三类事实现有的存储与读取位置（从 `p2-015-manual-review.mts`、`p2-007-rule-engine.mts`、`p2-015-rule-first-orchestrator.mts`、`web01-workbench-query.mts` 开始），写出「事实来源表」交给我确认后再实现。存在冲突或未确认的建议时返回 `null`，不在前端猜。
   - 名称与大类必须经当前生效的 ServiceCatalog 解析；目录中已禁用或不存在的 code 返回 `null`。
3. 新增 `GET /api/workbench/service-catalog`：工作台内部身份可读，返回 `{schema_version:1, catalog_version, categories:[{category, category_name_zh, services:[{service_code, name_zh}]}]}`，供类别筛选与图例使用；不返回责任组、别名、规则或哈希；no-store；失败返回 503，前端回退为不显示筛选。
4. 合同与文档：更新 `contracts/web01_workbench_contracts.d.ts` 及对应 JSON Schema、`docs/api/workbench/board.md`；按 AGENTS.md 判断是 ADR-0021 的局部追加还是新 ADR，先写出来让我确认。
5. 测试：查询层单测（三种来源、优先级、冲突返回 null、禁用 code 返回 null、无事实 null）；`stage_entered_at` 在领取、开始、挂起、恢复后的取值；HTTP 授权（匿名 / 越权 / 正常）；旧客户端兼容（字段新增不破坏现有解析）。
6. 不做：数据库迁移（除非事实来源表证明必须，届时先停下汇报）、写命令、规则或路由改动。

### 卡 12 · 工单卡片 v2.1

（依赖卡 11）结构见原型 01：

```text
[类别瓷砖 28] 编号 12 mono                       [热度芯片]
              标题 14/600，最多 2 行
              位置 · 科室 · 报修人 · 渠道（只显示有值的）
              [彩色 Tag ≤ 2]                  处理人头像 姓名 · 时间
```

- 类别瓷砖：`category-map` 取色与图标，`title` 显示「大类 · 服务名」；`service` 为 null 时用未分类样式。
- 热度：`heatOf(stage_entered_at ?? created_at)`；1 小时以上整卡加对应描边；`≥ 4 小时` 文案「超时 N 小时」。已处理列不显示热度，改为绿色「✓ HH:mm 完成」。
- 缺失字段收纳：元信息行只显示有值字段；缺 ≥ 2 个关键字段时加中性「资料不全」Tag。
- 未派单：只显示虚线头像 + 时间；悬停整卡时该位置变成 secondary sm「领取 E」按钮；没有领取权限的用户不显示按钮。领取成功后卡片以 180ms 动画移入处理中列。
- 卡片悬停：`translateY(-1px)` + `--shadow-2`；当前打开的卡：2px 品牌蓝描边 + `#F5F9FF` 底。
- 工具栏新增「类别」筛选（数据来自卡 11 的目录接口），与「处理人」「已处理日期」并列，统一为行内前缀样式。

### 卡 13 · 工单详情抽屉

（类别显示依赖卡 11）结构见原型 02。

- 抽屉浮动：距视口 8px、圆角 14、宽 720；顶栏全部 ghost 图标按钮，顺序「复制编号 | ↑ 2/4 ↓ | 全屏 ☆ ⋯ ×」。
- 英雄区：40px 类别瓷砖 + 标题 20/600；下一行阶段胶囊 + 子状态 Tag + 热度 Tag + 「报修于 MM-DD HH:mm · 渠道」。
- **下一步卡**（核心）：按「状态 × 当前用户权限」生成一句话 + 1 个 primary + 至多 2 个 secondary，其余进「⋯」。映射表见设计文档 4.2（待接单 → 领取并开始；已领取 → 开始处理；处理中 → 登记完工；等待中 → 恢复处理 / 设置跟进；待确认 → 重新打开；待复核 → 开始复核）。按钮只读 `allowed_actions`，不新增命令；全部无权限时只显示一句话 +「你当前为只读」。原「处理与协作」折叠内的表单改为点按钮后在下一步卡下方就地展开。
- 属性区两列不变；缺失字段收拢为一行「未提供：报修人姓名、联系电话」+ ghost「向报修人补问」（若已有补问能力则接入，否则只显示文字）。
- 内容区页签「动态 / 附件 N / 会话 N」；报修描述作为动态第一条（灰色气泡）；内部备注为浅黄气泡 + 锁图标 +「内部」；删除「当前范围的记录已加载完毕」。
- 底部吸附备注输入：当前用户头像 + 浅黄底输入框（框内左上「内部备注 · 仅信息科可见」）+ 右侧「保存 Ctrl ↵」。

### 卡 14 · 会话

结构见原型 03。

- 列表项固定 3 行：姓名 14/600 + 科室 + 右侧时间（等待 ≥ 1 小时变红）；最新消息预览单行；状态圆点 +「N 个主题 · N 个群」聚合计数 + 右侧蓝色未读徽标。不再逐个列出群名。
- 会话头部压缩到 60px：头像、姓名、科室·渠道、状态 Tag；右侧主题切换下拉 +「⋯」。原始来源 / 当前来源移到右栏。
- 消息区占满剩余高度：报修人左侧灰气泡、工程师右侧品牌浅蓝气泡、内部备注右侧浅黄气泡、系统事件居中灰色胶囊；按日分隔；渠道只在分隔线上标一次。
- 未接待时，输入框上方显示浅黄接待横幅：「X 已等待 N 分钟，尚无人接待 · 接待后即可回复」+ ghost「请求人工接管」+ primary「我来接待」；输入区禁用。接待后横幅消失。
- 输入区：框内分段「回复报修人 / 内部备注」，切到内部备注时整个输入框变浅黄；发送按钮在右下，`Ctrl+Enter` 发送；原说明文字改为占位符。
- 右栏：关联事项用迷你 TicketCard（同一组件），点击在当前页打开抽屉；下方「报修人」「来源」分节。
- 1080p 下消息区高度 ≥ 视口 50%（加浏览器断言）。

### 卡 15 · 通知异常

结构见原型 04 / 04b。

- 有数据：顶部 danger InlineAlert「N 条通知发送失败，对应报修人可能还不知道处理进展」+「逐条核对」；表格列：结果 Tag · 工单（编号链接 + 标题）· 通知类型 · 接收人 · 渠道 · 时间（含尝试次数）· 操作「核对」。
- 空状态：64px 绿色圆形勾 +「通知都已送达」+ 说明 + 刷新按钮。
- 侧栏「通知异常」右侧红色实心计数徽标，0 时隐藏；没有轻量计数接口时本卡不显示数字，并在交付说明中列为后续项。

### 卡 16 · 效率层

（依赖卡 12）

- 看板键盘：`J/K` 卡片上下、`H/L` 切列、`Enter` 打开、`E` 领取、`N` 新报修、`/` 聚焦搜索、`?` 快捷键面板。只在焦点不在输入框时生效；不注册全局 keydown 到 window 之外的作用域，组件卸载时移除。
- `Ctrl+K` 命令面板：替换侧栏「搜索工作区」入口；可搜工单号、报修人、科室，并执行「新报修」「切到列表」「打开通知异常」。
- 状态变化时卡片跨列 FLIP 动画 180ms；实时新卡从列顶滑入并淡黄高亮 2 秒；用户正在滚动时改为列头「↑ 1 条新报修」提示，不打断阅读位置。
- 全部动效尊重 `prefers-reduced-motion`。

---

## 七、自检清单（每张卡逐条回答「是 / 否 + 证据」）

- [ ] 前端卡没有改业务命令、状态值、权限判断；后端卡只增加只读投影
- [ ] 测试选择器只增不删；改过的测试只改了文案期望，没有放宽业务断言
- [ ] 新增颜色全部经 Token，Stylelint / ESLint 为 0
- [ ] 每一处彩色都能对应到「阶段 / 紧急 / 类别 / 人」之一
- [ ] 卡片上没有「未提供 / 未登记」字样
- [ ] 有权限时每个区域恰好 1 个 primary
- [ ] 热度阈值使用 `heat.ts` 常量，没有在组件里写死数字
- [ ] 与原型画板并排截图核对过 4 个宽度

---

## 八、多会话并行执行规则（多个会话同时执行时，每个会话都要粘贴本章）

### 8.1 批次与依赖

| 批次 | 可并行的卡 | 开始条件 |
| --- | --- | --- |
| 第 1 批 | 卡 8、卡 9、卡 11 | 立即 |
| 第 2 批 | 卡 10、卡 14、卡 15 | 卡 8、卡 9 已合并（卡 11 可以仍在进行） |
| 第 3 批 | 卡 12、卡 13 | 卡 10、卡 11 已合并 |
| 第 4 批 | 卡 16 | 卡 12 已合并 |

### 8.2 文件归属（避免多个 PR 改同一处）

| 文件 / 目录 | 只能由哪张卡修改 | 其它卡的做法 |
| --- | --- | --- |
| `src/design/tokens.css`、`heat.ts`、`category-map.ts`、`docs/ui/design-system.md` | 卡 9 | 需要新 Token 时在 PR 说明中列出，由后续单独小 PR 补 |
| `app/server/**`、`contracts/**`、`docs/api/**` | 卡 11 | 前端卡只读这些合同 |
| `src/app/Workbench.tsx` | 卡 8、10、12、13 依次修改 | 卡 13 先把抽屉的 JSX 抽到独立文件，再在新文件里改，`Workbench.tsx` 只留一行引用 |
| `src/design/shell.css`、侧栏 | 卡 8（账号区）→ 卡 15（侧栏徽标） | 按批次先后修改 |
| `CHANGELOG.md`、根级索引文件 | 都不改 | 在 PR 描述中写变更条目，合并后统一补 |

每张卡的执行记录写到 `plans/pc-admin-design-v21/card-<编号>.md`，不要写到共用文件里。

### 8.3 开工前检查（每张卡开始时执行）

1. `git fetch origin` 后，基于最新的 `origin/main` 新建分支 `codex/pc-admin-v21-card<编号>`，在独立的 worktree 中工作。
2. 确认前置卡已经合并：
   - 卡 9：`app/pc-admin/src/design/heat.ts` 与 `category-map.ts` 存在
   - 卡 11：`contracts/web01_workbench_contracts.d.ts` 的 WorkbenchCard 含 `service` 与 `stage_entered_at`
   - 卡 8 / 10 / 12：`git log origin/main --oneline` 中可以找到对应 PR 的合并提交
   - 任一条件不满足：停下汇报，不要自己补做前置卡的内容。
3. 在 PR 描述第一行写：`基线：origin/main@<完整 SHA>；前置：卡 X #PR号 已合并`。

### 8.4 其它 PR 合并后如何同步（收到「同步 main」指令时执行）

1. 先保存当前未提交的改动（提交到本分支或 stash），然后执行 `git fetch origin`，再 `git rebase origin/main`。
2. 解决冲突：
   - 冲突在本卡归属的文件里：以本卡的改动为主，同时保留 main 上新增的内容。
   - 冲突在其它卡归属的文件里：以 `origin/main` 为准；本卡确实需要改动的，写进 PR 说明，不要直接改。
   - Token 或组件已被前置卡改名、移动：改用新名称，不要恢复旧名称。
3. 重新运行：`npm run lint:css`、`npm run lint:features`、`npm run migration:build`、`node .build/tools/gate.mjs types`、`node .build/tools/verify-artifact.mjs`，以及本卡相关的测试。
4. 用 `git push --force-with-lease` 更新本分支，并在 PR 中留言：新基线 SHA、冲突文件列表及每个文件的处理方式、重新验证的结果。
5. 重新截图只需覆盖受影响的页面。

### 8.5 资源隔离

- 每个会话使用自己的 worktree 和自己的 `.build` 输出目录，不共享未提交的改动。
- 浏览器和集成测试使用现有 fixture 创建新的合成数据库，不复用其它会话的数据库，也不清理其它会话的资源。
- Electron 原生集成测试同一时间只允许一个会话运行；其它会话需要时，在交付说明中标为 NOT_RUN 并说明原因。
