# P2-001 Conversation Contracts 验证 Evidence

- 日期：2026-08-30
- 基线：`origin/main` 提交 `0ac71269c0da8a6ee55bb2f96e3d293c57c0e398`
- 本地分支：`phase2/p2-001-conversation-contracts`
- 结论：`P2-001 / DONE`

## 授权与范围

本次只完成 ARCH-004 和 P2-001。P2-002 及以后、P2-G1、真实外发、SSE、Handoff、Read Cursor、Assignment、模型调用、AI Shadow/Copilot/AUTO 行为、OCR、媒体存储、Incident、P3、生产或临床上线均未实施。

## 交付核验

- Thread 自然身份包含 provider、channel account、chat type 和 external thread key；单聊、群聊及多 Bot 不冲突；
- 群聊 Session scope 同时受 Thread、参与人、Session 和可空 Intake 边界约束，不跨用户共享；
- 新 Session 默认 `HUMAN`，所有 Feature Flag 保持关闭，`AUTO` 只保留枚举且失败关闭；
- Session 创建同幂等键、同规范化输入返回原记录；同键不同输入返回稳定冲突，结束后的历史 Session 重放也不新建；
- `conversation.thread` 与 `conversation.session` 是本迁移唯一新增关系；Conversation Item 仅冻结契约并明确保留给 P2-002；
- Service Intake 仍是引用事实，Conversation 不复制 Ticket 状态；
- 对外错误为稳定码，不包含原始数据库错误或外部标识。
- 公共 Workbench Session 视图不包含 participant key、scope digest 或创建幂等键。

## 自动化验证

- `npm run test:p2:001`：13/13 通过；
- `npm run test:p2:001:integration`：1/1 通过；使用随机命名隔离数据库，验证完成后只清理本次资源；
- `npm run validate:architecture:v1.4`：通过；
- `npm run test:architecture:v1.4` 与定向 G0/P1 回归：通过；
- 全量本地无真实外部依赖回归：228 项、156 通过、72 项按环境条件跳过、0 失败；P2-001 数据库集成已由上一项单独实际执行；
- `git diff --check`：通过。

## 安全与隐私

- 未修改 `.env.pilot`；
- 未在命令输出或 Evidence 中记录 Secret、数据库密码、Bot ID、用户 ID、群 ID、患者信息或数据库连接地址；
- 未调用真实企业微信、模型、医院内网或生产/临床依赖；
- 未提交、推送、合并或发布远端。

## 状态结论

P2 保持 `IN_PROGRESS`，P2-001 已完成，当前无活动实施任务。P2-002 保持 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`，所有 P2/P3 Feature Flag 为 `false`。
