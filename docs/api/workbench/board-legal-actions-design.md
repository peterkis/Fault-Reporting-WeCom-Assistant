# T42 合法拖动：SOURCE 合同，尚未实施

本页为 Issue97／WBINT-15 A15 的未运行基线。`PROPOSED / NOT_MOUNTED / NOT_BUILT_NOT_RUN`；现有 [看板](board.md)、[Ticket](tickets.md)、[复核](manual-reviews.md) HTTP 路径的已实现状态不变。本票不增加业务 HTTP 命令、权限、Ticket 状态、数据库表、迁移或台账；所有原 Schema／SQL 保持原字节。

## 输入、输出和当前动作

本地 [intent Schema](../../../contracts/workbench_board_action_intent.schema.json) 只含 `kind,id,source_column,target_column`；[resolution Schema](../../../contracts/workbench_board_action_resolution.schema.json) 为打开原表单、同列无变化、不可用三种闭合结果。[独立类型](../../../contracts/workbench_board_action_intent_contracts.d.ts) 不接受 actor、身份、凭据、正文、版本、UUID、目标状态或任意额外字段。来源列只是手势开始时的显示信息，不是提交授权，也不是命令版本。

| 显示意图 | 重新读取当前对象后打开的原表单 | 仍由原表单明确捕获与提交 |
| --- | --- | --- |
| Ticket 待受理 → 处理中 | 本人合法一步处理；需要接管时沿当前获权接管表单 | 原 self-handling／takeover 命令；相关沟通必须明确选择或保留，不串联责任命令 |
| Review／Intake 待受理 → 处理中 | 当前规范事项的复核表单；无可读待复核项时提示不可用 | T15 的当前材料、明确合法结论／原因、原组和可选沟通；未作结论不得提交 |
| Ticket 处理中 → 已关闭 | T11 当前工作人员完工；如需合法接管完工只用 T12 原表单 | 独立内部过程与安全对外摘要、确认、版本和轮次；不自动复制正文 |
| Ticket 已关闭 → 待受理 | T20 已挂载的工作人员重开表单 | 当前 `reopen` 动作、`STAFF_REOPEN`、明确原因和版本；不用 Reporter feedback |
| 同列 | 无操作，不保存排序 | 无命令 |
| 其他落点／对象／当前无动作 | 明确不可用提示 | 无命令 |

这里只列路由意图，不能把 `ACCEPTED`、`RESOLVED`、`CANCELLED` 等显示归列推成任意状态转换。打开后使用原 `GET /api/workbench/items/{kind}/{id}`、Ticket／Review 当前 GET 和目标 GET；规范 alias、当前角色／READ／范围／材料／版本仍由原路径核验，提交事务锁后再次核验。没有当前获权动作就保留原位置并说明，不增隐式接管、确认、成员反馈或 grant。

## 原命令和交互边界

拖动、按钮及键盘只进入同一目标表单，不自动 POST。业务 UUID、purpose、完整不可变 body、UNKNOWN 核对及显式原 body 重放继续由原功能控制器持有；T42 不另建 receipt、草稿平台或第二套 Ticket Core。取消表单入口不调用丢弃正文；原输入、原目标、版本与未知命令须继续保留，原控制器未确认可以离开时不得卸载它。401 和真实对象／用途拒绝仍沿原当前授权清理，不以列表缺席推导失权。

卡片始终来自获权官方查询，不能通过拖动先改列。取消、冲突或未知后重新读取真实位置；UNKNOWN 可能已提交，不能将它当成未提交或强放回旧列。读取到 COMMITTED 及其后续当前事实时，显示官方现状；新版本、新 UUID 或重试都必须是明确的人类意图。SSE 只刷新获权事实，不能替换当前选中的对象、手势目标或原 body。

实施沿现有锁定的 `@dnd-kit/react`；仅显式手柄启动，按键与替代按钮走相同入口。正文选择、链接、菜单、输入及滚动不启动拖动；Esc 取消并恢复焦点，不清输入。保持原有分页／折叠和服务端排序，不增加持久列内顺序、全量预载或常驻计时器。减少动态不作移动动画，窄屏和长文以真实生产 bundle 验证，不靠原型截图证明。

## 默认关闭、资源与回退

拟议宿主 `workbenchBoardActionsEnabled:boolean=false` 与 [bootstrap 能力片段](../../../contracts/workbench_board_action_capability.schema.json) `board_actions_enabled` 尚未挂载；缺字段按 false，不能通过 URL、localStorage 或生产环境变量旁路开启。实际动作仍各自要求原 feature flag／Schema／当前权限；T42 开启不替代这些条件。关闭时保留原详情按钮和业务事实，不回滚已提交处理。无数据库变更，无新 SSE／Worker／连接池；沿单 App／Worker、Gateway 单活、SSE32、池预算≤8及通信并发1；禁止真实外部发送。

## 冻结首例和未来验证

已登记 `tests/wbint-t42-board-legal-action.browser.test.mts`：原 PG fixture／真实 Cookie HTTP／正式 `/workbench/app/assets/` bundle，显式指针手柄拖到处理中→无中间 POST／原位置仍在→原表单明确点击→唯一原 UUID／If-Match／完整命令→当前 HTTP 与看板查询一致。提出的 fixture 选项现被旧 helper 忽略，基线没有拖动入口；这是待 WHOLE 实跑的缺口，不是已观察 RED。首例不模拟业务成功，不关闭旧 guard，不跳过断言；标准 PNG 路径及自有浏览器清理沿原协议。

后续 WHOLE 先在记录的未实现 baseline 运行同字节原首得到真实 RED，才实施最小竖切并获取同例 GREEN。随后按原七补合法 Review／完工／重开、取消／UNKNOWN／409／真实失权和迟到对象、按钮／键盘／Esc、控件／选择／滚动／SSE、长文／窄屏／减少动态所需证据；这些目前均 NOT_RUN，不预写模拟通过或整票验收结论。
