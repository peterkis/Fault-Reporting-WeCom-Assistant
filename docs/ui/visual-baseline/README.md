# 人工确认的视觉基线

基线按 `<process.platform>-<browser>` 分目录，包含 PNG 与 OS/浏览器/DPR 元数据。

产品负责人已于 2026-11-18 批准 `.build/visual/current/darwin-chrome/` 的 18 张图片作为首批基线，见[逐图哈希与批准记录](../evidence/v228-card35/35b/approved-screenshots-20261118.json)。产品负责人随后在普通交互终端中亲自运行 `npm run visual:approve -- --all`，写入本目录的 18 张 PNG 与批准集合逐字节一致（SHA-256 已核对）。Agent 不执行批准。35A 后续改变画面时须重新审阅后更新。

用法和更新规则见 [本地截图回归](../visual-regression.md)。
