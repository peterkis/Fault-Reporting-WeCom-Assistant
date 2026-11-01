# PC 管理端设计系统 v2 · 发布审查入口

2026-11-01（Asia/Shanghai）。本页汇总卡 0–7 的完整交付范围。此前各卡的“本地、未提交”及失败/NOT_RUN 记录仍是当时的真实状态；本次用户另行授权提交、推送、创建 PR、循环审查、通过后合并与有界分支清理，不改写旧 tested head。

## 改动与边界

- 原始色板、语义 Token、HeroUI 桥接统一在 `app/pc-admin/src/design/tokens.css`；兼容别名已移除。
- PageHeader、Toolbar、EmptyState、Button、状态/来源/头像、看板、抽屉、属性、时间线、会话、Table/Form/Modal 由 `src/design/components/` 组合。主线 `style.css` 从 693 行成为 7 行入口，仍使用的布局按组件归属保存。
- Stylelint、CSS 变量检查和功能层 ESLint 进入现有 types gate；主按钮区域计数进入活动 selection 的原浏览器测试。新增包均为开发依赖，无运行时依赖增加。
- API 提示文案沿卡 6 已批准的通俗化文字；错误码、404 模糊边界、请求与权限语义保持。没有数据库迁移、Ticket 状态、命令/查询、草稿、UNKNOWN、实时或持久 Feature Flag 变更。

## 可访问的四宽截图

以下均为任务自有 loopback HTTP/PG18 的合成数据，不是现场或用户接受证明。前图来自卡 0 的原始生产 bundle，后图来自卡 7 最终视觉候选；不同夹具运行的合成编号、日期和相对时间可能不同，不能把整图像素差解释为逻辑变化。各图大小与 SHA-256 见 [manifest](design-system-v2-evidence/manifest.json)。

| 宽度 | 卡 0 原画面 | 卡 7 统一后 |
| ---: | --- | --- |
| 1920 | [前](design-system-v2-evidence/board-before-1920.png) | [后](design-system-v2-evidence/board-after-1920.png) |
| 1440 | [前](design-system-v2-evidence/board-before-1440.png) | [后](design-system-v2-evidence/board-after-1440.png) |
| 1280 | [前](design-system-v2-evidence/board-before-1280.png) | [后](design-system-v2-evidence/board-after-1280.png) |
| 900 | [前](design-system-v2-evidence/board-before-900.png) | [后](design-system-v2-evidence/board-after-900.png) |

## 已有本地证据

卡 0 的 Stylelint 基线为 600 条，后继 591、515 和卡 2 起的 0 各自保留原候选。最终 43 份 CSS 中原配置忽略独立登录页 2 份，实际 41 份零违规；ESLint 实际检查 88 份功能 TS/TSX 零违规。

卡 7 的最终本地检查为：构建/完整 strict/制品通过，新增约束正反例 2/2，相关注册浏览器子集 57 入口、124/124 PASS。42 入口的 88 项检查属于视觉候选 `329aa70271d13a0de84353bd3db944342bc8464b9fa97c880b0bb4abbf0c11a8`；15 入口在仅修改两份退回测试后的候选 `90da27946cdd80379218f056dae74a064facf6d47d98fb9b34b3a91a16335923` 实际运行。2735 个其它产物逐字节一致，未把前继结果改称后继重跑。

原始本地记录位于 `D:/CodexEvidence/pc-admin-design-v2-card7-20261101/`，包括 `validation-delivery.json`、`artifact-equivalence.json`、`integrity.json`、原失败、TAP、截图、清理和原件位置映射。它们是本地可取回的证据；GitHub 审查的可访问图片见上表，最终发布 head 的 CI 与审查以 PR 的实际回执为准，不用本地结果冒充远端通过。

登录挂绳翻面与 Unicode 长查询各出现一次等待超时，原样复跑通过；未改产品、测试断言或超时，不能称偶发问题已修复。退回测试的旧“属性表状态”选择器已改为实际标题状态，并真实展开原协作区；原请求、责任、事件、版本、受众及 UNKNOWN 断言保留。

本卡受众文字采用已有 secondary 满足必读文字对比度，与规范 §6.9 的 tertiary 写法存在已记录差异；没有新增视觉值。自有 PG 与浏览器已关闭，中间可再生副本已清理。各卡详细证据与自检见 [卡 0](design-system-v2-card0-baseline.md)、[卡 1](design-system-v2-card1-token-foundation.md)、[卡 2](design-system-v2-card2-literal-convergence.md)、[卡 3](design-system-v2-card3-page-skeleton.md)、[卡 4](design-system-v2-card4-information-components.md)、[卡 5](design-system-v2-card5-ticket-drawer.md)、[卡 6](design-system-v2-card6-conversations-and-pages.md)、[卡 7](design-system-v2-card7-cleanup-and-enforcement.md)。

## PR #127 审查修补

首轮 `@codex review` 对发布 head `2623fd0d41d0b341d687ae8a44a4d325f1be8728` 提出一个 [P2 附件预览尺寸问题](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/127#discussion_r4434748018)。实际生产 bundle 复现高度 32px、水平内边距 12px；专用媒体卡片选择器恢复原 170px / 窄屏 145px，内容容器填满预览区，普通操作按钮仍使用原组件规格。

同类真实 VOICE 夹具发现原 30px 按钮中图标容器只剩 4px；改用现有图标按钮与控制尺寸 Token，并固定图标内容盒，最终按钮 32px、图标及容器均为 16px。播放/下载/进度、请求及失权清除逻辑没有变化。

新增几何断言覆盖图片/视频、转换失败后原件和语音图标：媒体六宽 1920/1440/1280/900/600/390，语音三宽 1280/600/390。实测图片/视频与原件字节、旧路由回退、缓存头像和存储提示的原断言保留。

| 媒体场景 | 审查前 | 修补后 |
| --- | --- | --- |
| 1280px | [32px 复现](design-system-v2-evidence/media-before-1280.png) | [170px](design-system-v2-evidence/media-after-1280.png) |
| 1920 / 1440 / 900px | 同一普通按钮覆盖规则 | [1920](design-system-v2-evidence/media-after-1920.png) / [1440](design-system-v2-evidence/media-after-1440.png) / [900](design-system-v2-evidence/media-after-900.png) |
| 600 / 390px | 同一普通按钮覆盖规则 | [600](design-system-v2-evidence/media-after-600.png) / [390](design-system-v2-evidence/media-after-390.png) |

此外补齐四份仍读取旧“属性表状态”的 T08/T09 恢复测试，改为标题状态并真实展开原协作区；T08 的反馈读取改到实际 Toast。预期状态、精确请求、会话版本、责任、事件、原 UUID、只读 ACK、敏感清除和受众断言保持。

首轮远端 TypeScript 运行 `41284216094` 在上述旧 T09 状态定位失败：244 个选择入口中执行 14 个，57 项检查为 55 PASS / 2 FAIL，230 入口 NOT_RUN，原 ZIP 与摘要已保留。修补的本地输入 `a6060a30d28a8c59c792d638c78d78d86265877a9cbd74d1e9bfb3383e6fe63f` 已通过构建、完整 types、制品与 8 个注册相关入口 / 13 项检查（无 SKIP / NOT_RUN）；它不是后继发布 head 的远端 CI 通过证明。新增图片摘要见 [审查修补 manifest](design-system-v2-evidence/media-review-manifest.json)，原始诊断和 TAP 位于 `D:/CodexEvidence/pc-admin-design-v2-delivery-20261101/review1/`。

## 第二轮审查与通知定位收口

第二轮审查在 head `eb7ac71f72153357197a9af03659f5727b9e284a` 提出 [P2 主按钮标签颜色问题](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/127#discussion_r4434840424)。实际启用的公开进度按钮前景为白色，但 label 被 `.note-controls span` 改成灰色；现仅让操作栏直接提示 span 使用该灰度，按钮内部正常继承自身前景。同步补齐 reduced-motion 选择器优先级，使弹窗按钮在该偏好下实际为 `transition: none`。

新增可提交状态的实际对比度检查：公开进度、普通会话、补充材料绑定回复及活动 selection 的收件箱入口均检查白色标签与蓝底至少 4.5:1。检查等待原 CSS 状态完成，不增加业务超时或任意 sleep。修补前后图及原始计算样式见 [前](design-system-v2-evidence/primary-label-before-1280.png) / [后](design-system-v2-evidence/primary-label-after-1280.png) / [manifest](design-system-v2-evidence/primary-label-manifest.json)；前图同时保留当时未生效的 reduced-motion 转场观察，不把转场底色当作稳态蓝底。

该 head 的远端 TypeScript 运行 `41286792920` 已执行 80/244 入口，171 项检查为 170 PASS / 1 FAIL，164 入口 NOT_RUN；停在通知状态的旧 DOM 提取。真实运行复现了 Tag 外层与内部 span 被 `p span` 重复收集，同一“已发送/待发送”各出现两次。测试现读取直接子项，原 Sender 场景、精确状态、次数、发送时间、权限、零写入和物理快照断言保持。

固定本地候选输入 `f9586107d6cac44e2a15c3b40a674784d356d9414f480d1ef1219d77d9d58b07` 的构建、完整 types、制品及 9 个注册相关入口 / 14 项检查全部通过（无 SKIP / NOT_RUN），包括实际成功/失败/UNKNOWN 通知、双路状态和权限。5 份调整测试的 182 个原 assert 表达式逐项一致；旧 FAIL、原 ZIP、164 项 NOT_RUN、复现与后继结果均保留在 `D:/CodexEvidence/pc-admin-design-v2-delivery-20261101/review2/`。这些记录仍不替代下一发布 head 的远端 CI 与审查。

## 合并与回退

合并前要求最终完整 PR head 的审查完成、P1/P2 收口、适用 CI 成功且未解决线程核对完成。合并使用保留祖先的 merge commit；回退为后继 revert，不改写历史证据。没有部署、真实发送、业务写库或 Gate 推进授权。
