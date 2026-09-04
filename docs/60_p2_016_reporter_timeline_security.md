# P2-016 Reporter 时间线与访问安全

这不是医院 SSO、强实名、最终生产门户或临床身份认证。它是受控测试的单工单绑定访问会话；不把尾号、Ticket UUID、外部 userid、chatid 或 URL 参数当作授权。

## 访问过程

1. 事务内为 Ticket 创建 24 random bytes（192 bit）的 opaque public_ref，唯一约束负责冲突。
2. 每个个人 Delivery 有一个独立 Grant，绑定 Ticket、Message、Delivery、Reporter binding hash、用途及有效期（最多 30 分钟）。数据库仅保存 HMAC 重建材料、nonce 和 token hash，不存 raw token。
3. Sender 在出网边界重建 48-byte opaque token；卡片 URL 仅允许批准的 HTTPS host，token 放 fragment，不放 query。测试可显式允许 loopback HTTP，此例外不得用于现场。
4. Reporter 页面读取 fragment 后立即 replaceState 清除，再用同源 JSON POST 交换。Grant 行锁与终态保证一次性消费；错误、过期、撤销或重复 token 统一拒绝。
5. Server 生成 32-byte session token，仅 hash 入库，使用 `HttpOnly; Secure; SameSite=Strict; Path=/api/reporter` Cookie，TTL 最多 24 小时。不写 localStorage/sessionStorage，不向响应 JSON 回传 Cookie token。
6. 所有 Reporter GET 再检查 active Session、公用引用状态、到期与精确 Ticket 绑定。Reporter 没有任何 Ticket 写动作；返回只读安全摘要和允许的里程碑。

首次 fragment 丢失绝不降级为 query token、Ticket UUID 或尾号授权。真实企业微信客户端不保留 fragment 时，任务必须 BLOCKED，等待新的安全设计或明确决策。

## 最小暴露

详情只含 opaque ref、完整展示编号、尾号、固定标题、外部状态、创建/更新时间、版本和固定引导。时间线仅含固定中文里程碑、opaque event ref、local datetime 与稳定排序信息。内部备注、自由 external_note、处理人身份、患者数据、IP、Review、规则详情、Provider 原始错误与 token 均不外发。

Reporter API 不复用 Internal Workbench Session/SSE；客户端仅轮询 GET（5 秒、单个 in-flight、隐藏页面暂停），GET 先认证后 ETag/304。无身份时不能通过已知 public_ref 读取。退出确认后停止轮询并清屏；网络错误不伪称退出成功。

严格 CSP、no-store、no-referrer、DENY framing、无通配 CORS；写入要求 JSON、同源 Origin 并拒绝 cross-site。query credential 拒绝；限长、闭合键、UUID/版本检查在业务操作前完成。后台 ADMIN 可通过受限 Port 撤销 ref/grant/session，并追加审计；该 Port 不开放给 Reporter。

## 存储与关闭

Migration 031 的 reporter_public_ref、reporter_access_grant、reporter_access_session、reporter_access_event 使用原 Ticket FK；没有第二个 Ticket Core。时间成对约束由 offset-free timestamp 和 BIGINT epoch 保证。关闭 `REPORTER_TIMELINE_ENABLED` 即拒绝公开路径；HMAC 缺失时启用失败关闭。更换 HMAC 会使未消费旧 Grant 不可用，不伪装成平滑轮换。

自动化必须覆盖：12 路一次性交换、错误/过期/撤销、跨 Ticket、HttpOnly、fragment 清除、刷新、三时区、XSS/CSRF/无敏感数据。真实客户端点击、无 fragment 丢失以及负责人批准仍是独立现场门禁。

Internal Workbench origin 与 Reporter HTTPS origin 是独立配置：内部测试身份只在 loopback 使用，Reporter 请求按 `P2_016_REPORTER_ORIGIN` 做 Origin 检查。HTTPS 代理仅开放 Reporter 路径，配置步骤与现场停止线见文档 61。
