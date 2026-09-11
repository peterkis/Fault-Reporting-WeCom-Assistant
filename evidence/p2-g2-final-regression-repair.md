# P2-G2 全仓回归发现与修复记录

本项仍属准备阶段；无真实WeCom发送、现场通过或负责人关闭批准。

## 保留的全仓失败

首轮当前全仓run为 `tmp/p2-g2-tests-6fd65afc-94dc-4eba-a89e-7ed9b11a6c4c`：Node24.18.0，Windows10.0.26200/x64，150个测试文件，948项、935通过、13失败，取消/跳过/todo为0。源候选 `d662826a8a704e2b58cd200afa388398131542c5bfdac6d33ddc18418b4067ea` 在运行期间未变化。TAP SHA256为 `9beb09ca8e933f99f341e952e12349b7f12fb1b10db5a6571d5753f95a5c73f3`；失败原文保留私有tmp，不复制SQL错误正文到报告。

Reporter390x844的实际失败栈位于browser.close的profile清理等待；随后runtime.stop被异常跳过。该测试子进程超过90秒用例时限后仍残留HTTP监听，在无匹配数据库连接、无浏览器子进程的情况下未退出。按PID/父PID/具体测试命令复核后仅终止该测试子进程，主回归继续并最终exit1。该人为中断不能算通过。诊断记录为 `tmp/p2-g2-preparation-20260908-01a07e70/full-run-stalled-reporter.json`。

## 业务缺陷

1. 同秒入站：Session.started_at采用投影处理时钟，但Direct选择器要求started_at不晚于源消息received_at。处理跨秒时12个正常Frame被分成12个Intake，sequence均为1。把测试接收时刻固定在处理前2秒强制跨秒，原12Frame/重复回调/唯一Ticket断言保留；实际RED `749f65f1-04d4-4d84-a9dd-b8ee19a405c0`（0/1，TAP `28ad606bba518320a399f45e0125e663e5b0ad62ae4f567ace8e303a582db8d4`）。修复新投影Session的started_at显式取原创建消息received_at，活动epoch仍取原接收epoch，不改已存历史、不扩大空闲窗口、不改消息顺序。GREEN `a7899dbf-5791-41de-af81-9982dba2158e`（1/1，TAP `47979e822aa49f9e7366929f3d9b687c8554ded760fa1ea6a716a48b0f7940cc`）。独立审查也在真实隔离PG复现了同一时间倒置。
2. 群回执幂等：已有GROUP binding查重错误地依赖可选personDestinationAuthorizer被注入。无该参数的既有装配重放同Event会触发唯一约束。查重现独立于可选Authorizer，既有PERSON先查重、群制品自然键和不回补旧私人卡片均保留；没有清理旧Delivery或放松私人资格。

## 测试夹具适配与资源关闭

- 负责人已批准私人默认只接单/结单。旧Reporter HTTP、500卡片容量、Delivery Control、Manual Review、Orchestration、Reporter Grant及notification-delivery机制夹具仍依赖ticket.created来建立待验证制品；现仅在这些夹具显式opt-in该事件，保留500/5000/200/500/100/32等原容量、全部幂等/安全断言和超时。群回执文案断言同步“群内补充、单聊可选”，私人制品零生成要求不变。
- 旧Workbench模拟query缺少新增reporterContact方法，导致详情整批请求失败。补充明确DEFERRED的合成响应，保留实际按钮/双责任/表单竞争断言；真实PG联系资料验证另有独立用例。
- Browser harness仍限定本次profile的DevTools端口和唯一匹配页面；Reporter显式允许/reporter/open到/reporter/的同源路径变化（实际路径无空格）。启动发现/连接增加有界取消；未返回browser对象前失败也清理已创建资源。先等待Browser.close正常退出再强制结束本进程，不扩大既有profile删除时限。
- 清理助手依次执行所有owned关闭步骤；原业务断言和清理失败一起保留为AggregateError。Reporter、相关G2双浏览器/三进程夹具及公共G2 runtime夹具不会因前一关闭异常跳过后续HTTP/Worker/进程关闭。没有忽略cleanup失败或使用test-force-exit。

## 现场工具可操作性

逐场景独立ACK和人工源编译后超过20个stream；拼接会破坏各自hash链。CLI与evaluator允许最多64个独立stream，65个仍拒绝，源文件及原hash不变。来源审计对候选语料/裁决文件采用UTF8_LF规范化，与候选算法一致，避免Windows CRLF与Linux LF交接导致语义相同但READY审计不一致；原TAP/证据文件hash仍逐字节校验。两项共同RED `331f20fb-d56c-49b3-a33c-dd88a9f08748`（45/47，TAP `0b070be4adc434e51b121dd84fbdccf80a7ba8e866dfcd15be63b92dd6adb47d`），GREEN `10d2d7d6-7b92-428f-8aa0-8d6fc265ee27`（47/47，TAP `0f30835930cca5af093f8d759d9cf486e99abca605b4e44be3fe285f3fc8a4c5`）。

当前文件记录修复原因与定向结果，不代表最后全仓回归通过。完整候选、源码来源审计、37行矩阵、两个独立最终审查及提交2由最终readiness报告绑定。

最终第二轮完整回归 `e7e8038b-3c23-406b-b8a8-ac6b5da55098`：954/954、151文件、所有失败/取消/跳过/todo为0，候选17ebc9bc8862b88c1405663b57d290155086ff6cefa2bbae2ab26ac25f3ee54c运行期间未变。TAP `884e95b112b4cb42d7e2e4841256c7f5c149957ea282b2f51dc715eb2e0de3dc`。原scope-candidate夹具另显式opt-in ticket.started验证新Leg后的可选通知；实际前轮3cc268ab为10/11，修正后bf5c1b54为4/4，原私人资格断言不变。
