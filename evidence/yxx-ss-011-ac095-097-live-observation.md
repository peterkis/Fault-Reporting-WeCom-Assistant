# SS-011 AC-095–097现场观察（阶段性）

日期：2026-09-21。以下为现场报告与专用测试库只读对账的阶段性记录，不关闭 SS-011。

## 现场结果

- AC-095：A/B分别从企业微信固定入口登录并再次访问；现场报告结果符合预期。待最终报告绑定脱敏身份校验和OAuth计数。
- AC-096：真实网页提交已发生；至少一条明确技术故障进入 Ticket 创建路径。没有新的人工审核项符合明确故障的规则优先路径。该项仍需把A/B两条清晰故障分别绑定到收据和Ticket后最终收口。
- AC-097：A的待补充报修经本人补充后状态更新并创建 Ticket `IT-20260921-0001`。B提交的非报修内容已受理并补充，但尚未创建 Ticket；其最终决策是否为 `OUT_OF_SCOPE/NOT_SERVICE` 尚未满足。

## 专用库只读对账

查询未输出身份、原始描述、Cookie或密钥。结果为：5个命令收据、5个Web submission（其中2个是补充）、3个Web Intake、1个Ticket。Intake状态为1个 `TICKET_CREATED`、2个 `WAITING_DESCRIPTION`；Ticket为1个 `IT-20260921-0001`，状态 `QUEUED`。事件为3个 `intake.web_received`、2个 `intake.web_supplement_added`、1个 `intake.ticket_created`、3个 `intake.description_requested`。确定性决策为1个 `TICKET_ELIGIBLE`和4个 `NEEDS_DESCRIPTION`；人工审核项为0。

## 后续现场更新

B随后以 `天气` 进行干净的非报修测试，页面提示“不属于报修范围”。只读对账更新为：7个命令收据、7个Web submission、5个Web Intake、2个Ticket；Intake状态为1个 `IGNORED`、2个 `TICKET_CREATED`、2个 `WAITING_DESCRIPTION`。B该条Decision为 `OUT_OF_SCOPE`、reason `DETERMINISTIC_NON_IT_SCOPE`，未关联Ticket，满足非报修分支。

A的合成高风险测试页面显示“工单已创建工单 IT-20260921-0002 · 等待受理”。对账显示该条同时产生 `MANUAL_REVIEW_REQUIRED`、reason `FAULT_REQUIRES_SAFE_REVIEW`，并存在1个 `PENDING`人工审核项；按当前规则，高风险故障先创建最小Ticket并保留人工审核，不是自动绕过审核。Ticket `IT-20260921-0002` 当前为 `QUEUED`。

下一步是在工作台“待人工审核”队列打开该项，选择“确认为故障报修”并提交；不要选择“标记非受理范围”。审核收口后执行AC-098越权、AC-099幂等/恢复，再用两个Ticket之一执行AC-100生命周期。完成后再做最终关写对账。

## 审核收口更新

工作台已显示 `IT-20260921-0002` 的网页报修详情；只读对账确认人工审核为 `RESOLVED`，追加 Decision 为 `TICKET_ELIGIBLE / OPERATOR_REVIEWED`。当前计数为8个命令收据、8个Web submission、6个Web Intake、2个Ticket；Intake为1个 `IGNORED`、2个 `TICKET_CREATED`、3个 `WAITING_DESCRIPTION`；两个Ticket均为 `QUEUED`。当前已达到本轮6个新Intake上限，不再新建报修。

该Ticket没有关联会话符合Web入口的应用内进度边界；工作台显示暂无外部通知。下一步只对既有Ticket执行：接单、开始处理、请求上报人补充、A在原报修详情补充、恢复处理、内部备注隔离、解决和关闭。随后执行越权/幂等检查和最终关写对账。

## 补充后的规则复评

A完成补充后，系统追加了一条 `web_supplement_added`，并再次产生 `MANUAL_REVIEW_REQUIRED / FAULT_REQUIRES_SAFE_REVIEW`，所以工单暂时出现在“待人工审核”队列。只读对账显示该 Ticket 当前为 `IN_PROGRESS`，人工审核为1条 `PENDING`；这不是 `WAITING_REQUESTER`，因此当前不应显示“恢复处理”。应先在待审核队列再次选择“确认为故障报修”，再回到“处理中”队列继续“登记解决”和“确认关闭”。

## 生命周期收口更新

用户完成审核复评、接单、开始处理、请求补充、补充、恢复处理、内部备注、解决和关闭。`IT-20260921-0002` 当前为 `CLOSED`、版本8；事件顺序为 `ticket.created`、`ticket.accepted`、`ticket.started`、`ticket.waiting_requester`、`ticket.resumed`、`ticket.note_added`、`ticket.resolved`、`ticket.closed`。内部备注存在，所有事件的外部备注均为空。`communication.outbox/message/delivery/delivery_attempt` 与 `notification.outbox/delivery/delivery_attempt` 均为0。该记录支持AC-100的生命周期及零外发部分；成员Timeline的现场可见性仍需最终截图/页面记录绑定。

## AC-098成员页面观察

A确认自己的详情Timeline显示状态变化且看不到内部备注。B打开A的详情链接后只看到“已验证成员会话，可开始自助报修”的通用首页；截图没有泄露A的描述、位置、Ticket或Timeline。客户端在无权详情响应时清空详情并回到首页，因此截图不显示HTTP状态码。越权页面观察通过；命令收据/命令查询、伪造cursor/身份字段及对应安全审计仍待受保护服务端核验，AC-098整体暂不关闭。对账计数保持9个收据、6个Web Intake、2个Ticket，无新增写入。

补充现场观察：A的“我的报修”列表没有出现B的报修，符合成员本人范围隔离。该观察与B侧打开A链接回到通用首页共同支持页面级隔离结论；B本人列表可见性仍按其自己的页面观察单独记录。

B随后提供“我的报修”页面截图：页面显示“已加载本人报修”，列出B自己的多条Web报修，其中包含“非报修事项”和“等待补充说明”，均未显示A的Ticket、A的描述或内部备注。该截图支持B本人列表可见性和跨成员列表隔离；截图中的opaque request ref只作为私有现场证据引用，不复制到公开报告。

原始受保护产物位于本次SS-011私有证据目录；本文件不复制原始内容。历史SS-009/SS-010证据不改写。
