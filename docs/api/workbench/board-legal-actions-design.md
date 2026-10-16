# T42 看板合法动作与本地表单路由

本页对应 Issue97／WBINT-15 A15。本地隔离实现和定向验证已完成，父原七验收、独立合并及 GitHub 关闭另行执行。功能被测提交 `86190fc4d8fd96a6300d3f4b7c6c19e0638fa662`，MF `4a4d4826870894067e156d313043cc6bd52d72482d54cfb0a65f6c8e9bee9aa3`；文档普通后继不重绑该对象。运行范围和历史失败见 [本票执行记录](../../../plans/admin-workbench-integration/execution/t42.md)。所有持久开关仍默认 false，无真实外部发送或部署。

## 输入、输出与现有业务入口

[intent Schema](../../../contracts/workbench_board_action_intent.schema.json) 只含 `kind,id,source_column,target_column`；[resolution Schema](../../../contracts/workbench_board_action_resolution.schema.json) 只产生打开原表单、同列无变化或不可用三类闭合结果。[类型](../../../contracts/workbench_board_action_intent_contracts.d.ts) 不接收 actor、凭据、正文、版本、UUID 或任意目标状态。来源列仅是手势开始时的显示信息，不能授权或代替命令版本。四份原合同和原首例保持冻结字节。

| 本地显示意图 | 当前获权查询后打开的既有表单 | 明确提交的原用途 |
| --- | --- | --- |
| Ticket 待受理→处理中 | 原合法一步处理／必要的获权接管 | 原 self-handling／takeover；相关沟通明确选择或保留，禁止串联责任写入 |
| Review／Intake 待受理→处理中 | 当前规范事项的原复核表单 | T15 当前材料捕获、明确结论／原因、组与真实沟通选择；无结论不得提交 |
| Ticket 处理中→已关闭 | T11／T12 原工作人员完工表单 | 原版本／轮次、内部处理记录、独立安全对外摘要与明确确认 |
| Ticket 已关闭→待受理 | T20 当前获权工作人员重开 | 原 `STAFF_REOPEN` 和明确原因；不借 Reporter feedback |
| 同列或非法落点 | 同列不写；其他明确提示不可用 | 不保存列内手工排序，不增加状态 PATCH |

正式页面 `/workbench/app/` 继续读取原 `GET /api/workbench/items/{kind}/{id}`、Ticket／Review 与所选目标 GET；提交仍通过本索引已有处理、复核、完工和重开 HTTP。当前身份、READ／范围、角色、材料、版本、责任和锁等待后的权限由各原业务服务核验。T42 无新业务 URL、数据库表／迁移、台账或第二 Ticket Core；46 份原 SQL 未改。

## 位置、原命令与当前授权

拖动、按钮与键盘只打开同一合法表单，确认前零 POST。原控制器继续持有 purpose、原 UUID、完整 body、版本、UNKNOWN／冲突和原 24h scoped recovery；T42 不另建命令或草稿事实源。明确确认后仅调用原合法命令，正式列位置来自当前获权官方查询。取消、UNKNOWN 或409后读取真实位置并保留完整原意图，不能乐观搬列、生成新 UUID、猜测成功或 autoPOST。原 T04 无专用只读 ACK 时，显式核对仍是原 UUID／原 body 的 POST 重放，不把它称 GET。

意图提示只使用与当前 route item、当前 READ 代次相符的官方 detail.column：已到目标时显示“官方已显示”，不再声称尚未提交。列匹配不能证明本 UUID 已提交，不能清除 UNKNOWN、冲突、输入或原控制器。两处完整页 Link 保留 route state；原控制器未确认可离开时不得卸载。可信401清会话，原对象／用途403或404沿既有 item 清理和当前看板重读；列表缺席不成为授权结论。SSE只刷新当前获权事实，不重定向当前操作对象或替换原 body。

## 手势与资源边界

锁定 `@dnd-kit/react` 0.5：仅显式手柄启动；替代按钮和完整 native Enter 走同一入口。正文选择、链接、菜单、输入、滚动不误拖；非折叠的当前链接内选区阻止该次指针跳转，普通点击及键盘 click 不被拦截。Esc取消、恢复焦点并保留原输入。600／900／1920宽度、长文、减少动态、滚动、键盘、菜单及SSE目标保留已有真实生产 bundle 证据，不能外推未执行的触屏／辅助技术设备矩阵。

反馈使用 clone、dropAnimation=null：副本留原槽，原 DOM 在手势中可暂随指针移动；这不是业务列或事实移动。初始化不再挂阻塞库 rendering 的冗余 beforeDragStart 回调；原 disabled／blocked、当前 READ、intent与原命令前提保持。没有新 timer、SSE、Worker、发送器或连接池；沿单 App／Worker、Gateway单活、SSE32、池≤8、通信并发1，业务验证 native concurrency=1、flags=[]、每文件请求预算240000ms。

## 默认关闭与回退

宿主 `workbenchBoardActionsEnabled:boolean=false`，原 bootstrap 的[可选能力字段](../../../contracts/workbench_board_action_capability.schema.json) `board_actions_enabled` 缺失按false，且只有既有动作能力启用才广告true。URL、localStorage或生产环境变量不能旁路开启；本地 fixture 的显式 opt-in 不授生产批准。关闭时隐藏拖动／移动入口，稳定 Provider 与业务子树继续挂载，单个 inert manager 的 sensors／plugins／modifiers为空；不声称零对象分配。已打开原表单、UNKNOWN／原 body／未保存输入与已提交事实保持，回到既有按钮操作，不需数据库回滚。

## 证据与历史边界

真正未实施 baseline `bf5665b4ef89c7b149951c0e647ec3f70e6e9e42` 原9441B首例在008真实缺手柄 RED，随后普通合并进入产品并保留 accepted T41 `f146aeb7` 祖先。同字节首例在029及045 GREEN。045是12项11PASS1FAIL，046完工／重开1PASS，最后055仅新Review观察等待校准后1PASS；按未变生产 source/runtime 精确tuple复用，共覆盖8个唯一文件13项，不能称一次whole全部通过。047相关8文件24PASS；048三个具名工具与049具名retired-T02分别3PASS／1PASS。

048外层耗时630136.65ms超过原240000ms，budget=false；三个工具内部 synthetic clone builds 与产品每候选一次构建分列，未跑full hosts／batches／full／certify。048实际156 loaded中153字节可读、3个Vite临时配置已删除；049实际5 loaded中4可读、1个virtual eval无文件，均未重建或补签。构建原大chunk警告保留。

原017／023指针、029文本选择、039键盘观察、041类型准备、045Review存在时序、056清理读取器失败及所有早期 Source-only pin 保留各自身份；旧NOT_RUN、FAIL不重写。055后已精确释放原PG18／62775及本票临时图片资源；静态源码、build／deps／cache与证据保留供最终43清理。能力回落回归明确是 `SYNTHETIC_CAPABILITY_FALLBACK` 前端边界，不冒服务端动态配置实测。正式部署、真实服务／发送、父验收与Gate未获本票本地验证替代。
