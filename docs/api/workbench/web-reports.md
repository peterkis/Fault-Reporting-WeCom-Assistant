# 管理端网页报修资料

2026-10-28：可选的[PC员工媒体入口](employee-media.md)使用独立请求级权限；开启时media元数据增thumbnail描述，详情及列表权限仍沿本页。旧媒体HTTP入口的工单关联与逐块检查不变，关闭新开关可回退。

2026-10-28：启用后台压缩时，media 可带仅工作人员可见的 conversion_error；原件上传成功独立于转换结果。字段、缓存及原件回退见[头像与媒体合同](actor-avatars-and-media.md)。

ADR-0035 的工作人员消费支路，使用原 human-v1／P2-016 App HTTP 宿主、工作人员 Cookie／Bearer、当前 Workbench READ、同源 CSRF。成员 H5 身份不授予本页权限。源码装配入口为 `createWorkbenchWebReport`；运行开关默认关闭，`enabled` 控制读取入口，`progressEnabled` 单独控制新公开进度提交。关闭新写能力后，保持当前获权历史读取与原用途回执核对。

## GET /api/workbench/items/{kind}/{id}/reporter-profile

工作人员只读展示资料，无 query。ADR-0048的Ticket持久资料沿当前工单READ、会话与角色读取，并在返回前复核；不再依赖已过期或撤销的原Web入口。未进入该持久资料分支的原入口资料／实时目录回退，仍要求真实Web绑定及原留存。返回闭合 `{name,department,source}`；`source` 为 `REPORT_SNAPSHOT`、`CURRENT_PROFILE`、`RETAINED_PROFILE` 或 `UNAVAILABLE`。ADR-0048已持久保留的后续资料返回`RETAINED_PROFILE`，取得时间见卡片的`reporter_profile`，不声称是报修时或刚刚读取的当前资料。已有姓名或部门原快照时保持整份报修时资料；两项均缺失时，才允许通过原绑定的 `APP_OPEN_USERID`、相同应用/企业范围及 `applicationRecipientProof` 读取当前企业微信姓名和部门。等待目录读取后，再核验当前 READ 和原绑定。响应不含原始身份、手机号、证明或目录映射，不回写历史快照。未装配资料读取或缺少有效证明时返回空资料。前端注明当前资料，使用按当前员工、工单和授权版本隔离的独立内存 Query，staleTime 与 gcTime 均为五分钟，切换标签保留已读取资料，权限拒绝或退出仍清空；不阻塞看板，也不进入五秒业务轮询。并发相同报修人合并读取，最多32个待处理身份，provider保留既有超时和队列上限。

## GET /api/workbench/items/{kind}/{id}/web-report

`kind` 为 `ticket`、`review` 或 `intake`；不接收 query。沿原 canonical item 查询和当前 READ，按真实 Web Request 绑定及 Intake 留存返回闭合 `WorkbenchWebReportView`。非 Web 来源返回 `applicable:false`，不伪造媒体、人员资料或 Bot 消息。

返回当前 Ticket 版本、需要主动联系意图、本轮催单、报修人可见进度、预计完成时间、本轮评价和最多 8 项媒体元数据。元数据只包含受控引用、材料类别、类型、大小、时长、播放副本状态，不含文件路径、原始文件名、服务器素材 ID、内部备注或人员目录字段。媒体存储未装配时 `media_available:false`；暂时错误不代表没有资料。

`can_publish_progress` 只描述当前能力。实际提交会重新核验当前 READ、会话、角色、处理人及 Ticket 版本。ADMIN／DISPATCHER 的广域可读权限不能替代当前处理责任。

## GET /api/workbench/items/{kind}/{id}/web-report/media/{mediaRef}

唯一可选 query 为 `variant=PLAYABLE|ORIGINAL`，默认 `PLAYABLE`。引用必须与当前获权 Web Intake 绑定。读取后及每个输出块前重新核验原 canonical READ、真实工作人员会话、角色、来源绑定和留存；失权立即终止流。当前请求超时 60 秒，单并发，最多 20 MiB；不支持 Range，返回 416。

`PLAYABLE` 返回已规范化副本；副本尚不可用时明确返回 503，不将 AMR 原件当作通用浏览器音频。`ORIGINAL` 返回私有原件下载。响应包含精确类型及大小、`Cache-Control:no-store`、`X-Content-Type-Options:nosniff`；原件使用附件 disposition。界面只在显式点击后读取；关闭、导航、退出或可信失权时回收 Blob URL 和流。

## POST /api/tickets/{ticketId}/member-progress

同源写请求要求当前 CSRF、`Idempotency-Key` 等于 `client_command_id`、`If-Match` 等于带双引号的 `expected_version`。输入闭合为：

```json
{"client_command_id":"1b1f2c30-a051-4a44-8a2a-dc4b6467d7b1","expected_version":6,"summary":"正在更换网线","estimated_at":"2026-10-20 14:00:00"}
```

`summary` 为独立公开摘要，1–500 字符；`estimated_at` 为北京时间 `YYYY-MM-DD HH:mm:ss` 或 `null`。当前有效处理人明确确认公开内容后提交，不能复制内部备注。只对当前开放工单允许新写；Core 版本 CAS 与真实 `ticket.information_added` 事件在同事务追加，工单状态及处理责任不改变。预计时间为工作人员明确记录，不自动推导固定 SLA，不新增企业微信主动消息。

成功 200 返回 `WorkbenchMemberProgressResult`，包含原 UUID、实际 Ticket 版本与已保存进度。重复 UUID 和同正文重放不新增事实；更换正文或目标冲突。输入非法 400，当前权限拒绝 403／404，版本冲突 409，依赖暂不可用 503。超时或不可验证响应保持 UNKNOWN，不自动重试或换 UUID。

## GET /api/tickets/{ticketId}/member-progress/commands/{clientCommandId}

只读核对原工作人员、Ticket、UUID 和公开进度用途，当前 READ 与会话仍须有效，不要求仍为当前处理人或新写能力仍开启。返回 `UNKNOWN` 或 `COMMITTED`；没有回执不能解释为明确失败。只返回原用途公开结果，不暴露原命令哈希、内部正文或其他工作人员操作。

## 看板、提醒及关闭

已获权分页 Ticket IDs 通过 `activeForAuthorizedTickets` 批量读取 `web_report_urge` 投影；看板、列表、详情及搜索共用本轮标识。催单不修改优先级、状态或责任。本轮以 `ticket.current_handling_cycle_id` 为权威，完成或重开不沿用上一轮标识。

原站内提醒增加 `RELATED_REPORT_URGE`。只匹配保留期内原催单事实和精确 `YXX_H5_URGE`／`WEB_REPORT_URGE` 实时投影，并重新核验当前 READ、相关责任／关注集合、原成员绑定及当前轮次。原 baseline、不补响、跨标签去重、当前读取及显式定位语义保持。声音和桌面提醒仍由工作人员明确选择。

类型及输入／响应守卫：`contracts/workbench_web_report_contracts.d.ts`、`src/workbench-web-report-browser-contracts.mts`。相关测试：`tests/yxx-h5-admin-contracts.test.mts`、原 T16 附件与 T40 提醒测试；具体候选的 HTTP／DB／浏览器实测以本次 Evidence 为准，单元通过不代表实机、现场或 Gate 验收。
