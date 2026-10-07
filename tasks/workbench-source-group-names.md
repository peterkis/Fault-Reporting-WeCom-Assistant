# 来源群名称管理增量

日期2026-10-07。用户目标：管理端工单来源显示具体群聊；已确认管理员在管理端登记/修改。决策[ADR-0030](../adr/0030_admin_confirmed_source_group_names.md)，合同[接口文档](../docs/api/workbench/source-groups-design.md)。

本地实现包括管理员目录/名称写接口、看板与详情统一来源DTO、详情维护表单、独立037迁移及命令Schema。名称元数据独立于Ticket，原始来源不被改名/单聊覆盖。默认关闭，权限为当前ADMIN；原始外部ID不返回浏览器。

Backlog：LOCAL_VERIFIED。strict类型、构建、制品和干净候选环境下v3-p09相关45/45通过，见[本轮证据](../evidence/workbench-source-group-names-local.md)。依赖恢复及哈希一致已核对；任务PG已关闭，数据目录因自动审批拒绝删除而保留。无发布、真实库应用、发送、Gate推进或full/certify授权。

输入：有效原始Intake/Journey群来源、内部ADMIN和名称命令。输出：source_label/source_group及登记成功回执。数据库：新建workbench群名称/变更记录/成功回执三表；仅隔离合成库用于验证。资源：复用宿主池和进程，目录默认50/max100，无外部网络查询。关闭：sourceGroupDirectoryEnabled=false并重启宿主；保留元数据及审计。源码回滚采用独立后继revert，不删除旧证据或用户已有修改。
