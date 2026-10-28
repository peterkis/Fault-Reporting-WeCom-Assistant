# 操作人头像与媒体转换状态

对应 [ADR-0049](../../../adr/0049_workbench_actor_avatars_and_background_media_compression.md)。默认关闭的新增能力，现场状态与验证见 [执行记录](../../../plans/pc-admin-electron/detail-media-2026-10-28.md)。

## 操作人头像

`workbenchActorAvatarsEnabled=true` 时，工单详情的操作事件可返回 `actor_ref`（内部 principal UUID 或 null）。系统/报修原文等没有可核实工作人员身份时为 null；不返回 Bot ID、Provider ID、工号、头像源 URL 或凭据。

`GET /api/workbench/items/ticket/{ticketId}/actor-avatars/{actorRef}`：无 query、无请求体。须当前员工会话及该 Ticket READ，actor 必须实际出现在该 Ticket 操作事件中。最终 SQL 共同核验同一原 Ticket/intake、当前角色与团队、会话和缓存身份。review/intake 路由明确拒绝，前端使用已获权详情中的 canonical Ticket。

- 200：`image/webp`，不超过 32 KiB，同源读取；`Cache-Control: private, no-store`，当前权限核验不被浏览器 HTTP 缓存绕过。
- 204：没有可用/未过期/身份一致的头像，UI 回退姓名首字。
- 401/404：当前会话或 READ 不再成立；不输出旧缓存。

现有 Worker 通过正式目录 Adapter 与显式 Bot raw UID Resolver 获取，详情 user_id/employee_id 与配置医院根节点组织树一致才接受。当前缓存只保存 64px 图片、身份指纹、有效期和安全错误码；最多256个当前工作人员，角色移除清缓存，成功24小时/失败5分钟。组织树仅 Worker 内存一小时；不写操作历史/报修快照，不改变人员和权限事实。

Provider key 只进入启用头像的 Worker。其 `actorAvatars` 配置携带 `validationProfile`；ISOLATED_TEST 必须有模拟 fetch，不能落到真实 Provider。APP 不调用外部目录，只读缓存；页面内同一操作人请求由 Query 合并，退出/撤权清除本地图片。

## 上传与转换

`YIXIAOXIU_H5_MEDIA_COMPRESSION_ENABLED=true` 在 069 后开启后台高质量压缩。上传成功仅依赖原文件通过原校验并可靠加密保存，原命令/绑定/保留期限不变；**不等待转码，也不因转码失败要求重传**。

Worker 在既有 runOnce 中生成压缩副本。图片保持尺寸，自动方向，PNG/透明图使用无损 WebP，照片 WebP quality 95。已经足够小的图片不再保存更大的重复副本。视频保留原分辨率/帧率（奇数边长只补齐一像素边缘），高质量 H.264 CRF 18；HDR 等无法在当前边界安全转换的输入保留原件并标记异常。音频沿旧合同。

Worker 仍为单作业、单转码子进程。图片 codec 在独立 Node/sharp 子进程运行，输入最大16MP，codec8秒限时；父级沿既有25秒进程截止、临时文件保全/清理和32 MiB明文预算。缓存、转换失败均不会改写已接受工单。

PC `web-report.media[]` 在启用时增可选 `conversion_error`，为 null 或 `{code,stage,at}`；stage 为 `PLAYABLE|THUMBNAIL`，at 为北京时间秒精度。错误只含安全 `YXX_MEDIA_*` 码，不含stderr、文件路径、私密字段。成员端原闭合 metadata 不添加这些字段。

PC 转换未完成/失败的图片、视频显式读取 `variant=ORIGINAL`；原件照常受当前 READ/绑定/留存与流式终检控制。转换异常用附件标题右侧图标显示，hover/focus 查看具体附件、代码与时间。H5 上传状态保持成功，复用原有“暂不能播放，原材料已保留”说明，不要求重传；工作人员可在 PC 查看或下载原件。

## 配置与迁移

- 068：`workbench.actor_avatar_cache` 当前展示缓存。human-v1 JSON 头像开关默认 false、root ref 默认 null；启用时 root ref 来自已有受控协议资料，key 来自 `THIRD_STAFF_INFO_SYNC_KEY`。
- 069：`intake.web_media_upload` 三个可空诊断字段，原媒体字段与原件不迁移、不覆盖。
- 维护入口：编译后的 `app/server/scripts/workbench-display-media-migrate.mjs --target=avatars|media --check|--apply`，要求 `PILOT_DATABASE_URL` 与精确 `WORKBENCH_EXPECTED_DATABASE`。校验前置SQL哈希、事务、具名锁、已有marker和实际列结构。
- 关闭相应开关停止新增任务；原件/成功副本及业务事实保留。缓存不赋权。
