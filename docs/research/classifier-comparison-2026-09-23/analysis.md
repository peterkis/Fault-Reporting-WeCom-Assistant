# 故障分类方案比较与实测建议

日期：2026-09-23。对象：本项目当前本地代码、`C:\Users\zqpet\Downloads\outpatient-intake-classifier` 的原始代码及模型、TypeSafe `jev-1.13.0`。

**建议：保留现有确定性受理与人工处理主线；优先修复规则的语义边界。若允许脱敏后的报修文本调用外部 API，Jev 比当前这版 BGE 分类器更值得作为语义分类候选继续验证。若必须完全本地运行，优先吸收旧分类器的有效规则，再用人工确认的数据改进 BGE。三者都不应独立决定是否受理明确报修，也不能凭分类结果直接改变工单状态。**

这不是基于模型热度的建议：本次实际执行了 132 条合成样本的三方比较，并把旧分类器拆成“仅其规则”“规则 + TF-IDF”“规则 + BGE”做消融。Jev 经用户授权调用现有凭证，132 次全部成功。测试没有发送真实聊天、患者或员工数据，没有改变业务源码、数据库、功能开关、部署状态或历史证据，也没有提交或推送。

## 1. 现在的模块到底做什么

本项目并非只有一个“关键词分类器”，而是两个相邻层次：

| 层次 | 当前实现 | 责任 |
|---|---|---|
| 描述解释 | `p2-007-rule-engine`、alias resolver、fault taxonomy | 提取服务、现象、意图、范围、影响、未知字段、澄清问题与来源证据 |
| 业务路由 | `p2-015-decision-router` 和两种 orchestrator | 决定最小工单、补充描述、人工审核、查询、咨询、确认等可执行路径 |

当前默认目录有 **55 个服务代码、291 条服务别名、154 条现象别名、90 条规则**。其分类目标比旧分类器的“打印机/HIS/PACS”等主题类别更细，例如“检验申请开立”和“检验结果查看”是不同服务。规则生成的服务建议也不等于医院已经授权的职责分工。

网页入口会把本次 SUBMIT 的 description 与该 Intake 的后续 SUPPLEMENT 文本按顺序合并，在新的 `input_revision` 上重新判断；群聊入口从同一 Intake 读取有界消息窗口。两者都不是只判最后一句“还是不行”。网页编排记录版本、来源哈希与决策，并在应用完成时检查输入版本。[网页消息聚合](D:/Projects/Fault-Reporting-WeCom-Assistant/src/yxx-self-service-orchestrator.mjs:43)、[网页重判](D:/Projects/Fault-Reporting-WeCom-Assistant/src/yxx-self-service-orchestrator.mjs:318)、[会话窗口](D:/Projects/Fault-Reporting-WeCom-Assistant/src/p2-015-rule-first-orchestrator.mjs:60)

一个关键区别是：**服务类别不明，不等于不能受理故障。** 当前 router 只要已经有明确故障意图或现象，就可以推荐最小工单；缺少地点或类别不必阻塞。`NEEDS_DESCRIPTION` 是规则未取得足够故障信息的一条路径，不是通用的模型低置信度标签。[路由顺序](D:/Projects/Fault-Reporting-WeCom-Assistant/src/p2-015-decision-router.mjs:57)

因此旧分类器与 Jev 可以增强“理解描述、提供分类候选”，却不能直接替换事务、版本校验、幂等、人工审核、权限和动作执行。这个界限也符合 [ADR-0017](D:/Projects/Fault-Reporting-WeCom-Assistant/adr/0017_ai_optional_rule_first_service_loop.md:17)。

## 2. 旧“小模型分类器”的真实组成与历史指标

它本身也是规则与模型的组合：

- 主题规则优先选择，规则强度至少 0.93 且无冲突；
- 可选字符 TF-IDF 2–4 gram + 逻辑回归；
- 或冻结的 BGE-small-zh-v1.5 INT8 ONNX 编码器 + 逻辑回归；
- 模型候选要求概率至少 0.72、前两名差至少 0.08；
- `predict_snapshot` 返回 revision 与消息 ID，但真正防止旧结果覆盖新结果仍由调用者实现。

训练记录为 762 条、23 个训练类别。旧报告的 BGE 88.2%、TF-IDF 86.0% 是分类头的诊断成绩，并不是规则混合服务的正式准确率。[旧报告](C:/Users/zqpet/Downloads/outpatient-intake-classifier/outputs/verification_report.md)、[分类服务](C:/Users/zqpet/Downloads/outpatient-intake-classifier/src/outpatient_classifier/service.py:63)

本次只输出聚合信息的复核发现：186 条旧测试记录中，179 条是规则产生的聊天弱标签，只有 7 条来自知识库；训练与测试的 group ID 没有交集，但有 **7 种完全相同的文本，涉及 10 条测试记录**，也出现在训练集。重复不自动说明人工造假，业务中也确有重复报修，但会削弱这些指标对新表达的证明力。23 个训练类别中只有 20 类出现在测试集；若干类别只有 1–3 条训练记录。[聚合审计](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/historical-split-audit.json)

两套方案也并非来自完全独立的知识来源：项目目录和旧分类器都引用同一批 7311 条门诊聊天。用旧规则产生标签，再验证模型是否复现这些标签，主要证明规则近似能力，不能直接证明对规则盲区的提升。

还有一处词表问题：虽然接口强调主题、请求性质、现象分开，旧 `topic_category` 仍包含 `service_request`、`information_consultation`，训练头也包含这些标签。接入时应统一这几个维度，不能把“咨询”和“打印机”继续放在同一组互斥业务对象中。[旧词表](C:/Users/zqpet/Downloads/outpatient-intake-classifier/src/outpatient_classifier/taxonomy.py:18)

## 3. 本次测试的口径

在任何一方对本次样本预测之前，生成并冻结了 132 条合成数据；没有使用这些数据训练模型、修改规则或调参。Jev 的固定提示在查看现有规则结果之后编写，但没有根据 Jev 的测试结果调整；它显式获得了类别定义，因此该试验比较的是现有部署方式与一次提示配置后的能力，不是相同训练条件下的模型竞赛。

| 分组 | 数量 | 用途 |
|---|---:|---|
| 直接名称与常见表达 | 36 | 常见对象和明确故障 |
| 口语表达 | 36 | 同义、间接描述、非标准用词 |
| 对象证据不足 | 12 | 模糊指代、图片、只有否定的信息 |
| 多个独立问题 | 12 | 单主题接口应保留歧义而不是任意选一个 |
| 补充与纠正 | 12 | 同一 Intake 聚合后的最终判断，其中 6 条明确纠正旧对象 |
| 目录覆盖扩展 | 12 | 耗材、PDA、OA、自助、签名、后勤等，不混入共同类别主指标 |
| 请求性质与安全控制 | 12 | 假设、否定、恢复、咨询、状态、数据错配和输入指令 |

主要比较 **84 条共同类别且对象明确的样本**：36 + 36 + 12，映射到 HIS、EMR、PACS、LIS、医保、叫号、打印机、终端、网络九个粗类。HIS 合并门诊/住院/一体化工作站。这会丢失项目 55 个服务代码的细粒度，因此成绩不能当作 55 类自动路由验收。无法唯一输出类别计为未覆盖，错误输出单独计数。

24 条证据不足/多问题样本单独比较拒识。多问题的 UNKNOWN 仅表示“没有唯一主类”，不代表系统应忽略它们，更不代表不建立 Intake。12 条请求性质控制只用于分析动作边界，其 topic 标签不用于总体分类排名。

本地测试调用未修改的真实纯函数/分类服务，不执行数据库或动作。Jev 每次传最终消息快照，一次独立问 topic、request_nature、needs_review；没有把标准答案、测试分组或期望路由传给模型。Jev 显式有 UNKNOWN；另报告事先固定的概率 ≥ 0.72、margin ≥ 0.08 的诊断门槛，两种结果在本次各组恰好相同。这不是中文场景的概率校准，也没有把 Choice.confidence 当正确概率。

这是一组由助手编写标签的小型定向压力样本，没有独立人工复核，不能估计真实业务频率、总体误判率或证明生产 100% 准确。没有测试真实医院网络、多人并发、持续可用性或端到端页面受理。[冻结数据与说明](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/dataset-manifest.json)

## 4. 分类结果：旧分类器的优势主要来自规则，Jev 的语义增益最明显

| 方案 | 84 条共同样本正确输出 | 错误输出 | 拒绝/未输出 | 已输出中的正确率 |
|---|---:|---:|---:|---:|
| 项目现有规则 + router | 52 / 84，61.9% | 4 | 28 | 52 / 56，92.9% |
| 旧分类器仅规则 | 68 / 84，81.0% | 0 | 16 | 68 / 68，100% |
| 旧规则 + TF-IDF | 68 / 84，81.0% | 0 | 16 | 68 / 68，100% |
| 旧规则 + BGE | 68 / 84，81.0% | 0 | 16 | 68 / 68，100% |
| Jev 1.13.0，固定三问题配置 | 84 / 84，100% | 0 | 0 | 84 / 84，100% |

这些百分比只适用于上表指定的合成样本，不是实际运行准确率。“未输出”与“误分类”的代价不同，不能只用一列 accuracy 排名。

| 具体能力 | 当前规则 | 旧规则 / TF-IDF 混合 | 旧 BGE 混合 | Jev |
|---|---:|---:|---:|---:|
| 直接表达正确，36 条 | 27 | 33 | 33 | 36 |
| 口语表达正确，36 条 | 13 | 25 | 25 | 36 |
| 补充后最终类别正确，12 条 | 12 | 10 | 10 | 12 |
| 证据不足时保持未知，12 条 | 12 | 11 | 10 | 12 |
| 多问题时不强选单类，12 条 | 1 | 9 | 9 | 11 |

旧 BGE 的裸分类头在 84 条上的 top-1 是 **71/84，84.5%**，TF-IDF 是 **64/84，76.2%**。但这些正确预测很多与规则重复，达不到阈值或被冲突规则拦住，最终没有增加一条共同类别正确覆盖。这正是应测“模型在规则未解决样本上的净增益”，而不是单看裸模型 accuracy 的原因。

在全部 132 条中，TF-IDF 没有接管最终类别；BGE 只接管了 S083：**“不是打印机的问题” → 打印机，概率 0.915**，而标准答案为未知。BGE 混合方案比仅旧规则多了一次错误。因此不能依据旧的 88.2% 指标，把这个现成模型直接接成高置信自动分类器。

Jev 的主要例外是 S091：**“检验报告没有结果，医保也审核不了” → LIS，概率 0.84**，丢掉了独立医保问题；其另一问题同时给出 `needs_review=0.61`。说明分开提问有实际价值，也说明结构化输出与高概率都不能代替业务防护。若示例性地按复核分数 ≥ 0.5 转人工，这次错误会被拦住，但 84 条明确类别里也有 3 条被转人工；该门槛仍需要独立开发集校准。

额外 12 条目录扩展样本，当前规则 2 条正确输出、旧混合 9 条、Jev 12 条。这反映词表覆盖不同，不应理解为当前规则在全部服务领域都只会 2/12。

## 5. 代码与样本揭示的具体问题

**现有规则最需要改进的是语义边界。**

1. 别名选择主要保留最长匹配，不是分析句子中的主对象与故障关系。“网络连接断开，电脑显示红叉”会选终端；“打印机卡纸，同时门诊系统也打不开”会选 HIS。291 条别名并不自动提供多对象理解。[选择实现](D:/Projects/Fault-Reporting-WeCom-Assistant/src/p2-007-alias-resolver.mjs:130)
2. 虽然存在 `currentAssertionText` 处理否定、假设和恢复，但原有 taxonomy 仍读整个原始文本，之后 `hasFault` 在 router 中优先于咨询/确认。实测“如果PACS打不开应该联系谁”“打印机没有卡纸，现在可以正常打印”“门诊系统没有卡顿，只是咨询怎么操作”“昨天打印机卡纸，今天已经正常了”均仍进入 TICKET_ELIGIBLE。[取词路径](D:/Projects/Fault-Reporting-WeCom-Assistant/src/p2-007-rule-engine.mjs:248)、[路由优先级](D:/Projects/Fault-Reporting-WeCom-Assistant/src/p2-015-decision-router.mjs:61)
3. 36 条口语故障中，28 条走 NEEDS_DESCRIPTION、7 条 TICKET_ELIGIBLE、1 条 BUSINESS_CONSULTATION。这里证明的是本地分类路径偏差；本次未运行持久化链路，不能据此声称已发生线上漏单。现象解释不足也不是换一个“主题标签器”就全部解决的。
4. 当前 0.9/0.65 等 confidence 是固定规则值，不是从医院人工金标准校准得到的概率，不能与 BGE/Jev 的 0.9 直接比较。[固定分数](D:/Projects/Fault-Reporting-WeCom-Assistant/src/p2-007-rule-engine.mjs:395)

**旧分类器适合复用思路，但需要修正后接入。**

1. `predict()` 在决定规则命中之前就调用模型；因此部署 BGE 后，简单规则命中也有推理开销。本次计数探针已复现。可以先完成排除/冲突与高精度规则，真正未解决时再推理。[调用顺序](C:/Users/zqpet/Downloads/outpatient-intake-classifier/src/outpatient_classifier/service.py:69)
2. “PACS影像浏览器”会同时命中影像和办公浏览器规则；中文紧邻的 `LIS` 又受 Python `\b` 边界影响，可能漏掉一个独立对象。S098 补充明确 PACS 后仍 unknown，S086/S094 的 LIS 第二问题被丢掉。需要按对象关系解决冲突，不能仅比较关键词分数。
3. 否定不能只保护规则而让模型绕过。S083 的高置信错分已经说明这一点；“不是网络的问题，也没说是哪套软件”还被旧规则直接接受为网络。
4. 快照虽然保留前两条和最近几条、最多 1800 字符，但编码器只取前 **256 token**。独立长文本探针含 730 token，末尾 PACS 纠正存在于 snapshot，却完全不在送入 BGE 的前缀里；裸模型仍判 HIS，最终服务 unknown。字符窗口保留了最新补充，并不等于模型实际看到了最新补充。[快照](C:/Users/zqpet/Downloads/outpatient-intake-classifier/src/outpatient_classifier/service.py:113)、[截断](C:/Users/zqpet/Downloads/outpatient-intake-classifier/src/outpatient_classifier/models.py:96)
5. 当前 mean pooling + L2 与 BGE 官方 CLS + L2 默认配置不同；256 token 也短于官方 512。不能直接切换推理方式来“修复”，应重算训练向量、重训分类头后做消融，保持训练与推理一致。[BAAI 官方模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5)

## 6. 延迟、资源与 Jev 产品条件

本地硬件是 i7-1260P、16 个逻辑 CPU、约 15.7 GiB 内存；不是部署目标 2C4G。各本地方案使用独立进程、一次完整预热、132 条 × 5 遍顺序测量。BGE 使用原代码的 ONNX intra-op 2 / inter-op 1，BLAS 线程限制为 1。

| 方案 | 本次 P50 | 本次 P95 | 本地进程峰值 RSS |
|---|---:|---:|---:|
| 当前规则 + 来源证据/hash + router | 0.553 ms | 1.166 ms | 77.0 MiB |
| 旧分类器仅规则 | 0.052 ms | 0.073 ms | 117.2 MiB |
| 旧规则 + TF-IDF | 2.217 ms | 4.394 ms | 130.7 MiB |
| 旧规则 + BGE | 2.858 ms | 4.488 ms | 197.8 MiB |
| Jev，一请求三个问题 | 684 ms | 1,139 ms | 托管推理，服务端资源未公开/未测 |

本地时间包含分类函数自身工作，排除 DB、IPC、队列、UI。Jev 是当前 Windows 网络的 HTTP 墙钟时间，包含网络与三个问题，使用顺序请求和连接复用；132 次中也包含两个进程的首次连接。因此这张表比较的是实际选型时可能承担的计算/调用成本，不能作为跨硬件算力排行榜。当前规则还做额外 Provenance/hash/router，旧规则没有，不能由 0.55 vs 0.05 ms 推断哪份代码写得更好。

Jev P99 约 2,007 ms，最大 2,680 ms，132/132 HTTP/解析成功；这不能外推为长时间 SLA。输入用量合计 **226,192 tokens**，按本次查到的直连价 $0.042 / 百万输入 token、输出免费，估算 **$0.00950**；这是价格算术，不是账户实扣账单。[TypeSafe 发布价格](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

Jev 的低延迟优势主要是相对需要生成文字的通用模型。对本场景，它明显慢于本地规则和 BGE，但亚秒到一两秒的异步分类可能仍可接受。真正应比较的是减少错误补充、人工查证和错分类带来的收益，不能拿“热门低延迟”作为替换依据。

当前 Jev 是托管文本决策 API，已核实版本 1.13.0；未找到可下载权重与可验证的本地部署规格，也不支持客户 fine-tune/LoRA。它的中文专项表现需要自测，官方明确英语最强、CJK 表现不均；本次中文合成结果提供了积极证据，但不能推翻这个适用范围限制。[官方模型页](https://docs.typesafe.ai/models)

其结构化接口不会自由生成工单动作，却仍可能选错合法类别，S091 就是本地实测例子。公开限制也包括否定、间接推理、长噪声上下文和输入注入等；本次单条指令测试正常不能证明抗注入能力已经通过。[官方限制页](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

原始医院聊天接入外部服务前应核实实际账户的数据处理范围与保留设置；“不用于训练”不能自动推导为“请求立即删除”。本次只传合成样本，不能当作真实数据出域授权。另不建议直接用 Jev 批量标签蒸馏本地替代模型，其当前客户协议对模仿/蒸馏用途有限制。人工独立确认标签应保留清楚的来源。[官方 Legal](https://docs.typesafe.ai/legal)、[客户协议](https://typesafe.ai/legal/mca)

## 7. 对本项目的具体建议

**第一步：改善现有规则，收益最确定。** 将否定、假设、恢复与当前断言的解释统一用于所有现象抽取；保留多个独立故障的候选；解决“计算机连不上网”中对象与现象的关系。优先移植旧分类器中经过回归验证的别名/分类知识，不整套替换受理编排。这些改进即使未来关闭所有模型，也仍有价值。

**第二步：有外部 API 条件时，优先验证 Jev 作为语义候选。** 这次实测中它对口语和纠正的收益远大于现有 BGE 版本。建议采用下列责任分配：

```text
原始消息持久化 → 同一 Intake 的有效证据与版本
                 ├→ 确定性受理/安全规则 → 最小工单或人工/补充路径
                 └→ 可选语义分类 → 候选类别/性质/复核信号
                                      ↓
                          Schema、目录、版本与权限校验
                                      ↓
                             工作台候选与人工确认
```

模型不在持久化和明确报修受理的前置条件上；返回慢、失败、分类不明时，原规则和人工路径继续工作。也不要只在完全 unknown 时调用：现有规则存在“高分但对象选错”，需要把多对象、否定、纠正、恢复等歧义场景纳入模型候选范围，且保留双方分歧供人工判断。

候选契约可包含 `input_revision`、evidence message IDs、model/version、taxonomy version、候选代码及各自分数、request nature、复核原因。revision 与来源 ID 必须由本项目代码绑定，不能让模型自报为可信版本；新补充或人工接管到来后，旧结果失效。请求范围只给当前 Intake 的相关用户消息，不能把整段群聊拼给模型。55 类服务代码需要单独对齐和测试，不能从本次九粗类/二十选项试验直接跳到正式细粒度派单。

**第三步：必须本地运行时，继续 BGE 路线，但先解决数据与拒识。** 现有 BGE 权重约 22.8 MiB，实测进程峰值约 198 MiB，值得在 2C4G 目标机上进一步验证；本次未测该主机与 App/PostgreSQL/Worker 共存的负载。先建立人工金标准，重点标注规则难例、未知、多问题和补充纠正；按整次 Intake/会话/时间隔离，去掉训练/测试文本重复。再比较 TF-IDF、BGE mean/CLS 与 256/512 token，不凭更大模型名称决定方案。

**第四步：把下一轮指标改成业务真正关心的指标。** 分开记录明确故障进入受理路径的召回、假设/恢复被误当新故障的比例、类别错误率与覆盖率、多问题保留率、未知拒识率、补充后纠错率、模型失败后可处理性、旧结果被拒绝的版本保护，以及目标主机/网络的 P95/P99。阈值在独立开发集选择，测试集只验一次；建议先抽取数百条脱敏、人工复核的真实 Intake 快照并增加稀有高风险案例，规模按类别分布调整。

项目当前 AI Gate 与现场停止线仍然适用；本次用户授权的是研究和 API 测试，未启动 P2-008/P2-G3、未将模型接入运行链路、未授予自动回复或自动处置权限。建议应作为下一次明确业务范围的设计输入。

## 8. 可复核材料与重跑

| 材料 | 内容 |
|---|---|
| [comparison-summary.json](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/comparison-summary.json) | 统一分母、分组、拒识、错误、延迟与 Jev 用量 |
| [synthetic-cases.jsonl](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/synthetic-cases.jsonl) | 132 条合成样本、预先冻结标签及说明 |
| [rules-results.json](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/rules-results.json) | 当前纯规则与路由逐条结果及源码哈希 |
| [bge-results.json](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/bge-results.json) | BGE 混合/裸头结果、长补充截断探针与模型哈希 |
| [jev-results.json](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/jev-results.json) | Jev 逐条响应的允许字段、版本、概率、用量、耗时；不含密钥 |
| [jev-request-template.json](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/jev-request-template.json) | 固定模型、选项定义与三个问题 |
| [model-research.md](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/model-research.md) | 一手资料、产品限制、API 精确契约与来源链接 |
| [source-snapshot.json](D:/Projects/Fault-Reporting-WeCom-Assistant/docs/research/classifier-comparison-2026-09-23/source-snapshot.json) | 本地 Git SHA、源文件未变化核对与测试边界 |

在仓库根目录运行（PowerShell；`$benchPython` 指装有 requirements-benchmark.txt 的 Python 3.12 环境）：

```powershell
$benchPython = 'C:\Users\zqpet\AppData\Local\Temp\codex-classifier-compare-20260923\Scripts\python.exe'
$benchDir = 'D:\Projects\Fault-Reporting-WeCom-Assistant\docs\research\classifier-comparison-2026-09-23'
& $benchPython -B "$benchDir\build_cases.py"
node "$benchDir\run_rules.mjs"
& $benchPython -B "$benchDir\run_local.py" --mode old_rules
& $benchPython -B "$benchDir\run_local.py" --mode tfidf
& $benchPython -B "$benchDir\run_local.py" --mode bge
& $benchPython -B "$benchDir\summarize.py"
```

Jev 脚本为 `node --use-env-proxy "$benchDir\run_jev.mjs"`：仅从根目录 `.env.pilot` 读取指定 key；现有完成结果会直接复用，不重复计费。若需要一轮新的独立远程测量，应在新的研究目录保留新的结果，不覆盖此次原始响应。各本地结果保留环境版本与样本哈希；当前业务源码/模型哈希在测试后全部复核一致。原有与并行产生的用户工作区改动保持原样。
