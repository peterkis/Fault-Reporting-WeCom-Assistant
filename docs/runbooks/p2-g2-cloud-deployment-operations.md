# P2-G2 腾讯云部署与运维手册

适用仓库：Fault-Reporting-WeCom-Assistant；编写日期：2026-09-08。以V1.4、Accepted ADR和当前授权为准；旧docs15中的P3历史切换描述不属于本项目当前范围。

## 1. 当前部署能做什么

当前状态为 **停止态部署准备（STAGED_NOT_ACTIVATED）**。云服务器用于后续真实联调；早期状态查询/业务咨询缺口已按后续授权修复，本地P2-G2自动化准备已达READY_FOR_LIVE_E2E，正式Gate仍未通过。2026-09-09已另行上传当前READY候选到新停止态目录，旧发布目录保留。授权提交为 `d7311cdbfe30c66f37d22a553a3e8f0e04e27cd1`，它不是就绪候选。

这次上传受检代码、安装隔离Node依赖、核对版本/指纹、保存运维资料；按负责人补充要求，PostgreSQL基础实例采用宿主机原生安装，数据不放在Docker中。没有启动App/Worker/Gateway，没有连接企业微信，没有创建应用业务数据库或执行仓库迁移，没有开放公网业务端口。具体已执行结果以 `evidence/p2-g2-cloud-deployment-record.json` 为准；该文件不存在或步骤失败时，不得按本文的目标状态推断已部署成功。

本地已实现P2-G2三角色入口、现场许可和候选校验器；准确命令见 `prompts/P2-G2_rule_first_service_loop_runbook.md`。当前新发布目录及651文件完整性、依赖安装后指纹、断网READY证据校验均已核对，记录为 `evidence/p2-g2-cloud-ready-deployment-record.json`；这仍不等于业务激活。不要用 `npm run p2:012:live`、旧P2-012批准变量或禁用必要业务Flag绕过。全仓回归、独立审查及READY证据以当前报告为准，局部GREEN不能替代READY。


## 当前就绪候选（2026-09-09）

- 目录：`/opt/fault-reporting-wecom/p2-g2/releases/prep-17ebc9bc8862-e12a6d4b`。
- 候选：`17ebc9bc8862b88c1405663b57d290155086ff6cefa2bbae2ab26ac25f3ee54c`；651文件包SHA256 `914d33ce766e5a9cbfdd9ded2a19f1f7f56384c0609a92eb49792dfd86e73828`。
- 固定Node镜像：`node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`，实际Node v24.20.0；SDK/pg依赖锁未变。
- 云端断网离线检查、完整READY证据重算及安装后全部文件hash通过；无参数live命令按预期exit2。没有启动App/Worker/Gateway、业务监听或迁移。owned临时上传与容器均清理，旧release不覆盖。
- 现场Linux容器命令和整栈可观测条件见 `p2-g2-approved-live-container.md`；原PowerShell场景/证据操作见 `../../prompts/P2-G2_rule_first_service_loop_runbook.md`。

## 2. 已核实的服务器

| 项目 | 实测 |
|---|---|
| 登录用户 | ubuntu；sudo非交互可用 |
| 系统 | Ubuntu 24.04.4 LTS，x86_64 |
| CPU | 2逻辑CPU |
| 内存 | MemTotal 3,813,268 KiB；云产品4GB规格需结合控制台证明 |
| Swap | 2,035,708 KiB；本次采样未使用 |
| 根盘可用 | 约88.22 GiB（首次采样） |
| Docker | 29.6.1 |
| Docker Compose | v5.3.1 |
| 原有容器/镜像 | 首次检查均为空 |
| 原有Node/PostgreSQL/反向代理 | 未安装；未发现报修服务 |

物理规格满足后续核验的起点，不代表完成60分钟整栈资源验收。正式观察应包含数据库、反向代理和全部角色，使用自然GC，不能带 `--expose-gc`；休眠/缺样/重启中断不得拼接成连续60分钟。

## 3. 目录与凭据

数据库选型及启动/停止/升级/备份指导另见 `docs/runbooks/p2-g2-postgresql-deployment-decision.md`。采用PostgreSQL18原生systemd服务，PGDATA为宿主机 `/var/lib/postgresql/18/main`，不使用Docker卷；它目前在系统盘上，仍需异机备份。

```text
/opt/fault-reporting-wecom/p2-g2/
  releases/<release-id>/        # 受检代码与node_modules；停止态
    DEPLOYMENT-STAGE.json       # 文件清单、来源、明确的非就绪状态
  runbooks/                    # 本手册和部署记录副本
```

当前不创建 `current` 符号链接，避免把准备包误认为活动版本。部署记录给出本次准确release-id和镜像digest。后续每次发布用新目录，不覆盖旧目录，不在服务器直接编辑业务代码。

本次实际目录：`/opt/fault-reporting-wecom/p2-g2/releases/prep-d7311cdbfe30-98485185`。代码包458个受检文件，SHA-256为 `bfe8edefc4691b644cab33b313e9478116d51235a982dc4139f9670ecfa9a1df`。远端逐文件核验通过，依赖安装后再次核验通过。最新版手册和最终记录放在其同级 `runbooks`；release内原始手册作为打包快照保留，不在原包上追写。

本地 `.env.pilot` 的 `cloud_server_ip` / `cloud_server_pwd` 只用于SSH连接。密码不放在命令行参数、不显示、不写日志；服务器Host Key按本机已有known_hosts验证。`.env.pilot`、本地数据库URL、旧现场许可、模型密钥、私钥、历史现场日志和截图均不上传。

需要人工登录时，在PowerShell交互会话中输入服务器地址；SSH密码由终端隐藏输入：

```powershell
$serverAddress = Read-Host '服务器地址（不要复制到工单或公开日志）'
ssh "ubuntu@$serverAddress"
```

不要用包含密码的 `sshpass -p`、URL或脚本常量。首次新设备连接须核对服务器Host Key；不要设置 `StrictHostKeyChecking=no`。

## 4. 首轮非就绪快照打包与部署流程（历史操作）

本地先核对工作区和阻塞证据：

```powershell
git status --short
git rev-parse HEAD
node scripts/validate-v1-4-architecture.mjs
node scripts/validate-arch-006-rule-first-service-loop.mjs
node scripts/p2-g2-route-preflight.mjs --run-local
```

最后一项当前预期exit=1：四个叶子用例2通过、2失败。它只创建/清理本地隔离测试库，不得用失败输出申请真实联调。

打包命令：

```powershell
node scripts/p2-g2-cloud-package.mjs
```

输出只含临时包路径、SHA-256、文件数量和release-id。打包器使用跟踪文件白名单及本次明确列出的诊断/手册文件，排除凭据、node_modules、Git元数据和历史现场证据。此历史打包器固定标记BLOCKED，不用于当前就绪候选。当前就绪候选由其固定库存及已验证Evidence另行形成停止态发布包，源指纹与本地一致，记录见evidence/p2-g2-cloud-ready-deployment-record.json。

将输出的包复制到服务器本次专属上传目录；不要覆盖其他文件。人工重复部署可使用：

```powershell
$packagePath = Read-Host '打包器输出的source.tar.gz绝对路径'
$remoteUpload = Read-Host '本次专属上传目录，例如/home/ubuntu/p2-g2-upload-日期序号'
ssh "ubuntu@$serverAddress" "umask 077; mkdir -- '$remoteUpload'"
scp -- $packagePath "ubuntu@${serverAddress}:$remoteUpload/source.tar.gz"
```

地址和路径只能由受信任操作者输入；自动化本轮通过SSH/SFTP结构化参数传递，不把密码拼接进shell。服务器解包前核对SHA-256、所有条目必须是相对普通文件且无软/硬链接；使用Python `tarfile` 的data filter。目标目录必须不存在。按部署记录指定的release-id创建新目录：

```bash
sudo install -d -o ubuntu -g ubuntu -m 0750 /opt/fault-reporting-wecom/p2-g2/releases
sudo install -d -o ubuntu -g ubuntu -m 0750 /opt/fault-reporting-wecom/p2-g2/runbooks
```

本轮的完整解包、逐文件核验、镜像和依赖命令以部署记录为准。若任一步返回非0，停止后续步骤，保留失败记录；不要跳过校验或用旧目录顶替。

服务器端的可重复解包步骤如下；三个变量都从本次打包器输出填写，不能使用已有release-id覆盖目录。上传目录应与scp目标一致：

```bash
UPLOAD="$HOME/p2-g2-upload-填写本次日期序号/source.tar.gz"
ARCHIVE_SHA256='填写本次打包器输出的64位SHA256'
RELEASE_ID='填写本次打包器输出的prep版本标识'
python3 - "$UPLOAD" "$ARCHIVE_SHA256" "$RELEASE_ID" <<'PY'
import pathlib, sys, tarfile, hashlib, json, re
archive, expected, release_id = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
assert re.fullmatch(r'prep-[0-9a-f]{12}-[0-9a-f]{8}', release_id)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
root = pathlib.Path('/opt/fault-reporting-wecom/p2-g2/releases') / release_id
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    assert all(m.isfile() and not pathlib.PurePosixPath(m.name).is_absolute()
               and '..' not in pathlib.PurePosixPath(m.name).parts for m in members)
    assert len({m.name for m in members}) == len(members)
    manifest = json.load(tar.extractfile('DEPLOYMENT-STAGE.json'))
    assert manifest['release_id'] == release_id and manifest['ready_candidate'] is False
    assert manifest['secrets_included'] is False
    assert {m.name for m in members} == {f['path'] for f in manifest['files']} | {'DEPLOYMENT-STAGE.json'}
    root.mkdir(mode=0o750)  # 已存在即失败；不会覆盖
    tar.extractall(root, filter='data')
for file in manifest['files']:
    assert hashlib.sha256((root / file['path']).read_bytes()).hexdigest() == file['sha256']
print('STAGED_NOT_ACTIVATED', len(manifest['files']))
PY
```

这是停止态包专用流程；就绪候选的正式发布需要其单独校验清单，不能仅把 `ready_candidate` 改成true。

## 5. Node隔离运行与依赖

服务器不全局安装Node。使用官方Node 24镜像，拉取后保存确切digest，后续命令固定该digest，不继续追随浮动tag。下面的变量从本次部署记录填写：

```bash
RELEASE='/opt/fault-reporting-wecom/p2-g2/releases/prep-d7311cdbfe30-98485185'
NODE_IMAGE='node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e'
sudo docker run --rm --network none --read-only --memory 256m --cpus 0.5 "$NODE_IMAGE" node --version
```

初次依赖安装只在该release内进行，使用package-lock锁定版本，禁止修改锁文件或升级SDK。安装容器允许连接npm仓库，不能挂载任何运行秘密：

```bash
sudo docker run --rm --name p2-g2-dependency-install \
  --label com.fault-reporting.scope=p2-g2-preparation \
  --user 1000:1000 --memory 768m --cpus 1 \
  --mount "type=bind,source=$RELEASE,target=/app" -w /app \
  -e npm_config_cache=/tmp/npm-cache \
  "$NODE_IMAGE" npm ci --ignore-scripts --omit=dev --no-audit --no-fund
```

`--ignore-scripts`用于当前两个纯JS依赖的准备安装；不得把“安装通过”当作SDK/WSS/业务验证。最终候选仍需完整测试并记录依赖版本。安装后重新核对源码manifest，确认只有node_modules新增。不要使用 `npm audit fix`。

本次云端实际Node为24.20.0；本地RED使用24.18.0，两者都满足package.json的24主版本范围，但不是相同运行时。本次SDK仍为1.0.6、pg仍为8.23.0。云端只检查安装、语法、帮助和缺配置拒绝，没有把本地回归结论移植成云端业务PASS。

## 6. 激活、启动、停止和重启

**当前：保持停止态。** 查看本项目容器应为空：

```bash
sudo docker ps -a --filter label=com.fault-reporting.scope=p2-g2-preparation
sudo systemctl is-active docker
```

当前G2精确CLI与PowerShell操作已在prompts/P2-G2_rule_first_service_loop_runbook.md交付；以下环境/独立许可仍是激活前置：

1. 独立修复领域缺口，Direct Leg接缝RED/GREEN及全部当前候选测试通过，形成就绪提交及候选指纹。
2. 可执行的P2-G2启动清单和校验器；校验须在SDK、监听、数据库写入之前拒绝缺失/过期/错候选许可。
3. 独立测试数据库及001–032受控安装、两名坐席与ADMIN、至少三名测试Reporter、Bot/群/人员范围、允许文本和发送预算。
4. HTTPS域名/证书、Reporter路径和客户设备访问。SSH登录成功不代表公网HTTPS或企业微信客户端成功。
5. App/API/SSE一个进程、Worker一个进程、Gateway一个活动连接；不另启旧P1 eager-ticket入口或第二Gateway。App/Worker/Gateway池上限4/2/1，控制/观测连接另计。

真实发送仍需候选绑定的独立许可，云主机部署授权不自动填写这些许可。启动后先检查base_service_ready和各角色状态，再进入批准的测试输入。AI/OCR关闭、无模型Key/网络，核心服务仍须可用。不要通过关闭规则Worker、Review或通知让健康检查空跑通过。

本轮没有创建长期服务单元，因此没有 `systemctl start p2-g2` 命令可运行；不要虚构它。未来启动入口必须负责优雅SIGTERM、停止Gateway新入站、等待在途事务、关闭三个角色和连接池。普通重启不能批量重发UNKNOWN，也不能直接kill本机全部Node/PostgreSQL进程。

## 7. 日常巡检

当前停止态可执行：

```bash
uptime
free -m
df -h /
sudo docker ps -a --filter label=com.fault-reporting.scope=p2-g2-preparation
sudo docker image ls --digests node
sudo journalctl -u docker --since '1 hour ago' --no-pager --lines 80
```

不得把原始journal、容器环境变量、数据库URL、消息正文、Reporter标识或Token复制进Evidence。只记录时间、稳定错误码、计数、资源量和hash。

本次apt安装提示 `packagekit.service` 与 `tat_agent.service` 存在待重启项；未自动重启这些非本项目服务。可在云主机维护窗口核对影响后处理，尤其不要在依赖腾讯云控制通道排障时随意重启其代理。本项目PostgreSQL已完成必要的重启与状态核验。

激活后的巡检应包含：三个角色PID/uptime、Gateway认证与重连、持久入站/规则积压和最老年龄、Review队列、Ticket/Incident命令失败、Delivery待发送/FAILED/UNKNOWN、订阅过期、Reporter刷新、SSE客户端数与降级、数据库连接/等待/长事务、RSS/CPU/FD和磁盘。公共健康接口不能返回私有指标或凭据。

排障顺序：先判定是否仍能持久化，再检查Worker与数据库，最后核对Gateway/Provider和客户端。ACK不明先只读对账；未确认“未送达”前不重发。HTTP503不一律表示业务未提交，应保持原命令ID查询/重放既有收据。业务事实和已发生Event不得靠SQL改状态“修好”。

## 8. 升级与回滚

升级：新候选→新release目录→hash/Schema/自动化核验→独立现场许可→受控停止旧角色→启动新角色→业务与客户端验证。代码、SQL、模板、配置语义或Web资产变化均重新绑定候选，旧现场批准不沿用。

当前准备包无活动链接、无应用业务数据库、无业务进程，回滚是保留停止态并撤销使用该包；不需要down migration。原生PostgreSQL基础实例及其数据目录独立于代码发布目录，应用回滚不得删除它。若清理本次准备文件，先根据部署记录核实完整绝对目录与归属；只删除该release和本次上传目录，不删除整个 `/opt`、Docker存储或其他版本。

正式运行后的应用回滚不得删除Message、Ticket/Incident Event或Outbox。数据库恢复是独立受控操作：停写、加密备份、隔离恢复核验、RPO/RTO确认与批准后切换；不把测试库清理当成生产备份。备份密钥与文件分离，备份应在异机保存，禁止明文dump落盘。当前未配置备份任务，不宣称已有自动备份。

## 9. 当前验收边界与后续文档

`evidence/p2-g2-cloud-deployment-record.json`记录本次部署范围、包/文件/镜像指纹、命令退出码、版本、容器清理与明确的非就绪状态。`evidence/p2-g2-domain-gap-report.md`记录阻塞原因及最小独立修复建议。两者都不能作为P2-G2现场PASS或Owner Approval。

在业务激活前，本手册仍须补齐实际G2启动/停止入口、服务名、固定镜像、受控环境文件、HTTPS、数据库/备份位置和演练结果。缺失这些项时继续保持停止态，不能把本手册当成已完成真实联调。

命令依据：[Docker官方资源限制与运行说明](https://docs.docker.com/engine/containers/run/)、[bind mount说明](https://docs.docker.com/engine/storage/bind-mounts/)、[Paramiko SSHClient接口](https://docs.paramiko.org/en/stable/api/client.html)。
