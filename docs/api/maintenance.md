# 接口文档维护与本轮核对

返回 [导航](README.md) · [完整HTTP索引](endpoint-index.md)

## 变更时同步

后续新增、删除或变更交互服务接口时，在同一开发变更中同步本目录。先检索现有 `METHOD + PATH + 宿主/profile`，优先扩展已有模块，不为同一资源建立另一套相近命名。Contract-first和Accepted ADR规则仍按 [AGENTS.md](../../AGENTS.md) 执行。

1. 更新endpoint-index.md，写明精确方法/完整路径、宿主、实现状态与模块链接。参数统一 `{camelCaseName}`；每个实际操作单列一行，不用 `{action}` 隐藏不同合同（历史P1同时保留dispatcher说明）。
2. 更新模块文档：调用方、auth/对象权限、默认Flag、请求参数/字段及类型/必需/null/长度、响应与status、错误码、幂等和版本Header、时间/分页、资源上限、合成示例、源码/Schema/测试。
3. 修改挂载顺序/profile/认证时同步conventions和auth-health；新增SSE/WSS/Port不能冒充REST。外部Provider只记允许的adapter能力，变量仅列名称。
4. 根据影响更新源Schema/OpenAPI/DTO与有意义的业务/契约验证。文档与实现不一致记录差异，不能静默绕过授权修正业务或改旧证据。
5. 核对所有本地Markdown链接、锚点、索引覆盖、示例JSON；代码变更检查按活动selection执行。纯文档整理不自动要求full/certify或新readiness候选。

模块表的共享认证/错误/输入规则对其所有路由生效；某接口的例外必须显式写出。响应示例用合成ID与固定日期；秘密用占位符，绝不从 `.env` 或现场日志取样。

## 新接口文档模板

```markdown
## 接口名称

- METHOD + PATH：`POST /api/example/{resourceId}`
- 实现状态 / 宿主 / profile：已实现、默认关闭；W
- 调用方：前端文件或后端Port
- 认证权限 / Feature Flag：身份、资源范围、默认值
- 输入：Path / Query / Header / JSON字段、类型、必需、上限
- 输出：HTTP状态、DTO字段、null/省略、异步完成条件
- 失败：稳定码、何时重读/重新认证/保持原命令ID
- 幂等 / 版本：ID范围、If-Match或revision类型
- 资源与隐私：body/page/concurrency/timeout、字段暴露范围
- 合成请求 / 响应示例
- 源码 / Schema / 前端 / 测试链接
```

## 本轮范围与证据

基点：`3cf707945afac7392806f7d8dca3dfb6be94caad`；日期2026-10-07。只读遍历实际src HTTP宿主/路由、前端fetch/EventSource/navigation、contracts与已有测试；分别核对已实现、条件兼容、显式拒绝、设计路径、外部调用和内部Port。

初轮文档任务已完成。后继加入只读群回调验证和管理员来源群名称模块后，接口目录共18份Markdown，HTTP索引包含112条REST/SSE/认证/健康操作与18组页面/静态入口，设计与拒绝路径另列。逐操作与实际handler/前端调用清单交叉核对；本地链接/锚点、JSON示例、表格列数、关键标识/时间/版本类型和工作区差异范围检查分别记录。群回调任务的一条真实只读捕获与后继[群名称本地实现验证](../../evidence/workbench-source-group-names-local.md)独立记账。

初轮文档整理无数据库/测试代码变更、无业务测试/full/certify。后继群回调经授权在内存使用.env测试Bot凭据，临时单连接捕获后退出，不保存凭据、原始群ID或原文。后继群名维护实现新增独立迁移、默认关闭宿主选项及相关本地测试，详见本轮记录；没有真实库应用、生产启用或Gate推进。文档完成、只读接口观察与本地功能实现分别记录。

初轮文档的回滚仅涉及docs/api及README、docs/08导航增量。后继群名称功能的关闭/源码回滚按[模块合同](workbench/source-groups-design.md)执行，保留名称和审计资料。不要回退用户已有AGENTS/UI设计稿改动，不改历史evidence，不把文档回滚当业务库回滚。
