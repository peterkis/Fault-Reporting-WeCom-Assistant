# 卡32C-D 截图（完成 / 关闭拆分）

截图环境：macOS 本机 headless Chrome（CDP），DPR 1。**不是 Windows 截图**，也不是现场或生产验收。

- PC 四张（1440×1000）：来自 [卡32C-D 浏览器测试](../../../../tests/pc-admin-card32c-d.browser.test.mts)，使用真实 loopback HTTP 和隔离 PostgreSQL，数据为合成数据，没有真实发送。环境变量 `CARD32CD_EVIDENCE_DIR` 指定输出目录。实测值见 [receipt-32c-d.json](receipt-32c-d.json)。
- H5 一张（390×844）：Vite DEV 合成预览 `?preview=1&state=closure#/reports?status=DISMISSED`。

| 文件 | 内容 |
| --- | --- |
| [drawer-timeline-completed.png](drawer-timeline-completed.png) | 抽屉动态：「已解决待确认 → 已完成」，状态点为完成绿 `--stage-done-accent`（rgb(68, 131, 97)） |
| [drawer-timeline-dismissed.png](drawer-timeline-dismissed.png) | 抽屉动态：「处理中 → 已关闭」，状态点为中性灰 `--stage-dismissed-accent` = `--gray-400`（rgb(165, 162, 154)）；顶部「已关闭 · 不计入完成数」 |
| [list-1440-closed-groups.png](list-1440-closed-groups.png) | 列表「已处理」：已完成组显示「已完成」标签；已关闭组注明「不计入完成数」，行内显示关闭原因与「… 关闭」时间 |
| [search-status-labels.png](search-status-labels.png) | 搜索「细分状态」：「已完成」「已关闭」各出现一次，没有「已关闭（已完成）」「已撤销」「已关联公共故障」 |
| [h5-report-filter-dismissed.png](h5-report-filter-dismissed.png) | H5「我的工单」状态筛选「已关闭」（原 `CLOSED_OUT`），只列出已关闭的报修 |

「NEW」和「QUEUED」在搜索中都叫「待接单」，这在 main 上已经如此，本卡没有改动。
