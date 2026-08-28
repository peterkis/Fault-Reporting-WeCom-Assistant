# 03. 技术栈与版本策略

## 1. 选型原则

1. Phase 1 采用可独立运行的轻量 Pilot 技术体系，Phase 3 再评估复用医院现有能力；
2. 关键链路减少技术种类；
3. AI 服务与业务服务解耦；
4. 版本必须锁定；
5. 任何升级先在 Gate/测试环境验证；
6. 不因追求“先进”引入难以维护的基础设施。

## 2. 推荐技术栈

| 层级 | 推荐技术 | 用途 |
|---|---|---|
| 企业微信接入 | Node.js 24 + TypeScript | WebSocket Gateway |
| 官方 SDK | `@wecom/aibot-node-sdk` | 长连接、消息、卡片、媒体 |
| Web 框架 | Express 或现有 Node 服务框架 | 健康检查、内部 API |
| 前端 | Next.js 16 + React | 医生/工程师响应式 H5 |
| Phase 1 工单核心 | Pilot Ticket Core | 公网试点期工单事实源 |
| Phase 3 工单融合 | Ticket Adapter + Hospital Tickets | 切换后唯一长期工单事实源 |
| 数据库 | PostgreSQL 18 | 消息、Intake、事件、Outbox、审计 |
| 缓存 | Redis 7.2 | 短期聚合、限流、缓存、单活租约 |
| 对象存储 | MinIO | 私有截图和处理附件 |
| AI 服务 | Python 3.12 + FastAPI + Pydantic | OCR、分类、结构化输出 |
| OCR | PaddleOCR 候选 | 截图文字和错误代码 |
| 本地模型 | 2B—4B 级量化模型候选 | 模糊文本结构化抽取 |
| 推理适配 | 内部 Provider Adapter | Ollama/llama.cpp/vLLM 可替换 |
| 可观测性 | OpenTelemetry + Prometheus/Grafana 或院内现有平台 | 指标、链路、告警 |
| 部署 | Docker Compose、systemd 或 PM2 fork | 轻量部署 |

## 3. 官方 SDK 基线

规格包生成时参考官方仓库：

```text
https://github.com/WecomTeam/aibot-node-sdk
```

官方 README 描述的能力包括：

- WebSocket 长连接；
- 自动认证；
- 心跳和指数退避重连；
- text/image/mixed/voice/file/video；
- 模板卡片和事件；
- 主动推送；
- 临时素材三步分片上传、媒体回复与主动媒体投递；
- 文件下载和 AES 解密。

仓库 `package.json` 在本次读取时标识版本为 `1.0.6`。生产实现不应盲目使用 `latest`，应在 Gate 0 验证后锁定具体版本和包完整性。

### 3.1 G0-002 锁定记录

- G0-002 使用精确依赖 `@wecom/aibot-node-sdk@1.0.6`；
- `package-lock.json` 锁定 npm 完整性为 `sha512-WZJN3Q+s+94Qjc0VW8d5W1cVkA3emYxiqf+mNRO9UEHoF40puHvizreNMtudjFhm7mmkYiK5ue/QzNiCk+xwLA==`；
- 官方 SDK 的认证、心跳、重连和断开接口由最小 PoC 实测；完整记录见 `evidence/g0-002-sdk-authentication-report.md`；
- G0-002 已在本机 Windows 完成认证生命周期验证；SIGTERM 以同一 Node 处理器模拟验证，不使用 WSL。切换操作系统或进程管理方式时需重新验证。

## 4. SDK 隔离策略

目录建议：

```text
packages/wecom-adapter/
├── src/client.ts
├── src/events.ts
├── src/message-normalizer.ts
├── src/media-downloader.ts
├── src/card-builder.ts
├── src/error-mapper.ts
└── src/types.ts
```

业务代码只依赖内部接口：

```ts
interface WeComChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  send(target: WeComTarget, message: OutboundMessage): Promise<SendResult>;
  downloadMedia(input: EncryptedMediaRef): Promise<DownloadedMedia>;
}
```

出站媒体必须再通过内部端口隔离企业微信临时协议：

```ts
interface WeComTemporaryMediaPort {
  publish(asset: ValidatedOutboundMediaAsset): Promise<WeComMediaLease>;
  reply(callback: CallbackRef, lease: WeComMediaLease, options?: VideoOptions): Promise<SendResult>;
  send(delivery: AuthorizedDeliveryTarget, lease: WeComMediaLease, options?: VideoOptions): Promise<SendResult>;
}
```

`ValidatedOutboundMediaAsset` 是经过权限、格式、字节数和完整性校验的受控字节来源；`WeComMediaLease` 封装短期 `media_id` 与到期时间，不得作为领域附件 ID。完整约束见 `docs/18_wecom_temporary_media_constraints.md`。

## 5. Node.js 规范

- TypeScript `strict: true`；
- 使用 ESM 或项目现有模块规范，不能混乱；
- 统一配置解析和启动时校验；
- 异步处理必须捕获异常；
- 使用 `AbortSignal` 控制超时；
- 不在消息回调中执行长时间 OCR/LLM；
- 结构化日志；
- 健康检查区分 live/ready；
- 优雅退出，停止接收、等待事务完成、断开 WebSocket。

## 6. Python AI 服务规范

- Python 3.12；
- FastAPI；
- Pydantic 强 Schema；
- 推理和 OCR 使用独立 Worker 池；
- 限制请求大小和并发；
- 不接受任意文件路径；
- 不执行工具调用；
- 不直接访问 Pilot Ticket 或 Hospital Tickets 数据库；
- 只返回建议；
- 模型和 Prompt 版本必须进入响应和审计。

## 7. 数据库规范

Phase 1 数据库承载 Channel Message、Service Intake、Pilot Ticket、Ticket Event 和 Outbox。Phase 3 通过 Adapter/API 融合 Hospital Tickets，不允许直接写医院工单数据库。

- 所有外部消息 ID 建唯一索引；
- 状态变更使用事务；
- Outbox 与业务事件同事务；
- 时间统一 `timestamptz`；
- JSONB 仅存非核心扩展字段；
- 关键查询字段必须结构化；
- 原始消息可加密或隔离存储；
- 大文件不进数据库；
- 使用显式外键或可审计的逻辑引用；
- 生产迁移必须可回滚或具备前滚修复方案。

## 8. Redis 使用边界

允许：

- 90 秒上下文聚合；
- 发送限流；
- 单活租约；
- 非关键缓存；
- 短期去抖。

不允许：

- 作为唯一消息队列和事实源；
- 仅在 Redis 中保存尚未落库的报修；
- 用 Redis 状态替代 Ticket 状态；
- 因 Redis 丢数据造成漏单。

## 9. 不推荐的技术

第一阶段不引入：

- Kafka；
- RabbitMQ；
- Celery；
- Kubernetes；
- 独立 BPM 平台；
- 多 Agent 编排；
- 图数据库；
- 全量向量数据库。

达到明确业务规模和运维能力后再评估。

## 9.1 阶段依赖边界

- Phase 1 不配置 `HOSPITAL_TICKETS_*`、医院 SSO、医院 Hub 或院内 Outbox 运行依赖；
- Phase 2 的 AI/OCR 服务可独立关闭；
- Phase 3 才引入 Ticket Adapter 和 Hospital Tickets 连接配置；
- 任何共享数据库直写方案均不属于 V1.2 架构。

## 10. 版本与供应链策略

- 所有依赖使用 lockfile；
- 生产构建生成 SBOM；
- 镜像固定 digest；
- SDK 升级先通过 Gate 0 回归矩阵；
- OCR/模型升级必须在固定评估集上比较；
- 依赖漏洞分级处理；
- 不允许自动升级生产核心依赖；
- 所有模型文件记录来源、哈希、许可和版本。
