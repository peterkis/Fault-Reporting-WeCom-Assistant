# ADR-0029：正式管理端的前端与服务端状态边界

- 状态：Accepted（技术选型）；依据用户 2026-10-07 的明确决定，不是功能、现场或发布批准。

正式 PC 管理端复用已有 React/Vite/HeroUI/Tailwind/Lucide/Motion/dnd-kit，采用独立正式包及现有同源 HTTP/静态制品装配。新增 React Router 7、TanStack Query 5、Zustand、TanStack Table 和 Morphicons；首版浏览器为 Edge/Chrome。保留旧工作台、成员端及视觉原型，不引入 Next.js、BFF、ORM 或第二发布平台。

React Router 和 URL 承载可返回/刷新的导航；Query 承载获权服务端数据、分页和查询失效；Zustand 只承载共享界面状态及未来独立草稿；Table 承载列表呈现，不能把当前页筛选当全量查询。代价是新增少量锁定依赖，但避免后续工作区自行重建请求缓存、导航和表格引擎。工单、责任、关闭、沟通和可靠投递继续由原事实源及授权命令拥有；前端不复制第二状态机。

Morphicons 只增强状态切换的图标反馈，使用与 lucide-react 同版本的 lucide 数据，明确尊重用户减少动效偏好。WEB01 只读；写动作、刷新后草稿恢复、presence、未读/跟进、声音和桌面宿主分别留待对应后续切片。详细版本与契约见 [技术方案](../docs/ui/admin-workbench-architecture.md)。
