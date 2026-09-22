# SS-011 限定写现场执行清单

当前已按用户补充授权完成云端准备和成员入口部署，最新部署结果见 `evidence/yxx-ss-011-live-deployment-report.json`。A/B 的真实网页现场仍待点击，AC-095～102 尚未执行。本文件不签发超出用户授权的范围。此前离线和云端准备结果分别保留在 `evidence/yxx-ss-011-preparation-report.json` 与 `evidence/yxx-ss-011-cloud-preparation-report.json`，不改写 SS009/SS010 历史报告。

2026-09-21 云端增量：已核验现有2核主机/PostgreSQL18.6；备份现有配置和旧测试库，并恢复到独立演练库，核对55张表数据、4个序列及1359个约束（18个文本差异经PostgreSQL重新解析等价验证）。演练库保留且禁止连接。新专用库完成现有迁移，A/B分别作为报修人和坐席，负责人A；与历史保护配置的8个身份字段完全一致。候选在干净发布checkout通过SS010严格检查；业务受理/Ticket为0，原OAuth/Nginx未切换。后续只执行尚未完成步骤，不重复建库/恢复，不复用历史未批准窗口。此数据库恢复不替代AC099网页提交恢复。

部署增量：成员 App 使用 `MEMBER_SELF_SERVICE` 在 43123 启动，Nginx 通过共用网络命名空间转发；公网未认证请求已验证为 OAuth 302。首次手机点击暴露了 API 代理遗漏：`/api/yixiaoxiu/bootstrap` 落到静态根目录返回 404。已备份原配置后补齐精确 bootstrap、列表、请求、Timeline、补充和命令规则，`nginx -t`、reload及修复后401检查均通过。统一工作台单独在 43124 回环启动，含短期受保护坐席 Cookie，公网不开放。通过 SSH 本地端口转发后，入口为 `http://127.0.0.1:43124/workbench/lifecycle`。旧 OAuth-only 容器保留但停止；Gateway、sender、Bot 处理和真实消息发送保持关闭。固定 `chengdu.mobimedical.cn` 解析到另一地址，本机实际服务域名为 `cd3120.mobimedical.cn`。

后续现场反馈显示，首次提交发生在 API 代理修复前，专用库经对账仍为零 receipt/submission/intake/ticket；浏览器显示的“查询上次提交结果”是本地 pending recovery，不是服务端已受理。候选随后更新了成员前端：正常会话复核在 250ms 内不再隐藏页面，卡顿、失败和作用域变化仍走保护性隐藏；成员 App 与工作台已重启到 runtime fingerprint `c4cf9c922234822660bcbfc4e79c566d5929ddd9c1caa99b183c58d38db006cd`。工作台 Cookie 已重新生成，本机代理会从私有文件注入当前坐席会话，浏览器入口为 `http://127.0.0.1:43125/workbench/lifecycle`。超过五次 GET 恢复仍无服务端 receipt 时，页面允许用户清除本地未确认记录；这不会删除服务端事实。此次 runtime 更新尚未重新生成严格 SS010 readiness；重新点击后应以数据库 receipt 和 `/my-reports` 事实为准。

## 1. 版本与启动前停止点

- GitHub PR20 已合并；拟用发布版本 `a58577d66733b3ec39f5d74af9ff44c70b79fe38`，tree `4bdeb873e889e0c1672eedf8ba28bf9b9451bd75`。App version 等于完整 commit。
- PR head `5b8b031942b0b2cf04eecfc3f245cf3e947daecb` 的两个 evidence-history job SUCCESS、两个 SS009 专用 job SKIPPED。Codex 评论未发现重大问题，非正式 APPROVED review。
- 当前 SS010 严格入口通过。SS009 原严格入口在当前源码上因 r7 指纹与 SS010 不同而拒绝；未隐藏失败。历史 r7 检查引用 SS010 已归档结果，未重跑。
- 当前准备材料未提交，不在本工作区启动 live；目标采用上述发布版本的完整、干净 checkout，私有配置与现场证据放在 checkout 外。若部署别的版本，重新核验和批准，不能借用本次候选绑定。
- `plans/yxx-ss-011-execution-inputs.json` 是筹备表，不可作为 runner manifest。逐项填写后形成完整申请，再由负责人通过受保护渠道提供独立批准记录。

## 2. 环境准备和批准顺序

1. 确认主机、操作者、内部访问方式、端口、数据库、A/B 保护配置、两个坐席、负责人及回退联系人。未确认前不 SSH、不连接现场库、不访问真实 OAuth。
2. 明确现场前置操作的许可：主机只读盘点、数据库连接/建库/基础 schema、备份、033/034 检查或应用、App 部署和精确代理变更。它们不由 runner 自动执行。基础 schema 尚未核验，不能盲目在空库只运行033/034。
3. 批准后盘点原服务启动命令、服务管理方式、版本、profile、端口、proxy及主机容量；将真实启动/停止/回退命令补入受保护操作记录，先核实命令再切换。保存原配置和备份引用。
4. 专用 PostgreSQL 必须 loopback，数据库名匹配 `^p2_015_ss010_[a-f0-9_]+$`，绑定名称、OID、连接身份摘要。首次业务为空，仅批准的两个 active principal 和目录可预置。不能复制含旧 Bot 业务事实的数据库作为首次运行库。
5. 033/034 按实际情况应用；迁移 check 有事务内 DDL，必须授权。runner只核验最终catalog和marker/checksum。数据库、state和批准材料作为一组保留及备份，不删除state重置预算。
6. 私有 env 仅含 PILOT_DATABASE_URL、YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG、APP_SECRET、P2_G2_REPORTER_HMAC_SECRET、PILOT_LOG_IDENTITY_HASH_KEY。不复制通用env。目标机配置ACL和归档权限必须核验；本地模板不包含秘密。
7. 核对真实配置的 Corp/App/成员映射与历史证明适用性。历史A/B官方转换已验证不代表当前配置已验证，更不授权网页写入。
8. 公网路径严格沿用 `yixiaoxiu-limited-write-preparation.md` 的方法/路径清单；保持Host/Origin，不将API 401改成OAuth重定向，不开放内部workbench/API/SSE/health。内部坐席走内部通道。
9. 确认窗口起止时间和epoch、总/每成员预算、故障演练范围、读取回退许可、证据保留期限。配额建议6/8/6、每成员3/4，均尚未批准；窗口最大65分钟。
10. 用既有 limitedConfigurationDigest 生成配置摘要，用 approvalScope 计算批准作用域；由负责人提供匹配的独立批准JSON，再绑定其原文摘要。代理/建库/读取服务等runner外动作也必须有对应明确批准，不能只依赖运行器布尔开关。

## 3. 启动命令和现场分工

以下是参数化命令，路径从批准记录读取，不可直接照抄占位符。先完成上节所有停止点。

```powershell
node scripts/yxx-self-service-readiness.mjs --require-ready
node scripts/yxx-self-service-live.mjs --check --manifest=<私有完整manifest> --env-file=<专用私有env>
node scripts/yxx-self-service-live.mjs --run --manifest=<同一manifest> --env-file=<同一env> --state-dir=<私有绝对目录>
```

只替换唯一App；端口占用立即停止，不自动杀旧服务。App监听成功后再启动Worker并统一放行。App/Worker/Controller连接池分别≤4/2/1，Worker批量≤10且非重入。无Gateway、sender、AI、Incident维护及Bot processor。`FULL_SERVICE_LOOP`只用于内部组合，不是父G2许可。记录健康结果和启动版本；内存Cookie不移植，A/B重新登录。

A/B由现场协调人组织在真实企业微信内点击；内部操作者使用批准坐席完成原工作台动作；执行者记录脱敏请求结果、数据库关联及进程状态。不得把成员Cookie、坐席sessions.private.json、OAuth code URL或raw身份贴入聊天/报告。

## 4. 场景脚本与预算

逐项结果填入 `plans/yxx-ss-011-live-acceptance.json` 的现场副本；启动前确定run_id后冻结该运行副本，失败运行不覆盖。当前仓库矩阵只是未执行模板。

| 场景 | 人员 | 操作 | 验收 |
|---|---|---|---|
| 登录 | A/B | 固定主页真实登录并再次访问 | 无循环，可信身份分别正确 |
| S1 | A | 合成明确故障，填写批准目录中的必填位置等字段 | 规则直接建单；记录命令、来源、Intake、Ticket关联 |
| S2 | B | 另一条明确故障 | B本人来源及Ticket，不串A |
| S3 | A | 缺字段报修，再由A补充 | 待补充→真实判断；不是全部强制人工 |
| S4 | B | 非报修咨询 | 受理/Decision可追溯但无Ticket |
| S5 | A | 符合现行规则的高风险合成描述 | 原坐席审核后建单 |
| 重放 | A | S1同命令ID同内容重试；同ID不同内容 | 同结果或冲突，计数不增加 |
| 越权 | B | 访问/补充A请求、查询A命令、替换cursor及伪造身份字段 | 拒绝、无数据泄漏或写入，留审计 |
| S6 | B | 预留给批准的响应丢失及恢复 | 提交事实可查，重试/续跑不丢不重 |
| 生命周期 | 两坐席 | 原工作台接单、等待/恢复、解决/关闭 | 本人Timeline与同一Ticket一致，内部备注不泄漏 |

目标目录及规则未核验前，不写死位置ID和“必定命中”的描述。执行前从当前候选规则和批准目录选定完整合成表单并附预期Decision；若无法构造必需路线，停在准备阶段处理，不在窗口内改规则。S1/S3/S5归A，S2/S4/S6归B，满足每人最多3次新受理；合法重放不新增预算。缺字段/非报修仍消耗受理及潜在Ticket预留。

响应丢失仅对本次客户端响应实施批准的拦截；先保存原命令ID，确认提交端事实后同ID重试。拦截具体方式需在实际客户端可操作性核验后纳入操作清单；没有可验证的注入不标PASS。停止/恢复只作用于本次运行器拥有的进程；准备pending后记录收据和计数，优雅停止，同库同配置同state在原窗口内恢复并核对续跑。

```powershell
node scripts/yxx-self-service-live.mjs --run --resume --manifest=<原manifest> --env-file=<原env> --state-dir=<原state>
```

`STOPPED_WITH_FAILURE`等阻断状态不得手改绕过。现场不做12路压测，不手写SQL制造成功或修改Ticket状态。未能安全实施恢复时AC-099为NOT_RUN，不关闭全部SS011。

## 5. 停止、对账与读取恢复

任何错绑、越权、重复Ticket、误发、超额、范围变化或不明事务状态，立即CTRL+C/TERM或在本次state目录写stop.request，停止新写/处理，保留已提交事实。

对账必须按本run实际来源/命令关联查询：来源、Intake、Decision、Review、Ticket、事件、补充、幂等收据、pending和审计。记录SQL/查询工具版本及脱敏结果引用；仅做SELECT，不以表总数代替关联核对。当前未连接现场库，不生成虚构计数。

Web相关Inbox/Conversation/DirectLeg/Message/Outbox/Delivery/Grant及消息Provider外发均为0；OAuth身份调用单列。启动前、故障前后及最终均记录计数，解释每个增量。数据库检查和进程/外发日志共同支持零发送结论，不能只看一个计数。

停runner后核对本次进程、连接、端口是否释放，强制结束或清理异常如实记录。测试事实不删除，Ticket按合法领域动作关闭。按批准的实际服务启动命令恢复当前被测版本 MEMBER_SELF_SERVICE + MY_REPORTS_ENABLED=true + SELF_SERVICE_ENABLED=false，并验证本人查询可用、提交/补充被拒绝。原MEMBER_TICKET_READONLY不替代“我的报修”退路。

数据库不down migration。进程停止不等于读取已恢复；读取启动失败须记录服务不可用和恢复动作，不能声称回退完成。新窗口、新候选需新许可，保留旧运行事实，不重置预算。

## 6. 交付及关闭

现场报告绑定run_id、候选/配置摘要、同一时刻的event_time/event_epoch_ms、每项实际结果及原始制品路径/大小/SHA256。日志/截图/对账原件归档一次，公开报告只引用脱敏材料；归档访问和保留期限须在窗口前确定。

AC095～102逐项PASS且负责人真实确认后才关闭SS011。未执行/失败/被阻断项明确记录，不用本地自动化或历史只读证据替代。不推进P2-G2/P2-008/AI；原三Bot+第四Web入口联合验收、旧卡片、多标签、自然GC/物理2C4G/正式60分钟观察按父Gate另行处理。本轮无数据库变更、无业务代码变更、无Git发布。
