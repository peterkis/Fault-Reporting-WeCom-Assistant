# P2-G2 企业微信成员联系资料准备记录

状态：本地实现及定向验证完成，真实目录可用性未验证；不是 Gate PASSED、READY 或现场启动批准。

合同见 `p2-g2-member-contact-contract.md`。沿用既有 Directory 快照、内部 Ticket 可见性和 Reporter 隔离边界，无数据库迁移。已接入 Worker 配置、可选目录只读网络范围、内部工单联系端点及实际工单页面。缺少权限字段明确显示暂未获取；未配置/失败仍受理故障。

实际 RED：`tmp/p2-g2-tests-43e5fdfa-7dd0-4c15-9414-85fa0aa1259e/result.tap`，2/2 因端点 404 失败，SHA256 `691301675361484505d674f54046eae95d3f1d144b9f86b4f1caf407f573a9b1`。新增适配器最初还有模块不存在的 Unit RED。第一次组装 10 测试 9 通过、1 失败（`4a5da4cd-3275-4631-919b-89aca6641dc3`）；真实默认时间参数错误导致目录 DEFERRED，修正为 epoch 字符串后 10/10 通过（`35bf0994-37e5-4b99-91c4-5527b90a3a6e`）。

真实浏览器与 PostgreSQL：`tmp/p2-g2-tests-8806d722-eb93-4cbc-b9a2-e28f6a5aa025/result.tap`，2/2，通过正常群报修创建 Ticket、模拟企业微信响应取得快照、内部页面显示姓名/电话、未登录及停用账号拒绝读取、普通投影不泄漏、没有 Direct Leg 仍可取资料。SHA256 `6b7948174d0a7224ea4f591afc515a222e6352170ecc10703f4c2aaa8586a7dc`。Provider calls 为 0。

联合定向回归：`tmp/p2-g2-tests-a4fc5903-42bf-44bf-bdc5-9ff082835042/result.tap`，24/24，exit 0，SHA256 `4466b34d0c88c4363bc68bed8e2c981d21f578195f27c44f35b33c411e59ebf9`。覆盖资料、既有 Directory、CLI/接口/配置及三进程组装；该轮启动后另追加了只读网络配置测试，不能把 24 作为最终冻结候选全量结果。新增目录网络配置定向 Unit 为 5/5，纯模拟 HTTP，没有外网请求。

独立 Standards 中途只读审查未发现已确认新增问题，未代替最终冻结树审查。真实内部成员 ID、应用可见范围、mobile 权限及令牌有效性须在后续批准现场记录；不将模拟资料写成真实目录成功。
