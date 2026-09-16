# YXX-SS-007 原生自助报修页面手册

本包提供固定医小修主页下的原生网页自助服务。页面由现有 OAuth/成员边界
保护，只有 `MEMBER_SELF_SERVICE` 或 `FULL_SERVICE_LOOP` 且两个持久开关都为
`true` 时才显示新建报修和我的报修动作。`MEMBER_TICKET_READONLY` 不会获得
写入口。

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
`sessionStorage` 保留版本化的 opaque command UUID，恢复查询不会自动重发正文。

详情页可见时每五秒最多发起一组 detail/timeline GET；隐藏、离页、退出或账号
边界变化会取消请求、清空敏感 DOM，并使用 generation fence 丢弃晚到响应。
补充使用当前输入版本，收到 `409` 时保留内存草稿并提示刷新。

回退时保持 `YIXIAOXIU_SELF_SERVICE_ENABLED=false` 或
`YIXIAOXIU_MY_REPORTS_ENABLED=false`。不要打开生产 URL、调用真实 OAuth/SDK、
发送消息、连接生产数据库、SSH、云端发布，或启动 `YXX-SS-011`、`P2-G2-LIVE`
和 `P2-008`。
