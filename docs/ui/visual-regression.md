# PC 管理端本地截图回归

本工具补充既有业务、权限与几何断言，运行本地系统 Chrome，按 OS 和浏览器维护基线。产品负责人已于 2026-11-18 批准当前 18 张 PNG 作为首批基线；逐图 SHA-256 见[批准集合](evidence/v228-card35/35b/approved-screenshots-20261118.json)。产品负责人已在普通终端亲自执行 approve，`docs/ui/visual-baseline/darwin-chrome/` 与批准集合逐字节一致；Agent 不执行 approve。35A 后续改变画面时，需另行捕获、审阅再更新基线；新增状态画面由 35A 作者登记。

## 运行与报告

环境需要 Node.js 24、`npm ci`、本机 Chrome 和 PostgreSQL 18。默认使用任务指定的本机 PostgreSQL；`PILOT_DATABASE_URL` 可覆盖地址，但 capture 拒绝远程数据库。每屏复用 `withWeb01Fixture` 创建独立 UUID 合成库，结束时只回收该库及自己的 HTTP、浏览器、profile、定时器和 socket，不停止共享 PG。

```sh
npm run migration:typecheck
npm run migration:build
npm run visual:capture
npm run visual:compare
```

`migration:typecheck` 清理 runtime，之后须构建。capture 和 approve 调用制品校验器，源码或产物过期会拒绝执行并提示重建。工具只运行 `.build/runtime/` 中的 `.mjs`，不回退源码。

图片保存在 `.build/visual/current/<platform>/`，例如 `darwin-chrome`。`meta.json` 记录 OS、浏览器、DPR、逐屏尺寸、源码 head、构建输入指纹及 PNG SHA-256；未提交候选通过 head 加输入指纹标识。可指定屏幕调试或归档一次完整捕获：

```sh
npm run visual:capture -- drawer-processing
npm run visual:capture -- --run-id stability-1
```

部分捕获只出具所选屏幕的元数据，不代表完整 18 屏。`--run-id` 另存 `.build/visual/runs/<run-id>/<platform>/`。

需要保留已批准的 current 时，为 capture 和 compare 指定独立的 `--current-dir`。该参数指向平台目录的父目录，只允许 `.build/visual/` 内的临时目录；approve 不接受它，不能用它写入正式基线：

```sh
npm run visual:capture -- --current-dir .build/visual/experiment/current
npm run visual:compare -- --current-dir .build/visual/experiment/current --baseline-dir .build/visual/temporary-baseline
```

打开 `.build/visual/report/index.html` 查看 baseline/current/diff 三联图、差异像素、比例、阈值和超限标记；结构化数据在 `report.json`。缺基线时仍显示全部 current 图片，并明确报告缺失。缺图片、损坏 PNG、尺寸改变或元数据错误也会失败。

**产品负责人决定（2026-11-18）：默认“任意差异像素”**。pixelmatch 的颜色阈值仍为 **0.1**；只要该算法返回的差异像素数 **> 0**（即整屏 ratio **> 0**），画面就标为 changed，compare 退出非零。这里不是原始 RGBA 字节差异；pixelmatch 仍按既有颜色及抗锯齿规则计算。

任务卡原先“差异比例 > 0.1%”（ratio > 0.001）的默认规则已被此次具名决定取代，旧默认导致漏检的反向验证记录保留为历史证据。清单仍可逐屏覆盖 pixelmatch 或 ratio，但任何不同于当前默认的值（包括旧 ratio 0.001）都必须有非空 reason；理由用中文说明真实视觉原因。本次 **没有任何逐屏覆盖**。

临时基线用于验证，参数指向平台目录的父目录，不写入正式基线：

```sh
# 先把完整 current 平台目录复制到 .build/visual/temporary-baseline/<platform>/
npm run visual:compare -- --baseline-dir .build/visual/temporary-baseline --report-dir .build/visual/temporary-report
```

## 人工批准与新增画面

仅在产品负责人确认有意的设计变更或新增画面后更新正式基线。每张 UI 卡 PR 必附变化画面及是否预期，模板见 [UI 任务卡模板](../../plans/pc-admin-design-v21/ui-task-card-template.md)。负责人在普通交互终端自行执行：

```sh
npm run visual:approve -- board-default drawer-processing
npm run visual:approve -- --all
```

stdin 必须是 TTY，每次输入 `APPROVE`；取消不写入。检测到 Agent 或 CI 环境会拒绝，没有跳过确认参数。批准前验证平台、元数据及图片哈希，确认后再次检查源图片没有变化。人工确认成功路径本次不执行。

在 `tests/visual/manifest.mts` 添加显式 name、route、prepare、viewport、mask、threshold 对象，并在 `prepare.mts` 实现准备步骤。基线目录按平台隔离；OS、Chrome 或字体升级后重新验稳定性，不能跨平台回退。

## 稳定性与覆盖

默认 1440×1000 / DPR 1，整页详情宽 1280。`visual-stable.mts` 在应用执行前冻结 `Date.now()`、无参 `new Date()` 与函数形式 `Date()` 为本地 2026-11-13 10:00；启用 reduced motion，禁用动画、过渡和 caret。捕获前等待业务请求、实际可见字形、`document.fonts.ready`、图片 decode、进入/退出状态、`waitForAnimationsSettled` 和两帧。

HeroUI 的分层高优先级规则会保留 drawer/disclosure 的 `will-change`；稳定化 helper 在生命周期完成后只清除不建立固定定位包含块的动画提示，保留抽屉的 translate 提示；否则会改变 Toast 的定位基准。排序按钮处在小数坐标上，其恒等 `scale(1)` 形成额外文字绘制边界；仅将这个恒等变换改成 `none`，不修改字体、文字或几何，并对排序按钮、抽屉和提示栈断言处理前后位置与尺寸完全一致。visual capture 另外显式启用 Chrome 的 `--disable-partial-raster`，避免复用部分栅格内容；harness 的其他调用默认不启用。保留所有真实 scrim、滤镜和内容。诊断与探针见 [稳定性调查](evidence/v228-card35/35b/stability-investigation.md)。

**首批 18 屏均无遮罩。** 小区域 mask 能力保留，但 selector 必须匹配且有中文 reason；先排查原因，不能遮罩整页背景取得稳定。若必须改产品才能稳定，记录 Open questions。本工具没有为稳定性修改产品源码。

合成 fixture 固定编号、身份、时间和人员，每屏使用新库和新浏览器；分组偏好在启动前固定，不依赖上一屏。业务查询走真实 HTTP/PG；实时连接、人员及租约呈现固定，Toast 复用卡 33 的真实交互及生产 DOM 展示。它不验证真实实时传输，既有断言继续独立运行。

同一 head、构建输入指纹和机器连续完整 capture 五次，每屏全部十对原始 RGBA 像素必须为 0。表格与回执见 [卡 35B 证据](evidence/v228-card35/35b/README.md)。

## 源码级反向验证

```sh
node .build/runtime/tools/visual-regression/reverse-validation.mjs
```

执行前须有完整且干净的 current；两个产品源码目标必须没有未提交修改。工具先记录 current 的全部 PNG 与 meta.json 哈希，将其复制到 `.build/visual/source-reverse-any-pixel/baseline/<platform>/`，并保存源码原件，然后分别：

1. 把真实 `design/tokens.css` 的 `--radius-lg` 从 12px 改为 14px。
2. 把真实 `TicketCard/ClosureDialog.tsx` 的「确认关闭」改为「确认关单」。

每项均运行 `migration:build`、`visual:capture -- --current-dir ...`、`visual:compare -- --current-dir ...`。实验 PNG 只写入 `.build/visual/source-reverse-any-pixel/{radius,label}/current/<platform>/`，不覆盖已批准的 current。结果包含所有屏幕的差异比例、超限标记、原始像素数及捕获构建指纹；源码补丁与恢复哈希另存证据。随后逐字节恢复源码，确认 git diff 为空，再重建。每项前后及结束时检查已批准集合的 PNG 和 meta.json 没有变化，不在末尾重新捕获 current。

全程使用具名决定后的默认阈值，不对实时页面注入实验改动。两项 compare 均必须退出 1 且标出画面；否则在源码恢复及重建后判定实验失败。若已批准 PNG 的 SHA-256 有任何变化，立即停止并报告，不能重拍或复制回去掩盖差异。

依赖仅新增开发依赖 pixelmatch 与 pngjs。回退移除本卡工具、测试、脚本、构建注册和文档即可，无产品 Schema、持久开关或部署变化。
