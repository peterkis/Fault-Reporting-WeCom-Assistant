# 设计系统 v2.0 · 卡 2 裸值收敛

2026-11-01。本卡本地验证完成，Stylelint 从 515 条降为 0。按[设计系统第四章](design-system.md#四design-tokens)统一功能 CSS 的颜色、排版、间距、圆角、阴影、层级和时长，并把 CSS 检查接入现有类型 gate。只做本地视觉和工具改动；没有提交、推送、创建 PR 或部署。

## 1. 候选与范围

- 保留分支 `codex/pc-admin-design-v2-card0` 及卡 0／卡 1 的全部未提交工作。
- 起点 head：`8ad55a19bf5d3ab6d46e534c345cea17eb634e8a`。被测对象是该 head 加当前未提交改动，不能用 head 单独代表本次候选。
- 最终构建输入指纹：`abf0b405c7a895a3539c00d69f76440c0550608d8dd485ccad548f9f252194d3`。
- 最终 manifest SHA-256：`4d8f1105e91560bfd6b671dd9a576937112e5ca7e0ec01af85d33c6a64320acd`。
- 环境：Windows、Node.js 24.18.0、根锁文件既有依赖、任务自有 loopback PostgreSQL 18（58433，最大 8 连接）、系统浏览器/CDP、合成夹具。
- 输入：现有 Token、规范第四章、前卡 515 条违规与现有功能样式；输出：语义 Token 引用、CSS gate 和本交付记录。
- API、请求、Schema、数据库迁移、Ticket 状态、权限、Query/Zustand 结构、草稿/UNKNOWN 恢复、实时事件与持久 Feature Flag 均无变更。截图验证不提交业务命令，业务回归的合成写入独立记账。

## 2. 文件清单

以下为卡 2 增量；卡 0／卡 1 的 package、锁文件、AGENTS、main、Token 和原测试修改没有重新归为本卡改动。

| 操作 | 文件 | 说明 |
| --- | --- | --- |
| 修改 | `app/pc-admin/src/style.css` | 裸值及旧别名改用语义 Token；指定蓝色/近黑动作暂降 secondary；以所属区域选择器替代 important 覆盖 |
| 修改 | `app/pc-admin/src/app/heroui-workbench.css` | 控件排版、圆角、阴影和层级收敛；恢复键盘焦点及白底焦点字段；减少动效覆盖包含浮层 |
| 修改 | `app/pc-admin/src/features/board-actions/board-actions.css` | 动作面板与反馈样式使用 Token，移除 important |
| 修改 | `app/pc-admin/src/features/follow-up/follow-up.css` | 跟进时间控件、摘要和到期提示使用 Token |
| 修改 | `app/pc-admin/src/features/incident-candidates/candidate.css` | 候选表单圆角和间距使用 Token |
| 修改 | `app/pc-admin/src/features/manual-report/manual-report.css` | 代录表单和成功回执排版、圆角和间距使用 Token |
| 修改 | `app/pc-admin/src/features/search/search.css` | 搜索字段、筛选、按钮和错误提示使用 Token |
| 修改 | `app/pc-admin/src/features/supplement-follow-up/supplement-follow-up.css` | 待跟进摘要、列表、说明使用 Token |
| 修改 | `tools/ts-migration/gate.mts` | 类型 gate 执行与 `lint:css` 相同的锁定 CLI、工作目录和 CSS glob；普通、batch 与完整 gate 共用该入口 |
| 修改 | `tools/ts-migration/tooling.test.mts` | 自有临时目录中验证语义值通过，七类禁止值分别被 gate 拒绝 |
| 新增 | `docs/ui/design-system-v2-card2-literal-convergence.md` | 本交付记录、证据与下一卡前置条件 |

删除文件：无。没有新增运行时或开发依赖，没有修改 Stylelint 配置、忽略范围或严重级别。检查起点 10,367 个文件，本卡只改变上述十个既有文件；所有 JSX、业务源码与业务测试字节保持起点一致。原有 926 个 CSS 规则中的 class 钩子全部保留，作用域增强没有删除 DOM class / data 属性。

## 3. 前后对照

同一合成数据库、同一工单和固定浏览器时间，依次加载保存的改前生产 bundle 与最终正式 bundle。宽度 1920 / 1440 / 1280 / 900，高度 1080；看板、待接单抽屉、完整详情共 24 张。日期两端及触发器有边界检查，页面横向溢出和各区域主按钮数量有断言。截图只填写未提交备注，POST 为 0。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 工单主动作 | 品牌蓝实心接单及部分近黑业务按钮 | 卡 2 暂统一白底、主文字、默认边线；卡 3 通过 Button 恢复区域唯一主操作 |
| 次级灰与来源标签 | 多组冷暖灰、局部绿色来源标签 | 文字使用 secondary、边线使用 hair/default、底色使用 subtle/muted；来源恢复中性 |
| 控件和内容排版 | 9/15/18/22/26px 等及裸 400/500/600 | 六档字号、三档字重；旧 15→14、18→16、22→20、26→24，旧 9→12 |
| 圆角与浮层 | 1/2/3/5/7/9/10/14px、rem 和自写阴影 | 标签/控件/卡片/弹层分别使用规范半径；浮层使用 shadow-3/4，分隔仍为发丝线 |
| 键盘焦点 | 全局隐藏焦点环 | `:focus-visible` 可见 2px focus 轮廓；字段聚焦为白底、1px focus 边线 |
| 减少动效 | important 全局覆盖，后续语音规则仍重新开动画 | 无 important；组件和浮层按减少动效设置停止动画、过渡和滚动动效 |
| 四宽主按钮数量 | 看板 0、抽屉/完整详情各 1 | 三类区域均为 0，满足本卡暂降 secondary 和数量 ≤1 的要求 |

最终截图原件在 `D:\CodexEvidence\pc-admin-design-v2-card2-20261101\screenshots-paired-delivery\`，改前与改后均保留：

| 部位 · 宽度 | 改前 | 改后 |
| --- | --- | --- |
| 看板 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-board-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-board-1920.png) |
| 看板 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-board-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-board-1440.png) |
| 看板 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-board-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-board-1280.png) |
| 看板 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-board-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-board-900.png) |
| 抽屉 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-drawer-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-drawer-1920.png) |
| 抽屉 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-drawer-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-drawer-1440.png) |
| 抽屉 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-drawer-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-drawer-1280.png) |
| 抽屉 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-drawer-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-drawer-900.png) |
| 完整详情 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-page-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-page-1920.png) |
| 完整详情 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-page-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-page-1440.png) |
| 完整详情 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-page-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-page-1280.png) |
| 完整详情 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/before-page-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card2-20261101/screenshots-paired-delivery/after-page-900.png) |

## 4. CSS 度量

在 `app/pc-admin` 执行 `npx --no-install stylelint "src/**/*.css"`，使用现有 Stylelint 17.16.0。`--no-install` 只限制使用本地已安装依赖，扫描范围与任务要求一致。

| 规则 | 卡 1 / 本卡改前 | 本卡最终 | 差值 |
| --- | ---: | ---: | ---: |
| declaration-property-value-allowed-list | 340 | 0 | -340 |
| color-no-hex | 134 | 0 | -134 |
| unit-disallowed-list | 21 | 0 | -21 |
| declaration-no-important | 14 | 0 | -14 |
| function-disallowed-list | 1 | 0 | -1 |
| color-named | 5 | 0 | -5 |
| **总计** | **515** | **0** | **-515** |

沿用原配置：Token 文件允许定义原始值，两份登录 CSS 原本排除。零违规指该既有扫描范围，不代表登录效果、HTML 首屏内联样式、参与者动态配色、所有 JSX 约束或后续卡已完成。本卡没有扩大忽略范围，也没有更改这些后续职责。功能 CSS 的本地变量无缺失；`--trigger-width` 继续是 HeroUI 运行时变量。

## 5. 验证与历史失败

| 最终候选检查 | 结果 |
| --- | --- |
| `npx --no-install stylelint "src/**/*.css"` | PASS；0 errors / 0 warnings，原配置未改 |
| `npm.cmd run migration:build` | PASS；911 严格实现、2739 输出，STAGED_NOT_ACTIVATED |
| `node .build/tools/gate.mjs types` | PASS；CSS、strict 与 negative-types 均通过 |
| `node .build/tools/verify-artifact.mjs` | PASS；绑定 §1 最终 manifest |
| CSS gate 工具回归 | PASS；定向 1/1，语义值正例与七类禁止值反例，零跳过；并非工具全集 |
| 四宽截图 | PASS；24 张，日期边界、横向溢出、区域主按钮计数均检查 |
| 七态验证 | PASS；默认、hover、真实按下、键盘焦点、字段焦点、空备注 disabled、2000 字长文本；动画为 0、POST 为 0 |
| 指令文档检查和既有工具测试 | PASS；19/19 |
| 源码/选择器完整性 | PASS；十个文件白名单、原 class 钩子保留、JSX/业务/业务测试/依赖/Token/Stylelint 配置原字节一致 |
| 相关浏览器回归 | PASS；11/11 文件，24/24 测试；零失败、取消、跳过、未运行；绑定 §1 manifest |

实际选择从唯一活动 `v3-p09` 取直接子集，再按样式影响添加已注册入口；保持每个入口的 host、flags、超时和资源清理合同。完整路径和分组在仓库外 `selected-tests.json`，逐入口 TAP、stderr、case trace 和截图在 `registered-tests-delivery/`。覆盖启动、看板/列表/详情、详情媒体、跟进抽屉、会话收件箱、Toast/UNKNOWN、详情真实交互、补充跟进、代录表单、搜索和看板合法动作；不是活动全集或完整认证。

本任务共四次构建尝试：第一次工具编译失败，第二次为首候选完整构建，第三次修正分隔线，第四次补齐 13 处按用途映射的圆角。第三候选已完整通过 11 文件 / 24 测试，原结果仍绑定原 manifest；交付候选另行一次完整构建并重新通过 11 文件 / 24 测试，不借用旧数字。最后的圆角复核与源码映射在 `radius-role-mapping.json`；交付日志使用 `*-delivery.*`，旧轮次原件保持独立。

已保留的过程结果：首次构建尝试停在新增 CSS gate 测试的 TypeScript `assert.throws` 签名错误，修正后首候选完整构建通过。首轮截图发现三处分隔阴影误归 shadow-1、形成浅框，最终改回规范允许的 `inset 0 -1px 0 var(--border-hair)`；首候选原件在 `first-candidate/`。

首候选浏览器回归实际执行 10/11 文件，23 测试中 22 PASS / 1 FAIL；搜索入口要求 D 盘 TEMP，但进程继承 C 盘，失败发生于环境前置断言。最后的看板动作入口为 NOT_RUN。原报告在 `registered-tests/summary.json`，没有改测试以绕过要求；最终轮用任务自有 D 盘 TEMP。没有运行 full/certify、远端 CI、Electron 原生壳或现场验收。

## 6. 规范偏差与后续

没有新增颜色、字号、圆角或阴影档位。映射复用现有语义 Token；原 10/14/18/28px 间距与前卡一致向上归到 12/16/20/32px。rem 中既有布局宽度保留等价 px 数值，不引入新的视觉档位；页面模板和几何尺寸留给后续卡。

Impeccable 单次机械检测有 1 条 warning：代录受众说明仍有原来的 3px 中性左边线；本卡只把线色改成 border-default，保留原结构，后续 Form/Section 卡统一处理。它不是 Stylelint 错误；未据检测器宣称全站设计验收。卡 3 的 PageHeader / Toolbar / EmptyState / Button、卡 4 状态/人员表达及后续抽屉模板仍待实施。所有页面标题位置对齐、全站 AA 和全站主按钮行为不能据本卡样本宣布完成。

卡 3 前置条件满足：Token 底座已在用，功能 CSS 原规则扫描为零，类型 gate 已阻止样式违规进入后续改动，相关生产 bundle 浏览器回归通过。本任务没有启动卡 3、变更 GitHub Issue 状态、推进业务 Gate 或获得提交/发布授权。

资源已收口：最终截图及七态浏览器的 process / profile / timer / socket 均为 0；11 个注册入口的所有权回执确认清理后活动进程为 0。所有逐入口合成数据库由原夹具清理；停止前仅本任务基线库与 PG 默认库，其他客户端为 0，最大连接数为 8。基线库已精确删除，PG 状态退出码 3、PID 已退出、58433 无监听。保留已停止的 `pgdata/`、改前 bundle、源码原字节、截图、失败、NOT_RUN 和各轮回执；未递归删除目录，也未停止其他服务。

证据根目录：`D:\CodexEvidence\pc-admin-design-v2-card2-20261101`。交付事实见 `delivery.json`，资源见 `database-cleanup.json` / `cleanup-final.json`，源码与选择器见 `source-integrity.json`，截图见 `screenshots-paired-delivery.json`，控件各态见 `states-results-delivery.json`。原始失败与未运行项保留在首轮报告中；通过不回填历史记录。

本卡关闭方式是恢复仓库外 `source-before/` 中本卡十个文件的原字节，并移除本报告；保留前两卡原件和工作，不使用 reset/clean。

## 7. 七项自检

| 自检 | 是/否 | 证据 |
| --- | --- | --- |
| 只改视觉，没有改业务行为、请求或状态值 | 是 | 十文件白名单；全部 JSX、业务实现和业务测试哈希与起点相同；工具增量只增加 CSS gate |
| class / data 属性保留，未削弱断言 | 是 | JSX 原字节相同；926 个原 CSS 规则中的 class 钩子保留；所有业务测试原字节相同 |
| 新增功能 CSS 没有裸 hex、字号、圆角或 important | 是 | 原配置 Stylelint 0；功能 CSS 逐声明扫描无裸色、rem/em、important 或缺失本地变量 |
| 每个可见区域 primary ≤1 | 是（覆盖范围） | 四宽看板、抽屉和完整详情均为 0；七态检查仍为 0；不宣称未遍历页面全部通过 |
| 新组件各态齐备 | 是（无新组件） | 本卡没有新增 React 组件；既有备注控件七态和空附件详情已验证；加载/UNKNOWN 沿原浏览器入口验证 |
| 1920 / 1440 / 1280 / 900 截图核对 | 是 | 24 张前后图及四张对照图已核对；三处首轮分隔阴影问题已按规范修正 |
| 未覆盖情况先建议，不自行发明值 | 是 | 全部映射复用现有 Token；未新增档位；既有模板/动态配色边界明确留在后续卡 |
