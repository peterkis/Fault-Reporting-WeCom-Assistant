# P2-012-LIVE 定向真实现场启动批准

- Task：P2-012-LIVE；批准日期：2026-09-05（Asia/Shanghai）。
- 批准来源：当前任务中的项目负责人明确批准 P2-012 定向真实测试和五项现场熔断；本文件在现场结束后补录该启动授权，不伪造用户消息的精确时间。
- 后续范围修正：负责人明确要求专用测试群中的普通成员无需预配个人 userid/hash，由带测试标签的真实群 Frame 建立本轮 Reporter 范围；该修正已在 2026-09-07 的最终运行中采用。
- 批准群：1 个专用测试群；批准人员 hash 数：0；模式：`APPROVED_GROUP_PARTICIPANTS`。
- 合成标签：`【P2-012测试】`；只允许批准测试群、其已持久化参与者、同一 Bot 和相同 Reporter 的实际 direct leg。

## 五项熔断批准

- `P2_012_LIVE_TEST_APPROVED=true`
- `P2_012_TEST_SCOPE_CONFIGURED=true`
- `P2_012_REAL_WECOM_SEND_APPROVED=true`
- `P2_012_INCIDENT_PUBLIC_NOTICE_APPROVED=true`
- `P2_012_INCIDENT_PRIVATE_NOTICE_APPROVED=true`

以上值只在本轮临时进程配置中启用；持久 `.env.example` 与默认 Feature Flag 继续保持 false。授权包含真实企业微信测试发送、公开群通知和两名测试 Reporter 的私人通知，不包含生产/临床、P2-G2、P2-008、P3、push、PR、merge、tag 或 release。

该启动批准不等于现场结果验收或 P2-012 DONE。现场仍须至少 900 秒、Provider ACK、真实客户端可见性、数据库核验、现场后完整回归和负责人对结果的再次明确批准。第二提交只能在这些条件全部满足后创建。
