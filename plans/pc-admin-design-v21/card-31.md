# 卡31：侧栏在线同事（前后端）

本地交付：2026-11-08（Asia/Shanghai）。环境：macOS、Node 24.18.0、本机 PostgreSQL 18.6、系统 Chrome。用户要求开始本卡并按此前流程提交推送；不合并。

## 输入与边界

- 基线：`origin/main` `d1749481`（卡 30A #163、卡 30B #167 已合并）；分支 `codex/v222-card31`。
- 依据：`prompts/pc-admin-v2.2.2_card31_prompt.md`（用户更新版）；原型 v2.2.3 01e 侧栏「在线同事」。读取 ADR-0057 与卡 30A / 30B 执行记录，复用在场版本号、提示与 1 秒节流、在场存储。

## S1 核对结论

1. SSE 每个连接的 `StreamState.principal` 是工作台认证上下文，含 `principal_id`；打开在 `streams.add`，关闭在 `cleanupStream`。连接上没有显示名，由在线读取时一次查询取得。
2. 没有按人判断「同团队 / 互相可见」的现成函数（现有授权都按事项）。采用：两人都是启用账号，且至少共同属于一个启用的处理团队；activity 为全局开关。已写入 ADR-0057「在线同事」。未新增表或字段。
3. 浏览器标签页隐藏会关闭实时连接（宽限后离线）；桌面端最小化 / 隐藏仅在开启提醒且未锁屏 / 休眠时保持连接，此时「在线」包含后台运行。未改行为。

## 编号清单

| 编号 | 结论 |
| --- | --- |
| S2 | 已完成。SSE：`onlinePrincipals()`（打开连接或 15 秒宽限内，读取时清理过期条目）与 `setOnlineChange()`（仅离线→在线时回调；最后一个连接关闭只记时间）。activity：在线集合并入版本号（加入由回调触发，宽限到期在下一次签名 / 读取时发现），`online()` 一次团队查询 + 一次遍历租约，排序编辑→查看→在线、同类按姓名，最多 50 人 + `total`。`GET /api/workbench/online` 在 activity HTTP 模块。 |
| S3 | 已完成。`workbench_activity_contracts.d.ts`（`WorkbenchOnlineView`）、`contracts/workbench_online_view.schema.json`（并登记到 `tools/ts-migration/resources.json`）、`docs/api/workbench/activity.md`、ADR-0057 追加「在线同事」（O1–O5、核对、最坏开销、隐私、回退）。 |
| S4 | 见下表。 |
| F1 | 已完成。侧栏底部账号上方的行；`design/components/PresenceStack`（3 个 20px 头像、重叠 5px、2px 侧栏底色间隔、7px 绿点、「+N」）；0 人「暂无」不可点击；折叠态人形图标 + 人数圆点。新增令牌 `--shadow-presence-stack-ring / -dot`。 |
| F2 | 已完成。弹出层 260 / 10 / 6、行高 36、状态配色、超过 50 人「另有 N 人在线」、底部说明；Enter 打开、Esc 关闭并归还焦点、点击外部关闭。 |
| F3 | 已完成。在线读取并入卡 30B 在场存储：与批量在场读取在同一个防抖里并行发出；不可见 / 离线 / 断开 / 关闭时隐藏且不请求，恢复立即读取；单独存放、仅侧栏订阅；失败静默，保留上次结果最多 30 秒（30 秒判断在下一次读取时进行）。 |
| F4 | 见下表。 |

## S4 / F4 实测

| 指标 | 要求 | 实测 |
| --- | --- | --- |
| 在线读取（64 个在线账号、128 条租约）| p95 < 10ms，无逐事项鉴权 | p95 0.034ms，0 次鉴权（`tests/wbint-t39-online-colleagues.test.mts`，团队查询以注入函数替代；真实服务额外一次 SQL） |
| 刷新页面（断开后 3 秒内重连）| 在线集合不变、不提示 | 总数保持 3，页面收到提示 0 次（真实 SSE） |
| 关闭全部连接 | 15 秒后消失，期间不新增定时器 | 10 秒时仍在、16 秒时消失；读取时判断 |
| 连续提示下的在线请求 | ≤ 提示数，且与批量在场请求同时发出 | 60 秒内在线读取 30 次、批量读取 30 次，未配对 0 |
| 在线人数变化时看板卡片渲染 | 0 | 0（MutationObserver） |

限制：测试认证最多 4 个会话、SSE 连接上限当前为 32（卡片写 64），64 连接规模以单元测试覆盖；真实浏览器用例为 3 位同事，未能出现「+N」与「超过 50 人」的真实截图（逻辑由单元测试与组件覆盖）。

## 验证

- `migration:build`、`gate.mjs types`、`verify-artifact.mjs`、`docs:agents:check`、Stylelint、ESLint、pc-admin `tsc` 通过。
- `wbint-t39-online-colleagues` 2/2、`pc-admin-card31` PASS；回归见 PR 说明。
- 截图 `docs/ui/evidence/v222-card31/`（macOS Chrome，DPR 1，**非 Windows**）：侧栏 0 人、有人、弹出层、折叠态；`receipt.json` 含全部实测值。

## 过程失败（保留）

- 新契约 Schema 首次未进入构建运行目录，登记到 `resources.json` 后通过。
- 浏览器用例初版让无编辑权限的同事登记编辑（403），改为工单负责人登记编辑。

## 审查后修复（PR #168）

- Codex P2（失败后在线数据可能长期不过期）：在线读取失败时，已有的 5 秒检查改为在「在场缓存非空或在线读取失败中」时运行；失败期间每次检查重试读取，距上次成功超过 30 秒即隐藏该行；读取恢复后停止检查。正常成功时不运行，空闲 0 定时器不变。浏览器用例实测：读取持续失败后约 28 秒隐藏，恢复后重新显示。
- Codex P2（50 人时弹出层超出视口）：弹出层限制最大高度（`100dvh` 减侧栏底部占位），名单区域滚动，标题、「另有 N 人在线」与说明固定。头像组「+N」改为按全部在线人数计算（`total − 3`）。浏览器用例以页面内显式合成的 55 人响应验证：弹出层顶部在视口内、名单可滚动、「+52」「另有 5 人在线」。截图 `sidebar-popover-55-synthetic.png`。
- 卡 30B 空闲用例：释放在场后的尾部读取（两次读取至少间隔 1.5 秒）偶尔落入 60 秒空闲窗口，窗口起点改为名牌消失后 6 秒；连续两次 0 请求 / 0 定时器。

## 回退

删除 `GET /api/workbench/online`、activity `setOnline`/`online`、SSE 在线跟踪、前端 `OnlineColleagues`、`PresenceStack` 与存储中的在线部分即可；卡 30A / 30B 行为不变。
