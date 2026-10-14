# T34 当前显式关注合同（2026-10-14）

本地合成实现与适用定向验证已完成，默认关闭，父级整票验收待定。功能源为 `2ea282127202945ad2021029f39596f14fb12d9d`，tree `9bd0d5ea503bc76da2586d3a35f3a099b82ad533`；当前制品 MF `0ccbfd177005b19a84ef4d4c938b15554a85f4346b7cc1d549cb5182c0e043b8`。这不表示生产授权、真实外发、部署或 Gate。旧设计与下方初次冻结原文保持历史。

## 当前输入、输出与 HTTP

宿主 W 使用现有内部活动人员与当前事项 READ。`GET /api/workbench/board?scope=related` 仅在 `workbenchFollowEnabled=true` 接纳；team 默认、scope 不重复，游标绑定身份／当前授权／scope／column／range。每页默认50、最大100，规范去重与当前授权过滤先于 LIMIT；当前页不代表全部事项。列表、看板和详情使用同一当前获权卡片及本人 attention。

`POST /api/workbench/items/{ticket|review|intake}/{UUID}/follow` 只接受 `client_command_id,canonical_item,expected_follow_version,following` 四字段。UUID 等于 Idempotency-Key，If-Match 为双引号包围的原64位小写十六进制版本；JSON／Origin／CSRF及32768字节上限沿现有宿主。结果为闭合 `ok,client_command_id,requested_item,canonical_item,following,follow_version,replayed`。Schema／DTS位于 `contracts/workbench_item_follow_*`，不更改旧未挂载提案的字段或字节。

`GET /api/workbench/items/{kind}/{id}/follow/commands/{UUID}` 是当前 READ 下的原主体／原请求父项／原用途只读核对，返回闭合 UNKNOWN、FAILED 或 COMMITTED及原结果。历史提交不能代替当前 following；原UUID/body/If-Match显式重放，确认后重新 GET 当前资料。网络、5xx、非法成功或 POST 成功后的 bootstrap 暂时失败均不能视为已拒绝；仅闭合的原 POST 拒绝可终结该意图。

## 权威、版本与隐私

related 为当前 READ 交集（本人处理责任 OR 当前 ASSIGNED且非ENDED沟通责任 OR 本人明确关注）；只读查看、编辑、已读、预约或其他操作不自动关注。关注不授 READ，不改变 Ticket／Conversation负责人、状态、版本、Event、Outbox、Delivery或其他人的注意关系。

Intake为个人关系锚点，最多100。Review转换后规范到Ticket单卡，取消覆盖当前规范事项的全部本人锚点，false tombstone防旧Review复活。opaque版本按principal／canonical／排序锚点及following/row_version计算。现有P2_016 command ledger为唯一操作收据；当前READ在receipt前、等待receipt锁后及真实规范关系／角色／组／事项锁后重新核验，新增写入校验CAS和实际变更量，不另建所有权或历史事实。

当前bootstrap明确返回 `workbench_follow_enabled`、`workbench_follow_draft_recovery_enabled`，后者为Follow与既有恢复开关交集。正常新操作在恢复关闭时不创建持久草稿或opaque ledger，仍在内存保留原UUID核对；开启时复用当前浏览器加密恢复（24h、20份、16KiB）。不会自动重发；显式重放保持原wire body/UUID/version。purpose不可用且普通READ仍有效时保留原操作供核对；对象失权清该对象私有副本和展示，真实401或身份变化清会话。当前READ失效后的迟到HTTP/SSE不能复活详情或操作。

## 数据库、readiness与关闭

新增唯一 `044_workbench_item_follow.sql`：普通logged关系、六个非派生列、principal/sourceIntake的RESTRICT FK、复合PK、row_version CHECK和两个有效／ready的精确索引；无自定义触发器。原042／047／050以及所有旧SQL保持原字节；047已有receipt.source_intake_id，044不重复增加或削弱共享purpose/resource/actor约束。

readiness核044完整marker/checksum、六列type/null/default且is_generated=NEVER、十约束、两索引的定义与valid/ready/unique/primary、普通持久非partition关系及无custom trigger；共享receipt复用既有完整catalog读取，精确22列／27约束／8索引／0触发器及031→042→047、可选050的完整摘要和各checksum。CHECK true、非法索引、UNLOGGED、抑制写入trigger或generated following均拒绝，迁移status/NOOP同样不放行。

默认 `workbenchFollowEnabled=false`，关闭不读新关注表，旧host缺044仍可用。关闭Follow隐藏新scope与写／ACK用途，不删除个人关系或原命令；恢复开关独立关闭不证明 UNKNOWN 的业务结论。迁移check回滚、apply、status/NOOP复用现有单pool、5s锁与60s语句限制，不删除事实作rollback。

单App／Worker、Gateway单活（本票未连接）、SSE默认32、fixture pool<=4／总建议<=8、串行通信及测试concurrency1保持；每个业务入口240000ms。052浏览器5例与051后端10例、053旧兼容9例均在当前功能源／MF上实际通过；039两冻结首、合同及正式UI是其真实前继证据，区别各head/MF，不合并成一次full。044三条既有归档工具功能PASS，但同步scratch build使实际每条323979/243427/346119ms，虽请求240k仍未有效限定墙钟，不称工具预算PASS。

唯一自有PG24724已在056精确pre0/stop0/post3，pidfile无、单62775 LISTEN0、config原SHA及keeper STOPPED/pidnull；055只读自有cluster残留DB0/client0、结束probe pool并在保存原字节后清除唯一032遗留PNG目录。资源与完整保护最终引用以仓库外whole handoff为准，无全局进程扫描／kill。全部旧RED、技术FAIL、NOT_REACHED和006／032归档限度保留。

## 初次 SOURCE 冻结原文（历史）

# T34 当前合同补充（2026-10-14）

本文件是旧 follow-design.md 的前向补充，原五physical输入和两首原断言字节另存，旧方案保持历史。初次冻结时 SOURCE_NOT_MOUNTED，runtime NOT_RUN，原七PENDING。

沿原目标HTTP、当前服务端READ、责任并集及caller-only attention；POST /api/workbench/items/{kind}/{id}/follow 的闭合command/result、GET同路径/commands/{UUID}只读原用途收据采用新增 contracts/workbench_item_follow_*。POST只接受JSON四字段，原UUID=Idempotency-Key，If-Match精确双引号64hex版本；Cookie Origin/CSRF与32KiB限制沿现行宿主。网络/503/非法成功视UNKNOWN，只显式核对原UUID或明确重放原body/If-Match。结果只证明原命令，fresh GET才是当前状态。

每次READ/receipt/replay先查当前Principal+对象alias/canonical+留存；新写核canonical及完整本人锚点CAS，等待锁之后再次验当前事实。Follow不授READ，不新增Ticket/Conversationowner、状态/版本、Event、Outbox或Delivery；GET/编辑/个人已读/预约均不关注。related=当前READ交集(处理 OR 实际沟通 OR 显式关注)，规范去重/过滤先于排序LIMIT。当前view/list/detail共享同一安全attention，不泄漏他人关注或隐藏计数。

044仍reserved/NOT_WRITTEN，真实首RED后才最小追加workbench_item_follow表/必要目的证明。047已加入receipt.source_intake_id及PERSONAL_READ资源；不再次ADD此列或退回旧follow-only限制。042 MANUAL、047原目的与050 BOT_REPORTER_FEEDBACK actor-purpose全部保留，旧SQL/hash/marker不改。新schema ready须精确inventory/hash/checksum/marker；关闭或缺新schema不能伪成功，旧模式关闭无新表SQL。关注/receipt历史保留，关闭隐藏scope/操作，不删除事实。

sourceIntake是关注锚点，≤100，row_version十进制string，版本SHA256规范[schema=1,principal,canonical,sorted(anchor,following,row_version)]；取消仅同一当前规范事项当前本人锚点，false tombstone防旧Review复活。具体共享转换锁及additivecatalog在真实RED后实现片冻结/实测。

默认workbenchFollowEnabled=false；board50/max100、body32768、anchor100、concurrency1/240000ms、单App/Worker、SSE32、总池建议≤8，无新timer/Worker/外部发送。当前RootT13/T29/T30/T31/T32接线保全；knownpurpose403/404清该对象，真实401/身份变化沿会话失效。原7整票和真实HTTP/生产bundle/自有cleanup仍必须完成。
