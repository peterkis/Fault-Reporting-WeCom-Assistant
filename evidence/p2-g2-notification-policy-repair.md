# P2-G2 通知频率与三入口修订记录

状态：PREPARATION / IN_PROGRESS。依据负责人 2026-09-09 的三种业务画像及通知修订，目标契约见 `p2-g2-three-entry-business-profile.md`。本文不宣布 READY、现场成功或 Gate 通过；未发送真实企业微信消息。

## 已实现与验证

- 默认单聊进度仅 `ticket.accepted` 与 `ticket.closed`；其他已实现节点通过服务端白名单显式配置，默认空数组。模板分别显示有人处理、处理完成，保留授权进度链接。App 和 Worker 从同一 G2 manifest 读取配置。
- 群内缺描述提示允许直接在群里补充；用户可全程群内报修、补充和人工 Reply，不依赖 Direct Leg。群内创建回执作为交互保留，自动进度只在最终关闭时发送；已具备 Direct 资格时使用私聊，不重复群推送。
- 群关闭经原群/原报修人及真实关闭事件绑定，复用 Communication Outbox/Delivery，通过单独 Webhook 传输发送文本 `mentioned_list`。拒绝把该模板通过 WSS 普通文本发送。未知结果沿原有待对账流程，重放不盲重发。
- 私有 Webhook 路由仅进入 Gateway 环境；公开 manifest 绑定群及规范化 URL 的哈希。正式启动还要求批准群均有路由。HTTP 前再次验证批准，沿用发送预算；URL 限定官方 HTTPS、禁止重定向、限制响应大小和超时。频率按持久 Attempt 保守计算每群每分钟 20 次。
- 独立标准审查发现原始 `provider_errcode` 丢失，已补充数字/null、稳定内部码、outbox、attempt 与结果的关联记录。G2 Gateway 写入私有运行目录 `webhook-receipts.jsonl`，追加哈希链及 fsync；不依赖被忽略的子进程 stdout，不记录 URL/key、群或 Reporter 原值。
- “打印机有问题”等当前 IT 故障先建最小工单，不等待用户补充。仍排除否定、假设、恢复、询问和非 IT 反例；不推断具体症状或根因。显式续接处理首部空白和测试标签时保留 opaque 引用大小写。

## 实际验证证据

`p2-g2-notification-repair-tests.tap` / `.json`：56/56，exit 0，TAP SHA-256 `cfb15354ff492dfdfd0156c473376613c4d498c591bcee5f67b0013dbf28c518`。覆盖既有节点显式配置、原通知来源、默认单聊/全群完整鉴权 HTTP 生命周期、重复命令、Webhook ACK/45009/93000/回执丢失、配置绑定以及识别反例。旧创建私聊源案例使用明确开启的 `ticket.created`，不把它写成新的默认行为。

`p2-g2-webhook-process-tests.tap` / `.json`：1/1，exit 0，TAP SHA-256 `0c5c2a2356550245f04288a65570abbf4bb2247ae8bdb6f21ff4d67d25f4ca36`。实际三个进程、隔离 PostgreSQL、HTTP 与浏览器，包含 Worker 停止/恢复、真实关闭事件至 Outbox/Delivery、模拟 Webhook 数字 ACK、发送预算及私有回执落盘。模拟发送不证明当前客户端收到原生 @；既有原生 @ 能力依据是 `g0-webhook-message-capability-matrix.md` 的历史现场确认。

其他实际定向验证：`tmp/p2-g2-tests-186974d5-7492-4639-8de4-bd176b3660db` 6/6（全群人工交互、标签续接、策略），`tmp/p2-g2-tests-cf3c6a95-b1b8-4f64-99ed-6605888b09d5` 2/2（初版完整生命周期及原 Reporter @）；隔离数据库及测试进程按 harness 完成清理。旧 policy-blocked 浏览器目录未触碰，不能由这些清理结果推导其已删除。

RED 与中间失败保留在 `tmp/p2-g2-tests-*`：`3f71786c` 默认节点 0/2、`e3d88964` 模糊故障未建单 0/2、`5904b9c9` 识别反例集 9/10、`1ca09afe` 群关闭通知缺失、`11b9e743` Webhook 发送适配缺失、`93087e39` 配置绑定缺失。`2e08a5d6` 是新增测试 JOIN 列错误，不能算产品 RED。原能力回归 `f48abd2b` 为 50/59，9 项均为旧默认假设；改为显式开启相应已有能力后通过上述 56 项验证，未删除原能力断言。

## 尚待完成

全部 Gate 来源案例、37 项矩阵与全量回归、配置/运行手册最终同步、冻结候选后的独立审查和唯一第二个本地提交仍未完成。群/Direct 资格在关闭及发送之间变化、重开后再次关闭、其他错误/限流分支需继续补验证。真实企业微信资料接口与授权内部资料展示不能用 Directory Simulator 通过替代；资料来源失败不得阻断受理。当前所有持久 Feature Flag 默认关闭，无真实发送、push、merge 或 Gate 批准。
