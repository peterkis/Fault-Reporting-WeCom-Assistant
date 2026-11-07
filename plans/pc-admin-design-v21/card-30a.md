# 卡 30A：协作在场后端（批量读取、编辑字段、看板范围提示）

日期：2026-11-07（Asia/Shanghai）。决策见 [ADR-0057](../../adr/0057_workbench_activity_batch_view.md)，接口见[活动合同](../../docs/api/workbench/activity.md#adr-0057-批量读取编辑字段与看板提示卡-30a)。

## 输入、所有权与停止线

- 分支 `codex/v221-card30a`，基于 `origin/main` `33648dfd03629fca3caed5d7ed1aa7fe7db8bfb7`；macOS 本机 worktree，唯一写者为本会话。与卡 29（PC）、29H（H5）并行，文件无交集。
- 改动只限 `app/server`（活动与 SSE）、`contracts`、`adr`、`docs/api`、后端测试与测试登记；前端只改 `app/pc-admin/src/features/activity/client.ts` 的解析与类型。30B 展示、31 未实现。
- 用户授权：本地验证后提交、推送、创建 PR，不合并。无部署、现场启用、真实发送或 Gate。
- 本地 PG 18.6（localhost:5432，当前用户），测试按既有 helper 创建并回收合成库；浏览器为本机 Google Chrome。

## 编号结论

| 编号 | 结论 |
| --- | --- |
| A1 | 已完成。`WorkbenchActivityPerson` 增加 `field`；`view()` 合并同一同事多条租约时取最近编辑字段；编辑者在前、同类按显示名。单张与批量结构一致。前端 `client.ts` 解析放宽为接受 `field`（EDITING 时须为四个已知字段之一，VIEWING 时须为 null；旧三键结构读为 null），其余校验保持，并新增 `parseActivityBatchView` 供 30B 使用。 |
| A2 | 已完成。`POST /api/workbench/activity/batch-view` 在同一 HTTP 模块，复用 Cookie/Origin/CSRF/开关/错误处理；1–100 个目标，去重，超限/空/非法 400；只返回有人的目标；无他人租约目标不鉴权（计数断言 0）；401/403/404 目标单独跳过，其它错误整体失败。 |
| A3 | 已完成。活动模块整数版本号在新增/删除租约、查看↔编辑、字段变化、过期清理、按认证释放、失权移除时 +1；`signature()` = 版本号 + 原自身签名。SSE 首次签名只作基线；同一连接 1 秒内最多一次提示，被节流的变化由下一次既有 wakeup/recovery 补发，无新定时器。 |
| A4 | 已完成。DTS、人员/视图/批量请求/批量响应 Schema、`resources.json` 登记、`docs/api` 三处、ADR-0057。 |
| A5 | 已提供测量表；「64 个有人 p95 < 100ms（本地测试库）」**未达到**，原因与建议见下。 |

## A5 性能测量

| 指标 | 要求 | 实测 | 结论 |
| --- | --- | --- | --- |
| 批量（100 目标，0 个有人），服务层，128 租约/64 目标 | 不调用鉴权；p95 < 5ms | authorize 调用 0；p95 0.24ms（200 次） | 达到 |
| 同上，经真实 HTTP + PG（含边界 Cookie 会话认证） | — | p95 2.68ms（40 次；首轮 2.88ms） | 达到 |
| 批量（100 目标，64 个有人），服务层内存鉴权，128 租约 | p95 < 100ms | p95 2.0ms；authorize 256 次 = 64×(2+2) | 算法开销达到 |
| 批量（100 目标），真实 HTTP + 本地 PG 鉴权，8 个有人 × 1 租约 | p95 < 100ms（64 个有人） | p95 60.9ms；约 7.3ms/有人目标（首轮 85.9ms / 10.4ms） | **64 个有人未达到**：外推约 0.5–0.9s |
| 一次租约变化触发的 SSE 提示 | 每连接 ≤ 1 次/秒 | 32 连接各 1 次；同一秒内再 20 次变化 0 次追加；+1000ms 后补发 1 次；无变化心跳 0 次 | 达到 |
| SSE 连接数 | 64 个 | 64 个请求中 32 个建立、32 个得到既有容量降级（`REALTIME_SSE_DEFAULTS.maxClients=32`，2C4G 上限） | 64 个无法同时存在，按上限 32 测量 |
| 内存 | 不新增与目标数相关的常驻结构 | 只新增 1 个整数版本号；每请求临时 Set（≤128 键）随请求释放；SSE 每连接 2 个标量 | 达到 |

真实 PG 的 8 个有人目标是 fixture 上限：一名主体最多 4 个浏览器 × 2 个对象 = 8 条租约，fixture 只有 3 个可登录主体。64/128 的最坏分布只能在服务层用内存鉴权构造。

### 未达标原因与建议（未实施）

每个有人目标复用 `view()`：请求人鉴权 + 每条他人租约鉴权 + 请求人围栏复核，至少 3 次真实 `authorize`。运行时 `authorize` 每次查询主体、会话状态与事项读权限（字段编辑时另查业务权限），本机约 3.5ms/次。64 个有人目标约 192–256 次鉴权，顺序执行约 0.7–0.9s。

按 P5 未引入缓存、并发或新依赖。可选后继方向（需另行决策）：

1. 批量请求中请求人的主体/会话鉴权与事项读权限拆开，主体/会话只查一次（需改 `authorize` 端口形状）；
2. 增加「批量事项读权限」查询，一次 SQL 判断请求人与各同事对多个事项的读权限；
3. 批量请求只做开头一次请求人围栏，而非每目标两次；
4. 前端（30B）只请求可视区域卡片；实际有人目标数受「每人最多打开 2 个详情」约束，常见规模（同时打开详情的人数 ≤ 10）约 ≤ 20 个有人目标，预计 ≤ 0.25s。

## 验证

macOS 本机，Node 24.18.0，PG 18.6，Chrome。全部在已提交 HEAD 上构建后执行；runSelection 遇失败入口即停，后续分批补跑。

- `npm ci`、`npm run migration:build`：PASS（931 typed）；`node .build/tools/gate.mjs types`：PASS；`node .build/tools/verify-artifact.mjs`：ARTIFACT_VERIFIED_NOT_ACTIVATED。
- `pr-plan --base origin/main`：profiles core/mvp/pc/policy/presence/toolchain，64 入口。
  - 1–49：219/220；唯一 FAIL 为 `wbint-t39-activity.integration` 精确断言旧三键人员，已按 ADR-0057 加 `field:null`，复跑 PASS。
  - 50–51：`web01-workbench.integration` 首次 1 FAIL（27A 已关闭看板 500，与在场无关），单独复跑 17/17 PASS，记为间歇。
  - 52–64：`yxx-h5-flow.integration`、`yxx-h5-media.integration`、`yxx-h5-media` 共 9 FAIL（`YXX_MEDIA_STORAGE_UNAVAILABLE` / `YXX_MEDIA_CONVERSION_UNAVAILABLE`），在未修改的 `origin/main` 构建上逐一复现相同失败，属本机环境既有问题；其余全部 PASS。
  - 新增 3 个入口（批量服务、批量 HTTP+PG、提示节流）与 presence 全部入口 PASS（含 lifecycle 浏览器）。
- 工具测试：backend-layout、check-agent-docs、design-system PASS；h5（8 FAIL，H5_BUILD_OUTPUT_INVALID）、hosts（5 FAIL，WEB01_BUILD_OUTPUT_INVALID）、pr-plan（2 FAIL，`spawnSync python ENOENT`）、tooling（2 FAIL）在未修改的 `origin/main` 构建上以相同用例、相同数量复现，属本机环境（无 python/PyYAML 等）既有问题，以 CI 为准。
- `npm run docs:agents:check`：PASS。Stylelint/ESLint：本卡无样式改动，未单独运行。

## 自检

| 项 | 结论与证据 |
| --- | --- |
| 只改允许的文件；前端只改 `client.ts` 解析 | 是。`git diff --stat origin/main` 只含 app/server 三个活动/SSE 文件、`client.ts`、contracts、adr、docs/api、tests 与测试/资源登记。 |
| 无新增依赖、存储、后台任务；未改租约时长与上限 | 是。`package.json`/lock 未变；`WORKBENCH_ACTIVITY_LIMITS` 未变；无新 setInterval/setTimeout。SSE 新增的 `nowFn` 仅为可注入时钟。 |
| 不显示自己；只显示双方都有权限；不暴露内部标识 | 是。服务与真实 HTTP 测试断言自己为空、无权目标省略、人员仅四键。 |
| 无人目标不触发鉴权；提示 1 秒节流 | 是。A2 计数断言 0；节流测试断言。前端防抖与按卡片订阅属 30B。 |
| 测试选择器只增不删 | 是。未删除任何测试或 `data-workbench-activity`。 |
| 性能测量表已提供，未达标项已说明 | 是，见 A5。 |

## 回退

删除批量路由、`batchView`、版本号前缀与 SSE 节流/基线判断即恢复原行为；`field` 为新增字段，旧前端解析在合入本卡前会拒绝四键人员，因此前后端须同版本发布（同一构建产物）。
