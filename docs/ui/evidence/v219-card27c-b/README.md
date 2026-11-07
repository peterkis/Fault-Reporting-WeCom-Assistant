# 卡 27C-B：关闭、恢复与关闭记录

Windows Chrome，DPR 1，页面缩放 1，视口 1440×1400。界面来自正式编译资源，身份和数据为合成；调用真实 loopback HTTP / PostgreSQL，未真实发送通知。不能据此认定现场验收、真实企业微信身份或部署批准。

原始逐例结果与过程失败位于本机 `D:/CodexEvidence/card27c-b-20261107`。以下图片由 `tests/t10-cancel.browser.test.mts` 在同一业务场景产生；[回执](receipt.json)保存截图 SHA-256、尺寸、来源及被测候选。当前六张均已逐张目视检查，无对话框裁断；数值及业务状态另由断言验证，不用截图替代断言。

| 文件 | 场景 |
| --- | --- |
| [01-duplicate.png](01-duplicate.png) | 重复报修，按编号搜索并选取可见原单；固定通知文案包含原单编号。 |
| [02-not-it.png](02-not-it.png) | 非 IT 范围，八选一二级原因、进行中跟进终止提示。 |
| [03-other.png](03-other.png) | 其他，说明必填，显式勾选通知；测试另断言初始不勾选及空说明不可提交。 |
| [04-restore-confirm.png](04-restore-confirm.png) | 恢复前核对原列/负责人；本例未实际送达关闭通知，因此没有虚构重新受理通知承诺。 |
| [05-restored-highlight.png](05-restored-highlight.png) | 真实恢复后回到处理中列，原负责人保留，1.2秒品牌浅色高亮。 |
| [06-history.png](06-history.png) | 两次关闭、一次恢复，按顺序展示；包含二级原因、原单、内部说明和实际通知事实。 |

关闭对话框实测宽440px、圆角14px、内边距20px、一级单选行36px。所有原件保持完整；为容纳展开的八项二级原因，使用1400px高视口，未改变DPR或页面缩放。

完整执行、文件清单、业务期望变更和限制见[卡 27C-B 执行记录](../../../../plans/pc-admin-design-v21/card-27c-b.md)。
