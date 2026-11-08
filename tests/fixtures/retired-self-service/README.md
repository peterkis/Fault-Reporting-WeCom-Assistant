# 已退役 V1 自助客户端测试样本

三个 `self-service` 文件来自 2026-10-22 基线 `d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f` 的 `web/p2-reporter`，保留原字节以重现既有 API、身份和 UNKNOWN 恢复回归。

只有 [测试适配器](../../helpers/retired-self-service-ui.mts) 可读取本目录。生产宿主、前端入口和新 H5 manifest 不引用这些样本；它们不能作为新 H5 或现场验收。当前替代决定见 [ADR-0043](../../../adr/0043_h5_notification_entry_and_legacy_ui_retirement.md)。

2026-11-09 卡32C-D（[ADR-0058](../../../adr/0058_completion_and_dismissal_language.md)）：V1 API 的 Ticket 状态改为 `COMPLETED` / `DISMISSED` 并删除 `DUPLICATE_LINKED`，不做兼容映射。`self-service.js` 只改了 `ticketStatuses` 一行（`COMPLETED:'已完成'`、`DISMISSED:'已关闭'`），其余字节不变；此后该文件不再与 `d3b7fda4` 原件同哈希。
