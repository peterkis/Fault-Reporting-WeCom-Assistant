# PC 管理端 v2.1 · 卡 10 看板骨架

本卡对应 [v2.1 方案](design-system-v2.1.md) §3.1、§4.1、[设计系统](design-system.md) §6.6 与原型 01。基线为已合并卡 9 的 `main@f1b7592e893b2aebc70a185cd82c28a9870a4bb1`（PR #129）。本次用户明确授权本地实施、提交/推送、PR、`@codex review` 修复循环、merge commit、main 快进及本次自有资源清理；卡 11–16 未启动。

## 改动与文件

| 路径 | 责任 |
| --- | --- |
| `app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx`、`board-column.css` | 3px 阶段色带、浅色列头、阶段圆点、半透明白色计数、排序菜单、可折叠受理分组 |
| `app/pc-admin/src/design/components/BoardColumn/workbench-board.css` | `--bg-board` 暖灰看板底；列体使用 `--bg-column` |
| `app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx`、`board-summary.css` | 标题下四个统计筛选；选中蓝描边、tooltip、统计数字的可访问名称、加载/不可用/部分失败提示、窄屏两列 |
| `app/pc-admin/src/design/board-presentation.ts` | 只读前端筛选与排序；共用 heat.ts 的四小时边界；显式北京时间 |
| `app/pc-admin/src/app/Workbench.tsx` | 接入统计、分组、排序；保留每列默认三项/展开/分页；SSE 抽屉冻结实际展示顺序，只存事项键 |
| `app/pc-admin/src/design/status-map.ts` | 移除卡片重复的「待判断」展示标签，状态值和复核提示不变 |
| `app/pc-admin/src/design/tokens.css` | 增加半透明计数语义 Token `--bg-stage-count`，HeroUI 桥接不变 |
| `app/pc-admin/src/features/manual-report/ManualReportForm.tsx`、`design/components/Button/button.css` | 原获权「新报修」primary 内增加 N 提示，不改许可或导航命令 |
| `tests/pc-admin-design-foundation.test.mts` | 增加四小时边界、处理中不推算、本人 HANDLING、北京时间跨日及不可变排序检查 |
| `tests/web01-workbench.browser.test.mjs` | 新增概况/折叠/排序/键盘/无写请求与 SSE 冻结回归；一条旧视觉断言更新为本卡获准的列底色 |
| `docs/ui/design-system.md`、`design-system-v2.1.md`、本文与 `evidence/v21-card10/compare-*.jpg` | 规范先行、确认口径、交付与四宽证据 |

无数据库、后端、接口、业务命令、Ticket 状态值、权限判断、请求参数/语义、依赖、默认 Feature Flag 或部署变更。统计不新建责任事实；服务目录与类别映射没有改动。

## 已确认的补充与过渡口径

2026-11-02 用户确认：

- 排序提供「等待最久」（默认）/「最新到达」，只排列已加载项。待受理取 created_at，已处理取 completed_at；缺少完成时间的事项排末尾。处理中在卡 11 前保留服务器顺序，并显示等待时间尚未补齐，不用 updated_at 推算。
- 「已超时」暂只统计待受理中 created_at 满 heat.ts danger 阈值的 Ticket，tooltip 明示处理中暂未计入。
- 「我负责」只消费 caller-only attention.related_reasons 的 HANDLING；不拿显示姓名、关注或会话接待责任替代。无投影时显示「—」并禁用筛选。
- 「今日已处理」按北京时间 completed_at，与当前已加载查询/日期范围一致。四卡均提示「基于已加载的 N 项」；再次点击取消，同时影响看板与列表，不改变原分页查询。

N 本卡只显示提示，实际快捷键绑定由卡 16 统一实施。卡片资料收纳、类别瓷砖、热度、领取与完整下一步操作分别留给后续卡。

## 验证

原始检查、失败、截图和资源回执位于 `D:/CodexEvidence/pc-admin-v21-card10-20261102`。最终本地构建绑定基线上的未提交工作区，输入指纹 `732ac2fff4244dcbab1eee1cf1dd1afe73d748f80cf52d05ca9c80be21e9deb1`，manifest SHA-256 `d0cfe464d23103a2b82f7ef6a68636537dcde6acae91ce97e39c14b556706129`。提交后完整 head 由普通 PR CI 独立验证；不把 dirty 工作区结果重绑为 merge commit 的新运行。

| 检查 | 结果 |
| --- | --- |
| `npm run migration:build` | PASS；912 strict 模块、912 实际 Node 语法检查、2741 输出 |
| `node .build/tools/gate.mjs types` | PASS；完整 strict、负向类型、CSS、变量与 feature 语法门禁 |
| `node .build/tools/verify-artifact.mjs` | `ARTIFACT_VERIFIED_NOT_ACTIVATED` |
| 相关注册测试 | 35/35 PASS，0 FAIL / SKIP / NOT_RUN；活动 v3-p09 的 foundation 19 + WEB01 12，另加 T42 authority-navigation 3 / legal-action 1 两个相关注册入口，不称活动全集 |
| Stylelint / ESLint | 0 / 0；变量检查无未定义或原始色板泄漏 |
| 指令文档 / 工具回归 | PASS / 21 tests PASS（设计系统 2、指令文档 19；相关工具未改） |
| 设计检测 | 1 条可解释 warning：任务明确要求的列头 3px 阶段色带；未新增 lint 例外 |
| 四宽采图 | 最终 before / after 各四档均完成三列加载、9 张默认卡、1 个获权 primary、页面溢出 0；采图 POST=0 |

浏览器通过真实 loopback HTTP、任务自有 PG18 合成库与正式 bundle；纯函数检查转译实际 browser TS 源码，不称后端运行制品。开发阶段两项专用交互检查也通过，但不替代最终注册运行。

## 四宽前后与原型

每张图从左到右为修改前 / 修改后 / 原型 01。原型含卡 12 及以后的效果，未把这些内容记为本卡完成。900px 保留既有看板内部横向滚动；四档均无页面级溢出。

| 宽度 | 前后与原型 | 首屏彩色像素估算：前 → 后 |
| ---: | --- | ---: |
| 1920 | [并排图](evidence/v21-card10/compare-1920.jpg) | 0.30% → 4.04% |
| 1440 | [并排图](evidence/v21-card10/compare-1440.jpg) | 0.40% → 4.50% |
| 1280 | [并排图](evidence/v21-card10/compare-1280.jpg) | 0.45% → 4.47% |
| 900 | [并排图](evidence/v21-card10/compare-900.jpg) | 0.61% → 5.61% |

![1440 前后与原型](evidence/v21-card10/compare-1440.jpg)

估算按非中性阶段/tone/品牌 Token 调色板逐像素匹配（RGB 各通道容差 1），分母为含留白的完整 1080px 高视口，排除暖灰背景；抗锯齿和头像可带来小幅误差。**未达到整体 8–12% 目标**，不通过扩大无语义色块凑数。卡 12 接入类别与热度后需重新估算；当前图只证明本卡骨架。

## 自检

| 自检 | 是 / 否 + 证据 |
| --- | --- |
| 前端未改业务命令、状态值、权限判断 | 是。后端/合同/依赖差异 0；原 ManualReportEntry 可用性与 BoardActions 沿用 |
| 测试选择器只增不删；改过的测试只改文案期望 | 否（“只改文案”这一项）。原 class/data 选择器保留；新增统计与组选择器和回归。按本卡要求同步更新一条旧列底色视觉期望，既有状态/权限/请求/回执/次数等业务断言原样，未放宽 |
| 新增颜色经 Token，Stylelint / ESLint 为 0 | 是。阶段/tone 复用卡 9，计数半透明值在 tokens.css；0 / 0 |
| 新增彩色对应阶段 / 紧急 / 类别 / 人 | 是。列头=阶段、超时=紧急、本人负责=人；既有品牌操作/选中语义保留，无装饰性新增色 |
| 卡片没有「未提供 / 未登记」 | 否。资料收纳属卡 12，本卡保留原卡片元信息，不提前改资料行为 |
| 有权限时每区域恰好一个 primary | 是（本卡页面）。四档获权夹具均为 1 个「新报修」；只读场景无此按钮。抽屉/会话完整主操作收口仍属卡 13/14 |
| 热度阈值来自 heat.ts，无组件硬编码阈值 | 是。超时筛选直接调用 heatOf；四小时边界与 1 秒内侧均有直接检查 |
| 四宽与原型并排核对 | 是。四张最终并排图、18 张原始 PNG 及 SHA-256 manifest；最终图均等三列完成 |

## 原失败与未运行

- 初次构建：新增 Node 测试错误地从无扩展名 browser client 导入类型，TS2835 拒绝；改为读取既有 contracts 类型，保留失败日志。
- 合成夹具同时开启代录与关注时触发既有 `P2_012_SCHEMA_DRIFT`；不修改历史迁移或业务代码掩盖。代录与关注分别验证，正式截图使用代录场景；本人关系使用独立关注场景。
- 首次注册脚本把两个 T42 入口误认为活动 selection 成员而拒绝，未运行；修为明确的相关注册附加范围，不扩写活动 selection。
- 首轮实际注册结果为 28 PASS / 2 FAIL：新增用例发现 aria-description 未落到实际按钮，另一条旧视觉断言仍期待 v2.0 列底。改为实际 title/tooltip 与含数字的可访问名称，视觉期望同步本卡指定 Token，业务断言未变。
- 第二轮实际注册为 29 PASS / 1 FAIL：新增排序预期未处理 null completed_at，错误地把未确认完成时间排最前；新增测试预期更正，生产纯函数原有 null 排末尾行为不改。两轮 T42 均因前入口失败为 NOT_RUN，最终单独执行。
- 布局检查同时修正选中卡悬停丢描边、待判断占满三项名额、打开 SSE 抽屉恢复服务器顺序的问题；前后均只持有当前获权 DTO。
- 首轮采图曾捕到未完成加载的中间态；原图保留，最终 before/after 全四档重新等待三列完成。构建清理运行树期间一次采图因模块尚未生成而未运行，日志保留，不当成截图成功。
- 构建保留既有 chunk 超过 500 kB 提示。手动 full/certify、Electron、真实发送、现场业务、生产部署与 Gate 均 NOT_RUN。

## 资源、回退与下一卡

唯一源码/Git/runtime 写者为当前会话；布局子任务只读。自有 PG18 只监听 `127.0.0.1:58450`，max_connections=8，fixture 创建全新 UUID 合成库并沿 finally 清理；浏览器、profile、HTTP 宿主与 SQL 连接按原测试合同关闭。停止前只余 postgres/template0/template1，其他客户端 0；停止后 pg_ctl status=3、监听 0。已按绝对路径白名单与无重解析点检查删除自有 pgdata、before-bundle、development-bundle；回执为仓库外 cleanup-local.json。采图浏览器 processes/profiles/commandTimers/sockets 全为 0，注册测试按原资源合同通过清理核验。用户原型、历史 Evidence、失败、NOT_RUN、原始截图、恢复引用、共享 `.build` 和依赖保留。

回退为 revert 本 PR；无数据库回滚，无新持久开关。Backlog：卡 10 本地实施与验证完成，授权发布、远端 CI/审查、合并与 Git 清理沿 PR 及最终交付读回。GitHub 未发现对应卡 10 的既存 Issue，不修改无关 Issue。卡 11 可以按其独立只读投影任务执行，但本次未授权实施；卡 12/13 仍被卡 11 的 service / stage_entered_at 投影阻塞。
