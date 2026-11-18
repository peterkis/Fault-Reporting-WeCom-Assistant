# Card 35A / PR 192 修复证据

本轮修复基于已提交的 `6e4a59b1f304eb159e00ff8c093c83581b606fdc`；PR merge-base 为 `f76fffef7c693ddcee0139b4f6f03bf59376e358`。修复保留在未提交工作区，没有 commit、push 或 PR 操作。当前制品源输入为 `f7340751b16afa7acd7089a6da975da02413612d5e308f6fb3ff2e558648f05a`。类型检查后重新构建，再对同一制品执行选中的测试。

不改 `.gitignore`、35B 目录/脚本/基线、`features/**` 或实时恢复实现；产品方案A继续适用。用户原型保留原件：[v2.2.7 原型（含 v2.2.8 画板07）](../../prototype/医小修%20PC%20管理端%20v2.2.7%20设计原型.html)。

环境：macOS 26.6.2 / Darwin 25.6.0、Chrome 157.0.8103.79、Node.js 24.18.0；应用截图1440×1000、DPR 1。数据来自现有合成 fixtures，数据库/服务器/浏览器由各 fixture 创建并清理。共享 Postgres 与其他任务资源保持原状。

## 本轮问题与修复

| 审查项 | 修复与验证 |
| --- | --- |
| CI 链接 | 48份被忽略的 `.log` 原件改名为 `.txt`，字节保持不变；根报告与归档报告改用新路径。两个移动后的归档 README 的原型/设计系统路径修正。未改忽略规则。工作区脚本检查目标存在、锚点及 gitignore，另执行现有文档/计划检查。 |
| 本地筛选分页 | 整区 filtered 空态只在所有相关查询均无下一页时显示。还有页时看板/列表保留 compact 空提示及原下一页控件；可加载后续匹配项。新增用例分别覆盖两个视图的有下一页和已耗尽情况，清除筛选仍恢复内容。 |
| 空已处理列 | 不再以 loaded.length 跳过原 processedGroups。保留原 BoardDropColumn、`.ds-completed-drop-zone` 和组选择器；空提示置于完成拖放区，已关闭仍在外部。真实指针拖入后打开原完成表单，POST为0，事项版本不变。 |
| 完整 CI | 从已提交 HEAD 计算原计划：77个应用入口、7个工具入口，数据库 lane，要求 Chrome/PyYAML/ffmpeg。通过既有 runSelection API 执行工作区制品，保留逐入口结果，避免 clean-HEAD CLI 拒绝未提交修复。未调整选择策略或断言。 |

初始链接检查同时发现21个被忽略目标和4处缺失导航；两个浏览器回归均先在旧应用上失败，再在修复后通过。最初分页测试夹具缺少报修表，改用现有 follow-enabled fixture profile 后明确复现分页问题。失败原件与前后验证记录保留在[本轮复现记录](runs/20-pr192-reproduction/README.md)。

## 改动与删除

- 本轮应用改动只有 Workbench.tsx 的空态/分组呈现；复用既有查询、分页、拖拽和完成表单，没有更改业务规则、权限或接口字段。
- 35A新增两个浏览器回归，沿现有测试注册，无删除选择器或放宽几何/业务断言。设计系统[状态章](../../design-system.md#状态v228--卡35a)补充分页与空完成靶区规则。
- 本轮删除的是吞掉下一页入口的空态条件、跳过空完成靶区的条件，以及被忽略的日志路径写法；日志内容保留为txt。
- 原35A删除清单继续保留：静态启动占位、BoardColumnLoading/DelayedWorkbenchLoading、旧 startup-column/line/short/card/heading-p 样式、旧详情 Message/confirmed-facts 占位、区块转圈、散装 `.empty`、More.error/读取未完成span/title/空More footer、闲置 `.ds-list-feedback .state-message` 和重复内边框。仍在用的选择器及行内转圈保留。

## A1–A4 逐条复核

交付前再次逐条核对A1–A4。A1组件/延迟/刷新/空/错误/连接/只读、A2接入和A3状态规范均已实现；A1.1未知空首组和A1.7原合同差异没有被本轮修复掩盖，列入下表及Open questions。

| 验收项 | 结果 | 证据范围 |
| --- | --- | --- |
| A4.1 时间 | PASS | 80ms无骨架/busy；400ms呈现至少300ms；9s慢读/重试。 |
| A4.2 零位移 | FAIL（未知空首组） | 六个默认/已知折叠分组位置0px，列头/表头/工具栏及详情原≤1px断言保留。未知成员分布仍有55px/43px反例，见Q1。 |
| A4.3 刷新 | PASS | 看板、列表、抽屉保留旧内容及data-refreshing，不闪骨架。 |
| A4.4 空 | PASS | 三尺寸、清除筛选、抽屉无空区块；新增分页可达性及耗尽后空态断言。 |
| A4.5 错误 | PASS | 有/无旧内容、重试、复制诊断及页面无诊断文本；无散装读取未完成。 |
| A4.6 连接 | PASS | 离线/读取失败1s/3s/8s→停止→陈旧→刷新；恢复2s收起；主区32px占位。仅流不可用且读取成功持续5秒恢复、无断开/陈旧条，容量协议原断言保留。 |
| A4.7 只读 | FAIL（原合同偏差） | 五原因场景、唯一条、原动作、可聚焦tooltip、仍可用操作及实时收起通过；内部备注UNKNOWN无独立安全核对入口，见Q3。 |
| A4.8 无障碍 | PASS | status/busy/aria-disabled、焦点/tooltip及减少动效。 |
| A4.9 截图 | PASS | 16张必需应用图、健康重读图、4张本轮回归图、画板07及四段裁片；[尺寸/哈希](screenshots.json)。 |
| A4.10 检查 | PASS（本卡要求） | 类型/样式/构建/文案/35A及工作台抽屉回归均通过。完整CI另保留SS009已知失败，不标为全绿。 |

## 检查命令与结果

完整选集与补充入口结果：[逐入口报告](checks/pr192-ci-results.md)、[机器回执](checks/regressions.json)。应用选集76/77入口通过（546/548例）；工具7/7入口、138/138例；补充回归13/13入口、26/26例。合计97入口中96通过，712例中710通过、2例失败，0跳过/取消。唯一最终失败入口为用户事先指出的SS009，实际失败没有隐藏。所有应用入口与重跑均核对为同一制品。

| 命令/检查 | 当前结果 | 记录 |
| --- | --- | --- |
| `npm run migration:typecheck` | PASS | [typecheck](checks/typecheck.txt) |
| `npm run migration:build` | PASS；staged未启用 | [build](checks/build.txt) |
| `npm --prefix app/pc-admin run lint:css` | PASS | [Stylelint](checks/stylelint.txt) |
| `npm --prefix app/pc-admin run lint:features` | PASS | [ESLint](checks/eslint.txt) |
| `pr-plan --base <merge-base> --head HEAD --check-docs` | PASS，原计划77应用+7工具 | [原计划](checks/pr192-plan.json) |
| `node --input-type=module < docs/ui/evidence/v228-card35/checks/check-local-links.txt` | PASS；目标存在且git check-ignore无输出 | [可重运行脚本](checks/check-local-links.txt)、[检查回执](checks/local-links.json) |
| 原选集：copy-terms、35A、protocol、toast-feedback、detail-restructure | PASS：6/6、9/9、2/2、1/1、2/2 | [逐入口报告](checks/pr192-ci-results.md)、[35A TAP](checks/states-browser.txt) |
| 完整CI原选集 | 应用76/77、工具7/7入口通过；SS009两例已知失败 | [逐入口报告](checks/pr192-ci-results.md) |
| 补充card32/34、t38工作台相关入口 | PASS，13入口/26例 | [逐入口报告](checks/pr192-ci-results.md) |
| 现有文档检查、工具测试、制品校验、git diff --check | PASS；工具138/138，包含文档20/20 | [文档检查](checks/agent-docs.txt)、[文档测试](checks/agent-docs-tests.txt)、[制品](checks/artifact-proof.json) |

两项初始媒体失败已修复环境：Homebrew命令路径是符号链接，现有端口拒绝这类路径；改用解析后的真实ffmpeg/ffprobe可执行文件，仅重跑失败入口，H5 flow 1/1、H5 media 14/14通过。不改校验、测试断言或应用代码。初始失败TAP保留在[复现记录](runs/20-pr192-reproduction/README.md)。

产品方案A：真实离线/获权业务读取失败才使用有限预算；仅实时流不可用且完整GET成功，原单调度器持续5秒重读，预算清零、不显示断开/陈旧条。有空位后回到live。没有新增轮询器，人工REST、READ/UNKNOWN终检不变。

## 与画板07并排

[完整画板07](artboard-07.png)。原型裁片由浏览器导出；参考图中文字体使用系统回退，不作为像素级字体基线，原件没有修改。

| 画板07 | 当前应用 |
| --- | --- |
| ![07A 加载](artboard-07-loading.png) | ![看板加载](board-loading.png)<br>![列表加载](list-loading.png)<br>![详情加载](drawer-loading.png)<br>![保留内容刷新](board-refreshing.png) |
| ![07B 空](artboard-07-empty.png) | ![筛选无结果](board-empty-filtered.png)<br>![待受理清空](intake-cleared.png)<br>![筛选后看板仍可翻页](filtered-pagination-board.png)<br>![筛选后列表仍可翻页](filtered-pagination-list.png)<br>![空完成拖放区](empty-handled-drop-target.png)<br>![打开原完成表单](empty-handled-completion-form.png) |
| ![07C 错误](artboard-07-error.png) | ![保留旧内容重试](board-stale-retry.png)<br>![启动失败](workbench-error-page.png)<br>![连接断开](connection-offline.png)<br>![内容陈旧](connection-stale.png)<br>![读取正常，实时暂不可用](connection-polling-healthy.png) |
| ![07D 只读](artboard-07-readonly.png) | ![无权限](drawer-readonly-permission.png)<br>![他人负责](drawer-readonly-assigned.png)<br>![完成](drawer-readonly-completed.png)<br>![关闭](drawer-readonly-dismissed.png)<br>![结果未确认](drawer-readonly-pending.png)<br>![键盘聚焦禁用按钮](readonly-disabled-tooltip.png) |

## Open questions / 偏差

1. **未知空首组**：响应前同一身份/请求/折叠偏好不能区分待判断2/待接单3与待判断0/待接单3，首卡top分别300/355；已处理完成1/关闭1与完成0/关闭1分别300/343。共享常量无法推断成员事实。需提前分组元数据或调整空组/完成靶区布局合同；未改接口或用骨架后跳掩盖。原反例：[待受理](rework/unknown-layout.json)、[已处理](rework/unknown-handled.json)。
2. **可信只读原因/READ撤销**：他人负责只用既有相关原因与allowed_actions；无可靠投影时不猜。可信403仍清理敏感正文；载入后撤权按原合同可归并为404，不能伪造“可继续读取但不可处理”的权限判断。
3. **UNKNOWN**：有效内部备注只有同操作“重新提交”，无独立只读“重新确认”。保留原重放和导航栅栏；不将写入包装成核对。仍获准的备注/协作/关注能力不因展示条撤销。
4. **诊断与圆角**：服务端无请求编号时，本地引用明确标记来源；不复制正文/凭据/查询串。原sm=6px，骨架沿xs=4px，不改全站圆角。
5. **35B/35C**：不改35B目录、视觉清单或基线。visual:compare及状态manifest追加仍等35B合并；其余feature状态统一属于35C。
6. **完整CI的已知失败**：`tests/yxx-ss-009-http-recovery.integration.test.mjs` 0/2，表现为等待工单超时，以及预期404实际503。与该文件相同的初始化器在独立自有库中确实没有 `pilot_ticket.closure_record`，查询错误为42P01；[观察回执](runs/20-pr192-reproduction/ss009-schema-probe.txt)。符合用户事先说明的main既有问题，由PR191修复，本轮未改测试、初始化器或迁移。其他已执行入口最终通过；card12-review本轮7/7通过。

## 历史与资源

[上轮方案A完整证据](runs/19-before-pr192/README.md)保留原候选身份和结果；更早记录仍在runs目录。两份移动的历史README仅修复导航及日志扩展名，未把旧结果绑定到本轮候选。全部日志字节的改名映射随本轮记录保存。

[保护路径及断言核对](checks/frozen-inputs.json)确认原型、实时实现、`.gitignore`、35B和其他feature路径保持不变，35A原断言行全部保留。新的txt证据文件均未被忽略，应与源码修复一同纳入审查者的后续提交。

本轮测试只创建/清理自有UUID数据库、loopback服务、Chrome profile和连接。没有对共享postgres执行基线迁移或清理其他数据库。未提交的源码可按差异回退；用户原型与历史失败原件保留。
