# 卡32B：关闭 / 恢复流程收尾（PC 前端）

本地交付：2026-11-08（Asia/Shanghai）。环境：macOS、Node 24、本机 PostgreSQL 18.6、系统 Chrome（DPR 1）。用户要求按原型完成卡 32 开发测试并创建 PR；不合并。

## 输入与边界

- 基线：`main` `e6fed67d`（卡 31 #168 已合并）；分支 `codex/v223-card32b`。
- 依据：`pc-admin-v2.2.3_card32_prompt.md`（32B 节）与 v2.2.4 设计原型（01d 关闭与恢复；规则「PC 端所有『已取消』状态文案统一显示为『已关闭』（动态、筛选、标签）」）。只改视觉与文案，不改接口契约与业务规则；无新功能开关。
- 32A 另行 PR；本卡未新增令牌，无需 32A 代加。

## 编号清单

| 编号 | 结论 |
| --- | --- |
| B1 | 已完成。`use-note-draft.ts` 两处「正在保存恢复副本…」→「正在保存草稿…」。保存成功态的可见文案本已是「草稿已保存」（`DraftStatus` 由「已保存恢复副本；最长24小时。」缩写），读屏 / `title` 全文与约 70 个既有用例的等待条件依赖该原句，未改。 |
| B2 | 已完成。结论：双层框出现在「重复报修」的关联原单组合框（卡29 证据 `01-duplicate-dropdown.png`）：外层 `:focus-within` 画边框 + 2px 外偏移描边，内层 input 又被全局 `html body :is(input…):focus-visible` 规则画一圈焦点环（特异度高于原有的 `outline:0`）。「非 IT 范围」子原因是单选组，只有一层选中描边，无组合框。改为：外框保留 1px `--border-default`，聚焦时同一外框为 2px `--brand` 环；内层 input 不画焦点环。 |
| B3 | 已完成。抽屉「⋯」是原生 `details` 菜单，外部点击关闭逻辑在有对话框时让位，导致菜单停在弹窗后。关闭 / 恢复请求在打开对话框前收起所在 `details` 并把焦点交给「⋯」，对话框（react-aria FocusScope）据此在关闭后把焦点还给「⋯」。卡片「⋯」只含移列选项，不打开关闭弹窗。用例：选「关闭事项…」后菜单已收起；取消弹窗后焦点在「⋯」。 |
| B4 | 已完成。来源：处理中事项的「等待补充 / 等待厂商」两个控制器只有常规提示「草稿仅在当前浏览器恢复，最长24小时。」时，被 `drawer-v21.css` 排成行内图标，位于「处理人」上方（卡29 证据 `02-not-it.png`）。无内容时改为仅读屏（视觉隐藏，`aria-label`、`title`、sr-only 全文保留，卡13 断言不变）；有草稿内容时控制器照常显示，图标与其「核对 / 清空」按钮同行并带 `title` 提示。 |
| B5 | 结论：截图时机，不是样式。卡29 `04-restore-confirm.png` 中遮罩与面板同时半透明，为进入动画中途。面板本身为不透明 `--bg-canvas`，处于 HeroUI 模态层。`t10-cancel` 截图函数改为等待正在运行的动画结束再截图；新用例实测面板与遮罩累计不透明度 1、中心命中面板、无运行中动画。 |
| B6 | 已完成。`status-map.ts` 与 `api/client.ts` 中 `DUPLICATE_LINKED` 显示名均改为「已关闭」（标签与动态一致）；时间线状态点同为已处理色。当前处于关闭的事项，最近一条关闭状态记录后显示副文案「· 重复报修 · 关联 IT-…」/「· 非 IT 范围 · 业务咨询」，数据取自事项当前关闭信息；更早、已恢复的关闭只在「关闭记录」中显示原因（限制）。关闭会同时产生一条「已记录处理操作。」记录，时间相同，故只匹配状态类记录。 |

## 验证

- 新用例 `tests/pc-admin-card32b.browser.test.mts`（真实 loopback HTTP + PG）PASS；已登记 `test-routing.json`。
- 回归：`t10-cancel`（截图等待动画结束）、`pc-admin-card12`、`pc-admin-card29`、`workbench-detail-restructure`、`pc-admin-design-foundation` 与本卡用例共 113 项，112 通过。失败 1 项为 `pc-admin-card13` 的四宽度抽屉位置断言（右边距 7.65–7.84 ≠ 8，抽屉滑入动画中途测量）：在未修改的 `main` 上本机同样失败，非本卡引入，未改。
- `migration:build`、`gate.mjs types`、`verify-artifact.mjs`、pc-admin `tsc`、Stylelint、ESLint 通过。
- 截图 `docs/ui/evidence/v223-card32/`（1440×1000，macOS Chrome，DPR 1，**非 Windows**），回执 `receipt-32b.json`。

## 回退

还原本卡提交即可；无数据、契约或令牌变化。
