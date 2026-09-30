# T04-04 HTTP Action 端口复审修补

复审对象为 PR #36 发布提交 `354eaa3ac6b083e9a8917afd1db23dceae17340a`，基线 `c621845f66eb6d43cb69f00094fb18f2b19baefa`。独立复审指出 1 项 P2：HTTP 注入端口使用方法签名，允许仅接受已验证窄输入的实现接入。该发现是静态类型边界缺口；不据此声称生产鉴权绕过、事务错误或数据损坏。

## 定位与修补

在实际 `tsconfig.type-tests.json` 和锁定 TypeScript 5.9.3 中，数字版本实现的端口赋值负例产生 TS2578（预期错误未发生）。只在编译器内存中把端口改为函数属性，原负例即被拒绝，既有窄 `TicketActionService.perform` 接线也产生 TS2322；strict 配置和上下文 unknown 未失效。

`PilotHttpActionPort.perform` 改为函数属性。真实 Action service 新增 `performRaw(input: unknown)`，与内部强类型 `perform` 共用同一函数；事务中的原 `validateActionInput`、SQL、授权、事件、afterAction、回滚和错误映射顺序保持。HTTP 实际接线使用 `{ perform: actions.performRaw }`。未增加 any、窄输入断言或声明桥。

公开类型负例覆盖仅接收数字 expectedVersion、字符串 note、合法 TicketAction 的实现，分别验证端口赋值和 HTTP 工厂拒绝；强类型领域入口仍拒绝字符串版本和非法动作。真实 raw 入口正例及原上下文 unknown 负例保留。

真实 loopback HTTP／隔离 PG18 回归检查畸形字段、未知动作、跨团队拒绝、认证主体覆盖、afterAction 失败后的原子回滚和后续成功命令。结果通过公共 Action／HTTP／Access 视图观察，不以 stub 失败替代校验链。新测试最初把权限失败预期写为 409；按发布对象已有映射纠正为 403，生产状态码不改。误改未知动作预期的第二次失败也保留，最终仍验证原 409／INVALID_STATE_TRANSITION。

既有 ARCH-006 CI 对照必须识别本修补新增的唯一生产支持路径 `src/p1-006-ticket-state-actions.mts`。新增精确十路径变体及 RED→GREEN 对照测试，原九路径变体、完整诊断和非零退出继续保留；额外 Runtime、SQL、Evidence 路径及额外诊断仍拒绝。不将该对照通过计作 readiness 通过。

## 验证与交付记录

严格类型、负向 canary 和定向真实 Action／HTTP 测试正在验证；干净修补提交的批次、双轴审查和发布 head CI 将单独记录。原 [T04-04 回执](../receipts/T04-04.json) 的 tested_head、首次失败及历史执行记录保持。

独立修补日志目录：`C:/Users/zqpet/.codex/artifacts/wecom-t04-04-review-fix-20260930`。复审原 ZIP 未在本机找到，依据用户完整粘贴报告和实际发布对象复现；未声称已核验该 ZIP。

无数据库迁移、依赖或 Feature Flag 改动。资源上限、安全、隐私和真实现场停止线保持；本次不启用 Provider、不发送真实消息、不部署、不合并、不启动 T04-05。关闭方式为保持现有停止态；需要撤销代码时对修补提交单独 revert，不回滚业务数据。
