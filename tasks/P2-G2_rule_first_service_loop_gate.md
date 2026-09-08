# P2-G2 规则优先、人工兜底、AI-off 完整服务闭环准备

- Status: IN_PROGRESS
- Lane: ASSEMBLY
- Authorization: `evidence/p2-g2-start-authorization.md`
- Base: `8c332710dad9b6cf3f6796f3344c04d1c710ddf3`
- Dependencies: P2-G1、ARCH-005、P2-007、P2-015、P2-016、P2-012。
- Stop: READY_FOR_LIVE_E2E；本轮仅授权、就绪候选两个本地提交。

## 输入与输出

输入为冻结 merge、Accepted ADR-0017、docs54、PR #6 十条 Review 原文/修复 Evidence、当前 Inbox/Intake/规则/工单/Incident/通知/Reporter 实现。输出为当前候选的链路盘点、场景/Review 映射、有限修复和 RED/GREEN 证据、受检自动化 runner、真实三角色合成闭环、严格现场许可、资源采样与只读对账/判定工具、候选清单及 PowerShell 手册。

Gate 契约分别定义运行清单、追加式证据和判定结果。每条证据绑定 run_id、候选指纹、场景、类型、上海时间、字符串 epoch、sequence 和源引用。UNIT_CONTRACT、POSTGRES_HTTP_INTEGRATION、SYNTHETIC_PROCESS_BROWSER、LIVE_WECOM_RECEIPT、CLIENT_OBSERVATION、RESOURCE_MEASUREMENT、PROJECT_OWNER_APPROVAL 分开记账；NOT_RUN/NOOP 不是 PASS。

## 必测路径

- 三入口经真实持久化、规则 Decision、Safe Action/Manual Review、唯一 Ticket；不直接 seed 成功核心事实冒充识别。
- 固定澄清、Ticket 通知、人工 Reply、Incident 通知的生成与发送私人资格；无 Leg 抑制、新 Leg 入站建立、旧事件不回补、后续新事件可通知。
- 冻结 202 金标和十类结果、禁止动作与 Provenance；人工审核可进入并完成。
- 全部既有 Ticket Action、双责任、12 路竞争、同 ID 重放、内部 Note 隔离。
- 候选产生/过期、人工确认/link/unlink/恢复、订阅保留期/重启/PAUSED 替换。
- 数值 ACK、UNKNOWN 核对、模板卡片/Grant、Reporter 新增/移除里程碑的完整刷新。
- App/Worker/Gateway 真实进程重启、DB/通知失败回滚、SSE replay/410/32+1/慢客户端。
- 必需业务 Flag 缺失失败、AI Key 移除、模型网络拒绝、零模型/OCR/RAG 调用。
- evaluator 对历史测试/旧现场、59分钟、缺2C4G、休眠/缺样、缺真实入口/人工处理/ACK、UNKNOWN、变更候选、无负责人批准全部拒绝 PASS。

## 数据库、安全与资源

无数据库结构变更。001–032 与 P2-007 冻结；只允许本 run 隔离自动化库使用现有迁移。所有真实发送在 SDK/写库/监听前要求独立 P2-G2 许可，旧 P2-012 许可无效。

保留既有权限、幂等、保留期、CSRF、隐私和稳定错误。日志不含原始身份、目标、密钥、连接串、IP/主机识别、SQL/SDK 原始错误。App/Worker/Gateway 各一进程，池上限 4/2/1；观测/迁移另计，SSE32、batch20、窗口50turn/20000字符、列表100。

## 准备完成条件

所有原577对应测试和新增矩阵通过，零失败/取消/跳过/todo；静态/治理检查通过。窄修复有实际 RED/GREEN；十条 Review 逐条绑定。工具无许可拒绝、所有手册命令和参数可验证；历史 Evidence/迁移不变，模型边界、清理和未验证环境如实报告。提交2后候选完整性通过且工作区 clean。

## 后续现场与关闭方式

本轮不进行真实发送/部署/现场写库/正式观察。现场另需绑定候选、范围、两个坐席和 ADMIN、至少三个 Reporter、2C4G 整栈/HTTPS/隔离DB、预冻结故障与预算、有效启动时段。最终须自然 GC 下至少60分钟有效业务观察、客户端确认、完整回归、清理和负责人批准。

关闭为停止本 run 所属进程并保持持久开关 false；不执行 down migration、历史投递删除/重放或广域清理。域缺口保留证据并 BLOCKED；P2-008 保持 TODO_BLOCKED_BY_P2_G2。
