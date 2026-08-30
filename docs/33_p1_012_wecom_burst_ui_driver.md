# 33. P1-012 企业微信 100 条突发 UI 驱动

## 目的与证据边界

`scripts/p1-012-wecom-burst-ui.ps1` 只负责把获批测试账号在 Windows 企业微信测试群中的重复输入动作压缩为一次定位和一次快速循环：

```text
点击并确认空输入框
→ 每条重新输入 @、粘贴唯一机器人搜索词、选择客户端候选
→ 等待候选确认并重新点击输入框，抵御机器人回复抢焦点
→ 粘贴非敏感报修正文和 001…100 序号并逐条发送
```

脚本输出的 `UI_INPUT_SENT` 仅表示客户端输入动作已经触发，不证明 callback、Ticket、Outbox、Delivery、客户端回复或零漏单。正式现场结论仍只取同一 token 的 `p1_012_live_burst_result`、数据库对账和客户端观察。

## 失败闭合约束

- 仅接受唯一的 `WXWork` 主窗口，且窗口标题必须精确为 `企业微信`；
- 序号只能位于 `001`–`100`，区间不得倒置；
- 默认不产生 UI 副作用，必须显式选择 `-PlanOnly` 或 `-Execute`；
- `-Execute` 必须在 Windows `pwsh -STA` 中运行；
- 输入框必须为空；脚本先以无内容复制检查拒绝已有草稿，再写入、复制校验并清除自己的随机短探针，以确认点击位置确实是可编辑输入框；
- 禁止复制粘贴一个看似带 `@` 的旧消息充当原生提及。现场已证明这种外观相同的粘贴文本可能不产生机器人 callback；
- 每次候选确认后必须等待 `MentionSelectionDelayMs` 并重新点击输入框；现场已证明机器人回复可能在此时抢走焦点，导致只发送提及而正文丢失；
- 每条消息都重新输入 `@`，粘贴调用方给出的唯一机器人搜索词，并通过候选菜单选择；搜索词不写入脚本日志；
- 脚本只把非敏感正文和 token/序号以普通剪贴板文本粘贴，运行前保存原剪贴板并在退出时恢复；
- 菜单选择输入成功仍不证明原生提及或 callback，必须先以单条校准和监听器结果确认；
- 每次粘贴、输入和发送前后都复核前台窗口；焦点丢失立即停止；
- `Esc` 可在倒计时、步骤间隔或消息间隔内停止；脚本不会自动清除可能残留在输入框中的半条消息；
- 中断或输入异常后必须先按 WSS/数据库事实确定已接收序号，再决定续跑起点，禁止盲目重发。

## 受控运行

先在第一个 PowerShell 窗口启动现有真实监听器，并等待 `p1_012_live_e2e_ready`：

```powershell
$burstToken = '<locally-generated-non-sensitive-token>'
$env:P1_012_LIVE_TEST_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --live --scenario=group-burst-100 --trigger-token=$burstToken --timeout-ms=900000
} finally {
  Remove-Item Env:P1_012_LIVE_TEST_APPROVED -ErrorAction SilentlyContinue
}
```

准备一个只在当前客户端候选列表中唯一命中机器人的搜索词，并保持企业微信目标测试群输入框为空。脚本不会记录该搜索词；窗口保持正常大小，默认点击客户区宽度 55%、高度 78% 的输入区位置。

```powershell
$mentionSearch = '<unique-bot-search-text>'
```

先在第二个 PowerShell 窗口运行无副作用计划检查：

```powershell
pwsh -NoProfile -NonInteractive -File scripts/p1-012-wecom-burst-ui.ps1 `
  -TokenBase $burstToken -MentionSearchText $mentionSearch `
  -StartIndex 1 -EndIndex 100 -StepDelayMs 50 -MentionMenuDelayMs 120 -MentionSelectionDelayMs 600 `
  -MentionDownPresses 1 -InterMessageDelayMs 180 -ArmDelaySeconds 5 -PlanOnly
```

核对计划后，先只发送 `001`。只有监听器确认 `sequence_index=1`、受理和回复结果符合预期，才继续 `002`–`100`；这两次调用必须使用同一个仍在运行的监听器和 token：

```powershell
pwsh -NoProfile -STA -File scripts/p1-012-wecom-burst-ui.ps1 `
  -TokenBase $burstToken -MentionSearchText $mentionSearch `
  -StartIndex 1 -EndIndex 1 -StepDelayMs 50 -MentionMenuDelayMs 120 -MentionSelectionDelayMs 600 `
  -MentionDownPresses 1 -InterMessageDelayMs 180 -ArmDelaySeconds 5 -Execute

# 确认 001 的 WSS 结果后再运行：
pwsh -NoProfile -STA -File scripts/p1-012-wecom-burst-ui.ps1 `
  -TokenBase $burstToken -MentionSearchText $mentionSearch `
  -StartIndex 2 -EndIndex 100 -StepDelayMs 50 -MentionMenuDelayMs 120 -MentionSelectionDelayMs 600 `
  -MentionDownPresses 1 -InterMessageDelayMs 180 -ArmDelaySeconds 5 -Execute
```

候选菜单首次未选中目标机器人时，可在单条校准中调整 `MentionDownPresses`，范围仅允许 0–5；不得直接用错误配置发送余下 99 条。默认节流下，校准后的 99 条 UI 输入通常约在数分钟内完成，实际时间取决于客户端调度和回复渲染。若客户端漏键，可逐步提高 `StepDelayMs`、`MentionMenuDelayMs` 或 `MentionSelectionDelayMs`；若服务端或客户端出现限流，可提高 `InterMessageDelayMs`，但不能把 UI 完成速度写成受理 SLO。

## 中断与续跑

`p1_012_wecom_ui_burst_stopped` 会给出最后确认完成的 UI 输入数、当前序号和当前动作阶段。`outcome=UNKNOWN` 或 `composer_may_contain_unsent_text=true` 时：

1. 先检查企业微信输入框是否留有未发送文字；
2. 等待并读取监听器已有的脱敏序号结果；
3. 查询同一 token 对应的 Inbox、Intake、Ticket、Outbox 和 Delivery；
4. 只有确认连续接收的最后序号后，才用下一序号作为新的 `-StartIndex`；
5. 最终仍必须得到完整 001–100 的唯一 callback 集合和 `p1_012_live_burst_result`，局部 UI 日志不能补齐缺失证据。

## 2026-08-30 现场结论

最终真实运行使用持久化 Computer Use 会话执行同一失败闭合动作契约，并在每次候选确认后重新聚焦输入框。中途一次抢焦点被每 10 条 callback 核对发现：该次只出现无 token 的提及，未计入 burst；暂停后补发缺失序号，再继续余下序号。最终同一新 token 的 `p1_012_live_burst_result` 为 `PASSED`：100 个 callback、100 个唯一消息、100 个 Ticket、100 个 Outbox、200 个 Delivery，零漏单、零重复单且通知可追溯。该结果证明真实群内突发，不授权负责人 Go、Phase 2、提交或推送。

脚本不修改 P1 状态，不追加正式现场 JSONL，也不授权 Go、Phase 2、提交或推送。
