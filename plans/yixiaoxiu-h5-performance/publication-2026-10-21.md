# H5 发布与后续验收记录（2026-10-21）

本记录追加发布阶段事实；原[性能收口](closure-2026-10-21.md)、失败、样本和候选身份保留。PR 为 [#109](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/109)。本节写入时，PR 尚未合并；生产 Profiler、正式云部署与企业微信实机仍为 `NOT_RUN`。

## 提交范围

首提交 `a2956bee55e3edb7a72f9943d50fc9f351e7367a` 包含性能实现及用户要求提交的 `h5/docs/` 19 个原型原件。原件的版式、图片和设计文本未改写。`.env`、`.env.pilot`、`h5/.env.local` 均为 ignored，未提交；根 `.env.example` 的本轮本地修改也未提交，其原字节与补丁另存私有证据。

本地 H5 私有配置显式开启 H5／性能模式，仍不表示宿主已启动或云开关已开启。仓库持久默认值保持关闭。私有密钥、Provider 配置、数据库连接和云登录资料不进入 PR。

## 审查与修复

| 被审提交 | 实际结果与处理 |
| --- | --- |
| `a2956bee…` | Codex 提出 P1 旧通知／回执 URL 直达丢失、P2 性能 Worker 未要求 066。`fa77106b77443cbff7e7608ff447f8ed26ea5668` 修复；路由定向28项、runtime定向15项通过，旧失败保留。 |
| `fa77106b…` | Codex 提出 P2 搜索输入200字符与接口100字符不一致。`d6abce6b3a1b2bf2013865b924220e87f97603cf` 将输入上限改为100；同次补齐 App 036 和 H5 提醒049／053的真实启动依赖。runtime定向17项通过。 |
| `d6abce6b…` | [第三轮 Codex](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/109#issuecomment-6308823421) completed、无 findings；三个既有线程均已回复并解决。随后远端活动测试暴露 Linux 静态链接拒绝缺陷，故仍不能合并。 |

权限终检、默认关闭规则、成员范围隔离及原接口兼容保持。命令已提交与页面同步失败的语义未放宽。

## d6abce6b 本地完整回归

正式构建875模块、strict、文档与制品校验通过。冻结 manifest 为 `17313ec343c4b7256ecf5573b2062c4a885ebf658b70a2c4eb2c8dbe7a649bc4`，输入为 `5e904c78bb5ca308f93b4f1630e8fa12a264c5b656eff00c4b4525f79cc07c31`；1967个输入逐项核对，Git身份在整轮保持不变。

固定 Windows Job 2CPU／4GiB 下，25个相关注册入口、209项测试全部通过，`not_run=[]`；浏览器QA44项全部通过。新增5个旧URL／显式hash／前进后退场景，以及真实录入101字符后保留100字符并取得entry200的边界场景，均通过。

本轮只运行默认4个烟测样本（每组1次、无预热），不冒充重新运行原80正式浏览器样本或690次大库请求：

| 场景 | LCP / ms | 实测交互 / ms | 完整首屏JS gzip / B |
| --- | ---: | ---: | ---: |
| 首页冷启动 | 1576 | 40 | 117752 |
| 首页热启动 | 796 | 40 | 117752 |
| 详情冷启动 | 1216 | 40 | 122864 |
| 详情热启动 | 768 | 40 | 122864 |

最大CLS 0.016174。4份HAR首屏均为1次entry、0次独立统计、0次旧读取链路；首页读参与3次、详情6次。122880B首屏预算不变。媒体预览与渐进播放通过，进入页面自动读取图片原件／音视频正文均0。

注册Job与QA Job均exit0、forced_cleanup=false、最终active0；自有PG合成库／其他客户端0，停库成功、PID文件及监听均不存在。浏览器、HTTP、TLS资源归零。注册峰值commit 1,107,869,696B、working set 1,858,310,144B；QA分别587,390,976B／1,275,793,408B。

完整原件索引为外部任务根 `h5-performance-closure-20261021-b88e5ff1/pr109-round03-validation.json`，SHA256 `3dfaa96f23cb82157c85f62c7c661eee20023109e85db9b67a6f3f25d234f5de`。`pg-attempt30/31`离线保留。

前一round02虽然207个业务测试通过，但root在运行期间提交，完整source身份终检正确报 `MIGRATION_INPUT_DRIFT`；该轮整体FAIL、输入字节未变的对照及资源关闭原件均保留，未修改manifest或冒充通过。

## 远端 Linux CI 失败与可证伪修复

[run39549590178](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/39549590178) 精确绑定 `d6abce6b…`，实际活动集合为 `v3-p09`、236个入口。执行232个入口、598项测试：597通过、1失败；剩余4个入口 `NOT_RUN`。直接工具步骤因前步失败而SKIPPED，不能视为通过；手动full／certify亦未运行。

唯一失败为静态资源测试：链接artifact根目录预期503、实际200。原因是POSIX对带末尾斜线的目录URL执行 `lstat` 时会跟随末级链接；原实现也给assets和.vite目录添加同样的尾分隔符。旧测试在同一夹具中先建立assets链接，再建立.vite链接，后者还可能被前者的拒绝掩盖。

最小修复将file URL转换为不带尾分隔符的原生路径，再逐级 `lstat`；不使用 `realpath` 隐藏链接。三个链接场景分别使用独立夹具，保留原拒绝断言。manifest一次验证、4MiB缓存、哈希／压缩校验与资源白名单保持。

为验证跨平台原因，使用云端已有Node24.20.0镜像运行一次性Linux容器：network=none、2CPU／256MiB、只读根、16MiB临时卷、pids64，无数据库／Provider访问。相同测试编译字节在修前为13项中10通过／3失败；修后13／13通过。两个容器均已删除，现有运行实例与数据库未修改。这是私有编译模块的定向对照，不代替修后正式制品及新CI。

原CI ZIP为15,034,917B，SHA256与API digest一致：`584814af60f239771da11dc310e35edfd0836d35083e5a7d8f9213874693dc0b`；CRC通过。CI制品校验和数据库清理成功不改变整轮FAIL。原始日志、598项结果和4个NOT_RUN保留于外部CI原件目录。

## 合并后仍需执行

修复须再次通过正式构建、相关注册及适用CI，并取得当前head的Codex审查后方可合并。之后按用户顺序快进main、清理已确认自有资源，再运行生产React profiling renderer的组件提交计数；上传进度使材料结构列表提交时必须保留RED并修正，不以DEV函数入口计数替代。

云端已完成限定范围只读盘点：19／19现有迁移回执匹配当前工作区及编译SQL原字节。16项与Git blob仅为LF／CRLF差异，旧回执不得改写；部署须保留已核验制品字节。064–066维护器及实际迁移测试、容器FFmpeg／FFprobe、私有媒体配置与正式切换仍待完成。目录尚无可信同步，不伪造组织关系或科室0条。

iOS／Android真实首次绘制、相机、录音、渐进播放与恢复前台继续 `NOT_RUN`。本记录不授予真实发送或Gate批准。
