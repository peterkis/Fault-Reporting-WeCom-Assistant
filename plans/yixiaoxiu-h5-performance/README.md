# 医小修 H5 性能改造实施记录

当前会话／导航／录音修复候选 `14dad391` 已经 [PR #111](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/111) 审查与合并，并在云端实际切换。正式浏览器30/30、当前源码普通CI 638/638、独立生产Profiler27/27窗口通过；首次INVALID、发布失败和回退、旧资源权限修复及清理均保留。完整身份与边界见[本轮诊断与验收](resume-navigation-2026-10-21.md)，Android/iOS实机复验仍NOT_RUN，用户此次5分钟锁屏和起录失败的直接原因仍NOT_CONFIRMED。

此前 `8e1d8093` 发布轮的生产 Profiler 已完成：保留上传列表 RED，修复后 27/27 窗口通过；新 H5 已在授权云开发环境实际部署，7 个增量安装、原事实/人员保留，实机项仍 NOT_RUN。该轮身份、631 项 CI、云维护失败与恢复、自有资源回收见[发布与生产 Profiler 验收](release-2026-10-21.md)。下文候选07及原发布快照保留各自历史范围，不改绑为当前发布结果。

2026-10-21续作的本地合成预算已通过：首页整页从6次业务SELECT降为3次，十万科室／十成员并发的三视图HTTP p95均满足原1500ms；Windows Job实际约束2CPU／4GiB。最终候选07、25入口197项注册测试、80浏览器主样本及38项QA见[续作验收记录](closure-2026-10-21.md)。企业微信实机项仍为NOT_RUN；旧失败与原候选分别保留。

用户随后明确授权提交设计原件、PR审查修复与合并、main快进、自有资源清理，以及合并后的生产Profiler和新H5云部署。该发布阶段的当前身份、回归、CI失败与修复另见[发布验收记录](publication-2026-10-21.md)；下文候选07的历史度量不改绑。真实发送和Gate批准仍不在本次授权内。

授权：用户于2026-10-20批准完整计划并明确要求实施。基点为`b88e5ff1a22110cf5479d89677df77192e034864`，当前分支`codex/yixiaoxiu-h5-rebuild`。用户`h5/docs/prototype`原件、八屏设计基线、原历史Evidence和Gate停止线保留。

决策见[ADR-0036](../../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)，新闭合页面DTO见[entry合同](../../contracts/yxx_h5_entry_contracts.d.ts)。原API继续兼容；实际新增路径必须同时登记[接口索引](../../docs/api/endpoint-index.md)。

## 工作包

| 工作包 | 内容 | 当前记录 |
| --- | --- | --- |
| P0 | 固定编译基准、合同、资源预算与度量场景 | 新旧身份分开冻结；7项内核探针及正式2CPU／4GiB Job通过，旧基准NOT_ENFORCED原件保留 |
| P1 | 五视图entry、科室统计、补充分页、SQL合并与终检 | 首页一次entry含统计，整页3 SELECT；十万科室和完整600正式＋90预热通过，保留逐HTTP当前权限终检 |
| P2 | 小主题入口、路由/数据并行、Query工厂与统一刷新 | 五页完整JS闭包与80浏览器样本通过；主题408 B gzip，最紧详情122752 B，硬上限122880 B未变 |
| P3 | 私有预览、Range、队列、缓冲和Worker清理 | 原件／预览／渐进播放、撤权与单时钟预留回归通过；69轮有限Worker与QA媒体通过，非实机或活跃转码并发认证 |
| P4 | 局部状态、稳定Context、回执与页面同步分离 | 07注册与QA覆盖命令已提交但同步失败及恢复；当时生产Profiler为NOT_RUN，后续实测RED、修复及27/27提交计数见[发布验收](release-2026-10-21.md) |
| P5 | 编译HTTP/PG18/浏览器性能对照、回归与制品 | strict、875模块语法、制品及25工具／文档检查通过；25入口197测试、QA38、浏览器80和大库690完成，边界见[验证记录](verification.md) |

共享合同、HTTP/runtime装配、迁移登记和Git由主任务唯一写入。查询、媒体、前端核心、前端表单、静态构建和验证使用明确不重叠文件归属；仅主任务运行共享最终构建。所有外部能力使用模拟，数据库只使用任务自有loopback PG18。

## 预算与测量

正式主基准：390px、4Mbps下行、1Mbps上行、150ms RTT、CPU4倍降速；补充320px与1.6Mbps弱网。冷/热首页和详情各3次预热、20次计量。首屏所有必需JS合计不超过120KiB gzip，主题不超过2KiB；LCP p75不超过2.5秒、CLS不超过0.1、代表性交互INP不超过200ms。正常home/request/department业务SELECT分别不超过3/6/3，终检计入。模拟Provider固定100ms、10并发成员时entry p95不超过1.5秒。

记录raw/gzip/Brotli、HAR、Provider核验、SQL与池/资格排队、分位数及资源峰值。本人1万条、科室10万条、单单1万事件使用EXPLAIN ANALYZE BUFFERS。当前值必须以本候选实际运行补充，不拿设计预算或旧候选结果充当通过。

2026-10-20原始日志、运行树、HAR、SQL执行计划与失败截图保存在`D:\wecom-workbench-evidence\h5-performance-20261020-b88e5ff1`；2026-10-21续作位于`D:\wecom-workbench-evidence\h5-performance-closure-20261021-b88e5ff1`。[验证记录](verification.md)区分原基准、被淘汰候选、组件预检和最终候选，不合并不同身份的通过结果。

当前最终候选07的manifest为`4b0fe5e35cb4305b4c98f63e61b2d0b2cae7d084e21ebd3438aa574604d2a7ce`，source input为`e5bd346c0a160b26cd73394520807f0bfdf9ce66dbf5562876b2e7386c6c8112`。首页／详情冷启动LCP p75为1200／1224ms，代表性交互最大88ms，最大CLS0.0161743；三视图大库正式200样本各自HTTP p95为1041.179／624.560／1204.216ms。690个HTTP的物理业务SELECT2438、逻辑参与2760，每请求仍3／6／3；共享扫描、初始及终检分别可追溯。实际成员核验队列最大2活动／10 pending，容量仍2／32且BASE最多1，逐HTTP核验一次。完整分析见[PostgreSQL评估](postgresql-assessment-2026-10-21.md)。

2026-10-20原候选`366791ca6473520cfe191b18c527474c40b7eda2095d79f98f09185d8585de88`仍保留原结论：首页／详情冷启动LCP p75为1228／1192ms，交互最大136ms、详情122676 B gzip；整页首页6 SELECT未达标，十万科室单SQL1474.798ms不足以证明并发预算。它与07不是同一被测对象，不能用07结果回写原记录。

## 关闭与停止线

回退当前H5页面和新增读取装配，不删除Ticket事实、不逆向修改旧迁移；已产生的预览保留原留存清理能力。显式H5开关默认false，不新增第二工单核心、Redis、SSR平台、常驻重型服务或连接池。不得自动部署、现场写库、真实发送或推进P2/P3 Gate。

用户指定的`h5/.env.local`已新增且被Git忽略，H5与性能开关显式开启；生产默认值仍false，公开进度写仍false。该文件是完整宿主配置的显式后加载覆盖层，状态`LOCAL_H5_ENV_CONFIGURED_NOT_STARTED`；没有启动另一环境，密钥未进入67个公开文件或36个压缩表示。

企业微信iOS／Android首次绘制、录音、相机、渐进播放与恢复前台仍为NOT_RUN，合成浏览器不能代替。正式大库和浏览器Job均无强制清理、最终自有资源0；注册07另有启动期conhost由固定guardian回收，`forced_cleanup:true`及审计保留。历史证据和离线PG目录保留。无关ARCH-005旧检查器的基线FAIL另行保留，没有称为全仓全部检查通过。本轮结论限于获授权的本地性能续作，不包含部署、真实发送、现场业务写库、生产认证或Gate推进。
