# P2-G2 云端受控运行命令

本文件适配已安装的Docker与宿主机原生PostgreSQL。当前新候选仅完成停止态发布、依赖安装、断网指纹/READY证据检查；**以下live模板尚未执行，需要独立现场许可**。没有名为p2-g2的systemd业务服务，不使用旧P2-012启动命令。

## 已验证的停止态检查

在云端SSH终端中执行。固定镜像和目录来自 `evidence/p2-g2-cloud-ready-deployment-record.json`，下列离线命令已实际成功：

```bash
set -euo pipefail
G2_RELEASE='/opt/fault-reporting-wecom/p2-g2/releases/prep-17ebc9bc8862-e12a6d4b'
G2_IMAGE='node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e'
sudo -n docker run --rm --network none --read-only --memory 256m --cpus 0.5 \
  --mount "type=bind,source=$G2_RELEASE,target=/app,readonly" -w /app \
  "$G2_IMAGE" node scripts/p2-g2-check.mjs --mode=check
```

业务指纹应为 `17ebc9bc8862b88c1405663b57d290155086ff6cefa2bbae2ab26ac25f3ee54c`，564候选文件。651个打包文件在依赖安装后逐一hash复核；本地env未上传，临时容器已退出。镜像Node24.20.0与Windows回归Node24.18.0分别记录；云端未运行Windows浏览器全套测试。

## 激活前置与目录

负责人另行批准当前候选、Bot/群/Reporter/坐席、HTTPS origin、专用空业务库、故障、预算及完整运行时段后，按主手册准备manifest和独立批准文件。原生PostgreSQL留在 `/var/lib/postgresql/18/main`，不迁入Docker。业务库与坐席配置、HTTPS代理须另有实际核验，不能拿此前只安装PG基础实例代替。

主手册为 `prompts/P2-G2_rule_first_service_loop_runbook.md`，云端可在 `/opt/fault-reporting-wecom/p2-g2/runbooks/P2-G2_rule_first_service_loop_runbook.md` 阅读。它定义完整manifest、客户端延迟文件、proof与人工观察格式；只复制明确允许的数据库/Bot/签名密钥字段，不上传整个本地 `.env.pilot` 或云SSH密码。

为每次正式run创建新私有数据目录（示例末段必须替换为已批准的唯一run名称）：

```bash
G2_UID=$(id -u)
G2_GID=$(id -g)
test "$G2_UID" -ne 0
test "$(stat -c %u "$G2_RELEASE")" -eq "$G2_UID"
umask 077
G2_DATA='/opt/fault-reporting-wecom/p2-g2/live-data/p2-g2-approved-unique-run'
case "$(realpath -m "$G2_DATA")" in /opt/fault-reporting-wecom/p2-g2/live-data/p2-g2-*) ;; *) exit 2;; esac
test ! -e "$G2_DATA"
mkdir -p "$G2_DATA/tmp/p2-g2-config" "$G2_DATA/evidence"
cp -a "$G2_RELEASE/evidence/." "$G2_DATA/evidence/"
```

把本次私有 `manifest.json`、最小 `private.env`、真实测量用 `client-latency.json` 放入tmp/p2-g2-config，权限600；负责人提供的live-start-approval放入新evidence目录并绑定hash。原始READY Evidence保持字节不变。主手册要求的Windows前/后回归目录也按相同 `tmp/p2-g2-tests-<uuid>` 相对路径转移到G2_DATA/tmp。不要把旧源文件改名成新run证据。

## 仅许可后的容器模板

使用host网络访问同机原生PG，使用host PID命名空间读取真实PG与代理资源；只读挂载代码，单独读写本run的tmp/evidence。物理云机2核4GB是整栈上限，下面的1536MiB只是Node容器子预算，**不是**整栈2C4G证明。PG、代理、OS和自然GC下60分钟实测仍须满足Gate。

```bash
G2_PROXY_PID='/run/nginx.pid' # 改为实际已验证的nginx/caddy主进程PID文件
test -f "$G2_PROXY_PID"
G2_CONTAINER='p2-g2-approved-unique-run' # 必须与本次操作记录对应
G2_MANIFEST='tmp/p2-g2-config/manifest.json'
G2_ENV='/app/tmp/p2-g2-config/private.env'
G2_RUN='tmp/p2-g2-observation-run'
G2_BUDGET="/app/$G2_RUN/send-budget.jsonl"
G2_COMMON=(sudo -n docker run --rm --read-only --network host --pid host \
  --cpus 2 --memory 1536m --user "$G2_UID:$G2_GID" \
  --mount "type=bind,source=$G2_RELEASE,target=/app,readonly" \
  --mount "type=bind,source=$G2_DATA/tmp,target=/app/tmp" \
  --mount "type=bind,source=$G2_DATA/evidence,target=/app/evidence" \
  --mount "type=bind,source=$G2_PROXY_PID,target=/run/p2-g2-proxy.pid,readonly" \
  --tmpfs /tmp:rw,nosuid,size=64m -w /app)
G2_FUSES=(-e P2_G2_LIVE_TEST_APPROVED=true -e P2_G2_TEST_SCOPE_CONFIGURED=true \
  -e P2_G2_REAL_WECOM_SEND_APPROVED=true -e P2_G2_INCIDENT_PUBLIC_NOTICE_APPROVED=true \
  -e P2_G2_INCIDENT_PRIVATE_NOTICE_APPROVED=true)
"${G2_COMMON[@]}" "${G2_FUSES[@]}" "$G2_IMAGE" node scripts/p2-g2-check.mjs \
  --mode=live-check "--manifest=$G2_MANIFEST" "--env-file=$G2_ENV"
"${G2_COMMON[@]}" "${G2_FUSES[@]}" "$G2_IMAGE" node scripts/p2-g2-live-e2e.mjs \
  --mode=initialize-budget "--manifest=$G2_MANIFEST" "--env-file=$G2_ENV" "--budget-file=$G2_BUDGET"
"${G2_COMMON[@]}" "${G2_FUSES[@]}" --name "$G2_CONTAINER" -it "$G2_IMAGE" \
  node scripts/p2-g2-live-e2e.mjs --mode=live "--manifest=$G2_MANIFEST" \
  "--env-file=$G2_ENV" "--budget-file=$G2_BUDGET" --duration-ms=3840000 \
  --proxy-pid-file=/run/p2-g2-proxy.pid \
  --client-latency-file=/app/tmp/p2-g2-config/client-latency.json --interactive=true
```

以部署目录属主ubuntu的非root SSH会话执行；数据目录由同一UID创建，容器采用核实后的UID/GID。五个临时许可显式放在本次容器参数中，避免sudo env_reset清除，不写入持久配置。`-it`要求交互SSH终端。每条命令非零即停止；不是只设置五个true就取得许可，CLI仍校验当前READY、独立批准原文件、scope和空库。代码、依赖、模板或配置语义变化须重新验证候选，不能在运行中编辑。

## 观察、故障、停止与对账

控制台命令与主手册一致：status、capture:G2-I03、批准的Worker/Gateway故障、stop。结束前停止新入站、完成审核/核对并保留至少五个STEADY排空样本。优先使用控制台stop；控制台失联时，仅对已记录容器发送SIGTERM，给控制器关闭角色的时间，不能结束主机其他Node/PG/浏览器。

```bash
# 只读观察，在另一SSH终端重设同一G2_COMMON/G2_IMAGE/G2_MANIFEST变量后执行
"${G2_COMMON[@]}" "$G2_IMAGE" node scripts/p2-g2-resource-observation.mjs \
  --mode=observe "--manifest=$G2_MANIFEST" "--run-directory=$G2_RUN"
# 仅在需要停止本次已记录容器时执行
sudo -n docker stop --time 30 "$G2_CONTAINER"
# 状态必须是STOPPED_AWAITING_RECONCILIATION且process_count=0
"${G2_COMMON[@]}" "$G2_IMAGE" node scripts/p2-g2-reconcile.mjs \
  --mode=reconcile "--manifest=$G2_MANIFEST" "--env-file=$G2_ENV" \
  "--run-directory=$G2_RUN" --output=reconciliation-source.json
```

观察与对账也验证源批准文件绑定；对账不重发、不改状态、不迁移。启动前/后的Windows完整回归、各场景ACK、客户端文件和负责人最终声明按主手册编译；运行evaluate时使用同样挂载，把每个独立stream原样列出，不能拼接hash链。

没有自动重启策略。断线/重启要保留原run的事实、UNKNOWN与预算；正式控制器一旦结束，不能把同目录伪装成新空库run，先对账并按后续批准方案恢复。Worker/Gateway受控故障恢复使用已批准控制命令，不能docker restart绕开run生命周期。

撤销五个临时许可后核对容器/三个角色、池、SSE和本run浏览器。保留证据及数据库，除非另有明确可销毁授权。源release保留只读停止态；无down migration或历史投递清理。
