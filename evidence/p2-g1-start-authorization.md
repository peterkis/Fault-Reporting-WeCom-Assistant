# P2-G1 Start Authorization Evidence

- 授权日期：2026-09-01
- 授权角色：项目负责人
- 唯一活动 Gate：P2-G1 Human-only Conversation Center Assembly
- 固定基线：`1c18d5653b17e4368b5fa057d513e1af1a8b4622`
- 完成标签：`phase-p2-006-complete-v1.4`
- 当前分支：`phase2/gate-p2-g1-human-only`
- 当前 Lane：`ASSEMBLY`
- 数据库边界：无结构变更；migration 001 至 021 不修改，不创建 migration 022

## 启动核验

启动时工作树为空；HEAD、`origin/main` 与完成标签均解析为固定基线，`origin/main...HEAD` 为 `0 0`。仓库因 Windows checkout ownership 触发 Git 安全保护，核验命令只使用 command-scoped `safe.directory`，未修改全局 Git 配置。`npm ci` 成功。

## 授权范围

允许组装 P1 与 P2-001 至 P2-006 的 Human-only 链路，使用真实 PostgreSQL，实现持久投影协调器、真实测试 WeCom WSS Gateway、测试范围 Sender Adapter、受控 Test Authentication、Workbench/SSE/Worker Runtime、Health/安全指标和 Gate 工具。真实企业微信只允许在专用测试 Bot/群/账号、Target hash Allowlist 和一次性进程级批准变量同时满足时运行。

## 保持关闭与未授权边界

所有提交的 Feature Flag 默认值继续为 `false`。P2-007 及以后任务、AI Shadow/Copilot/AUTO、DeepSeek、Media/OCR、Incident、医院 SSO/内网、P3、24 小时正式 Soak、P2 全阶段 Go、生产/临床启用、最终生产 UI、push/merge/tag/release 均未授权。

## 证据边界

本 Evidence 只证明授权和启动前置条件，不证明 P2-G1 通过、真实企业微信入站/发送、客户端观察、真实网络故障、资源观察或项目负责人 Gate 批准。没有这些独立证据时终态最多是 `READY_FOR_LIVE_E2E`。
