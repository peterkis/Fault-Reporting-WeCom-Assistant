# P2-012 自动化就绪报告

- 状态：READY_FOR_TARGETED_LIVE_VALIDATION；记录时间 2026-09-07 11:29:40，Asia/Shanghai。
- 范围：合成、离线自动化；真实企业微信现场未运行，负责人现场批准未取得，第二提交未创建。
- 基线：30a394e85973f5a300b841b23d2c358998796ba6；唯一授权提交：f8d29caf50816ab90f3debf14995085158460784。
- 最后完成任务仍为 P2-016；活动 P2-012 / P2-D；下一步 P2-012-LIVE，next_task_authorized=false。P2-G2/P2-008/P3 均未推进。

## 实现与 Contract

实现独立 CandidateReview、人工确认 Incident、IncidentReport、ReporterSubscription、命令收据、追加事件和通知绑定。现有 Ticket、Conversation、Communication 与 Sender 保持各自权威。人工确认、四种 scope 权限、同命令12路并发重放、版本冲突、Link/Unlink/relink、主参考 Ticket、订阅与可靠单聊渠道、个人恢复隔离均已验证。

原生 /workbench/incidents 使用现有认证、CSRF、API 与 durable SSE；所有列表有界。Reporter 继续使用一次性 HMAC grant 和绑定 session，只看到仍关联本人 Ticket 的四类固定里程碑；ETag 随 Incident/Unlink 变化。闭合 JSON Schema、TypeScript 与 OpenAPI 已同步。

## 验证与冻结输入

最终完整回归：559/559 PASS，exit=0；fail/cancelled/skipped/todo 全为0；耗时 669.5 秒。命令为 node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs。

代码与契约输入共 427 个，回归前后 hash 相同：

`55b89664e18c761d31b073fc2e279991e8543507b99ef55080d2ed9f6e2e6740`

原始结果：[final-regression.tap](p2-012-final-regression.tap)；逐文件 hash：[validated-candidate-inventory.json](p2-012-validated-candidate-inventory.json)。READY 元数据另经内存预演和4种反漂移探针验证，不伪造 P2-012 DONE、最后完成任务、Gate 或现场授权。

首轮回归发现4个后继兼容问题：SSE词汇表断言/监听器，以及 P2-015 current-baseline 仍假定无 Incident 表。已保留旧词汇并加入本任务值，将后者修正为零自动 Incident 事实断言。P2-016 既有完成证据按固定完成提交核验；未改写历史 Evidence。第二轮发现容量用例不持续读取 SSE 的测试负载问题，现改为持续消费，原容量与慢客户端关闭限制均未改变。

## 数据库、恢复与资源

032 仅新增七张业务表，135 列、241 个约束、28 个索引；新增 Trigger/持久 Function/Extension=0。001–031 和全部 P2-007 Runtime 原样保留。fresh current-baseline、031升级、check回滚、重复apply/status/check及6类catalog drift拒绝均通过；原配置现场数据库未迁移。

真实领域命令构造 500 Candidates、200 Incidents、2000 Reports、1000 Subscriptions、5200 Events、550 Notification bindings。模拟发送 550 条，全部送达。SSE 32可用，第33个有界轮询退路。单池 max=4；heap峰值 65.48 MiB，结束 16.51 MiB。

真实子进程验证提交后丢响应重放、Worker发送中崩溃、UNKNOWN重启不重发、明确核对后一次重试、ACK后重启不再发。离线三角色复用现有 APP/WORKER/GATEWAY，未新增常驻 Incident Worker。停止后测试数据库、后端连接、子进程、监听和 SSE 均为0；测试进程退出收回所属 Timer/Socket，最终只读审计池已关闭。这不是24小时soak或真实2C4G硬件认证。

定向现场 Reporter 范围使用 `APPROVED_GROUP_PARTICIPANTS`：只预配批准测试群 hash，不要求人员 userid/hash；带测试标签的群事实持久化后，同一 Reporter 的实际单聊与 PERSON Delivery 才可通过数据库回查。群外、无群事实或无 DIRECT leg 继续失败关闭。

## 安全与来源限制

认证/授权先于收据；停用坐席不能凭旧收据恢复访问；HANDLER个人恢复必须负责对应Ticket。固定通知不复制原文、患者、IP、内部备注、原始身份或Provider错误。自动Incident、自动Link、并单/删除Ticket、Incident驱动Ticket状态变化、模型/OCR/RAG/真实WeCom调用均为0。

历史 P2-015 safe_result 未保存完整聚类摘要。缺失计数、窗口、cluster hash 与 first/last_seen 显式为 null，界面显示“来源未提供”，scope建议UNKNOWN。没有补造统计或重新聚类。完整P2-007结果可经可信适配器追加新Decision，旧Decision/hash不变。

ADR-0015 的5分钟与冻结Runtime的120000ms差异已记录，本任务未校准阈值。详见 docs/63_p2_012_candidate_review_link_unlink.md。

## 现场停止线与关闭

三个持久 Incident Flag 均默认false，全部P2/P3默认开关false。现场需独立批准并同时具备5项P2-012熔断授权；至少900秒，至少2名真实测试Reporter，SDK ACK、客户端可见性、数据库事实、负责人批准分开记录。群强提醒、HTTPS手机可达和fragment实际交换仍待现场核验。

当前不运行现场、不创建第二提交、不push/PR/merge/tag/release。关闭方式是保持Flag=false并正常停止原有角色，保留追加事实，不执行破坏性down migration。

完整机器记录：[automated-readiness-report.json](p2-012-automated-readiness-report.json)。实现契约见 docs/62–65，浏览器截图见 p2-012-browser/。
