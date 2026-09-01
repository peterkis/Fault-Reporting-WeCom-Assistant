# 43. P2-G1 Human-only Conversation Center Assembly

## 目标与边界

P2-G1 把已完成的 P1 入站链路与 P2-001 至 P2-006 组装为 Human-only 验证闭环。Unified Ticket Core 继续拥有 Ticket 编号、状态、责任与事件；Conversation Timeline 是可重建读模型，Realtime Event Log 是可清理通知投影，Communication Message/Outbox/Delivery 是人工外发事实，只有 Delivery Worker 可以调用 WeCom Sender。

本 Gate 不创建数据库结构，不实现 AI/OCR/Incident/P3，不接医院 SSO/内网，不把 P2-006 Reference Client 宣布为最终生产 UI。

## 持久路径

```text
WeCom WSClient
→ P1 Frame Adapter / Channel Message Inbox / Service Intake / Unified Ticket Core
→ COMMIT P1 facts
→ P2-G1 durable projection coordinator
→ Thread / Session / Timeline Item + Realtime Event
→ Workbench Query / SSE
→ Agent Control / Communication Message / Outbox / Delivery
→ single Communication Worker
→ allowlisted test WeCom Sender
```

内部备注只进入 Communication Message、Timeline 与 Realtime，绝不产生 Outbox、Delivery 或 Sender 调用。投影失败不能回滚 P1；恢复从已提交事实、P2-002 Binding 与独立 Checkpoint 补放。乱序需要 Rebuild 时隔离单个 Session，不阻塞其他 Session。

## 真实测试保险丝

默认所有 Feature Flag 为 `false`。真实 WSS 必须同时具备 `P2_G1_LIVE_TEST_APPROVED=true` 与 `P2_G1_TEST_SCOPE_CONFIGURED=true`；真实发送再额外要求 `P2_G1_REAL_WECOM_SEND_APPROVED=true`。Target 必须来自持久 Delivery 且 target hash 命中测试 Allowlist；浏览器不能提供 provider、channel account 或 target。

Live Harness 要求 `P2_G1_TEST_PRINCIPAL_IDS` 至少包含两个不同的 active Pilot Principal，并为各 Principal 生成互相隔离的短期 HttpOnly Cookie/CSRF。Harness 只输出安全 `run_id`、loopback 地址、布尔 Readiness 与计数；Cookie、CSRF、Principal UUID 和原始 Channel/Target 标识不进入终端或 Evidence。Ready 后由当前进程通过 CDP 将短期 Cookie 注入两个独立临时浏览器 Profile，停止时关闭浏览器并清除经校验的临时目录。Inbound Shadow 的 Communication Worker 处于明确安全暂停状态，不能产生真实主动发送。

浏览器必须导航到 P2-006 冻结静态入口 `/workbench`，不得把 loopback 根路径推断为 Workbench。系统浏览器回归必须实际证明两个隔离 Cookie 会话均请求 `/workbench`，且没有请求 `/`。

P2-003 SSE 使用冻结的具名 `event`；Workbench 必须为全部冻结 Realtime Event Type 注册监听器，不能只依赖默认 `onmessage`。至少用 `conversation.item.created` 的真实 SSE frame 证明事件会触发列表与已选详情 refetch。Browser.close 必须有有界超时；下次 Live 启动只清理由失活 DevTools 端口证明不再使用的 `p2-g1-live-browser-*` 临时 Profile。

Live Browser 的计时 Evidence 只能记录冻结事件类型、`LIST`/`DETAIL`/`TIMELINE` 请求分类、HTTP 状态和毫秒时间戳；禁止记录 URL、`Last-Event-ID`、Session ID 或响应正文。通过 stdin `telemetry` 获取的安全快照用于对齐 SSE 收到时间与 Detail/Timeline refetch 完成时间。

真实 Ready 还要求 Projection backlog 为 0 且当前进程 Projection failure 为 0。相同参与者进入新的 Service Intake 时，Coordinator 必须在同一事务先以 `DIFFERENT_INTAKE` 结束旧活动 Session，再创建版本保持 1/1 的新 Session，从而满足 P2-001 单活动参与者约束；旧 Intake 的 Session 及 Timeline 仍保留。

## Gate 语义

自动化 Assembly 通过只证明实现可进入真实现场验证。真实客户端可见性、内部备注不可见性、重复为 0、SSE/Gateway 重连、资源观察和项目负责人批准是互相独立的 Evidence。任何一项缺失都不得标记 `PASSED/GO`。

当前自动化终态为 `READY_FOR_LIVE_E2E`。真实 WSS、真实 Sender、客户端观察和至少 60 分钟现场资源观察均未在本次执行；`P2-G1-LIVE` 仍须独立进程授权，P2-007 未授权。
