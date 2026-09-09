# P2-G2 云部署补充授权与执行边界

日期：2026-09-08。在本地路由前置测试复现领域缺口后，负责人继续要求：

> 我本地配置文件中存有云服务器参数，真实联调请对服务器进行部署，并将部署流程和命令、以及以后如何启动、运维进行详细指导性说明，保存到相应文件夹中。

随后明确：

> 评估postgres是否需要docker部署对于个人运维、系统性能更优，选择对个人轻量化更优的方式，当然数据卷不能放入docker中。

据此执行云服务器基础环境和停止态部署准备，覆盖初始“本轮不做云主机变更”的这一项限制；使用本地配置所指云主机，通过已有known_hosts验证SSH主机身份，密码只在进程内使用。选择PostgreSQL18原生systemd安装，数据使用宿主机 `/var/lib/postgresql/18/main`；Node采用固定digest的工具容器安装锁定依赖。未上传本地环境文件、连接串、模型密钥、历史现场证据或批准变量。

这项补充未改变领域修复范围，也没有指定真实发送的Bot/群/人员/文本/预算/候选许可。因此当前 `BLOCKED_BY_DOMAIN_GAP` 保留；没有启动App/Worker/Gateway，没有创建应用业务库或执行001–032业务迁移，没有真实企业微信发送、正式60分钟观察、Owner Approval或P2-G2关闭。

原生安装初始化了PostgreSQL系统集群（postgres/template0/template1），这是已执行的基础设施写入；不能笼统表述为“云端完全只读”。业务数据库、业务表和业务角色数量均为0。没有新建Migration033或修改已有迁移。项目停在准备包 `STAGED_NOT_ACTIVATED`，不是 `READY_FOR_LIVE_E2E`。

实际执行与版本、文件指纹、退出码、清理、未验证项见 `evidence/p2-g2-cloud-deployment-record.json`；操作手册见 `docs/runbooks/p2-g2-cloud-deployment-operations.md`。本地新准备文件保持未提交，不以失败的准备结果形成第二个feat就绪提交。
