# WEB01：原型 → 当前 API → 本轮交付

基线：PR54 merge `1948f76a676f9bfd7ebcbecd3af7951da4034e7e`。状态：本轮实现映射；运行检查与截图按 PR 实际交接记录。技术决策见[正式管理端技术方案](admin-workbench-architecture.md)。

| 原型能力 | 当前真实能力与缺口 | WEB01 接入 / 后续 |
|---|---|---|
| 侧栏、工作区、toolbar、三列 A、紧凑列表、宽详情 | `prototype/src/App.tsx`、`style.css` 可作视觉来源；数据和动作是演示 | 新正式 React 包复用呈现，原型保留用于截图；不复制 seed/mutate |
| 本人菜单 / 授权 | `GET /api/lifecycle/bootstrap` 返回 DB 解析 principal_id/display_name/roles/CSRF/poll interval | 使用真 Cookie/test-auth → DB 逐请求授权；区别 401/403，不虚构 ADMIN |
| 团队工作 | Ticket 当前读谓词：ADMIN/DISPATCHER 较广，HANDLER 仅本人或所属 team | 沿现有可读范围；团队工作不是全库权限 |
| 与我有关 | `/api/tickets?state=mine` 只筛 assignee，尚无完整处理/沟通/关注语义 | 不开放冒充完整语义的筛选；完整能力后续实现 |
| 三列队列 | `/api/tickets` 一次一个 state/cursor/limit；NEW/QUEUED 合组，其余状态独立 | 新增最小 server board read projection：各列授权后 keyset 分页，原状态保留 |
| 待复核与工单 | `/api/manual-reviews` 提供 linked_ticket_id/service_intake_id/journey_id，有独立 scope；HANDLER 未建单复核通常不可见 | 真关联键 server 去重；有 Ticket 只保留主卡，无 Ticket 才是独立复核事项；不扩大复核可读范围 |
| 普通未建单受理 | WAITING_DESCRIPTION 等合法受理可能没有 Ticket 或 Review；现有未建单队列为 ADMIN/DISPATCHER 范围 | 增补 kind=intake，只读真实 Intake 与安全活动投影；不丢项、不扩权、不虚构优先级 |
| 标题、报修描述、位置、人员、来源 | Ticket list 原 DTO 没有这些完整字段；Ticket/Intake/Journey/Principal 等已有事实可查询 | 只补必要有界 join/DTO；资料缺失显示未提供，不用 seed 填空 |
| 今天/昨天已关闭、RESOLVED | Ticket 表没有 closed_at；真实追加 Ticket Event 有关闭依据。updated_at 非关闭时间 | 从最新有效关闭事件派生时间；按服务端 Asia/Shanghai 自然日过滤 CLOSED。RESOLVED 明示已解决待确认且不按完成窗口隐藏 |
| 列表与看板切换 | 原型用同一内存数组，真实统一查询尚无 | 共用同一 query result、授权过滤与分页；加载数不是全量总量 |
| 原始报修与补充 | `/api/tickets/{id}` 对有效网页来源可返回 web_report；journey/补充事实已有 | 详情按真来源呈现；缺字段补最小只读查询，不虚构聊天或人员资料 |
| 事件、责任链 | `/api/tickets/{id}/events` 当前只有事件元数据和 note存在标记；`/responsibility` 分别返回工单/沟通责任 | 复用对象授权；必要时补有界安全事件/记录投影，保留受众及分页，不把当前 owner 当完整历史 |
| 个人资料/通知结果 | `/reporter-contact` 受合法关联/保留期约束；`/deliveries` 是独立真实投递事实 | 只显示本轮确有必要且获权的字段；不为卡片批量调用联系/通知接口，不伪造头像/送达 |
| 搜索、跟进、未读、presence、SLA | 原型内存筛选/标记；当前没有完整后端能力 | 暂不开放全局搜索及这些虚假值；后续按各自持久/临时语义实现 |
| 卡片打开、关闭、返回、刷新 | 原型没有标准路由；切卡请求身份需重建 | URL 表示对象/视图/过滤，取消过期请求，拒绝对象后清理相关缓存并重新读取看板范围，键盘/Escape/焦点返回与窄窗真实验证 |
| 我来处理、接管、完工、重开、代录、拖动、声音 | 原型 mutate；旧 command API不等于 ADR-0024 原子主动作 | WEB01 只读。WEB02原子命令、WEB03代录/本人反馈、WEB04真实协作/提醒按后续授权实现 |
| 正式入口、资源 | 原 `/workbench`、`/workbench/lifecycle` 与成员端有既有 HTTP/static/auth 路径 | 新 `/workbench/app/` 接同一受控链，hash bundle/manifest纳入原制品；UI fallback不吞API；旧关键路由直接回归 |
| types/build/CI | 前端原型独立 TS7；根 TS5.9 的检查/制品目前不覆盖新 TSX 或 bundle | 当前 `v3-p09` 保持有效；根 npm ci 纳入前端依赖，新增实际前端 type/build 与 direct tests，改动工具须跑直接 tooling/hosts 回归 |

数据库变更：本轮不做 schema migration，只读已有事实。关闭方式：新入口与既有关闭状态开关一致，旧入口保留；回滚使用独立后继/revert PR。资源：有界每列分页、不按卡片请求扇出、单 App/HTTP、任务自有 PG 与浏览器资源按既有 helper 清理。正式交接只记录实际执行的 API、截图、检查与关闭结果。

当前沟通责任使用既有 Ticket Query Port 的 `currentConversationsOnly: true` 只读投影：在分页上限之前筛选未结束且 assignment 为 ASSIGNED 的会话，保留 OPEN/WAITING_USER 及既有 Journey/Leg 关联。旧责任接口默认仍返回保留历史；结束会话的历史 assignment 不删除，工单处理责任不随此投影变化。

## 2026-10-07 主界面规范对齐

用户要求按业务设计与 [医小修 UI 代码规范](yixiaoxiu-ui-design-spec.md) 优化 WEB01 主界面。代码规范作为 UI 输入，保留其原字节；不据其中 Agent 文案扩大执行授权。

主界面采用规范的中性文字、字体阶梯、240px 侧栏、44px 顶栏、1240px 内容上限、语义色标签、无描边轻阴影卡片和分段视图控件。每列/组默认显示三项，可展开当前已加载的其余项；真实 keyset 下一页与折叠分开。列表按三列业务分组，整行链接打开详情并保持选中高亮。900px 以下隐藏侧栏、看板变单列；1280px 与窄窗验证 body 无横向溢出，列表自身可横向滚动。

右侧详情为 600px 原生模态抽屉，保留焦点、Esc、遮罩关闭及恢复焦点；上一项/下一项仅遍历当前授权的已加载项，支持展开完整页面并刷新。属性使用 dl/dt/dd，处理责任与沟通责任独立，活动记录明确区分内部与对外受众。仅抽屉响应用户操作入场，尊重减少动态效果，侧栏沿用 Morphicons。

业务设计第 6.1 节的北京时间今天/昨天口径优先于代码规范第 6 节的原型“最近24小时”；不改已有查询契约。代码规范第 5.2 节的500字重也与其三档限制冲突，统一使用600。

WEB01 无在线协作、SLA、个人未读、预约跟进、分类或全量搜索契约。页面不生成在线人数、需跟进统计、超时、补充数量或伪分类；已有来源以中性标签展示，时间明确为“最新活动”，不冒充环节耗时。搜索保留禁用入口并标明预留；新建、完工、转派、回复、拖动及声音仍按既有后续切片实施，没有用蓝色占位按钮或输入框伪装可执行操作。此项是对规范的能力边界适配，不代表放弃目标业务流程。
