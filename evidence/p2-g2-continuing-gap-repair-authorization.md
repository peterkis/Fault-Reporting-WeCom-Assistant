# P2-G2 跨Intake聚合及后续缺口持续授权

2026-09-08，负责人原文：

> 确认授权，后续缺口均按照本次默认授权确认

该回复承接`p2-g2-cross-reporter-correlation-gap.md`中的实际反例与具体修复范围：在既有Worker中有界读取有效事实、核对Canonical服务/症状兼容性、按可信Reporter排重、执行冻结时间窗口，复用既有候选/Review/Decision管线。

继续原P2-G2准备目标；后续为该目标所必需的缺口修复按此次授权持续执行，不再逐项请求确认。每项仍保留来源、范围、RED/GREEN、影响与独立复核；不得用预期结果制造业务事实或删除困难金标。

本次授权沿用所确认方案的边界：无新迁移/数据库结构、冻结阈值不变、不新增P3/目录/监控或AI/OCR入口、不自动Incident confirm/link、不跨人合并Journey、保留独立Ticket及原始202条语料/历史Evidence。真实发送与现场Gate关闭不在本轮范围；完成目标仍为第二个本地就绪候选提交并停在READY_FOR_LIVE_E2E，不push/merge/tag。

准备状态恢复IN_PROGRESS。原跨Reporter BLOCKED记录作为修复前证据保留，不再表示该范围未授权。
