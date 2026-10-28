# PC 员工媒体读取与预览优化

来源：用户确认的方案及 2026-10-28 PLEASE IMPLEMENT 授权。合同：[ADR-0050](../../adr/0050_pc_media_employee_read_and_server_previews.md)。仅本地实现、合成数据及浏览器验证；无云端部署、现场迁移、真实发送或 Gate 推进。

起始 HEAD：`c38f746b4b2f8c28ea759162bd7fad95f8540070`。头像与媒体压缩工作已提交；起始 tracked diff 为空，既有 `.local/` 原位保全。当前会话为唯一写者。

证据目录：`D:/wecom-workbench-evidence/pc-media-employee-read-20261028/`。起始制品检查为 `MIGRATION_INPUT_DRIFT`，重新构建基准后制品通过；原失败不归因于本轮代码。旧编译媒体服务计数探针使用模拟SQL/Store：1/10/20MiB分别触发19/163/323次媒体查询及36/324/644次授权回调，尚未计入外层HTTP，不能作为云端耗时。

## 完成与问题清单

- DONE：独立员工媒体入口、请求级授权、单次到期、受控完整性读取；官方宿主只在本次真实员工核验后标记内部认证结果，普通身份Port不能冒充员工核验。
- DONE：视频封面、070前向迁移及APP/WORKER默认关闭装配；原图片、视频和音频保留。
- DONE：PC服务端小图、原生音视频播放、两个预览并发、点击优先和取消；旧登记图片保持单读取。
- DONE：`.gitignore` 从仅忽略 `.local/electron/` 扩为根 `/.local/`；现有本地文件未移动或删除。
- PASS：最终strict与负向类型；19个相关注册入口最后结果合计208 PASS、0 FAIL、0 SKIP；文档工具19项PASS；制品及文档链接检查。
- PASS：真实HTTP/PG权限、HEAD/Range、完整性和原H5读取；正式PC浏览器、2CPU/4GiB对照及额外原生语音播放检查。
- PASS：全部合成测试库已回收，自有PG停止，原PID2444退出、pg_ctl status=3、监听0；性能Job结束时活动进程0且无强制回收。
- BLOCKED_BY_POLICY：删除本次自有PG数据目录被自动审批拦截。已核验归属、无重解析点、仅初始postgres库及零其他客户端；停止后改用固定字面路径删除仍返回`blocked by policy`。未绕过，目录`D:/wecom-workbench-runtime/pc-media-employee-read-20261028-pg`保留。
- NOT_RUN：云端部署、真实业务迁移、现场用户验收、full/certify及Gate。

未发布或修改GitHub Issue/PR；本次直接用户任务的交付清单记录本地实施事实，不改变现有Issue状态。

## 候选与验证身份

最终候选为上述HEAD上的未提交工作区，input hash为`ed13e669f5433fd267cd2bb847c1dd1d6bd2e793fcbb9533c31363777e39ad7f`，manifest SHA-256为`91a08e45cb3758b4a7eba2d7d3d45ee564a7ddeed52c9cb0cf521bc579a5d0c6`；908项编译Node语法检查通过，制品2712项。没有提交、推送或部署。

208项是逐入口最后结果的合计，不是一次全仓回归。实际命令、候选、TAP、逐case与未运行项见证据目录的`verification-summary.json`。性能候选manifest为`64b4ce1f7d826d7e7afaf5e6e495e4e74902f7920f62b3d5c38564976bb00bc7`；最终版本仅两个测试及各自source map变化，全部业务源码产物、配置及前端资源哈希相同，证明见`product-identity-final.json`。不将测试修订宣称为重新执行过性能对照。

## 2CPU／4GiB本地对照

同一产品制品、相同六张1MiB合成图片与一段4秒视频，各模式1次预热＋10次正式测量。旧入口与员工入口分别通过真实PG、HTTP和正式浏览器运行；统计首张预览、七个预览全部显示及点击到视频首帧。

| 指标 | 旧路径 | 员工读取路径 |
| --- | ---: | ---: |
| 首张预览 p50 / p95 | 1778 / 2137 ms | 1044 / 1503 ms |
| 全部预览 p50 / p95 | 5927 / 7140 ms | 1176 / 1597 ms |
| 视频首帧 p50 / p95 | 398 / 639 ms | 273 / 368 ms |
| 七个预览传输字节（首个正式样本） | 6,447,010 | 70,436 |
| 七个预览实际SQL（包含本次认证） | 812 | 21 |

新Web媒体本身每HTTP一次记录查询；新正文输出后SQL为0。1/10/20MiB文件验证查询数不随分块增加。新预览仅请求THUMBNAIL，每张≤160KiB；视频点击才发PLAYABLE，浏览器实际使用Range。独立语音检查同样证明列表零预取、点击后同源206播放、preload=none及离开释放。

Windows Job共享2个逻辑CPU、hard cap及4GiB提交内存，包含PG、应用、测试负载和浏览器后代。peak job commit为1,206,546,432 B，观测驻留内存合计峰值2,010,595,328 B；全部采样进程与affinity符合限制，无强制回收，结束活动进程0。详细数据与截图为`comparison-01.json`、`performance-source-data.json`、`resource-01/resource-budget.json`及`employee-read.png`。这是本地Windows合成测量，不是云主机网络、生产容量或用户验收结论。

## 本轮发现与修复

| 问题 | 处理 | 最后状态 |
| --- | --- | --- |
| 起始制品与源码输入漂移 | 保存失败后重建基准，未当作本轮产品缺陷 | PASS |
| 新视频JPEG封面仍按VIDEO容器校验 | 内容按IMAGE验证，资产身份/AAD仍绑定原VIDEO | PASS |
| 合成配置测试缺少隔离环境声明 | 使用既有isolatedBoundaries，未放宽生产配置 | PASS |
| 测试返回共享JPEG缓冲，Worker按约清零后断言错误 | 测试交付独立Buffer，保留原期望字节 | PASS |
| 旧附件浏览器测试等待已移除的常驻文案 | 按当前已提交的图标与真实hover Tooltip核验，仍要求零Store读取 | PASS |
| 独立音频探针首次两次浏览器启动超时 | 改沿运行器的环境白名单后实际原生播放通过；原失败和零残留记录保留 | PASS |
| PG目录删除自动审批拒绝 | 实例先停止并独立核实PID/端口；停止删除，保留目录与收据 | BLOCKED_BY_POLICY |

## 启用与回退

默认`workbenchMediaEmployeeReadEnabled=false`。将来部署时先核验并执行070前向迁移，再显式开启该单一JSON设置并重新加载PC；APP/WORKER依赖检查和实际界面验收须分别完成。本轮没有运行现场迁移或修改云端配置。

关闭开关恢复旧下载和预览路径，停止新增视频封面；070与已生成派生文件保留，继续既有到期清理。Range仍会先读取并认证完整加密对象，本轮没有明文缓存或分块加密迁移。

## 后续 Git 交付授权

2026-10-28 用户追加授权：提交并推送、创建PR并请求`@codex review`，修复P1/P2后继续推送复审，全部问题解决且适用CI通过后以精确head合并，再清理自有分支/工作树。当前分支继承三个已推送、未合入main的Electron、启动及头像/压缩提交，PR覆盖完整分支；各阶段原始验证身份保持。上述“未提交/未发布”描述绑定本地交付阶段，不作为后继Git操作状态。Git收据另存证据目录的`git-delivery/`，不自动授予部署、真实业务迁移或Gate权限。
