# 03. 技术栈与版本策略 V1.4

## 1. 选型原则

1. 保护现有 G0/P1 代码和已验证契约；
2. Unified Ticket Core 只保留一个物理事实源；
3. P2/P3 以模块化单体和 Port/Adapter 增量建设；
4. AI、OCR、SSE 和 Connector 都可关闭；
5. 2 核 4GB 下优先保证入站持久化、人工回复和可靠通知；
6. 不为不存在的历史数据引入迁移平台。

## 2. 推荐技术栈

| 层级 | 技术 | 用途 |
|---|---|---|
| 企业微信 | Node.js 24 + `@wecom/aibot-node-sdk@1.0.6` | 单活 WSS Gateway |
| 应用/API | 当前 Node.js ESM；增量目标 Node.js 24 + TypeScript strict + ESM（ADR-0026） | REST、SSE、Command、Projection |
| 数据库 | PostgreSQL | 消息、会话、Ticket、事件、Outbox、AI、Integration |
| 前端 | 轻量 React/Next.js 或现有静态工作台渐进升级 | 人工处理界面 |
| 模型 | DeepSeek Provider Adapter | 多轮建议与草稿 |
| 对象存储 | StoragePort | 私有媒体；可用加密本地盘或外部 S3 |
| 内网连接 | 独立轻量 Connector Agent | 主动出站 mTLS HTTPS/WSS |
| 部署 | PM2/systemd/Docker Compose 轻量组合 | 单机运行 |

## 3. 依赖基线

- Node.js：`>=24 <25`；
- `@wecom/aibot-node-sdk`：`1.0.6`；
- `pg`：`8.23.0`；
- 使用 lockfile；
- SDK 升级必须回归 Gate 0 能力矩阵。

## 4. PostgreSQL durable queue

当前规模优先复用 PostgreSQL：

- `FOR UPDATE SKIP LOCKED`；
- Lease；
- 重试和 Dead Letter；
- Inbox/Outbox 与业务事务一致；
- Redis 不作为唯一队列或事实源。

## 5. DeepSeek 边界

- 只接受脱敏文本；
- 默认 `thinking=disabled`；
- 默认并发 1；
- 严格 JSON Schema；
- 记录 Provider、Model、Prompt、Token、Latency；
- 不直接访问 Ticket 数据库；
- 不执行任意工具；
- 自动回复只允许白名单低风险场景。

## 6. 内网 Connector 边界

- 内网主动出站；
- mTLS + 请求签名；
- Source-scoped 凭据；
- 本地 Cursor/Spool；
- 不开放任意 SQL/Shell；
- 不共享数据库；
- 新来源按 Contract 接入；
- 不包含历史 Ticket 导入能力。

## 7. 数据库规范

- 所有外部 ID 有唯一约束；
- Ticket 状态变化使用事务；
- Outbox 与领域事件同事务；
- 时间统一 `timestamptz`；
- JSONB 仅用于扩展字段；
- 大文件不进数据库；
- 概念 Schema 不能直接执行；
- 实现任务获批后再创建编号迁移；
- 禁止复制第二套 Ticket 表。

## 8. 2C4G 不推荐同机组件

- Chatwoot；
- Dify；
- LangBot；
- Kafka/RabbitMQ；
- Elasticsearch；
- Kubernetes；
- 本地 LLM；
- 常驻重型 OCR；
- 完整 Prometheus/Grafana。

## 9. 供应链

- 依赖锁版本；
- 生产构建生成 SBOM；
- 镜像固定 digest；
- 模型和 Prompt 版本化；
- Connector 包签名；
- Secret 不进入仓库、日志或 Evidence。


## 10. TypeScript 增量迁移（T00 政策）

见 [ADR-0026](../adr/0026_typescript_strict_incremental_migration.md) 与 [执行入口](../plans/typescript-migration/README.md)。当前后端尚未建立根类型检查，本节是迁移约束，不是已实施声明。

- 生产 `.mts` 经 NodeNext 编译为 `.mjs`；相对运行时 import 保留 `.mjs`，前端原型保留独立 Bundler/JSX 配置。
- Node `>=24 <25`、SDK `1.0.6`、pg `8.23.0` 不捆绑升级；T01 再核实并锁定 TypeScript、@types/node 24 线和 @types/pg 8 线。本 PR 不改依赖或启动方式。
- 先建立源码/运行/冻结历史三种验证宿主，再迁移 173 个非 G0 模块和 8 个活动启动脚本；命名 legacy 清单保留，不追求全仓 100% TS。
- 新生产 JS 禁止，具体工具 bootstrap 例外须另行登记。allowJs 不代表旧 JS 已严格检查，手写声明也不代表实现已通过。
- types/build 在 T00 为 NOT_APPLICABLE_T00；必要基线未完成时状态为 BASELINE_INCOMPLETE。生产仅运行编译后的 JS，不在 2C4G 上增加常驻编译器。

本次仅修改语言政策；其他技术选型段落是既有内容。本文件既有时间表述与后来 ARCH-005 的差异不在 T00 改写范围内，迁移必须继续遵循实际平台时间契约和已接受的后续基线，不能借语言迁移变更 SQL/时间语义。
