# 卡24独立审查增量：F1数字覆盖

初审对象293551f868c78b2fc2b2be04131289005a10767c；修复/实测对象bdf2ad714a4683523955281aaff9ea233994f63e。原截图与原验证身份保留，本页不把旧图片重绑为新候选。

独立Spec审查发现P2：只替换已有23处不足以覆盖所有数字徽标和列表计数。新增根级继承既有Token；实际正式bundle、原UUID合成夹具、真实HTTP和getComputedStyle复核。

| 视图 / 样本 | 修补前 | 修补后 |
| --- | --- | --- |
| board / time / 1 分钟前 | tabular-nums | tabular-nums |
| board / time / 5 分钟前 | tabular-nums | tabular-nums |
| board / time / 6 分钟前 | tabular-nums | tabular-nums |
| board / time / 7 分钟前 | tabular-nums | tabular-nums |
| board / time / 15:21 完成 | tabular-nums | tabular-nums |
| board / time / 9 分钟前 | tabular-nums | tabular-nums |
| board / time / 14:51 完成 | tabular-nums | tabular-nums |
| board / time / 11 分钟前 | tabular-nums | tabular-nums |
| board / time / 14:51 完成 | tabular-nums | tabular-nums |
| board / time / 10 分钟前 | tabular-nums | tabular-nums |
| board / .ds-stage-count / 10 | tabular-nums | tabular-nums |
| board / .ds-stage-count / 4 | tabular-nums | tabular-nums |
| board / .ds-stage-count / 4 | tabular-nums | tabular-nums |
| board / .ds-ticket-heat / 超时 2 天 | normal | tabular-nums |
| board / .ds-ticket-heat / 超时 5 小时 | normal | tabular-nums |
| board / .ds-ticket-heat / 30 分钟 | normal | tabular-nums |
| board / .ds-ticket-heat / 30 分钟 | normal | tabular-nums |
| list / 列表计数 / 10 | normal | tabular-nums |
| list / 列表计数 / 4 | normal | tabular-nums |
| list / 列表计数 / 4 | normal | tabular-nums |

20/20个样本均为tabular-nums：4个热度和3个列表计数由normal修复，原13个时间/阶段计数保持。构建922实际Node解析、strict/types及制品校验通过，源HEAD为完整修复SHA且dirty=false。

审查与回归说明见[本地审查记录](../../../../plans/pc-admin-design-v21/card-24-review.md)。
