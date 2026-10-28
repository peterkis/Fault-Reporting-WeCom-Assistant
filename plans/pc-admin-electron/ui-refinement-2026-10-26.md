# PC 工作台界面与局部刷新修补

性能后继：本页664→321次SQL、约4.5–5→1.9秒是当时的中间结果。后续已完成真正的整页集合查询、固定查询次数检查和发布，最终测量见[看板性能修复记录](board-performance-2026-10-26.md)。本页其余被测对象与历史证据保持原身份。

日期：2026-10-26（Asia/Shanghai）。承接用户对桌面工作台的七项修改要求。执行基线为 `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加当前工作区；本轮未提交或推送，不把基线提交称为本次完整被测对象。

当前状态：**PASS_DEPLOYED_AND_INSTALLED_CLIENT_UI_VERIFIED**。最终本地回归、实际 Electron 进程和服务器切换均已完成。用户本人确认已扫码登录后，已在本机 0.1.2 原生前台窗口核对当前姓名、部门、H5 卡片及设置面板；该项确认独立于合成账号检查。

## 可见行为

| 用户要求 | 实现 |
| --- | --- |
| 避免重复品牌 | 删除页面侧边栏的 logo 和“医小修”，沿用客户端标题栏品牌。 |
| 清理主内容区头部 | 移除连接状态文字和旧管理端链接；连接状态仍供内部恢复逻辑使用。 |
| 提醒偏好放入设置 | 侧边栏“设置”打开声音、桌面提醒及试音设置；窄窗口保留可见设置入口。管理员来源群名称入口移入同一设置面板。 |
| 当前登录人姓名和部门 | 通过当前已验证的企业微信员工身份读取展示资料，独立查询，不替代工作台权限和角色配置。 |
| 抽屉周期闪烁 | 沿用 Query、SSE、Zustand；已有资料的后台读取不再把控件切成首次加载或反复禁用。首次加载、真实错误、权限失效及命令版本校验分别处理。 |
| 卡片报修人资料 | 卡片显示姓名和部门，移除位置及“位置未提供”；详情继续保留原位置资料。 |
| H5 来源标签 | PORTAL 来源显示“H5报修”。 |

报修资料优先使用报修时的姓名及部门快照。历史 H5 报修缺少快照时，只在原报修人身份绑定和签名证明有效、当前会话仍有 READ 的条件下读取当前企业微信资料；界面注明当前资料来源，查询前后均核验原绑定及读取权限，不回填历史快照，不返回身份密钥、手机号或签名证明。新增 GET 见[账号资料](../../docs/api/platform/auth-health.md)和[H5 报修资料](../../docs/api/workbench/web-reports.md)。

## 刷新、草稿与查询边界

健康后台读取保留 DOM、焦点、输入和媒体控件；真实 READ 失败仍阻止新写入，401/403/404 沿原边界清除不再获权的敏感展示。SSE 提示只触发获权 GET，既有五秒权限复核、断网恢复和 UNKNOWN 原操作核对合同保持。

清空草稿时先等待本页正在进行的加密保存结束，再删除其最终版本。其他标签页写入的较新版本仍受原 revision/epoch 保护，不通过重试覆盖。新增真实浏览器竞态用例覆盖加密未完成时点击清空、零残留副本、零业务 POST 和刷新后空白。

50 卡片场景暴露重复 schema readiness 检查：664 次数据库查询，首屏约 4.5–5 秒，可能被原五秒截止中断。关注投影现在在一个有界读取批次中共享结构检查，每个事项仍读取当前 principal、canonical READ 和 anchors；写入、CAS、回执复用前的校验不变。相同合成场景降至 321 次查询、约 1.9 秒，浏览器首屏约 2.2 秒。此为本机样本，不代表生产性能承诺。

## 原始证据与保留的失败

- 抽屉 RED：4 次详情读取、22 次控件启用/禁用变化；修补后的同场景为 0 次变化、0 次节点移除。原件 `.local/electron/logs/drawer-repro-red-valid.log` 与 `drawer-repro-green-first.log`。
- 首批 24 个相关注册入口保留在 `D:/CodexEvidence/workbench-ui-20261026-1793007572354/`，其中 20 个入口通过、4 个入口存在失败。后继 8 入口在 `D:/CodexEvidence/workbench-ui-final-20261026-1793008957625/`；不得把后续 PASS 改记到这两个旧候选。
- 失败包括小屏设置入口的 CSS 优先级、设置弹窗被旧通用 dialog 选择器误选、已删除连接文字的旧断言、恢复草稿自动保存与清空的真实竞态，以及双标签页测试意外制造较新草稿冲突。
- 提醒恢复用例曾对重复的 visible 值等待一个并不存在的环境转换；后继依据已建立的 leader baseline 检查，实际隐藏、接管和恢复断言保留。
- 原始草稿竞态固定复现残留 1 份副本，修补后为 0；见 `.local/electron/logs/draft-discard-red.log`、`draft-discard-green.log`。
- 查询测量分别见 `.local/electron/logs/board-query-profile.log`、`board-query-profile-batched.log` 和 `locate-diagnostic-batched.log`。首次索引查询改写未单独解决重复 readiness 开销，这一中间结果保留。
- 桌面集成首次在 WebContentsView 截图时返回 `Current display surface not available for capture`；等待绘制帧的尝试又触发诊断清理超时。测试驱动改用宿主窗口截图，并为退出时的诊断截图设 1.5 秒上限，后继完整交互通过。失败收据为 `ui-refinement-desktop-capture-red.tap`、`ui-refinement-desktop-frame-wait-red.tap` 和 `ui-refinement-desktop-command-retry.log`。窗口级 PNG 只覆盖标题栏宿主，不将它当作完整业务画面证据。

## 最终验证与发布

最终制品 manifest SHA-256 为 `303405e60ac49ea0fb25607d524ecb2e38745adda2848f079d97ce5e06866091`，输入 SHA-256 为 `d7d656a68d9de226d3f2964549a90b159144fa369429ad6baeb978397cdfe865`。来源为上述基线加工作区，`source.dirty=true`；880 个 typed 源、351 个保留 legacy 源、2648 份运行输出。最后一次仅修正默认关闭 SSE 的旧测试断网断言；性能测量候选与最终候选的生产输出完全相同，差异仅为该测试文件，见 `.local/electron/logs/ui-final-production-equivalence.json`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 最终构建、strict、负向类型 | PASS | `.local/electron/logs/ui-refinement-build-delivery.log`、`ui-refinement-types-delivery.log` |
| 12 个相关注册入口 | 45/45 PASS，0 FAIL/SKIP | `D:/CodexEvidence/workbench-ui-closeout-20261026-1793010849469/01/summary.json` |
| 制品完整性 | PASS，2648 份输出 | `.local/electron/logs/ui-refinement-artifact-delivery.log` |
| 指令文档预算与本地链接 | PASS | `.local/electron/logs/ui-refinement-docs-check.log` |
| 实际 Electron 进程 | 1/1 PASS，3 个合成正式员工会话 | `.local/electron/logs/ui-refinement-desktop.json`、`ui-refinement-desktop.tap` |
| 最终视觉确认 | 1440/900 两种宽度通过；设置面板 560px，无横向溢出，焦点在模态内 | `.local/electron/logs/ui-refinement-visual-final.log`、`ui-refinement-visual.json` |
| 本机本人登录后确认 | PASS，当前姓名/部门、H5 报修人资料、标签和设置入口已核对 | `.local/electron/deploy-ui-20261026/client-ui-verification.json` |
| 最终抽屉固定探针 | 4 次 GET，0 次禁用状态变化、0 次节点移除 | `.local/electron/logs/drawer-repro-green-final.log` |
| 服务器隔离组件 | 28/28 PASS，0 FAIL/SKIP；断网且未挂载真实配置 | `.local/electron/deploy-ui-20261026/prepare-01.json` |
| 切换及独立读回 | PASS_ACTIVATED / PASS_POSTFLIGHT，29/29 ready | 同目录 `activate-01.json`、`postflight-01.json` |
| 自有资源关闭 | 4 个初始库、0 其他客户端；PG 已停止，52679 监听 0 | `.local/electron/logs/ui-pg-closure.json` |

12 个入口覆盖基础卡片及来源、H5 历史资料和等待后权限校验、关注语义和 10 项风险检查、完整页面交互、7 项完工及草稿检查、跨标签页清空/失权/隔离，以及提醒恢复和超过首个 50 项分页的定位。它们是按本次影响选取的子集，不称为活动全集或 full/certify。

发布包已冻结为 `.local/electron/deploy-ui-20261026/pc-ui-runtime.tar.gz`，8159095 bytes，SHA-256 `62049d6d1c33ad7e18e5e7a3095c66447a6e9ca80352f0a6be8b174af572a071`。仅按 manifest 白名单打包，不包含配置、密钥或 node_modules。第二次只读预检确认旧实例仍为 `human-workbench-20261026-pc-desktop-01`，29 项 ready，受理 10、工单 10、媒体记录 20；原件 `.local/electron/deploy-ui-20261026/preflight-02.json`。

冻结之后仅修补不进入服务器运行树或客户端安装包的桌面测试驱动，并通过独立 desktop strict 检查。服务器 manifest 和运行输出未因该测试驱动修补而重绑；实际 Electron 检查使用冻结的正式页面与当前测试驱动，安装包仍为原 0.1.2。

## 部署、保全与本机确认

2026-10-26 18:56:56 完成切换。唯一活动工作台实例为 `human-workbench-20261026-pc-ui-01`，运行目录 `/opt/fault-reporting-wecom/p2-g2/pc-ui-20261026-01/runtime`；独立读回确认 0 restart、无 OOM。旧实例 `human-workbench-20261026-pc-desktop-01` 正常停止并保留，切换前后 systemd 单元及回退脚本保留在新发布目录及本地私有发布目录。

- 42 份配置、8 份实际媒体文件逐文件哈希相同，原 nginx 配置保持。
- 受理 10、工单 10、媒体记录 20，通信投递状态和通知记录前后相同；26 条迁移回执及 SQL checksum 一致，本次未执行迁移。
- 桌面入口 302 到企业微信扫码页，匿名 API 仍为 401；当前 H5 页面及前一代 H5 资产均为 200 且匹配对应哈希。
- 实际 Electron 合成检查覆盖当前姓名/部门、200/409 并发接单、转交第三人完工、隐藏通知及通知点击定位、锁屏状态、服务器关闭提醒能力和身份停用。Windows 实体通知中心送达未据此记为人工通过。
- 本机已安装客户端保持 0.1.2。用户本人完成扫码后，已核验侧边栏显示当前姓名和部门，已获权的 H5 卡片显示报修人姓名、部门及“H5报修”标签，卡片位置占位和重复品牌均已移除；头部不再显示旧管理端或实时连接文字。设置面板已打开查看并关闭，未切换偏好、未试音、未操作工单，应用保持在工作台。
- 一条标记“来源资料不可用”的历史工单仍缺少报修人姓名和部门。缺乏有效资料来源时继续显示未提供，不推断或回填历史业务记录。脱敏核验收据只保存检查布尔值，不保存真实人员姓名、工单正文、Cookie 或认证查询值。

测试用 PostgreSQL 18 集群已按 PID、创建时间、程序路径和数据目录校验后停止。原进程消失、端口关闭；停止后的合成数据、历史失败日志、可复用工具和发布回退文件保留，不称为全部文件已删除。

本轮服务器切换沿用户此前对 `cd3120.mobimedical.cn` 的具名 PC 配套授权，保留现有业务数据、配置、媒体及回退版本，不新增真实试单或测试发送。客户端仍使用已安装的 0.1.2；本轮页面改动不要求重装客户端。full/certify、远端 CI/审查、其他电脑及现场业务闭环不由本地定向验证补记通过，既有 Gate 停止线保持。
