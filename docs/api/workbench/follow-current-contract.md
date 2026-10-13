# T34 当前合同补充（2026-10-14）

本文件是旧 follow-design.md 的前向补充，原五physical输入和两首原断言字节另存，旧方案保持历史。初次冻结时 SOURCE_NOT_MOUNTED，runtime NOT_RUN，原七PENDING。

沿原目标HTTP、当前服务端READ、责任并集及caller-only attention；POST /api/workbench/items/{kind}/{id}/follow 的闭合command/result、GET同路径/commands/{UUID}只读原用途收据采用新增 contracts/workbench_item_follow_*。POST只接受JSON四字段，原UUID=Idempotency-Key，If-Match精确双引号64hex版本；Cookie Origin/CSRF与32KiB限制沿现行宿主。网络/503/非法成功视UNKNOWN，只显式核对原UUID或明确重放原body/If-Match。结果只证明原命令，fresh GET才是当前状态。

每次READ/receipt/replay先查当前Principal+对象alias/canonical+留存；新写核canonical及完整本人锚点CAS，等待锁之后再次验当前事实。Follow不授READ，不新增Ticket/Conversationowner、状态/版本、Event、Outbox或Delivery；GET/编辑/个人已读/预约均不关注。related=当前READ交集(处理 OR 实际沟通 OR 显式关注)，规范去重/过滤先于排序LIMIT。当前view/list/detail共享同一安全attention，不泄漏他人关注或隐藏计数。

044仍reserved/NOT_WRITTEN，真实首RED后才最小追加workbench_item_follow表/必要目的证明。047已加入receipt.source_intake_id及PERSONAL_READ资源；不再次ADD此列或退回旧follow-only限制。042 MANUAL、047原目的与050 BOT_REPORTER_FEEDBACK actor-purpose全部保留，旧SQL/hash/marker不改。新schema ready须精确inventory/hash/checksum/marker；关闭或缺新schema不能伪成功，旧模式关闭无新表SQL。关注/receipt历史保留，关闭隐藏scope/操作，不删除事实。

sourceIntake是关注锚点，≤100，row_version十进制string，版本SHA256规范[schema=1,principal,canonical,sorted(anchor,following,row_version)]；取消仅同一当前规范事项当前本人锚点，false tombstone防旧Review复活。具体共享转换锁及additivecatalog在真实RED后实现片冻结/实测。

默认workbenchFollowEnabled=false；board50/max100、body32768、anchor100、concurrency1/240000ms、单App/Worker、SSE32、总池建议≤8，无新timer/Worker/外部发送。当前RootT13/T29/T30/T31/T32接线保全；knownpurpose403/404清该对象，真实401/身份变化沿会话失效。原7整票和真实HTTP/生产bundle/自有cleanup仍必须完成。
