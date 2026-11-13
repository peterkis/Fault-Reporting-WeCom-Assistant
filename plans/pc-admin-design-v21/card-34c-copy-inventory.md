# 卡 34C · 界面文案去技术化清单（已确认，已实施）

> 基线 main `18460b02`。2026-11-13 确认「按清单实施」，下文「需要你特别确认」五项均按建议执行。规则写入 [设计系统 6.15「界面文案」](../../docs/ui/design-system.md)，由 `tests/pc-admin-copy-terms.test.mts` 自动检查。
>
> 实施补充（清单未逐条列出、按同一规则处理）：
> - 单行反馈的「标题 · 说明」写成「标题：说明」；「查看最新」按钮未新增，沿用各处已有的「使用最新内容」入口。
> - 服务端仍发送「Bot 私聊」等原值，工作台比较时用原值，显示前经 `publicChannelLabel` 换成「医小修私聊」「医小修自动回复」，未改服务端合同。
> - 清单扫描只看单行字符串，长 JSX 行里的版本、原操作编号字段（公共故障通知、跟进、内部处置、公开进展、交接、候选、接管会话行）一并移出正文：原操作编号与提交版本进「复制诊断信息」，捕获版本只在内容已更新时提示「使用最新内容」，测试用版本钩子改为 `hidden`。
> - 「只读核对…原操作」「核对上次操作」等结果核对按钮统一为「核对结果」，「明确重放…」按钮统一为「重新提交」，与新提示里的「点击「核对结果」」一致。
> - 撤销派工、退回待安排、接单交接链三个目录由卡 34B（#187）改写，本卡未改，检查暂时跳过，34B 合并后清理。

## 扫描方法

- 范围：`app/pc-admin/src` 下 `app/**`、`features/**` 的 `.tsx` 与含中文的 `.ts`；跳过 34B 自行处理的 `features/assignment-history`、`features/ticket-unassign`、`features/ticket-return-to-dispatch`。
- 取每行的字符串字面量（单引号、双引号、模板字符串）与 JSX 文本，只看含中文的；去掉注释行和明显的代码片段。
- 命中条件：含禁用词（UUID、ID、版本 / 版本号、核验、副本、加密、投影、快照、读取范围、读权限、契约、幂等、命令、行版本），或含 3 个字母以上的英文词（`Ctrl` 等按键名除外）。
- 结果：224 条不同文案，共 267 处，分布在 47 个文件。同一文案出现在多处时合并为一行，「位置」列出全部。

## 改写规则（与卡片一致，改代码时写进 `docs/ui/design-system.md`「界面文案」一节）

1. 不出现上述禁用词和英文技术词。
2. 每条反馈回答「发生了什么 + 你现在能做什么」，不解释系统内部机制。
3. 标题 ≤ 8 字，说明 ≤ 40 字；用「你」。
4. 「请刷新 / 重新读取」改为具体动作：「点击重试」「重新打开详情」「点击「核对结果」」。
5. 被禁止的操作说清原因（例如「为避免重复提交，暂时只能查看」）。
6. 需要排查用的信息（原操作编号、版本）放进 `title` 或「复制诊断信息」，不放正文。

## 高频模式（统一译法，下表按此给出建议）

| 现在的说法 | 统一改为 | 场景 |
|---|---|---|
| 恢复副本清理失败 / 尚未确认，禁止新提交，请只读核对并重试清理 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| 恢复副本未保存，本次尚未发送 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 浏览器存储不可用 |
| 恢复核验暂时不可用，已保留加密副本 | 标题「草稿暂未恢复」· 说明「内容仍保存在本机，网络恢复后会自动找回。」 | 草稿暂时无法找回 |
| 结果未知：原 UUID、正文、版本保持不变，请只读核对 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后响应丢失 |
| 保存冲突 / 版本冲突：请重新读取版本后确认 | 标题「内容已被他人更新」· 说明「你的修改还在，查看最新内容后再保存。」+ 按钮「查看最新」 | 同事同时修改 |
| 连接尚未完成事实核验 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网 / 重连中 |
| 会话需要重新核验 | 「登录已过期，请重新登录。」 | 登录过期 |
| 正在核验…权限 / 正在读取工单动作与版本 | 「正在加载…」 | 加载中 |
| 明确采用当前版本 / 快照 | 按钮「使用最新内容」 | 内容已被更新 |
| 明确重放原操作（原 UUID 和正文） | 按钮「重新提交」 | 结果未确认后再提交 |
| 只读核对 / 用原命令核对 | 按钮「核对结果」 | 结果未确认 |

## 需要你特别确认

1. **「Bot 私聊」的对外名称**：建议「医小修私聊」，自动回复叫「医小修自动回复」（共 12 处）。
2. **「版本」字段**（公共故障版本、候选依据版本、`· 版本`）：建议从正文删除，放进「复制诊断信息」。
3. **单位**：「10 MiB」改「10 MB」；「16 KiB」不显示数字，只说「内容过长」。
4. **白名单**：`报修附件.png / .jpg` 是下载文件名，不在页面正文显示，建议保留。
5. 「草稿已保存」悬停提示「仅保存在这台电脑，24 小时后自动清除」——是否保留「24 小时」。

## 清单（按功能目录）

### app

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `app/Workbench.tsx:133`<br>`app/Workbench.tsx:139` | 已退出，当前浏览器的恢复副本已清理。 | 「已退出登录，本机草稿已清除。」（未确认时：「正在退出…」） | 点击退出登录 |
| `app/Workbench.tsx:134` | 服务器退出結果尚未确认，本地恢复副本已清理；请重新核验会话并查看工单信息。 | 「退出结果未确认，本机草稿已清除。请重新登录。」 | 退出登录时网络中断 |
| `app/Workbench.tsx:139` | 退出结果尚未确认，请重新核验会话。 | 「退出结果未确认，请重新登录。」 | 退出登录时网络中断 |
| `app/Workbench.tsx:149` | 会话需要重新核验，恢复副本已清理。 | 「登录已过期，请重新登录。」 | 登录过期或在其它窗口退出 |
| `app/Workbench.tsx:333` | 正在核验当前事项读取权限… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `app/WorkbenchDetail.tsx:150` | 以下为最近已确认资料；连接恢复后重新核验。 | 「网络恢复后会自动更新，以下为最近一次的内容。」 | 详情读取失败时的旧数据提示 |
| `app/authorization.ts:74` | 会话已关闭，请重新核验。 | 「登录已过期，请重新登录。」 | 登录失效 |
| `app/authorization.ts:81` | 已退出。正在清理本地恢复副本… | 「已退出登录，本机草稿已清除。」（未确认时：「正在退出…」） | 点击退出登录 |
| `app/authorization.ts:81` | 退出结果尚未确认，正在清理本地恢复副本… | 「已退出登录，本机草稿已清除。」（未确认时：「正在退出…」） | 点击退出登录 |
| `app/authorization.ts:83` | 会话需要重新核验。 | 「登录已过期，请重新登录。」 | 登录过期或在其它窗口退出 |
| `app/authorization.ts:83` | 本地恢复副本清理尚未确认，请保持会话关闭。 | 「本机草稿还没清除完，请保持退出状态。」 | 退出登录时 |

### attachments

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `attachments/AttachmentSection.tsx:140` | 播放副本正在准备，可下载原件 | 「正在转换，暂时可下载原文件。」 | 附件转码中 |
| `attachments/AttachmentSection.tsx:145` | 暂无可预览副本，可下载原件。 | 「暂时无法预览，可下载原文件。」 | 图片缩略图未生成 |
| `attachments/AttachmentSection.tsx:19` | 附件超过10 MiB限制 | 「附件不能超过 10 MB」 | 上传附件过大 |
| `attachments/AttachmentSection.tsx:34` | 暂无可播放副本，可下载原件。 | 「暂时无法在线播放，可下载原文件。」 | 附件转码失败 |
| `attachments/client.ts:26` | 报修附件.jpg | （白名单）下载文件名，不在页面正文显示 | — |
| `attachments/client.ts:26` | 报修附件.png | （白名单）下载文件名，不在页面正文显示 | — |

### board-actions

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `board-actions/BoardActions.tsx:169` | 已读取的官方位置已到此列；这不代替本次原命令的回执。结果未知或冲突时，仍沿原操作核对，原命令及输入继续保留。 | 「事项已在这一列。上次拖动的结果仍需确认，点击「核对结果」。」 | 看板拖动后结果未确认 |
| `board-actions/BoardActions.tsx:52` | 正在核验原事项及当前合法动作… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `board-actions/BoardConflictIntent.tsx:20` | 查看原 UUID、版本与完整命令 | 改为「复制诊断信息」按钮（诊断内容放在复制结果和 title 中，不出现在正文） | 看板拖拽冲突的详情 |

### conversations

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `conversations/ConversationComposer.tsx:111` | 结果未知：请求可能已提交。请只读核对原操作，或使用保留的原命令核对。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `conversations/ConversationComposer.tsx:112` | 恢复副本未保存，尚未发送；请保留输入并重新核验。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `conversations/ConversationComposer.tsx:126` | 发给本服务主题的原报修人；群来源通过 Bot 私聊回复。 | 「回复会发给报修人；在群里报修的，会通过医小修私聊回复。」— 名称待你确认 | 会话回复说明 |
| `conversations/ConversationComposer.tsx:126` | 回复将通过 Bot 私聊发送给 | 「回复将通过医小修私聊发送给」— 名称待你确认 | 会话回复对象 |
| `conversations/ConversationComposer.tsx:128` | 用原命令核对 | 按钮「核对结果」 | 结果未确认后核对 |
| `conversations/ConversationComposer.tsx:45` | 无法核验原补充回复的草稿范围，敏感内容未恢复，尚未发送。 | 标题「草稿暂未恢复」· 说明「补充回复没有发送。重新打开会话后再试。」 | 打开补充回复时草稿无法找回 |
| `conversations/ConversationComposer.tsx:51` | 正在核验原补充回复的草稿范围… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `conversations/ConversationComposer.tsx:84` | 结果未知：请核对原操作，正文与版本保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `conversations/ConversationComposer.tsx:94` | 恢复副本清理尚未确认，请只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `conversations/ConversationComposer.tsx:97` | 连接尚未完成事实核验，新回复或备注尚未准备或发送；输入已保留，请刷新后重试。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `conversations/ConversationControl.tsx:23` | 连接尚未完成事实核验，新沟通操作尚未准备或发送；选择已保留，请刷新后重试。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `conversations/ConversationControl.tsx:27` | 操作结果未知：保留原命令，请核对当前沟通事实后用原命令核对。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `conversations/ConversationControl.tsx:40` | 用保留的原命令核对 | 按钮「核对结果」 | 结果未确认后核对 |
| `conversations/ConversationInbox.tsx:39` | Bot 私聊来源 | 「医小修私聊」— 名称待你确认 | 会话来源标签 |
| `conversations/ConversationInbox.tsx:42` | Bot 私聊回复 | 「医小修私聊回复」— 名称待你确认 | 会话消息标签 |
| `conversations/ConversationInbox.tsx:42` | Bot 私聊规则回复 | 「医小修自动回复」— 名称待你确认 | 会话消息标签 |
| `conversations/Conversations.tsx:39` | 正在核验会话… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |

### drafts

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `drafts/use-note-draft.ts:144` | 正在核对已清理的恢复副本… | 「正在清除草稿…」 | 清空草稿时 |
| `drafts/use-note-draft.ts:148` | 恢复副本已清理。 | 「草稿已清除」 | 清空草稿后 |
| `drafts/use-note-draft.ts:149` | 恢复副本清理状态无法核验；不会发送新的操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `drafts/use-note-draft.ts:180` | 恢复副本清理失败；请保留当前输入。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `drafts/use-note-draft.ts:193` | 原操作结果已确认，但恢复副本清理失败；禁止新提交，请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `drafts/use-note-draft.ts:194` | 已提交；恢复副本已清理。 | 「已提交」 | 提交成功 |
| `drafts/use-note-draft.ts:31` | 恢复不可用：恢复副本超出16 KiB（16384 bytes），本次未发送；请减少当前输入。 | 标题「内容过长」· 说明「草稿无法保存，本次没有提交。请删减后再提交。」 | 备注超长 |
| `drafts/use-note-draft.ts:33` | 恢复不可用：当前输入未保存为恢复副本；本次不会发送新的操作。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `drafts/use-note-draft.ts:85` | 已保存恢复副本；最长24小时。 | 「草稿已保存」（悬停：「仅保存在这台电脑，24 小时后自动清除」） | 输入内部备注后自动保存 |

### efficiency

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `efficiency/WorkbenchEfficiency.tsx:19`<br>`efficiency/WorkbenchEfficiency.tsx:24`<br>`efficiency/WorkbenchEfficiency.tsx:84`<br>`efficiency/WorkbenchEfficiency.tsx:85` | 搜索与命令 | 「搜索与快捷操作」/「关闭快捷操作」 | 打开全局搜索面板 |
| `efficiency/WorkbenchEfficiency.tsx:85` | 关闭命令面板 | 「搜索与快捷操作」/「关闭快捷操作」 | 打开全局搜索面板 |

### follow-up

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `follow-up/SharedFollowUp.tsx:138` | 北京时间（Asia/Shanghai），由当前处理和沟通责任共同跟进。 | 「北京时间。处理人和沟通人都会看到这次跟进。」 | 设置跟进时间 |
| `follow-up/SharedFollowUp.tsx:78` | 恢复副本未确认，操作尚未发送；输入仍保留，可先清空或处理已有草稿。 | 「草稿未能保存，本次没有提交。可以先清空草稿再试。」 | 跟进时间草稿写入失败 |
| `follow-up/SharedFollowUp.tsx:91` | 尚未发送：恢复副本未确认，请保留原操作只读核对。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `follow-up/SharedFollowUp.tsx:98` | 请填写有效的北京时间，格式为 YYYY-MM-DD HH:mm:ss。 | 「请填写正确的时间，例如 2026-11-12 14:30:00。」（解析要求到秒） | 跟进时间格式错误 |

### incident-candidates

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `incident-candidates/CandidateDecisionForm.tsx:115` | 明确重放原操作（保留原 UUID 和正文） | 按钮「重新提交」；提示「将按原内容再提交一次。」 | 结果未确认后选择再次提交 |
| `incident-candidates/CandidateDecisionForm.tsx:33` | 原操作仍未知；请先只读核对原 UUID。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/CandidateDecisionForm.tsx:56` | ；恢复副本清理失败，原 UUID 已保留，禁止新提交，请只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/CandidateDecisionForm.tsx:59` | 恢复副本清理失败，原 UUID 已保留，禁止新提交，请只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/CandidateDecisionForm.tsx:61` | 结果未知：原 UUID、版本、材料依据和正文保持不变，请先只读核对。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/CandidateDecisionForm.tsx:68` | 原操作已确认提交；恢复副本清理失败，禁止新提交，请继续只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/CandidateDecisionForm.tsx:69` | 恢复副本清理失败，原 UUID 已保留，禁止新提交，请继续只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/CandidateDetail.tsx:29` | 当前决定权限已撤销；恢复副本清理尚未确认，请保持页面关闭。 | 标题「已不能处理」· 说明「你已没有处理权限。请关闭此页面。」 | 候选决定权限变化 |
| `incident-candidates/CandidateDetail.tsx:41` | · 版本 | （删除；如需排查，放进「复制诊断信息」） | 候选详情字段 |
| `incident-candidates/CandidateDetail.tsx:45` | Bot 材料 | 「医小修收集的材料」— 待你确认对外名称 | 公共故障候选材料 |
| `incident-candidates/CandidateDetail.tsx:46` | 所有决定由工作人员明确作出；确认只产生独立 Incident，不合并或关闭个人工单。 | 「由你确认。确认后会新建一个公共故障，不会合并或关闭原来的工单。」 | 公共故障候选详情 |
| `incident-candidates/IncidentCandidates.tsx:27` | 候选依据版本 | （删除；如需排查，放进「复制诊断信息」） | 候选列表字段 |
| `incident-candidates/IncidentDeliveryControls.tsx:116` | 当前完整原操作不可重放；原 UUID 和已知结果保留，仅明确只读核对。 | 「上次的内容已不完整，不能重新提交。点击「核对结果」。」 | 草稿内容缺失时 |
| `incident-candidates/IncidentDeliveryControls.tsx:121` | 原操作正文已过期；原 UUID 和已知结果保留，只能只读核对。 | 「上次的输入已过期，只能查看结果。点击「核对结果」。」 | 草稿超过 24 小时 |
| `incident-candidates/IncidentDeliveryControls.tsx:131`<br>`item-follow/ItemFollow.tsx:82` | 会话已退出，请重新核验。 | 「登录已过期，请重新登录。」 | 登录过期或在其它窗口退出 |
| `incident-candidates/IncidentDeliveryControls.tsx:155` | 原结果已核对并保持；恢复副本清理未确认，保留原 UUID，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentDeliveryControls.tsx:157` | 原操作已明确拒绝；输入保留，请重新读取并明确采用当前快照。 | 「上次操作没有成功，输入还在。点击「使用最新内容」后重试。」 | 通知控制被拒 |
| `incident-candidates/IncidentDeliveryControls.tsx:163` | 原拒绝已确认，当前事实尚未读回；原 UUID 保留，请只读核对。 | 「上次操作没有成功。最新内容还没加载完，点击「核对结果」。」 | 通知控制被拒后读取未完成 |
| `incident-candidates/IncidentDeliveryControls.tsx:163` | 原提交已确认，当前事实尚未读回；原 UUID、正文和版本保留，请只读核对。 | 「已提交。最新内容还没加载完，点击「核对结果」。」 | 通知控制提交后读取未完成 |
| `incident-candidates/IncidentDeliveryControls.tsx:186` | 本次未发送，恢复清理未确认；原 UUID 保留，先只读核对。 | 标题「草稿未能清空」· 说明「本次没有提交。点击「核对结果」后重试。」 | 通知控制 |
| `incident-candidates/IncidentDeliveryControls.tsx:187` | 原提交已收到确认，后续读取尚未完成；保留原 UUID、正文和版本，请只读核对。 | 「已提交。最新内容还没加载完，点击「核对结果」。」 | 通知控制提交后读取未完成 |
| `incident-candidates/IncidentDeliveryControls.tsx:187` | 通知操作结果未知；保留原 UUID、正文和版本，先只读核对，不能创建新操作。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentDeliveryControls.tsx:196` | 原提交已知确认；本次未读到终态，不改写已有 ACK，没有发送新操作。 | 「已提交。最新结果暂时读不到，没有重复提交。」 | 通知控制核对 |
| `incident-candidates/IncidentDeliveryControls.tsx:200` | 本次只读核对未完成，原 UUID 和已知结果保留，没有发送新操作。 | 「这次核对没有完成，没有重复提交。点击重试。」 | 核对结果时网络失败 |
| `incident-candidates/IncidentDeliveryControls.tsx:205` | 当前事实已读取，捕获输入保持；请明确采用当前快照。 | 「已获取最新内容，输入还在。点击「使用最新内容」后再提交。」 | 通知控制 |
| `incident-candidates/IncidentDeliveryControls.tsx:225` | 原通知路（当前分页窗口外，提交时核验） | 「原通知渠道（已选，提交时确认）」 | 通知渠道不在当前列表页 |
| `incident-candidates/IncidentDeliveryControls.tsx:229` | 已清除尚未提交的本路输入；此页没有保存恢复副本。 | 「已清空未提交的输入。」 | 清空输入 |
| `incident-candidates/IncidentDeliveryControls.tsx:229` | 当前事实已变化或原路不在当前窗口，须重新读取并明确采用当前快照。 | 「内容已更新，请点击「使用最新内容」后再提交。」 | 通知控制内容被更新 |
| `incident-candidates/IncidentDeliveryControls.tsx:229` | 明确采用当前路快照 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |
| `incident-candidates/IncidentDeliveryControls.tsx:37` | 当前通知控制用途或此公共故障已失权，原输入和恢复副本停止展示。 | 「你已不能操作此公共故障的通知，输入已隐藏。」 | 通知控制权限变化 |
| `incident-candidates/IncidentDeliveryControls.tsx:49` | 恢复或授权读取尚未完成，原 UUID 保留；不会发起新操作。 | 标题「草稿暂未恢复」· 说明「内容仍保存在本机，网络恢复后会自动找回。」 | 打开详情时，草稿暂时无法找回 |
| `incident-candidates/IncidentDeliveryControls.tsx:78` | 当前完整原操作不可重放；原 UUID 保留，请明确只读核对。 | 「上次的内容已不完整，不能重新提交。点击「核对结果」。」 | 草稿内容缺失时 |
| `incident-candidates/IncidentDeliveryControls.tsx:82` | 已恢复原通知路、UUID、正文和版本；先只读核对，不会自动发送。 | 「已找回上次的通知内容。先点击「核对结果」，不会自动发送。」 | 通知控制结果未确认后刷新 |
| `incident-candidates/IncidentDeliveryControls.tsx:85` | 当前输入和此用途的恢复副本已清除。 | 「已清空输入和草稿。」 | 清空输入 |
| `incident-candidates/IncidentDeliveryControls.tsx:98` | 当前身份、授权或开关已更新；原 UUID 和已知结果保留，只读核对后才能继续。 | 「你的权限有变化。先点击「核对结果」，再继续操作。」 | 权限或功能开关变化 |
| `incident-candidates/IncidentFollowup.tsx:112` | 恢复副本清理失败；已知提交保持，原 UUID 保留，禁止新提交，请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentFollowup.tsx:116` | 授权上下文已更新，原操作结果仍未知；原 UUID、版本和正文保留，不能发起新操作。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentFollowup.tsx:118` | 尚未重放；原操作结果仍未知、UUID 和正文保持，请再次只读核对。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentFollowup.tsx:119` | 恢复副本清理失败；原 UUID 保留，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentFollowup.tsx:120` | 结果未知：原 UUID、父子版本和正文保留。当前状态读取不能确认原操作结果；请核对原操作，不能重复提交。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentFollowup.tsx:124` | 恢复副本清理失败，原 UUID 保留，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentFollowup.tsx:137` | 保留已选主工单（当前窗口外，提交时核验） | 「（已选，提交时确认）」 | 已选项不在当前列表页 |
| `incident-candidates/IncidentFollowup.tsx:138` | 保留已选来源（当前窗口外，提交时核验） | 「（已选，提交时确认）」 | 已选项不在当前列表页 |
| `incident-candidates/IncidentFollowup.tsx:141` | 保留原渠道选择（当前窗口外，提交时核验） | 「（已选，提交时确认）」 | 已选项不在当前列表页 |
| `incident-candidates/IncidentFollowup.tsx:142` | 已明确采用当前公共故障版本；原子目标版本与输入保留，请核对后提交。 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |
| `incident-candidates/IncidentFollowup.tsx:142` | 当前事实已变化，需要明确采用当前版本。 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |
| `incident-candidates/IncidentFollowup.tsx:142`<br>`incident-candidates/IncidentInternalNotes.tsx:70`<br>`incident-candidates/IncidentOwnerTransfer.tsx:82`<br>`incident-candidates/IncidentPublicProgress.tsx:79` | 明确采用当前版本 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |
| `incident-candidates/IncidentFollowup.tsx:148` | 恢复副本仅在当前浏览器保留。 | 「草稿仅保存在这台电脑。」 | 表单说明 |
| `incident-candidates/IncidentFollowup.tsx:148` | 此页未保存跨刷新恢复副本。 | 「此页不保存草稿，刷新后输入会丢失。」 | 表单说明 |
| `incident-candidates/IncidentFollowup.tsx:150` | 明确重放原操作（原 UUID 和正文） | 按钮「重新提交」；提示「将按原内容再提交一次。」 | 结果未确认后选择再次提交 |
| `incident-candidates/IncidentFollowup.tsx:78` | 原操作结果未知；原 UUID、正文和捕获版本已恢复，不会自动发送。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentFollowup.tsx:97` | 正在核对当前权限和公共故障版本… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `incident-candidates/IncidentInternalNotes.tsx:33`<br>`incident-candidates/IncidentPublicProgress.tsx:35` | 内容已停止展示；恢复副本清理尚未确认，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentInternalNotes.tsx:35`<br>`incident-candidates/IncidentOwnerTransfer.tsx:46`<br>`incident-candidates/IncidentPublicProgress.tsx:37` | 恢复读取暂未完成，原加密副本保留；请重新载入页面后核验，当前禁止提交。 | 标题「草稿暂未恢复」· 说明「内容仍保存在本机，网络恢复后会自动找回。」 | 打开详情时，草稿暂时无法找回 |
| `incident-candidates/IncidentInternalNotes.tsx:45`<br>`incident-candidates/IncidentPublicProgress.tsx:47` | 已恢复原 UUID、正文及提交版本；结果未知，不会自动发送。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentInternalNotes.tsx:46` | 内部处置已提交；恢复副本清理未确认，只能核对原操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentInternalNotes.tsx:58` | 内部处置已提交；恢复副本清理未确认，禁止新提交，请只读核对重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentInternalNotes.tsx:63`<br>`incident-candidates/IncidentPublicProgress.tsx:65` | 。输入保留，请重新核对当前版本。 | 「。你的输入还在，查看最新内容后再提交。」（句子后半段，前半段由失败原因拼接） | 公共故障备注 / 进展失败 |
| `incident-candidates/IncidentInternalNotes.tsx:63`<br>`incident-candidates/IncidentPublicProgress.tsx:65` | 尚未重放；原 UUID、正文及版本保持，请再次只读核对。 | 「还没有重新提交，请先点击「核对结果」。」 | 结果未确认时的提示 |
| `incident-candidates/IncidentInternalNotes.tsx:63`<br>`incident-candidates/IncidentPublicProgress.tsx:65` | 提交结果未知：保留原 UUID、正文及版本，先只读核对，不创建新操作。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentInternalNotes.tsx:66`<br>`incident-candidates/IncidentPublicProgress.tsx:68` | 原操作已明确失败；正文保留，请重新核对当前版本。 | 「上次提交没有成功，内容还在，确认后重试。」 | 公共故障备注/进展失败 |
| `incident-candidates/IncidentInternalNotes.tsx:66`<br>`incident-candidates/IncidentPublicProgress.tsx:68` | 已知提交保留，恢复副本清理尚未完成。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentOwnerTransfer.tsx:43` | 输入已停止展示；恢复副本清理未确认，禁止新交接。 | 标题「草稿未能清空」· 说明「为避免重复交接，暂时只能查看。点击重试。」 | 交接权限变化后 |
| `incident-candidates/IncidentOwnerTransfer.tsx:57` | 原 UUID、交接正文与版本已恢复；结果未知，不会自动交接。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentOwnerTransfer.tsx:58` | 交接已提交；恢复副本清理未确认，只能核对原操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentOwnerTransfer.tsx:65` | 交接已提交；恢复副本清理未确认，禁止新提交，请只读核对重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentOwnerTransfer.tsx:69` | 。输入保留，请核对当前事实与版本。 | 「。你的输入还在，查看最新内容后再提交。」（句子后半段） | 公共故障交接失败 |
| `incident-candidates/IncidentOwnerTransfer.tsx:69` | 交接结果未知：保留原 UUID、正文与版本，先只读核对，不创建新操作。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `incident-candidates/IncidentOwnerTransfer.tsx:69` | 尚未重放；原 UUID、正文和版本保留，请再次只读核对。 | 「还没有重新提交，请先点击「核对结果」。」 | 结果未确认时的提示 |
| `incident-candidates/IncidentOwnerTransfer.tsx:72` | 原交接已明确失败；请核对当前目标与版本。 | 「上次交接没有成功，请确认接收人后重试。」 | 公共故障交接失败 |
| `incident-candidates/IncidentOwnerTransfer.tsx:72` | 已知交接结果保留；恢复副本清理未确认。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentOwnerTransfer.tsx:79` | 保留原选择（窗口外，提交时重新核验） | 「（已选，提交时确认）」 | 已选项不在当前列表页 |
| `incident-candidates/IncidentOwnerTransfer.tsx:80` | 保留原团队（提交时重新核验） | 「（已选，提交时确认）」 | 已选项不在当前列表页 |
| `incident-candidates/IncidentOwnerTransfer.tsx:85` | 明确重放原交接（原 UUID 和正文） | 按钮「重新提交」；提示「将按原内容再提交一次。」 | 结果未确认后选择再次提交 |
| `incident-candidates/IncidentPublicProgress.tsx:48` | 公开进展已提交；恢复副本清理未确认，只能核对原操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentPublicProgress.tsx:60` | 公开进展已发布；个人工单不变，按路结果单独核验。 | 「公开进展已发布。各工单不变，通知结果分别显示。」 | 公共故障公开进展 |
| `incident-candidates/IncidentPublicProgress.tsx:60` | 公开进展已提交；恢复副本清理未确认，禁止新提交，请只读核对重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `incident-candidates/IncidentResult.tsx:25` | 公共故障版本 | （删除；如需排查，放进「复制诊断信息」） | 公共故障结果页字段 |
| `incident-candidates/IncidentResult.tsx:27` | 这是独立 Incident 的当前投影；个人工单仍保持各自的状态与责任，确认不代表通知已发送。 | 「这是公共故障的汇总。各工单的状态和负责人不变；确认不代表通知已发出。」 | 公共故障结果页 |
| `incident-candidates/use-incident-draft.ts:35` | 恢复副本清理尚未确认；当前内容已停止展示，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |

### item-follow

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `item-follow/ItemFollow.tsx:126` | 恢复副本未能确认，关注操作尚未发送。 | 「关注没有提交：本机草稿未能保存。点击重试。」 | 点击关注时浏览器存储不可用 |

### manual-report

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `manual-report/ManualReportForm.tsx:107` | 恢复副本清理尚未确认，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `manual-report/ManualReportForm.tsx:132` | 已明确选择报修人，提交时将重新核验身份及通知资格；本次受理不表示通知已送达。 | 「已选择报修人。提交后是否能通知到他，以通知结果为准。」 | 代录报修选择报修人 |
| `manual-report/ManualReportForm.tsx:132` | 正在核验当前代录权限… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `manual-report/ManualReportForm.tsx:56` | 当前身份已没有代录权限，输入及恢复副本已清理。 | 「你已没有代录权限，输入已清空。」 | 代录权限被收回 |
| `manual-report/ManualReportForm.tsx:68` | 成员选择已被拒绝，但恢复副本尚未核对，请先只读核对原操作。 | 「选择的报修人不可用。请先点击「核对结果」。」 | 代录成员被拒 |
| `manual-report/ManualReportForm.tsx:72` | 当前代录权限暂无法核验，输入已保留；请重新读取代录权限。 | 「暂时无法确认代录权限，输入已保留。点击重试。」 | 代录权限读取失败 |
| `manual-report/ManualReportForm.tsx:80` | 恢复副本清理尚未确认，禁止新提交；请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `manual-report/ManualReportForm.tsx:84` | 连接尚未完成事实核验，报修尚未发送；输入已保留，请重新读取。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `manual-report/ManualReportForm.tsx:86` | 报修内容超出16 KiB，请减少输入后再提交。 | 「报修内容过长，请删减后再提交。」 | 代录报修超长 |
| `manual-report/ManualReportForm.tsx:99` | 恢复副本未保存，本次尚未发送；请保留并检查当前输入。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `manual-report/ManualSelfHandlingForm.tsx:43` | 连接尚未完成事实核验，原输入保留；本次尚未发送。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `manual-report/ManualSelfHandlingForm.tsx:54` | 恢复副本尚未保存，本次未发送；请保留当前输入。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `manual-report/ManualSelfHandlingForm.tsx:62` | 恢复副本清理未完成，禁止新提交。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `manual-report/use-manual-self-handling-draft.ts:60` | 恢复核验暂未完成，原副本保留；请重新读取页面，不会发送新操作。 | 标题「草稿暂未恢复」· 说明「内容仍保存在本机，重新打开详情后会自动找回。」 | 代录自行处理草稿找回失败 |

### manual-review

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `manual-review/ReviewStartControls.tsx:114` | 处理或沟通版本已变化；原选择仍保留，请读取后明确重新采用当前材料。 | 标题「工单已被更新」· 说明「查看最新内容后再操作。」 | 打开表单期间工单被他人修改 |
| `manual-review/ReviewStartControls.tsx:24` | 结果未知：敏感副本不可用，请先核对上次操作。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `manual-review/ReviewStartControls.tsx:50` | 原操作已确认提交，但恢复副本清理尚未确认。禁止新操作，请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `manual-review/ReviewStartControls.tsx:71` | 恢复副本未确认，本次尚未发送；原意图保留，禁止自动重试。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `manual-review/ReviewStartControls.tsx:80` | 原操作失败已确认，但恢复副本清理尚未确认。禁止新操作，请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `manual-review/ReviewStartControls.tsx:95` | 已明确采用当前材料与责任版本；只有再次确认才创建新操作并提交。 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |
| `manual-review/ReviewWorkspace.tsx:102` | 结果未知：可能已经记录。请核对上次操作，结论、原因、版本和材料摘要保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `manual-review/ReviewWorkspace.tsx:106` | 恢复副本未保存，本次尚未发送；请保留当前选择。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `manual-review/ReviewWorkspace.tsx:71` | 结果未知：已恢复原命令，结论、原因、版本和材料摘要保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `manual-review/ReviewWorkspace.tsx:90` | 本地恢复副本清理尚未确认，禁止新提交；请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `manual-review/use-review-start-draft.ts:104` | 恢复核验暂未完成；当前不会发送新操作，请保持原副本并重新读取。 | 标题「草稿暂未恢复」· 说明「内容仍保存在本机，网络恢复后会自动找回。」 | 打开详情时，草稿暂时无法找回 |

### reminders

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `reminders/WorkbenchReminders.tsx:155` | 请回到工作台核验当前事项。 | 「请回到工作台查看这个事项。」 | 提醒定位失败 |

### search

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `conversations/ConversationAssociatedItem.tsx:36`<br>`conversations/ConversationInbox.tsx:42`<br>`conversations/ConversationInbox.tsx:65`<br>`search/WorkbenchSearch.tsx:17` | Bot 私聊 | 「医小修私聊」— 名称待你确认 | 会话来源标签 |

### source-groups

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `source-groups/GroupNameEditor.tsx:18` | 保存冲突：名称已保留。请核对并明确采用最新版本后再保存。 | 标题「名称已被他人修改」· 说明「你的输入还在，查看最新名称后再保存。」+「查看最新」 | 群名称冲突 |
| `source-groups/GroupNameEditor.tsx:25` | 结果未知：请求可能已保存。请核对原操作，原名称、版本和命令保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `source-groups/GroupNameEditor.tsx:33` | 连接尚未完成事实核验，新名称尚未发送；输入和版本已保留，请重新读取。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `source-groups/GroupNameEditor.tsx:40` | 已采用当前群资料版本；输入名称仍保留，请确认后保存。 | 「已更新为最新资料，你输入的名称还在。」 | 群名称冲突后 |
| `source-groups/GroupNameEditor.tsx:41` | 当前群资料读取失败，输入和原版本已保留，请重新核对。 | 「群资料读取失败，输入已保留。点击重试。」 | 群名称读取失败 |
| `source-groups/GroupNameEditor.tsx:46` | 群资料版本已达到维护上限。 | 「这个群的名称已修改太多次，暂时不能再改。」 | 修改群名称 |
| `source-groups/GroupNameEditor.tsx:46` | 重新读取并采用最新版本 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |

### supplement-follow-up

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `supplement-follow-up/SupplementFollowUp.tsx:106` | 恢复副本清理失败，请核对上次操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `supplement-follow-up/SupplementFollowUp.tsx:112` | 恢复副本清理失败，须只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `supplement-follow-up/SupplementFollowUp.tsx:125` | 恢复副本清理失败，须继续只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `supplement-follow-up/SupplementFollowUp.tsx:139` | 回复成功已核验 | 「已回复」 | 补充材料回复 |
| `supplement-follow-up/SupplementFollowUp.tsx:84` | 当前补充重新读取失败，原命令结果未变化。 | 「补充材料暂时读取失败，点击重试。」 | 补充材料读取失败 |
| `supplement-follow-up/SupplementFollowUp.tsx:93` | 恢复副本未保存，本次尚未发送；原输入已保留。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |

### ticket-assignment

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-assignment/TicketAssignment.tsx:25` | 结果未知：已恢复原操作，原动作与版本保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-assignment/TicketAssignment.tsx:32`<br>`ticket-assignment/TicketAssignment.tsx:34` | 恢复副本清理尚未确认，禁止新操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-assignment/TicketAssignment.tsx:33` | 结果未知，原操作可能已提交；原动作、版本与选择保持不变，勿重复提交。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |

### ticket-completion

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-completion/TicketCompletion.tsx:24` | 结果未知：请核对原完工操作；原版本、轮次和正文保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-completion/TicketCompletion.tsx:42` | 恢复副本未保存，本次尚未发送；请保留输入并恢复浏览器存储。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `ticket-completion/TicketCompletion.tsx:45` | 恢复副本清理失败，禁止新提交；请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-completion/TicketCompletion.tsx:49` | 完工冲突：独立输入已保留，请读取当前版本和轮次后明确新的操作。 | 标题「内容已被他人更新」· 说明「你的修改还在，查看最新内容后再保存。」+ 按钮「查看最新」 | 同一事项被同事同时修改 |
| `ticket-completion/TicketCompletion.tsx:50` | 结果未知：完工可能已提交。请核对原操作；原操作、版本、轮次和正文保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-completion/TicketCompletion.tsx:59` | 恢复副本清理失败，禁止新提交；请重试只读核对。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |

### ticket-handling

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-handling/TicketConversationHandling.tsx:23` | 结果未知：已恢复原操作，请核对原动作与版本。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-handling/TicketConversationHandling.tsx:35`<br>`ticket-handling/TicketConversationHandling.tsx:43` | 本地副本清理尚未确认，禁止新操作。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-handling/TicketConversationHandling.tsx:36` | 操作冲突：原会话选择保留，请重新读取并确认版本。 | 标题「内容已被他人更新」· 说明「你的修改还在，查看最新内容后再保存。」+ 按钮「查看最新」 | 同一事项被同事同时修改 |
| `ticket-handling/TicketConversationHandling.tsx:36` | 结果未知：请核对原操作；原动作、工单版本、会话选择及版本保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-handling/TicketConversationHandling.tsx:40` | 连接尚未完成事实核验，新操作尚未准备或发送；选择已保留，请重新读取。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `ticket-handling/TicketConversationHandling.tsx:41` | 恢复副本尚未保存，操作尚未发送。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `ticket-handling/TicketConversationHandling.tsx:96` | 原冲突意图的本地终态清理未确认，原 UUID 和会话选择继续保留。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-handling/TicketConversationHandling.tsx:96` | 已保留会话选择，请核对当前可选会话和版本后明确新的操作。 | 「会话选择已保留，请确认后再提交。」 | 冲突后重新选择会话 |
| `ticket-handling/TicketSelfHandling.tsx:32` | 结果未知：请求可能已提交。请核对原操作结果，原动作、版本和处理组保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-handling/TicketSelfHandling.tsx:36` | 连接尚未完成事实核验，新处理操作尚未发送；请重新读取。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |

### ticket-notes

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-notes/TicketNotes.tsx:18` | 结果未知：已恢复原操作，请核对保存结果。正文和版本保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-notes/TicketNotes.tsx:36`<br>`ticket-notes/TicketNotes.tsx:51` | 本地恢复副本清理失败，禁止新提交；请只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-notes/TicketNotes.tsx:38` | 保存冲突：内容已保留，请重新读取版本后确认新的操作。 | 标题「内容已被他人更新」· 说明「你的修改还在，查看最新内容后再保存。」+ 按钮「查看最新」 | 同一事项被同事同时修改 |
| `ticket-notes/TicketNotes.tsx:39` | 结果未知：请求可能已保存。请核对原操作结果，正文和版本保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-notes/TicketNotes.tsx:43` | 连接尚未完成事实核验，新操作尚未准备或发送；输入已保留，请重新读取。 | 标题「网络未就绪」· 说明「网络恢复前不会提交，你的输入已保留。」 | 断网或刚恢复连接时点击提交 |
| `ticket-notes/TicketNotes.tsx:46` | 原操作仍未知；恢复存储不可用，已保留原命令，尚未再次发送。 | 标题「结果未确认」· 说明「本机草稿暂时无法保存，没有重复提交。点击「核对结果」。」 | 核对结果时浏览器存储不可用 |
| `ticket-notes/TicketNotes.tsx:46` | 恢复副本未保存，原操作尚未发送。请保留输入并恢复浏览器存储后再试。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `ticket-notes/TicketNotes.tsx:51` | 较新的未提交输入已保留，请读取当前版本后明确提交。 | 「你后来输入的内容还在，确认后再提交。」 | 备注结果核对后 |
| `ticket-notes/TicketNotes.tsx:54` | 正在读取工单动作与版本… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `ticket-notes/TicketNotes.tsx:56` | 正在重新核验工单动作… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |

### ticket-reopen

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-reopen/TicketReopen.tsx:53` | 工单版本或状态已变化，请重新读取后确认新的操作。 | 标题「工单已被更新」· 说明「查看最新内容后再操作。」 | 打开表单期间工单被他人修改 |
| `ticket-reopen/TicketReopen.tsx:54` | 尚未发送：恢复副本未确认，不能发起新操作，请保留原操作 只读核对。 | 标题「草稿未能保存」· 说明「本次没有提交，你的输入还在。检查浏览器存储后重试。」 | 提交前本机草稿写不进浏览器（隐私模式、存储已满） |
| `ticket-reopen/TicketReopen.tsx:67` | 已核对原操作被拒绝；已读取当前权限与版本，请明确发起新的操作。 | 「上次操作没有成功，请重新操作。」 | 重开工单被拒 |

### ticket-takeover

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-takeover/TicketTakeover.tsx:28` | 结果未知：已恢复原操作，原动作、UUID 和版本保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-takeover/TicketTakeover.tsx:37` | 结果未知，原操作可能已提交；原动作、UUID、版本和选择保持不变，请核对原操作。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |

### ticket-takeover-completion

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-assignment/use-assignment-draft.ts:48`<br>`ticket-takeover-completion/use-takeover-completion-draft.ts:45`<br>`ticket-takeover/use-takeover-draft.ts:44` | 恢复核验暂时不可用，已保留加密副本；请恢复服务后刷新重试。 | 标题「草稿暂未恢复」· 说明「内容仍保存在本机，网络恢复后会自动找回。」 | 打开详情时，草稿暂时无法找回 |
| `ticket-completion/TicketCompletion.tsx:79`<br>`ticket-reopen/TicketReopen.tsx:87`<br>`ticket-takeover-completion/TicketTakeoverCompletion.tsx:70`<br>`ticket-takeover/TicketTakeover.tsx:57` | 原冲突意图的本地终态清理未确认，原 UUID 和输入继续保留。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-takeover-completion/TicketTakeoverCompletion.tsx:34` | 结果未知：已恢复原操作，原 UUID、正文、版本和轮次保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-takeover-completion/TicketTakeoverCompletion.tsx:44`<br>`ticket-takeover/TicketTakeover.tsx:36` | 原操作已提交；恢复副本清理尚未确认，禁止新操作，请只读核对后重试清理。 | 标题「草稿未能清空」· 说明「已提交。为避免重复提交，暂时只能查看。点击重试。」 | 接管/接管完工 |
| `ticket-takeover-completion/TicketTakeoverCompletion.tsx:45` | 结果未知，原操作可能已提交；原 UUID、正文、版本和轮次保持不变。 | 标题「结果未确认」· 说明「网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。」 | 提交后网络中断，没收到结果 |
| `ticket-takeover-completion/TicketTakeoverCompletion.tsx:48`<br>`ticket-takeover/TicketTakeover.tsx:39` | 原操作终态已确认；恢复副本清理尚未确认，禁止新操作，请继续只读核对并重试清理。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |
| `ticket-takeover-completion/use-takeover-completion-draft.ts:45`<br>`ticket-takeover/use-takeover-draft.ts:44` | 原操作已核对，恢复副本已清理；请刷新页面后重新选择。 | 「已确认上次结果。请重新打开详情后再选择。」 | 接管核对后 |

### ticket-waiting

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `ticket-waiting/ClosureActions.tsx:172` | 正在核验操作权限… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `ticket-waiting/TicketWaitingActions.tsx:87` | 版本冲突：原因已保留，请读取当前版本后明确新的操作。 | 标题「内容已被他人更新」· 说明「你的修改还在，查看最新内容后再保存。」+ 按钮「查看最新」 | 同一事项被同事同时修改 |
| `ticket-waiting/TicketWaitingActions.tsx:96` | 敏感副本清理暂未确认，当前输入保留。 | 标题「草稿未能清空」· 说明「为避免重复提交，暂时只能查看。点击重试。」 | 提交已有结果，但本机草稿没删掉 |

### web-report

| 位置 | 现文案 | 建议文案 | 触发场景 |
|---|---|---|---|
| `web-report/WebReportSection.tsx:33` | 正在核验当前处理权限… | 「正在加载…」（或具体到对象：「正在加载可执行操作…」） | 打开详情或弹窗时的加载状态 |
| `web-report/WebReportSection.tsx:37` | 会话需要重新核验。原操作结果仍须核对。 | 「登录已过期。重新登录后点击「核对结果」。」 | 公开进度提交后登录过期 |
| `web-report/WebReportSection.tsx:38` | 本次未提交成功，请重新读取版本并确认公开内容。 | 「没有提交成功。查看最新内容后再确认。」 | 公开进度提交失败 |
| `web-report/WebReportSection.tsx:48` | 当前报修资料已停止展示，请重新核验权限。 | 「你暂时无法查看报修资料，请重新打开详情。」 | 公开进度权限变化 |
| `web-report/WebReportSection.tsx:48` | 重新核验读取权限 | 按钮「重新加载」 | 公开进度读取被拒绝 |
| `web-report/WebReportSection.tsx:63` | 工单版本已变化。请重新核对当前资料并确认内容。 | 标题「工单已被更新」· 说明「查看最新内容后再操作。」 | 打开表单期间工单被他人修改 |
| `web-report/WebReportSection.tsx:63` | 采用当前版本并重新确认 | 按钮「使用最新内容」；提示「已更新为最新内容，确认后再提交。」 | 内容被他人更新后，选择以最新内容为准 |

