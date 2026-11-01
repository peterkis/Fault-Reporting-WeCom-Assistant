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

## 合并与回退

合并前要求最终完整 PR head 的审查完成、P1/P2 收口、适用 CI 成功且未解决线程核对完成。合并使用保留祖先的 merge commit；回退为后继 revert，不改写历史证据。没有部署、真实发送、业务写库或 Gate 推进授权。
