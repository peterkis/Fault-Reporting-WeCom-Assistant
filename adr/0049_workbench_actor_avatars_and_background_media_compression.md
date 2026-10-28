# ADR-0049：处理记录头像与后台媒体压缩

状态：Accepted（2026-10-28 用户明确要求实现；媒体策略以同日后继要求为准）。不推进既有 Gate。

详情中的联系电话独立显示在报修时间上方；附件存储提示采用可键盘聚焦的 Lucide 图标和 Tooltip；处理记录不显示已加载条数。

头像为当前展示缓存，不能成为人员、权限或历史操作人事实。沿操作事件中的内部 principal 关联，禁止按姓名匹配。普通企业微信 user/get 对新应用未必提供头像；复用正式第三方目录适配器和显式 Bot 原始 ID Resolver，逐次将详情的 provider user_id、employee_id 与配置医院根节点组织树交叉核验。没有匹配或头像时保留姓名缩写，不伪造照片。

新增默认关闭的 `workbenchActorAvatarsEnabled`。现有 Worker 单次刷新一个当前工作人员，最多缓存 256 人；成功缓存 24 小时，缺失/失败缓存 5 分钟。组织树只在 Worker 内存保留一小时，沿既有有界协议；不发布全院人员列表，不向 APP/Gateway 传 Provider key。只从 HTTPS 白名单 CDN 读取不超过 512 KiB 的头像，规范化为 64px WebP，单份不超过 32 KiB。APP 只在原事项和当前员工会话 READ 前后终检后输出同源图片，不向浏览器透露 Provider ID、头像原 URL 或凭据。

用户已确认“视觉无明显损失”，允许高质量重新编码，优先保持文字、分辨率和帧率。用户随后明确：上传成功不能因后台转换失败要求重传，默认保存原始媒体。故原文件按既有加密、留存和绑定合同可靠保存；后台生成压缩副本，失败保留原件并在 PC 标记转换异常。早先“不存原件”的要求被这一后继策略取代，不批量改写历史附件。

新增默认关闭的 `YIXIAOXIU_H5_MEDIA_COMPRESSION_ENABLED`。图片用 sharp 0.35.5：保持像素尺寸、自动方向及色彩，PNG/文字图优先无损 WebP，照片使用高质量 WebP。视频复用受控 FFmpeg 子进程：不固定缩至 720p、不固定 24fps，使用高质量 H.264；无法在资源/质量边界内完成时保留原件并标记失败。音频沿原合同。

所有转换留在既有 Worker 的顺序 runOnce 中，不增加进程角色、周期时钟或并行转码。保留单作业、单 FFmpeg 子进程、既有 32 MiB 明文预算及截止时间。头像与压缩的原始错误、文件路径和个人值不进入公开日志；PC 只读取安全错误码和尝试时间。失败不回滚已接受报修或原附件。

前向 068 仅建立头像展示缓存，069 仅添加媒体转换诊断字段。关闭功能停止新缓存/压缩任务；已有原件、成功副本和 Ticket 事实保留。源记录、原 tested_head 与历史失败不改写。

来源：[现有 Provider 协议](../docs/66_p2_007_formal_third_party_staff_directory_provider.md)、[企业微信成员字段限制](https://developer.work.weixin.qq.com/document/path/90196)、[sharp](https://github.com/lovell/sharp)、[FFmpeg](https://github.com/FFmpeg/FFmpeg)。已比较 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)；本任务使用服务器现有 Worker，不把转码负担放到手机端。
