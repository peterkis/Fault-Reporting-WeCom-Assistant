# P2-G2 现场证据入口与来源核验

本项沿用持续缺口授权，仅完成现场前工具。没有执行真实企业微信发送、正式60分钟观察或负责人关闭批准。

## 实现范围

- WSS数字回执在实际SDK边界捕获，与真实Delivery、Outbox及attempt绑定；0、明确拒绝码、UNKNOWN分开。失败持久化不允许推断“未发送”后盲重试。既有群Webhook回执增加物理时间。
- 控制器在真实空业务库检查、三角色ready、模型隔离和主机检查后记录START/ENV源包。资源/启动/停止/故障控制/对账包都绑定完整manifest摘要及run_mode，合成证据不能重标为live。
- `observe`读取控制器已有采样；`capture:G2-…`使用既有controller连接进行只读中间快照；`reconcile`在停机后读取专用数据库。不会启动第二个采样器或第九个业务连接，也不修改业务状态或重发。
- 对账保留必要的通知源事件/版本/受众/模板、Message/Outbox/Delivery/attempt引用和安全状态，不输出身份、消息正文、URL凭据或SQL错误正文。私人资格复用既有共享Authorizer，包含批准群动态Reporter与真实Direct Leg。
- 人工观察、清理声明和负责人批准由本人提供文件；工具只核对绑定与保留片段，再编译记录。ACK不能成为客户端观察，也不能生成负责人批准。
- `evaluate`运行既有纯判定器并核验实际来源。合成测试依据必须是当前完整runner/TAP、202来源审计和绑定矩阵的独立审查；最终回归与前置回归分别记录。场景、资源、送达、人工观察、对账、清理及负责人证据不完整时不能PASS。

## 独立复核发现与修复

第一次来源审查指出两项可复现问题：成功Delivery可以随意贴到其他场景；获准动态Reporter被显式hash列表误判。共同RED保存在 `tmp/p2-g2-tests-cdb0303f-9281-48c4-a854-ec54f2cb8661`，3项中2项失败，TAP SHA256 `85ec032c52ab254d27128ef69e0fb0b39cf0286821d1644d9dbc81154bac3096`。初步GREEN `tmp/p2-g2-tests-7adb6fae-b09b-45bd-a131-ac1fbc82d05d`，3/3，TAP SHA256 `077927540e0be02049678e7501803eba3538de4d0c49b1e3b3f8bd82e2ab91a6`。

场景核验现按实际数据分支：Ticket受理/接受/关闭事件、固定澄清Action、群转单聊图、分段数量、消费过的卡片Grant、完整Ticket状态路径、同Incident人工关联/解除、特定上报人恢复及其他人仍受影响。N03必须另有当前候选的Mock故障测试依据，不能冒充真实WeCom UNKNOWN；F01必须有实际断连/恢复控制包、同Delivery在断连期的未发送失败attempt和恢复后的数字ACK。允许共享证据的范围限于这些共同源事实，不能仅凭scenario_id赋予PASS。

F01实际三进程控制包及attempt补测最终通过 `tmp/p2-g2-tests-40e4b27f-48f6-495f-850e-52e31ecba2e6`（1/1，TAP SHA256 `3b89bd75f3ac41cf86884aa883dcc78b198bace4574358aba08d9df74d664a4a`）。该版本验证Gateway断连时已持久Ticket可经浏览器接单、待处理通知恢复后只调用一次Mock SDK，重复入站不重发。它不是现场WeCom证据，也不是最终候选完整回归。

## 测试方法修正与限制

失败run保留：早期将F01/F02叠在一起触发全部角色ready等待；一次进程验证与候选编辑重叠，不能用于候选验收；浏览器仅改hash没有reload；同秒Timeline查询误用CHANNEL_MESSAGE而非USER_MESSAGE；新增订阅页面使用错误mode。均修正测试方法，没有扩大超时或删除所需断言。

原Reporter浏览器夹具为了验证Grant机制，显式启用可选`ticket.created`通知，适应负责人要求的默认仅接单/关闭通知。旧保留期故障夹具使用LEAST保留原reported_at，避免固定历史来源与当前日期相差多天时违反时间约束；没有修改生产保留时限。

完整候选、37行矩阵、独立最终审查和唯一就绪提交仍以最终readiness报告为准。本文件不批准现场、不关闭Gate。
