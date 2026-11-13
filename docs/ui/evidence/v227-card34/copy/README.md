# 卡 34C · 界面文案证据

基线：main `9af0c53e`（含卡 34A、34B）合入 `codex/v227-card34c` 后的本地构建。规则见 [设计系统 6.15「界面文案」](../../../design-system.md)，逐条改写见 [卡 34C 文案清单](../../../../../plans/pc-admin-design-v21/card-34c-copy-inventory.md)。

## 截图（`tests/pc-admin-card34c-copy.browser.test.mts`，1440 宽）

| 文件 | 内容 |
|---|---|
| `board-1440.png` | 团队工作台看板；页面可见文字不含禁用词 |
| `detail-1440-draft-saved.png` | 工单详情抽屉，内部备注输入后底栏为「✓ 草稿已保存 · 清空」，悬停提示「仅保存在这台电脑，24 小时后自动清除」；页面可见文字不含禁用词 |

`receipt-34c-copy.json` 记录尺寸与 SHA-256。

## 检查

- `tests/pc-admin-copy-terms.test.mts`：静态扫描 `app/pc-admin/src/app` 与 `features` 中含中文的字符串与 JSX 文本（跳过注释与 `hidden` 测试钩子），禁用词与英文词零命中；白名单仅服务端原值「Bot 私聊」等（显示前经 `publicChannelLabel` 换名）与下载文件名「报修附件.png / .jpg」。卡 34B 合入后不再跳过任何目录。
- `tests/pc-admin-card34c-copy.browser.test.mts`：真实服务下看板与详情抽屉的 `innerText` 不含禁用词。
- 浏览器回归：231 个 `*.browser.test` 三路并行全跑，98 个失败；其中 39 个在当前 main 上同样失败（原有问题，未处理）。其余 59 个是旧文案断言，按新文案或 `data-*` 钩子更新后再跑：57 个通过，`t28-followup-bigint` 与 `wbint-t34-follow-production` 单独在 main 上同样失败（个人工单快照中会话异步出现 / 截图命令超时），在本分支单独运行 `t28-followup-bigint` 通过。

## 已知限制

- 打开详情时，撤销派工组件仍会弹出「解除分派 · 当前撤派内容已停止展示。」与「恢复状态 · 草稿已过期，敏感内容已清理；原操作须核对。」两条提示（截图可见）。main 上同样出现，不含禁用词，不在本卡清单内，另行处理。
- 清单只覆盖含禁用词的文案；不含禁用词的旧式说法（如部分「结果未知：…只读核对…」）保留原样，提示组件同时接受「结果未知」与「结果未确认」。
