# P2-G2 发送防护与三角色准备验证

2026-09-08。本地合成准备，`IN_PROGRESS`，尚未READY。没有真实Provider发送、现场批准、Gate关闭或第二个候选提交。

## 已实现边界

- 继续使用现有P2-012动态Reporter范围、Direct Leg资格、P2-016卡片Grant和数值ACK Sender。新增Guard读取实际Delivery→Outbox→Message，验证SENDING、Bot/目的地/幂等键/消息体、留存期限、生成窗口、批准固定模板或批准坐席的精确人工回复。数据库查询异常保留异常/UNKNOWN语义，不伪装为永久无资格。
- 群模板在原Communication append入口持久化测试前缀后再计算消息hash；底层SDK不篡改已存正文。原入口默认append行为不变。没有前缀的群消息在Guard拒绝。
- 独立控制器初始化预算文件；Gateway只能打开既有文件。每次尝试先fsync RESERVE，之后fsync RESULT。预算包含群/人/总量，拒绝也消耗尝试额度；ACK/UNKNOWN/结果缺失不授权重发。跨打开/重启保留计数，冲突锁、损坏/缺失文件失败关闭。不在账本记录目标明文、正文或凭据。
- Manifest经深冻结快照后绑定预算；Owner文件除自身SHA、run和candidate之外还必须含完整`manifest_scope_sha256`，绑定目标、文案、预算、故障、flag、origin、数据库和有效窗口。Gate不会生成真实正向Owner批准。
- 三角色启动前要求专用空业务库、一个ADMIN及两个不同内部坐席，控制器持有独立PostgreSQL advisory lock，连接池上限1；App/Worker/Gateway池上限仍4/2/1。第二控制器不能启动，已含业务事实的库不能被当作新现场重新启动。正常停止销毁控制器会话并释放锁。G2子进程丢失所属IPC控制器时退出，避免孤立Gateway继续运行。

## 实际验证与保留失败

| 范围 | 实际结果 | 原始TAP SHA-256 |
|---|---|---|
| 初始预算与三角色装配 | 7/7，exit0；目录`tmp/p2-g2-tests-3492c9e2-b38b-46f4-bf9a-4d0d1d3bb200` | `da90aeee6b466a4974622c88001ab2347ae015521c9cf0d9f6df3ef10a0e1f68` |
| PostgreSQL Guard与Direct Leg首次联合 | 5/6，exit1；新增测试调用了不存在的deliverDueBatch，5项Direct Leg通过；目录`tmp/p2-g2-tests-8c431b15-37de-4b9d-924f-5c35539a7208` | `bb7b58ec32e6d45e47e16befac0d8a5f250f814df30757604a5a0f8dd6af7b04` |
| 改用实际runOnce接口后的Guard | 1/1，exit0；目录`tmp/p2-g2-tests-9bc4bf73-e481-4964-a1eb-fafe3becb84c` | `8e58debcee3e01a29fdaa86ad1e0bfaaf9cd7e204b40481c71b9bfca472fa3cc` |
| 空库/独占控制器加入后的三角色 | 1/1，exit0；目录`tmp/p2-g2-tests-16b756c8-b644-4a90-9bf3-58f85cbfcc51` | `7dda2a19f1a8aa04b4cbe733803bf3a11d1430d2d116fa10ff3edbae753cbda9` |
| 预算6、审批2、Guard1、三角色1、Direct Leg5联合 | 15/15，exit0，fail/cancelled/skipped/todo=0；目录`tmp/p2-g2-tests-24cbed32-d52b-40fd-aaae-03ce7fe4c9f7` | `b09dcc7d6ff77b8f7f973c1382ad860761a8caa6ccb102d97a6bcd6563539542` |

目录内`run.json`记录参数/源测试hash/退出码，`result.tap`是表中hash对应原文。所有Provider均为Mock；三角色及HTTP/浏览器、数据库为真实进程/实例。最后联合验证包括第二控制器拒绝、旧业务库拒绝、停止后四角色连接为0。隔离库清理断言通过。

独立Standards审查实测发现预算引用可被调用方原地扩容；已先增加失败反例（5/6），再改深冻结快照（6/6）。另保留“仅提及run/candidate的文件也被接受”失败反例，完整scope digest修复后2/2。Reviewer独立运行预算/审批8/8，限定Standards PASS；未冒充其独立运行本代理的数据库测试。

## 仍需完成

完整202条逐案验证、37行Gate场景、现场/观察/来源验证CLI及全仓回归未完成。当前live装配仍明确拒绝启动；测试结果不等同于现场客户端观察、真实2C4G持续60分钟或P2-G2 PASS。

后续停止前回归包含实际SDK前审批复核、媒体入口及critical安全Action修复，236/236通过，记录见`p2-g2-multi-turn-recognition-repair.md`。最新准备状态因独立确认的跨Intake聚合能力缺口改为BLOCKED_BY_DOMAIN_GAP；见`p2-g2-cross-reporter-correlation-gap.md`，不得沿用本文早期IN_PROGRESS快照当作READY。
