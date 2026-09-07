# P2-012 固定通知与工作台

仅以下持久事件产生固定外部通知：confirmed 群/个人；investigating 个人；resolved 群/个人；closed 个人。候选、拒绝、Link/Unlink、范围纠正理由、Primary Ticket、内部备注都不外发。文本固定，只使用安全公共状态和范围，不复制内部摘要。测试运行必须带【P2-012测试】。

同 Event + audience + binding hash + template + version 只创建一次 binding。同群多个 reporter 只有一条群通知，同人多个 Report 只有一条个人通知。目的地按100条键集分页解析，事实在人工命令事务内追加到原 Communication Message/Outbox/Delivery。没有第二 Sender、Outbox 或 Delivery 表。

发送失败不回滚 Incident；发送 Worker 完全复用 P2-004/P2-016。UNKNOWN 保留 RECONCILIATION_REQUIRED，重启不会盲目发送。管理员核对通过原 Communication reconciliation port；CONFIRMED_SENT 不再发送，CONFIRMED_NOT_SENT_REQUEUE 才可重试。工作台只展示安全状态，不泄漏 raw target 或原始 Provider 错误。

原生工作台 /workbench/incidents 包含候选、活动和已完成队列；详情提供显式人工确认、负责人、来源报告、主参考、处理/恢复/关闭、范围修正、关联/解除、个人恢复和订阅暂停/恢复。每个变更表单必须显式选择 reason；确认 Incident 还必须显式选择 scope、owner、主参考（含明确不设置）和至少一个 report。Candidate 详情展示安全 Decision、版本、Evidence、来源关联和当前 Manual Review 状态。命令按钮在请求期间禁用；响应未知保留同一 Idempotency-Key 的核对重试。409 刷新，无乐观伪成功。登录失效清空视图。

复用内部 durable SSE；Last-Event-ID 和 Replay Gap 路径保持原权威，第33个连接进入轮询退路。Reporter 使用有界 polling。桌面1440×900、1366×768与移动390×844进行真实浏览器验证。

默认 INCIDENT_CORRELATION_ENABLED、INCIDENT_PUBLIC_NOTICE_ENABLED、INCIDENT_PRIVATE_NOTICE_ENABLED 均为 false。真实现场还要求 P2_012_LIVE_TEST_APPROVED、P2_012_TEST_SCOPE_CONFIGURED、P2_012_REAL_WECOM_SEND_APPROVED、P2_012_INCIDENT_PUBLIC_NOTICE_APPROVED、P2_012_INCIDENT_PRIVATE_NOTICE_APPROVED 全部明确 true。审批未齐前，live-check 在监听、Gateway、Sender 之前失败关闭。

P2-012-LIVE 的 Reporter 范围模式固定为 `APPROVED_GROUP_PARTICIPANTS`。专用测试群的 hash 是预先批准边界；人员 hash 可为空。群成员只有在带测试标签的群 Frame 已进入本次专用测试库后才成为可用 Reporter，其单聊 Frame 与 PERSON Delivery 还要按相同 raw identity 在数据库内匹配该群事实。范围检查同时覆盖 Intake 与 Delivery，既不把 userid 写进配置/Evidence，也不把普通群成员扩成全局发送 allowlist。

现场入口：npm run p2:012:live:check；通过并另获负责人批准后才运行 npm run p2:012:live。沿用三角色进程、单活连接、各池 max≤4，总配置含 controller≤8。不新增常驻 Incident Worker。至少900秒，记录 SDK ACK、客户端观察、数据库事实和负责人批准四种独立证据。组强提醒、HTTPS手机可达、fragment实际交换仍需真实客户端核验；发现 fragment 丢失立即停止。Runner 不自动标记 DONE、不自动生成第二提交、不推进 P2-G2。
