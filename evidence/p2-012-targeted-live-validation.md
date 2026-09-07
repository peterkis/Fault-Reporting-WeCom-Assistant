# P2-012 定向真实现场验证

- 当前状态：PASSED；真实企业微信客户端可见性已确认，负责人已批准，见 `evidence/p2-012-project-owner-approval.md`。
- 日期与时区：2026-09-07，Asia/Shanghai。
- Run：`fd4c9d42-dcae-4f63-acdb-7750c747390a`。
- Runtime 输入指纹：`55b89664e18c761d31b073fc2e279991e8543507b99ef55080d2ed9f6e2e6740`。
- 现场启动批准：`evidence/p2-012-live-start-approval.md`；资源和命令事件：`evidence/p2-012-live-e2e.jsonl`。
- 现场后完整回归：559/559 PASS，详见 `evidence/p2-012-post-live-regression-report.md` / `.json`。

## 范围

本轮只使用一个负责人批准的专用测试群、`【P2-012测试】` 合成描述和临时本机 PostgreSQL。Reporter 范围为 `APPROVED_GROUP_PARTICIPANTS`：配置人员 hash 为 0；带标签的批准群 Frame 先建立成员事实，随后同一 Bot/Reporter 的 direct Frame 和私人 Delivery 必须回查该事实与实际 direct leg。群外、无标签、无群事实或无 direct leg 继续失败关闭。

现场从真实入站中选择两名 Reporter 的 4 条报告，每人均有群报告和 direct Ticket；另有 1 名只发群消息的参与者没有选入 Incident。原始 userid、群 ID、消息正文和目标值没有写入本报告。

## 技术矩阵

- 原生管理员工作台显示冻结候选；开始审核后 Incident 仍为 0，明确确认后创建 1 个 `CONFIRMED_LOCAL` Incident，关联 4 条 Report、2 个去重 Subscription。
- Confirm：群通知 1、私人通知 2，均获显式 Provider ACK。
- Investigating：只发私人更新 2，均获显式 Provider ACK。
- 单个 Reporter 标记恢复后，Incident 保持 INVESTIGATING；订阅影响为 IMPACTED=1、RECOVERED=1。
- 第一次解除当前 Primary Ticket 的 Report 得到预期 409 `P2_012_PRIMARY_STILL_LINKED`；显式切换 Primary Ticket 后解除成功。原 Ticket=1、原 Intake=1 均保留，内部原因未外发。
- Resolve：群通知 1、私人通知 2；Close：私人通知 2。最终 Incident=CLOSED，通知绑定 10、SENT 10、pending 0、UNKNOWN 0、dead-letter 0。
- 同群多人公开通知去重、同 Reporter 多报告私人通知去重；解除关联 Ticket 的 Incident 里程碑 0，仍关联 Ticket 的公开 Incident 里程碑 4；时间线不包含内部 `INCORRECT_ASSOCIATION` 原因。
- 两个个人 Ticket 均未被 Incident 自动关闭。

## 独立投递核算

Incident 验收集合为 10/10 SENT，无 pending、UNKNOWN 或 dead-letter。与该 Incident 无绑定的本轮早期 Ticket/引导通知另有 9 条 SENT 和 1 条 PERSON dead-letter；该条属于未选入 Incident 的第三位只发群消息参与者，不计入 Incident 的 10 条通知，也没有盲重试、删除或改写。负责人最终批准时必须显式知悉该限制；如不接受，需要另行重跑干净现场。

## 观察、资源与清理

实际观察 `1,708,934 ms`（约 28 分 29 秒），112 个资源采样，达到至少 900 秒。三业务角色稳定在 3；业务角色 RSS 峰值 `227,713,024 bytes`，heap used 峰值 `58,059,280 bytes`；SSE 峰值 2，投影积压/失败与 Reconciliation 峰值均为 0，连接利用率采样峰值 7%。Gateway 有 1 次自动重连。CPU 瞬时峰值与启动期 gateway_authenticated=0 不冒充稳态失败；逐样本值保留在 JSONL。

停止时 controller exit=0，`fragment_lost=false`。现场数据库及 backend、三个角色进程、43112–43114 监听、三个浏览器 profile 和 5 个本轮敏感/辅助临时文件均清理为 0。合成现场行随测试库删除；脱敏追加 Evidence 保留。没有触碰其他应用或旧临时目录。

## 客户端确认与批准

原生工作台关闭态已由本地浏览器核验；Provider ACK 与数据库事实已完成。负责人随后明确确认：两次群公开通知均可见，两名 Reporter 各自的 Confirm、Investigating、Resolved、Closed 四次私人通知均可见。该客户端观察按负责人直接确认记录，不从 Provider ACK 推断。

负责人已明确接受独立非 Incident PERSON dead-letter，并批准本轮现场结果及收口。批准依据见 `evidence/p2-012-project-owner-approval.md`。完成态门禁通过后只创建唯一第二个本地提交；P2-G2/P2-008/P3 仍未启动，持久 Feature Flag 默认 false，不 push、PR、merge、tag 或 release。该现场不是 24 小时 soak、真实 2C4G 硬件认证、生产或临床上线。

此前两个旧候选运行保持原样：`33d681c4-91c3-4069-8c78-3aa14476d9d8` 因静态第二 Reporter 目标缺失而安全停止，`3b9eac4a-cc30-48d1-b782-ead9eead86fc` 未形成完成矩阵；两者不能抵扣本轮时长或改写为成功。
