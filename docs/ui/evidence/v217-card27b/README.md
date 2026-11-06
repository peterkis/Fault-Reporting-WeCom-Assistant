# 卡27B Windows视觉证据

来自正式PC构建、真实loopback HTTP与隔离PG的合成场景，执行与完整验证见[卡27B](../../../../plans/pc-admin-design-v21/card-27b.md)。没有现场、Electron、部署或Gate验收含义。

候选输入：`8844ccf054df413ceb2419f9d392b3d4029d319eeaa71a8c7f88f5a85a79a31b`。来源为最终回归 `tests-04` 的Card12浏览器入口；PNG SHA-256、尺寸、Win32、DPR和zoom见[receipt.json](receipt.json)，实测与请求/状态核验见[metrics.json](metrics.json)，图标12×12px另见[extra-metrics.json](extra-metrics.json)。原始回执保存在 `D:/CodexEvidence/pc-admin-v217-card27b-20261106/browser-final-receipt-original.json`。

主图1440×1060、1920×1060，DPR1 / zoom1；局部在1440视口以DPR2 / zoom1采集，PNG尺寸为CSS裁剪的2倍且包含卡片外距。列表为1440宽的完整文档截图，视口仍为1060高、DPR1 / zoom1。系统Chrome采集，不缩放页面或修改DOM制造展示事实。

| 画面 | 文件 |
| --- | --- |
| 1440，已关闭默认折叠 | [board-1440-dismissed-folded.png](board-1440-dismissed-folded.png) |
| 1920，已关闭默认折叠 | [board-1920-dismissed-folded.png](board-1920-dismissed-folded.png) |
| 1440，已关闭展开 | [board-1440-dismissed-expanded.png](board-1440-dismissed-expanded.png) |
| 1920，已关闭展开 | [board-1920-dismissed-expanded.png](board-1920-dismissed-expanded.png) |
| 人工关闭，2倍局部 | [dismissed-manual-x2.png](dismissed-manual-x2.png) |
| 系统判定，2倍局部 | [dismissed-system-x2.png](dismissed-system-x2.png) |
| 重复，2倍局部 | [dismissed-duplicate-x2.png](dismissed-duplicate-x2.png) |
| 抽屉关闭记录 | [drawer-closure-record.png](drawer-closure-record.png) |
| 列表，结束方式已关闭 | [list-dismissed.png](list-dismissed.png) |

实测：普通看板completed=4 / dismissed=5、列头9；今天范围4 / 3、列头7，今日完成3（RESOLVED缺completed_at不计）。各组剩余项1 / 2，相互独立；组标题12px / 500、关闭卡标题14px / 500、灰度1 / opacity0.55、1px / 0.06描边。列表原因单元格最大92px，低于160px上限；原文保留title。

真实拖动跨过原启动阈值，进入已关闭标题后请求0、抽屉0；卡片展示流程业务POST0，Ticket状态、版本、责任和事件数量与fixture准备后的快照一致。关闭组不注册业务放置目标，原完成区及命令另由既有测试验证。

恢复及悬停恢复截图：按27A S3跳过，三类DISMISSED均can_restore=false，没有现有恢复操作。重复样本的duplicate_of=null，未伪造原单；来源和关闭时间未知时保持未知。原型完整原因与原单关联属于27C，不把合成标题或自由说明猜成业务原因。

初轮失败截图与不完整记录保留在上述外部证据目录，未覆盖或改名为当前通过证据。当前九图已按原始PNG尺寸和SHA-256逐个核验。

2026-11-06后继：B5日期组合扩展的新候选与8图见[b5-extended](b5-extended/README.md)。本页原九图、输入与原回执保持原首轮身份。
