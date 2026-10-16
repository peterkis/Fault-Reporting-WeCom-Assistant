# 来源群名称本地实现验证

日期：2026-10-07。基点：3cf707945afac7392806f7d8dca3dfb6be94caad。状态：LOCAL_VERIFIED；缓存恢复及内容哈希复核完成，运行资源清理完成；临时PG磁盘数据目录因自动审批拒绝删除而保留。

用户确认管理员在管理端维护群名称。此记录仅对应新来源元数据增量，不替换历史readiness或现场证据。默认关闭，未在真实库应用037，未启用Gateway/发送器/OAuth或运行full/certify，未部署。

本地严格types检查已通过。首次构建因锁定依赖缺失未完成；已按根锁文件执行npm ci --ignore-scripts --no-audit --no-fund恢复162个包，没有修改锁文件。

## 当前实现与验证

管理员从群来源事项详情登记/修改名称；后台按provider、Bot、chatid规范数组的SHA-256关联名称。看板、列表、详情共用source_label/source_group。名称仅改显示资料；读取只沿事项自身source Intake的Journey/Leg定位原始群，不让其他补充受理的Ticket关联覆盖来源。

- Node.js 24.18.0；任务自有loopback PostgreSQL 18.4（server_version_num=180004），端口60776；未读取真实.env.pilot作为测试配置。
- 最终strict types、负向类型canary、生产React bundle及后端构建通过。
- 最终输入hash：b52c3143049a423798873eac6c318e5ba8b4c5968c54bfd91b64073037d954ae。
- 制品manifest SHA-256：e216e4d387e412f8fb15b9438921cea968c5dbc35aa298c5f4c4c9b75d9d1b82；954个输出；ARTIFACT_VERIFIED_NOT_ACTIVATED。
- 使用现有routing/runSelection，在同一最终制品上运行v3-p09全部14文件：45/45，fail/cancelled/skipped/todo均0，not_run为空。
- 最终报告目录：`C:/Users/zqpet/AppData/Local/Temp/wecom-source-groups-validation-20261007/final-origin-v3-p09`。
- 来源群HTTP/浏览器覆盖登记、改名、跨Bot/群独立、正确CSRF下非ADMIN拒绝、跨Origin/无效CSRF拒绝、未知引用拒绝、幂等重放、并发版本拒绝、原始群保留、补充受理不覆盖来源、过期降级、原始外部ID不返回、长名称和HTML文本安全、三处统一显示。
- 新群名称测试fixture的communication.delivery为0；其他回归的SDK/Webhook外发均为既有合成测试，并未使用真实Provider。
- 18份API Markdown、455个本地链接、19个JSON示例检查通过；git diff --check通过。

## 环境失败及保留

首次相关selection在SS008出现P2_G2_CANDIDATE_INVENTORY_LIMIT（23 PASS/1 FAIL，其余6文件未跑）。原因是原型目录的Git忽略node_modules被既有候选扫描器遍历，不是新增名称接口失败。失败报告保留在同级`final-v3-p09`；未提高清单门槛、修改检查器、超时、重试或跳过测试。

临时将原型依赖目录原样移至本任务tmp目录，移入前/后及最终恢复后逐文件内容清单hash相同：33951文件、208241936 bytes，SHA-256=767c9207bb688081f3730b1b214c9ce6826cddbbd1351a14b82662c4368a18f8。干净候选源清单889文件；发布/CI必须采用干净候选环境，原型本地依赖不属于发布代码。依赖已恢复到原路径，临时digest.cjs已删除。恢复后本地候选扫描仍有原型依赖污染这一已知环境限制；本轮未改扫描器或伪称修复它。

## 清理及边界

测试隔离数据库剩余0、其他client backend剩余0；任务自有PG已通过明确data路径pg_ctl fast stop关闭，postmaster.pid不存在。原postgresql-x64-18服务仍Running，未停止/操作其数据。浏览器、App/Worker/Gateway合成进程与fixture池使用原harness清理收据，均无剩余。

自动审批两次拒绝递归删除已停止的本任务PG数据目录，理由仅返回“blocked by policy”；未改用其他删除方式绕过拒绝。保留目录：`C:/Users/zqpet/AppData/Local/Temp/wecom-source-groups-pg-c91237ec-0521-4951-b1ed-022c54e2c1e4/data`。这不是运行中的服务，不含真实业务库；本轮磁盘清理存在此限制。

原用户文件hash保持：AGENTS.md=E4E0D849F1F84AC27A5AD3C4DEBF117AC9456187DAC85DADB1913895680B964B；UI设计稿=87088AFD814B3A80E2ED4538075CB05797A9FB6BF45CADC2F892347BA1259D8E。旧G0捕获hash=A1A99A859CB0A508F770EFC44F9B008DE06694735126F6BCFDB83C93B8777243，未重写冻结证据。

新模块默认关闭；未执行真实库037迁移、部署、真实发送、full/certify、PR、push或Gate推进。启用和关闭操作见[接口文档](../docs/api/workbench/source-groups-design.md)。
