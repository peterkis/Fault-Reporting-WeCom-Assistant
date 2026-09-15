# 医小修定向建单

授权来源：负责人要求启动 Bot，由 A/B 经群聊与私聊创建测试工单；在明确四案例、有限窗口、关闭真实通知发送/AI/Incident/完整 G2 后回复“允许”。

输入为当前 `.env.pilot` 已核验的 A/B Bot userid 与唯一测试群，云端使用已有专用测试数据库，不使用本地开发数据库 URL。输出为 A1/A2/B1/B2 各一个真实测试 Ticket、创建事件与只读 public_ref。

范围与关闭契约：ADR 0020；运行步骤复用 `docs/runbooks/yixiaoxiu-member-ticket-entry.md`。无迁移文件修改，无第二套 Ticket Core，无持久 Feature Flag 开启，无独立真实发送许可。

验证：公开配置/入站/启动器边界测试；隔离数据库证明并发与重启幂等、范围与配置拒绝、停止和故障原子回滚、通知/Grant/Incident 无新增。Spec、Standards 两轴发现已修复并复审通过；完整候选回归和现场状态以新增 evidence 文件为准。

保留基线 9aa2428c85fbd28d34eaf5a795be85046afc59a7，不改写冻结历史证据。实现及现场阶段未提交、push、merge 或 tag；现场后负责人另行明确授权提交、推送、创建 PR、等待 Codex 审查通过后合并并快进本地 main。

最终现场结论见 `evidence/p2-g2-yxx-targeted-live-summary.json`：四单创建、A/B 本人读取与相互拒绝、退出后新 OAuth 恢复已验证，49 张业务表摘要未变化。多标签因手机环境未执行，旧 Grant 卡片未执行，真实发送未授权；不等同完整 Gate 通过。临时 App/Gateway 已停止，原 nginx/OAuth-only 已恢复。
