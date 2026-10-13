# T31 Incident 公开进展（SOURCE）

PROPOSED_NOT_MOUNTED。来源 Issue86/WBINT-10/A10；原七项 PENDING，所有 runtime NOT_RUN。

独立人工摘要默认空白，先预览再明确确认。不得读取或复制内部处置。新用途只发送当前 ACTIVE、未暂停、有同身份有效 DIRECT 绑定的个人；没有 GROUP intent、广播、fallback 或 Incident App 路由。原四生命周期用途、六模板及 Ticket ADR0023 不变。独立默认关闭 host option `incidentPublicProgressEnabled=false`。

`POST /api/incidents/{id}/publish-update` 只接受闭合五字段：UUID `client_command_id`、string BIGINT `expected_row_version`、固定 `reason_code=WORKBENCH_PUBLIC_PROGRESS`、独立 `summary`、`preview_confirmed=true`。摘要非空，最多1000 Unicode codepoints/4096 UTF8 bytes，拒控制字符及非法 surrogate。原 Cookie、精确 Origin、CSRF、同 UUID header、带引号 If-Match 与32KiB body 限制沿用。当前 Incident READ、ADMIN/DISPATCHER 及范围/action 授权先于 replay/receipt；owner/HANDLER 不增权。CLOSED 不接受新发布。

原 command_receipt、父版本+1、单 append-only `incident.public_progress_published` 事件、同事务原 Communication Message/Outbox/独立 Delivery；同 UUID/body 返回原 ACK，异 body 冲突。每次最多200有效个人目的地，超过明确拒绝而非截断提交。发送失败或 UNKNOWN 不撤销已提交发布，不盲重试。

`GET /api/incidents/{id}/public-progress` 返回闭合 publication page，默认10/最大30，按 ordinal/id 稳定升序、当前主体/范围绑定游标。`GET /api/incidents/{id}/public-progress/{publicationId}/deliveries` 返回独立安全 route page，默认30/最大100，按 Delivery created/id 稳定升序。当前页不称全部；只含 opaque id/BOT_DIRECT/REPORTER_DIRECT/status/attempt_count/side_effect_state/安全 error code/sent_at，无 target、account、binding hash、receipt 或内部标记。原六字段 ACK 及原 UUID receipt 复用。

最小必要058预留，尚未写 SQL：沿原 event 增公开摘要/提交版本，原 notification binding 增 DIRECT leg 锚点及新模板；保留所有原枚举。055精确原hash与新增058精确catalog/marker/checksum共同证明合法共存，禁止 contains/CHECK(true) 宽松 readiness。原032/055字节冻结。

发送尝试前同事务再次验证当前 ACTIVE/同身份/原绑定并与暂停锁序协调；准入之后是 in-flight，不能把已发送或 UNKNOWN 重标未发送。单既有 Worker/concurrency1，fixture pool≤4/总建议≤8，SSE32，不新增事实源或进程。草稿独立 purpose、24h/16KiB/20份；敏感正文清理与未知原UUID/版本标识分离，恢复开关关闭也保留同页标识。UNKNOWN先显式核对原receipt，不自动新UUID/重发。

关闭独立 host flag，保留追加事实，不做破坏性 down。只准隔离模拟 Sender/PG/正式 bundle；真实发送、部署、full/certify、Gate NOT_RUN。T32/T33异常重试/核对管理不提前实现。
