# 卡32A：列表视图与协作在场收尾（PC 前端）

本地交付：2026-11-08（Asia/Shanghai）。环境：macOS、Node 24、本机 PostgreSQL 18.6、系统 Chrome（DPR 1）。用户要求按原型完成卡 32 开发测试并创建 PR；不合并。

## 输入与边界

- 基线：`main` `e6fed67d`（卡 31 #168 已合并）；分支 `codex/v223-card32a`。
- 依据：`pc-admin-v2.2.3_card32_prompt.md`（32A 节）与 v2.2.4 设计原型（01c 列表、01e 协作在场、02 抽屉）。只改视觉与文案，不改接口契约与业务规则；无新功能开关。
- 32B（关闭 / 恢复）另行 PR，文件无重叠；32B 未提出新令牌需求。

## 编号清单

| 编号 | 结论 |
| --- | --- |
| A1 | 已完成。新增语义令牌 `--bg-group: var(--gray-25)`（#FBFBFA，原型 ≈#FCFCFB，未新增色值）。子分组行改用 `--bg-group`，上下各一条 `inset ±1px --border-hair`；窄屏 sticky 分组行同步。表头保持 `--bg-canvas`。实测：分组行 `rgb(251,251,250)`，悬停数据行 `rgb(247,247,245)`，表头白。 |
| A2 | 已完成。「显示剩余 N 项」前加 14px `ChevronDown`，「收起」保持 `ChevronUp`；颜色 `--text-secondary`，图标与文字间距 `--space-1`，与看板列底部同写法。 |
| A3 | 已完成。原因：卡30B 用例使用的默认夹具不带服务码，所有工单落到「未分类」。夹具新增可选 `syntheticServiceCodes`：13 张合成工单各用一个已登记服务码（打印机、网络、签到、检验、显示器等），走既有 H5 合成受理路径；未改类别映射与回退逻辑。断言：看板上工单卡片 0 个回退图标。两张「待判断」受理事项（INT-）尚未分诊，按业务规则仍为「未分类」，单独计数（2/2）。 |
| A4 | 实现未生效，已修。两层原因：① 悬停卡片 `transform` 形成层叠上下文，下一张卡片盖住提示；② 分组主体是 HeroUI 折叠容器（`overflow: clip` 且 `will-change: height, opacity` 自成层叠上下文），组内最后一张卡片的提示被裁切并被列底部按钮覆盖。首版改为提升层级并取消分组主体裁切；审查后改为提示放在卡片内部（见下文）。文案保持原型「沈然正在查看这张工单，领取前可先确认」（Prompt 写作「沈然正在查看，仍可领取」，要求不改文案，以原型与现有文案为准）。用例：悬停「领取」、键盘聚焦卡片链接再聚焦「领取」，提示均可见且命中测试位于提示本身。 |
| A5 | 已完成。删除 `::before` + 「✎」字符。提示条由 `ActivityPeople` 以 portal 渲染为真实元素：lucide `Pencil` SVG（12px、描边 1.75、`--presence-editing`）。挂在内部备注输入框（`data-presence-banner-anchor`）外框顶部：同宽、上圆角 = 输入框圆角、下圆角 0、与输入框间隙 0，高 28、左右 `--space-3`、`--tone-attention-bg` 底、12px `--text-secondary`。文案「陈悦正在编辑内部备注」；同字段多人「陈悦等 2 人正在编辑内部备注」。区域仍保留 `data-presence-editing` 属性（值为同一文案）。全仓源码与测试中「✎」清零；历史证据 `v221-card30b/receipt.json` 与 `card-30b.md` 为历史记录，保留。 |
| A6 | 已完成。新增 `--presence-editing`（= `--tone-attention-solid` #9A4A0A），名牌、卡片外圈阴影、抽屉胶囊三处共用；实测三处同为 `rgb(154,74,10)`。保留深色：白字对比度 6.25:1；原型 #D9730D 白字仅 3.28:1，低于 WCAG AA 4.5:1。 |
| A7 | 部分与 Prompt 现状描述不同：侧栏行头像实测已是 20px（卡31 回执同为 20），未改；弹出层头像为 22px，改为 `--avatar-md`（24px）。只改尺寸，不改布局。 |

## 验证

- 新用例 `tests/pc-admin-card32a.browser.test.mts`（真实 loopback HTTP + PG + 真实 SSE 流）PASS；已登记 `test-routing.json`。
- 合成接缝（回执 `synthetic` 字段注明）：本夹具中只有负责人可编辑内部备注，无法产生第二位真实编辑者，故「等 2 人」文案用页面内 fetch 接缝在抽屉在场读取中追加「周宁（合成）」验证。
- 回归：`pc-admin-card30b`（断言随 A5 由 `::before` 内容改为提示条元素与铅笔 SVG，其余断言不变）、`pc-admin-card31` PASS。
- `migration:build`、pc-admin `tsc`、Stylelint、ESLint 通过。
- 截图 `docs/ui/evidence/v223-card32/`（1440×1000，macOS Chrome，DPR 1，**非 Windows**），回执 `receipt-32a.json`。

## 审查后修复（PR #169）

- P2 A4：首版提示浮在卡片下方，盖住列底部「显示剩余 N 项」。改为提示放在卡片内部底行、「领取」左侧（同一行，悬停 / 聚焦时与「领取」一样暂时占用负责人与时间所在行）；不再需要首版的卡片层级提升与分组主体不裁切规则，已删除。用例新增：提示在卡片内、在「领取」左侧同一行、文字未截断，列底部「显示剩余」中心命中按钮本身。
- P2 A5：首版用 `margin-top` 给提示条腾位置，同事开始编辑时输入框下移 28px。改为提示条向上占用输入框上方空白（底栏 12px 与正文底部 24px 内边距），输入框不动。用例新增：提示条出现、消失、再出现时输入框顶部坐标不变（实测 868.91 → 868.91 → 868.91），提示条位于最上层且不覆盖时间线内容。
- 复测：`pc-admin-card32a` PASS；`pc-admin-card30b`、`pc-admin-card12`、`pc-admin-card29`、`workbench-detail-restructure`、`wbint-t30-internal-note`、`pc-admin-design-foundation` 100/100 PASS。

## 回退

还原本卡提交即可：删除 `--bg-group`、`--presence-editing`，恢复 `[data-presence-editing]::before`；夹具新增选项默认关闭，不影响其它用例。后端与契约无改动。
