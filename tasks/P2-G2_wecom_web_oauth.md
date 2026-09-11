# 医小修企业微信网页授权

状态：DONE（2026-09-11 网页认证限定范围：用户确认客户端认证成功，服务端成功回调及成功页各 1；不沿用旧候选的 954 项就绪结论，不推进 G2 Gate）。

输入：用户指定 HTTPS 回调 `https://cd3120.mobimedical.cn/wecom/yixiaoxiu/callback`，以及本地提供的企业微信文档 96440–96443。应用凭据仅在服务端配置。

输出：`/wecom/yixiaoxiu/login` 发起 snsapi_base 授权；回调使用一次性 code 获取本企业成员身份；`/wecom/yixiaoxiu/` 展示认证状态。内部身份端口只供后续本人工单权限校验，认证成功本身不授予工单、员工工作台或业务写权限。

Contract：固定回调和成功地址；随机 state 绑定浏览器 HttpOnly Cookie，5 分钟过期、一次消费；code 最大 512 字节、不重试；非企业成员和跨企业身份拒绝；服务端会话 15 分钟过期。原始 userid、code、token 和供应商错误正文不进入页面、日志、证据。

数据库变更：无。单 App 进程内有界会话，重启全部失效，重新认证；不建立第二套身份或 Ticket 事实源。待授权事务和会话各最多 1024，提供商请求并发 1、超时 5 秒、响应上限 64 KiB。

Feature Flag：`wecomWebOAuth.enabled` 默认 false。可由现有 HTTP 组合启用；在完整 App 仍停止时，`scripts/p2-g2-wecom-oauth-serve.mjs` 提供同仓 OAuth-only 启动模式，环境开关 `WECOM_WEB_OAUTH_ENABLED` 默认 false，作为唯一 App 进程运行。该模式不连接数据库、不提供业务 API。关闭或重启即撤销内存身份会话；不打开 Gateway、发送、AI 或内网 Connector。

2026-09-11 用户确认 `APP_SECRET` 是本企业医小修应用凭据，并提供 97164 文档。令牌使用服务端 gettoken 获取、按 expires_in 缓存及提前刷新，失败有 30 秒重取保护；只有 40014/42001 清除健康缓存，code 永不自动重试。云端真实 gettoken 已返回 errcode=0、expires_in=7200。云端部署只启用此认证入口，原 G2 业务部署保持停止。

验证：在身份提供商端口及真实本机 HTTP 边界验证跳转、Cookie、state 篡改/跨浏览器/重放/过期、单次 code、成员拒绝、错误脱敏和关闭态。真实企业微信客户端认证另行记录；模拟验证不等同于现场完成。

边界：该 URL 在本任务中是 OAuth GET 回调，不实现事件 URL 校验或加密消息 POST；工单主页与卡片归属联动仍需独立验证。保留 P2-G2-LIVE 及其他 Gate 停止线。证据记录于 `evidence/p2-g2-wecom-web-oauth.md`。
