# 卡29：关闭 / 恢复 / 列表收尾（PC）

本地交付：2026-11-07（Asia/Shanghai）。执行环境为 macOS（Apple Silicon）、Node 24.18.0、本机 PostgreSQL 18.6（localhost:5432，测试按既有 helper 建立并回收隔离库）、系统 Chrome。用户已明确授权本卡在本地验证后提交、推送并创建 PR；不合并。

## 输入与边界

- 基线：`origin/main` `33648dfd`（卡28、27C-A/B/H 已合并）；分支 `codex/v220-card29`。
- 依据：`prompts/pc-admin-v2.2.0_card29_prompt.md`；原型 `docs/ui/prototype/医小修 PC 管理端 v2.2.2 设计原型.html` 01d（主要）、01b、01c。原型随本卡入库。
- 卡29H、30A 在各自会话与 PR 中进行，本卡与其无文件交集。

## 编号清单

| 编号 | 结论 |
| --- | --- |
| K1 | 已完成。对话框「非 IT 范围」只列 3 个具体情况（原码、新显示名与辅助说明），缩进子选项组紧贴父选项。后端例外：新增 `normalizeClosingInput`，工单关闭与受理事项关闭两条命令路径只接受 3 个码；`unified_closure_command` / `unified_intake_closure_command` Schema 同步收紧；人工复核工作区与系统关闭仍用完整 8 码。关闭记录、卡片 / 列表原因标签用新显示名，其它历史码保留记录名。旧草稿中的退役码清空待重选；未核对的旧命令保留原码以便核对。 |
| K2 | 已完成。原因文字统一 `--text-primary`（`.ds-closure-reason-text`），断言所有选项计算颜色一致。本机未复现「测试」二字橙色，原因未能定位到具体规则，已以显式颜色收口。 |
| K3 | 已完成。单一组合框，输入即搜（250ms），下拉显示分类图块 / 编号 / 标题 / 阶段，键盘上下 / Enter / Esc；选中后框内显示并可清除；只显示 `IT-` 编号、排除自己；提交原单编号（后端按 `ticket_no` 校验）。 |
| K4 | 已完成。通知块只讲通知；「其他」首行复选框；终止提示移到块外单独一行；删除「关闭后不计入完成数…」。 |
| K5 | 已完成。底栏一行：左「草稿已保存 · 清空」，右「取消 / 确认关闭」；草稿状态改为带文字的 inline 形态，去掉孤立图标。 |
| K6 | 已完成。对话框 440 / 圆角 14 / 内边距 20 / 标题 16·600 / 行高 36（浏览器实测断言）。⋯ 菜单 220 / 10 / 4、项高 32、14px 图标、左对齐，「关闭事项…」危险项（实测断言）。为加图标改了 `TicketNotes.tsx` 的「刷新可用操作」按钮内容与 `drawer.css`（清单外的最小改动，选择器与行为不变）。 |
| R1 | 已完成。重叠来自 `.ds-closure-private` 的负上外边距；恢复确认改用独立 `.ds-restore-followups` 固定间距，断言脚注顶部 ≥ 信息块底部。 |
| R2 | 已完成。宽 400 同规格、右上关闭按钮、信息块三行、主按钮「↶ 确认恢复」、去掉孤立图标。限制：恢复目标未返回关闭时是否勾选「通知报修人」，「误报或测试」判为「本次不发送」，「其他」未勾选通知时会显示「关闭通知尚未送达…」文案；准确区分需后端在 `restore_target` 增加该字段，超出本卡后端例外，留作后续。脚注以恢复目标为「处理中」判定为曾终止跟进。 |
| D1 | 已完成。灰色「⊗ 已关闭」徽标，隐藏绿色阶段与「已取消」子状态。 |
| D2 | 已完成。中性下一步卡（两行文字 + secondary「↶ 恢复」）；删除关闭记录里的第二个恢复入口。保留例外：恢复响应丢失后事项已回到处理中时，「核对恢复」仍在关闭记录中出现（否则恢复核对入口会随下一步卡消失；`t10-cancel` 丢失响应用例覆盖）。 |
| D3 | 已完成。单一「关闭记录」分节、倒序、紧凑两行、说明小块、恢复行，空值不显示；原单 mono 链接打开原单抽屉。 |
| D4 | 已完成。关闭 / 恢复成功提示条改为「已关闭 / 可在「已处理 · 已关闭」中恢复」「已恢复 / 已回到{列名}」（`ToastFeedback` 增加 `title`）。恢复的「核对上次操作」成功也走同一提示。其它功能的「原操作已核对为提交…」未改，记录于此供后续统一。 |
| D5 | 已完成。`statusLabels` / `status-map` / 下一步文案中 `CANCELLED` 显示「已关闭」。搜索「细分状态」中 `CLOSED` 同名，改为「已关闭（已完成）」区分。 |
| B1 | 已完成。「重复 · IT-…」同一标签，编号 mono 12px。 |
| L1 | 已完成。只缺一项时只显示存在项，都缺显示「—」。 |
| L2 | 已完成。负责人单行省略，title 全名，行高 44（实测）。 |
| L3 | 已完成。阶段 / 说明 / 加载行强制白底（含悬停），仅子分组行灰底；来源是 `workbench-table.css` 的通用 `tbody tr:hover`。 |
| L4 | 已完成。「收起」同样式并带 14px `ChevronUp`（实测）。 |
| L5 | 已确认后端已提供对外编号：两条关闭命令都按 `ticket_no` 校验 `duplicate_of_ref`，投影原样返回，无后端改动。前端加 `externalTicketNumber` 保护：非 `IT-` 的引用不显示。看板、列表、抽屉三处断言为 `IT-`。验收截图中的 `TKT…` 不来自本仓库任何 fixture，推断为另一环境的本地数据。 |
| L6 | 已完成（后端例外）。搜索结果原只经 `authorizedItem`，缺 `service` / `stage_entered_at`；新增只读 `projectSearchItems` 复用看板 `readWorkbenchCardProjections`。同步更新 `workbench_search_page.schema.json`、`WorkbenchSearchCard` 类型与 PC 搜索解析允许字段。断言同一事项搜索 / 非搜索的分类与时效一致。 |
| L7 | 已确认仓库内无需修改：仓库 fixture / helper 中不存在「旧记录缺少关闭证据（合成）」形态；该数据在另一处环境的本地库，按 ADR-0056 U7 需在该环境删除重建。 |

## 后端改动（例外项）

- K1：`app/server/src/service-closure-records.mts`（`normalizeClosingInput`）、`p2-016-ticket-command-facade.mts`、`workbench-intake-closure.mts`；`contracts/unified_closure_command.schema.json`、`contracts/unified_intake_closure_command.schema.json`。
- L6：`app/server/src/web01-workbench-query.mts`（`projectSearchItems`）、`workbench-search.mts`；`contracts/workbench_search_page.schema.json`、`workbench_search_contracts.d.ts`、`web01_workbench_contracts.d.ts` 注释；PC `api/client.ts` 搜索解析。

## 验证

- `npm run migration:build`（macOS 用 `npm`）：928/929 编译与语法检查 PASS。
- Stylelint 0、ESLint 0、`tsc --noEmit`（pc-admin）0。
- 契约 / 单元：`t10-waiting-contract`、`pc-admin-design-foundation`、`web01-workbench` 91/91 PASS（新增 K1 校验与显示名断言）。
- 浏览器（真实 loopback HTTP + PG）：`t10-cancel` 7/7、`wbint-t14-review` 6/6、`pc-admin-card12` 卡28单表用例 PASS、新增 `pc-admin-card29` PASS。
- 过程失败（保留）：`t10-cancel` 主流程首次失败于看板标签文本（分隔改成 CSS 间距后 textContent 变为「重复·」），改回文字分隔后通过。`pc-admin-card12` 卡28用例在未修改的 main 上本机即失败（期望「重复报修 · IT-…」，27C-B 已改为「重复 · IT-…」）；按 B1 更新期望。新增卡29用例首次因实时连接建立前的提示使搜索查询失效而超时，改为等待 live 后再核对。
- 截图：`docs/ui/evidence/v220-card29/`（macOS Chrome，DPR 1、缩放 1；**非 Windows**），`closure/` 来自 `t10-cancel`，`list/` 来自 `pc-admin-card29`，各含 `receipt.json`。

## 审查后修复（PR #165）

- 组合框请求预算：搜索与普通搜索共用每人 60 秒 20 次的服务端额度，中止请求不退还。改为至少 3 个字符才搜索；上一次结果完整（无下一页）且新输入包含上次查询时在本地收窄，不再发请求。
- 恢复核对的去向：响应丢失后重新打开时没有内存中的恢复目标，原先默认显示「已回到待接单」。改为取已确认的当前事项列（处理中 / 待接单），都没有时显示「已回到关闭前所在列」；丢失响应用例断言「已回到处理中」。复跑 `t10-cancel` 7/7、`wbint-t14-review` 6/6。

## 回退

前端改动可整体回退；K1 回退需同时恢复两份 Schema 与 `normalizeClosureInput` 调用；L6 回退删除 `projectSearchItems` 调用与 Schema / 解析字段即可。
