# P1-002 WeCom SDK Adapter 与标准消息契约验收报告

- 任务：P1-002
- 日期：2026-08-28
- 状态：DONE（本地 Contract 验收）
- 验收边界：本机 Windows、Node.js 24、锁定 `@wecom/aibot-node-sdk@1.0.6` 的纯 Frame 转换与静态契约验证。
- 非验收范围：公网边界、真实 WSS 连接、SDK 认证/重连、Channel Message 持久化、数据库幂等、Service Intake、Pilot Ticket、通知、临床试点、Phase 1 Go/No-Go。

## 1. 授权与阶段边界

项目负责人于 2026-08-28 明确要求依据 P1-001 交接文档继续开发 P1-002。执行仅覆盖 WeCom SDK Adapter 与标准消息契约；没有启动 P1-003，没有创建数据库表，没有读取或写入 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox。

P1-001 的本机受控验收继续有效，但不被扩大解释为公网试点验收。

## 2. 输入依据

- `@wecom/aibot-node-sdk@1.0.6` 已安装包的 `WsFrame`、`BaseMessage`、text/image/mixed/voice/file/video 和 quote 类型声明；
- `evidence/g0-003-frame-captures.jsonl` 的文本、群聊、引用和重复发送脱敏字段形态；
- `evidence/g0-004-media-captures.jsonl` 的 image/mixed/file/voice/video 脱敏字段形态；
- ADR-0009 和 `evidence/g0-008-gate0-acceptance-report.md` 的 Phase 1 Adapter、媒体隐私、重放和单活冻结约束。

测试全部使用明显的合成标识和内容；没有读取、复制或写入真实用户消息、URL、AES Key、Bot Secret 或数据库凭据。

## 3. 交付物

- `src/p1-002-wecom-sdk-adapter.mjs`：单一 `adaptWeComSdkFrame` 接口、输入校验、消息归一化、opaque 媒体引用和稳定错误结果；
- `contracts/normalized_wecom_message.schema.json`：Draft 2020-12 机器可读契约；
- `tests/p1-002-wecom-sdk-adapter.test.mjs`：公共 Adapter seam 的 Contract Test；
- `docs/21_p1_wecom_sdk_adapter.md`：字段语义、支持范围、重复/媒体/隐私边界和后续任务分工；
- `package.json`：`npm run test:p1:002` 定向测试入口。

## 4. Contract Test 结果

| 场景 | 结果 | 关键结论 |
| --- | --- | --- |
| 文本 Frame | PASS | 原文保留；`clean` 确定性规范化；无 SDK 包络/回复 URL。 |
| 图片 Frame | PASS | 只暴露 opaque `download_ref`；URL/AES Key 不进入结果。 |
| mixed Frame | PASS | text/image 在同一消息内保持原顺序。 |
| 重复 Frame | PASS | 同 `msg_id` 得到同一幂等键；Adapter 不抢先丢弃。 |
| 非法 Frame | PASS | 返回稳定、不可重试、无敏感值的错误结果。 |
| 包络/身份/内容细分校验 | PASS | 缺失字段、非法会话、媒体、引用、时间和不支持类型均 fail closed。 |
| JSON Schema | PASS | 必填字段、支持类型、有序 content 和敏感字段禁入与实现一致。 |
| 引用文本 | PASS | 使用内部 `msg_type/content`，不透传 SDK `msgtype`。 |
| 文件/语音/视频 | PASS | 文件/视频为 opaque media；语音转写标记 `VOICE_TRANSCRIPT`。 |
| 引用媒体 | PASS | 正文与引用生成不同的 opaque ref；引用 URL/AES Key 不进入结果。 |

定向结果：

```text
npm run test:p1:002
tests 10 | pass 10 | fail 0
```

全量结果：

```text
node --test tests/*.test.mjs
tests 68 | pass 68 | fail 0
```

## 5. 契约与隐私检查

- `package.json`、Normalized Message Schema、当前阶段/Backlog/项目摘要/Manifest 均通过 JSON 解析；
- 对 P1-002 实现、测试、Schema 和说明执行定向敏感值扫描，结果 `PASS`；
- `git diff --check` 无内容错误，仅输出工作区既有的 LF/CRLF 转换警告；
- Normalized Message 和错误结果不包含媒体 URL、AES Key、`response_url`、SDK `cmd/headers/body` 或提供方原始错误文本；
- `req_id` 只作通道关联，持久化幂等键固定为 `WECOM_AIBOT:{msg_id}`；
- `create_time` 在提供方缺省时保持 `null`，不以 `received_at` 冒充提供方时间。

## 6. 验收结论与下一边界

P1-002 的本地 Contract 验收通过，满足“业务模块不依赖 SDK 原始类型”的任务验收条件。该结论只覆盖纯转换接口及其机器可读契约，不证明真实长连接或公网 Pilot 就绪。

在本报告形成时，P1-003 的依赖已满足但尚未获得单独启动授权。项目负责人随后于 2026-08-28 独立授权并完成 P1-003；数据库唯一约束、并发重复、进程重启、事务回滚、数据库暂时不可用和重复请求返回原结果的证据见 `evidence/p1-003-channel-message-inbox-report.md`，不得倒推为 P1-002 的纯转换验收结果。
