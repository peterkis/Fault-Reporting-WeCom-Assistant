# ADR-0044：后端应用目录与迁移逻辑身份

- 状态：Accepted；依据用户 2026-10-23 确认的后端迁移计划。
- 本次限同一隔离工作树的本地实施及验收，不授权提交、推送、部署、真实发送、现场写库或业务 Gate。

PC、H5 已迁入 `app`。后端的业务和平台实现归入 `app/server/src`，根脚本整体归入 `app/server/scripts`；继续根依赖、根锁文件及统一构建。TypeScript 以仓库根为编译根，按原生目录结构生成 `app/server/...` 运行产物，避免源码归属与部署目录分叉。既有 legacy MJS 保留扩展名，本次不进行语言转换。

前后端共用的 `workbench-search-contracts`、`workbench-web-report-browser-contracts`、`workbench-incident-delivery-authority` 归入根 `shared`。八个 PC 浏览器合同归入 PC 的 `src/contracts`，实时客户端归入 `src/realtime`，均复用原实现和导出。公共声明、数据库迁移、测试、工具、配置样例及 Evidence 保持根归属。共享模块保持浏览器可加载，不引入 Node 运行依赖或独立 npm 包。

构建 manifest 与候选清单使用新物理路径。受检查的前向文件映射将迁移的物理路径对应到原 `src`／`scripts` 逻辑身份，继续遵守 T00 固定历史 legacy 政策、已迁移模块不得恢复 MJS、完整源码覆盖及重复逻辑模块拒绝。修改当前映射不能扩大历史豁免；固定历史 checkout 仍使用自身原路径和原 REF，不改写历史 tested_head、哈希或批准。

运行资源根与源码根明确区分。SQL、JSON、PC／H5 及兼容页面仍从已验证运行树的既定资源位置加载；缺失失败关闭，不探测旧源码。PC／H5 URL、资产位置、预算、业务 API、DTO、Schema、认证授权、默认开关及数据库合同不变。三份 PowerShell／Shell 脚本保持源码用途，私有配置仍位于原明确位置。

验收复用同一个最终 manifest，执行迁移前冻结的全部 741 个注册入口及独立迁移负向检查、编译、进程和浏览器交叉回归。只有全部验收及资源清理完成后才更新本地完成状态。回退按本轮逐项映射恢复对应原字节，保留 PC／H5／Reporter 的先前改动和全部证据，不重置工作树。
