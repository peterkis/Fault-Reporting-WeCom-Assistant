# 首批候选后继：T35 与 G2 收口

日期：2026-10-25（Asia/Shanghai）。按用户“继续”，接续[首批候选](first-gray-candidate-2026-10-25.md)，完成其中延期的 T35 注册测试前提修正与 G2 当前复现定位，更新本地候选。旧候选、58项台账、失败、未执行清单和原始证据保持原身份，不重绑旧 tested_head。

## 当前结论与范围

最终候选的两个原失败入口均已实际通过。G2 完整三进程/浏览器/模拟SDK用例连续3轮通过；T35/T29恢复6项通过。该结果允许继续准备小范围部署审查，不是实际部署、真实企业微信收件或业务 Gate 批准。原 human-v1 首批内部操作建议与默认关闭原则保持；真实外部接收/发送、目标人员/来源、配置、数据库和窗口仍沿独立具名批准。

当前仍在 codex/pc-admin-app-layout 未提交工作树，基线 HEAD 为 d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f。完整被测对象是该 HEAD 加当前未提交差异与以下编译身份，不能将祖先 HEAD 本身当成新 tested_head。

| 身份 | 最终值 |
| --- | --- |
| manifest SHA256 | 3601c2814edc695ef5b68cdbbb1a34871cea2561dfeb985270e2bcfb2a88c558 |
| 受控输入 SHA256 | b115e481a0d20136ad2705b4d87e856d536e72b4c6a1d6adb1ad32f61d841af2 |
| G2 源身份指纹 | 62a01fc717d22681a688f36ef7359707e2011d12d3742de0027668537179c994 |
| 输入与运行树 | 879 typed / 351 retained legacy；2008输入；2647物理运行文件 |
| G2 源清单 | 2018/2048；路径集合与首批候选完全相同 |

## 修补及原因

T35 原第二个场景只断言前两条材料可见，没有排除第三条。首批第五轮在900px视口得到合法游标3而与写死的2冲突。前一轮已完成相同生产字节的900/240px几何对照；本轮把240px和全部可见正文的精确序列上界写入注册源码，并显式准备第三条真实合成材料，确认它已加载但在两条可见范围外。原唯一UUID、真实COMMIT后丢ACK、只GET核对、跨主体/Session/事项隔离断言保持，生产阅读实现不变。

G2 当前复现的页面等待对应真实 RECONCILIATION_REQUIRED/UNKNOWN：重连后SDK多调用一次，Worker在5秒发送截止返回COMMUNICATION_SEND_TIMEOUT。只读时序探针证明模拟SDK立即ACK；同一发送的三次同步候选核验分别约2.419/2.259/1.957秒，合计约6.635秒，连同其他步骤使ACK晚于截止。没有把页面状态或错误码改成成功。

修补复用同一V2路径选择、UTF8-LF/BINARY归一化及指纹规则。前两次热路径核验改为每批最多4个完整文件的有界异步读取，每批全部成功或失败操作结束后才继续；每次异步核验后重新核对配置和批准，数据库等待后的核验仍在。真正SDK调用点的原同步候选/批准终检保持原代码；Worker5秒、lease、IPC、预算、UNKNOWN与禁止盲目重发语义均不变，没有mtime/TTL或旧结果缓存。

受控源码仅4文件变化：p2-g2-candidate.mts、p2-g2-send-guard.mts、原ready-candidate测试和T35测试。运行输出仅对应7文件变化；其余源码清单哈希、所有117个PC/H5输出、SQL、Schema、默认开关、依赖与原注册入口集合保持。原741入口并未重跑。

## 实际验证

最终构建、strict、负向类型和制品检查通过，随后复用同一manifest：

| 已注册范围 | 实际结果 |
| --- | --- |
| candidate-unit25-01 | 22/22 PASS |
| sender-guard25-01 | 1/1 PASS |
| recovery25-01 | 6/6 PASS |
| human-process25-01 | 4/4 PASS |
| pc-h5-browser25-01 | 12/12 PASS |
| g2-process25-01 | 1/1 PASS |
| g2-process25-02 | 1/1 PASS |
| g2-process25-03 | 1/1 PASS |

表中共48次用例执行，其中同一G2完整用例重复3次；这是定向选择，不称全仓全集。候选测试实际验证同步/异步完整inventory一致、事件循环可前进、UTF8/BOM/LF与二进制、篡改、非法编码、符号链接、16MiB和2048上限。Guard测试保留真实PG绑定、禁止伪造目标、数值ACK和回执重放不重复SDK；原测试中多次完整核验的既有20秒夹具预算未改，真实三角色Worker仍使用原5秒截止。

正式H5补充4组主题/语言/宽度，首页、列表、详情深链刷新及同源资产通过；11张最终PC/H5截图已实际查看。外部Provider/SDK为合成边界，真实企业微信、移动真机与正式2C4G验收未执行。首批Source23的12组168工具及53项Core权限检查保留为其原候选证据；本轮没有借用旧计数冒充新manifest执行。

中间候选2b96eae163021232cadd54511ddaeaa1b9f21829f05a3dde925d671e412f2505也完成22项相关检查、完整G2和T35/T29六项，通过后仅补齐失败批次文件读取的收尾，再冻结本最终候选；两份身份和原件分别保留。

## 原失败与证据限制

本轮确定的是Source23上网关重连复现的验证成本/发送截止关系。旧首批首次SENT等待没有当时阶段快照，其他早期失败也未因此反推为同因或重标PASS。原58项台账及6个首次原因未知身份保留；本次两个当前入口的新观察与修补证据独立追加。全量仍停在旧Source23的322/741入口、1517用例；停止时419入口未执行，后来定向观察只属于各自候选，不合并为一次full。current/historical certify与正式READY均未运行。

诊断原件在D:/fr25/reports/g2-reconnect-observe-02和g2-ack-timing-03，包含安全状态、原TAP、逐阶段单调时钟和原生关闭收据。最初新PG启动器的等待原因未确定；只在精确PID/birth/命令核验后结束该自有启动器，保留已启动的新隔离PG并独立核验，未操作旧PG。外置探针准备脚本的一次语法错误发生在运行前，未充当有效业务RED。

## 运行包、回退与资源

运行包：D:/fr25/reports/candidate25-package-01/first-gray-candidate.tar.gz（8002978字节）。SHA256：edf516125bf95c17524b11dd9ebdda671527ea1b11b1b02d63e25d0a97ad0ce7。包中2649文件（含2647运行文件）已解包逐文件核验；无私有配置、密钥或node_modules。使用现有锁定依赖的临时链接执行编译human-workbench入口--check，缺省enabled:false，链接已移除。未在新主机安装依赖或核对真实配置。

代码增量回退以Source23首批候选为基线，4个变更文件的before/after字节均独立保存，自有副本已完成回退、重新应用及后续修改SHA拒绝保护。交付文档另纳最终清单，不对整个工作树reset/clean。Source23及原05已知失败和全部用户成果保留。现场现行包仍须在实际部署前具名绑定；本地演练不称生产回滚，没有数据库回滚。

新自有PG18仅监听127.0.0.1:52477，max_connections20/shared_buffers64MB；全部测试后恢复四库/零其他连接，停止0、status3、同birth进程与监听0，数据/日志保留。最终自有Node/浏览器/profile/监听均0；历史Source03一份native closed缺口及独立外部关闭证明仍保留，未补写或把其原active未知值写成0。旧PG和首批候选原件没有改写。

完整机器索引、原件SHA与包校验见D:/fr25/reports/delivery25/README.md和index.json；回退为followup-final-delta25/increment-rollback.json及followup-rollback25/result.json。当前运行命令与关闭顺序沿[human-v1运行说明](../../docs/runbooks/human-workbench-runtime.md)。未暂存、提交、推送、合并、部署、真实发送、现场业务写库或推进Gate；P2-G2-LIVE、P2-008、P2-G3/P3停止线保持。
