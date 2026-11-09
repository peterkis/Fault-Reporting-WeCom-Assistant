# PC 管理端 v2.1.6 会话计数与等待时长 · 执行 Prompt（卡 25A 后端、卡 25B 前端）

> 放在 `prompts/pc-admin-v2.1.6_card25_prompt.md`。两张卡，**各开一个会话、各一个 PR**：
>
> - **卡 25A（后端只读投影）**：只改 `app/server`、`contracts`、`adr`、后端测试。和卡 24 没有文件交集，**现在就可以和卡 24 并行**。
> - **卡 25B（前端展示）**：会改到卡 24 也在改的会话页和侧栏。**必须等卡 24 和卡 25A 都合并后再开始**，开始前按 v2.1 Prompt 第八章 8.4 同步最新 `origin/main`。
>
> 每个会话先粘贴「一」到「四」，再粘贴「五」或「六」中当前要做的那一张卡，最后粘贴「七」。

---

## 一、背景与已确认的口径

卡 23 的 V1、V9、V13 被记为契约缺口：会话收件箱接口每页只有 `items` / `next_cursor`，每个联系人有自己的 `unread_count`，但没有：

1. 「待接待报修人」的**全局人数**（原型 03 标题旁「N 位报修人等待回复」）；
2. 本人的**全局未读数**（原型侧栏「会话」上的数字）；
3. 每个待接待会话的**开始等待时间**（原型联系人列表「12 分钟 / 3 小时」，以及等待横幅「宋岚已等待 12 分钟」）。

用户已确认以下三条口径，两张卡都必须严格遵守：

| 口径 | 结论 |
| --- | --- |
| 等待从什么时候算 | 从会话**变成无人接待的那一刻**开始算（首次进入时即为会话开始时刻；被释放 / 转回待接待时为释放时刻）。不是「报修人最后一条消息之后无人回复」。 |
| 统计范围 | 只统计**当前账号可见范围**内的数据，与现有收件箱列表的权限判断完全一致；**不随页面上的筛选、搜索、队列切换变化**。 |
| 刷新方式 | 沿用现有实时推送：凡是现在会让收件箱刷新的事件，也让这些数字刷新；等待时长在前端每分钟重算一次。 |

## 二、共同边界

1. 先读 `AGENTS.md`，按其「按任务读取」表读取相关文档；流程和验证遵循 ADR-0053 的测试策略。
2. **只读投影**：不新增或修改任何业务命令、状态值、权限规则、通知或投递行为。
3. 新增字段一律为只读、可为空（`null`），旧客户端忽略新字段也能正常工作。
4. 不暴露任何新的个人信息：计数只返回数字；等待时间只附在当前账号本来就能看到的联系人 / 会话上。
5. 合成数据只能通过现有 fixture / helper 的既有写入方式添加，虚构内容带「（合成）」。
6. 测试选择器和业务断言只增不减。
7. 不新增依赖。
8. 未经明确授权，不提交、不推送、不创建 PR；完成后停在「本地验证通过 + 交付说明」。

## 三、事实来源

| 来源 | 作用 |
| --- | --- |
| `app/server/src/workbench-conversation-inbox.mts` | 收件箱查询、权限判断、`assignment_status` 来源（`conversation.assignment` 左连接，缺省为 `UNASSIGNED`） |
| `contracts/workbench_conversation_inbox_contracts.d.ts`、`workbench_conversation_inbox_page.schema.json`、`workbench_conversation_detail.schema.json`、`conversation_center.openapi.yaml` | 现有契约 |
| `contracts/conversation_assignment.schema.json` | `assigned_at`、`released_at`、`updated_at` |
| `adr/0052_workbench_service_and_stage_read_projections.md` | 同类「只读投影」ADR 的写法参照 |
| `app/pc-admin/src/realtime/useRealtime.ts` | 现有实时刷新族（`conversation-inbox`、`conversation-chat` 等） |
| 原型画布 v2.1.4：03 会话、03b 会话状态规则 | 前端展示依据 |

## 四、交付格式（两张卡通用）

1. 编号清单：每个编号一行，写「已完成 / 已确认无需修改（理由）/ 停止待确认（理由）」。
2. 文件清单。
3. 测试与校验结果：相关单测、集成测试、契约校验、`migration:build`、`gate.mjs types`、`verify-artifact.mjs`；失败如实列出。
4. 25A 另附：查询计划（`EXPLAIN ANALYZE`，合成库）与耗时；25B 另附：截图。

---

## 五、卡 25A · 后端只读投影

- 分支：`codex/pc-admin-v216-card25a`；执行记录：`plans/pc-admin-design-v21/card-25a.md`。
- 可修改：`app/server/src/workbench-conversation-inbox.mts` 及其测试、`contracts/` 中上面列出的会话收件箱相关文件、新建 `adr/0054_conversation_inbox_counts_and_waiting_since.md`、后端测试 fixture。
- 不可修改：`app/pc-admin`、任何业务命令的写入路径、权限规则、数据库迁移（例外见 A1 第 4 点）。

### A1 等待起点 `waiting_since`（先确认数据）

1. **先确认数据**：阅读 `conversation.assignment` 的表结构和所有写入它的命令（领取、转交、释放、强制转交、接管、结束），回答并写进执行记录：
   - 会话首次进入时是否一定有 assignment 行？没有时，会话开始时间取哪个字段（`started_at` / `created_at`）？
   - 释放回待接待时，`released_at` 是否一定写入？再次领取后再次释放时，`released_at` 是否会被覆盖为最新一次？
   - 是否有 assignment 历史表或事件表可以得到「最近一次变成 UNASSIGNED 的时刻」？
2. **定义**（服务端计算，北京时间 `YYYY-MM-DD HH:mm:ss`，与现有时间字段同格式）：
   - 会话非 `ENDED` 且 `assignment_status = 'UNASSIGNED'`：`waiting_since` = 最近一次变成无人接待的时刻。
     - 从未被领取：会话开始时刻。
     - 曾被领取后释放：最近一次释放时刻。
   - 其它情况：`null`。
3. **放在哪里**：
   - 会话详情（chat entry）：增加 `waiting_since: LocalDateTime | null`。
   - 收件箱联系人条目（`ConversationInboxEntry`）：增加 `waiting_since: LocalDateTime | null`，取该联系人**在当前可见范围内**所有待接待会话中**最早**的 `waiting_since`（即等得最久的那一个）；没有待接待会话为 `null`。注意它和列表筛选无关：即使当前列表按某个来源筛选，联系人条目上的值也按可见范围计算（与「统计范围」口径一致）。如果这样做会和现有条目的其它字段（例如 `matching_topic_count` 按筛选计算）产生理解歧义，在 ADR 中写明。
4. **无法可靠推导时停止**：如果第 1 步发现现有数据无法可靠得到「最近一次变成无人接待的时刻」（例如 `released_at` 不写入、会被其它操作覆盖、无历史可查），**不要自行新增迁移或修改命令写入**。写好 ADR 草稿，列出可选方案（例如新增列并在相关命令的同一事务里维护、或新增历史表），在执行记录中标为「停止待确认」，A1 之外的编号继续完成。
5. **验收**：单测覆盖：从未领取、领取中（`null`）、领取后释放、释放后再领取（`null`）、释放两次（取最近一次）、已结束（`null`）、联系人下多个待接待会话（取最早）。

### A2 全局计数接口

1. 新增只读接口（路径前缀与现有工作台会话接口一致，先确认现有路由写法；建议 `GET /api/workbench/conversations/summary`），响应：

   ```ts
   interface ConversationInboxSummary {
     unassigned_contact_count: number; // 可见范围内，至少有一个非 ENDED 且 UNASSIGNED 会话的报修人（联系人）数
     my_unread_count: number;          // 可见范围内，本人在所有联系人上的 unread_count 之和
     as_of: LocalDateTime;             // 计算时刻
   }
   ```

2. **口径**：
   - 权限判断、可见范围与收件箱列表**复用同一套**谓词和授权代码，不得另写一份。
   - 不接受 `q`、`source`、`state`、`source_group_ref` 等筛选参数；带未知参数时按现有接口惯例拒绝（`x-reject-unknown-query`）。
   - `unassigned_contact_count` 必须等于：用 `state=unassigned`、不带任何其它筛选翻完收件箱所有页得到的联系人数。
   - `my_unread_count` 必须等于：用 `state=open`（或能覆盖全部未结束会话的现有状态，先确认）、不带其它筛选翻完所有页后各联系人 `unread_count` 之和。如果已结束会话也会产生未读，在 ADR 中写明是否计入，并与侧栏语义一致（建议：只计未结束会话）。
3. **实现**：单条聚合 SQL，不得逐联系人查询（无 N+1）。在合成库上给出 `EXPLAIN ANALYZE` 和耗时；如果需要索引，只在 ADR 中提出，不在本卡加迁移。
4. 与现有收件箱接口相同的开关和守卫（`enabled`、`guard()`、`conversation_workspace_enabled` 等），关闭时返回与现有接口一致的错误。
5. **验收**：集成测试用合成数据构造至少：两名不同可见范围的账号、多个联系人（含同一联系人多个会话）、已领取 / 待接待 / 已结束、有未读 / 无未读，断言两个计数分别等于上面两条「必须等于」的翻页结果；断言另一账号看不到的会话不计入。

### A3 实时刷新

1. 确认哪些事件现在会触发收件箱刷新（服务端推送的事件族，前端 `useRealtime.ts` 中的 `conversation-inbox`、`conversation-chat` 等）。
2. 领取、释放、转交、接管、结束、新消息、已读位置变化这几类事件，都必须能触发收件箱刷新。如果其中某类目前不推送，在执行记录中列出，**本卡只补推送事件，不改命令本身的业务逻辑**；如果补推送需要改命令代码，停止并标为「停止待确认」。
3. 不新增事件族名，除非现有族无法覆盖；新增时在 ADR 中说明。

### A4 通知异常侧栏计数（只核对）

原型侧栏「通知异常」有红色数字，当前界面没有。

1. 确认是否已有接口能直接返回当前账号可见范围内「发送失败 + 结果待核对」的总数（不是当前页条数）。
2. 有：在执行记录中写明接口和字段，供 25B 使用。
3. 没有：**本卡不实现**，在执行记录中记为契约缺口，并写出若要实现需要的口径问题，留给后续单独处理。

### A5 契约与 ADR

1. 更新 `workbench_conversation_inbox_contracts.d.ts`、对应 JSON Schema、`conversation_center.openapi.yaml`（新增 summary 接口和两处 `waiting_since`）。Schema 中新字段允许 `null`，时间格式与现有 `LocalDateTime` 一致（`x-business-timezone: Asia/Shanghai`）。
2. 新建 `adr/0054_conversation_inbox_counts_and_waiting_since.md`，参照 ADR-0052 的结构，至少包含：背景（卡 23 的 V1 / V9 / V13）、三条口径原文、`waiting_since` 定义与数据来源、两个计数的定义和「必须等于」关系、权限复用、性能、实时刷新、A4 结论、未解决的问题。
3. 前端 `app/pc-admin` 不在本卡修改；契约生成的类型如果被前端自动引用导致类型检查失败，在执行记录中说明，由 25B 处理。

### 卡 25A 验收清单

- [ ] A1 第 1 步的三个问题都有书面结论；`waiting_since` 单测七种情况通过（或 A1 标为「停止待确认」且 ADR 草稿列出方案）
- [ ] A2 两个计数与翻页结果相等的集成测试通过；越权会话不计入
- [ ] A2 聚合查询无 N+1，附 `EXPLAIN ANALYZE`
- [ ] A3 事件清单与补齐情况已写明
- [ ] A4 已核对并写明结论
- [ ] 契约、OpenAPI、ADR-0054 已更新；契约校验通过

---

## 六、卡 25B · 前端展示（等卡 24、卡 25A 合并后开始）

- 开始前：同步最新 `origin/main`，确认卡 24 和卡 25A 都已合并；读取 ADR-0054 与卡 25A 执行记录（特别是 A1 是否「停止待确认」、A4 结论）。
- 分支：`codex/pc-admin-v216-card25b`；执行记录：`plans/pc-admin-design-v21/card-25b.md`；截图：`docs/ui/evidence/v216-card25b/`。
- 可修改：`features/conversations/client.ts`、`inbox-client.ts`（只限解析新字段和新接口）、`ConversationInbox.tsx`、`Conversations.tsx`、会话相关样式、侧栏组件（只限计数徽标）、`src/design/format-time.ts`、相关测试和 fixture。
- 不可修改：后端、契约、权限判断、业务命令。

如果 25A 的 A1 为「停止待确认」：跳过 B3、B4，只做 B1、B2、B5（以及 A4 提供了接口时的 B6），在执行记录中说明。

### B1 标题旁待接待人数

- 读取 summary 接口。`unassigned_contact_count > 0` 时，在「会话」标题右侧显示「{n} 位报修人等待回复」：`--fs-sm`、`--text-secondary`，与标题基线对齐，间距 `--space-3`（与原型 03 一致）。`0` 时不显示。
- 接口失败时不显示，不阻塞页面，不弹错误提示（数字是辅助信息）。
- 验收：合成数据下数字等于 25A 的集成测试口径；切换队列、来源、搜索后数字**不变**（断言）。

### B2 侧栏会话未读徽标

- `my_unread_count > 0` 时，侧栏「会话」右侧显示实心徽标：背景 `--tone-brand-solid`、文字 `--text-inverse`、高 18、最小宽 18、圆角 `--radius-full`、`--fs-xs` / 600、`tabular-nums`；超过 99 显示「99+」；`0` 时不显示。
- `aria-label="{n} 条未读"`；侧栏折叠时显示为图标右上角的 8px 圆点（保留 `aria-label`）。
- 验收：数字等于 25A 口径；在会话页读完一个联系人的消息后，徽标随实时刷新减少（断言）。

### B3 联系人列表等待时长

- 联系人 `waiting_since` 非空时，列表时间位置显示等待时长，替代 `formatListTime`：
  - 时长文本与阈值复用 `heatOf`（5 / 20 / 60 / 240 分钟，≥24 小时显示天数）；
  - 颜色：未到关注阈值 `--text-secondary`；关注 `--tone-attention-fg` / 600；超时 `--tone-danger-fg` / 600（与原型 03、03b 一致）；
  - `title`：「已等待 {时长} · 最近活动 YYYY-MM-DD HH:mm（北京时间）」。
- `waiting_since` 为空时保持卡 23 的 `formatListTime`。
- 验收：合成数据中等待 12 分钟、2 小时、5 小时三个联系人分别显示正确文本和颜色；已领取联系人显示普通时间。

### B4 等待横幅时长

- 会话详情 `waiting_since` 非空时，横幅主文案为「**{姓名}已等待 {时长}，尚无人接待**」+「 · 接待后即可回复」；时长超过超时阈值时，时长部分 `--tone-danger-fg`。为空时保持卡 24 的「{姓名}尚无人接待」。
- 姓名去掉「（资料未提供）」后缀；横幅保持单行省略（卡 24 C3）。
- 验收：断言横幅文本；等待超过 4 小时时，时长元素颜色为 `--tone-danger-fg`。

### B5 刷新

- summary 查询加入现有实时刷新：凡是使 `conversation-inbox` 失效的事件，同时使 summary 失效（复用同一处失效逻辑，不新开 WebSocket 或轮询）。
- 等待时长每 60 秒在前端重算一次（复用工作台热度已有的计时器，如果有）；不因此重新请求接口。
- 页面不可见（`document.hidden`）时暂停计时，回到可见时立即重算。
- 验收：模拟一次领取事件后，B1 数字减 1、该联系人的等待时长消失（断言）；用假时钟推进 60 秒，等待时长文本更新（断言）。

### B6 通知异常侧栏计数（仅当 25A 的 A4 给出了可用接口）

- 侧栏「通知异常」显示实心徽标：背景 `--tone-danger-solid`，其余规格同 B2，`aria-label="{n} 条通知异常"`。
- A4 为契约缺口时跳过，在执行记录中说明。

### 规范文档

`docs/ui/design-system.md` 会话章节：标题计数、侧栏徽标、等待时长三处的口径（引用 ADR-0054）和样式；说明「计数不随筛选变化」。

### 卡 25B 验收清单

- [ ] 开始前已确认卡 24、卡 25A 合并，并已同步 main
- [ ] B1–B5 逐条有结论和断言（A1 停止时 B3、B4 标为跳过）
- [ ] B6 按 A4 结论处理
- [ ] 截图：会话 1440 / 1920（含标题计数、侧栏徽标、列表三种等待颜色、等待横幅时长）、侧栏折叠态、实时刷新前后对照
- [ ] 规范文档已更新

---

## 七、自检清单（两张卡都要逐条回答「是 / 否 + 证据」）

- [ ] 只改了本卡允许的文件；25A 没有改前端，25B 没有改后端和契约
- [ ] 没有新增或修改业务命令、状态值、权限规则；没有新增依赖
- [ ] 25A 没有自行新增迁移；需要迁移时已停止并写明方案
- [ ] 计数只统计可见范围，且不随筛选变化（有断言）
- [ ] 等待时长从「变成无人接待的那一刻」开始计算（有断言）
- [ ] 刷新沿用现有实时推送，没有新增轮询
- [ ] 测试选择器与业务断言只增不减
