# 已退役 V1 自助客户端测试样本

三个 `self-service` 文件来自 2026-10-22 基线 `d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f` 的 `web/p2-reporter`，保留原字节以重现既有 API、身份和 UNKNOWN 恢复回归。

只有 [测试适配器](../../helpers/retired-self-service-ui.mts) 可读取本目录。生产宿主、前端入口和新 H5 manifest 不引用这些样本；它们不能作为新 H5 或现场验收。当前替代决定见 [ADR-0043](../../../adr/0043_h5_notification_entry_and_legacy_ui_retirement.md)。
