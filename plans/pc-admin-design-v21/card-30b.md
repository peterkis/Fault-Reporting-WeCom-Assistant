# 卡30B：工作台协作在场（PC 前端）

本地交付：2026-11-08（Asia/Shanghai）。环境：macOS、Node 24.18.0、本机 PostgreSQL 18.6、系统 Chrome。用户要求按最新附件开发并提交推送；不合并。

## 输入与边界

- 基线：`origin/main` `72478077`（卡 30A #163、卡 29 #165 均已合并）；分支 `codex/v221-card30b`。
- 依据：用户更新后的 `prompts/pc-admin-v2.2.1_card30_prompt.md`（B1 改为 01f V3「角标名牌」`PresenceTags`）；原型 `docs/ui/prototype/医小修 PC 管理端 v2.2.3 设计原型.html` 01e。卡 31 Prompt 同步更新入库，本卡不实现卡 31。
- 读取 ADR-0057 与卡 30A 执行记录：批量接口 `POST /api/workbench/activity/batch-view`、`field`、编辑者在前、看板范围提示与 1 秒节流。

## 编号清单

| 编号 | 结论 |
| --- | --- |
| B1 | 已完成。`design/components/PresenceTags`：18 高、内边距 6、圆角 4 4 4 0、11px/600 白字、阴影令牌；查看 `--brand`，编辑 `--tone-attention-solid`（已有令牌，#9A4A0A，白字对比度约 6.3:1）+ 10px 铅笔；1–2 人显示姓名（>4 字前 3 字 +「…」），≥3 人第一位 +「+N」深色；间距 4；`role=img` 与完整 `aria-label`。悬停 300ms 深色提示（头像 + 全名 + 动作，最多 8 行 +「另有 N 人」）。新增令牌：`--fs-2xs`（11px）、`--shadow-presence-tag`。提示用纯 CSS 延时实现而非 HeroUI Tooltip：名牌位于卡片链接内，Tooltip 触发器会在链接内引入可聚焦元素。淡入 150ms；消失为直接卸载（未做淡出）。 |
| B2 | 已完成。名牌 `top:-9px; right:12px`（实测），卡片高度不变（实测前后 124px）。有人在场时外圈 1.5px 同色替代色环（`data-ring` 不再输出）；因 `outline` 在 DPR 1 取整为 1px，改用阴影令牌 `--shadow-presence-viewing/-editing`（含悬停）。选中样式优先。已关闭卡片不读、不显示。未领取且有人在场：悬停在卡片下沿显示蓝色提示，不阻止领取、不改布局。看板分组主体为 HeroUI 折叠容器 `overflow: clip`，首张卡名牌被裁切，按卡片口径给分组主体顶部留 10px。 |
| B3 | 已完成。名牌在「问题」单元格最右（距右缘 12px，实测），行高 44 不变，行无外圈；折叠行不读。 |
| B4 | 已完成。抽屉顶栏在场胶囊（26 高、圆角 13，实测），保留 `data-workbench-activity`，含读屏全文；正文不再有纯文字。同字段编辑时输入区顶部橙色提示条（`::before` 生成内容，不锁定输入）。图标用「✎」字符：工作台 CSP 为 `default-src 'self'`，`data:` 图片不显示。 |
| B5 | 已完成。`features/activity/presence-store.ts`：`Map<kind:id, people>` + `useSyncExternalStore` 按键订阅；渲染集合变化 500ms、提示 1s 合并读取（已排队的读取吸收后续触发）；只读已渲染、未折叠的卡片，最多 100；单个 5 秒过期检查只在存储非空时运行；不可见 / 离线 / 断开 / `activity_enabled` 为假时清空、不请求，恢复立即读取；失败静默。抽屉单张读取与登记沿用 `ActivityPeople`。为接收提示，在 `realtime/workbench-realtime-client.mts` 增加 `onActivityHint` 回调、`useRealtime.ts` 传入（清单外最小改动，不改连接、事件与刷新语义）。 |
| B6 | 见下表。 |

## B6 性能测量（`tests/pc-admin-card30b.browser.test.mts`，真实 loopback HTTP + PG）

| 指标 | 要求 | 实测 |
| --- | --- | --- |
| 1 张卡在场变化时重渲的卡片 | 只有这 1 张 | 1 张（MutationObserver：9 张已渲染卡中只有变化的那张有 DOM 变动） |
| 10 秒内 20 次 `workbench.activity.changed` 的批量请求 | ≤ 10 | 9–10 次（两次运行） |
| 无人在场 60 秒 | 无批量请求、无运行中的 5 秒定时器 | 0 次请求、0 个 5 秒定时器 |

限制：卡片要求「看板 60 张卡」，测试夹具只有 9 张已渲染卡片（其余在折叠「显示剩余」中）；按卡片订阅的机制与卡片数量无关，结论适用，但未在 60 张卡上实测。

## 过程失败（保留）

- 在场存储首版以对象身份比较账号，会话对象在每次刷新被替换，读取结果被丢弃；改为按账号 + 授权版本比较后正常。
- 「+N」目标初选在折叠分组中（未渲染不读取），测试改为可见卡片。
- 外圈 1.5px 实测为 1px（`outline` 取整），改为阴影令牌。
- 名牌在折叠容器内被裁切，留出 10px（`overflow-clip-margin` 对该容器无效）。
- 提示条铅笔 `data:` 图片被 CSP 拦截，改为字符。
- 夹具新增可选 `presencePeerSessions`（为 林舟、陈悦、周宁、沈然 签发会话，测试认证上限 4 个），供多人在场用例；默认行为不变。

## 验证

- `migration:build`、`gate.mjs types`、`verify-artifact.mjs`、`docs:agents:check`、Stylelint、ESLint、pc-admin `tsc` 通过。
- `pc-admin-card30b` PASS；回归 `pc-admin-card12`（18）、`pc-admin-card29`、`pc-admin-design-foundation`、`wbint-t38-realtime`、`workbench-detail-restructure` 共 104/104 PASS；T38/T39 活动与实时套件 48/50，2 项失败（`wbint-t39-activity-boundaries` 的「trusted production Review input…」、`wbint-t39-related-review-activity`）在未修改的 main 上本机同样失败，非本卡引入，未改。
- 截图 `docs/ui/evidence/v221-card30b/`（macOS Chrome，DPR 1，**非 Windows**）：看板在场（查看 / 编辑 + 双人 / 三人 +2）、悬停提示、未领取提示、列表行、抽屉胶囊 + 同字段提示条；`receipt.json` 含全部实测值。未单独导出 2 倍局部图。

## 回退

删除 `PresenceTags`、`TicketPresence`、`presence-store.ts` 与相关调用，恢复 `ActivityPeople` 的纯文字输出、`onActivityHint` 两处接线与新增令牌即可；后端与契约无改动。
