# 医小修 H5 重做执行记录

日期：2026-10-20。用户已确认完整实施计划，并授权多个子代理并行开发。

基线为 `c4d4492333dc70b49ca0e67bdc60f36303f0c4ac`，后端运行接线已由上一聊天合并收口。决策见 [ADR-0035](../../adr/0035_yixiaoxiu_h5_multimedia_and_member_service.md)。Stitch 唯一设计项目为 `1016264531564507497`；用户的 `h5/docs/prototype` 原件不改写。

## 分工与交接

Root 管理公共合同、依赖锁、迁移编号、HTTP/runtime 装配、构建管线、最终类型／集成／浏览器验证。子任务使用独立 checkout；源码范围明确，不并发写共享候选。子任务不推送、不评论、不关闭 Issue，不调用正式 Provider／WeCom，不执行现场迁移。

开发线为 H5 页面、V2 受理与成员业务、媒体存储与设备桥、管理端消费。子任务交接包含源码提交、测试原件、资源状态及 STOP。完成状态以本文件后续实际证据为准，不因本计划写为通过。

## 验证状态

实施代码已整合。新版页面、媒体与 V2 业务、管理端消费、正式制品和现有 Worker 接线均有实现；新增开关保持 false。固定基线和本地预览见 [H5 README](../../app/h5/README.md)，实际成员／管理端接口已进入 [METHOD + PATH 索引](../../docs/api/endpoint-index.md)。

分线实际验证包含真实 PG18 的原子媒体绑定、原 Core 建单、完成／重开／评价、当前 READ、催单事实及原 UUID 恢复；真实受控 FFmpeg 覆盖短 AMR、WAV 与 MP4，原失败与 setup 缺口保留。浏览器使用合成资料对照八屏，并检查英文、320px 及恢复栅栏。分线结果不重绑为统一候选结果。

统一候选的源码身份、实际测试路径／数量、制品哈希、浏览器记录、资源清理和未执行项由本机本轮 [最终验证记录](/D:/wecom-workbench-evidence/h5-rebuild-20261020-c4d44923/validation.json)记录；日志和截图在同一自有证据目录。该记录在实际运行后更新，不改历史证据或旧 tested_head。新增测试登记到活动 selection 与独立 `yxx-h5-rebuild` 子集；普通 PR／current 回归准备显式 FFmpeg 路径，不以 SKIP 代替通过。

实机企业微信（iOS／Android）录制、播放、首次绘制和真实收件仍为 NOT_RUN。没有部署、现场迁移或真实 Provider／WeCom 调用，没有执行 full／certify，不推进 Gate。缺少可信 App／第三方人员映射时资料保持缺失，报修可继续；后台补齐未扩张 Worker 密钥边界。原始 `h5/docs/prototype` 未改写、未纳入本次提交。
