# 28. P1-009 最小处理端与 Pilot 权限

- 状态：DONE（本机 PostgreSQL 集成验收；非医院 SSO/公网验收）
- 运行时接缝：`createPilotAccessService({ pool })` 与
  `createPilotWorkbenchServer({ access, actions, authenticate })`

## 身份边界

`pilot_ticket.pilot_principal`、角色和处理组成员关系只保存 Pilot 身份。
角色为 `REPORTER`、`HANDLER`、`DISPATCHER`、`ADMIN`；所有数据/API 入口的认证器必须
由运行环境注入，根页面仅返回不含 Ticket 数据的静态壳。医院 SSO、人员主数据、Hub 和
Hospital Tickets 均不在本任务范围。

申报人只能查看自己的 Ticket 和外部说明；处理组成员按所属处理组访问待办；
Dispatcher/Admin 可跨组。Action 授权在同一事务内查询 Pilot principal，避免仅靠前端
隐藏按钮；`auto-close` 即使请求到达路由也会直接拒绝，且核心 Action 服务只接受
`SYSTEM` actor。

## 最小工作台

工作台提供根页面、待办、Ticket 视图和命名 Action 路由。HTML 含移动端 viewport 与
最小可触控尺寸；它不是面向公网的产品部署，也不是医院统一门户。

执行 `npm run p1:009:migrate` 和 `npm run test:p1:009:integration`。测试验证越权、
内部备注隔离和本机 HTTP 契约，不验证真实用户、浏览器兼容矩阵或公网安全。
