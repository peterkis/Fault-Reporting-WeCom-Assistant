# PostgreSQL 部署选择：个人单机运维采用原生安装

日期：2026-09-08。针对当前Ubuntu 24.04、2 vCPU、4GB云规格单机，选择 **PostgreSQL 18原生安装 + systemd**。本次服务器实测系统可见内存约3.64GiB，Docker已存在但没有容器。

已实际安装：PostgreSQL **18.6**（Ubuntu `18.6-1.pgdg24.04+2`），`postgresql@18-main`为active，父服务已enabled。PGDATA实测为下面的宿主机目录，属主postgres、权限700、底层为根盘ext4；实际5432监听仅回环。应用业务库、自建业务角色、自定义业务表和trust认证规则均为0。未执行仓库迁移。详见 `evidence/p2-g2-cloud-deployment-record.json`。

## 比较与结论

| 维度 | 原生安装 | Docker + 宿主机目录绑定 |
|---|---|---|
| 个人维护 | apt、systemd、psql、标准路径，步骤较少 | 额外维护镜像digest、容器、挂载、网络与容器用户权限 |
| 数据独立 | 直接使用宿主机目录 | 配置正确的bind mount也可将数据放在宿主机；不能用容器可写层 |
| 版本固定 | 安装postgresql-18，不用自动追随大版本的postgresql元包 | 固定major与digest；不能追随latest |
| 排障 | 可直接检查服务、目录、权限、socket和日志 | 还需区分宿主机、容器和网络层 |
| 迁移环境 | 安装同版本并按PostgreSQL恢复流程迁移 | 镜像环境更易重建，但仍需同样的数据备份、兼容性和恢复核验 |
| 性能 | 直接使用宿主机文件系统/网络，路径简单 | 原生Linux下bind mount直接访问宿主机文件系统；性能取决于I/O、网络和资源配置 |
| 适合本项目的程度 | **优先选择**：一个PG实例，单人维护，无多版本并行要求 | 暂无必要；未来统一容器化运维需求明确时再评估 |

这个选择主要降低维护复杂度，**不是原生一定更快的性能结论**。目前没有相同负载的A/B测试；不编造性能差值。Docker daemon已经安装并用于Node准备工具，因此原生PG也不会自动消除现有Docker后台资源。数据库仍需在完整App/Worker/Gateway/反向代理负载下验证2C4G资源和延迟。

Docker官方说明，bind mount把宿主机目录直接挂到容器；named volume则由Docker在其存储目录管理。按本次“数据卷不能放入Docker”的要求，明确采用宿主机PG标准目录，既不使用容器可写层，也不创建Docker管理的PG volume。[Docker存储说明](https://docs.docker.com/engine/storage/bind-mounts/)

## 数据、配置和日志位置

```text
/var/lib/postgresql/18/main/                  # 数据与WAL，宿主机目录
/etc/postgresql/18/main/                     # 配置与pg_hba.conf
/etc/postgresql/18/main/conf.d/p2-g2-personal.conf
/var/log/postgresql/                         # PostgreSQL日志
postgresql@18-main.service                   # 具体数据库集群服务
```

采用发行包标准路径，避免另造数据搬移和权限维护流程。当前目录在服务器系统磁盘上；它不是独立云数据盘，也不是备份。重建系统盘会丢失数据，必须另做加密异机备份。若未来增加云数据盘，应先独立规划挂载、启动依赖和迁移校验，不能在线移动PGDATA。

数据目录归postgres所有，权限由initdb设定；应用运行用户不拥有PGDATA，不通过文件权限或共享数据库直写集成绕过业务接口。外部不开放5432，仅监听localhost；未来同主机Node容器可通过受控的宿主网络访问回环地址，仍须专用数据库角色和SCRAM认证，不为容器方便而开放公网PG。

## 版本与安装

Ubuntu默认仓库随发行版固定PG版本；本项目选择官方PGDG仓库中的18主版本。官方仓库支持Ubuntu noble 24.04。当前本地回归环境为18.4，云端实际安装补丁版本记录到部署Evidence；不得把不同补丁版本视为已做过同候选测试。[PostgreSQL官方Ubuntu安装说明](https://www.postgresql.org/download/linux/ubuntu/)

在服务器的新环境执行：

```bash
bash scripts/p2-g2-postgres-native.sh --check
sudo bash scripts/p2-g2-postgres-native.sh --apply
```

脚本只适用于当前无PG的Ubuntu24.04/amd64新主机。发现已有PG、数据目录或PGDG配置时拒绝覆盖；只识别本脚本成功写入的归属marker，不猜测“这个库大概没用”。安装数据库基础实例后验证版本、PGDATA、localhost和业务库数量；不创建应用数据库、用户、测试身份，不运行本仓库001–032迁移。脚本失败则停在实际步骤，保留日志；禁止删库重装来“修复”。

起始配置：shared_buffers=256MB、effective_cache_size=2GB、work_mem=4MB、maintenance_work_mem=64MB、max_connections=40。effective_cache_size只是规划器估计，不是预分配2GB；work_mem是每个排序/哈希操作的额度，不能只按连接数计算总内存。保留fsync、WAL和autovacuum等可靠性机制，不用关持久化换性能。参数是保守起点，最终需按整栈实测调整。[PostgreSQL资源参数](https://www.postgresql.org/docs/18/runtime-config-resource.html)

## 启动、停止、重启、配置检查

```bash
sudo systemctl status postgresql@18-main --no-pager
sudo systemctl start postgresql@18-main
sudo systemctl stop postgresql@18-main
sudo systemctl restart postgresql@18-main
sudo systemctl reload postgresql@18-main
pg_lsclusters
sudo -u postgres psql -X -d postgres -c 'SHOW data_directory;'
sudo -u postgres psql -X -d postgres -c 'SHOW listen_addresses;'
sudo -u postgres psql -X -d postgres -c 'SHOW server_version;'
```

`reload`不能替代需要重启的参数变更。正式业务开始后先停新入站、等待在途事务并按维护窗口重启；不要直接kill全部postgres进程。`systemctl status postgresql`只是总控服务状态，实际集群须检查 `postgresql@18-main` 和 `pg_isready`。

```bash
pg_isready -h 127.0.0.1 -p 5432
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c \
  'SELECT count(*) AS connection_count FROM pg_stat_activity;'
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c \
  'SELECT count(*) AS waiting_count FROM pg_stat_activity WHERE wait_event_type IS NOT NULL;'
df -h /var/lib/postgresql
```

等待计数含正常后台等待，不能单凭大于0判故障。不要查询/导出包含原始SQL、用户标识或连接串的全量pg_stat_activity。日志避免完整SQL和参数，常规记录只留稳定错误码和计数。

## 升级、备份与恢复

小版本更新先阅读发布说明、保留可恢复备份、在隔离环境跑回归，再在窗口内更新 `postgresql-18` / `postgresql-client-18`并验证版本/健康/业务。大版本不原地覆盖数据目录，需另行选择pg_upgrade或逻辑导出恢复并验证扩展、排序规则、权限和业务一致性。apt安装成功不是恢复成功。

不把“数据在宿主机”当成备份。应将 `pg_dump` 或基础备份流加密后保存到独立机器/对象存储，记录时间、hash、保留期与恢复演练。在线直接复制PGDATA不能当成一致备份；PITR还需完整WAL归档和恢复测试。当前只部署空基础实例，没有创建定时备份或声称达到RPO/RTO。[PostgreSQL备份与恢复](https://www.postgresql.org/docs/18/backup.html)

后续业务库创建、001–032迁移、最小权限角色、加密备份密钥和异机目标，应在P2-G2候选就绪及现场范围明确后由受检部署流程完成。当前领域缺口阻塞不因安装PostgreSQL而消失。
