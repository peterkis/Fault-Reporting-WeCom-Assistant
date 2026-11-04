# N3 通知异常关联来源只读投影

Issue：[144](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/144)。来源为已完成#87和PR #143；后继绿色旧版退役#145依赖本票。基点b98d7cdae02b1e33a6beb379f18dba8894492a74；本票单写者，独立worktree codex/pc-admin-n3-source-projection。

## 已确认边界与实现

只扩展原异常列表/单项Item：ticket_no、ticket_title、reporter_name必需且按域可空；Ticket取当前核心编号/标题，Session取原主题有效且身份绑定的RESOLVED快照，Incident三项null。safe_summary仍是通知说明，parent_link/原筛选/排序/游标/状态/命令控制含义不变。后端、合同和前端同版本更新，无旧DTO协商。

候选先获权、有界n+1，再单次批量终检覆盖全部候选，含has_more的额外行；同SQL核主体角色团队、装配提供的原Session证明、Ticket/Session父READ并读取展示字段。等待后失权整次失败关闭，无逐行父请求、无N+1、无终检后异步补资料。资料缺失/过期返回null不删合法异常行。无迁移、SQL文件、新表、Worker、新开关或真实外部调用。

前端等宽Ticket编号+secondary单行省略标题；Session姓名/null缺省；公共故障保持。全部样式沿Token；保留56px行高、来源列≤40%及原详情/跳转。接口模块、总导航/四GET索引、docs/08 T32及卡21后继说明同步。

## 验证风险与停止条件

原PR路径选择没有覆盖T32后端合同/Session/兼容入口。为本次新增字段及终检风险，将原五个T32入口加入pr-notification，不删除或重命名旧注册入口。测试覆盖真实Ticket编号/标题、完结/原消息过期、Session姓名缺失/过期/错误绑定、n+1父失权、角色/团队变化和当前持久Session撤销，以及查询次数、原Sender/POST/游标/隐私断言。适用计划+直接风险通过即停止，不自动扩到full/certify或现场。

初次严格build通过；本地直接运行3入口7例为6PASS/1FAIL。失败发生在新增合成资料准备：原T32 fixture已有Journey，沿新建Journey helper试图用不同快照重建同一原始Intake，触发P2_015_DECISION_CONFLICT；不是产品投影失败。修正为复用已存在的合成Journey并按fixture既有UPDATE方式填入经MockResolvedDirectory/snapshotReporterProfile生成的资料，原身份与Leg绑定保持。原失败保留在D:/CodexEvidence/pc-admin-n3-retirement-20261104/a-direct-initial.log。

后续结果、四宽截图和资源关闭按实际候选追加；当前不得写成最终PASS。


## 后继本地验证（当前候选）

候选输入405db98e6e2296cdea171349c8dc4906148bf5c594d44f679bed16e754186840；manifest 7b3d9d7a53129f8782e42772f87ab5a3267927de59b8c349ab30406371bdb665。所选56入口单批385/385 PASS，失败/取消/SKIP/TODO均0，NOT_RUN为空；另有直接7例通过。Gate types（含Stylelint/ESLint）及verify-artifact通过。工具链保护检查单独记录，未完成前不冒称整票全检查通过。

前置记录不改写：新增官方Session证明测试曾在legacy迁移函数的TS推断边界遇到TS2353，尚未应用构建或运行用例；按现有fixture的具名参数对象方式调用，保留运行时守卫和真实迁移入口，未用类型逃逸。首轮选择因缺H5_MEDIA_FFMPEG环境路径，56入口全部NOT_RUN；随后仅在外部证据目录准备便携ffmpeg/ffprobe并核发布方SHA-256，不新增项目依赖/锁文件或生产配置。直接下载未完成的原件与已验证的分段下载原件均保留，停掉自有未完成下载进程。

N3真实PG/HTTP覆盖Ticket编号/标题与列表/精确单项一致；已完结、原Intake过期仍取Ticket事实；Session缺资料、DEFERRED、过期、错误身份绑定返回null，真实Schema拒绝重复Leg/Journey绑定。分页1条和50条均16次总SQL，且各1次终检，无随行数增长；原Sender次数不变。角色、团队、n+1额外候选父READ在终检前撤销均失败关闭；官方持久Session在投影等待期间撤销后为401。资料示例也已用完整三域闭合响应验证JSON Schema。

[四宽截图与实测](../../docs/ui/evidence/n3-source-projection/README.md)：来源列占比1920=39.855%、1440=38.380%、1280=29.435%、900=25.532%，六行均56px；Ticket真实编号/标题与Session姓名链接、缺省姓名、原parent_link、无父详情扇出、无POST及原Sender次数均有浏览器断言。

本地合成库已收回，仅剩postgres；PG停止成功。原始日志、逐例报告、manifest、图像哈希、Schema示例与工具来源证明集中于D:/CodexEvidence/pc-admin-n3-retirement-20261104/。提交后的CI与审查仍按GitHub完整head独立核验，不重绑本地未提交候选身份。
