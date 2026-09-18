# YXX-SS-007 原生自助报修页面手册

当前本地验证以 `evidence/yxx-ss-007-current-readiness-v32.json` 为准。
原始报告保留作历史记录；任务仍等待当前提交的外部审查。
时间线默认显示最近100条，按按钮逐页加载更早记录；下一次轮询回到最新窗口。
未知提交结果最多自动查询五次，之后可点击“查询上次提交结果”继续查询，
查询始终为GET；早期404不会清除原命令或自动创建新命令。
恢复重试只绑定原命令、页面代次和成员恢复范围，不绑定写请求用的 CSRF；
同一成员的 CSRF 轮换不会中止剩余重试，达到五次后仍可手动继续查询。
单次请求及正文读取总计最多15秒；超时视为结果未知，保留命令ID并进入有限查询。
隐藏页面或切换身份引起的取消不会启动旧命令恢复。
HTTP 200/202 不单独证明提交成功；响应正文和回执必须有效并匹配原命令，
否则保留原命令ID，继续有限查询恢复，不自动重交。

恢复标记升级为 `{v:3,id,scope}`：`scope` 是 bootstrap 返回的
`recovery_scope`，不是 Cookie、CSRF 或原始成员身份。相同 scope 下 CSRF
轮换不会解除未知命令的围栏；新成员的 scope 不同时清除旧成员的标签指针，不删除其持久记录。
服务端必须提供稳定且仅服务端持有的 `recoveryBindingSecret`（至少32字节），
并通过受保护成员上下文提供 canonical binding 与 corp/app scope。
重启时不得随机生成新密钥；轮换密钥前须单独处理尚未确认的命令。

本包提供固定医小修主页下的原生网页自助服务。页面由现有 OAuth/成员边界
保护，只有 `MEMBER_SELF_SERVICE` 或 `FULL_SERVICE_LOOP` 且两个持久开关都为
`true` 时才显示新建报修和我的报修动作。`MEMBER_TICKET_READONLY` 不会获得
写入口。
原生写页面、bootstrap 和两个 POST 还要求认证上下文明确给出
`write_flag=true`；false、缺失或字符串值均返回 403，不提供写页面。
既有只读 API 继续由成员查询边界校验权限。命令恢复 GET 不接受查询参数，
任何非空查询字符串均返回 400，且不会进入其他处理器。
命令恢复路径先按前缀接管，再校验完整 UUID；缺失、畸形或额外路径段返回
400，404 仅由既有成员命令查询表达未知命令。

原生入口与既有 OAuth 回调统一使用 `__Host-wecom_session`；构造器拒绝其他会话 Cookie 名。
HTTP 浏览器夹具仅在测试服务器边界转换合成 Cookie，不改变生产 Cookie 配置。

## 本地验证

```powershell
npm.cmd run test:yxx:ss:007
$env:PILOT_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/yxx_test'
npm.cmd run test:yxx:ss:005
npm.cmd run test:yxx:ss:006
```

SS-007 的浏览器测试启动本机 Chromium/Edge，使用临时 HTTP 服务、临时会话
Cookie 和合成适配器；它验证页面、状态文案、表单、补充、XSS 安全、响应式
和多会话隔离，不代表业务闭环已接入真实数据库。SS-008 必须继续使用隔离
PostgreSQL，把页面接到已有规则、人工审核和 Unified Ticket Core 后再做业务
验收。

## 运行与关闭

页面资源是 `web/p2-reporter/self-service.html`、`self-service.css` 和
`self-service.js`。POST 只接受同源 JSON，并要求服务端下发的 CSRF；响应 `202`
带真实 `request_ref`，页面不提前生成工单号。网络结果未知时，浏览器只在
`localStorage` 按命令分别保留版本化的 opaque UUID 和恢复 scope；每个恢复 scope
最多20条有效 v3 记录，其他 scope 或格式无效的记录不计入该限额；
`sessionStorage` 仅指向当前标签的命令。关闭标签后重新打开可查询原结果，
恢复查询不会自动重发正文。满额时阻止新提交，不删除其他未知结果。
恢复记录写入失败或读回不一致时停止提交，不发送 POST；恢复存储可用后再由用户提交。
页面重新初始化时先清除并隐藏受保护内容，核验失败时保持隐藏。
可见页面的定时会话复核先隐藏受保护视图。即便已有提交、详情读取或
恢复请求占用操作，定时器到期也立即
隐藏整个受保护内容容器，等待请求结束及会话核验；不会因此取消业务提交。
已到期的核验在当前请求结束后优先执行，初始化流程不得提前解除遮蔽。
只有确认同一 `recovery_scope` 后才恢复原视图和内存草稿。超时、网络或服务端错误会清空
内容并保持隐藏，成员变化则重新初始化当前路由。
同一成员复核成功后恢复原输入控件的焦点、选区及方向；如果用户已把焦点
移到其他控件，则尊重其选择。失败或成员变化时不恢复旧焦点。
详情页以纯文本显示服务端的 `needs_action` 和 `safe_clarification`；空值、
详情失效和会话清理均会移除旧提示。
详情信息同时显示服务端的 `safe_location`，空位置显示“未提供位置”；
位置按纯文本处理，并随其余详情信息一起清理。
退出会先清空成员内容并停留在终止页面，不自动返回会触发认证的主页。
退出失败会明确提示；重新认证必须由用户主动操作。未知提交的恢复记录在退出后保留，
同一成员重新登录继续查询，其他成员的恢复范围不匹配时清除当前标签指针，但不删除其持久记录；不保留表单正文。
退出会通过同源 BroadcastChannel 和 storage 事件广播固定的 `v1/logout` 标记，
不携带命令 ID、恢复范围、Cookie、CSRF 或表单内容。其他打开标签收到后立即清空
保护内容并进入终止页面，监听不会再次广播或启动认证。
输入草稿仅暂存于当前调用内存；同一 `recovery_scope` 且重新核验成功后恢复，
CSRF 轮换不改变该 scope；scope 变化或核验失败不恢复。正文不写入浏览器存储。

列表、详情与时间线显示原 Ticket Core 状态的既有对外中文语义，不改变工单状态。
详情页可见时每五秒最多发起一组 detail/timeline GET；隐藏、离页、退出或账号
边界变化会取消请求、清空敏感 DOM，并使用 generation fence 丢弃晚到响应。
补充使用当前输入版本，收到 `409` 时保留内存草稿并提示刷新。
退出接口沿用既有 `yixiaoxiu_error.schema.json` 的 `YXX_ENTRY_*` 错误命名空间；
非法查询、正文或内容类型统一为 `YXX_ENTRY_INPUT_INVALID`，来源校验为
`YXX_ENTRY_ORIGIN_INVALID`，其他失败按既有入口错误映射处理。

回退时保持 `YIXIAOXIU_SELF_SERVICE_ENABLED=false` 或
`YIXIAOXIU_MY_REPORTS_ENABLED=false`。不要打开生产 URL、调用真实 OAuth/SDK、
发送消息、连接生产数据库、SSH、云端发布，或启动 `YXX-SS-011`、`P2-G2-LIVE`
和 `P2-008`。
