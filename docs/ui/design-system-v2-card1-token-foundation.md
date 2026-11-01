# 设计系统 v2.0 · 卡 1 Token 底座

2026-11-01。本卡完成本地实现、四档视觉对照和相关回归；Stylelint 尚有 515 条待后续卡迁移，不能称全局样式检查通过。未提交、推送、创建 PR 或部署。

## 1. 改动摘要与候选

统一规范第四章的语义 Token 和 HeroUI 桥接，移除两套旧根定义；按用户确认直接采用 v2 尺寸，接受本卡字号及布局变化。

- 保留当前分支 `codex/pc-admin-design-v2-card0` 和卡 0 的全部未提交工作。
- 起点 head：`8ad55a19bf5d3ab6d46e534c345cea17eb634e8a`。被测对象是该 head 加本地未提交改动，不把 head 单独称为最终候选。
- 最终构建输入指纹：`6d644e652818540ccd8ec850b420b58ad75219e47ccfe917e697aa4989133a02`。
- 最终 manifest SHA-256：`4bac4d499d026493c236d165331abdf5a649114ce2c4ba36d04bbad90f6ad1e3`。
- 环境：Windows、Node.js 24.18.0、仓库锁定的依赖、任务自有 loopback PostgreSQL 18、现有系统浏览器/CDP 合成夹具。

用户在实施前选择“直接使用 v2 尺寸，接受本卡字号与布局变化”。此选择替代任务卡原来的“无布局变化”验收限制，已同步到[规范 §9.3](design-system.md#93-落地顺序不改业务合同每步独立可发布)。

## 2. 文件清单与范围

以下只列卡 1 增量，不把已有的卡 0 包、锁文件、AGENTS 和原始规范接入归为本卡改动。

| 操作 | 文件 | 用途 |
| --- | --- | --- |
| 新增 | `app/pc-admin/src/design/foundation.css` | CSS 导入顺序固定为 Tailwind → HeroUI → Token |
| 修改 | `app/pc-admin/src/main.tsx` | 最先导入 foundation，其余运行代码原字节保持 |
| 修改 | `app/pc-admin/src/design/tokens.css` | 补齐旧变量到既有 v2 语义值的兼容映射，保持原始值只在 Token 文件定义 |
| 修改 | `app/pc-admin/src/style.css` | 移除旧根定义和旧依赖导入；18 处旧 medium 用法改为 semibold；主色及旧次级灰接入语义变量；移除旧 coarse 44px 覆盖，使用 v2 40px |
| 修改 | `app/pc-admin/src/app/heroui-workbench.css` | 移除旧 HeroUI 根色值及尺寸定义，保留控件选择器 |
| 修改 | `app/pc-admin/src/features/follow-up/follow-up.css` | 一处旧次级灰改用 `--text-secondary` |
| 修改 | `tests/web01-workbench.browser.test.mjs` | 仅把标题字号的精确预期从 36px 改为 24px；保留原 deepEqual 及全部其他断言 |
| 修改 | `docs/ui/design-system.md` | 记录用户确认、兼容映射及实际 CSS 导入方式 |
| 新增 | `docs/ui/design-system-v2-card1-token-foundation.md` | 本交付记录 |

没有删除文件，没有新增依赖。没有 API、Schema、数据库迁移、权限、状态、Query/Zustand 结构、草稿、UNKNOWN 或实时事件变更；没有更改持久 Feature Flag。

核验起点 10,348 个文件，仅上述七个既有文件改变；另新增 foundation 和本报告。三个修改过的功能 CSS 文件共 843 个非 `:root` 选择器顺序、文本完全一致。所有 JSX class / data 属性保持；测试差异反向替换 24px→36px 后，与起点文件哈希完全一致。用户预置 Token、规范与源码的改前字节、哈希保存在仓库外基线中。

## 3. 四档前后对照

最终对照使用同一合成数据库、同一工单和冻结后的同一浏览器时间，依次加载改前保存的 bundle 与本轮正式 bundle。覆盖看板、填写但不提交备注的待接单抽屉及完整详情页；共 24 张截图，均已逐张查看。宽度 1920 / 1440 / 1280 / 900，高度统一 1080。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 页面标题 | 36px / 700 | 24px / 600，四宽一致 |
| 卡片标题 | 15px / 600 | 14px / 600，四宽一致 |
| 品牌母源与接单按钮 | `--primary` 为 #1D6FBF、HeroUI accent 近黑、接单 #315FED | `--primary`、accent 和接单统一 #2563C9 |
| HeroUI 次级文字 | muted #787774 | muted 与 secondary 统一 #6B6965 |
| 看板列底 | 黄、蓝、绿三色 | 同一个 `--bg-subtle` |
| 1920 工作区容器宽 | 1240px | 1440px；其他三宽实际容器宽分别保持 1200 / 1040 / 885px |
| 日期范围控件 | 两端日期与触发器完整 | 四宽仍完整；新增外置验证同时检查三项均位于控件边界内 |
| 主按钮与溢出 | 看板 0，抽屉/详情各 1 | 数量保持；24 场景均无横向页面溢出 |

截图原件均在 `/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/`：

| 部位 · 宽度 | 改前 | 改后 |
| --- | --- | --- |
| 看板 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-board-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-board-1920.png) |
| 看板 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-board-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-board-1440.png) |
| 看板 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-board-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-board-1280.png) |
| 看板 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-board-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-board-900.png) |
| 抽屉 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-drawer-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-drawer-1920.png) |
| 抽屉 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-drawer-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-drawer-1440.png) |
| 抽屉 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-drawer-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-drawer-1280.png) |
| 抽屉 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-drawer-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-drawer-900.png) |
| 完整详情 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-page-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-page-1920.png) |
| 完整详情 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-page-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-page-1440.png) |
| 完整详情 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-page-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-page-1280.png) |
| 完整详情 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/before-page-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card1-20261101/screenshots-paired/after-page-900.png) |

另复用既有备注验证：hover、pressed、实际匹配 `:focus-visible`、空备注 disabled、2000 字长文本五态均完成；主按钮始终为 1，保存备注继续为 secondary。材料为空的详情也保留原空内容。截图与五态验证合计浏览器 POST 为 0，合成数据准备与业务回归写入独立记账。

## 4. 度量

在 `app/pc-admin` 执行 `npx --no-install stylelint "src/**/*.css" --formatter json`，使用已安装版本，未改规则、severity 或忽略范围。

| 规则 | 上一卡最新有效基线 | 本卡 | 差值 |
| --- | ---: | ---: | ---: |
| declaration-property-value-allowed-list | 347 | 340 | -7 |
| color-no-hex | 193 | 134 | -59 |
| unit-disallowed-list | 21 | 21 | 0 |
| declaration-no-important | 14 | 14 | 0 |
| function-disallowed-list | 11 | 1 | -10 |
| color-named | 5 | 5 | 0 |
| **总计** | **591** | **515** | **-76** |

退出码仍为 **2 / FAIL**，不是 lint 全绿。卡 0 最初 600 条和后继 591 条均保留原适用对象，本卡比较采用备注按钮修复后的 591 条。

功能样式当前实测六个缺失本地变量 `--line / --text-muted / --fw-semibold / --border-color / --text-secondary / --text-primary` 已清零。另一个 `--trigger-width` 是 HeroUI 运行时变量，单独登记，不伪造根定义。历史“七个未定义”的口径不能直接当作本次六个本地缺口。

## 5. 验证、失败与证据

| 最终候选检查 | 结果 |
| --- | --- |
| `npm.cmd run migration:build` | PASS；911 严格实现、2739 输出，制品 STAGED_NOT_ACTIVATED |
| `node .build/tools/gate.mjs types` | PASS；strict 与 negative-types 均通过 |
| `node .build/tools/verify-artifact.mjs` | PASS；绑定本报告 manifest |
| 相关浏览器回归 | PASS；3 文件，12/12，零失败/跳过/未运行 |
| 四档前后截图与日期边界 | PASS；24 场景，日期起止与触发器均完整 |
| 备注五态 | PASS；一次 900px 完整详情，五态计数及状态通过 |
| 指令文档检查与现有工具测试 | PASS；工具测试 19/19 |
| Impeccable 机械检查 | PASS；空结果数组，未用它替代实际截图 |
| Stylelint | **FAIL：515 条**，见 §4 |

selection 沿唯一活动 `v3-p09`：直接子集为 `tests/workbench-startup.browser.test.mts`、`tests/web01-workbench.browser.test.mjs`；按控件风险追加已注册的 `tests/workbench-detail-restructure.browser.test.mts`。三个入口分别 1、9、2 个测试，沿原 host、flags、超时及资源清理合同。不是活动全集、full/certify，也没有运行 Electron 原生壳或现场验收。

失败如实保留：首候选把包根作为 TS 副作用导入，实际解析成 JS，导致 HeroUI CSS 缺失、日期控件折行；首轮截图的机械计数 PASS 不代表视觉验收通过。该候选原回归完成 10 项、9 PASS / 1 FAIL，详情重构入口 NOT_RUN；失败是原精确视觉预期 36px 与已确认 24px 不符。第二轮显式 `/css` 导入触发 TS2882，构建 FAIL，未把失败制品用于验收。最终使用单一 CSS 导入入口，保持严格副作用检查，并仅更新精确字号预期；最终候选重新执行上述检查。共三次构建尝试，只有最后一次属于最终候选。

证据目录：`D:\CodexEvidence\pc-admin-design-v2-card1-20261101`。含起点状态与 10,348 文件哈希、原字节、执行计划、最终构建/类型/制品日志、lint 原 JSON、`source-integrity.json`、`screenshots-paired.json`、`visual-comparisons.json`、`states-results.json`、逐入口 TAP/stderr/case trace 与资源回执。首轮结果保存在 `first-candidate/`，第二轮失败在 `migration-build-02-failed.log`；初始改前截图独立保留。

## 6. 规范偏差与范围限制

“无布局变化”已被用户明确修订，不作为未批准偏差。其余 Token 新映射均复用已有 v2 值；旧 10/14/18/28px 间距归为 12/16/20/32px，不引入新颜色、字号、圆角或阴影。

本卡完成 Token 接入，尚未完成全站 v2 视觉迁移：已有硬编码字号/圆角、14 处 important、旧焦点覆盖、居中容器、64px 标题瓷砖、780px 贴边抽屉及旧标签/时间线形态仍由原功能样式控制，分别留给后续裸值、页面骨架和抽屉卡。900px 表格滚动下界为既有约束，仅移到 Token 兼容层，随 Table 卡再处理。不能据本卡宣称所有页面已符合最终字号、AA、键盘焦点或全站主按钮标准。

## 7. 后续前置条件、资源与关闭方式

卡 1 Token 底座及最终相关回归完成；后续裸值迁移的前置条件满足，可从 **515 条**继续比较。本次没有启动下一卡、关闭 GitHub Issue、推进业务 Gate 或授予提交/发布权限。

所有逐测试合成数据库由原夹具删除；停止前仅本任务基线库与 PostgreSQL 默认库，其他客户端连接为 0、有效最大连接数为 8。本任务基线库已删除、PG PID 已退出、58432 无监听。截图及状态验证的 browser process/profile/socket/timer 均为 0。保留日志、失败、截图、原件，以及已停用的 `pgdata/` 和 `before-bundle/`，未递归删除任何目录或清理卡 0 资源。

输入是预置规范、Token 和用户的尺寸确认；输出是单一 Token 导入链及本报告。无数据库或 API 合同变更，无默认开关改变；仅使用合成夹具，不连接医院数据或真实 Provider。撤销本卡时按仓库外 `source-before/` 原字节恢复本卡七个修改文件，移除本卡 foundation 与报告；保留卡 0 原件和修改，不用 reset/clean 覆盖用户工作。

## 8. 七项自检

| 自检 | 是/否 | 证据 |
| --- | --- | --- |
| 只改视觉，没有改业务行为、请求、状态值 | 是 | 源码完整性核对、main 除 CSS 导入外原字节相同；最终 12/12 |
| class / data 属性保留，未削弱业务断言 | 是 | 843 个功能选择器相同；JSX 属性不变；测试仅精确 36→24px |
| 本卡新增功能 CSS 无裸 hex、裸字号、裸圆角、important | 是 | foundation 只有三个 import；新增功能声明使用语义变量；原始值只在 Token 文件规范豁免内；不代表全仓违规已清零 |
| 每个可见区域 primary ≤1 | 是（覆盖范围） | 四宽看板 0、抽屉/完整详情各 1，五态仍为 1；未对未遍历页面宣称通过 |
| 新组件各态有样式 | 是（无新增组件） | 本卡没有新增 React 组件；既有备注按钮五态与空材料、2000 字长文本已核对 |
| 四宽都截图核对 | 是 | 最终 24 张全部逐张查看，日期边界与横向溢出断言通过 |
| 未覆盖情况先提建议，不自造值 | 是 | 实施前提出临时兼容方案，用户明确选择直接 v2 尺寸；按确认接线并记录 |
