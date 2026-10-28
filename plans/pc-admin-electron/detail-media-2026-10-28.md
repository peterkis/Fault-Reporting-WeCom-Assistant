# 详情精简、真实头像缓存与后台媒体压缩

状态：DEPLOYED / ENGINEERING_VERIFIED，用户体验接受待用户确认，不推进业务Gate。启动优化已按用户“提交并推送”提交为 `11c21c9e9dc420607a3d4e5da2018a8367f712f2`，当次已核实本地、tracking 与 live remote SHA 相同。分支为 `codex/pc-admin-electron-mvp`。本轮详情、头像与媒体改动依据后继“提交并推送”授权单独提交；历史构建仍绑定下述原HEAD与工作区指纹，不改写为后继提交。

## 用户确认与范围

联系电话移到位置右侧、报修时间上方；附件存储不可用提示改为附件数量右侧 Lucide 图标及 hover/focus Tooltip；处理记录标题移除已加载条数；操作人头像按真实身份获取并缓存。用户已选择视觉无明显损失、高质量重新编码，优先文字清晰度、分辨率和帧率。

用户后继明确：原始文件先保存，上传成功不能因转换失败要求重传；转换异常由 PC 标记，便于后续查询修复。这覆盖先前“不存原件”的要求。本轮不删除或批量重写历史原始附件。

实施合同：[ADR-0049](../../adr/0049_workbench_actor_avatars_and_background_media_compression.md)／[API与缓存边界](../../docs/api/workbench/actor-avatars-and-media.md)。新 Feature Flag 默认 false；前向迁移仅 068 头像缓存、069 媒体诊断。无 Ticket 状态、责任或通知事实改写。

## 来源与待核验项

已实际检索并阅读 GitHub 的 [sharp](https://github.com/lovell/sharp)、[FFmpeg](https://github.com/FFmpeg/FFmpeg)、[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)。采用 sharp 0.35.5 与已有 FFmpeg，处理留在服务器 Worker，不增加手机端转码负担；sharp 版本及 Node >=20.9 要求已由官方仓库/registry核验。色彩、方向和 WebP 参数沿 [sharp 文档](https://sharp.pixelplumbing.com/api-output/)。

头像现场只读核对：当前唯一 PC 工作人员的 Provider user_id/employee_id 与配置医院根节点组织树匹配；但头像字段不是有效 HTTPS URL，规范化返回 `AVATAR_URL_INVALID`。官方当前成员接口也没有返回 avatar/thumb_avatar。这是上游资料/授权缺口，不把未经验证的相对地址或同名照片当作真实头像；该人员先显示首字，合法头像到达后按缓存刷新。没有打印原始身份、姓名、手机号、头像源地址、key 或 token；没有写现场数据。只读原件在 `.local/electron/detail-media-20261028/avatar-*-check*.json`。

三项并行子任务分别提供头像边界审查、媒体画质/保全测试、浏览器几何/Tooltip测试。代理只写各自 scratch，Root 统一整合、构建和运行；静态检查不能代替编译/浏览器结果。原始失败、未执行项和最终运行结果按候选分别记录。

证据目录：`.local/electron/detail-media-20261028/`；发布回执目录：`.local/electron/deploy-detail-media-20261028/`。

## 验证与问题清单

最终编译候选基于上述 HEAD 的未提交工作区，source input hash 为 `58e1b93a5c8f27a7fa6e6bb3ee998fc03c2293fcb1c8bbf169e7cf927d5fb495`，manifest SHA-256 为 `3039fc874d3eecff634df6220a1f7154fe3b23dcd93ab0303f4c55255c9ce1da`，共2703个输出。904项编译Node语法、strict与负向类型、制品校验和文档检查均通过。

14个相关注册入口的最后执行结果合计88项通过、0失败、0跳过，文档工具测试19项通过。逐入口候选和报告位置见 `verification-summary.json`；这是本次相关子集，多轮修复后定向复测，不是单次全集/full/certify。最终候选复测了详情媒体浏览器入口；build04到最终候选只有该测试及其source map变化，产品输出相同。

| 问题 | 修复或处理 | 最后结果 |
| --- | --- | --- |
| H5首屏新增状态文案触及既有体积预算 | 保留H5已有原件保全说明，诊断只在PC显示，未抬高预算 | 构建PASS |
| 头像关联SQL同一参数text/uuid比较错误 | cards.id使用显式text参数，事件Ticket关联保留uuid | 头像13项PASS |
| HDR合成样本缺少有效HDR标记 | 修正样本元数据，仍要求不安全转换被拒绝且原件不变 | 画质8项PASS |
| 旧H5媒体测试沿用旧弹窗/Slider操作 | 按实际HeroUI弹窗和键盘交互、当前播放响应验证 | H5整合入口PASS |
| Tooltip测试首次指针跳入及键盘后重入不符合真实事件顺序 | 使用真实指针移动路径，并在hover/focus打开时分别核验错误码与时间 | 1280/960/390布局、hover/focus、原件预览及精确下载PASS |
| 转换失败误影响上传体验的风险 | 上传可靠保存原件后成功，后台失败只记安全诊断；PC可查看下载 | 保全集成2项PASS |
| 当前现场操作人头像缺失 | 身份匹配已核实；Provider不是有效HTTPS头像，官方接口未返回头像字段 | OPEN，上游数据/授权缺口，保留姓名首字 |
| 发布回退在新容器OOM/137或候选配置损坏时可能中断 | 回退允许已停止的失败新容器，记录异常状态；数据库身份及IMAGE兼容修复使用已核验旧配置 | 修复复核完成，8项纯模拟PASS；不是现场回滚演练 |
| Linux准备阶段读取私有配置EACCES | cap-drop=ALL下root不具备读取应用用户0600文件的特权；临时配置容器改用正式服务相同的1000:1000身份，不放宽文件权限 | 隔离准备PASS，原失败回执保留 |

旧FAIL、NOT_RUN及各轮manifest均保留。本地PG18已恢复4个原始基线库，确认无其他客户端后关闭，pg_ctl status=3、原PID退出、52690监听0；复用的既有数据目录保留。没有真实试单或测试发送。

图片采用PNG/透明图无损WebP、照片quality95；视频采用H.264 CRF18并保留分辨率/帧率。原件沿现有留存策略保留，因此本轮改善日常读取/传输用的副本，不承诺降低总存储占用；不执行历史原件删除。

服务器准备使用冻结制品，46项组件测试与真实Linux sharp编解码PASS。新配置只开启头像缓存和后台媒体压缩，并添加Worker专用Provider输入；42份旧配置原件保持原字节。准备阶段未启动新服务、未执行数据库迁移。独立审查仅为源码/模拟证据；两位代理在给出复核消息后最终汇总出现模型容量错误，未把该结束错误冒充现场验证。

## 发布与关闭回执

2026-10-28 14:45（北京时间）完成 `cd3120.mobimedical.cn` 切换，发布 `pc-detail-media-20261028-01`，运行owner为 `human-workbench-20261028-pc-detail-media-01`。068、069均先check=PENDING、apply=APPLIED、后check=NOOP_ALREADY_APPLIED；其余迁移哈希保持不变。

- 32项健康检查PASS，2703项输出哈希再次核验，容器重启次数0。
- 在关闭入口的窗口内完成1,199,348字节数据库custom-format备份，核验PGDMP头、TOC及SHA-256；未进行恢复演练。
- 迁移及启动前后Ticket、原始媒体metadata、目录权限、journey profile与投递事实保持一致；发布后再次比较通过。既有8份媒体文件（含4份原件）哈希保持不变，历史保留期不修改。
- 旧owner `human-workbench-20261028-pc-startup-01` 已停止保留，42份旧配置原件字节相同。新配置两个开关已实际启用；头像缓存现有1条UNAVAILABLE，安全错误码为 `ACTOR_AVATAR_IMAGE_UNAVAILABLE`，与上游缺口一致。
- 本机0.1.3客户端已受保护刷新，并打开既有合成验收记录：联系电话显示在报修时间上方，附件0右侧显示CloudOff，处理记录没有已加载条数。未新建试单、未发送测试通知。
- 远端本次upload目录及其中临时私有配置已删除；修订后的4份操作脚本留在发布目录的 `operations/`。当前release、备份、旧版回退保留。本地57个测试进程组均记录cleanup_active_processes=0；本地PG关闭如上。

普通关闭可停用两个新增开关。版本回退使用本次 `operations/rollback.py --execute-authorized-rollback`，保留前向迁移，先认证图片原件并保留metadata快照，再兼容恢复旧版播放引用；不删除原件/副本，不回滚Ticket或投递事实。该流程仅完成源码复核和8项模拟，实际现场回滚NOT_RUN。

发布、数据库备份或工程检查通过不表示用户已接受画质，不改变P2-G2-LIVE、P2-008及后续Gate停止线。原始失败、配置EACCES、模拟harness首次NameError与未执行项继续保留在各回执中。
