# YXX-UI-003 中文服务目录选择器

状态：IMPLEMENTED_WAITING_REVIEW。2026-10-05 用户授权“按照建议，逐切片依次完成剩下的候选”；B / PR #50 合并后从 main `243173089684ca59069fc9a13646205f22012f2b` 开始 C。代码/关键 RED→GREEN 完成，最终回归、审查与交付以 PR HANDOFF 实际结果为准。

输入为当前成员在新报修表单选择中文服务名；输出为同一目录服务 code 的既有报修提交，也允许“不清楚/未列出”的 null。目录失败不阻止文字报修，不保证选择服务即可建单，不改规则/责任组/阈值。目录来源复用 P2-007 ServiceCatalog，默认 App 编排与选择器共享同一实例；现有规则引擎新增纯 `getServiceCatalog()` 返回其实际不可变目录，FULL/SELF 组装据此取得同一实例。opaque 自定义引擎/Worker 须提供配对目录；缺失、getter 失败或显式目录与引擎实例不匹配时目录 API 不可用，文字入口保留。FULL 默认独立 Worker/入口仍使用既有同一配置源，不改变原 Worker 组装条件、不增加 App pump 或外发。

先冻结合同：新增 `GET /api/yixiaoxiu/service-catalog`，无查询/正文参数，受 currentMember、self-service/my-reports Flag 与同源边界保护；匿名、OAUTH_ONLY、readonly 或关闭状态拒绝。响应闭合 `{schema_version:1,catalog_version,services}`，最多 200 项，仅启用服务的 `service_code`（最多 64）、`name_zh`（最多 80）、`category`（最多 64）、`category_name_zh`（最多 80），版本最多 64。超界/失败返回 503，不公开责任组、别名、规则、目录身份或哈希。no-store。原七接口是历史基线，本增量经 ADR-0021 的局部追加确认。

输入 `service_code` 继续可空，兼容无点号代码，并接受实际目录的 `CATEGORY.SERVICE`（每段以大写字母开头、数字/下划线，整体最多 64）；同步 JSON Schema、公开 d.ts、服务端和页面，保持原幂等、闭合对象与归一化规则。

审查修补的内部规则输入：原初始提交 code 作为显式 `RuleEvaluationInput.service_code` 传入，只允许 WEB 来源、有界语法且当前目录启用的服务成为 `REPORTER_EXPLICIT` 事实；出处 hash 包含描述和 code，不假冒 alias 或人工确认。未知/disabled/null 继续原文本路径。与文本解析或确定性规则的服务事实冲突时保留各出处，通过既有冲突处理进入人工审核，服务/责任建议为空。规则集、阈值、字典、事件和 Ticket 状态机不改；选择本身不代表技术故障或建单批准。公开规则引擎与实际成员 HTTP→授权审核决策分别 RED→GREEN。

已授权公开 seam：真实 Store/Query 的 loopback PG18 集成、原生 HTTP 请求、Mock OAuth 浏览器表单与既有 Schema/TypeScript 合同。逐行为 RED→GREEN，验证禁用/未授权/越界目录、中文映射、XSS、失败后文字提交、退出与晚到响应；沿用既有验收与 v3-p09 四项 smoke。新增 schema 登记现有制品资源，不新增 selection/CI/依赖。

无数据库迁移，默认 Flag 全部 false，最多一次初始目录 GET（随页面会话重新引导可重新取一次），无目录轮询、连接池或外部调用。目录/草稿仅 DOM/内存，清理沿用原 generation/abort/会话边界；关闭原 Flag 或独立 revert PR 回退。

实际最终 head、直接测试、strict types、一次构建、制品与自有资源清理、@codex review 修复收口、merge/main 快进/选择性清理以 PR HANDOFF 和 `D:/Agent-State/wecom-yxx-service-picker-20261005/` 为准。backlog 单列增量；不改历史 Evidence/Gate/181 分母，不执行 full/certify、R01、真实 OAuth/企业微信/医院库、生产启用或部署。
