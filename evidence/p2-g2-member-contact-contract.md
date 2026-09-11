# P2-G2 企业微信成员联系资料准备合同

依据负责人 2026-09-09 通知策略与联系资料要求，以及持续缺口修复授权。本次按企业内部成员准备；不把客户联系 external_userid 直接当内部 userid。只接受部署时明确绑定的 Bot 与企业成员标识来源，默认关闭。无数据库迁移，不建立 Person registry，不接医院目录，不调用真实企业微信接口。

复用 ReporterDirectoryPort 的单并发、超时、事务外读取和失败 DEFERRED 机制。适配器通过注入的 access-token provider 读取企业微信 user/get、department/get，校验响应 userid 与输入一致，最多读取 20 个可见部门。姓名、userid、部门与主部门、mobile/telephone 均来自接口；权限缺失保留 null，不猜测，不阻止 Inbox/Intake/Ticket。全流程共享 AbortSignal；不自动重试。原始响应、令牌和 URL 不进入日志、错误或普通投影。

快照沿用 Journey 的不可变 report-time profile_snapshot。只有通过现有 Ticket 可见性验证的内部工单联系资料端点返回明确允许的联系字段；原有普通 Journey、Reporter 时间线、Decision、通知不增加这些字段。接口不刷新旧快照，不要求 Direct Leg；群内报修同样可用。缺失/超时/未配置显示资料暂不可用，内部人员仍可通过已有会话补充。

本地使用模拟 HTTP 响应与真实隔离 PostgreSQL 验证。真实企业成员标识兼容性、应用权限和手机号可用性仍须在授权现场确认，不能以本地模拟声称已获取真实资料。

受控配置：manifest 的 `scope.member_directory` 可省略（关闭）或设置 `{enabled:false,internal_member_ids_confirmed:false}`。仅在确认 Bot 入站 userid 对应该企业自建应用内部成员之后，才能将两项设为 true，并重新绑定完整 scope 的现场批准。私有环境 `P2_G2_DIRECTORY_ACCESS_TOKEN` 仅传给 Worker；App/Gateway 不接收。令牌由部署方在现场前提供，本轮不增加 CorpSecret 保存或自动续期。缺失、过期或无权限降级 DEFERRED，仍不影响基本服务。

开启后 Worker 在每次读取前复核候选、有效期和现场批准文件。进程网络边界仅放行 approved Reporter 的 user/get 与 department/get GET，不放行用户写接口、额外参数或外部人员查询。synthetic 三进程运行不会启用真实目录，即使配置启用也保持 DEFERRED；适配器 HTTP 行为单独以模拟响应验证。服务启动不能当作目录真实可用性证据。

官方字段依据：[读取成员](https://developer.work.weixin.qq.com/document/path/90196)、[获取单个部门详情](https://developer.work.weixin.qq.com/document/path/95351)。
