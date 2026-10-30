# 登录静态压缩与背景30fps

状态：IMPLEMENTED / VALIDATION_PENDING。用户明确授权实施评估建议中的静态压缩和背景独立30fps，保留现有视觉范围及110万像素，验证后提交、推送并更新服务。初始HEAD `65eb92bbd210378d951a7c31c844f8957339ce25`，初始工作树干净，唯一写者为当前会话。

## 范围与合同

背景使用锁定Shaders 4.0.5公开core渲染器的setFrameRateCap(30)，固定原SolidColor/两个Blob、srgb、元数据、数值和顺序；生命周期保留就绪/暂停/尺寸/销毁及一分钟内最多3次device-loss重建，终止故障进入原CSS回退。core路径无遥测入口。组件保留PIXEL_BUDGET=1100000和相同展示CSS，Lanyard源码、全局rAF、主进程及客户端包不修改，不切换减动偏好。

静态JS/CSS构建时生成identity/gzip/Brotli及大小/SHA-256元数据，不在请求时压缩。服务器启动的单次验证缓存核对哈希与解压后同一原始字节，最多32项逻辑资产、单份4MiB、总公共缓存16MiB；同一manifest原URL协商q值并返回Vary: Accept-Encoding、正确编码/Content-Length、HEAD无正文；拒绝所有编码q=0时406，直接sidecar/query/未知路径继续拒绝。只压缩公开静态JS/CSS，动态登录HTML、认证、Cookie、二维码生命周期及权限保持。复用H5的原编码协商语义，抽取纯函数并运行其原回归；H5前端和压缩产物应逐字节保持。

无数据库/迁移、配置/Flag默认值、新依赖或客户端变更；无真实业务写入/发送，不推进Gate。v0.1.14无需重装。服务回退沿旧owner/备份及本轮回退脚本。

## 验证清单

- 最终候选一次普通构建、strict/negative、已注册的正式嵌入登录浏览器1项、H5静态原用例、相关构建工具/文档测试、制品检查；HTTP增加br/gzip/identity/q/HEAD/Vary和解压字节一致性覆盖。
- 实际0.1.14隔离profile/合成Provider，单独测GPU时间戳、提交频率、约110万像素、无全局节流、工牌拖动/翻面及同iframe，核对1440/1000窗口视觉、隐藏/离线暂停和恢复。性能测试不和浏览器交互回归同时争用图形窗口。保留前轮60fps基线的对象与限制，不重绑历史数值。
- 沿现有受控prepare/activate/postflight/配置与业务事实保护流程发布，Linux组件及公开压缩表示逐字节/安全头核对，再用无证书绕过/无Provider替身的0.1.14窗口验证实际域名。所有自有窗口正常退出，临时上传精确清理，旧owner/数据库备份保留。
- 不运行full/certify、真实手机或物理合盖验收；本轮不优化工牌编译或其他评估建议。证据目录`.local/electron/login-shader-opt-20261030/`。
