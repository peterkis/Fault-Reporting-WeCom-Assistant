# 工单详情排版统一与紧凑化（2026-10-27）

状态：IMPLEMENTED_VALIDATED_AND_DEPLOYED。用户明确授权本轮发布后，于 2026-10-27 15:48（北京时间）部署完成，15:50 已刷新安装版客户端并确认进入工作台。详情文字角色直接接入主界面的 15px 工单标题、14px 正文/属性与 12–13px 辅助信息尺度，收紧行距及区块上下留白。沿已确认的单列结构，不改变业务操作或数据。唯一写者为本会话；修改前 CSS 保存在 `.local/electron/detail-compact-20261027/style-before.css`。

验证计划：一次统一构建、strict/负向类型、制品校验；已有 T11 完工、WEB01 详情和 T35 长记录阅读三个注册浏览器入口；实际编译页面的宽窄窗口、展开记录和完工表单检查；文档检查与差异检查。复用已关闭且身份已核对的自有 PG18，使用独立合成库，结束后恢复基线并关闭。

交付沿本会话 PC 部署授权：先核验线上 owner 与回退条件，再发布精确候选，保留现有业务数据、私有配置和上一版本，不创建真实试单或测试发送。必要验证失败、授权/身份漂移或保全失败时停止，保留实际失败与未执行状态。

## 已完成

- 详情直接使用主界面已有的文字角色，移除详情根节点的独立字号覆盖及桌面/窄屏各自缩放。实际页面对照：卡片与详情标题均 15px，主界面正文、详情属性/描述/记录/备注输入均 14px，卡片辅助信息与记录姓名均 13px，卡片与详情状态标签均 12px。主界面原样式字节保持。
- 正文及展开记录行距统一为 1.5；详情区块上下留白收紧到 12px。实际属性行高约 34px，普通记录行高从原 51px 收至 36px，记录点击区域仍为 30px。标题、头像、工具栏、沟通信息、备注与完工表单留白一并收紧，粗指针场景继续沿全局目标尺寸。
- 实际编译页面检查了宽屏抽屉、390px 抽屉/全页、展开长记录、内部备注和完工弹窗。字号在窄屏保持一致，无横向溢出。证据为 `.local/electron/detail-compact-20261027/wide-metrics.json`、`narrow-metrics.json` 及 `wide.png`、`records-note.png`、`modal.png`、`narrow-full.png`、`narrow-modal.png`；全部使用本地合成资料。
- 统一构建、strict/负向类型、制品校验通过。3 个既有注册浏览器入口 17/17 PASS、0 SKIP，包含完工 7 项、WEB01 9 项和长材料阅读 1 项；报告为 `C:/Users/zqpet/.codex/visualizations/2026/10/26/01a175d5-0e8f-7470-86e5-557a4f11de6e/detail-compact-test-report-1793086408999/01/summary.json`。原日志在本任务 `.local/electron/detail-compact-20261027/`，设计检测无发现。
- 与上一部署制品逐输入/输出比较，仅 `app/pc-admin/src/style.css` 的源输入变化，变更输出限于工作台前端；后端运行文件相同。差异原件见 `candidate-delta.json`。未修改业务命令、权限、数据库、持久 flag 或测试断言。
- 自有视觉夹具已关闭并清理合成库；复用的 PG18 52690 恢复四个基线数据库后停止，无剩余连接、进程或监听，见 `pg-closure.json`。文档工具 19/19 PASS；首次沙箱执行因创建测试链接得到 EPERM，保留 `docs-tools-sandbox.log`，获准在同一临时目录重跑后通过。

## 候选与部署

基线 HEAD `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加当前未提交差异；输入 SHA-256 `af7235a08040ee1cb1b9d7a610b2eb53c94ba9f9b5c03b7d7c46ceebd632e88d`，manifest SHA-256 `7034753864290424b125a69b2d743f38e8858af7d7cb4e68fba387f5fd18c7a1`，2663 份运行输出。

候选归档为 `.local/electron/deploy-detail-compact-20261027/pc-detail-compact-runtime.tar.gz`，SHA-256 `a48dc281becd852d74f87d6ccd2bd0648b5f8e3d9e9ede2f3530b075654e12f6`；同目录保存 `server-identity.json`、受控部署脚本与只读预检结果。预检时线上仍为 `human-workbench-20261027-pc-detail-font-01`，manifest `d0e25251b17cd2d4f284902ccbfe17b72c1aade1161c31d56a374205022dce74`。

自动审批曾在启动上传命令前拒绝本次上传，明确认为此前用户“继续”仅授权上一轮字号版本，不能延伸到本次紧凑排版制品；该次被拒绝的命令没有执行，也没有创建远端资源。用户收到具体部署问题后明确回复“授权”，随后重新只读核对线上 owner、配置及候选身份，按本轮授权完成上传与发布；原阻塞记录保留。

最终活动 owner 为 `human-workbench-20261027-pc-detail-compact-01`，运行目录 `/opt/fault-reporting-wecom/p2-g2/pc-detail-compact-20261027-01/runtime`。服务器隔离组件 42/42 PASS，31/31 ready；上一 owner `human-workbench-20261027-pc-detail-font-01` 正常停止并保留回退。42 份私有配置及 8 份媒体文件哈希保持，工单/资料/权限摘要与切换前一致；仍为 10 张工单、10 个入口材料、20 条媒体元数据、12 次通信投递尝试和 0 次通知投递尝试。没有新建真实试单、备注或业务命令，没有测试发送或数据库迁移。

安装版客户端仅在无详情和编辑器打开的看板上重载；刷新后已认证工作台正常，仍加载 7 项，无 JSON 错误页。没有为验证打开现场工单触发个人已读写入。客户端重载后的再次只读保全检查通过；本轮上传暂存目录已按身份与归档哈希清理。收据在部署目录的 `prepare-01.json`、`activate-01.json`、`postflight-after-client.json`、`cleanup-upload-01.json`，以及 `.local/electron/detail-compact-20261027/live-client-reload.json`。

本次未 commit、push、发布 PR、运行 full/certify 或推进任何 Gate。新版现场效果尚未取得用户验收。
