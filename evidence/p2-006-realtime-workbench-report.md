# P2-006 Realtime Web Workbench 验收报告

## 1. 基线与授权

- 日期：2026-09-01
- 分支：`phase2/realtime-workbench`
- 冻结基线：`6afe8157bfcae49d391d0f6e2aa5c60388377ea5`
- 唯一授权任务：P2-006
- 授权 Evidence：`evidence/p2-006-start-authorization.md`
- 数据范围：随机隔离 PostgreSQL、合成 Principal、合成 Conversation/Event、Mock Sender、localhost 系统浏览器

未连接真实企业微信 Sender、真实医院身份、医院内网或模型；未正式装配 P1 入站 Projector 或 Communication Worker。P2-G1 未启动，全部 P2/P3 Feature Flag 为 false。

## 2. 交付物与数据库边界

交付包含 Workbench Bootstrap/List/Detail/Timeline/Eligible Principal/Delivery Contract，Pilot Authorization Adapter，Query Service，P2-004/P2-005 Command Facade，Delivery Control，Node 原生 HTTP/Static Handler，P2-003 SSE route，Native HTML/CSS/ES Module UI，Preview、自建 Edge CDP Harness 与三层测试。

没有 migration 022，没有 ALTER 或新表。Catalog Snapshot 在服务构造和 P2-006 执行前后逐项比较 schema、table、column、constraint、index、function、trigger、extension，结果完全相同；随机数据库和 backend 最终为 0。

## 3. REST Routes

- `GET /api/workbench/bootstrap`
- `GET /api/conversations`
- `GET /api/conversations/{sessionId}`
- `GET /api/conversations/{sessionId}/items`
- `GET /api/conversations/{sessionId}/eligible-principals`
- `GET /api/conversations/{sessionId}/deliveries`
- `POST /api/conversations/{sessionId}/takeover`
- `POST /api/conversations/{sessionId}/handoff/request`
- `POST /api/conversations/{sessionId}/handoff/cancel`
- `POST /api/conversations/{sessionId}/transfer`
- `POST /api/conversations/{sessionId}/release`
- `POST /api/conversations/{sessionId}/read-cursor`
- `POST /api/conversations/{sessionId}/messages`
- `POST /api/conversations/{sessionId}/internal-notes`
- `POST /api/deliveries/{deliveryId}/retry`
- `POST /api/deliveries/{deliveryId}/reconcile`
- `GET /api/realtime/events?scope=workbench`

## 4. 安全与权限

- authenticate 缺失时构造失败；未认证/过期为 401，停用、REPORTER 或非内部身份统一为 403。
- Cookie 写操作验证 exact Origin、Sec-Fetch-Site 与 timing-safe CSRF；Bearer 要求 Authorization Header；query token 拒绝。
- ADMIN 全量 + force/reconcile；DISPATCHER 全量 + 普通 transfer；HANDLER 仅 self assignment/同组 eligible；无 Ticket team 默认拒绝；REPORTER/跨组拒绝。
- 列表 SQL 在 LIMIT 前裁剪；安全 Principal 不含身份映射、角色表或团队关系。
- CSP 无 unsafe-inline/eval；无 wildcard CORS；API no-store；正文 32 KiB；公开错误不含 SQL、原始异常、正文或 Provider 细节。
- 恶意 HTML 以 textContent 呈现，真实 Edge 的 XSS 执行计数为 0。

## 5. Query、命令与投递结果

- 500 Session、每 Session 20 Item，共 10,000 Item；另有 500 Assignment、500 Ticket、500 Delivery 组合 Fixture。
- keyset 遍历 500 Session，第一页/中间页/末页合计 500，重复 0，不使用 OFFSET。
- Timeline before/after、普通 Internal 与 ADMIN Restricted 隔离通过。
- Takeover 幂等 replay、force transfer、release、handoff request/cancel、read cursor 通过。
- Human reply 产生 Message/Outbox/Delivery；Internal Note 产生 Message 且 Outbox/Delivery 增量为 0。
- PENDING retry no-op、DEAD_LETTER+NOT_ATTEMPTED requeue、UNKNOWN 阻止普通 retry、ADMIN reconciliation 均通过。
- 12 路相同浏览器提交只产生一组 Message/Outbox/Delivery；Sender 调用为 0。

## 6. 性能与 2C4G

本节是短时隔离容量测试，不是 24 小时 Soak。

| 路径 | 样本 | P50 | P95 | P99 | 最大 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Event COMMIT → SSE → Detail/Timeline Refetch | 100 | 9.460 ms | 17.501 ms | 23.076 ms | 57.222 ms |
| HTTP Reply → Message/Outbox/Delivery COMMIT → 202 | 200 | 15.353 ms | 17.480 ms | 21.818 ms | 36.233 ms |

列表与详情各 1,000 次；最终全仓容量运行 P95 分别为 38.614 ms 与 7.146 ms。Reply heap 分段样本为 8 个，最小 17,292,176 bytes、最大 25,859,864 bytes，增量小于 128 MiB。测试 Pool max=4；P2-003 回归维持 32 clients、100 event/client、105 replay query batches，并验证 heartbeat/recovery/socket/timer 全释放。P2-006 SSE 完成后 active clients/open streams/heartbeat timers/recovery timers 均为 0。

## 7. 浏览器验证

使用系统 Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，未下载浏览器运行时。

- Viewport：1440×900、390×844；2/2 tests passed。
- 页面、列表、filter、selection、Timeline、takeover、transfer、reply、internal note、SSE update、polling fallback、refresh restore 均通过。
- 键盘 focus-visible 通过；手机 horizontal overflow=false；安全头有效。
- XSS payload 未执行、未生成 payload image element；刷新存储只含 filter 和内部 selected session id。
- Browser child、Profile、HTTP socket、timer 与 Server 均清理。

## 8. 测试记录

- P2-006 Unit/Contract：17 tests，17 pass，0 fail，0 cancelled，0 skipped。
- P2-006 PostgreSQL/HTTP/SSE Integration：6 tests，6 pass，0 fail，0 cancelled，0 skipped。
- P2-006 Browser：2 tests，2 pass，0 fail，0 cancelled，0 skipped。
- P2-001 至 P2-005 unit/integration：逐项真实执行通过；P2-003 32-client SSE 回归通过。
- P1-009：2/2；P1-011：11/11；P1-012：46/46。
- P2-004 日期漂移修复：只把测试 Worker 合成时钟从已过去的 2026-09-01T00:00Z 推进到 2026-09-02/03；migration 020、运行时与既有 Evidence 未改，P2-004 integration 9/9 通过。
- Architecture Validator：317 checks passed；Architecture Tests：14/14 pass。
- 第一次全仓串行：404 tests，403 pass，1 fail，0 cancelled。唯一失败是全仓负载后 Edge desktop takeover 等待超过旧 harness 15 秒预算；相同 browser suite 独立连续三轮均 2/2，通过后把纯测试等待预算提高到 30 秒，未改变产品性能指标。
- 最终全仓串行：`node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs`；404 tests，404 pass，0 fail，0 cancelled，0 skipped，151,196.5668 ms。

## 9. 结论与停止线

P2-006 的 Internal Alpha、REST/SSE/权限闭环满足独立本地验收条件；Rollback 是保持三个 Conversation/Workbench/Realtime Feature Flag 为 false。该结论不是最终生产 UI、真实企业微信发送、生产 SSE、临床上线或 Phase 2 Go。

P2-G1 保持 `NOT_STARTED / REQUIRES_SEPARATE_AUTHORIZATION`；P2-007 及以后保持 TODO。AI、Media/OCR、Incident、P3、真实医院身份、真实内网均未启动；Unified Ticket Core 事实所有权未改变。完成 P2-006 后停止。
