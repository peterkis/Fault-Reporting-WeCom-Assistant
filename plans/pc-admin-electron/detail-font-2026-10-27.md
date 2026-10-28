# 工单详情字号调整（2026-10-27）

状态：IMPLEMENTED_VALIDATED_AND_DEPLOYED。根据用户要求，工单详情及其弹窗各级文字缩小 2px；不改看板字号、业务行为或既有数据。2026-10-27 15:13（北京时间）部署完成，15:14 已刷新安装版客户端并确认进入工作台。保存修改前 CSS 原件于 `.local/electron/detail-font-20261027/style-before.css`，保留其原有未提交改动。

验证计划：对照修改前后的实际编译页面，检查宽、窄窗口及完工弹窗各层级文字；运行一次 migration:build、strict 类型和制品校验，并按已有合同运行必要的注册浏览器入口及文档检查。使用自有 loopback PG，不建立真实工单、不发送通知。测试完成后关闭自有资源。

部署沿本会话具名 PC 配套部署授权；切换前核对当前运行版本和配置，保留业务数据与前一回退版本。测试失败、身份漂移或保全检查失败时停止发布并保留结果。用户对实际效果的验收与技术检查分别记录。

## 已完成

- 标题、属性、正文、来源、处理记录、内部备注、附件、关注说明及完工/附件弹窗均按原值减小 2px；窄窗口使用相同幅度。各尺寸与公共令牌的覆盖限制在详情根节点，工作台看板保留原字号。
- 在正式编译页面、隔离合成工单上逐项比较 20 个详情文字角色：均减小 2px；看板列标题维持 14px。390px 抽屉与全页模式无横向溢出，完工表单可完整使用。原值、新值、截图和窄屏测量分别见 `.local/electron/detail-font-20261027/font-comparison.json`、`before.png`、`after.png`、`after-narrow.png`、`after-narrow-modal.png` 和 `narrow-metrics.json`。
- 基线 HEAD `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加当前未提交差异；最终输入 SHA-256 `210fca1233048218f07cd110c618bf63136fafcff0e7b5826b9a66bf696b145b`，manifest SHA-256 `d0e25251b17cd2d4f284902ccbfe17b72c1aade1161c31d56a374205022dce74`。构建、strict/负向类型及制品校验通过，原始日志保留在本任务 `.local/electron/detail-font-20261027/`。
- 3 个已注册浏览器入口共 17/17 PASS、0 SKIP，覆盖详情、完工和长记录的可见范围与已读；原件为 `C:/Users/zqpet/.codex/visualizations/2026/10/26/01a175d5-0e8f-7470-86e5-557a4f11de6e/detail-font-test-report-1793084458520/01/summary.json`。设计检测无发现。
- 自有 PG18 的隔离合成库已清理，52690 端口的进程和监听已关闭、基线库列表恢复，见 `pg-closure.json`。首次在受限环境启动的未完成隔离库已核验无进程和监听后清理，保留初始化日志与 `partial-pg-closure.json`。

## 保留的问题与后续处理

- 第一次浏览器回归的报告目标位于源码目录，被注册工具按 `MIGRATION_REPORT_MUST_BE_OUTSIDE_SOURCE` 拒绝，3 个入口均未执行；已保留 `tests-first-attempt.log`，并改到另一工作区目录重跑取得上述 17/17 PASS。首次从沙箱连接本机 PG 得到 `EACCES`，经允许的隔离本机连接重新执行；不将前置失败当作通过。
- 本轮首次服务器只读预检通过，当时活动 owner 为 `human-workbench-20261027-pc-detail-01`，31 项 ready。自动审批两次拒绝启动向 `cd3120.mobimedical.cn` 上传候选制品，理由是未能从本轮可信用户指令确认该次上传与目标站点的授权；两次被拒绝的上传命令均未执行。用户获知拦截后于 15:11 明确回复“继续”，随后再次核对线上身份，并获准完成上传及部署。保留此前阻塞事实，不将被拒绝的命令重记为执行成功。
- 已校验候选归档 `.local/electron/deploy-detail-font-20261027/pc-detail-font-runtime.tar.gz`，SHA-256 `5bedb813248782e45baabb099c6d09ae939c6c8e5d7cf90d31db8776c065dab6`。42/42 服务器隔离组件检查通过后切换到 `human-workbench-20261027-pc-detail-font-01`，31/31 ready；上一 owner `human-workbench-20261027-pc-detail-01` 已正常停止并保留回退。42 份私有配置、8 份媒体文件、工单/资料/权限摘要和投递计数保持一致，没有新增真实试单、业务命令或测试发送。
- 安装版客户端仅在无详情和编辑器打开的看板上重载，重载后已认证工作台正常，仍加载 7 项，无 JSON 错误页。未为验证打开现场详情或写入个人已读。客户端重载后的再次只读保全检查通过；本轮远端上传暂存目录已按身份与哈希清理。收据见 `prepare-01.json`、`activate-01.json`、`postflight-after-client.json`、`cleanup-upload-01.json` 及 `.local/electron/detail-font-20261027/live-client-reload.json`。
- 本次未提交、推送、发布 PR、运行 full/certify 或推进任何 Gate；尚无用户对新字号的现场验收结论。
