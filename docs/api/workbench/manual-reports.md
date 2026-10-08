# 电话／现场代录合同（WBINT-T17）

返回[导航](../README.md) · [索引](../endpoint-index.md)。本合同冻结 T17 输入。POST已在工作人员宿主挂载、默认关闭，尚待原HTTP GREEN；capabilities与只读receipt仍在本票后续实现中，不能称已有接口。

宿主 W，内部工作人员会话。`workbenchManualReportsEnabled=false` 默认关闭；关闭时拒绝该用途并不访问042存储。启用后缺033/042 readiness 返回503。AI、外部目录、OAuth/Provider、Sender不参与受理。只有当前active ADMIN／DISPATCHER，或实际属于至少一个active处理组的HANDLER可以新代录；重复与回执每次重新核验同一当前权限。浏览器不能提供actor、WeCom identity、person binding、状态或处理人。成功受理不扩大该工作人员对新Ticket／Journey的既有读取范围。

| 方法与路径 | 合同 |
| --- | --- |
| `GET /api/workbench/reports/capabilities` | `{can_create:true,manual_contact_required:true,external_notification:false}`；当前权限及readiness重新核验 |
| `POST /api/workbench/reports` | JSON、同源Origin/CSRF、Idempotency-Key与body UUID相等；首次202、相同原意图重放200 |
| `GET /api/workbench/reports/commands/{commandId}` | 默认恢复能力同时启用；READ ONLY原principal＋MANUAL_REPORT用途账本，闭合UNKNOWN/FAILED/COMMITTED，不写receipt，不按状态猜结果 |

请求闭合字段：`schema_version:1,client_command_id:UUID,source:PHONE|ON_SITE,description:string,location:{text:string|null,unknown:boolean},reporter:{verification:UNVERIFIED,name:string,contact:string,department:string|null}`。描述去首尾空白后1–4000字符，姓名1–100、联系方式1–100、科室最多100、位置最多200。unknown=true只允许text=null；unknown=false要求非空位置。全部单行资料拒绝控制字符；描述保留换行。Body最多16KiB。字段不得含患者详情、口令或其它敏感业务记录。

返回闭合`{ok:true,client_command_id,intake_id,intake_no,source,reporter_verification:UNVERIFIED,manual_contact_required:true,external_notification:false,result_code,ticket:{id,number,status}|null,review:{id,status:PENDING}|null,replayed}`。返回的是同事务持久受理及规则结果；Ticket状态取Core，Review取原队列。真实故障经UnifiedTicketCommandPort创建最小Ticket；高风险／规则不可用／咨询／缺少可判现象进入必要Review。HANDLER受理可进入Core默认处理组，回执不授予该Ticket可见权，不允许顺便接单。没有消息Inbox、Conversation、Message/Outbox/Delivery、Reporter Access或外发。

422不使用；输入400、认证401、权限403、变意图UUID409、关闭／缺schema／原事务失败503；稳定P2_016错误包沿公共约定。失败业务全部回滚，原账本保存FAILED；失败回执只含code/retryable:false。UNKNOWN仅表示找不到终态，不能推断未提交。COMMITTED只含原受理结果且replayed:true，无联系方式或完整描述。

042仅增加Intake原人工描述／来源／实际Reporter未核实快照和authenticated actor；Journey/Leg/Decision引用同一Intake，不新建Ticket/Owner/receipt表。旧SQL、历史证据、181迁移分母保持。停止本票option即可停止新代录/读取用途；已保存事实与原命令账本保留，结构修复用后续迁移。

正式新报修表单复用T03当前浏览器AES-GCM、不可导出key、20份/16KiB、首次保存后固定24h、principal+intake+固定新报修scope+manual-report用途。恢复前重新GET capabilities并核验当前account；只保存业务密文与原UNKNOWN UUID/body，不保存凭据。提交、恢复均不自动POST；成功、丢弃、退出、失权、过期沿T03清理。UNKNOWN正文/UUID不可更改，只能显式GET核对；敏感过期后仅保留opaque操作标识。

资源沿既有单App/Worker、Gateway单活、SSE32、共享pool max4／总预算8；本票无新后台worker、timer或目录网络。公共验证seam为真实已编译HTTP＋隔离PG及正式production bundle，七项追溯见[执行记录](../../../plans/admin-workbench-integration/execution/t17.md)。T18目录核实、T19一步接单均不在本票。
