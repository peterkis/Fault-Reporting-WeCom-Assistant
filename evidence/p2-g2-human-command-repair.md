# 人工命令金标核对

本地合成入站建立真实 Ticket/Session，再用三个受控坐席Cookie执行真实HTTP。首轮 `tmp/p2-g2-tests-45913906-57fe-4e8c-b575-cace5afa669f/result.tap`，SHA256 `7108ef5f25bd677fd373e473e9d1d699dd36c88b124676928c175d5863a5e290`，5/8、exit1。

两项404是测试前置错误：把没有该会话协作/接管权限的另一 HANDLER 当成“已授权协作者”。修正合成角色为 HANDLER Owner + DISPATCHER 协作者，沿用现有权限；不放宽生产授权。

后续核对确认 DISPATCHER 也不能替他人写备注；既有授权协作者在此为 ADMIN。负向保留 Dispatcher 404，正向用 ADMIN 内部协作且Owner不变。Handoff 源未声明初始Owner，测试从正常入站的未分配Session开始，由ADMIN请求、Handler接受、ADMIN释放，符合原A/B/A角色顺序。原已分配Owner上直接接管被拒绝是正确保护，不为它放宽权限。第二轮6/8失败同样保留于 `tmp/p2-g2-tests-4d49486b-2d12-49e8-95c9-36f3ff3a30bd`。

X027/D12-039 是实际命令缺口：ADMIN force transfer 未提供原因也被通用 WORKBENCH_TRANSFER 默认值放行。持续授权下仅对 force TRANSFER 要求显式原因，缺失时400；其余既有默认原因行为不变。变更放在命令Facade，HTTP和内部调用均受约束，无迁移及新状态。

扩展检查发现显式null也走了旧默认值；新增RED `tmp/p2-g2-tests-824df371-a3ef-45b7-b27e-23a9571efdf8`（49/50、exit1），随后将强制转派的原因限定为显式字符串，并同步其OpenAPI请求体条件。空字符串由原格式校验拒绝。普通转派仍沿用已有默认行为。
